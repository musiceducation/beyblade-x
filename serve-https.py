#!/usr/bin/env python3
"""HTTPS static server for phone camera (getUserMedia requires secure context)."""
import http.server
import json
import os
import re
import shutil
import socket
import ssl
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone

DIR = os.path.dirname(os.path.abspath(__file__))
PORT = 8443
RTMP_PORT = 1935
DJI_STREAM_KEY = 'dji'
DJI_WIDTH = 1920
DJI_FPS = 30
DJI_JPEG_Q = 2  # 1 = best, 31 = worst
CERT = os.path.join(DIR, 'cert.pem')
KEY = os.path.join(DIR, 'key.pem')
DJI_FRAME = os.path.join(DIR, '.dji-frame.jpg')
DJI_FFMPEG_LOG = os.path.join(DIR, '.dji-ffmpeg.log')
MEDIAMTX_CONFIG = os.path.join(DIR, 'mediamtx.yml')
REPLAY_DIR = os.path.join(DIR, '.replays')
REPLAY_INDEX = os.path.join(REPLAY_DIR, 'index.json')
REPLAY_MAX = 60
SIGNAL_ROOMS = {}

TOURNAMENT_STATE = {
    'revision': 0,
    'updatedAt': 0,
    'junior': {
        'players': [],
        'drawn': False,
        'matches': {},
        'eliminatedIds': [],
        'revivalWinnerId': None,
        'activeMatchId': None,
    },
    'senior': {
        'players': [],
        'drawn': False,
        'matches': {},
        'eliminatedIds': [],
        'revivalWinnerId': None,
        'activeMatchId': None,
    },
}
TOURNAMENT_LOCK = threading.Lock()

REPLAY_STATE = {
    'revision': 0,
    'updatedAt': 0,
    'replays': [],
}
REPLAY_LOCK = threading.Lock()

ARENA_LIVE_STATE = {
    'updatedAt': 0,
    'session': 'junior',
    'phase': 'prelim',
    'p1Name': 'Blader 1',
    'p2Name': 'Blader 2',
    'scores': [0, 0],
    'battle': 1,
    'matchOver': False,
    'matchLabel': None,
    'active': False,
    'broadcastStatus': 'live',
    'broadcastMessage': '',
    'stationName': '台 1',
}
ARENA_LIVE_LOCK = threading.Lock()

MATCH_LOCK = {
    'matchId': None,
    'session': None,
    'operatorId': None,
    'operatorLabel': None,
    'matchLabel': None,
    'since': 0,
}
MATCH_LOCK_GUARD = threading.Lock()


def ensure_replay_dir():
    os.makedirs(REPLAY_DIR, exist_ok=True)


def replay_meta_path(replay_id):
    return os.path.join(REPLAY_DIR, f'{replay_id}.json')


def replay_video_path(replay_id):
    return os.path.join(REPLAY_DIR, f'{replay_id}.webm')


def load_replay_index():
    ensure_replay_dir()
    if not os.path.isfile(REPLAY_INDEX):
        return
    try:
        with open(REPLAY_INDEX, 'r', encoding='utf-8') as f:
            data = json.load(f)
        with REPLAY_LOCK:
            REPLAY_STATE['revision'] = int(data.get('revision', 0))
            REPLAY_STATE['updatedAt'] = int(data.get('updatedAt', 0))
            REPLAY_STATE['replays'] = data.get('replays', [])
    except (OSError, json.JSONDecodeError, ValueError):
        pass


def save_replay_index():
    ensure_replay_dir()
    with REPLAY_LOCK:
        payload = {
            'revision': REPLAY_STATE['revision'],
            'updatedAt': REPLAY_STATE['updatedAt'],
            'replays': REPLAY_STATE['replays'],
        }
    tmp = REPLAY_INDEX + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(payload, f, ensure_ascii=False)
    os.replace(tmp, REPLAY_INDEX)


def prune_replays():
    with REPLAY_LOCK:
        replays = REPLAY_STATE['replays']
        if len(replays) <= REPLAY_MAX:
            return []
        removed = replays[REPLAY_MAX:]
        REPLAY_STATE['replays'] = replays[:REPLAY_MAX]
        REPLAY_STATE['revision'] += 1
        REPLAY_STATE['updatedAt'] = int(time.time() * 1000)
    save_replay_index()
    return [r.get('id') for r in removed if r.get('id')]


def delete_replay_files(replay_id):
    for path in (replay_meta_path(replay_id), replay_video_path(replay_id)):
        try:
            if os.path.isfile(path):
                os.remove(path)
        except OSError:
            pass


def upsert_replay_metadata(session):
    replay_id = session.get('id')
    if not replay_id or not re.fullmatch(r'r-[a-zA-Z0-9-]+', replay_id):
        return False, 'invalid id'

    meta_path = replay_meta_path(replay_id)
    ensure_replay_dir()
    with open(meta_path, 'w', encoding='utf-8') as f:
        json.dump(session, f, ensure_ascii=False)

    summary = {k: session.get(k) for k in (
        'id', 'createdAt', 'endedAt', 'battleNum', 'matchGroupId',
        'session', 'phase', 'p1Name', 'p2Name', 'startScores', 'finalScores',
        'videoId', 'events',
    )}
    summary['hasVideo'] = bool(session.get('videoId')) and os.path.isfile(replay_video_path(replay_id))

    with REPLAY_LOCK:
        replays = REPLAY_STATE['replays']
        idx = next((i for i, r in enumerate(replays) if r.get('id') == replay_id), -1)
        if idx >= 0:
            replays[idx] = summary
        else:
            replays.insert(0, summary)
        REPLAY_STATE['revision'] += 1
        REPLAY_STATE['updatedAt'] = int(time.time() * 1000)

    save_replay_index()
    for rid in prune_replays():
        delete_replay_files(rid)
    return True, replay_id


def mark_replay_has_video(replay_id):
    with REPLAY_LOCK:
        for r in REPLAY_STATE['replays']:
            if r.get('id') == replay_id:
                r['hasVideo'] = True
                r['videoId'] = replay_id
                REPLAY_STATE['revision'] += 1
                REPLAY_STATE['updatedAt'] = int(time.time() * 1000)
                break
    save_replay_index()


