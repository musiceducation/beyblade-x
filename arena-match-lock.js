/** Match station lock — one operator per active bracket match */

const matchLockState = {
  operatorId: sessionStorage.getItem('bex-operator-id') || '',
  operatorLabel: sessionStorage.getItem('bex-station-name') || '台 1',
  remoteLock: null,
};

function getOperatorId() {
  if (!matchLockState.operatorId) {
    matchLockState.operatorId = `op-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    sessionStorage.setItem('bex-operator-id', matchLockState.operatorId);
  }
  return matchLockState.operatorId;
}

function getStationName() {
  return matchLockState.operatorLabel || '台 1';
}

function setStationName(name) {
  matchLockState.operatorLabel = (name || '台 1').trim().slice(0, 40) || '台 1';
  sessionStorage.setItem('bex-station-name', matchLockState.operatorLabel);
  if (typeof arenaBroadcast !== 'undefined') {
    arenaBroadcast.stationName = matchLockState.operatorLabel;
  }
}

async function fetchMatchLock() {
  try {
    const res = await fetch('/match/lock.json', { cache: 'no-store' });
    if (!res.ok) return null;
    const lock = await res.json();
    matchLockState.remoteLock = lock?.matchId ? lock : null;
    if (typeof updateArenaSyncBanner === 'function') updateArenaSyncBanner();
    return lock;
  } catch {
    return null;
  }
}

async function claimMatchLock(matchId, matchLabel, session) {
  const res = await fetch('/match/lock.json', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'claim',
      operatorId: getOperatorId(),
      operatorLabel: getStationName(),
      matchId,
      matchLabel,
      session: session || (typeof tournamentState !== 'undefined' ? tournamentState.session : 'junior'),
    }),
    cache: 'no-store',
  });
  const data = await res.json().catch(() => ({}));
  if (res.ok && data.ok) {
    matchLockState.remoteLock = data.lock;
    return { ok: true, lock: data.lock };
  }
  return { ok: false, lock: data.lock, error: data.error };
}

async function releaseMatchLock() {
  try {
    await fetch('/match/lock.json', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'release', operatorId: getOperatorId() }),
      cache: 'no-store',
    });
  } catch { /* ignore */ }
  matchLockState.remoteLock = null;
  if (typeof updateArenaSyncBanner === 'function') updateArenaSyncBanner();
}

function isMatchLockedByOther(matchId) {
  const lock = matchLockState.remoteLock;
  if (!lock?.matchId || lock.matchId === matchId) return false;
  return lock.operatorId !== getOperatorId();
}

function initMatchLockPoll() {
  fetchMatchLock();
  setInterval(fetchMatchLock, 4000);
}
