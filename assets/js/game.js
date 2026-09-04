(function() {

/* ============================================
   Snakes & Ladders — Game Logic (ES6 Modular)
   ============================================ */

const CONFIG = {
  API_BASE: 'api',
  SAVE_INTERVAL: 5000,
  LS_KEY: 'snl_last_match_id'
};

const BASE_SNAKES = { 98: 37, 95: 56, 89: 53, 74: 47, 62: 19, 54: 34, 17: 4 };
const BASE_LADDERS = { 3: 20, 8: 29, 20: 41, 27: 56, 39: 63, 47: 68, 63: 81, 71: 91 };
const TEAM_COLORS = ['#d44a3e', '#3a8bc4', '#e8a93a', '#5a9e6f', '#9a5bc4', '#c46b9a', '#4c7bd9', '#c48b3b'];
const MODES = [
  { id: 'classic', name: 'Classic', desc: 'Standard rules — visible board, roll and move, ladder/snake challenges.' },
  { id: 'shadow', name: 'The Shadow Grid', desc: 'Board starts blank. Snakes, ladders, and trapdoors are only revealed once a team actually lands on them — the host holds the master key.' },
  { id: 'draft', name: 'Draft & Trade', desc: 'Each team starts with a Deflector Shield, Ladder Sabotage, Swapper, and a Loaded Die charge to use strategically.' },
  { id: 'gravity', name: 'Audience-Driven Gravity', desc: 'Every 3 turns, the host reads out the crowd\'s poll result and applies a Board Shift: Invert Gravity, Quicksand, or Bounty.' }
];

/* ---------- STATE ---------- */
let state = freshState();
let leaderboard = {};

function freshState() {
  return {
    teams: [],
    turnIndex: 0,
    started: false,
    finished: false,
    history: [],
    log: [],
    mode: 'classic',
    revealed: {},
    brokenLadders: {},
    gravity: { turnsSinceShift: 0, invert: false, invertTurnsLeft: 0, quicksand: [], quicksandTurnsLeft: 0, bounty: null, frozen: {} }
  };
}
let pendingChallenge = null;
let timerInterval = null;
let undoStack = [];
let armedLoadedDie = null;
let soundEnabled = true;
let audioCtx = null;
let currentMatchId = null;
let saveTimer = null;

/* ---------- DOM REFS ---------- */
const $ = (id) => document.getElementById(id);
const boardEl = $('board');
const overlayEl = $('overlay');
const teamListEl = $('teamList');
const logListEl = $('logList');
const dieBig = $('dieBig');
const btnRoll = $('btnRoll');
let isRolling = false;

/* ---------- 3D DICE ---------- */
let diceEl = null;
let diceFace = 1;
function buildDice() {
  const wrap = document.createElement('div');
  wrap.className = 'dice-3d-wrap';
  const inner = document.createElement('div');
  inner.className = 'dice-3d';
  for (let f = 1; f <= 6; f++) {
    const face = document.createElement('div');
    face.className = 'face show-' + f;
    for (let p = 0; p < f; p++) {
      const pip = document.createElement('i');
      face.appendChild(pip);
    }
    inner.appendChild(face);
  }
  wrap.append(inner);
  diceEl = inner;
  // Replace legacy dieBig
  if (dieBig && dieBig.parentNode) {
    dieBig.style.display = 'none';
    dieBig.parentNode.insertBefore(wrap, dieBig);
  }
  rotateDiceTo(1);
}
function rotateDiceTo(n) {
  diceFace = n;
  if (!diceEl) return;
  const rot = {
    1: 'rotateX(0deg) rotateY(0deg)',
    2: 'rotateX(180deg) rotateY(0deg)',
    3: 'rotateX(0deg) rotateY(-90deg)',
    4: 'rotateX(0deg) rotateY(90deg)',
    5: 'rotateX(-90deg) rotateY(0deg)',
    6: 'rotateX(90deg) rotateY(0deg)'
  };
  diceEl.style.transform = rot[n];
}

/* ============================================
   API INTEGRATION
   ============================================ */
async function apiLoad() {
  try {
    const res = await fetch(`${CONFIG.API_BASE}/load_game.php`, { credentials: 'same-origin' });
    const data = await res.json();
    if (data.success && data.match) {
      currentMatchId = data.match.id;
      state = data.state || freshState();
    } else {
      state = freshState();
    }
  } catch (e) {
    console.warn('Failed to load from server, using defaults:', e);
    state = freshState();
  }
}

function slHeaders() {
  return {
    'Content-Type': 'application/json'
  };
}
function slHandle401(res) {
  return false;
}

async function apiSave(status = 'live') {
  if (!currentMatchId && state.started) {
    await apiCreateMatch(status);
    return;
  }
  if (!currentMatchId) return;

  try {
    const payload = { match_id: currentMatchId, mode: state.mode, player_count: state.teams.length, state: state, status: status };
    const res = await fetch(`${CONFIG.API_BASE}/save_game.php`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: slHeaders(),
      body: JSON.stringify(payload)
    });
    if (slHandle401(res)) return;
    const data = await res.json();
    if (data.success && data.match_id) currentMatchId = data.match_id;
  } catch (e) {
    console.warn('Auto-save failed:', e);
  }
}

async function apiCreateMatch(status = 'live') {
  try {
    const payload = { mode: state.mode, player_count: state.teams.length, state: state, status: status };
    const res = await fetch(`${CONFIG.API_BASE}/save_game.php`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: slHeaders(),
      body: JSON.stringify(payload)
    });
    if (slHandle401(res)) return;
    const data = await res.json();
    if (data.success && data.match_id) currentMatchId = data.match_id;
  } catch (e) {
    console.warn('Failed to create match:', e);
  }
}

async function apiLoadLeaderboard() {
  try {
    const res = await fetch(`${CONFIG.API_BASE}/leaderboard.php`, { credentials: 'same-origin' });
    const data = await res.json();
    if (data.success) {
      leaderboard = {};
      data.leaderboard.forEach(row => {
        leaderboard[row.name] = { wins: row.wins, losses: row.losses, matches: row.total_matches };
      });
    }
  } catch (e) {
    console.warn('Failed to load leaderboard:', e);
  }
}

function startAutoSave() {
  if (saveTimer) clearInterval(saveTimer);
  saveTimer = setInterval(() => {
    if (state.started && !state.finished) {
      apiSave('live');
    }
  }, CONFIG.SAVE_INTERVAL);
}

/* ============================================
   BOARD GEOMETRY
   ============================================ */
function squareToRC(n) {
  const row = Math.floor((n - 1) / 10);
  let col = (n - 1) % 10;
  if (row % 2 === 1) col = 9 - col;
  return { row, col };
}

function squareCenterPct(n) {
  const { row, col } = squareToRC(n);
  const gridRowFromTop = 9 - row;
  const x = (col + 0.5) * 10;
  const y = (gridRowFromTop + 0.5) * 10;
  return { x, y };
}

/* ---------- BUILD BOARD ---------- */
function buildBoard() {
  boardEl.innerHTML = '';
  for (let gridRow = 1; gridRow <= 10; gridRow++) {
    for (let gridCol = 1; gridCol <= 10; gridCol++) {
      const rowFromBottom = 10 - gridRow;
      let colIdx = gridCol - 1;
      if (rowFromBottom % 2 === 1) colIdx = 9 - colIdx;
      const n = rowFromBottom * 10 + colIdx + 1;
      const div = document.createElement('div');
      div.className = 'cell' + (n === 100 ? ' finish' : '') + ((gridRow + gridCol) % 2 === 0 ? ' alt' : '');
      div.style.gridRow = gridRow;
      div.style.gridColumn = gridCol;
      div.textContent = n;
      div.dataset.square = n;
      boardEl.appendChild(div);
    }
  }
  drawOverlay();
}