def parse_replay_id_from_path(path):
    match = re.fullmatch(r'/replay/(r-[a-zA-Z0-9-]+)/video(?:\.webm)?', path)
    return match.group(1) if match else None


CLOUD_SECRETS_PATH = os.path.join(DIR, 'arena-secrets.local.json')
ARENA_CONFIG_JS = os.path.join(DIR, 'arena-config.local.js')
_cloud_config_cache = None
_cloud_config_mtime = 0.0


def _parse_arena_config_js():
    if not os.path.isfile(ARENA_CONFIG_JS):
        return {}
    try:
        with open(ARENA_CONFIG_JS, encoding='utf-8') as f:
            text = f.read()
    except OSError:
        return {}
    out = {}
    for key, pattern in (
        ('eventSlug', r"eventSlug:\s*['\"]([^'\"]+)"),
        ('supabaseUrl', r"url:\s*['\"](https://[^'\"]+)"),
        ('supabaseServiceKey', r"serviceKey:\s*['\"]([^'\"]+)"),
        ('playerPortalUrl', r"playerPortalUrl:\s*['\"]([^'\"]+)"),
    ):
        match = re.search(pattern, text)
        if match:
            out[key] = match.group(1)
    return out


def get_cloud_config():
    global _cloud_config_cache, _cloud_config_mtime

    secrets_mtime = os.path.getmtime(CLOUD_SECRETS_PATH) if os.path.isfile(CLOUD_SECRETS_PATH) else 0.0
    js_mtime = os.path.getmtime(ARENA_CONFIG_JS) if os.path.isfile(ARENA_CONFIG_JS) else 0.0
    max_mtime = max(secrets_mtime, js_mtime)
    if _cloud_config_cache is not None and max_mtime == _cloud_config_mtime:
        return _cloud_config_cache

    cfg = {}
    if os.path.isfile(CLOUD_SECRETS_PATH):
        try:
            with open(CLOUD_SECRETS_PATH, encoding='utf-8') as f:
                cfg.update(json.load(f))
        except (OSError, json.JSONDecodeError):
            pass

    js_cfg = _parse_arena_config_js()
    for key, value in js_cfg.items():
        if key == 'supabaseServiceKey' and cfg.get('supabaseServiceKey'):
            continue
        cfg.setdefault(key, value)

    service_key = cfg.get('supabaseServiceKey') or cfg.get('serviceKey')
    supabase_url = (cfg.get('supabaseUrl') or cfg.get('url') or '').rstrip('/')
    event_slug = cfg.get('eventSlug')

    if service_key and supabase_url and event_slug:
        _cloud_config_cache = {
            'eventSlug': event_slug,
            'supabaseUrl': supabase_url,
            'supabaseServiceKey': service_key,
            'playerPortalUrl': cfg.get('playerPortalUrl'),
        }
    else:
        _cloud_config_cache = None

    _cloud_config_mtime = max_mtime
    return _cloud_config_cache


def _utc_iso():
    return datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%S') + 'Z'


# region agent log
def portal_debug_log(hypothesis_id, location, message, data=None):
    payload = {
        'sessionId': 'aee127',
        'runId': 'pre-fix',
        'hypothesisId': hypothesis_id,
        'location': location,
        'message': message,
        'data': data or {},
        'timestamp': int(time.time() * 1000),
    }
    try:
        with open(os.path.join(DIR, '.cursor', 'debug-aee127.log'), 'a', encoding='utf-8') as f:
            f.write(json.dumps(payload, ensure_ascii=False) + '\n')
    except OSError:
        pass
# endregion


def _supabase_request(method, path, body=None, content_type='application/json', extra_headers=None):
    cfg = get_cloud_config()
    if not cfg:
        # region agent log
        portal_debug_log('H1,H3,H4', 'serve-https.py:296', 'supabase request skipped', {
            'method': method,
            'path': path,
            'reason': 'cloud not configured',
        })
        # endregion
        return None, b'cloud not configured'

    url = f"{cfg['supabaseUrl']}{path}"
    headers = {
        'apikey': cfg['supabaseServiceKey'],
        'Authorization': f"Bearer {cfg['supabaseServiceKey']}",
    }
    if content_type:
        headers['Content-Type'] = content_type
    if extra_headers:
        headers.update(extra_headers)

    data = None
    if body is not None:
        data = body if isinstance(body, bytes) else body.encode('utf-8')

    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            raw = resp.read()
            # region agent log
            portal_debug_log('H3,H4,H5', 'serve-https.py:326', 'supabase request succeeded', {
                'method': method,
                'path': path,
                'status': resp.status,
                'bytes': len(raw),
                'contentType': content_type,
            })
            # endregion
            return resp.status, raw
    except urllib.error.HTTPError as err:
        raw = err.read()
        # region agent log
        portal_debug_log('H3,H4,H5', 'serve-https.py:338', 'supabase request http error', {
            'method': method,
            'path': path,
            'status': err.code,
            'body': raw.decode('utf-8', errors='replace')[:500],
            'contentType': content_type,
        })
        # endregion
        return err.code, raw
    except OSError as err:
        # region agent log
        portal_debug_log('H1,H3,H4', 'serve-https.py:350', 'supabase request os error', {
            'method': method,
            'path': path,
            'error': str(err)[:500],
            'contentType': content_type,
        })
        # endregion
        return None, str(err).encode('utf-8')


