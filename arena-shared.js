/** Shared helpers for arena, player portal, and OBS overlay */

function getAllMatches(data) {
  const m = data?.matches;
  if (!m?.prelim) return [];
  return [
    ...m.prelim,
    ...(m.quarter || []),
    ...(m.revival || []),
    ...(m.challenge ? [m.challenge] : []),
    ...(m.semi || []),
    ...(m.final ? [m.final] : []),
  ];
}

const PHASE_ORDER_SHARED = { prelim: 0, revival: 1, quarter: 2, challenge: 3, semi: 4, final: 5 };

function getReadyMatches(data) {
  return getAllMatches(data)
    .filter((m) => m.status === 'pending' && m.p1Id && m.p2Id)
    .sort((a, b) => {
      const priorityDiff = (b.queuePriority || 0) - (a.queuePriority || 0);
      return priorityDiff || (PHASE_ORDER_SHARED[a.phase] ?? 9) - (PHASE_ORDER_SHARED[b.phase] ?? 9);
    });
}

function getQueueMatches(data, count = 3) {
  return getReadyMatches(data).slice(0, count);
}

function downloadBlob(filename, blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

async function copyTextToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function playerName(data, id) {
  if (!id || !data?.players) return '待定';
  return data.players.find((p) => p.id === id)?.name || '待定';
}

function computeAwards(data) {
  const fin = data?.matches?.final;
  if (!fin?.winnerId) return null;
  const champion = playerName(data, fin.winnerId);
  const runnerUp = fin.winnerId === fin.p1Id
    ? playerName(data, fin.p2Id)
    : playerName(data, fin.p1Id);
  const semis = (data.matches.semi || []).map((m) => m.winnerId).filter(Boolean);
  const top4Ids = [...new Set([...semis, fin.p1Id, fin.p2Id].filter(Boolean))];
  const top4 = top4Ids
    .map((id) => playerName(data, id))
    .filter((name) => name && name !== '待定');
  return { champion, runnerUp, top4 };
}
