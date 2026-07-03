/**
 * Event-day admin: settings, pre-flight checklist, share helpers.
 */

function initAdminSettings() {
  $('#btn-admin-settings')?.addEventListener('click', () => {
    $('#admin-settings-modal').hidden = false;
  });
  $('#admin-settings-modal .admin-modal-backdrop')?.addEventListener('click', () => {
    $('#admin-settings-modal').hidden = true;
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

  $('#btn-backup-tournament-admin')?.addEventListener('click', () => {
    if (typeof backupTournamentJson === 'function') backupTournamentJson();
  });
  $('#btn-restore-tournament-admin')?.addEventListener('click', () => {
    $('#restore-tournament-admin-file')?.click();
  });
  $('#restore-tournament-admin-file')?.addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (file && typeof restoreTournamentJson === 'function') {
      restoreTournamentJson(file).finally(() => { e.target.value = ''; });
    }
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

  const finishSpin = document.getElementById('finish-audio-spin');
  const finishOk = finishSpin && finishSpin.readyState >= 2;
  items.push({
    label: '得分語音',
    ok: !!finishOk,
    hint: finishOk ? 'Spin / Burst / Over / Xtreme 已載入' : '請先點一次畫面預熱音效',
  });

  try {
    const r = await fetch('/cloud/status.json', { cache: 'no-store' });
    const d = await r.json();
    items.push({ label: '雲端同步', ok: d.ok, hint: d.ok ? (d.eventSlug || '已設定') : '請設定 arena-secrets.local.json' });
  } catch {
    items.push({ label: '雲端同步', ok: false, hint: '無法連線伺服器' });
  }

  const portalUrl = typeof getPlayerPortalUrl === 'function' ? getPlayerPortalUrl() : null;
  const portalConfigured = Boolean(portalUrl && !/your-cloud-player|example\.com/i.test(portalUrl));
  items.push({
    label: '選手雲端頁',
    ok: portalConfigured,
    hint: portalConfigured ? portalUrl.replace(/^https?:\/\//, '') : '請設定 playerPortalUrl',
  });

  try {
    const r = await fetch('/tournament/state.json?since=-1', { cache: 'no-store' });
    const d = await r.json();
    const drawn = d.junior?.drawn || d.senior?.drawn;
    items.push({ label: '賽程同步', ok: r.ok, hint: r.ok ? `revision ${d.revision}` : '離線' });
    items.push({ label: '已抽籤', ok: !!drawn, hint: drawn ? '至少一個場次' : '請先抽籤' });
  } catch {
    items.push({ label: '賽程同步', ok: false, hint: '無法讀取' });
  }

  const camSource = $('#cam-source')?.value || 'local';
  const camLabels = { local: '本機', remote: '手機 QR', dji: 'DJI', url: 'URL' };
  const camStreamOk = typeof state !== 'undefined' && (
    state.cameraStream
    || (state.cameraMode === 'url' && $('#camera-feed-img') && !$('#camera-feed-img').hidden)
    || (state.cameraMode === 'remote' && state.activeRemoteCall)
    || (state.cameraMode === 'dji' && state.djiInfo)
  );
  items.push({
    label: '鏡頭來源',
    ok: camStreamOk,
    hint: camStreamOk ? `${camLabels[camSource] || camSource} · 已連線` : `${camLabels[camSource] || camSource} · 請至「鏡頭」分頁連接`,
  });

  const replayPaused = typeof replayState !== 'undefined' && replayState.recordingPaused;
  const recorderOk = typeof MediaRecorder !== 'undefined'
    && (MediaRecorder.isTypeSupported('video/webm') || MediaRecorder.isTypeSupported('video/webm;codecs=vp8'));
  items.push({
    label: '回放錄製',
    ok: recorderOk && !replayPaused,
    hint: !recorderOk ? '此瀏覽器不支援錄影' : replayPaused ? '已暫停（比賽中可關閉上傳）' : 'WebM 錄製可用',
  });

  const competitionOn = typeof isCompetitionMode === 'function' ? isCompetitionMode() : true;
  items.push({
    label: '比賽模式',
    ok: competitionOn,
    hint: competitionOn ? '倒數優先、減少延遲' : '已關閉（不建議現場使用）',
  });

  const pendingLan = typeof replayState !== 'undefined' && typeof replayNeedsLanUpload === 'function'
    ? replayState.replays.filter((r) => replayNeedsLanUpload(r)).length
    : 0;
  const pendingCloud = typeof replayState !== 'undefined' && typeof replayNeedsCloudUpload === 'function'
    ? replayState.replays.filter((r) => replayNeedsCloudUpload(r)).length
    : 0;
  const pending = pendingLan + pendingCloud;
  items.push({ label: '待上傳回放', ok: pending === 0, hint: pending ? `LAN ${pendingLan} · 雲 ${pendingCloud}` : '全部已同步' });

  const retryBtn = $('#btn-checklist-retry-replays');
  if (retryBtn) retryBtn.hidden = pending === 0;

  const toggle = $('#competition-mode-toggle');
  if (toggle && typeof isCompetitionMode === 'function') {
    toggle.checked = isCompetitionMode();
  }
  const lowFxToggle = $('#low-fx-mode-toggle');
  if (lowFxToggle && typeof isLowFxMode === 'function') {
    lowFxToggle.checked = isLowFxMode();
  }

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
  $('#btn-checklist-retry-replays')?.addEventListener('click', async () => {
    if (typeof retryPendingReplayUploads === 'function') {
      await retryPendingReplayUploads();
      if (typeof showToast === 'function') showToast('已重試待上傳回放');
    }
    runEventChecklist();
  });
  $('#btn-checklist-close')?.addEventListener('click', () => {
    $('#event-checklist-modal').hidden = true;
  });
}

const SHORTCUT_ROWS = [
  ['?', '顯示／關閉快捷鍵說明'],
  ['1 / 2 / 3 / 4', '紅方：殘存 / 爆裂 / 擊飛 / 極致'],
  ['7 / 8 / 9 / 0', '藍方：殘存 / 爆裂 / 擊飛 / 極致'],
  ['Z', '撤銷上一個得分'],
  ['N', '下一局'],
  ['L', 'Go Shoot 倒數'],
  ['Space', '待機時開始倒數／準備下一局'],
  ['Esc', '返回賽程（同 ✕ 賽程，不退出全螢幕）'],
];

function toggleShortcutsModal(show) {
  const modal = $('#shortcuts-modal');
  if (!modal) return;
  const open = show === undefined ? modal.hidden : show;
  modal.hidden = !open;
  if (open) {
    const list = $('#shortcuts-list');
    if (list) {
      list.innerHTML = SHORTCUT_ROWS.map(([key, desc]) =>
        `<tr><td><kbd>${key}</kbd></td><td>${desc}</td></tr>`,
      ).join('');
    }
  }
}

function initShortcutsModal() {
  $('#btn-shortcuts-help')?.addEventListener('click', () => toggleShortcutsModal(true));
  $('#shortcuts-modal .admin-modal-backdrop')?.addEventListener('click', () => toggleShortcutsModal(false));
  $('#btn-shortcuts-close')?.addEventListener('click', () => toggleShortcutsModal(false));
}

function shareScheduleText() {
  if (typeof buildFullSyncPayload !== 'function') return '';
  const payload = buildFullSyncPayload();
  const session = tournamentState?.session || 'junior';
  const data = payload[session];
  if (!data?.drawn) return '賽程尚未抽籤';
  const lines = [`咩咩遊樂園 — ${session === 'senior' ? '公開組' : '親子組'}`, ''];
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
  initAdminSettings();
  initEventChecklist();
  initShareSchedule();
  initShortcutsModal();
}
