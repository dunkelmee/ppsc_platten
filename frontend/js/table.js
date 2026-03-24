/* ═══════════════════════════════════════════════════════════════════════════
   PPSC — Table Queue Page
   ═══════════════════════════════════════════════════════════════════════════ */

const tableId = window.location.pathname.split('/').filter(Boolean)[1];
const PLAYER_KEY = 'ppsc_player';
const TABLE_KEY = `ppsc_table_${tableId}`;

let tableState = null;
let eventSource = null;

// ── Identity tracking ─────────────────────────────────────────────────────────

function getRegistration() {
  try { return JSON.parse(localStorage.getItem(PLAYER_KEY) || 'null'); }
  catch { return null; }
}

function getTableIdentity() {
  try { return JSON.parse(localStorage.getItem(TABLE_KEY) || 'null'); }
  catch { return null; }
}

function setTableIdentity(data) {
  localStorage.setItem(TABLE_KEY, JSON.stringify(data));
}

function getIdentity() {
  const reg = getRegistration();
  const table = getTableIdentity();
  if (!reg) return null;
  return { nickname: reg.name, playerId: reg.playerId, ...(table || {}) };
}

function setIdentity(data) {
  setTableIdentity(data);
}

function clearIdentity() {
  localStorage.removeItem(TABLE_KEY);
}

// ── Time formatting ───────────────────────────────────────────────────────────

function formatWaitTime(iso) {
  if (!iso) return '';
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60) return `${diff}s`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  return `${Math.floor(diff / 3600)}h`;
}

// ── Badge HTML ────────────────────────────────────────────────────────────────

function skillBadge(skill) {
  const labels = { beginner: 'Beginner', intermediate: 'Inter.', advanced: 'Advanced' };
  return `<span class="badge badge--${skill}">${labels[skill] || skill}</span>`;
}

// ── Avatar helper ─────────────────────────────────────────────────────────────

function playerInitial(nickname) {
  return escHtml(nickname.charAt(0).toUpperCase());
}

// ── Find user's position in queue ─────────────────────────────────────────────

function _isMe(player, userInfo) {
  const reg = getRegistration();
  if (reg && player.registered_id) return player.registered_id === reg.playerId;
  return player.nickname === userInfo.nickname;
}

function _matchPlayer(p, identity) {
  // Match by registered_id (UUID) first — handles duplicate names
  if (identity.playerId && p.registered_id) {
    return p.registered_id === identity.playerId;
  }
  // Fallback: match by nickname + gameId
  return p.nickname === identity.nickname;
}

function getUserGameInfo(state, identity) {
  if (!identity || !state) return null;
  // Check current game (side A)
  if (state.current_game) {
    const p = state.current_game.players.find(p =>
      _matchPlayer(p, identity) &&
      (identity.gameId ? state.current_game.id === identity.gameId : true)
    );
    if (p) return { location: 'playing', game: state.current_game, side: 'current', nickname: identity.nickname };
  }
  // Check opponent (side B)
  if (state.opponent) {
    const p = state.opponent.players.find(p =>
      _matchPlayer(p, identity) &&
      (identity.gameId ? state.opponent.id === identity.gameId : true)
    );
    if (p) return { location: 'playing', game: state.opponent, side: 'opponent', nickname: identity.nickname };
  }
  // Check queue
  for (let i = 0; i < state.queue.length; i++) {
    const game = state.queue[i];
    const found = game.players.some(p =>
      _matchPlayer(p, identity) &&
      (identity.gameId ? game.id === identity.gameId : true)
    );
    if (found) return { location: 'queue', position: i + 1, game, nickname: identity.nickname };
  }
  // Check solo pool
  if (state.solo_pool) {
    const solo = state.solo_pool.find(p => {
      if (identity.playerId && p.registered_id) return p.registered_id === identity.playerId;
      if (identity.soloPlayerId) return p.id === identity.soloPlayerId;
      return p.nickname === identity.nickname;
    });
    if (solo) return { location: 'pool', player: solo };
  }
  return null;
}

// ── Render helpers ────────────────────────────────────────────────────────────