def push_tournament_to_cloud(revision, junior, senior):
    cfg = get_cloud_config()
    if not cfg:
        return False, 'cloud not configured'

    body = json.dumps({
        'event_slug': cfg['eventSlug'],
        'revision': revision,
        'updated_at': _utc_iso(),
        'junior': junior or {},
        'senior': senior or {},
    })

    status, raw = _supabase_request(
        'POST',
        '/rest/v1/arena_state?on_conflict=event_slug',
        body,
        extra_headers={'Prefer': 'resolution=merge-duplicates,return=minimal'},
    )

    if status == 409:
        patch = json.dumps({
            'revision': revision,
            'updated_at': json.loads(body)['updated_at'],
            'junior': junior or {},
            'senior': senior or {},
        })
        slug = urllib.parse.quote(cfg['eventSlug'], safe='')
        status, raw = _supabase_request(
            'PATCH',
            f'/rest/v1/arena_state?event_slug=eq.{slug}',
            patch,
        )

    if status and 200 <= status < 300:
        return True, None

    text = raw.decode('utf-8', errors='replace') if isinstance(raw, bytes) else str(raw)
    return False, f'arena_state {status} {text}'


def push_arena_live_to_cloud(live):
    cfg = get_cloud_config()
    if not cfg or not live:
        return False, 'cloud not configured'

    slug = urllib.parse.quote(cfg['eventSlug'], safe='')
    body = json.dumps({
        'live': live,
        'updated_at': _utc_iso(),
    })
    status, raw = _supabase_request(
        'PATCH',
        f'/rest/v1/arena_state?event_slug=eq.{slug}',
        body,
    )
    if status and 200 <= status < 300:
        return True, None
    text = raw.decode('utf-8', errors='replace') if isinstance(raw, bytes) else str(raw)
    return False, f'arena_live {status} {text}'


def match_lock_snapshot():
    with MATCH_LOCK_GUARD:
        return dict(MATCH_LOCK)


def handle_match_lock_post(payload):
    action = payload.get('action')
    operator_id = payload.get('operatorId')
    if not operator_id:
        return False, 'missing operatorId', match_lock_snapshot()

    with MATCH_LOCK_GUARD:
        if action == 'release':
            if MATCH_LOCK['operatorId'] == operator_id or not MATCH_LOCK['matchId']:
                MATCH_LOCK['matchId'] = None
                MATCH_LOCK['session'] = None
                MATCH_LOCK['operatorId'] = None
                MATCH_LOCK['operatorLabel'] = None
                MATCH_LOCK['matchLabel'] = None
                MATCH_LOCK['since'] = 0
                return True, None, dict(MATCH_LOCK)
            return False, 'not lock owner', dict(MATCH_LOCK)

        if action != 'claim':
            return False, 'unknown action', dict(MATCH_LOCK)

        match_id = payload.get('matchId')
        if not match_id:
            return False, 'missing matchId', dict(MATCH_LOCK)

        current = MATCH_LOCK['matchId']
        if current and current != match_id and MATCH_LOCK['operatorId'] != operator_id:
            return False, 'locked by other station', dict(MATCH_LOCK)

        MATCH_LOCK['matchId'] = match_id
        MATCH_LOCK['session'] = payload.get('session')
        MATCH_LOCK['operatorId'] = operator_id
        MATCH_LOCK['operatorLabel'] = payload.get('operatorLabel') or '裁判台'
        MATCH_LOCK['matchLabel'] = payload.get('matchLabel')
        MATCH_LOCK['since'] = int(time.time() * 1000)
        return True, None, dict(MATCH_LOCK)


def push_replay_meta_to_cloud(session):
    cfg = get_cloud_config()
    replay_id = session.get('id') if session else None
    if not cfg or not replay_id:
        return False, 'invalid replay'

    meta_row = json.dumps({
        'id': replay_id,
        'event_slug': cfg['eventSlug'],
        'match_group_id': session.get('matchGroupId') or replay_id,
        'battle_num': session.get('battleNum') or 1,
        'metadata': session,
        'has_video': bool(session.get('videoId')),
        'updated_at': _utc_iso(),
    })

    status, raw = _supabase_request(
        'POST',
        '/rest/v1/arena_replays?on_conflict=id',
        meta_row,
        extra_headers={'Prefer': 'resolution=merge-duplicates,return=minimal'},
    )

    if status and 200 <= status < 300:
        return True, None

    text = raw.decode('utf-8', errors='replace') if isinstance(raw, bytes) else str(raw)
    return False, f'arena_replays {status} {text}'


def transcode_webm_to_mp4_bytes(webm_bytes):
    ffmpeg = shutil.which('ffmpeg')
    if not ffmpeg or len(webm_bytes) < 1024:
        return None

    tmp_dir = os.path.join(REPLAY_DIR, '.transcode')
    os.makedirs(tmp_dir, exist_ok=True)
    inp_path = os.path.join(tmp_dir, f'in-{int(time.time() * 1000)}.webm')
    out_path = inp_path.replace('.webm', '.mp4')
    try:
        with open(inp_path, 'wb') as f:
            f.write(webm_bytes)
        proc = subprocess.run(
            [
                ffmpeg, '-y', '-i', inp_path,
                '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23',
                '-c:a', 'aac', '-movflags', '+faststart',
                out_path,
            ],
            capture_output=True,
            timeout=180,
        )
        if proc.returncode != 0 or not os.path.isfile(out_path):
            return None
        with open(out_path, 'rb') as f:
            mp4_bytes = f.read()
        return mp4_bytes if len(mp4_bytes) > 1024 else None
    except (OSError, subprocess.SubprocessError, subprocess.TimeoutExpired):
        return None
    finally:
        for path in (inp_path, out_path):
            try:
                os.remove(path)
            except OSError:
                pass