/* ---------- DRAW OVERLAY ---------- */
function drawOverlay() {
  let svg = `<defs><marker id="arrowLadder" markerWidth="6" markerHeight="6" refX="3" refY="3" orient="auto"><circle cx="3" cy="3" r="3" fill="var(--ladder)"/></marker></defs>`;
  const ladders = activeLadders();
  const snakes = activeSnakes();
  const shadow = state.mode === 'shadow';

  Object.entries(ladders).forEach(([from, to]) => {
    if (shadow && !state.revealed[from]) return;
    const a = squareCenterPct(+from);
    const b = squareCenterPct(+to);
    svg += ladderRungs(a, b);
  });
  Object.entries(snakes).forEach(([from, to]) => {
    if (shadow && !state.revealed[from]) return;
    const a = squareCenterPct(+from);
    const b = squareCenterPct(+to);
    svg += snakeCurve(a, b);
  });
  overlayEl.innerHTML = svg;

  document.querySelectorAll('.badge').forEach(b => b.remove());
  document.querySelectorAll('.cell').forEach(c => { c.style.background = ''; c.classList.remove('frozen'); });

  Object.entries(ladders).forEach(([from, to]) => {
    if (shadow && !state.revealed[from]) return;
    tagCell(from, 'ladder', '?');
  });
  Object.entries(snakes).forEach(([from, to]) => {
    if (shadow && !state.revealed[from]) return;
    tagCell(from, 'snake', '?');
  });

  if (state.mode === 'gravity' && state.gravity.quicksand.length) {
    state.gravity.quicksand.forEach(sq => {
      const cell = boardEl.querySelector(`.cell[data-square="${sq}"]`);
      if (cell) cell.style.background = 'rgba(226,166,59,0.22)';
    });
  }
  if (state.mode === 'gravity' && state.gravity.bounty) {
    const cell = boardEl.querySelector(`.cell[data-square="${state.gravity.bounty}"]`);
    if (cell) {
      const b = document.createElement('span');
      b.className = 'badge ladder';
      b.textContent = '?';
      b.style.right = '3px';
      b.style.bottom = '3px';
      b.style.left = 'auto';
      cell.appendChild(b);
    }
  }
  if (state.mode === 'gravity') {
    Object.keys(state.gravity.frozen).forEach(teamId => {
      const t = state.teams.find(t => t.id === teamId);
      if (t && t.pos) {
        const cell = boardEl.querySelector(`.cell[data-square="${t.pos}"]`);
        if (cell) cell.classList.add('frozen');
      }
    });
  }
}

function tagCell(sq, type, icon) {
  const cell = boardEl.querySelector(`.cell[data-square="${sq}"]`);
  if (!cell) return;
  const b = document.createElement('span');
  b.className = 'badge ' + type;
  b.textContent = icon;
  b.style.left = '3px';
  b.style.bottom = '3px';
  cell.appendChild(b);
}

function ladderRungs(a, b) {
  const x1 = a.x * 10, y1 = a.y * 10, x2 = b.x * 10, y2 = b.y * 10;
  const dx = x2 - x1, dy = y2 - y1;
  const len = Math.hypot(dx, dy);
  const nx = -dy / len, ny = dx / len;
  const off = 10;
  const rail1 = [x1 + nx * off, y1 + ny * off, x2 + nx * off, y2 + ny * off];
  const rail2 = [x1 - nx * off, y1 - ny * off, x2 - nx * off, y2 - ny * off];
  let rungs = '';
  const steps = Math.max(3, Math.floor(len / 28));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const rx1 = rail1[0] + (rail1[2] - rail1[0]) * t, ry1 = rail1[1] + (rail1[3] - rail1[1]) * t;
    const rx2 = rail2[0] + (rail2[2] - rail2[0]) * t, ry2 = rail2[1] + (rail2[3] - rail2[1]) * t;
    rungs += `<line x1="${rx1}" y1="${ry1}" x2="${rx2}" y2="${ry2}" stroke="var(--ladder)" stroke-width="2.4" opacity="0.85"/>`;
  }
  return `<line x1="${rail1[0]}" y1="${rail1[1]}" x2="${rail1[2]}" y2="${rail1[3]}" stroke="var(--ladder)" stroke-width="3.4" opacity="0.9"/>
          <line x1="${rail2[0]}" y1="${rail2[1]}" x2="${rail2[2]}" y2="${rail2[3]}" stroke="var(--ladder)" stroke-width="3.4" opacity="0.9"/>
          ${rungs}
          <circle cx="${x1}" cy="${y1}" r="6" fill="var(--ladder)"/>
          <circle cx="${x2}" cy="${y2}" r="6" fill="var(--ladder)"/>`;
}

function snakeCurve(a, b) {
  const x1 = a.x * 10, y1 = a.y * 10, x2 = b.x * 10, y2 = b.y * 10;
  const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
  const dx = x2 - x1, dy = y2 - y1;
  const len = Math.hypot(dx, dy);
  const nx = -dy / len, ny = dx / len;
  const bow = Math.min(70, len * 0.35);
  const c1x = mx + nx * bow, c1y = my + ny * bow;
  return `<path d="M ${x1} ${y1} Q ${c1x} ${c1y} ${x2} ${y2}" stroke="var(--snake)" stroke-width="6" fill="none" stroke-linecap="round" opacity="0.88"/>
          <circle cx="${x1}" cy="${y1}" r="9" fill="var(--snake)"/>
          <circle cx="${x2}" cy="${y2}" r="5.5" fill="var(--snake)" opacity="0.8"/>`;
}

/* ============================================
   PAWNS
   ============================================ */
function renderPawns() {
  document.querySelectorAll('.pawn').forEach(p => p.remove());
  const holder = $('boardHolder');
  const activeTeams = state.teams.filter(t => t.active);
  const bySquare = {};
  activeTeams.forEach(t => { (bySquare[t.pos] = bySquare[t.pos] || []).push(t); });
  const cur = currentTeam();
  Object.entries(bySquare).forEach(([sq, teams]) => {
    teams.forEach((t, i) => {
      const { x, y } = squareCenterPct(Math.max(1, t.pos));
      const spread = teams.length > 1 ? (i - (teams.length - 1) / 2) * 3.2 : 0;
      const pawn = document.createElement('div');
      pawn.className = 'pawn' + (cur && cur.id === t.id ? ' is-active' : '');
      pawn.dataset.teamId = t.id;
      pawn.style.background = t.color;
      pawn.style.color = t.color;
      pawn.style.left = `calc(${x + spread}% - 2.8%)`;
      pawn.style.top = `calc(${y}% - 2.8%)`;
      pawn.style.setProperty('--currentColor', t.color);
      pawn.title = t.name;
      holder.appendChild(pawn);
    });
  });
}

/* ============================================
   TEAMS UI
   ============================================ */
function renderTeams() {
  teamListEl.innerHTML = '';
  if (state.teams.length === 0) {
    teamListEl.innerHTML = `<div class="empty-note">No teams yet. Add at least two to start the match.</div>`;
  }
  state.teams.forEach(t => {
    const row = document.createElement('div');
    row.className = 'team-row';
    const isFrozen = state.mode === 'gravity' && state.gravity.frozen[t.id];
    row.innerHTML = `
      <span class="swatch" style="background:${t.color}"></span>
      <input type="text" value="${escapeHtml(t.name)}" data-id="${t.id}" ${state.started ? 'disabled' : ''}>
      <span class="pos">sq ${t.pos}</span>
      ${isFrozen ? '<span class="frozen-badge" title="Frozen in quicksand">??</span>' : ''}
      ${state.started ? '' : `<button class="rm" data-id="${t.id}" title="Remove team">?</button>`}
    `;
    teamListEl.appendChild(row);
  });
  teamListEl.querySelectorAll('input[type=text]').forEach(inp => {
    inp.addEventListener('change', e => {
      const id = e.target.dataset.id;
      const team = state.teams.find(t => t.id === id);
      if (team) { team.name = e.target.value.trim() || team.name; saveState(); renderTurnBanner(); }
    });
  });
  teamListEl.querySelectorAll('.rm').forEach(btn => {
    btn.addEventListener('click', e => {
      const id = e.target.dataset.id;
      state.teams = state.teams.filter(t => t.id !== id);
      saveState(); renderTeams(); renderPawns();
    });
  });
}