function renderMatchSide(game, isDoubles, userInfo, sideKey) {
  if (!game) return '';
  const isUserSide = userInfo && userInfo.location === 'playing' && userInfo.side === sideKey;

  if (isDoubles) {
    // Doubles: show team members stacked
    return `
      <div class="match-side">
        <div class="match-team">
          ${game.players.map(p => `
            <div class="match-team-member">
              <div class="match-avatar">${playerInitial(p.nickname)}</div>
              <div class="match-player-name">${escHtml(p.nickname)}</div>
              ${skillBadge(p.skill)}
              ${isUserSide && _isMe(p, userInfo) ? '<span class="you-playing-label">\u2605 You</span>' : ''}
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }

  const p = game.players[0];
  return `
    <div class="match-side">
      <div class="match-avatar">${playerInitial(p.nickname)}</div>
      <div class="match-player-name">${escHtml(p.nickname)}</div>
      ${skillBadge(p.skill)}
      ${isUserSide && _isMe(p, userInfo) ? '<span class="you-playing-label">\u2605 You</span>' : ''}
    </div>
  `;
}

function renderCurrentGame(state, identity) {
  const el = document.getElementById('current-game-section');
  if (!el) return;

  const userInfo = getUserGameInfo(state, identity);
  const isDoubles = state.type === 'doubles';

  if (state.status === 'closed') {
    el.innerHTML = `
      <div class="closed-banner">
        <div class="closed-icon">🚫</div>
        <div class="title-md">Table closed</div>
        <p class="body-md text-muted" style="margin-top:0.5rem">
          This table is currently not in service.
        </p>
      </div>
    `;
    return;
  }

  if (!state.current_game) {
    el.innerHTML = `
      <div class="open-state">
        <div class="open-icon">🏓</div>
        <div class="title-md">Open — join the queue!</div>
        <p class="body-md text-muted" style="margin-top:0.5rem">
          No one is playing yet. Be the first!
        </p>
      </div>
    `;
    return;
  }

  // Current game exists but no opponent — waiting
  if (!state.opponent) {
    const g = state.current_game;
    const playersHtml = g.players.map(p => `
      <div class="match-avatar" style="width:64px;height:64px;font-size:1.4rem;
        background:linear-gradient(135deg,var(--primary),var(--primary-container));
        color:var(--on-primary);box-shadow:0 0 0 3px rgba(169,0,150,0.25)">
        ${playerInitial(p.nickname)}
      </div>
      <div class="match-player-name" style="font-size:1.1rem">${escHtml(p.nickname)}</div>
      ${skillBadge(p.skill)}
    `).join('<div style="height:var(--sp-2)"></div>');

    el.innerHTML = `
      <div class="waiting-opponent">
        <div class="waiting-player">
          ${playersHtml}
        </div>
        <div class="title-md">Waiting for opponent…</div>
        <p class="body-md text-muted" style="margin-top:0.5rem">
          ${isDoubles ? 'Another pair needs to join to start the match.' : 'Another player needs to join to start the match.'}
        </p>
      </div>
    `;
    return;
  }

  // Full match: both sides present
  const sideA = renderMatchSide(state.current_game, isDoubles, userInfo, 'current');
  const sideB = renderMatchSide(state.opponent, isDoubles, userInfo, 'opponent');

  // Play mode info
  const isWinnerStays = state.play_mode === 'winner_stays';
  let modeHtml = '';
  if (isWinnerStays) {
    modeHtml = `
      <div class="match-mode-row">
        <span class="match-mode-badge">Winner Stays</span>
        ${state.current_wins > 0 ? `<span class="match-wins-counter">${state.current_wins}/${state.max_wins} wins</span>` : ''}
      </div>
    `;
  } else {
    modeHtml = `
      <div class="match-mode-row">
        <span class="match-mode-badge">Rotation</span>
      </div>
    `;
  }

  // Action buttons
  let actionsHtml = '';
  if (isWinnerStays) {
    const nameA = state.current_game.players.map(p => escHtml(p.nickname)).join(' & ');
    const nameB = state.opponent.players.map(p => escHtml(p.nickname)).join(' & ');
    actionsHtml = `
      <div class="match-actions">
        <button class="match-win-btn" onclick="declareWinner('current')">
          ${nameA} won
        </button>
        <button class="match-win-btn" onclick="declareWinner('opponent')">
          ${nameB} won
        </button>
      </div>
    `;
  } else {
    actionsHtml = `
      <div class="match-actions">
        <button class="game-done-btn" style="width:100%;justify-content:center" id="game-done-btn" onclick="gameDone()">
          ✓ Game Done
        </button>
      </div>
    `;
  }

  el.innerHTML = `
    <div class="match-card">
      <div class="accent-bar"></div>
      <div class="match-header">
        <span class="match-label">Now Playing</span>
        <span class="match-live-badge"><span class="match-live-dot"></span> Live Match</span>
      </div>
      <div class="match-arena">
        ${sideA}
        <span class="match-vs">VS</span>
        ${sideB}
      </div>
      ${modeHtml}
      ${actionsHtml}
    </div>
  `;
}