def push_replay_video_to_cloud(replay_id, video_bytes, content_type='video/webm'):
    cfg = get_cloud_config()
    if not cfg:
        return False, 'cloud not configured'
    if not replay_id or len(video_bytes) < 1024:
        return False, 'video too small'

    is_mp4 = 'mp4' in (content_type or '')
    primary_ext = 'mp4' if is_mp4 else 'webm'
    storage_path = f"{cfg['eventSlug']}/{replay_id}.{primary_ext}"
    status, raw = _supabase_request(
        'POST',
        f'/storage/v1/object/replay-videos/{storage_path}',
        video_bytes,
        content_type=content_type or ('video/mp4' if is_mp4 else 'video/webm'),
        extra_headers={'x-upsert': 'true'},
    )

    if not status or status < 200 or status >= 300:
        text = raw.decode('utf-8', errors='replace') if isinstance(raw, bytes) else str(raw)
        return False, f'storage {status} {text}'

    if not is_mp4:
        mp4_bytes = transcode_webm_to_mp4_bytes(video_bytes)
        if mp4_bytes:
            mp4_path = f"{cfg['eventSlug']}/{replay_id}.mp4"
            _supabase_request(
                'POST',
                f'/storage/v1/object/replay-videos/{mp4_path}',
                mp4_bytes,
                content_type='video/mp4',
                extra_headers={'x-upsert': 'true'},
            )

    patch = json.dumps({'has_video': True, 'updated_at': _utc_iso()})
    rid = urllib.parse.quote(replay_id, safe='')
    status, raw = _supabase_request(
        'PATCH',
        f'/rest/v1/arena_replays?id=eq.{rid}',
        patch,
    )

    if status and 200 <= status < 300:
        return True, None

    text = raw.decode('utf-8', errors='replace') if isinstance(raw, bytes) else str(raw)
    return False, f'arena_replays patch {status} {text}'


def clear_all_local_replays():
    with REPLAY_LOCK:
        ids = [r.get('id') for r in REPLAY_STATE['replays'] if r.get('id')]
        REPLAY_STATE['replays'] = []
        REPLAY_STATE['revision'] += 1
        REPLAY_STATE['updatedAt'] = int(time.time() * 1000)
    save_replay_index()
    for rid in ids:
        delete_replay_files(rid)
    return ids


def clear_cloud_replays():
    cfg = get_cloud_config()
    if not cfg:
        return False, 'cloud not configured', {'deletedRows': 0, 'deletedVideos': 0}

    slug = cfg['eventSlug']
    slug_q = urllib.parse.quote(slug, safe='')
    deleted_videos = 0

    while True:
        status, raw = _supabase_request(
            'POST',
            '/storage/v1/object/list/replay-videos',
            json.dumps({'prefix': f'{slug}/', 'limit': 1000}),
        )
        if not (status and 200 <= status < 300):
            break
        try:
            items = json.loads(raw.decode())
            prefixes = [f"{slug}/{item['name']}" for item in items if item.get('name')]
        except (json.JSONDecodeError, KeyError, TypeError):
            break
        if not prefixes:
            break
        del_status, _ = _supabase_request(
            'DELETE',
            '/storage/v1/object/replay-videos',
            json.dumps({'prefixes': prefixes}),
        )
        if del_status and 200 <= del_status < 300:
            deleted_videos += len(prefixes)
        if len(prefixes) < 1000:
            break

    status, raw = _supabase_request(
        'DELETE',
        f'/rest/v1/arena_replays?event_slug=eq.{slug_q}',
        content_type=None,
        extra_headers={'Prefer': 'return=representation'},
    )
    deleted_rows = 0
    if status and 200 <= status < 300:
        try:
            deleted_rows = len(json.loads(raw.decode() or '[]'))
        except json.JSONDecodeError:
            deleted_rows = 0
        return True, None, {'deletedRows': deleted_rows, 'deletedVideos': deleted_videos}

    text = raw.decode('utf-8', errors='replace') if isinstance(raw, bytes) else str(raw)
    return False, f'arena_replays delete {status} {text}', {'deletedRows': 0, 'deletedVideos': deleted_videos}


def delete_cloud_replay(replay_id):
    cfg = get_cloud_config()
    if not cfg or not replay_id:
        return False, 'invalid replay', {'deletedVideo': False}

    slug = cfg['eventSlug']
    storage_path = f'{slug}/{replay_id}.webm'
    _supabase_request(
        'DELETE',
        '/storage/v1/object/replay-videos',
        json.dumps({'prefixes': [storage_path]}),
    )

    rid = urllib.parse.quote(replay_id, safe='')
    status, raw = _supabase_request(
        'DELETE',
        f'/rest/v1/arena_replays?id=eq.{rid}',
        content_type=None,
    )
    if status and 200 <= status < 300:
        return True, None, {'deletedVideo': True}

    text = raw.decode('utf-8', errors='replace') if isinstance(raw, bytes) else str(raw)
    return False, f'arena_replays delete {status} {text}', {'deletedVideo': False}


def delete_local_replay(replay_id):
    if not replay_id or not re.fullmatch(r'r-[a-zA-Z0-9-]+', replay_id):
        return False
    with REPLAY_LOCK:
        replays = REPLAY_STATE['replays']
        idx = next((i for i, r in enumerate(replays) if r.get('id') == replay_id), -1)
        if idx >= 0:
            replays.pop(idx)
            REPLAY_STATE['revision'] += 1
            REPLAY_STATE['updatedAt'] = int(time.time() * 1000)
    save_replay_index()
    delete_replay_files(replay_id)
    return True


def find_binary(name, brew_paths=()):
    found = shutil.which(name)
    if found:
        return found
    for candidate in brew_paths:
        if os.path.isfile(candidate) and os.access(candidate, os.X_OK):
            return candidate
    return None


def find_ffmpeg():
    """Resolve ffmpeg binary (PATH or common Homebrew locations)."""
    return find_binary('ffmpeg', (
        '/opt/homebrew/bin/ffmpeg',
        '/usr/local/bin/ffmpeg',
    ))


def find_mediamtx():
    return find_binary('mediamtx', (
        '/opt/homebrew/bin/mediamtx',
        '/usr/local/bin/mediamtx',
    ))


def _pids_on_port(port):
    try:
        out = subprocess.check_output(
            ['lsof', '-ti', f'tcp:{port}'],
            text=True,
            stderr=subprocess.DEVNULL,
        ).strip()
    except (OSError, subprocess.CalledProcessError):
        return []
    return [int(p) for p in out.splitlines() if p.strip().isdigit()]


def _proc_cmdline(pid):
    try:
        return subprocess.check_output(
            ['ps', '-p', str(pid), '-o', 'args='],
            text=True,
            stderr=subprocess.DEVNULL,
        ).strip()
    except (OSError, subprocess.CalledProcessError):
        return ''