function escapeHtml(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

function addTeam(name) {
  if (!name) return toast('Enter a team name first.');
  if (state.started) return toast('Match already in progress — reset to add teams.');
  const color = TEAM_COLORS[state.teams.length % TEAM_COLORS.length];
  state.teams.push({
    id: crypto.randomUUID(), name, color, pos: 1, active: true,
    inventory: { shield: 1, sabotage: 1, swapper: 1, loadedDie: 1 },
    shieldArmed: false
  });
  saveState(); renderTeams(); renderPawns(); renderTurnBanner();
}

function startMatch() {
  if (state.teams.length < 2) return toast('Add at least two teams to start.');
  state.started = true;
  state.finished = false;
  state.turnIndex = 0;
  state.teams.forEach(t => {
    t.pos = 1; t.active = true;
    t.inventory = { shield: 1, sabotage: 1, swapper: 1, loadedDie: 1 };
    t.shieldArmed = false;
  });
  state.history = [];
  state.log = [];
  state.revealed = {};
  state.brokenLadders = {};
  state.gravity = { turnsSinceShift: 0, invert: false, invertTurnsLeft: 0, quicksand: [], quicksandTurnsLeft: 0, bounty: null, frozen: {} };
  undoStack = [];
  armedLoadedDie = null;
  saveState();
  buildBoard();
  renderAll();
  apiCreateMatch('live');
  playSound('start');
  toast(`Match started in ${MODES.find(m => m.id === state.mode).name} mode. Good luck!`);
}

/* ============================================
   GAME MODE
   ============================================ */
function renderModeSelector() {
  const modeListEl = $('modeList');
  modeListEl.innerHTML = MODES.map(m => `
    <label class="mode-opt ${state.mode === m.id ? 'active' : ''} ${state.started ? 'disabledOpt' : ''}">
      <input type="radio" name="mode" value="${m.id}" ${state.mode === m.id ? 'checked' : ''} ${state.started ? 'disabled' : ''}>
      <span>${m.name}<br><small>${m.desc}</small></span>
    </label>
  `).join('');
  $('modeDesc').textContent = MODES.find(m => m.id === state.mode).desc;
  modeListEl.querySelectorAll('input[name=mode]').forEach(r => {
    r.addEventListener('change', e => {
      if (state.started) return;
      state.mode = e.target.value;
      saveState(); renderModeSelector(); renderModePanels(); buildBoard();
    });
  });
  const shadowPanel = $('shadowPanel');
  const draftPanel = $('draftPanel');
  const gravityPanel = $('gravityPanel');
  if (shadowPanel) shadowPanel.style.display = state.mode === 'shadow' ? '' : 'none';
  if (draftPanel) draftPanel.style.display = state.mode === 'draft' ? '' : 'none';
  if (gravityPanel) gravityPanel.style.display = state.mode === 'gravity' ? '' : 'none';
}

function renderModePanels() {
  const shadowPanel = $('shadowPanel');
  const draftPanel = $('draftPanel');
  const gravityPanel = $('gravityPanel');
  if (shadowPanel) shadowPanel.style.display = state.mode === 'shadow' ? '' : 'none';
  if (draftPanel) draftPanel.style.display = state.mode === 'draft' ? '' : 'none';
  if (gravityPanel) gravityPanel.style.display = state.mode === 'gravity' ? '' : 'none';
  if (state.mode === 'shadow' && shadowPanel) renderMasterKey();
  if (state.mode === 'draft' && draftPanel) renderDraftPanel();
  if (state.mode === 'gravity' && gravityPanel) renderGravityPanel();
}

/* --- Shadow Grid --- */
function renderMasterKey() {
  const el = $('masterKey');
  const ladders = Object.entries(activeLadders()).map(([f, t]) => `<div class="k-ladder">? ${f} ? ${t}</div>`).join('');
  const snakes = Object.entries(activeSnakes()).map(([f, t]) => `<div class="k-snake">? ${f} ? ${t}</div>`).join('');
  el.innerHTML = ladders + snakes;
}

/* --- Draft & Trade --- */
function renderDraftPanel() {
  const team = currentTeam();
  $('draftTeamName').textContent = team ? team.name : '—';
  const itemsEl = $('draftItems');
  if (!team) { itemsEl.innerHTML = `<div class="empty-note">Start the match to see inventory.</div>`; return; }
  const inv = team.inventory;
  itemsEl.innerHTML = `
    <div class="item-row"><span>??? Deflector Shield ${team.shieldArmed ? '<b style="color:var(--amber)">(armed)</b>' : ''}</span><span class="qty">${inv.shield}</span></div>
    <div class="item-row"><span>?? Ladder Sabotage</span><span class="qty">${inv.sabotage}</span></div>
    <div class="item-row"><span>?? Swapper</span><span class="qty">${inv.swapper}</span></div>
    <div class="item-row" style="flex-wrap:wrap;gap:8px;">
      <button class="btn small" id="btnUseShield" ${inv.shield < 1 || team.shieldArmed ? 'disabled' : ''}>Arm shield</button>
      <button class="btn small" id="btnUseSabotage" ${inv.sabotage < 1 ? 'disabled' : ''}>Sabotage a ladder</button>
      <button class="btn small" id="btnUseSwapper" ${inv.swapper < 1 ? 'disabled' : ''}>Swap with team</button>
    </div>
  `;
  const b1 = $('btnUseShield');
  if (b1) b1.addEventListener('click', () => {
    team.inventory.shield -= 1; team.shieldArmed = true;
    logEntry(`<b>${team.name}</b> armed a Deflector Shield.`, 'move');
    saveState(); renderDraftPanel(); renderTeams();
  });
  const b2 = $('btnUseSabotage');
  if (b2) b2.addEventListener('click', () => {
    const ladders = Object.keys(activeLadders()).filter(sq => !state.brokenLadders[sq]);
    if (ladders.length === 0) return toast("No un-sabotaged ladders left.");
    showPrompt('Sabotage a ladder', 'Choose which ladder to sabotage:', ladders.map(sq => ({
      label: `Square ${sq} ? ${activeLadders()[sq]}`,
      detail: `Next team to land here won't climb`,
      value: sq
    })), choice => {
      if (!choice) return;
      team.inventory.sabotage -= 1;
      state.brokenLadders[choice] = true;
      logEntry(`<b>${team.name}</b> sabotaged the ladder at ${choice} — next team to land there won't climb.`, 'ladder');
      saveState(); renderDraftPanel(); renderTeams();
    });
  });
  const b3 = $('btnUseSwapper');
  if (b3) b3.addEventListener('click', () => {
    const targets = state.teams.filter(t => t.active && t.id !== team.id && Math.abs(t.pos - team.pos) <= 5);
    if (targets.length === 0) return toast("No team within 5 squares to swap with.");
    showPrompt('Swap positions', 'Choose a team to swap with:', targets.map(t => ({
      label: t.name,
      detail: `Currently on square ${t.pos}`,
      value: t.id
    })), choice => {
      if (!choice) return;
      const target = state.teams.find(t => t.id === choice);
      if (!target) return;
      const p1 = team.pos, p2 = target.pos;
      team.pos = p2; target.pos = p1;
      team.inventory.swapper -= 1;
      logEntry(`<b>${team.name}</b> swapped positions with <b>${target.name}</b> (${p1} ? ${p2}).`, 'move');
      saveState(); renderDraftPanel(); renderTeams(); renderPawns();
    });
  });
}

function armLoadedDie(range) {
  const team = currentTeam();
  if (!team) return;
  if (team.inventory.loadedDie < 1) return toast("No Loaded Die charges left.");
  armedLoadedDie = range;
  $('loadedStatus').textContent = `Loaded die armed: ${range === 'low' ? '1–3' : '4–6'} for ${team.name}'s next roll.`;
  toast(`Loaded die armed (${range === 'low' ? '1–3' : '4–6'}) for ${team.name}.`);
}

/* --- Audience-Driven Gravity --- */
function applyShift(type) {
  const g = state.gravity;
  if (type === 'invert') {
    g.invert = true; g.invertTurnsLeft = 3;
    logEntry(`?? Audience vote: <b>Invert Gravity</b> — all snakes and ladders swap for the next 3 turns!`, 'win');
    const holder = $('boardHolder');
    if (holder) {
      holder.classList.add('flip');
      setTimeout(() => holder.classList.remove('flip'), 1200);
    }
  } else if (type === 'quicksand') {
    const all = Array.from({ length: 97 }, (_, i) => i + 2);
    const picks = [];
    while (picks.length < 3 && all.length) {
      const idx = Math.floor(Math.random() * all.length);
      picks.push(all.splice(idx, 1)[0]);
    }
    g.quicksand = picks; g.quicksandTurnsLeft = 3;
    logEntry(`?? Audience vote: <b>Quicksand</b> — squares ${picks.join(', ')} freeze whoever lands there for one turn!`, 'win');
  } else if (type === 'bounty') {
    g.bounty = 50;
    logEntry(`? Audience vote: <b>Bounty</b> — first team to land exactly on square 50 gets a double move!`, 'win');
  }
  g.turnsSinceShift = 0;
  saveState(); buildBoard(); renderAll();
}

function renderGravityPanel() {
  const g = state.gravity;
  const remaining = Math.max(0, 3 - g.turnsSinceShift);
  const ready = state.started && !state.finished && remaining === 0;
  const shiftStatus = $('shiftStatus');
  if (shiftStatus) shiftStatus.textContent = ready
    ? "Board Shift ready — read out the crowd's poll result and pick the outcome."
    : `Board Shift available in ${remaining} turn${remaining === 1 ? '' : 's'}.`;
  const btnInvert = $('btnInvert');
  const btnQuicksand = $('btnQuicksand');
  const btnBounty = $('btnBounty');
  if (btnInvert) btnInvert.disabled = !ready;
  if (btnQuicksand) btnQuicksand.disabled = !ready;
  if (btnBounty) btnBounty.disabled = !ready;
  const activeModifiers = $('activeModifiers');
  const mods = [];
  if (g.invert) mods.push(`Gravity inverted (${g.invertTurnsLeft} turn${g.invertTurnsLeft === 1 ? '' : 's'} left)`);
  if (g.quicksand.length) mods.push(`Quicksand on ${g.quicksand.join(', ')} (${g.quicksandTurnsLeft} turn${g.quicksandTurnsLeft === 1 ? '' : 's'} left)`);
  if (g.bounty) mods.push(`Bounty active on square ${g.bounty}`);
  if (activeModifiers) activeModifiers.textContent = mods.length ? mods.join(' · ') : 'No active modifiers.';
}

/* ============================================
   TURN BANNER
   ============================================ */
function currentTeam() {
  const active = state.teams.filter(t => t.active);
  if (active.length === 0) return null;
  return active[state.turnIndex % active.length];
}

function renderTurnBanner() {
  const swatch = $('turnSwatch');
  const nameEl = $('turnName');
  if (!state.started || state.finished) {
    swatch.style.background = '#555';
    nameEl.textContent = state.finished ? 'Match finished' : 'Not started';
    return;
  }
  const t = currentTeam();
  if (!t) { swatch.style.background = '#555'; nameEl.textContent = '—'; return; }
  swatch.style.background = t.color;
  nameEl.textContent = t.name;
}

/* ============================================
   DICE & MOVEMENT
   ============================================ */
btnRoll.addEventListener('click', () => doRoll());

function doRoll() {
  if (isRolling) return;
  if (!state.started || state.finished) return toast('Start the match first.');
  const team = currentTeam();
  if (!team) return toast('No team available.');
  if (state.mode === 'gravity' && state.gravity.frozen[team.id]) {
    delete state.gravity.frozen[team.id];
    logEntry(`<b>${team.name}</b> is frozen and skips this turn.`, 'move');
    advanceTurn(); saveState(); renderAll(); resetDice(); apiSave('live');
    return;
  }

  isRolling = true;
  btnRoll.disabled = true;
  const mob = $('btnRollMobile'); if (mob) mob.disabled = true;
  if (diceEl) diceEl.classList.add('rolling');
  playSound('roll');

  const range = (state.mode === 'draft' && armedLoadedDie) ? armedLoadedDie : null;
  const min = range === 'low' ? 1 : (range === 'high' ? 4 : 1);
  const max = range === 'low' ? 3 : (range === 'high' ? 6 : 6);

  let ticks = 0;
  const spin = setInterval(() => {
    const f = min + Math.floor(Math.random() * (max - min + 1));
    rotateDiceTo(f);
    ticks++;
    if (ticks > 16) {
      clearInterval(spin);
      const finalRoll = min + Math.floor(Math.random() * (max - min + 1));
      rotateDiceTo(finalRoll);
      if (diceEl) {
        diceEl.classList.remove('rolling');
        diceEl.classList.add('landed');
        setTimeout(() => diceEl.classList.remove('landed'), 450);
      }
      isRolling = false;
      if (range && team) {
        team.inventory.loadedDie -= 1;
        logEntry(`<b>${team.name}</b> used a Loaded Die (${range === 'low' ? '1–3' : '4–6'}).`, 'move');
        armedLoadedDie = null;
        $('loadedStatus').textContent = '';
        playSound('powerup');
      }
      processMove(finalRoll);
    }
  }, 60);
}

$('btnUndo').addEventListener('click', undoLast);

function processMove(steps) {
  if (!state.started || state.finished) { btnRoll.disabled = false; return; }
  const team = currentTeam();
  if (!team) { btnRoll.disabled = false; return; }

  const from = team.pos;
  let to = from + steps;
  let overflow = false;
  if (to > 100) { to = from; overflow = true; }

  undoStack.push(JSON.parse(JSON.stringify({ teams: state.teams, turnIndex: state.turnIndex, history: state.history, log: state.log, mode: state.mode, revealed: state.revealed, brokenLadders: state.brokenLadders, gravity: state.gravity })));

  if (overflow) {
    const entry = { teamId: team.id, teamName: team.name, roll: steps, from, to: from, event: 'bounce', time: Date.now() };
    state.history.push(entry);
    logEntry(`<b>${team.name}</b> rolled ${steps} — exceeds 100, needs the exact number. Stays on ${from}.`, 'move');
    advanceTurn(); saveState(); renderAll(); resetDice(); apiSave('live'); return;
  }

  animatePawnHop(team.id, from, to, steps).then(() => {
    team.pos = to;
    state.history.push({ teamId: team.id, teamName: team.name, roll: steps, from, to, event: 'move', time: Date.now() });
    logEntry(`<b>${team.name}</b> rolled ${steps} — moves ${from} ? ${to}.`, 'move');
    saveState(); renderTeams(); resetDice();

    if (state.mode === 'gravity' && state.gravity.bounty && to === state.gravity.bounty) {
      state.gravity.bounty = null;
      const bonusTo = Math.min(100, to + steps);
      logEntry(`?? <b>${team.name}</b> hit the Bounty square! Double move: ${to} ? ${bonusTo}.`, 'win');
      animatePawnClimb(team.id, to, bonusTo).then(() => {
        team.pos = bonusTo;
        saveState(); renderPawns(); renderTeams(); buildBoard();
        if (bonusTo === 100) { finishMatch(team); return; }
        resolvePostMove(team);
      });
      return;
    }
    if (state.mode === 'gravity' && state.gravity.quicksand.includes(team.pos)) {
      state.gravity.frozen[team.id] = true;
      logEntry(`?? <b>${team.name}</b> landed in Quicksand at ${team.pos} — frozen for their next turn.`, 'move');
    }

    if (team.pos === 100) { finishMatch(team); return; }
    resolvePostMove(team);
  });
}

function resolvePostMove(team) {
  const to2 = team.pos;
  const ladders = activeLadders();
  const snakes = activeSnakes();
  if (state.mode === 'shadow' && (ladders[to2] || snakes[to2])) {
    state.revealed[to2] = true;
    saveState(); buildBoard(); apiSave('live');
  }
  if (state.mode === 'draft' && ladders[to2] && state.brokenLadders[to2]) {
    delete state.brokenLadders[to2];
    logEntry(`?? <b>${team.name}</b> landed on a sabotaged ladder at ${to2} — it's broken, no climb.`, 'ladder');
    saveState(); advanceTurn(); saveState(); renderAll(); apiSave('live'); return;
  }
  if (ladders[to2]) {
    openChallenge(team, 'ladder', to2, ladders[to2]);
  } else if (snakes[to2]) {
    if (state.mode === 'draft' && team.shieldArmed) {
      team.shieldArmed = false;
      logEntry(`??? <b>${team.name}</b>'s Deflector Shield blocked the snake at ${to2} — no challenge needed.`, 'snake');
      saveState(); advanceTurn(); saveState(); renderAll(); apiSave('live'); return;
    }
    openChallenge(team, 'snake', to2, snakes[to2]);
  } else {
    advanceTurn(); saveState(); renderAll(); apiSave('live');
  }
}

function animatePawnHop(teamId, from, to, steps) {
  return new Promise((resolve) => {
    team.pos = from;
    renderPawns();
    const pawn = pawnDom(teamId);
    if (!pawn || steps <= 0) { resolve(); return; }
    pawn.getBoundingClientRect();

    if (steps > 1) {
      const ghostHolder = $('boardHolder');
      const stepMs = Math.max(110, 280 / steps);
      let i = 1;
      const tick = setInterval(() => {
        if (i >= steps) { clearInterval(tick); return; }
        const sq = from + i;
        const { x, y } = squareCenterPct(sq);
        const ghost = document.createElement('div');
        ghost.className = 'pawn';
        const tm = state.teams.find(t => t.id === teamId);
        ghost.style.background = (tm && tm.color) || '#fff';
        ghost.style.left = `calc(${x}% - 2.8%)`;
        ghost.style.top  = `calc(${y}% - 2.8%)`;
        ghost.style.opacity = '0.5';
        ghost.style.transform = 'scale(0.65)';
        ghost.style.transition = 'opacity 0.25s, transform 0.25s';
        ghost.style.zIndex = '3';
        ghost.style.pointerEvents = 'none';
        ghostHolder.appendChild(ghost);
        setTimeout(() => { ghost.style.opacity = '0'; ghost.style.transform = 'scale(0.3)'; }, 70);
        setTimeout(() => ghost.remove(), 320);
        i++;
      }, stepMs);
    }

    team.pos = to;
    renderPawns();
    const target = pawnDom(teamId);
    if (target) {
      target.classList.add('hop');
      setTimeout(() => target.classList.remove('hop'), 380);
    }
    const totalMs = Math.min(950, 200 + steps * 130);
    setTimeout(resolve, totalMs);
  });
}

function animatePawnClimb(teamId, from, to) {
  return new Promise((resolve) => {
    team.pos = from;
    renderPawns();
    const p = pawnDom(teamId);
    if (p) p.getBoundingClientRect();
    team.pos = to;
    renderPawns();
    const target = pawnDom(teamId);
    if (target) {
      target.classList.add('climb-up');
      setTimeout(() => target.classList.remove('climb-up'), 900);
    }
    sparksAt(target, '#3a8bc4', 14);
    setTimeout(resolve, 900);
  });
}

function animatePawnSlide(teamId, from, to) {
  return new Promise((resolve) => {
    team.pos = from;
    renderPawns();
    const p = pawnDom(teamId);
    if (p) p.getBoundingClientRect();
    team.pos = to;
    renderPawns();
    const target = pawnDom(teamId);
    if (target) {
      target.classList.add('glide-down');
      setTimeout(() => target.classList.remove('glide-down'), 900);
    }
    const boardHolder = $('boardHolder');
    if (boardHolder) {
      boardHolder.classList.add('shake-snake');
      setTimeout(() => boardHolder.classList.remove('shake-snake'), 600);
    }
    sparksAt(target, '#d44a3e', 18);
    setTimeout(resolve, 900);
  });
}

function sparksAt(target, color, count) {
  if (!target) return;
  const r = target.getBoundingClientRect();
  const cx = r.left + r.width / 2;
  const cy = r.top + r.height / 2;
  for (let i = 0; i < count; i++) {
    const s = document.createElement('div');
    s.className = 'spark';
    s.style.left = (cx - 4 + (Math.random() - 0.5) * 36) + 'px';
    s.style.top  = (cy - 4 + (Math.random() - 0.5) * 36) + 'px';
    s.style.background = color;
    s.style.position = 'fixed';
    const angle = Math.random() * Math.PI * 2;
    const dist = 36 + Math.random() * 90;
    s.style.setProperty('--dx', Math.cos(angle) * dist + 'px');
    s.style.setProperty('--dy', Math.sin(angle) * dist - 20 + 'px');
    document.body.appendChild(s);
    setTimeout(() => s.remove(), 1300);
  }
}

function pawnDom(teamId) {
  let p = document.querySelector('.pawn[data-team-id="' + teamId + '"]');
  if (!p) { renderPawns(); p = document.querySelector('.pawn[data-team-id="' + teamId + '"]'); }
  return p;
}

function resetDice() {
  btnRoll.disabled = false;
  $('btnUndo').disabled = undoStack.length === 0;
}

function advanceTurn() {
  if (state.mode === 'gravity') {
    const g = state.gravity;
    g.turnsSinceShift += 1;
    if (g.invert) { g.invertTurnsLeft -= 1; if (g.invertTurnsLeft <= 0) { g.invert = false; logEntry('?? Gravity reverts to normal.', 'move'); } }
    if (g.quicksand.length) { g.quicksandTurnsLeft -= 1; if (g.quicksandTurnsLeft <= 0) { g.quicksand = []; logEntry('?? Quicksand dries up.', 'move'); } }
  }
  const activeCount = state.teams.filter(t => t.active).length;
  if (activeCount === 0) return;
  state.turnIndex = (state.turnIndex + 1) % activeCount;
  if (state.mode === 'gravity') {
    let guard = 0;
    while (guard < activeCount) {
      const t = currentTeam();
      if (t && state.gravity.frozen[t.id]) {
        delete state.gravity.frozen[t.id];
        logEntry(`?? <b>${t.name}</b> is thawed but skips this turn.`, 'move');
        state.turnIndex = (state.turnIndex + 1) % activeCount;
        guard++;
      } else break;
    }
  }
}

function undoLast() {
  const prev = undoStack.pop();
  if (!prev) return;
  state.teams = prev.teams;
  state.turnIndex = prev.turnIndex;
  state.history = prev.history;
  state.log = prev.log;
  if (prev.revealed) state.revealed = prev.revealed;
  if (prev.brokenLadders) state.brokenLadders = prev.brokenLadders;
  if (prev.gravity) state.gravity = prev.gravity;
  saveState(); buildBoard(); renderAll();
  $('btnUndo').disabled = undoStack.length === 0;
  toast("Last move undone.");
}

/* ============================================
   CHALLENGE MODAL
   ============================================ */
const modalBg = $('challengeModalBg');
const modalEl = $('challengeModal');
const chTitle = $('chTitle');
const chSub = $('chSub');
const chTeamColor = $('chTeamColor');
const timerNum = $('timerNum');
const timerFg = $('timerFg');
const RING_CIRC = 2 * Math.PI * 55;
timerFg.setAttribute('stroke-dasharray', RING_CIRC);

function openChallenge(team, type, at, target) {
  pendingChallenge = { teamId: team.id, type, at, target };
  chTeamColor.style.background = team.color;
  const shadowTrapdoor = state.mode === 'shadow' && type === 'snake';
  chTitle.textContent = (type === 'ladder' ? 'Ladder Challenge — ' : (shadowTrapdoor ? 'Trapdoor! — ' : 'Snake Defense — ')) + team.name;
  chSub.textContent = type === 'ladder'
    ? `Complete the field challenge to climb from ${at} to ${target}. Fail, and the team stays on ${at}.`
    : `Complete the field challenge to block the snake and stay on ${at}. Fail, and the team slides down to ${target}.`;
  modalEl.classList.remove('snakeType', 'ladderType');
  modalEl.classList.add(type === 'ladder' ? 'ladderType' : 'snakeType');
  modalBg.classList.remove('hidden');
  startTimer(15);
  playSound('challenge');
}

function startTimer(seconds) {
  let remaining = seconds;
  timerNum.textContent = remaining;
  timerFg.style.strokeDashoffset = 0;
  timerNum.classList.remove('warning');
  clearInterval(timerInterval);
  timerInterval = setInterval(() => {
    remaining -= 1;
    timerNum.textContent = Math.max(remaining, 0);
    const frac = Math.max(remaining, 0) / seconds;
    timerFg.style.strokeDashoffset = RING_CIRC * (1 - frac);
    if (remaining <= 5) timerNum.classList.add('warning');
    if (remaining <= 0) {
      clearInterval(timerInterval);
      resolveChallenge(false);
    }
  }, 1000);
}

$('btnChComplete').addEventListener('click', () => resolveChallenge(true));
$('btnChFail').addEventListener('click', () => resolveChallenge(false));

function resolveChallenge(success) {
  clearInterval(timerInterval);
  modalBg.classList.add('hidden');
  if (!pendingChallenge) return;
  const { teamId, type, at, target } = pendingChallenge;
  const team = state.teams.find(t => t.id === teamId);
  pendingChallenge = null;
  if (!team) return;

  if (type === 'ladder') {
    if (success) {
      logEntry(`<b>${team.name}</b> passed the ladder challenge — climbs to ${target}! ??`, 'ladder');
      playSound('success');
      animatePawnClimb(teamId, at, target).then(() => {
        team.pos = target;
        saveState(); renderPawns(); renderTeams();
        if (team.pos === 100) { finishMatch(team); return; }
        advanceTurn(); saveState(); renderAll(); apiSave('live');
      });
      return;
    } else {
      logEntry(`<b>${team.name}</b> failed the ladder challenge — stays on ${at}.`, 'ladder');
      playSound('fail');
    }
  } else {
    if (success) {
      logEntry(`<b>${team.name}</b> defended against the snake — stays on ${at}. ???`, 'snake');
      playSound('success');
    } else {
      logEntry(`<b>${team.name}</b> failed the defense — slides down to ${target}. ??`, 'snake');
      playSound('fail');
      animatePawnSlide(teamId, at, target).then(() => {
        team.pos = target;
        saveState(); renderPawns(); renderTeams();
        if (team.pos === 100) { finishMatch(team); return; }
        advanceTurn(); saveState(); renderAll(); apiSave('live');
      });
      return;
    }
  }
  saveState(); renderPawns(); renderTeams();
  if (team.pos === 100) { finishMatch(team); return; }
  advanceTurn(); saveState(); renderAll(); apiSave('live');
}

/* ============================================
   WIN / VICTORY
   ============================================ */
function finishMatch(winner) {
  state.finished = true;
  logEntry(`?? <b>${winner.name}</b> reached square 100 and wins the match!`, 'win');
  saveState(); apiSave('finished');
  renderAll();

  // Spark burst at the winning pawn
  const p = pawnDom(winner.id);
  if (p) {
    sparksAt(p, winner.color || '#e8a93a', 40);
    setTimeout(() => sparksAt(p, '#e8a93a', 24), 350);
  }

  // Inject rotating rays into victory card if not already there
  const v = document.querySelector('.victory');
  if (v && !v.querySelector('.rays')) {
    const rays = document.createElement('div');
    rays.className = 'rays';
    v.prepend(rays);
  }

  $('victoryName').textContent = winner.name.toUpperCase() + ' WINS';
  $('victoryBg').classList.remove('hidden');
  playSound('victory');
  spawnConfetti();
}

$('btnVictoryClose').addEventListener('click', () => {
  $('victoryBg').classList.add('hidden');
  resetMatch();
});

/* ============================================
   LOG
   ============================================ */
function logEntry(html, cls) {
  state.log.push({ html, cls: cls || '', time: Date.now() });
  const div = document.createElement('div');
  div.className = 'entry ' + (cls || '') + ' new';
  div.innerHTML = html + `<div class="time">${new Date().toLocaleTimeString()}</div>`;
  if (logListEl.querySelector('.empty-note')) logListEl.innerHTML = '';
  logListEl.appendChild(div);
  setTimeout(() => div.classList.remove('new'), 300);
}

function renderLog() {
  logListEl.innerHTML = '';
  if (!state.log || state.log.length === 0) {
    logListEl.innerHTML = `<div class="empty-note">No rolls yet — start the match to begin logging.</div>`;
    return;
  }
  state.log.forEach(h => {
    const div = document.createElement('div');
    div.className = 'entry ' + (h.cls || '');
    div.innerHTML = h.html + `<div class="time">${new Date(h.time).toLocaleTimeString()}</div>`;
    logListEl.appendChild(div);
  });
}

/* ============================================
   LEADERBOARD
   ============================================ */
function renderLeaderboard() {
  const body = $('lbBody');
  const rows = Object.entries(leaderboard).sort((a, b) => b[1].wins - a[1].wins);
  if (rows.length === 0) {
    body.innerHTML = `<tr><td colspan="5" class="empty-note">No completed matches yet.</td></tr>`;
    return;
  }
  body.innerHTML = rows.map(([name, r], i) => {
    const team = state.teams.find(t => t.name === name);
    const color = team ? team.color : '#888';
    return `<tr>
      <td class="lb-rank">${i + 1}</td>
      <td><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${color};margin-right:6px;vertical-align:middle;"></span>${escapeHtml(name)}</td>
      <td class="lb-wins">${r.wins}</td>
      <td>${r.losses}</td>
      <td>${r.matches}</td>
    </tr>`;
  }).join('');
}

/* ============================================
   ADMIN
   ============================================ */
function resetMatch() {
  if (!confirm('Reset the current match? Team names are kept, positions and history clear.')) return;
  state.started = false; state.finished = false; state.turnIndex = 0; state.history = []; state.log = [];
  state.teams.forEach(t => {
    t.pos = 1; t.active = true;
    t.inventory = { shield: 1, sabotage: 1, swapper: 1, loadedDie: 1 };
    t.shieldArmed = false;
  });
  state.revealed = {};
  state.brokenLadders = {};
  state.gravity = { turnsSinceShift: 0, invert: false, invertTurnsLeft: 0, quicksand: [], quicksandTurnsLeft: 0, bounty: null, frozen: {} };
  armedLoadedDie = null;
  undoStack = [];
  resetDice(); saveState(); buildBoard(); renderAll();
  apiCreateMatch('live');
  toast('Match reset.');
}

function clearAllData() {
  if (!confirm('Clear ALL data — teams, history, and the leaderboard? This cannot be undone.')) return;
  state = {
    teams: [], turnIndex: 0, started: false, finished: false, history: [], log: [],
    mode: 'classic', revealed: {}, brokenLadders: {},
    gravity: { turnsSinceShift: 0, invert: false, invertTurnsLeft: 0, quicksand: [], quicksandTurnsLeft: 0, bounty: null, frozen: {} }
  };
  leaderboard = {};
  undoStack = [];
  armedLoadedDie = null;
  currentMatchId = null;
  saveState(); buildBoard(); renderAll();
  apiLoadLeaderboard();
  toast('All data cleared.');
}

function clearLeaderboard() {
  toast('Leaderboard is server-managed — reset from the database or wait for new matches.');
}

function showRules() {
  const modeInfo = MODES.map(m => `• ${m.name}: ${m.desc}`).join('\n');
  alert('How to play:\n\n1. Pick a Game Mode, add teams, then Start match.\n2. Tap Roll dice — it\'s a true random roll, animated for the crowd.\n3. The team auto-moves that many squares.\n4. Landing on a ladder or snake runs a 15-second field challenge — mark it Completed or Failed.\n5. First team to land exactly on 100 wins.\n\nGame Modes:\n' + modeInfo + '\n\nAll progress saves automatically to the server.');
}

/* ============================================
   TOAST
   ============================================ */
let toastTimer = null;
function toast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}

