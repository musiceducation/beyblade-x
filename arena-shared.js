/** Shared helpers for arena, player portal, and OBS overlay */

function getAllMatches(data) {
  const m = data?.matches;
  if (!m?.prelim) return [];
  return [
    ...m.prelim,
    ...(m.playoff || []),
    ...(m.quarter || []),
    ...(m.revival || []),
    ...(m.challenge ? [m.challenge] : []),
    ...(m.semi || []),
    ...(m.final ? [m.final] : []),
  ];
}

const PHASE_ORDER_SHARED = { prelim: 0, playoff: 1, revival: 2, quarter: 3, challenge: 4, semi: 5, final: 6 };

function getReadyMatches(data) {
  return getAllMatches(data)
    .filter((m) => m.status === 'pending' && m.p1Id && m.p2Id)
    .sort((a, b) => (PHASE_ORDER_SHARED[a.phase] ?? 9) - (PHASE_ORDER_SHARED[b.phase] ?? 9));
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
