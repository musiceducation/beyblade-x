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
import urllib.parse

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

    def _send_video_file(self, filepath, replay_id):
        if not os.path.isfile(filepath):
            self.send_error(404)
            return

        file_size = os.path.getsize(filepath)
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
            self._send_video_file(replay_video_path(replay_id), replay_id)
            return

        signal = self._signal_parts()
        if signal:
            room, kind = signal
            self._send_json(SIGNAL_ROOMS.get(room, {}).get(kind, {}))
            return

        super().do_GET()

    def do_POST(self):
        path = self.path.split('?', 1)[0]

        if path == '/dji/start':
            ok, message = DJI_RELAY.start()
            self._send_json({'ok': ok, 'message': message})
            return

        if path == '/dji/stop':
            DJI_RELAY.stop()
            self._send_json({'ok': True})
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

            with TOURNAMENT_LOCK:
                if client_revision != TOURNAMENT_STATE['revision']:
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
    load_replay_index()
    handler = ArenaHandler
    httpd = http.server.ThreadingHTTPServer(('0.0.0.0', PORT), handler)
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