/* ============================================
   STATUS
   ============================================ */
function renderStatus() {
  const el = $('boardStatus');
  if (!state.started) el.textContent = '· not started';
  else if (state.finished) el.textContent = '· finished';
  else el.textContent = '· live';
}

/* ============================================
   RENDER ALL
   ============================================ */
function renderAll() {
  renderTeams();
  renderPawns();
  renderTurnBanner();
  renderLog();
  renderLeaderboard();
  renderStatus();
  renderModeSelector();
  renderModePanels();
  $('btnUndo').disabled = undoStack.length === 0;
  resetDice();
  // Stop any in-flight animations on round change
  const holder = $('boardHolder');
  if (holder) holder.classList.remove('shake-snake', 'flip');
  document.querySelectorAll('.pawn.hop, .pawn.climb-up, .pawn.glide-down')
    .forEach(p => p.classList.remove('hop', 'climb-up', 'glide-down'));
}

/* ============================================
   CUSTOM PROMPT MODAL (replaces browser prompt)
   ============================================ */
const promptBg = $('promptModalBg');
const promptTitle = $('promptTitle');
const promptOptions = $('promptOptions');
let promptCallback = null;

function showPrompt(title, subtitle, options, callback) {
  promptTitle.textContent = title;
  promptOptions.innerHTML = '';
  if (subtitle) {
    const sub = document.createElement('p');
    sub.className = 'sub';
    sub.style.marginBottom = '8px';
    sub.textContent = subtitle;
    promptOptions.appendChild(sub);
  }
  options.forEach(opt => {
    const btn = document.createElement('div');
    btn.className = 'prompt-option';
    btn.innerHTML = `${opt.label}${opt.detail ? `<div class="opt-detail">${opt.detail}</div>` : ''}`;
    btn.addEventListener('click', () => {
      promptBg.classList.add('hidden');
      callback(opt.value);
    });
    promptOptions.appendChild(btn);
  });
  promptBg.classList.remove('hidden');
}