function renderQueue(state, identity) {
  const el = document.getElementById('queue-section');
  if (!el) return;

  const userInfo = getUserGameInfo(state, identity);

  if (!state.queue || state.queue.length === 0) {
    el.innerHTML = '';
    return;
  }

  const items = state.queue.map((game, idx) => {
    const pos = idx + 1;
    const isNextUp = pos <= 1;
    const isUserHere = userInfo && userInfo.location === 'queue' && userInfo.game.id === game.id;

    const playersHtml = game.players.map((p, i) => `
      <span class="queue-player">
        <span class="queue-name">${escHtml(p.nickname)}</span>
        ${skillBadge(p.skill)}
      </span>
      ${i < game.players.length - 1 ? '<span class="vs-divider" style="font-size:0.7rem">vs</span>' : ''}
    `).join('');

    return `
      <div class="queue-item ${isNextUp ? 'queue-item--next-up' : ''}">
        <div class="queue-position">
          <div class="position-num">${pos}</div>
          ${isNextUp ? '<div class="up-next-label">Up next</div>' : ''}
        </div>
        <div class="queue-item-info">
          <div class="queue-players">${playersHtml}</div>
          <div class="queue-time">${formatWaitTime(game.queued_at)} waiting</div>
          ${isUserHere ? '<div class="you-playing-label">★ That\'s you!</div>' : ''}
        </div>
      </div>
    `;
  }).join('');

  el.innerHTML = `
    <div class="section-header">
      <div class="section-title">Queue</div>
      <div class="section-title" style="color:var(--primary)">${state.queue.length} waiting</div>
    </div>
    <div class="queue-list">${items}</div>
  `;
}

function renderSoloPool(state, identity) {
  const el = document.getElementById('solo-pool-section');
  if (!el) return;

  if (state.type !== 'doubles') {
    el.innerHTML = '';
    return;
  }

  const pool = state.solo_pool || [];
  const userInfo = getUserGameInfo(state, identity);
  const userInPool = userInfo && userInfo.location === 'pool';

  if (pool.length === 0 && !userInPool) {
    el.innerHTML = '';
    return;
  }

  const playersHtml = pool.map(p => `
    <div class="solo-item">
      <div class="solo-waiting-icon"></div>
      <span class="queue-name">${escHtml(p.nickname)}</span>
      ${skillBadge(p.skill)}
      ${(identity && ((identity.playerId && p.registered_id === identity.playerId) || p.nickname === identity.nickname)) ? '<span class="you-playing-label">\u2605 You</span>' : ''}
    </div>
  `).join('');

  const countText = pool.length === 1
    ? 'Waiting for a partner…'
    : `${pool.length} players waiting`;

  el.innerHTML = `
    <div class="solo-pool">
      <div class="solo-pool-header">
        <div class="solo-pool-icon">🎯</div>
        <div>
          <div class="solo-pool-title">Partner Waiting Pool</div>
          <div class="solo-pool-count">${countText}</div>
        </div>
      </div>
      ${pool.length > 0 ? playersHtml : '<div class="solo-pool-waiting">You\'re in the pool — waiting for another player</div>'}
    </div>
  `;
}

function renderForm(state) {
  const el = document.getElementById('join-form-section');
  if (!el) return;

  if (state.status === 'closed') {
    el.innerHTML = '';
    return;
  }

  if (state.type === 'singles') {
    el.innerHTML = singlesFormHtml();
  } else {
    el.innerHTML = doublesFormHtml();
    setupDoublesToggle();
  }
}

