/**
 * Tournament — roster, draw, bracket schedule
 */

const MAX_PLAYERS = 16;
const STORAGE_KEY = 'beyblade-tournament-v1';

const tournamentState = {
  session: 'junior',
  players: [],
  drawn: false,
  matches: {},
  eliminatedIds: [],
  revivalWinnerId: null,
  activeMatchId: null,
};

function createEmptySessionData() {
  return {
    players: [],
    drawn: false,
    matches: {},
    eliminatedIds: [],
    revivalWinnerId: null,
  };
}

function loadTournamentStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : { junior: createEmptySessionData(), senior: createEmptySessionData() };
  } catch {
    return { junior: createEmptySessionData(), senior: createEmptySessionData() };
  }
}

function saveTournamentStorage(all) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
}

function getSessionData() {
  const all = loadTournamentStorage();
  return all[tournamentState.session] || createEmptySessionData();
}

function persistSession() {
  const all = loadTournamentStorage();
  all[tournamentState.session] = {
    players: tournamentState.players,
    drawn: tournamentState.drawn,
    matches: tournamentState.matches,
    eliminatedIds: tournamentState.eliminatedIds,
    revivalWinnerId: tournamentState.revivalWinnerId,
  };
  saveTournamentStorage(all);
}

function loadSession(session) {
  tournamentState.session = session;
  const data = getSessionData();
  tournamentState.players = data.players || [];
  tournamentState.drawn = data.drawn || false;
  tournamentState.matches = data.matches || {};
  tournamentState.eliminatedIds = data.eliminatedIds || [];
  tournamentState.revivalWinnerId = data.revivalWinnerId || null;
  tournamentState.activeMatchId = null;
  renderTournamentUI();
}

function playerName(id) {
  if (!id) return '待定';
  const p = tournamentState.players.find((x) => x.id === id);
  return p ? p.name : '待定';
}

