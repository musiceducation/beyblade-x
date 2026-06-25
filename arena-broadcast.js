/** Arena broadcast state — break/delay messages for OBS + cloud */

const arenaBroadcast = {
  status: sessionStorage.getItem('bex-broadcast-status') || 'live',
  message: sessionStorage.getItem('bex-broadcast-message') || '',
  stationName: sessionStorage.getItem('bex-station-name') || '台 1',
};

function setArenaBroadcast(status, message) {
  arenaBroadcast.status = status || 'live';
  arenaBroadcast.message = (message || '').trim().slice(0, 200);
  sessionStorage.setItem('bex-broadcast-status', arenaBroadcast.status);
  sessionStorage.setItem('bex-broadcast-message', arenaBroadcast.message);
  if (typeof pushArenaLiveState === 'function') pushArenaLiveState();
  updateBroadcastUi();
}

function updateBroadcastUi() {
  const sel = $('#broadcast-status-select');
  const msg = $('#broadcast-message-input');
  const station = $('#station-name-input');
  if (sel) sel.value = arenaBroadcast.status;
  if (msg) msg.value = arenaBroadcast.message;
  if (station) station.value = arenaBroadcast.stationName;
}

function initArenaBroadcast() {
  updateBroadcastUi();
  $('#broadcast-status-select')?.addEventListener('change', (e) => {
    setArenaBroadcast(e.target.value, $('#broadcast-message-input')?.value || '');
  });
  $('#broadcast-message-input')?.addEventListener('change', (e) => {
    setArenaBroadcast($('#broadcast-status-select')?.value || 'live', e.target.value);
  });
  $('#station-name-input')?.addEventListener('change', (e) => {
    if (typeof setStationName === 'function') setStationName(e.target.value);
    arenaBroadcast.stationName = getStationName();
    if (typeof pushArenaLiveState === 'function') pushArenaLiveState();
  });
}