function singlesFormHtml() {
  const reg = getRegistration();
  const name = reg ? escHtml(reg.name) : '';
  return `
    <div class="join-form-section">
      <img src="/logo.png" class="watermark" alt="">
      <div class="join-form-title">Join the queue</div>
      <form class="form-stack" id="join-form" onsubmit="submitJoin(event)">
        <div class="form-group">
          <label class="form-label" for="nickname">Your name</label>
          <input class="form-input" type="text" id="nickname" name="nickname"
            value="${name}" readonly style="opacity:0.7;cursor:default">
          <a href="/register" style="font-size:0.75rem;color:var(--primary);margin-top:0.25rem;display:inline-block">Not you? Log out</a>
        </div>
        <div class="form-group">
          <label class="form-label" for="skill">Skill level</label>
          <select class="form-select" id="skill" name="skill" required>
            <option value="">Choose\u2026</option>
            <option value="beginner">\ud83d\udfe2 Beginner</option>
            <option value="intermediate">\ud83d\udfe1 Intermediate</option>
            <option value="advanced">\ud83d\udd34 Advanced</option>
          </select>
        </div>
        <button class="btn btn-primary btn-full" type="submit">
          Join Queue \u2192
        </button>
      </form>
    </div>
  `;
}

function doublesFormHtml() {
  const reg = getRegistration();
  const name = reg ? escHtml(reg.name) : '';
  return `
    <div class="join-form-section">
      <img src="/logo.png" class="watermark" alt="">
      <div class="join-form-title">Join the queue</div>
      <div class="form-stack">
        <div class="form-group">
          <label class="form-label">How are you joining?</label>
          <div class="radio-group">
            <input type="radio" name="join-mode" id="mode-pair" value="pair" checked>
            <label for="mode-pair">I have a partner</label>
            <input type="radio" name="join-mode" id="mode-solo" value="solo">
            <label for="mode-solo">I need a partner</label>
          </div>
        </div>

        <form id="join-form" class="form-stack" onsubmit="submitJoin(event)">
          <div class="form-group">
            <label class="form-label" for="nickname">Your name</label>
            <input class="form-input" type="text" id="nickname" name="nickname"
              value="${name}" readonly style="opacity:0.7;cursor:default">
            <a href="/register" style="font-size:0.75rem;color:var(--primary);margin-top:0.25rem;display:inline-block">Not you? Log out</a>
          </div>
          <div class="form-group">
            <label class="form-label" for="skill">Your skill level</label>
            <select class="form-select" id="skill" name="skill" required>
              <option value="">Choose\u2026</option>
              <option value="beginner">\ud83d\udfe2 Beginner</option>
              <option value="intermediate">\ud83d\udfe1 Intermediate</option>
              <option value="advanced">\ud83d\udd34 Advanced</option>
            </select>
          </div>

          <div id="partner-fields" class="partner-section">
            <div class="partner-section-label">Your partner</div>
            <div class="form-group">
              <label class="form-label" for="partner-nickname">Partner's name</label>
              <input class="form-input" type="text" id="partner-nickname" name="partner_nickname"
                placeholder="e.g. Loopmaster" maxlength="20" autocomplete="off" list="registered-players-list">
              <datalist id="registered-players-list"></datalist>
              <input type="hidden" id="partner-player-id" name="partner_player_id">
            </div>
            <div class="form-group">
              <label class="form-label" for="partner-skill">Partner's skill level</label>
              <select class="form-select" id="partner-skill" name="partner_skill">
                <option value="">Choose\u2026</option>
                <option value="beginner">\ud83d\udfe2 Beginner</option>
                <option value="intermediate">\ud83d\udfe1 Intermediate</option>
                <option value="advanced">\ud83d\udd34 Advanced</option>
              </select>
            </div>
          </div>

          <button class="btn btn-primary btn-full" type="submit" id="join-btn">
            Join Queue \u2192
          </button>
        </form>
      </div>
    </div>
  `;
}

let _registeredPlayers = [];