$('promptCancel').addEventListener('click', () => {
  promptBg.classList.add('hidden');
  if (promptCallback) promptCallback(null);
});

/* ============================================
   SOUND EFFECTS (Web Audio API)
   ============================================ */
function initAudio() {
  if (!audioCtx) {
    try {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    } catch (e) {
      soundEnabled = false;
    }
  }
}

function playSound(type) {
  if (!soundEnabled) return;
  initAudio();
  if (!audioCtx) return;
  try {
    const now = audioCtx.currentTime;
    if (type === 'roll') {
      for (let i = 0; i < 8; i++) {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.frequency.value = 200 + Math.random() * 400;
        osc.type = 'square';
        gain.gain.setValueAtTime(0.08, now + i * 0.055);
        gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.055 + 0.05);
        osc.start(now + i * 0.055);
        osc.stop(now + i * 0.055 + 0.05);
      }
    } else if (type === 'success') {
      const notes = [523, 659, 784];
      notes.forEach((freq, i) => {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.frequency.value = freq;
        osc.type = 'sine';
        gain.gain.setValueAtTime(0.15, now + i * 0.12);
        gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.12 + 0.3);
        osc.start(now + i * 0.12);
        osc.stop(now + i * 0.12 + 0.3);
      });
    } else if (type === 'fail') {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.frequency.setValueAtTime(300, now);
      osc.frequency.exponentialRampToValueAtTime(100, now + 0.4);
      osc.type = 'sawtooth';
      gain.gain.setValueAtTime(0.12, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.4);
      osc.start(now);
      osc.stop(now + 0.4);
    } else if (type === 'challenge') {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.frequency.value = 880;
      osc.type = 'sine';
      gain.gain.setValueAtTime(0.2, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.6);
      osc.start(now);
      osc.stop(now + 0.6);
    } else if (type === 'victory') {
      const notes = [523, 659, 784, 1047, 784, 1047];
      notes.forEach((freq, i) => {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.frequency.value = freq;
        osc.type = 'sine';
        gain.gain.setValueAtTime(0.18, now + i * 0.15);
        gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.15 + 0.4);
        osc.start(now + i * 0.15);
        osc.stop(now + i * 0.15 + 0.4);
      });
    } else if (type === 'powerup') {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.frequency.setValueAtTime(400, now);
      osc.frequency.exponentialRampToValueAtTime(800, now + 0.2);
      osc.type = 'triangle';
      gain.gain.setValueAtTime(0.15, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
      osc.start(now);
      osc.stop(now + 0.3);
    } else if (type === 'start') {
      const notes = [392, 523, 659];
      notes.forEach((freq, i) => {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.frequency.value = freq;
        osc.type = 'triangle';
        gain.gain.setValueAtTime(0.12, now + i * 0.1);
        gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.1 + 0.25);
        osc.start(now + i * 0.1);
        osc.stop(now + i * 0.1 + 0.25);
      });
    }
  } catch (e) { /* ignore audio errors */ }
}