def check_https_port():
    """If our server is already listening, print the URL and exit cleanly."""
    pids = _pids_on_port(PORT)
    if not pids:
        return
    script = os.path.abspath(__file__)
    for pid in pids:
        cmd = _proc_cmdline(pid)
        if script in cmd:
            lan = get_lan_ip()
            host = lan or 'localhost'
            print(f'競賽伺服器已在運行（PID {pid}）。')
            print(f'網址：https://{host}:{PORT}/')
            sys.exit(0)
    print(f'Port {PORT} is already in use:', file=sys.stderr)
    for pid in pids:
        print(f'  PID {pid}: {_proc_cmdline(pid)}', file=sys.stderr)
    print(f'Free it with: kill {" ".join(map(str, pids))}', file=sys.stderr)
    sys.exit(1)


def free_rtmp_port():
    """Stop leftover mediamtx from a prior session so ffmpeg -listen can bind :1935."""
    try:
        out = subprocess.check_output(
            ['lsof', '-ti', f'tcp:{RTMP_PORT}'],
            text=True,
            stderr=subprocess.DEVNULL,
        ).strip()
    except (OSError, subprocess.CalledProcessError):
        return
    for pid in out.splitlines():
        try:
            os.kill(int(pid), 15)
        except (OSError, ValueError):
            pass
    time.sleep(0.2)


class DjiRelay:
    def __init__(self):
        self.mtx_proc = None
        self.proc = None
        self.watch_thread = None
        self.lock = threading.Lock()

    def running(self):
        mtx = self.mtx_proc is not None and self.mtx_proc.poll() is None
        reader = self.proc is not None and self.proc.poll() is None
        if mtx:
            return True
        return reader

    def _wait_for_rtmp_port(self, timeout=5.0):
        deadline = time.time() + timeout
        while time.time() < deadline:
            try:
                with socket.create_connection(('127.0.0.1', RTMP_PORT), timeout=0.25):
                    return True
            except OSError:
                time.sleep(0.15)
        return False

    def _kill_reader(self):
        if not self.proc:
            return
        self.proc.terminate()
        try:
            self.proc.wait(timeout=2)
        except subprocess.TimeoutExpired:
            self.proc.kill()
        self.proc = None

    def _spawn_reader(self, ffmpeg):
        self._kill_reader()
        log_file = open(DJI_FFMPEG_LOG, 'a', encoding='utf-8')
        log_file.write(f'\n--- DJI relay start {time.strftime("%Y-%m-%d %H:%M:%S")} ---\n')
        log_file.flush()
        use_mediamtx = self.mtx_proc is not None and self.mtx_proc.poll() is None
        if use_mediamtx and not self._wait_for_rtmp_port(timeout=8.0):
            log_file.write('mediamtx port not ready\n')
            log_file.flush()
            log_file.close()
            self.mtx_proc = None
            use_mediamtx = False

        input_url = f'rtmp://0.0.0.0:{RTMP_PORT}/live/{DJI_STREAM_KEY}'
        input_opts = ['-listen', '1'] if not use_mediamtx else []
        if use_mediamtx:
            input_url = f'rtmp://127.0.0.1:{RTMP_PORT}/live/{DJI_STREAM_KEY}'
        cmd = [ffmpeg, '-hide_banner', '-loglevel', 'warning', *input_opts, '-i', input_url]
        cmd += [
            '-an', '-vf', f'fps={DJI_FPS},scale={DJI_WIDTH}:-2',
            '-q:v', str(DJI_JPEG_Q),
            '-f', 'image2', '-update', '1', '-y', DJI_FRAME,
        ]
        self.proc = subprocess.Popen(cmd, cwd=DIR, stderr=log_file)

    def _watch_reader(self):
        while True:
            with self.lock:
                if self.mtx_proc is None or self.mtx_proc.poll() is not None:
                    return
                proc = self.proc
            if proc is None:
                time.sleep(1.5)
                continue
            proc.wait()
            with self.lock:
                if self.mtx_proc is None or self.mtx_proc.poll() is not None:
                    return
                ffmpeg = find_ffmpeg()
                if not ffmpeg:
                    return
                try:
                    self._spawn_reader(ffmpeg)
                except OSError:
                    return
            time.sleep(1.5)

    def start(self):
        with self.lock:
            ffmpeg = find_ffmpeg()
            if not ffmpeg:
                return False, '請安裝 ffmpeg：brew install ffmpeg'
            if self.running():
                return True, 'already running'

            self.stop_unlocked()

            if os.path.isfile(DJI_FRAME):
                os.remove(DJI_FRAME)

            free_rtmp_port()

            # ffmpeg -listen waits for Mimo; mediamtx + RTMP pull retries were flaky on ffmpeg 8.
            try:
                self._spawn_reader(ffmpeg)
            except OSError as exc:
                self.stop_unlocked()
                return False, str(exc)

            return True, 'waiting'

    def stop_unlocked(self):
        self._kill_reader()
        if self.mtx_proc:
            self.mtx_proc.terminate()
            try:
                self.mtx_proc.wait(timeout=2)
            except subprocess.TimeoutExpired:
                self.mtx_proc.kill()
            self.mtx_proc = None
        if os.path.isfile(DJI_FRAME):
            os.remove(DJI_FRAME)

    def stop(self):
        with self.lock:
            self.stop_unlocked()


DJI_RELAY = DjiRelay()


def pick_best_ip(ips):
    def score(ip):
        parts = [int(p) for p in ip.split('.')]
        if parts[0] == 192 and parts[1] == 168:
            return 30
        if parts[0] == 10:
            return 20
        if parts[0] == 172 and 16 <= parts[1] <= 31:
            return 10
        return 0

    private_ips = [
        ip for ip in ips
        if not ip.startswith('127.') and not ip.startswith('169.254.')
    ]
    private_ips.sort(key=score, reverse=True)
    return private_ips[0] if private_ips else None