async function loadRegisteredPlayers() {
  try {
    const res = await fetch('/players');
    if (res.ok) _registeredPlayers = await res.json();
  } catch {}
}

function populatePartnerDatalist() {
  const dl = document.getElementById('registered-players-list');
  if (!dl) return;
  const reg = getRegistration();
  const myId = reg ? reg.playerId : null;
  dl.innerHTML = _registeredPlayers
    .filter(p => p.id !== myId)
    .map(p => `<option value="${escHtml(p.name)}" data-id="${escHtml(p.id)}">`)
    .join('');
}

function setupDoublesToggle() {
  const radios = document.querySelectorAll('input[name="join-mode"]');
  const partnerFields = document.getElementById('partner-fields');
  const partnerNickname = document.getElementById('partner-nickname');
  const partnerSkill = document.getElementById('partner-skill');
  const joinBtn = document.getElementById('join-btn');

  // Populate partner autocomplete
  loadRegisteredPlayers().then(populatePartnerDatalist);

  // Resolve partner_player_id when a name is picked from the datalist
  if (partnerNickname) {
    partnerNickname.addEventListener('input', () => {
      const hidden = document.getElementById('partner-player-id');
      const match = _registeredPlayers.find(p => p.name === partnerNickname.value);
      if (hidden) hidden.value = match ? match.id : '';
    });
  }

  function update() {
    const mode = document.querySelector('input[name="join-mode"]:checked')?.value;
    if (mode === 'solo') {
      partnerFields.classList.add('hidden');
      partnerNickname.removeAttribute('required');
      partnerSkill.removeAttribute('required');
      joinBtn.textContent = 'Join Solo Pool \u2192';
    } else {
      partnerFields.classList.remove('hidden');
      partnerNickname.setAttribute('required', '');
      partnerSkill.setAttribute('required', '');
      joinBtn.textContent = 'Join Queue \u2192';
    }
  }

  radios.forEach(r => r.addEventListener('change', update));
  update();
}

function render(state, prevState) {
  const identity = getIdentity();

  // Check for state transitions
  if (prevState && identity) {
    const prevInfo = getUserGameInfo(prevState, identity);
    const currInfo = getUserGameInfo(state, identity);

    // queue → playing: it's the player's turn
    if (prevInfo && prevInfo.location === 'queue' && currInfo && currInfo.location === 'playing') {
      alertPlayerTurn();
    }
    if (prevInfo && prevInfo.location === 'pool' && currInfo && currInfo.location !== 'pool') {
      const partner = currInfo.game.players.find(p => p.nickname !== identity.nickname);
      if (partner) {
        showNotification(`\ud83c\udf89 You've been paired with ${partner.nickname}!`);
        setIdentity({ ...getTableIdentity(), gameId: currInfo.game.id });
        subscribeToPush(currInfo.game.id);
      }
    }
  }

  renderCurrentGame(state, identity);
  renderQueue(state, identity);
  renderSoloPool(state, identity);

  // Only re-render form if table type or status changed
  if (!prevState || prevState.status !== state.status || prevState.type !== state.type) {
    renderForm(state);
  }

  // Update header badges
  const typeBadge = document.getElementById('type-badge');
  if (typeBadge) {
    typeBadge.className = `badge badge--${state.type}`;
    typeBadge.textContent = state.type === 'singles' ? 'Singles' : 'Doubles';
  }
  const statusBadge = document.getElementById('status-badge');
  if (statusBadge) {
    const labels = { open: 'Open', playing: 'Playing', closed: 'Closed' };
    statusBadge.className = `badge badge--${state.status}`;
    statusBadge.textContent = labels[state.status] || state.status;
  }
}

// ── Actions ───────────────────────────────────────────────────────────────────