$('btnSound').addEventListener('click', () => {
  soundEnabled = !soundEnabled;
  $('btnSound').textContent = soundEnabled ? '??' : '??';
  if (soundEnabled) initAudio();
});

/* ============================================
   CONFETTI
   ============================================ */
function spawnConfetti() {
  const colors = ['#e8a93a', '#d44a3e', '#3a8bc4', '#5a9e6f', '#9a5bc4', '#f7c966'];
  for (let i = 0; i < 60; i++) {
    const c = document.createElement('div');
    c.className = 'confetti';
    c.style.left = Math.random() * 100 + 'vw';
    c.style.background = colors[Math.floor(Math.random() * colors.length)];
    c.style.animationDuration = (2 + Math.random() * 2) + 's';
    c.style.animationDelay = Math.random() * 0.5 + 's';
    c.style.width = (6 + Math.random() * 8) + 'px';
    c.style.height = (6 + Math.random() * 8) + 'px';
    c.style.borderRadius = Math.random() > 0.5 ? '50%' : '2px';
    document.body.appendChild(c);
    setTimeout(() => c.remove(), 4500);
  }
}

/* ============================================
   HELPERS
   ============================================ */
function activeSnakes() {
  if (state.mode === 'gravity' && state.gravity && state.gravity.invert) return BASE_LADDERS;
  return BASE_SNAKES;
}
function activeLadders() {
  if (state.mode === 'gravity' && state.gravity && state.gravity.invert) return BASE_SNAKES;
  return BASE_LADDERS;
}

