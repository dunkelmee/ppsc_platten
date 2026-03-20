/* ═══════════════════════════════════════════════════════════════════════════
   PPSC — Admin Dashboard
   ═══════════════════════════════════════════════════════════════════════════ */

let tablesState = {};   // { [table_id]: Table }
let eventSource = null;
let adminKey = null;    // from cookie; used as fallback for SSE ?key= param

// ── Auth check ────────────────────────────────────────────────────────────────

async function checkAuth() {
  const res = await fetch('/admin/state', { credentials: 'include' });
  if (res.status === 401) {
    window.location.href = '/admin/login';
    return false;
  }
  return true;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function skillBadge(skill) {
  const labels = { beginner: 'Beg', intermediate: 'Int', advanced: 'Adv' };
  return `<span class="badge badge--${skill}">${labels[skill] || skill}</span>`;
}

function playerInitial(nickname) {
  return escHtml(nickname.charAt(0).toUpperCase());
}

function formatTime(iso) {
  if (!iso) return '';
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60) return `${diff}s`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  return `${Math.floor(diff / 3600)}h`;
}

function showToast(msg, type = 'success') {
  const existing = document.querySelector('.notification');
  if (existing) existing.remove();
  const el = document.createElement('div');
  el.className = 'notification';
  if (type === 'error') el.style.background = 'var(--error)';
  if (type === 'warning') el.style.background = '#7a5c00';
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => {
    el.classList.add('dismissing');
    setTimeout(() => el.remove(), 350);
  }, 3000);
}

// ── API calls ─────────────────────────────────────────────────────────────────

async function api(method, path, body) {
  const opts = {
    method,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', 'X-Admin-Key': adminKey || '' },
  };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const res = await fetch(path, opts);
  if (res.status === 401) { window.location.href = '/admin/login'; return null; }
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || res.statusText);
  }
  if (res.status === 204) return null;
  return res.json().catch(() => null);
}

// ── Queue actions ─────────────────────────────────────────────────────────────

async function advanceQueue(tableId) {
  try {
    await api('POST', `/admin/tables/${tableId}/advance`);
  } catch (e) { showToast(`Error: ${e.message}`, 'error'); }
}

async function clearQueue(tableId) {
  if (!confirm(`Clear entire queue for this table? This cannot be undone.`)) return;
  try {
    await api('POST', `/admin/tables/${tableId}/clear`);
    showToast('Queue cleared');
  } catch (e) { showToast(`Error: ${e.message}`, 'error'); }
}

async function toggleTableStatus(tableId, currentStatus) {
  try {
    if (currentStatus === 'closed') {
      await api('POST', `/admin/tables/${tableId}/open`);
      showToast('Table opened');
    } else {
      await api('POST', `/admin/tables/${tableId}/close`);
      showToast('Table closed');
    }
  } catch (e) { showToast(`Error: ${e.message}`, 'error'); }
}

async function removeGame(tableId, gameId) {
  try {
    await api('DELETE', `/admin/tables/${tableId}/queue/${gameId}`);
    showToast('Entry removed');
  } catch (e) { showToast(`Error: ${e.message}`, 'error'); }
}

async function moveUp(tableId, gameId) {
  try {
    await api('POST', `/admin/tables/${tableId}/queue/${gameId}/move-up`);
  } catch (e) { showToast(`Error: ${e.message}`, 'error'); }
}

async function removeSolo(tableId, playerId) {
  try {
    await api('DELETE', `/admin/tables/${tableId}/solo/${playerId}`);
    showToast('Player removed from pool');
  } catch (e) { showToast(`Error: ${e.message}`, 'error'); }
}

async function deleteTable(tableId, tableName) {
  if (!confirm(`Delete table "${tableName}"? This cannot be undone.`)) return;
  try {
    await api('DELETE', `/admin/tables/${tableId}`);
    showToast(`Table "${tableName}" deleted`);
  } catch (e) { showToast(`Error: ${e.message}`, 'error'); }
}

async function declareWinnerAdmin(tableId, side) {
  try {
    await api('POST', `/table/${tableId}/winner`, { winner_side: side });
  } catch (e) { showToast(`Error: ${e.message}`, 'error'); }
}

// ── Create table ──────────────────────────────────────────────────────────────

function openCreateModal() {
  document.getElementById('create-modal').classList.remove('hidden');
  document.getElementById('new-table-name').focus();
}