async function submitJoin(event) {
  event.preventDefault();
  const form = event.target;
  const btn = form.querySelector('[type="submit"]');
  btn.disabled = true;
  btn.textContent = 'Joining…';

  const reg = getRegistration();
  const nickname = reg ? reg.name : form.querySelector('#nickname').value.trim();
  const skill = form.querySelector('#skill').value;
  const mode = form.closest('.form-stack')?.querySelector('input[name="join-mode"]:checked')?.value || 'pair';

  try {
    if (tableState.type === 'singles' || mode === 'pair') {
      const body = { nickname, skill, player_id: reg ? reg.playerId : null };
      if (tableState.type === 'doubles') {
        body.partner_nickname = form.querySelector('#partner-nickname').value.trim();
        body.partner_skill = form.querySelector('#partner-skill').value;
        const partnerIdEl = form.querySelector('#partner-player-id');
        if (partnerIdEl && partnerIdEl.value) body.partner_player_id = partnerIdEl.value;
      }
      const res = await fetch(`/table/${tableId}/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: 'Error joining' }));
        throw new Error(err.detail || 'Error joining');
      }
      const data = await res.json();
      setIdentity({ gameId: data.game_id, type: tableState.type === 'singles' ? 'singles' : 'doubles_pair' });
      showNotification(data.position === 0 ? '\ud83c\udfd3 You\'re up \u2014 good luck!' : `\u2713 Joined! You're #${data.position} in the queue`);
      if (data.position !== 0) subscribeToPush(data.game_id);
    } else {
      // Solo
      const res = await fetch(`/table/${tableId}/join-solo`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nickname, skill, player_id: reg ? reg.playerId : null }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: 'Error joining' }));
        throw new Error(err.detail || 'Error joining');
      }
      const data = await res.json();
      if (data.status === 'paired') {
        setIdentity({ gameId: data.game_id, soloPlayerId: data.player_id, type: 'doubles_solo' });
        showNotification(`\ud83c\udf89 Paired with ${data.paired_with}! You're in the queue.`);
        subscribeToPush(data.game_id);
      } else {
        setIdentity({ gameId: null, soloPlayerId: data.player_id, type: 'doubles_solo' });
        showNotification('\u23f3 Waiting for a partner\u2026');
        // Will subscribe once paired (detected via SSE in render())
      }
    }
  } catch (err) {
    showNotification(`❌ ${err.message}`, 'error');
    btn.disabled = false;
    btn.textContent = tableState?.type === 'doubles' && mode === 'solo' ? 'Join Solo Pool →' : 'Join Queue →';
  }
}

async function gameDone() {
  const btn = document.getElementById('game-done-btn');
  if (btn) btn.disabled = true;
  try {
    const res = await fetch(`/table/${tableId}/done`, { method: 'POST' });
    if (!res.ok) throw new Error('Failed');
  } catch {
    if (btn) btn.disabled = false;
  }
}

async function declareWinner(side) {
  try {
    const res = await fetch(`/table/${tableId}/winner`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ winner_side: side }),
    });
    if (!res.ok) throw new Error('Failed');
  } catch {
    showNotification('Failed to declare winner', 'error');
  }
}

// ── Notifications ─────────────────────────────────────────────────────────────

function showNotification(msg, type = 'success') {
  const existing = document.querySelector('.notification');
  if (existing) existing.remove();

  const el = document.createElement('div');
  el.className = 'notification';
  if (type === 'error') {
    el.style.background = 'var(--error)';
  }
  el.textContent = msg;
  document.body.appendChild(el);

  setTimeout(() => {
    el.classList.add('dismissing');
    setTimeout(() => el.remove(), 350);
  }, 3500);
}

// ── SSE ───────────────────────────────────────────────────────────────────────

function connectSSE() {
  if (eventSource) eventSource.close();
  eventSource = new EventSource(`/table/${tableId}/stream`);

  eventSource.onmessage = (e) => {
    try {
      const newState = JSON.parse(e.data);
      const prev = tableState;
      tableState = newState;
      render(tableState, prev);
    } catch {}
  };

  eventSource.onerror = () => {
    // EventSource will auto-reconnect; update connection indicator
    const indicator = document.getElementById('live-dot');
    if (indicator) indicator.style.background = 'var(--error)';
  };

  eventSource.onopen = () => {
    const indicator = document.getElementById('live-dot');
    if (indicator) indicator.style.background = 'var(--tertiary)';
  };
}

// ── Alert: vibrate + chime when it's the player's turn ────────────────────────