def get_lan_ip():
    ips = []

    # On macOS, en0 is usually Wi-Fi. Check common interfaces first so QR codes
    # use the address phones can actually reach, not VPN or virtual adapters.
    for iface in ('en0', 'en1', 'en2'):
        try:
            ip = subprocess.check_output(
                ['ipconfig', 'getifaddr', iface],
                text=True,
                stderr=subprocess.DEVNULL,
            ).strip()
            if ip:
                ips.append(ip)
        except (OSError, subprocess.CalledProcessError):
            pass

    try:
        hostname = socket.gethostname()
        for ip in socket.gethostbyname_ex(hostname)[2]:
            ips.append(ip)
    except OSError:
        pass

    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(('8.8.8.8', 80))
        ips.append(s.getsockname()[0])
        s.close()
    except OSError:
        pass

    return pick_best_ip(ips)


class ArenaHandler(http.server.SimpleHTTPRequestHandler):
    def _send_json(self, payload, status=200):
        body = json.dumps(payload).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _read_body(self):
        length = int(self.headers.get('Content-Length', '0') or '0')
        return self.rfile.read(length) if length else b''

    def _send_video_file(self, filepath, replay_id, download_name=None):
        if not os.path.isfile(filepath):
            self.send_error(404)
            return

        file_size = os.path.getsize(filepath)
        disposition = None
        if download_name:
            disposition = f'attachment; filename="{download_name}"'
        range_header = self.headers.get('Range')
        if range_header:
            m = re.match(r'bytes=(\d+)-(\d*)', range_header)
            if m:
                start = int(m.group(1))
                end = int(m.group(2)) if m.group(2) else file_size - 1
                end = min(end, file_size - 1)
                if start > end or start >= file_size:
                    self.send_error(416)
                    return
                length = end - start + 1
                with open(filepath, 'rb') as f:
                    f.seek(start)
                    data = f.read(length)
                self.send_response(206)
                self.send_header('Content-Type', 'video/webm')
                self.send_header('Accept-Ranges', 'bytes')
                self.send_header('Content-Range', f'bytes {start}-{end}/{file_size}')
                self.send_header('Content-Length', str(length))
                self.send_header('Cache-Control', 'no-store')
                if disposition:
                    self.send_header('Content-Disposition', disposition)
                self.end_headers()
                self.wfile.write(data)
                return

        with open(filepath, 'rb') as f:
            data = f.read()
        self.send_response(200)
        self.send_header('Content-Type', 'video/webm')
        self.send_header('Accept-Ranges', 'bytes')
        self.send_header('Content-Length', str(len(data)))
        self.send_header('Cache-Control', 'no-store')
        if disposition:
            self.send_header('Content-Disposition', disposition)
        self.end_headers()
        self.wfile.write(data)

    def _signal_parts(self):
        path = urllib.parse.urlparse(self.path).path
        match = re.fullmatch(r'/signal/([A-Z0-9]+)/([a-z]+)', path)
        if not match:
            return None
        return match.group(1), match.group(2)

    def do_GET(self):
        path = self.path.split('?', 1)[0]

        if path == '/lan-ip.json':
            ip = get_lan_ip()
            self._send_json({'ip': ip})
            return

        if path == '/dji-info.json':
            ip = get_lan_ip()
            has_ffmpeg = find_ffmpeg() is not None
            self._send_json({
                'ok': has_ffmpeg,
                'ip': ip,
                'rtmpUrl': f'rtmp://{ip}:{RTMP_PORT}/live/{DJI_STREAM_KEY}' if ip else None,
                'rtmpServer': f'rtmp://{ip}:{RTMP_PORT}/live/' if ip else None,
                'streamKey': DJI_STREAM_KEY,
                'frameUrl': '/dji-frame.jpg',
                'ffmpeg': has_ffmpeg,
                'rtmpBackend': 'ffmpeg',
                'relayRunning': DJI_RELAY.running(),
                'error': None if has_ffmpeg else '請安裝 ffmpeg：brew install ffmpeg',
            })
            return

        if path == '/dji-frame.jpg':
            if os.path.isfile(DJI_FRAME):
                with open(DJI_FRAME, 'rb') as frame:
                    data = frame.read()
                self.send_response(200)
                self.send_header('Content-Type', 'image/jpeg')
                self.send_header('Cache-Control', 'no-store')
                self.send_header('Content-Length', str(len(data)))
                self.end_headers()
                self.wfile.write(data)
            else:
                self.send_error(404)
            return

        if path == '/tournament/state.json':
            since = 0
            query = urllib.parse.urlparse(self.path).query
            if query:
                params = urllib.parse.parse_qs(query)
                try:
                    since = int(params.get('since', ['0'])[0])
                except ValueError:
                    since = 0
            with TOURNAMENT_LOCK:
                if since >= TOURNAMENT_STATE['revision']:
                    self._send_json({'revision': TOURNAMENT_STATE['revision']})
                else:
                    self._send_json(dict(TOURNAMENT_STATE))
            return

        if path == '/arena/live.json':
            with ARENA_LIVE_LOCK:
                self._send_json(dict(ARENA_LIVE_STATE))
            return

        if path == '/match/lock.json':
            self._send_json(match_lock_snapshot())
            return

        if path == '/cloud/status.json':
            cfg = get_cloud_config()
            # region agent log
            portal_debug_log('H1,H5', 'serve-https.py:1017', 'cloud status requested', {
                'configured': cfg is not None,
                'eventSlug': cfg['eventSlug'] if cfg else None,
                'hasPlayerPortalUrl': bool(cfg.get('playerPortalUrl')) if cfg else False,
            })
            # endregion
            self._send_json({
                'ok': cfg is not None,
                'eventSlug': cfg['eventSlug'] if cfg else None,
                'playerPortalUrl': cfg.get('playerPortalUrl') if cfg else None,
            })
            return

        if path == '/replay/index.json':
            since = 0
            query = urllib.parse.urlparse(self.path).query
            if query:
                params = urllib.parse.parse_qs(query)
                try:
                    since = int(params.get('since', ['0'])[0])
                except ValueError:
                    since = 0
            with REPLAY_LOCK:
                if since >= REPLAY_STATE['revision']:
                    self._send_json({'revision': REPLAY_STATE['revision']})
                else:
                    self._send_json({
                        'revision': REPLAY_STATE['revision'],
                        'updatedAt': REPLAY_STATE['updatedAt'],
                        'replays': list(REPLAY_STATE['replays']),
                    })
            return

        replay_id = parse_replay_id_from_path(path)
        if replay_id and path.endswith('.webm'):
            query = urllib.parse.urlparse(self.path).query
            params = urllib.parse.parse_qs(query)
            download_name = f'{replay_id}.webm' if params.get('download') else None
            self._send_video_file(replay_video_path(replay_id), replay_id, download_name)
            return

        signal = self._signal_parts()
        if signal:
            room, kind = signal
            self._send_json(SIGNAL_ROOMS.get(room, {}).get(kind, {}))
            return

        super().do_GET()

    def do_POST(self):
        path = self.path.split('?', 1)[0]

        if path == '/debug/agent-log.json':
            raw = self._read_body()
            try:
                payload = json.loads(raw.decode('utf-8') or '{}')
            except json.JSONDecodeError:
                self._send_json({'error': 'bad json'}, 400)
                return
            if payload.get('sessionId') == 'aee127':
                # region agent log
                portal_debug_log(
                    payload.get('hypothesisId') or 'H0',
                    payload.get('location') or 'browser',
                    payload.get('message') or 'browser debug log',
                    payload.get('data') if isinstance(payload.get('data'), dict) else {},
                )
                # endregion
            self._send_json({'ok': True})
            return

        if path == '/dji/start':
            ok, message = DJI_RELAY.start()
            self._send_json({'ok': ok, 'message': message})
            return

        if path == '/dji/stop':
            DJI_RELAY.stop()
            self._send_json({'ok': True})
            return

        if path == '/cloud/tournament.json':
            raw = self._read_body()
            try:
                payload = json.loads(raw.decode('utf-8') or '{}')
            except json.JSONDecodeError:
                self._send_json({'error': 'bad json'}, 400)
                return

            revision = payload.get('revision')
            if revision is None:
                self._send_json({'error': 'missing revision'}, 400)
                return

            ok, err = push_tournament_to_cloud(
                revision,
                payload.get('junior'),
                payload.get('senior'),
            )
            if ok:
                self._send_json({'ok': True, 'revision': revision})
            else:
                self._send_json({'ok': False, 'error': err}, 502)
            return

        if path == '/cloud/replay/clear.json':
            ok, err, stats = clear_cloud_replays()
            if ok:
                self._send_json({'ok': True, **stats})
            else:
                self._send_json({'ok': False, 'error': err, **stats}, 502)
            return

        if path == '/cloud/replay/meta.json':
            raw = self._read_body()
            try:
                session = json.loads(raw.decode('utf-8') or '{}')
            except json.JSONDecodeError:
                self._send_json({'error': 'bad json'}, 400)
                return

            ok, err = push_replay_meta_to_cloud(session)
            if ok:
                self._send_json({'ok': True, 'id': session.get('id')})
            else:
                self._send_json({'ok': False, 'error': err}, 502)
            return

        if path == '/replay/clear.json':
            ids = clear_all_local_replays()
            self._send_json({'ok': True, 'deleted': len(ids)})
            return

        replay_delete = re.fullmatch(r'/replay/(r-[a-zA-Z0-9-]+)/delete\.json', path)
        if replay_delete:
            replay_id = replay_delete.group(1)
            ok = delete_local_replay(replay_id)
            self._send_json({'ok': ok, 'id': replay_id})
            return

        cloud_replay_delete = re.fullmatch(r'/cloud/replay/(r-[a-zA-Z0-9-]+)/delete\.json', path)
        if cloud_replay_delete:
            replay_id = cloud_replay_delete.group(1)
            ok, err, stats = delete_cloud_replay(replay_id)
            if ok:
                self._send_json({'ok': True, 'id': replay_id, **stats})
            else:
                self._send_json({'ok': False, 'error': err, **stats}, 502)
            return

        if path == '/arena/live.json':
            raw = self._read_body()
            try:
                payload = json.loads(raw.decode('utf-8') or '{}')
            except json.JSONDecodeError:
                self._send_json({'error': 'bad json'}, 400)
                return
            with ARENA_LIVE_LOCK:
                for key in ('session', 'phase', 'p1Name', 'p2Name', 'matchLabel'):
                    if key in payload:
                        ARENA_LIVE_STATE[key] = payload[key]
                if 'scores' in payload and isinstance(payload['scores'], list) and len(payload['scores']) >= 2:
                    ARENA_LIVE_STATE['scores'] = [int(payload['scores'][0]), int(payload['scores'][1])]
                if 'battle' in payload:
                    ARENA_LIVE_STATE['battle'] = int(payload['battle'])
                if 'matchOver' in payload:
                    ARENA_LIVE_STATE['matchOver'] = bool(payload['matchOver'])
                if 'active' in payload:
                    ARENA_LIVE_STATE['active'] = bool(payload['active'])
                if 'broadcastStatus' in payload:
                    ARENA_LIVE_STATE['broadcastStatus'] = str(payload['broadcastStatus'])[:32]
                if 'broadcastMessage' in payload:
                    ARENA_LIVE_STATE['broadcastMessage'] = str(payload['broadcastMessage'])[:200]
                if 'stationName' in payload:
                    ARENA_LIVE_STATE['stationName'] = str(payload['stationName'])[:40]
                ARENA_LIVE_STATE['updatedAt'] = int(time.time() * 1000)
                live_snapshot = dict(ARENA_LIVE_STATE)
            self._send_json({'ok': True})
            threading.Thread(target=push_arena_live_to_cloud, args=(live_snapshot,), daemon=True).start()
            return

        if path == '/match/lock.json':
            raw = self._read_body()
            try:
                payload = json.loads(raw.decode('utf-8') or '{}')
            except json.JSONDecodeError:
                self._send_json({'error': 'bad json'}, 400)
                return
            ok, err, lock = handle_match_lock_post(payload)
            if ok:
                self._send_json({'ok': True, 'lock': lock})
            else:
                self._send_json({'ok': False, 'error': err, 'lock': lock}, 409)
            return

        if path == '/tournament/state.json':
            length = int(self.headers.get('Content-Length', '0') or '0')
            raw = self.rfile.read(length) if length else b'{}'
            try:
                payload = json.loads(raw.decode('utf-8') or '{}')
            except json.JSONDecodeError:
                self._send_json({'error': 'bad json'}, 400)
                return

            client_revision = payload.get('revision')
            if client_revision is None:
                self._send_json({'error': 'missing revision'}, 400)
                return

            force = payload.get('force') is True

            with TOURNAMENT_LOCK:
                if client_revision != TOURNAMENT_STATE['revision'] and not force:
                    self._send_json({
                        'ok': False,
                        'conflict': True,
                        **TOURNAMENT_STATE,
                    }, 409)
                    return

                for session in ('junior', 'senior'):
                    if session in payload:
                        TOURNAMENT_STATE[session] = payload[session]

                TOURNAMENT_STATE['revision'] += 1
                TOURNAMENT_STATE['updatedAt'] = int(time.time() * 1000)
                self._send_json({
                    'ok': True,
                    'revision': TOURNAMENT_STATE['revision'],
                    'updatedAt': TOURNAMENT_STATE['updatedAt'],
                })
            return

        if path == '/replay/upload.json':
            raw = self._read_body()
            try:
                session = json.loads(raw.decode('utf-8') or '{}')
            except json.JSONDecodeError:
                self._send_json({'error': 'bad json'}, 400)
                return
            ok, result = upsert_replay_metadata(session)
            if not ok:
                self._send_json({'error': result}, 400)
                return
            with REPLAY_LOCK:
                rev = REPLAY_STATE['revision']
                updated = REPLAY_STATE['updatedAt']
            self._send_json({'ok': True, 'id': result, 'revision': rev, 'updatedAt': updated})
            return

        replay_id = parse_replay_id_from_path(path)
        if replay_id and path.endswith('/video'):
            video_path = replay_video_path(replay_id)
            ensure_replay_dir()
            raw = self._read_body()
            if len(raw) < 1024:
                self._send_json({'error': 'video too small'}, 400)
                return
            tmp = video_path + '.tmp'
            with open(tmp, 'wb') as f:
                f.write(raw)
            os.replace(tmp, video_path)
            mark_replay_has_video(replay_id)
            with REPLAY_LOCK:
                rev = REPLAY_STATE['revision']
            self._send_json({'ok': True, 'id': replay_id, 'revision': rev, 'bytes': len(raw)})
            return

        cloud_replay_video = re.fullmatch(r'/cloud/replay/(r-[a-zA-Z0-9-]+)/video', path)
        if cloud_replay_video:
            replay_id = cloud_replay_video.group(1)
            raw = self._read_body()
            content_type = self.headers.get('Content-Type', 'video/webm')
            ok, err = push_replay_video_to_cloud(replay_id, raw, content_type=content_type)
            if ok:
                self._send_json({'ok': True, 'id': replay_id, 'bytes': len(raw)})
            else:
                self._send_json({'ok': False, 'error': err}, 502)
            return

        signal = self._signal_parts()
        if not signal:
            self._send_json({'error': 'not found'}, 404)
            return

        room, kind = signal
        length = int(self.headers.get('Content-Length', '0') or '0')
        raw = self.rfile.read(length) if length else b'{}'
        try:
            payload = json.loads(raw.decode('utf-8') or '{}')
        except json.JSONDecodeError:
            self._send_json({'error': 'bad json'}, 400)
            return

        if kind == 'clear':
            SIGNAL_ROOMS.pop(room, None)
            self._send_json({'ok': True})
            return

        SIGNAL_ROOMS.setdefault(room, {})[kind] = payload
        if kind == 'answer':
            SIGNAL_ROOMS.get(room, {}).pop('offer', None)
        self._send_json({'ok': True})