function saveState() {
  try {
    localStorage.setItem('snl_game_state_v3', JSON.stringify(state));
    localStorage.setItem('snl_leaderboard_v3', JSON.stringify(leaderboard));
    if (state.started && !state.finished) apiSave('live');
  } catch (e) {}
}

/* ---------- APP STATE / FLOW ---------- */
let selectedPlayerCount = null;
let selectedMode = null;
let isAiMatch = false;

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(el => el.classList.add('hidden'));
  const target = document.getElementById(id);
  if (target) target.classList.remove('hidden');
}
function hideAllScreens() {
  document.querySelectorAll('.screen').forEach(el => el.classList.add('hidden'));
}

/* ---------- MAIN MENU ---------- */
function initMainMenu() {
  const grid = $('playerCountGrid');
  if (!grid) return;
  grid.querySelectorAll('.player-card').forEach(card => {
    card.addEventListener('click', () => {
      grid.querySelectorAll('.player-card').forEach(c => c.classList.remove('active'));
      card.classList.add('active');
      selectedPlayerCount = parseInt(card.dataset.count, 10);
    });
  });

  const btnContinue = $('btnContinueFromMenu');
  if (btnContinue) {
    btnContinue.addEventListener('click', () => {
      if (!selectedPlayerCount) return toast('Choose how many players first.');
      isAiMatch = selectedPlayerCount === 1;
      openModeSelect();
    });
  }
}

