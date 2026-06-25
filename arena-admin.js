/**
 * Event-day admin: PIN settings, pre-flight checklist, share helpers.
 */

function initPinSettings() {
  $('#btn-admin-settings')?.addEventListener('click', () => {
    $('#admin-settings-modal').hidden = false;
  });
  $('#admin-settings-modal .admin-modal-backdrop')?.addEventListener('click', () => {
    $('#admin-settings-modal').hidden = true;
  });
  $('#btn-pin-cancel')?.addEventListener('click', () => {
    $('#admin-settings-modal').hidden = true;
  });
  $('#btn-pin-save')?.addEventListener('click', () => {
    const current = $('#pin-current')?.value || '';
    const next = $('#pin-new')?.value || '';
    const confirm = $('#pin-confirm')?.value || '';
    if (current !== getArenaPin()) {
      alert('目前 PIN 錯誤');
      return;
    }
    if (!/^\d{4,8}$/.test(next)) {
      alert('新 PIN 須為 4–8 位數字');
      return;
    }
    if (next !== confirm) {
      alert('兩次輸入不一致');
      return;
    }
    setArenaPin(next);
    $('#pin-current').value = '';
    $('#pin-new').value = '';
    $('#pin-confirm').value = '';
    $('#admin-settings-modal').hidden = true;
    if (typeof showToast === 'function') showToast('PIN 已更新');
  });

  $('#btn-match-target-save')?.addEventListener('click', () => {
    const val = parseInt($('#match-target-input')?.value, 10);
    if (!Number.isFinite(val) || val < 1 || val > 10) {
      alert('勝利分數須為 1–10');
      return;
    }
    if (typeof setMatchTarget === 'function') setMatchTarget(val);
    if (typeof updateMatchTargetUI === 'function') updateMatchTargetUI();
    if (typeof showToast === 'function') showToast(`已設為 ${val} 分制`);
  });
}

async function runEventChecklist() {
  const items = [];

  items.push({ label: 'HTTPS 伺服器', ok: location.protocol === 'https:', hint: location.protocol === 'https:' ? '已連線' : '請用 https://…:8443' });

  const fsOk = typeof document.fullscreenEnabled === 'boolean' ? document.fullscreenEnabled : true;
  items.push({
    label: '全螢幕 API',
    ok: fsOk,
    hint: fsOk ? '可進入全螢幕倒數' : '此瀏覽器可能無法全螢幕',
  });

  const audio = document.getElementById('go-shoot-audio');
  const audioOk = audio && audio.readyState >= 2;
  items.push({
    label: '倒數音效',
    ok: !!audioOk,
    hint: audioOk ? '已載入' : '請按「預熱倒數音效」或先點一次畫面',
  });

  try {
    const r = await fetch('/cloud/status.json', { cache: 'no-store' });
    const d = await r.json();
    items.push({ label: '雲端同步', ok: d.ok, hint: d.ok ? (d.eventSlug || '已設定') : '請設定 arena-secrets.local.json' });
  } catch {
    items.push({ label: '雲端同步', ok: false, hint: '無法連線伺服器' });
  }

  try {
    const r = await fetch('/tournament/state.json?since=-1', { cache: 'no-store' });
    const d = await r.json();
    const drawn = d.junior?.drawn || d.senior?.drawn;
    items.push({ label: '賽程同步', ok: r.ok, hint: r.ok ? `revision ${d.revision}` : '離線' });
    items.push({ label: '已抽籤', ok: !!drawn, hint: drawn ? '至少一個場次' : '請先抽籤' });
  } catch {
    items.push({ label: '賽程同步', ok: false, hint: '無法讀取' });
  }

  const camOk = typeof state !== 'undefined' && (state.cameraStream || state.cameraMode === 'url' || state.cameraMode === 'remote');
  items.push({ label: '鏡頭', ok: camOk, hint: camOk ? '已啟用' : '建議：先開鏡頭再全螢幕' });

  const competitionOn = typeof isCompetitionMode === 'function' ? isCompetitionMode() : true;
  items.push({
    label: '比賽模式',
    ok: competitionOn,
    hint: competitionOn ? '倒數優先、減少延遲' : '已關閉（不建議現場使用）',
  });

  const pending = typeof replayState !== 'undefined'
    ? replayState.replays.filter((r) => r.videoId && !r.cloudSynced).length
    : 0;
  const replayPaused = typeof replayState !== 'undefined' && replayState.recordingPaused;
  items.push({ label: '待上傳回放', ok: pending === 0, hint: pending ? `${pending} 段待傳` : '全部已同步' });
  items.push({
    label: '回放錄製',
    ok: !replayPaused,
    hint: replayPaused ? '已暫停（比賽中可關閉上傳）' : '錄製與上傳已開啟',
  });

  const list = $('#checklist-items');
  if (!list) return items;
  list.innerHTML = items.map((it) => `
    <li class="checklist-item ${it.ok ? 'ok' : 'warn'}">
      <span class="checklist-icon">${it.ok ? '✓' : '!'}</span>
      <span class="checklist-label">${it.label}</span>
      <span class="checklist-hint">${it.hint}</span>
    </li>`).join('');

  const summary = $('#checklist-summary');
  if (summary) {
    const warn = items.filter((it) => !it.ok).length;
    const critical = items.filter((it) => !it.ok && ['HTTPS 伺服器', '賽程同步', '已抽籤'].includes(it.label)).length;
    summary.textContent = warn === 0
      ? '✅ 全部就緒，可以全螢幕開賽'
      : critical > 0
        ? `⚠ ${warn} 項待處理（含 ${critical} 項必須修正）`
        : `⚠ ${warn} 項建議處理後再開賽`;
    summary.dataset.status = warn === 0 ? 'ok' : critical > 0 ? 'critical' : 'warn';
  }

  const toggle = $('#competition-mode-toggle');
  if (toggle && typeof isCompetitionMode === 'function') {
    toggle.checked = isCompetitionMode();
  }

  return items;
}