def ensure_cert():
    if os.path.isfile(CERT) and os.path.isfile(KEY):
        return
    print('Generating self-signed certificate (cert.pem / key.pem)…')
    subprocess.run([
        'openssl', 'req', '-x509', '-newkey', 'rsa:2048',
        '-keyout', KEY, '-out', CERT,
        '-days', '365', '-nodes',
        '-subj', '/CN=BeybladeArena/O=Local/C=HK',
    ], check=True, cwd=DIR)


def main():
    os.chdir(DIR)
    ensure_cert()
    check_https_port()
    load_replay_index()
    handler = ArenaHandler
    try:
        httpd = http.server.ThreadingHTTPServer(('0.0.0.0', PORT), handler)
    except OSError as err:
        if err.errno in (48, 98):  # macOS / Linux: address already in use
            check_https_port()
        raise
    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    ctx.load_cert_chain(CERT, KEY)
    httpd.socket = ctx.wrap_socket(httpd.socket, server_side=True)
    lan = get_lan_ip()
    print(f'HTTPS server: https://0.0.0.0:{PORT}/')
    if lan:
        print(f'')
        print(f'  主機開啟：  https://{lan}:{PORT}/')
        print(f'  手機鏡頭：  選「手機/平板」→ 掃 QR')
        print(f'  多部裝置：  同一 Wi‑Fi 開啟相同網址，賽程自動同步')
        print(f'  選手查閱：  https://{lan}:{PORT}/player.html（掃 QR）')
        print(f'  OBS 投影：  https://{lan}:{PORT}/overlay.html')
        print(f'  DJI Action/Pocket： rtmp://{lan}:{RTMP_PORT}/live/{DJI_STREAM_KEY}')
        print(f'')
    print('首次請在電腦與手機瀏覽器接受憑證警告。')
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print('\nStopped.')
        DJI_RELAY.stop()


if __name__ == '__main__':
    main()
