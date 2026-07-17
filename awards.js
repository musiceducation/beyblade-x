const $ = (sel) => document.querySelector(sel);

const SESSION_LABELS = { junior: '親子組', senior: '公開組' };

const params = new URLSearchParams(location.search);
let session = params.get('session') || 'junior';
let tournamentRevision = -1;
let tournamentState = null;

if (params.get('transparent') === '1') {
  document.documentElement.classList.add('awards-transparent');
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderWaiting(message) {
  const content = $('#awards-content');
  if (!content) return;
  content.innerHTML = `
    <div class="awards-waiting">
      <div class="awards-waiting-icon" aria-hidden="true">🏆</div>
      <h2>等待頒獎</h2>
      <p>${escapeHtml(message)}</p>
    </div>`;
}

function renderAwards(awards) {
  const content = $('#awards-content');
  if (!content || !awards) return;

  const top4Others = awards.top4.filter((name) =>
    name !== awards.champion && name !== awards.runnerUp
  );
  const thirdName = top4Others[0] || '—';

  content.innerHTML = `
    <div>
      <div class="awards-podium">
        <div class="awards-podium-slot awards-podium-slot--2">
          <span class="awards-rank">亞軍</span>
          <strong class="awards-name">${escapeHtml(awards.runnerUp)}</strong>
        </div>
        <div class="awards-podium-slot awards-podium-slot--1">
          <div class="awards-crown" aria-hidden="true">👑</div>
          <span class="awards-rank">冠軍</span>
          <strong class="awards-name">${escapeHtml(awards.champion)}</strong>
        </div>
        <div class="awards-podium-slot awards-podium-slot--3">
          <span class="awards-rank">四強</span>
          <strong class="awards-name">${escapeHtml(thirdName)}</strong>
        </div>
      </div>
      <div class="awards-top4">
        <span class="awards-top4-label">TOP 4</span>
        <p class="awards-top4-names">${escapeHtml(awards.top4.join(' · '))}</p>
      </div>
    </div>`;
}

function render() {
  const data = tournamentState?.[session];
  const sessionEl = $('#awards-session');
  const statusEl = $('#awards-status');

  if (sessionEl) {
    sessionEl.textContent = SESSION_LABELS[session] || session;
  }

  if (!data?.drawn) {
    renderWaiting('賽程尚未抽籤');
    if (statusEl) statusEl.textContent = '等待主機建立賽程…';
    return;
  }

  const awards = typeof computeAwards === 'function' ? computeAwards(data) : null;
  if (!awards) {
    renderWaiting('決賽尚未完場，頒獎名單將自動更新');
    if (statusEl) statusEl.textContent = '已連線 · 同步中';
    return;
  }

  renderAwards(awards);
  if (statusEl) {
    statusEl.textContent = `已連線 · ${SESSION_LABELS[session] || session} 頒獎名單`;
  }
}

async function pollTournament() {
  try {
    const since = tournamentRevision < 0 ? -1 : tournamentRevision;
    const res = await fetch(`/tournament/state.json?since=${since}`, { cache: 'no-store' });
    if (!res.ok) return;
    const data = await res.json();
    if (data.junior !== undefined || data.senior !== undefined) {
      tournamentState = data;
      if (typeof data.revision === 'number') tournamentRevision = data.revision;
      render();
    } else if (typeof data.revision === 'number') {
      tournamentRevision = Math.max(tournamentRevision, data.revision);
    }
  } catch {
    const statusEl = $('#awards-status');
    if (statusEl) statusEl.textContent = '連線中斷，重試中…';
  }
}

render();
pollTournament();
setInterval(pollTournament, 2000);