function initEventChecklist() {
  $('#btn-event-checklist')?.addEventListener('click', async () => {
    $('#event-checklist-modal').hidden = false;
    await runEventChecklist();
  });
  $('#event-checklist-modal .admin-modal-backdrop')?.addEventListener('click', () => {
    $('#event-checklist-modal').hidden = true;
  });
  $('#btn-checklist-refresh')?.addEventListener('click', () => runEventChecklist());
  $('#btn-checklist-close')?.addEventListener('click', () => {
    $('#event-checklist-modal').hidden = true;
  });
}

function shareScheduleText() {
  if (typeof buildFullSyncPayload !== 'function') return '';
  const payload = buildFullSyncPayload();
  const session = tournamentState?.session || 'junior';
  const data = payload[session];
  if (!data?.drawn) return '賽程尚未抽籤';
  const lines = [`咩咩遊樂園 — ${session === 'senior' ? '高齡組' : '低齡組'}`, ''];
  getAllMatches(data).forEach((m) => {
    if (!m.p1Id && !m.p2Id) return;
    const p1 = data.players?.find((p) => p.id === m.p1Id)?.name || '待定';
    const p2 = data.players?.find((p) => p.id === m.p2Id)?.name || '待定';
    const st = m.status === 'done' ? '✓' : m.id === data.activeMatchId ? '▶' : '○';
    const sc = m.scores ? ` ${m.scores[0]}:${m.scores[1]}` : '';
    lines.push(`${st} ${m.label || ''} ${p1} vs ${p2}${sc}`);
  });
  return lines.join('\n');
}

function initShareSchedule() {
  $('#btn-share-schedule')?.addEventListener('click', async () => {
    const text = shareScheduleText();
    const url = typeof getPlayerPortalUrl === 'function' ? getPlayerPortalUrl() : location.origin + '/player.html';
    const body = `${text}\n\n查閱：${url}`;
    if (await copyTextToClipboard(body)) {
      if (typeof showToast === 'function') showToast('賽程已複製（可貼到 WhatsApp / LINE）');
      return;
    }
    prompt('複製賽程：', body);
  });
}

function initArenaAdmin() {
  initPinSettings();
  initEventChecklist();
  initShareSchedule();
}