function genId() {
  return 'p_' + Math.random().toString(36).slice(2, 10);
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function makeMatch(phase, index, p1Id, p2Id, label) {
  return {
    id: `${phase}-${index}`,
    phase,
    label: label || '',
    p1Id: p1Id || null,
    p2Id: p2Id || null,
    winnerId: null,
    status: 'pending',
    scores: null,
    battles: null,
    liveScores: null,
  };
}

function buildBracketFromDraw(playerIds) {
  const shuffled = shuffle(playerIds);
  const matches = {};

  matches.prelim = [];
  for (let i = 0; i < shuffled.length; i += 2) {
    const idx = i / 2;
    matches.prelim.push(makeMatch('prelim', idx, shuffled[i], shuffled[i + 1] || null, `初賽 ${idx + 1}`));
  }

  matches.quarter = Array.from({ length: 4 }, (_, i) =>
    makeMatch('quarter', i, null, null, `複賽 ${i + 1}`)
  );

  matches.revival = [];
  matches.challenge = makeMatch('challenge', 0, null, null, '四強資格爭奪戰');

  matches.semi = [
    makeMatch('semi', 0, null, null, '準決賽 1'),
    makeMatch('semi', 1, null, null, '準決賽 2'),
  ];

  matches.final = makeMatch('final', 0, null, null, '總決賽（冠軍）');
  matches.bronze = makeMatch('final', 1, null, null, '季軍戰');

  return matches;
}

function setupRevivalBracket(eliminatedIds) {
  const shuffled = shuffle(eliminatedIds);
  const rev = [];
  for (let i = 0; i < shuffled.length; i += 2) {
    rev.push(makeMatch('revival', rev.length, shuffled[i], shuffled[i + 1] || null, `復活 R1-${Math.floor(i / 2) + 1}`));
  }
  rev.push(makeMatch('revival', rev.length, null, null, '復活 R2-1'));
  rev.push(makeMatch('revival', rev.length, null, null, '復活 R2-2'));
  rev.push(makeMatch('revival', rev.length, null, null, '逆轉小羊決賽'));
  tournamentState.matches.revival = rev;
}

function advanceRevival() {
  const rev = tournamentState.matches.revival;
  if (!rev || rev.length < 5) return;

  const r1 = rev.filter((m) => m.label.startsWith('復活 R1'));
  if (r1.length && r1.every((m) => m.status === 'done')) {
    const w = r1.map((m) => m.winnerId).filter(Boolean);
    const r2a = rev.find((m) => m.label === '復活 R2-1');
    const r2b = rev.find((m) => m.label === '復活 R2-2');
    if (r2a && w[0]) { r2a.p1Id = w[0]; r2a.p2Id = w[1] || null; }
    if (r2b && w[2]) { r2b.p1Id = w[2]; r2b.p2Id = w[3] || null; }
  }

  const r2 = rev.filter((m) => m.label.startsWith('復活 R2'));
  const final = rev.find((m) => m.label === '逆轉小羊決賽');
  if (r2.every((m) => m.status === 'done') && final) {
    const w = r2.map((m) => m.winnerId).filter(Boolean);
    final.p1Id = w[0] || null;
    final.p2Id = w[1] || null;
  }

  const revFinal = rev.find((m) => m.label === '逆轉小羊決賽');
  if (revFinal?.winnerId) {
    tournamentState.revivalWinnerId = revFinal.winnerId;
    if (tournamentState.matches.challenge) {
      tournamentState.matches.challenge.p1Id = revFinal.winnerId;
    }
  }
}

function advanceWinners() {
  const m = tournamentState.matches;
  if (!m.prelim) return;

  const prelimWinners = m.prelim.map((x) => x.winnerId).filter(Boolean);
  const prelimLosers = m.prelim
    .filter((x) => x.status === 'done' && x.winnerId)
    .map((x) => (x.winnerId === x.p1Id ? x.p2Id : x.p1Id))
    .filter(Boolean);

  for (let i = 0; i < 4; i++) {
    if (m.quarter[i]) {
      m.quarter[i].p1Id = prelimWinners[i * 2] || null;
      m.quarter[i].p2Id = prelimWinners[i * 2 + 1] || null;
      if (m.quarter[i].p1Id && !m.quarter[i].p2Id) {
        m.quarter[i].winnerId = m.quarter[i].p1Id;
        m.quarter[i].status = 'done';
      } else if (!m.quarter[i].p1Id && !m.quarter[i].p2Id) {
        m.quarter[i].status = 'pending';
        m.quarter[i].winnerId = null;
      }
    }
  }

  tournamentState.eliminatedIds = prelimLosers;
  if (prelimLosers.length >= 2 && m.prelim.every((x) => x.status === 'done')) {
    setupRevivalBracket(prelimLosers);
  }

  advanceRevival();

  const quarterWinners = m.quarter.map((x) => x.winnerId).filter(Boolean);
  if (quarterWinners.length >= 1 && m.semi) {
    m.semi[0].p1Id = quarterWinners[0] || null;
    m.semi[0].p2Id = quarterWinners[1] || null;
    m.semi[1].p1Id = quarterWinners[2] || null;
    m.semi[1].p2Id = quarterWinners[3] || null;
  }

  if (m.challenge?.status === 'done' && m.challenge.winnerId) {
    const topFour = m.quarter.map((x) => x.winnerId).filter(Boolean);
    const winner = m.challenge.winnerId;
    const loser = m.challenge.winnerId === m.challenge.p1Id ? m.challenge.p2Id : m.challenge.p1Id;
    if (topFour.includes(winner) && loser) {
      const qIdx = m.quarter.findIndex((q) => q.winnerId === loser);
      if (qIdx >= 0) m.quarter[qIdx].winnerId = winner;
    }
  }

  const semiWinners = m.semi?.map((x) => x.winnerId).filter(Boolean) || [];
  const semiLosers = m.semi
    ?.filter((x) => x.status === 'done' && x.winnerId)
    .map((x) => (x.winnerId === x.p1Id ? x.p2Id : x.p1Id))
    .filter(Boolean) || [];

  if (semiWinners.length >= 2 && m.final) {
    m.final.p1Id = semiWinners[0];
    m.final.p2Id = semiWinners[1];
  }
  if (semiLosers.length >= 2 && m.bronze) {
    m.bronze.p1Id = semiLosers[0];
    m.bronze.p2Id = semiLosers[1];
  }
}

function getAllMatchesFlat() {
  const m = tournamentState.matches;
  if (!m.prelim) return [];
  return [
    ...m.prelim,
    ...(m.quarter || []),
    ...(m.revival || []),
    ...(m.challenge ? [m.challenge] : []),
    ...(m.semi || []),
    ...(m.final ? [m.final] : []),
    ...(m.bronze ? [m.bronze] : []),
  ];
}

function findMatch(id) {
  return getAllMatchesFlat().find((x) => x.id === id);
}

function recordMatchWinner(matchId, winnerSide, result) {
  const match = findMatch(matchId);
  if (!match || match.status === 'done') return false;

  const winnerId = winnerSide === 1 ? match.p1Id : match.p2Id;
  if (!winnerId) return false;

  match.winnerId = winnerId;
  match.status = 'done';
  match.liveScores = null;
  if (result?.scores) {
    match.scores = [...result.scores];
    match.battles = result.battles ?? null;
  }
  advanceWinners();
  persistSession();
  renderTournamentUI();
  return true;
}

function formatMatchScore(match) {
  const scores = match.status === 'done' ? match.scores : match.liveScores;
  if (!scores) return '';
  return `${scores[0]} : ${scores[1]}`;
}

function updateTournamentLiveScores(scores, battles) {
  if (!tournamentState.activeMatchId) return;
  const match = findMatch(tournamentState.activeMatchId);
  if (!match || match.status === 'done') return;
  match.liveScores = [...scores];
  match.liveBattles = battles;
  renderTournamentUI({ scrollActive: false });
}

function setChallengeOpponent(quarterIndex) {
  const m = tournamentState.matches;
  if (!m.challenge || !tournamentState.revivalWinnerId) return;
  const q = m.quarter[quarterIndex];
  if (!q?.winnerId) {
    alert('該四強席位尚未產生');
    return;
  }
  m.challenge.p2Id = q.winnerId;
  m.challenge.p1Id = tournamentState.revivalWinnerId;
  m.challenge.status = 'pending';
  m.challenge.winnerId = null;
  persistSession();
  renderTournamentUI();
  addLog(`逆轉小羊挑戰：${playerName(m.challenge.p1Id)} vs ${playerName(m.challenge.p2Id)}`);
}

function addPlayer(name) {
  const trimmed = (name || '').trim();
  if (!trimmed) return false;
  if (tournamentState.players.length >= MAX_PLAYERS) {
    alert(`每場最多 ${MAX_PLAYERS} 人`);
    return false;
  }
  if (tournamentState.players.some((p) => p.name === trimmed)) return false;
  tournamentState.players.push({ id: genId(), name: trimmed });
  persistSession();
  renderRosterList();
  return true;
}

function removePlayer(id) {
  if (tournamentState.drawn && !confirm('已抽籤，刪除選手會影響賽程。確定？')) return;
  tournamentState.players = tournamentState.players.filter((p) => p.id !== id);
  persistSession();
  renderRosterList();
}

function importPlayersFromText(text) {
  const lines = text.split(/\n/).map((s) => s.trim()).filter(Boolean);
  let added = 0;
  lines.forEach((name) => {
    if (addPlayer(name)) added++;
  });
  return added;
}

function runDraw() {
  const ids = tournamentState.players.map((p) => p.id);
  if (ids.length < 2) {
    alert('至少需要 2 名選手');
    return;
  }
  if (tournamentState.drawn && !confirm('重新抽籤會覆蓋現有賽程，確定？')) return;

  tournamentState.matches = buildBracketFromDraw(ids);
  tournamentState.matches.prelim.forEach((m) => {
    if (m.p1Id && !m.p2Id) {
      m.winnerId = m.p1Id;
      m.status = 'done';
    }
  });
  tournamentState.drawn = true;
  tournamentState.eliminatedIds = [];
  tournamentState.revivalWinnerId = null;
  tournamentState.activeMatchId = null;
  advanceWinners();
  persistSession();
  renderTournamentUI();
  addLog(`抽籤完成 — ${ids.length} 名選手，${tournamentState.matches.prelim.length} 場初賽`);
  spawnConfetti(40);
}

function resetTournament() {
  if (!confirm('清除本場抽籤與賽程？（選手名單保留）')) return;
  tournamentState.drawn = false;
  tournamentState.matches = {};
  tournamentState.eliminatedIds = [];
  tournamentState.revivalWinnerId = null;
  tournamentState.activeMatchId = null;
  persistSession();
  renderTournamentUI();
}

function loadMatchToScoreboard(matchId) {
  const match = findMatch(matchId);
  if (!match) return;
  if (!match.p1Id && !match.p2Id) {
    alert('此對戰尚未確定選手');
    return;
  }
  if (match.status === 'done') {
    if (!confirm('此場已完成，仍要重新載入？')) return;
  }

  tournamentState.activeMatchId = matchId;
  nameEls[0].value = playerName(match.p1Id);
  nameEls[1].value = playerName(match.p2Id);

  const phaseSelect = $('#phase-select');
  if (phaseSelect && PHASE_LABELS[match.phase]) {
    phaseSelect.value = match.phase;
  }

  if (match.status === 'done' && match.scores) {
    loadMatchScores(match.scores, match.battles, true);
  } else {
    resetMatchScoresOnly();
    match.liveScores = [0, 0];
    match.liveBattles = 1;
  }

  renderTournamentUI();
  const scoreHint = match.scores ? ` · 戰績 <span class="log-score">${match.scores[0]} : ${match.scores[1]}</span>` : '';
  addLog(`── ${match.label} ──`, 'system', { type: 'log-section' });
  addLog(
    `${playerName(match.p1Id)} <span class="log-vs">vs</span> ${playerName(match.p2Id)}${scoreHint}`,
    'system',
    { type: 'log-section' }
  );
  if (typeof switchAppView === 'function') switchAppView('battle');
}

function resolveWinnerSide(match, winnerSide) {
  const n1 = nameEls[0].value.trim();
  const p1Name = playerName(match.p1Id);
  const p2Name = playerName(match.p2Id);
  if (n1 === p1Name) return 1;
  if (n1 === p2Name) return 2;
  return winnerSide;
}

function onTournamentMatchWin(winnerSide, result) {
  if (!tournamentState.activeMatchId) return;
  const match = findMatch(tournamentState.activeMatchId);
  if (!match) return;

  const side = resolveWinnerSide(match, winnerSide);
  const ok = recordMatchWinner(tournamentState.activeMatchId, side, result);
  if (ok) {
    const wName = playerName(side === 1 ? match.p1Id : match.p2Id);
    const lName = playerName(side === 1 ? match.p2Id : match.p1Id);
    const scores = result?.scores || match.scores || [0, 0];
    const battles = result?.battles ?? match.battles;
    const battleHint = battles ? ` · ${battles} 局` : '';
    addLog(
      `🏆 ${match.label} — <strong>${wName}</strong> 勝 <span class="log-score">${scores[0]} : ${scores[1]}</span>${battleHint}`,
      side,
      { type: 'log-result' }
    );
    addLog(`${wName} 晉級 · ${lName} 止步`, 'system');
    tournamentState.activeMatchId = null;
    renderTournamentUI();
  }
}

function renderRosterList() {
  const list = $('#roster-list');
  const count = $('#roster-count');
  if (!list) return;

  list.innerHTML = '';
  tournamentState.players.forEach((p, i) => {
    const li = document.createElement('li');
    li.className = 'roster-item';
    li.innerHTML = `
      <span class="roster-num">${i + 1}</span>
      <input type="text" class="roster-name-input" value="${escapeHtml(p.name)}" data-id="${p.id}" maxlength="16">
      <button type="button" class="btn-icon btn-remove-player" data-id="${p.id}" title="移除">×</button>
    `;
    list.appendChild(li);
  });

  if (count) count.textContent = `${tournamentState.players.length} / ${MAX_PLAYERS}`;

  list.querySelectorAll('.roster-name-input').forEach((input) => {
    input.addEventListener('change', () => {
      const p = tournamentState.players.find((x) => x.id === input.dataset.id);
      if (p) {
        p.name = input.value.trim() || p.name;
        persistSession();
      }
    });
  });

  list.querySelectorAll('.btn-remove-player').forEach((btn) => {
    btn.addEventListener('click', () => removePlayer(btn.dataset.id));
  });
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const PHASE_STYLES = {
  prelim: { title: '初賽', sub: '16 → 8', cls: 'phase-prelim' },
  quarter: { title: '複賽', sub: '8 → 4', cls: 'phase-quarter' },
  revival: { title: '復活賽', sub: '迷失小羊', cls: 'phase-revival' },
  challenge: { title: '四強爭奪', sub: '資格戰', cls: 'phase-challenge' },
  semi: { title: '準決賽', sub: '4 → 2', cls: 'phase-semi' },
  final: { title: '決賽', sub: '冠軍', cls: 'phase-final' },
};

function renderMatchCard(match) {
  const active = match.id === tournamentState.activeMatchId;
  const statusClass = match.status === 'done' ? 'done' : active ? 'active' : 'pending';
  const statusLabel = match.status === 'done' ? '完畢' : active ? '進行中' : '待賽';
  const p1Win = match.winnerId === match.p1Id;
  const p2Win = match.winnerId === match.p2Id;
  const canStart = match.p1Id || match.p2Id;
  const phaseCls = PHASE_STYLES[match.phase]?.cls || '';
  const displayScores = match.status === 'done' ? match.scores : active ? match.liveScores : null;
  const scoreText = formatMatchScore(match);
  const battleText = match.battles ? `${match.battles} 局` : active && match.liveBattles ? `${match.liveBattles} 局` : '';

  function slotClass(side, id, won, lost) {
    if (!id) return 'slot empty';
    if (won) return 'slot winner';
    if (lost) return 'slot loser';
    return 'slot';
  }

  function slotScore(idx) {
    if (!displayScores) return '';
    const cls = displayScores[idx] >= 4 ? 'slot-score win' : 'slot-score';
    return `<span class="${cls}">${displayScores[idx]}</span>`;
  }

  const btnLabel = active ? '▶ 進行中' : match.status === 'done' ? '重新載入' : '開始對戰';

  return `<li class="bracket-match ${statusClass} ${phaseCls}" data-match-id="${match.id}">
    <div class="bracket-match-head">
      <span class="bracket-label">${escapeHtml(match.label)}</span>
      <div class="bracket-match-meta">
        ${scoreText ? `<span class="bracket-score-badge">${scoreText}</span>` : ''}
        ${battleText && match.status === 'done' ? `<span class="bracket-battle-badge">${battleText}</span>` : ''}
        <span class="bracket-status-badge status-${statusClass}">${statusLabel}</span>
      </div>
    </div>
    <div class="bracket-slots">
      <div class="${slotClass(1, match.p1Id, p1Win, p2Win)}">
        <span class="slot-name">${escapeHtml(playerName(match.p1Id))}</span>
        <span class="slot-side-meta">
          ${slotScore(0)}
          ${p1Win ? '<span class="slot-crown" aria-hidden="true">👑</span>' : ''}
        </span>
      </div>
      <div class="slot-divider">${scoreText || 'VS'}</div>
      <div class="${slotClass(2, match.p2Id, p2Win, p1Win)}">
        <span class="slot-name">${escapeHtml(playerName(match.p2Id))}</span>
        <span class="slot-side-meta">
          ${slotScore(1)}
          ${p2Win ? '<span class="slot-crown" aria-hidden="true">👑</span>' : ''}
        </span>
      </div>
    </div>
    <button type="button" class="btn btn-sm ${active ? 'btn-primary' : 'btn-ghost'} btn-load-match" data-match-id="${match.id}"
      ${!canStart ? 'disabled' : ''}>${btnLabel}</button>
  </li>`;
}

function renderBracketColumn(phaseKey, matches) {
  if (!matches || (Array.isArray(matches) && matches.length === 0)) return '';
  const list = Array.isArray(matches) ? matches : [matches];
  const meta = PHASE_STYLES[phaseKey] || { title: phaseKey, sub: '', cls: '' };
  const done = list.filter((m) => m.status === 'done').length;

  return `<div class="bracket-column ${meta.cls}">
    <div class="bracket-column-head">
      <h3 class="bracket-column-title">${meta.title}</h3>
      <span class="bracket-column-sub">${meta.sub}</span>
      <span class="bracket-column-progress">${done}/${list.length}</span>
    </div>
    <ul class="bracket-matches">${list.map(renderMatchCard).join('')}</ul>
  </div>`;
}

function renderBracketSummary() {
  const all = getAllMatchesFlat().filter((m) => m.p1Id || m.p2Id);
  const done = all.filter((m) => m.status === 'done').length;
  const active = tournamentState.activeMatchId ? 1 : 0;
  const ready = all.filter((m) => m.status === 'pending' && m.p1Id && m.p2Id).length;
  const pct = all.length ? Math.round((done / all.length) * 100) : 0;

  let nextHint = '';
  const next = all.find((m) => m.status === 'pending' && m.p1Id && m.p2Id);
  if (next) {
    nextHint = `<p class="bracket-next-hint">下一場：<button type="button" class="bracket-next-link" data-match-id="${next.id}"><strong>${escapeHtml(next.label)}</strong> — ${escapeHtml(playerName(next.p1Id))} vs ${escapeHtml(playerName(next.p2Id))}</button></p>`;
  } else if (done === all.length && all.length > 0) {
    nextHint = '<p class="bracket-next-hint done-all">本場賽程已全部完成 🏆</p>';
  }

  return `<div class="bracket-summary">
    <div class="bracket-summary-stats">
      <div class="bracket-stat"><span class="bracket-stat-num">${done}</span><span class="bracket-stat-label">已完成</span></div>
      <div class="bracket-stat"><span class="bracket-stat-num">${ready}</span><span class="bracket-stat-label">可開賽</span></div>
      <div class="bracket-stat"><span class="bracket-stat-num">${active}</span><span class="bracket-stat-label">進行中</span></div>
    </div>
    <div class="bracket-progress-bar" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100">
      <div class="bracket-progress-fill" style="width:${pct}%"></div>
    </div>
    ${nextHint}
  </div>`;
}

function renderChallengePicker() {
  const m = tournamentState.matches;
  if (!m.challenge || !tournamentState.revivalWinnerId) return '';

  const options = (m.quarter || [])
    .map((q, i) => q.winnerId ? `<button type="button" class="btn btn-sm btn-ghost btn-pick-challenge" data-q="${i}">挑戰 ${playerName(q.winnerId)}</button>` : '')
    .filter(Boolean)
    .join(' ');

  if (!options) return '<p class="cam-hint">複賽完成後，可為逆轉小羊抽選四強對手</p>';

  return `<div class="challenge-picker">
    <p>逆轉小羊 <strong>${playerName(tournamentState.revivalWinnerId)}</strong> 抽籤挑戰：</p>
    <div class="challenge-btns">${options}</div>
  </div>`;
}

function renderTournamentUI(options = {}) {
  const { scrollActive = true } = options;
  renderRosterList();

  const bracket = $('#bracket-view');
  const drawBadge = $('#draw-status');
  if (drawBadge) {
    drawBadge.textContent = tournamentState.drawn ? '已抽籤' : '未抽籤';
    drawBadge.className = 'draw-badge ' + (tournamentState.drawn ? 'drawn' : '');
  }

  if (!bracket) return;

  if (!tournamentState.drawn || !tournamentState.matches.prelim) {
    bracket.innerHTML = '<p class="bracket-empty">加入選手後按「抽籤配對」產生賽程表</p>';
    return;
  }

  const m = tournamentState.matches;
  const finals = [m.final, m.bronze].filter(Boolean);

  bracket.innerHTML =
    renderBracketSummary() +
    '<div class="bracket-board">' +
    renderBracketColumn('prelim', m.prelim) +
    renderBracketColumn('quarter', m.quarter) +
    renderBracketColumn('semi', m.semi) +
    renderBracketColumn('final', finals) +
    '</div>' +
    '<div class="bracket-extra">' +
    (m.revival?.length ? `<div class="bracket-extra-block">${renderBracketColumn('revival', m.revival)}</div>` : '') +
    (m.challenge ? `<div class="bracket-extra-block">${renderBracketColumn('challenge', m.challenge)}${renderChallengePicker()}</div>` : '') +
    '</div>';

  bracket.querySelectorAll('.btn-load-match').forEach((btn) => {
    btn.addEventListener('click', () => loadMatchToScoreboard(btn.dataset.matchId));
  });

  bracket.querySelectorAll('.bracket-next-link').forEach((btn) => {
    btn.addEventListener('click', () => loadMatchToScoreboard(btn.dataset.matchId));
  });

  bracket.querySelectorAll('.btn-pick-challenge').forEach((btn) => {
    btn.addEventListener('click', () => setChallengeOpponent(parseInt(btn.dataset.q, 10)));
  });

  const activeEl = bracket.querySelector('.bracket-match.active');
  if (activeEl && scrollActive) {
    activeEl.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
  }
}

function initTournament() {
  const sessionSelect = $('#session-select');
  loadSession(sessionSelect?.value || 'junior');

  sessionSelect?.addEventListener('change', () => {
    loadSession(sessionSelect.value);
  });

  $('#btn-add-player')?.addEventListener('click', () => {
    const input = $('#new-player-name');
    if (addPlayer(input?.value)) input.value = '';
  });

  $('#new-player-name')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      $('#btn-add-player')?.click();
    }
  });

  $('#btn-import-players')?.addEventListener('click', () => {
    const ta = $('#bulk-players');
    const n = importPlayersFromText(ta?.value || '');
    if (ta) ta.value = '';
    addLog(`批量加入 ${n} 名選手`);
    renderRosterList();
  });

  $('#btn-draw')?.addEventListener('click', runDraw);
  $('#btn-reset-bracket')?.addEventListener('click', resetTournament);
}