function alertPlayerTurn() {
  // Vibrate: three short pulses (works on Android; silently ignored on iOS/desktop)
  if ('vibrate' in navigator) {
    navigator.vibrate([300, 120, 300, 120, 300]);
  }
  // Chime: two ascending tones via Web Audio API (no file needed)
  try {
    const ctx = new AudioContext();
    [[440, 0], [660, 0.25]].forEach(([freq, startOffset]) => {
      const osc  = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.4, ctx.currentTime + startOffset);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + startOffset + 0.6);
      osc.start(ctx.currentTime + startOffset);
      osc.stop(ctx.currentTime + startOffset + 0.6);
    });
  } catch { /* audio not available */ }
}

// ── Push notifications ────────────────────────────────────────────────────────

function _urlBase64ToUint8Array(b64) {
  const padded = b64 + '='.repeat((4 - b64.length % 4) % 4);
  const raw = atob(padded.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
}

async function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
  try {
    await navigator.serviceWorker.register('/sw.js', { scope: '/' });
  } catch (e) {
    console.warn('SW registration failed:', e);
  }
}

/**
 * If the player already has a push subscription in the browser (from a previous
 * session or after a server restart), re-send it to the server so notifications
 * keep working without requiring a re-join.
 */
async function resubscribeIfNeeded() {
  const identity = getIdentity();
  if (!identity || !identity.gameId) return;
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;

  try {
    const reg = await navigator.serviceWorker.ready;
    const existing = await reg.pushManager.getSubscription();
    if (!existing) return;

    await fetch(`/table/${tableId}/push-subscribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ game_id: identity.gameId, subscription: existing.toJSON() }),
    });
    console.info('[PPSC] Push subscription re-registered for game', identity.gameId);
  } catch (e) {
    console.warn('[PPSC] Push re-subscribe failed:', e);
  }
}

async function subscribeToPush(gameId) {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return;

  try {
    const reg = await navigator.serviceWorker.ready;
    const keyRes = await fetch('/push/vapid-public-key');
    const { public_key } = await keyRes.json();

    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: _urlBase64ToUint8Array(public_key),
    });

    await fetch(`/table/${tableId}/push-subscribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ game_id: gameId, subscription: sub.toJSON() }),
    });
  } catch (e) {
    // Non-fatal — SSE will still keep the page live
    console.warn('Push subscribe failed:', e);
  }
}

// ── Escape HTML ───────────────────────────────────────────────────────────────

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── Init ──────────────────────────────────────────────────────────────────────

async function init() {
  registerServiceWorker();   // non-blocking, fires and forgets

  const app = document.getElementById('app');
  if (!tableId) {
    app.innerHTML = `<div class="error-state"><div class="error-icon">\u26a0\ufe0f</div><p>No table ID found in URL.</p></div>`;
    return;
  }

  // Registration gate: redirect to /register if not registered
  const registration = getRegistration();
  if (!registration) {
    window.location.href = `/register?next=${encodeURIComponent(window.location.pathname)}`;
    return;
  }
  // Validate registration is still valid on server (handles server restarts)
  try {
    const checkRes = await fetch(`/register/check/${encodeURIComponent(registration.playerId)}`);
    const checkData = await checkRes.json();
    if (!checkData.valid) {
      localStorage.removeItem(PLAYER_KEY);
      window.location.href = `/register?next=${encodeURIComponent(window.location.pathname)}`;
      return;
    }
  } catch {
    // If check fails (network error), proceed anyway — the name is still in localStorage
  }

  // Show skeleton while loading
  document.getElementById('current-game-section').innerHTML = `
    <div class="skeleton" style="height:120px"></div>`;

  try {
    const res = await fetch(`/table/${tableId}/state`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    tableState = await res.json();

    // Set table name in header
    const nameEl = document.getElementById('table-name');
    if (nameEl) nameEl.textContent = tableState.name;

    render(tableState, null);
    resubscribeIfNeeded();   // restore push sub after server restart
    connectSSE();
  } catch (err) {
    document.getElementById('current-game-section').innerHTML = `
      <div class="error-state">
        <div class="error-icon">\u26a0\ufe0f</div>
        <div class="title-md">Table not found</div>
        <p class="body-md text-muted" style="margin-top:0.5rem">
          This table doesn't exist yet. Ask the host to set it up.
        </p>
      </div>
    `;
  }
}

document.addEventListener('DOMContentLoaded', init);