function closeCreateModal() {
  document.getElementById('create-modal').classList.add('hidden');
  document.getElementById('create-form').reset();
  document.getElementById('create-error').textContent = '';
  // Reset max wins visibility
  document.getElementById('max-wins-group')?.classList.add('hidden');
}

async function submitCreateTable(event) {
  event.preventDefault();
  const form = event.target;
  const name = form.querySelector('#new-table-name').value.trim();
  const type = form.querySelector('#new-table-type').value;
  const playMode = form.querySelector('#new-table-mode').value;
  const maxWins = parseInt(form.querySelector('#new-table-max-wins')?.value || '3', 10);
  const rawId = form.querySelector('#new-table-id').value.trim() ||
    name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');

  const errEl = document.getElementById('create-error');
  if (!name || !type || !rawId) {
    errEl.textContent = 'All fields are required.';
    return;
  }
  if (!/^[a-z0-9-]+$/.test(rawId)) {
    errEl.textContent = 'ID must be lowercase letters, numbers, and hyphens only.';
    return;
  }

  const btn = form.querySelector('[type="submit"]');
  btn.disabled = true;
  errEl.textContent = '';

  try {
    await api('POST', '/admin/tables', {
      id: rawId, name, type,
      play_mode: playMode,
      max_wins: maxWins,
    });
    closeCreateModal();
    showToast(`Table "${name}" created`);
  } catch (e) {
    errEl.textContent = e.message;
    btn.disabled = false;
  }
}

// Auto-generate ID from name
function setupIdAutoGen() {
  const nameInput = document.getElementById('new-table-name');
  const idInput = document.getElementById('new-table-id');
  if (!nameInput || !idInput) return;
  nameInput.addEventListener('input', () => {
    if (!idInput.dataset.edited) {
      idInput.value = nameInput.value.toLowerCase()
        .replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '').slice(0, 50);
    }
  });
  idInput.addEventListener('input', () => { idInput.dataset.edited = '1'; });
}

// Play mode toggle: show/hide max wins field
function setupPlayModeToggle() {
  const modeSelect = document.getElementById('new-table-mode');
  const maxWinsGroup = document.getElementById('max-wins-group');
  if (!modeSelect || !maxWinsGroup) return;

  modeSelect.addEventListener('change', () => {
    if (modeSelect.value === 'winner_stays') {
      maxWinsGroup.classList.remove('hidden');
    } else {
      maxWinsGroup.classList.add('hidden');
    }
  });
}

// ── Render ────────────────────────────────────────────────────────────────────

function renderAdminMatchSide(game, isDoubles) {
  if (!game) return '';
  return game.players.map(p => `
    <div class="admin-match-player">
      <div class="admin-match-avatar" style="${isDoubles ? '' : ''}">
        ${playerInitial(p.nickname)}
      </div>
      <span class="admin-player-name">${escHtml(p.nickname)}</span>
      ${skillBadge(p.skill)}
    </div>
  `).join('');
}