function openModeSelect() {
  const badge = $('modeCountBadge');
  if (badge) {
    const labels = { 1: 'Solo vs AI', 2: 'Duo', 3: 'Trio', 4: '4-Player' };
    badge.textContent = labels[selectedPlayerCount] || selectedPlayerCount + ' Players';
  }
  renderModeCards();
  showScreen('screen-mode-select');
}

function renderModeCards() {
  const wrap = $('modeCards');
  if (!wrap) return;
  wrap.innerHTML = MODES.map(m => `
    <div class="mode-card ${state.mode === m.id ? 'active' : ''}" data-mode="${m.id}">
      <div class="mc-name">${m.name}</div>
      <div class="mc-desc">${m.desc}</div>
    </div>
  `).join('');
  wrap.querySelectorAll('.mode-card').forEach(card => {
    card.addEventListener('click', () => {
      wrap.querySelectorAll('.mode-card').forEach(c => c.classList.remove('active'));
      card.classList.add('active');
      selectedMode = card.dataset.mode;
      const btn = $('btnContinueFromMode');
      if (btn) btn.disabled = false;
    });
  });
}

function initModeSelectButtons() {
  const btnBack = $('btnBackToMenu');
  if (btnBack) btnBack.addEventListener('click', () => showScreen('screen-main-menu'));

  const btnContinue = $('btnContinueFromMode');
  if (btnContinue) {
    btnContinue.addEventListener('click', () => {
      if (!selectedMode) return toast('Choose a game mode first.');
      state.mode = selectedMode;
      openNameEntry();
    });
  }
}

/* ---------- NAME ENTRY ---------- */
function openNameEntry() {
  const badge = $('nameCountBadge');
  if (badge) {
    const labels = { 1: 'Solo vs AI', 2: 'Duo', 3: 'Trio', 4: '4-Player' };
    badge.textContent = labels[selectedPlayerCount] || selectedPlayerCount + ' Players';
  }
  const banner = $('nameModeBanner');
  if (banner) banner.textContent = MODES.find(m => m.id === state.mode)?.name || state.mode;

  const grid = $('nameEntryGrid');
  if (!grid) return;
  grid.innerHTML = '';
  const count = selectedPlayerCount || 2;
  for (let i = 0; i < count; i++) {
    const row = document.createElement('div');
    row.className = 'name-field';
    const label = document.createElement('label');
    label.textContent = 'Player ' + (i + 1) + (isAiMatch && i === 1 ? ' (AI)' : '');
    label.style.display = 'block';
    label.style.fontSize = '12px';
    label.style.color = 'var(--chalk-muted)';
    label.style.marginBottom = '6px';
    const input = document.createElement('input');
    input.className = 'name-entry-input';
    input.type = 'text';
    input.placeholder = 'Enter name';
    input.value = isAiMatch && i === 1 ? 'Bot' : '';
    input.dataset.index = i;
    row.appendChild(label);
    row.appendChild(input);
    grid.appendChild(row);
  }

  showScreen('screen-name-entry');
}

function initNameEntryButtons() {
  const btnBack = $('btnBackToMode');
  if (btnBack) btnBack.addEventListener('click', () => showScreen('screen-mode-select'));

  const btnStart = $('btnStartGame');
  if (btnStart) {
    btnStart.addEventListener('click', () => {
      const inputs = document.querySelectorAll('.name-entry-input');
      const names = Array.from(inputs).map(inp => inp.value.trim() || ('Player ' + (parseInt(inp.dataset.index, 10) + 1)));
      startGameWithNames(names);
    });
  }
}

function startGameWithNames(names) {
  state = freshState();
  state.teams = names.map((name, idx) => ({
    id: crypto.randomUUID(),
    name,
    color: TEAM_COLORS[idx % TEAM_COLORS.length],
    pos: 1,
    active: true,
    inventory: { shield: 1, sabotage: 1, swapper: 1, loadedDie: 1 },
    shieldArmed: false
  }));
  state.mode = selectedMode || 'classic';
  state.started = true;
  currentMatchId = null;
  undoStack = [];
  armedLoadedDie = null;
  saveState();
  buildBoard();
  renderAll();
  updateGameMeta();
  showScreen('screen-game');
  apiCreateMatch('live');
  startAutoSave();
  apiLoadLeaderboard();
  playSound('start');
}

function updateGameMeta() {
  const modeEl = $('metaMode');
  const playersEl = $('metaPlayers');
  if (modeEl) modeEl.textContent = (MODES.find(m => m.id === state.mode)?.name || state.mode);
  if (playersEl) playersEl.textContent = state.teams.length + ' Player' + (state.teams.length === 1 ? '' : 's');
}

/* ---------- ARENA ---------- */
let arenaMode = 'classic';
let arenaCount = 2;

function initArena() {
  const btnArena = $('btnNavArena');
  if (btnArena) {
    btnArena.addEventListener('click', () => {
      loadArena();
      showScreen('screen-arena');
    });
  }

  const btnBack = $('btnBackFromArena');
  if (btnBack) btnBack.addEventListener('click', () => showScreen('screen-main-menu'));

  document.querySelectorAll('#arenaModePills .pill').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#arenaModePills .pill').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      arenaMode = btn.dataset.mode || 'classic';
      loadArena();
    });
  });

  document.querySelectorAll('#arenaCountPills .pill').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#arenaCountPills .pill').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      arenaCount = parseInt(btn.dataset.count, 10) || 2;
      loadArena();
    });
  });
}

async function loadArena() {
  const body = $('arenaBody');
  if (body) body.innerHTML = '<tr><td colspan="2" class="empty-note">Loading…</td></tr>';
  try {
    const params = new URLSearchParams({ mode: arenaMode, player_count: String(arenaCount), limit: '50' });
    const res = await fetch(`${CONFIG.API_BASE}/arena.php?${params.toString()}`);
    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'Failed');
    renderArenaRows(data.rows || []);
  } catch (e) {
    if (body) body.innerHTML = '<tr><td colspan="2" class="empty-note">Failed to load arena.</td></tr>';
  }
}

function renderArenaRows(rows) {
  const body = $('arenaBody');
  if (!body) return;
  if (!rows.length) {
    body.innerHTML = '<tr><td colspan="2" class="empty-note">No finishes yet for this filter.</td></tr>';
    return;
  }
  body.innerHTML = rows.map((row, idx) => `
    <tr>
      <td class="col-rank">${idx + 1}</td>
      <td class="col-name">${escapeHtml(row.name)}</td>
    </tr>
  `).join('');
}

/* ---------- GAME NAVIGATION ---------- */
function initGameButtons() {
  const btnQuit = $('btnQuitToMenu');
  if (btnQuit) {
    btnQuit.addEventListener('click', () => {
      if (state.started && !state.finished) {
        if (!confirm('Quit to main menu? Current progress is saved.')) return;
      }
      showScreen('screen-main-menu');
    });
  }

  const brand = $('brandHome');
  if (brand) {
    brand.addEventListener('click', () => showScreen('screen-main-menu'));
    brand.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        showScreen('screen-main-menu');
      }
    });
  }
}

/* ============================================
   EVENT LISTENERS
   ============================================ */
$('btnAddTeam').addEventListener('click', () => {
  const input = $('newTeamName');
  addTeam(input.value.trim());
  input.value = '';
});

$('btnStartMatch').addEventListener('click', startMatch);
$('btnClearLb').addEventListener('click', clearLeaderboard);
$('btnRules').addEventListener('click', showRules);

/* ============================================
   INIT
   ============================================ */
window.addEventListener('DOMContentLoaded', () => {
  buildBoard();
  buildDice();
  initMainMenu();
  initModeSelectButtons();
  initNameEntryButtons();
  initArena();
  initGameButtons();
  showScreen('screen-main-menu');

  // Mobile roll button mirrors desktop
  const mobile = $('btnRollMobile');
  if (mobile) {
    mobile.addEventListener('click', () => doRoll());
  }
  // Spacebar to roll (desktop convenience)
  document.addEventListener('keydown', (e) => {
    if (e.code === 'Space' && !isRolling && state.started && !state.finished) {
      const tag = (e.target && e.target.tagName) || '';
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      e.preventDefault();
      doRoll();
    }
  });
});

})();