function renderTableCard(table) {
  const isClosed = table.status === 'closed';
  const isDoubles = table.type === 'doubles';
  const isWinnerStays = table.play_mode === 'winner_stays';

  // Current match section
  let currentGameHtml = '';
  if (table.current_game && table.opponent) {
    // Full match — show both sides
    const sideA = renderAdminMatchSide(table.current_game, isDoubles);
    const sideB = renderAdminMatchSide(table.opponent, isDoubles);

    let actionsHtml = '';
    if (isWinnerStays) {
      const nameA = table.current_game.players.map(p => escHtml(p.nickname)).join(' & ');
      const nameB = table.opponent.players.map(p => escHtml(p.nickname)).join(' & ');
      actionsHtml = `
        <div style="display:flex;gap:var(--sp-2);margin-top:var(--sp-2)">
          <button class="btn btn-ghost btn-sm" style="flex:1;font-size:0.72rem;padding:0.3rem 0.5rem"
            onclick="declareWinnerAdmin('${escHtml(table.id)}','current')">
            ${nameA} won
          </button>
          <button class="btn btn-ghost btn-sm" style="flex:1;font-size:0.72rem;padding:0.3rem 0.5rem"
            onclick="declareWinnerAdmin('${escHtml(table.id)}','opponent')">
            ${nameB} won
          </button>
        </div>
      `;
    } else {
      actionsHtml = `
        <button class="btn btn-ghost btn-sm" style="margin-top:var(--sp-2);color:var(--on-surface-muted);font-size:0.78rem"
          onclick="removeGame('${escHtml(table.id)}', '${escHtml(table.current_game.id)}')">
          ✕ End game
        </button>
      `;
    }

    currentGameHtml = `
      <div class="admin-current-game">
        <div class="admin-current-label">Now Playing</div>
        <div class="admin-match-arena">
          <div class="admin-match-side">${sideA}</div>
          <span class="admin-match-vs">VS</span>
          <div class="admin-match-side">${sideB}</div>
        </div>
        ${isWinnerStays && table.current_wins > 0 ? `<span class="admin-mode-badge">Wins: ${table.current_wins}/${table.max_wins}</span>` : ''}
        ${actionsHtml}
      </div>
    `;
  } else if (table.current_game) {
    // Only one side — waiting for opponent
    const playersHtml = table.current_game.players.map(p => `
      <div class="admin-player-row">
        <div class="admin-player-info">
          <span class="admin-player-name">${escHtml(p.nickname)}</span>
          ${skillBadge(p.skill)}
        </div>
      </div>
    `).join('');
    currentGameHtml = `
      <div class="admin-current-game">
        <div class="admin-current-label">Waiting for opponent</div>
        ${playersHtml}
        <button class="btn btn-ghost btn-sm" style="margin-top:0.5rem;color:var(--on-surface-muted);font-size:0.78rem"
          onclick="removeGame('${escHtml(table.id)}', '${escHtml(table.current_game.id)}')">
          ✕ Remove
        </button>
      </div>
    `;
  }

  // Queue section
  let queueHtml = '';
  if (table.queue && table.queue.length > 0) {
    const items = table.queue.map((game, idx) => {
      const names = game.players.map(p => escHtml(p.nickname)).join(' & ');
      const badges = game.players.map(p => skillBadge(p.skill)).join(' ');
      const canMoveUp = idx > 0;
      return `
        <div class="admin-queue-item">
          <span class="admin-queue-pos">${idx + 1}</span>
          <div class="admin-queue-item-info">
            <div class="admin-queue-names">${names}</div>
            <div class="admin-queue-skills">${badges}</div>
          </div>
          <div class="admin-queue-item-actions">
            ${canMoveUp ? `<button class="btn-icon" title="Move up" onclick="moveUp('${escHtml(table.id)}','${escHtml(game.id)}')">↑</button>` : ''}
            <button class="btn-icon" title="Remove" style="color:var(--error)" onclick="removeGame('${escHtml(table.id)}','${escHtml(game.id)}')">✕</button>
          </div>
        </div>
      `;
    }).join('');
    queueHtml = `
      <div>
        <div class="admin-queue-label">
          Queue
          <span class="admin-queue-count">${table.queue.length}</span>
        </div>
        <div class="admin-queue-list">${items}</div>
      </div>
    `;
  } else if (table.status !== 'open' || table.current_game) {
    queueHtml = `<div class="admin-empty">Queue is empty</div>`;
  }

  // Solo pool section (doubles only)
  let soloPoolHtml = '';
  if (isDoubles && table.solo_pool && table.solo_pool.length > 0) {
    const soloItems = table.solo_pool.map(p => `
      <div class="admin-solo-item">
        <div class="admin-solo-info">
          <div class="solo-waiting-icon"></div>
          <span class="admin-solo-name">${escHtml(p.nickname)}</span>
          ${skillBadge(p.skill)}
        </div>
        <button class="btn-icon" title="Remove" style="color:var(--error)" onclick="removeSolo('${escHtml(table.id)}','${escHtml(p.id)}')">✕</button>
      </div>
    `).join('');
    soloPoolHtml = `
      <div class="admin-solo-pool">
        <div class="admin-solo-label">Partner Pool (${table.solo_pool.length})</div>
        ${soloItems}
      </div>
    `;
  }

  const closeLabel = isClosed ? 'Open Table' : 'Close Table';
  const closeIcon = isClosed ? '🔓' : '🔒';

  // Play mode badge
  const modeLabel = isWinnerStays ? `Winner Stays (${table.max_wins})` : 'Rotation';

  const hasAnything = table.current_game || (table.queue && table.queue.length > 0) || (table.solo_pool && table.solo_pool.length > 0);

  return `
    <div class="table-card ${isClosed ? 'table-card--closed' : ''}" id="card-${escHtml(table.id)}">
      <div class="table-card-header">
        <img src="/logo.png" class="watermark-small" alt="">
        <div class="table-card-title-row">
          <div class="table-card-name">${escHtml(table.name)}</div>
          <div class="table-card-badges">
            <span class="badge badge--${table.type}">${table.type === 'singles' ? 'Singles' : 'Doubles'}</span>
            <span class="badge badge--${table.status}">${table.status.charAt(0).toUpperCase() + table.status.slice(1)}</span>
            <span class="admin-mode-badge">${modeLabel}</span>
          </div>
        </div>
        <div class="table-card-actions-top">
          <button class="btn-icon" title="Delete table" onclick="deleteTable('${escHtml(table.id)}','${escHtml(table.name)}')" style="color:var(--error)">🗑</button>
        </div>
      </div>

      <div class="table-card-body">
        ${!table.current_game && table.status !== 'closed' ? `
          <div style="text-align:center;padding:var(--sp-3) 0;color:var(--on-surface-muted);font-size:0.85rem">
            🏓 Table is open
          </div>
        ` : ''}
        ${currentGameHtml}
        ${queueHtml}
        ${soloPoolHtml}
      </div>

      <div class="table-card-footer">
        <button class="btn btn-secondary btn-sm" onclick="advanceQueue('${escHtml(table.id)}')"
          ${!hasAnything ? 'disabled' : ''}>
          ▶ Advance
        </button>
        <button class="btn btn-secondary btn-sm" onclick="clearQueue('${escHtml(table.id)}')"
          ${!hasAnything ? 'disabled' : ''}>
          Clear
        </button>
        <button class="btn btn-secondary btn-sm" onclick="toggleTableStatus('${escHtml(table.id)}', '${table.status}')">
          ${closeIcon} ${closeLabel}
        </button>
        <a href="/table/${escHtml(table.id)}" target="_blank" class="btn btn-ghost btn-sm" title="Preview table page">↗</a>
      </div>
    </div>
  `;
}

function renderGrid() {
  const container = document.getElementById('tables-container');
  if (!container) return;

  const tables = Object.values(tablesState);
  if (tables.length === 0) {
    container.innerHTML = `
      <div class="tables-grid">
        <button class="add-table-card" onclick="openCreateModal()">
          <div class="add-table-icon">+</div>
          <div class="add-table-label">Add your first table</div>
        </button>
      </div>
    `;
    return;
  }

  const cards = tables.map(renderTableCard).join('');
  container.innerHTML = `
    <div class="tables-grid">
      ${cards}
      <button class="add-table-card" onclick="openCreateModal()">
        <div class="add-table-icon">+</div>
        <div class="add-table-label">Add table</div>
      </button>
    </div>
  `;
}

// ── SSE ───────────────────────────────────────────────────────────────────────

function connectSSE() {
  if (eventSource) eventSource.close();

  // Pass ADMIN_PASSWORD via query param since EventSource can't set headers.
  // The password is in the session cookie anyway; this is just the SSE fallback.
  const url = `/admin/stream`;
  eventSource = new EventSource(url, { withCredentials: true });

  eventSource.onmessage = (e) => {
    try {
      const data = JSON.parse(e.data);
      // The admin stream sends the full tables dict directly
      tablesState = data;
      renderGrid();
      updateTableCount();
    } catch {}
  };

  eventSource.onerror = () => {
    const dot = document.getElementById('live-dot');
    if (dot) dot.style.background = 'var(--error)';
  };

  eventSource.onopen = () => {
    const dot = document.getElementById('live-dot');
    if (dot) dot.style.background = 'var(--tertiary)';
  };
}

function updateTableCount() {
  const el = document.getElementById('table-count');
  if (el) el.textContent = Object.keys(tablesState).length;
}

// ── Init ──────────────────────────────────────────────────────────────────────

async function init() {
  const authed = await checkAuth();
  if (!authed) return;

  try {
    const data = await api('GET', '/admin/state');
    if (data) {
      tablesState = data;
      renderGrid();
      updateTableCount();
    }
  } catch (e) {
    showToast(`Failed to load state: ${e.message}`, 'error');
  }

  connectSSE();
  setupIdAutoGen();
  setupPlayModeToggle();

  // Close modal on overlay click
  document.getElementById('create-modal')?.addEventListener('click', (e) => {
    if (e.target === document.getElementById('create-modal')) closeCreateModal();
  });

  // Keyboard shortcut: Escape closes modal
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeCreateModal();
  });
}

document.addEventListener('DOMContentLoaded', init);
