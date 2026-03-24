/* ═══════════════════════════════════════════════════════════════════════════
   PPSC — Admin Dashboard (Vue 3 + vue-i18n)
   ═══════════════════════════════════════════════════════════════════════════ */

// ── Module-level helpers ──────────────────────────────────────────────────────

async function api(method, path, body) {
  const opts = {
    method,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
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

function showToast(msg, type = 'success') {
  const existing = document.querySelector('.notification');
  if (existing) existing.remove();
  const el = document.createElement('div');
  el.className = 'notification';
  if (type === 'error')   el.style.background = 'var(--error)';
  if (type === 'warning') el.style.background = '#7a5c00';
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => {
    el.classList.add('dismissing');
    setTimeout(() => el.remove(), 350);
  }, 3000);
}

// ── i18n setup ────────────────────────────────────────────────────────────────

const _savedLocale = localStorage.getItem('ppsc_locale') ||
  (navigator.language.startsWith('de') ? 'de' : 'en');

const _i18n = VueI18n.createI18n({
  locale: _savedLocale,
  fallbackLocale: 'en',
  messages: PPSC_MESSAGES,
});

// ── TableCard component ───────────────────────────────────────────────────────

const TableCard = {
  name: 'TableCard',
  props: ['table'],

  template: `
    <div :class="['table-card', table.status === 'closed' ? 'table-card--closed' : '']"
         :id="'card-' + table.id">

      <!-- Card header -->
      <div class="table-card-header">
        <img src="/logo.png" class="watermark-small" alt="">
        <div class="table-card-title-row">
          <div class="table-card-name">{{ table.name }}</div>
          <div class="table-card-badges">
            <span :class="['badge', 'badge--' + table.type]">{{ $t(table.type) }}</span>
            <span :class="['badge', 'badge--' + table.status]">{{ $t('status.' + table.status) }}</span>
            <span class="admin-mode-badge">{{ modeLabel }}</span>
          </div>
        </div>
        <div class="table-card-actions-top">
          <button class="btn-icon" :title="$t('remove')" @click="deleteTable" style="color:var(--error)">🗑</button>
        </div>
      </div>

      <!-- Card body -->
      <div class="table-card-body">

        <!-- No game, open -->
        <div v-if="!table.current_game && table.status !== 'closed'"
             style="text-align:center;padding:var(--sp-3) 0;color:var(--on-surface-muted);font-size:0.85rem">
          {{ $t('tableIsOpen') }}
        </div>

        <!-- Current game: full match -->
        <div class="admin-current-game" v-if="table.current_game && table.opponent">
          <div class="admin-current-label">{{ $t('nowPlaying') }}</div>
          <div class="admin-match-arena">
            <div class="admin-match-side">
              <div class="admin-match-player" v-for="p in table.current_game.players" :key="p.nickname">
                <div class="admin-match-avatar">{{ initial(p.nickname) }}</div>
                <span class="admin-player-name">{{ p.nickname }}</span>
                <span :class="['badge', 'badge--' + p.skill]">{{ $t('skillShortAdmin.' + p.skill) }}</span>
              </div>
            </div>
            <span class="admin-match-vs">VS</span>
            <div class="admin-match-side">
              <div class="admin-match-player" v-for="p in table.opponent.players" :key="p.nickname">
                <div class="admin-match-avatar">{{ initial(p.nickname) }}</div>
                <span class="admin-player-name">{{ p.nickname }}</span>
                <span :class="['badge', 'badge--' + p.skill]">{{ $t('skillShortAdmin.' + p.skill) }}</span>
              </div>
            </div>
          </div>
          <span class="admin-mode-badge" v-if="table.play_mode === 'winner_stays' && table.current_wins > 0">
            {{ $t('winsCounter', { current: table.current_wins, max: table.max_wins }) }}
          </span>
          <!-- Winner stays winner buttons -->
          <div v-if="table.play_mode === 'winner_stays'"
               style="display:flex;gap:var(--sp-2);margin-top:var(--sp-2)">
            <button class="btn btn-ghost btn-sm"
              style="flex:1;font-size:0.72rem;padding:0.3rem 0.5rem"
              @click="declareWinner('current')">
              {{ $t('won', { name: teamName(table.current_game) }) }}
            </button>
            <button class="btn btn-ghost btn-sm"
              style="flex:1;font-size:0.72rem;padding:0.3rem 0.5rem"
              @click="declareWinner('opponent')">
              {{ $t('won', { name: teamName(table.opponent) }) }}
            </button>
          </div>
          <!-- Rotation end-game button -->
          <button v-else class="btn btn-ghost btn-sm"
            style="margin-top:var(--sp-2);color:var(--on-surface-muted);font-size:0.78rem"
            @click="removeGame(table.current_game.id)">
            {{ $t('endGame') }}
          </button>
        </div>

        <!-- Current game: waiting for opponent -->
        <div class="admin-current-game" v-else-if="table.current_game">
          <div class="admin-current-label">{{ $t('waitingForOpponentAdmin') }}</div>
          <div class="admin-player-row" v-for="p in table.current_game.players" :key="p.nickname">
            <div class="admin-player-info">
              <span class="admin-player-name">{{ p.nickname }}</span>
              <span :class="['badge', 'badge--' + p.skill]">{{ $t('skillShortAdmin.' + p.skill) }}</span>
            </div>
          </div>
          <button class="btn btn-ghost btn-sm"
            style="margin-top:0.5rem;color:var(--on-surface-muted);font-size:0.78rem"
            @click="removeGame(table.current_game.id)">
            {{ $t('remove') }}
          </button>
        </div>

        <!-- Queue -->
        <div v-if="table.queue && table.queue.length > 0">
          <div class="admin-queue-label">
            {{ $t('queueLabel') }}
            <span class="admin-queue-count">{{ table.queue.length }}</span>
          </div>
          <div class="admin-queue-list">
            <div class="admin-queue-item" v-for="(game, idx) in table.queue" :key="game.id">
              <span class="admin-queue-pos">{{ idx + 1 }}</span>
              <div class="admin-queue-item-info">
                <div class="admin-queue-names">{{ queueNames(game) }}</div>
                <div class="admin-queue-skills">
                  <span v-for="p in game.players" :key="p.nickname"
                    :class="['badge', 'badge--' + p.skill]">
                    {{ $t('skillShortAdmin.' + p.skill) }}
                  </span>
                </div>
              </div>
              <div class="admin-queue-item-actions">
                <button v-if="idx > 0" class="btn-icon" :title="$t('moveUp')"
                  @click="moveUp(game.id)">↑</button>
                <button class="btn-icon" :title="$t('remove')"
                  style="color:var(--error)" @click="removeGame(game.id)">✕</button>
              </div>
            </div>
          </div>
        </div>
        <div class="admin-empty"
          v-else-if="table.status !== 'open' || table.current_game">
          {{ $t('queueEmpty') }}
        </div>

        <!-- Solo pool (doubles only) -->
        <div class="admin-solo-pool"
          v-if="table.type === 'doubles' && table.solo_pool && table.solo_pool.length > 0">
          <div class="admin-solo-label">
            {{ $t('partnerPool', { count: table.solo_pool.length }) }}
          </div>
          <div class="admin-solo-item" v-for="p in table.solo_pool" :key="p.id">
            <div class="admin-solo-info">
              <div class="solo-waiting-icon"></div>
              <span class="admin-solo-name">{{ p.nickname }}</span>
              <span :class="['badge', 'badge--' + p.skill]">{{ $t('skillShortAdmin.' + p.skill) }}</span>
            </div>
            <button class="btn-icon" :title="$t('remove')"
              style="color:var(--error)" @click="removeSolo(p.id)">✕</button>
          </div>
        </div>

      </div>

      <!-- Card footer -->
      <div class="table-card-footer">
        <button class="btn btn-secondary btn-sm" @click="advanceQueue" :disabled="!hasAnything">
          {{ $t('advance') }}
        </button>
        <button class="btn btn-secondary btn-sm" @click="clearQueue" :disabled="!hasAnything">
          {{ $t('clear') }}
        </button>
        <button class="btn btn-secondary btn-sm" @click="toggleStatus">
          {{ table.status === 'closed' ? $t('openTable') : $t('closeTable') }}
        </button>
        <a :href="'/table/' + table.id" target="_blank" class="btn btn-ghost btn-sm" title="Preview">↗</a>
      </div>
    </div>
  `,

  computed: {
    modeLabel() {
      return this.table.play_mode === 'winner_stays'
        ? this.$t('winnerStaysShort', { max: this.table.max_wins })
        : this.$t('rotation');
    },
    hasAnything() {
      return !!(
        this.table.current_game ||
        (this.table.queue && this.table.queue.length > 0) ||
        (this.table.solo_pool && this.table.solo_pool.length > 0)
      );
    },
  },

  methods: {
    initial(name) { return name ? name.charAt(0).toUpperCase() : '?'; },
    teamName(game) { return game ? game.players.map(p => p.nickname).join(' & ') : ''; },
    queueNames(game) { return game.players.map(p => p.nickname).join(' & '); },

    async advanceQueue() {
      try { await api('POST', `/admin/tables/${this.table.id}/advance`); }
      catch (e) { showToast(this.$t('errorMsg', { msg: e.message }), 'error'); }
    },

    async clearQueue() {
      if (!confirm(this.$t('clearQueueConfirm'))) return;
      try {
        await api('POST', `/admin/tables/${this.table.id}/clear`);
        showToast(this.$t('queueCleared'));
      } catch (e) { showToast(this.$t('errorMsg', { msg: e.message }), 'error'); }
    },

    async toggleStatus() {
      try {
        if (this.table.status === 'closed') {
          await api('POST', `/admin/tables/${this.table.id}/open`);
          showToast(this.$t('tableOpenedToast'));
        } else {
          await api('POST', `/admin/tables/${this.table.id}/close`);
          showToast(this.$t('tableClosedToast'));
        }
      } catch (e) { showToast(this.$t('errorMsg', { msg: e.message }), 'error'); }
    },

    async removeGame(gameId) {
      try {
        await api('DELETE', `/admin/tables/${this.table.id}/queue/${gameId}`);
        showToast(this.$t('entryRemoved'));
      } catch (e) { showToast(this.$t('errorMsg', { msg: e.message }), 'error'); }
    },

    async moveUp(gameId) {
      try { await api('POST', `/admin/tables/${this.table.id}/queue/${gameId}/move-up`); }
      catch (e) { showToast(this.$t('errorMsg', { msg: e.message }), 'error'); }
    },

    async removeSolo(playerId) {
      try {
        await api('DELETE', `/admin/tables/${this.table.id}/solo/${playerId}`);
        showToast(this.$t('playerRemovedPool'));
      } catch (e) { showToast(this.$t('errorMsg', { msg: e.message }), 'error'); }
    },

    async deleteTable() {
      if (!confirm(this.$t('deleteTableConfirm', { name: this.table.name }))) return;
      try {
        await api('DELETE', `/admin/tables/${this.table.id}`);
        showToast(this.$t('tableDeleted', { name: this.table.name }));
      } catch (e) { showToast(this.$t('errorMsg', { msg: e.message }), 'error'); }
    },

    async declareWinner(side) {
      try { await api('POST', `/table/${this.table.id}/winner`, { winner_side: side }); }
      catch (e) { showToast(this.$t('errorMsg', { msg: e.message }), 'error'); }
    },
  },
};

// ── Main app ──────────────────────────────────────────────────────────────────

const app = Vue.createApp({

  components: { TableCard },

  data() {
    return {
      tables:         {},   // { [id]: Table }
      initialLoaded:  false,
      liveDotColor:   'var(--tertiary)',
      // Create modal
      showModal:      false,
      createError:    '',
      createSubmitting: false,
      form: {
        name:             '',
        type:             '',
        playMode:         'rotation',
        maxWins:          3,
        id:               '',
        idManuallyEdited: false,
      },
      _eventSource: null,
    };
  },

  computed: {
    tableList() { return Object.values(this.tables); },
    tableCount() { return Object.keys(this.tables).length; },
  },

  watch: {
    'form.name'(val) {
      if (!this.form.idManuallyEdited) {
        this.form.id = val.toLowerCase()
          .replace(/\s+/g, '-')
          .replace(/[^a-z0-9-]/g, '')
          .slice(0, 50);
      }
    },
  },

  methods: {

    // ── Locale ──────────────────────────────────────────────────────────────

    toggleLocale() {
      const next = this.$i18n.locale === 'de' ? 'en' : 'de';
      this.$i18n.locale = next;
      localStorage.setItem('ppsc_locale', next);
      document.documentElement.lang = next;
    },

    // ── Modal ────────────────────────────────────────────────────────────────

    openCreateModal() {
      this.showModal   = true;
      this.createError = '';
      this.$nextTick(() => this.$refs.nameInput?.focus());
    },

    closeCreateModal() {
      this.showModal = false;
      this.createError = '';
      this.createSubmitting = false;
      this.form = { name: '', type: '', playMode: 'rotation', maxWins: 3, id: '', idManuallyEdited: false };
    },

    async submitCreateTable() {
      const { name, type, playMode, maxWins, id: rawId } = this.form;
      const finalId = rawId ||
        name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');

      if (!name || !type || !finalId) {
        this.createError = this.$t('allFieldsRequired');
        return;
      }
      if (!/^[a-z0-9-]+$/.test(finalId)) {
        this.createError = this.$t('invalidId');
        return;
      }

      this.createSubmitting = true;
      this.createError = '';
      try {
        await api('POST', '/admin/tables', {
          id: finalId, name, type,
          play_mode: playMode,
          max_wins:  maxWins,
        });
        this.closeCreateModal();
        showToast(this.$t('tableCreated', { name }));
      } catch (e) {
        this.createError = e.message;
        this.createSubmitting = false;
      }
    },

    // ── SSE ──────────────────────────────────────────────────────────────────

    connectSSE() {
      if (this._eventSource) this._eventSource.close();
      this._eventSource = new EventSource('/admin/stream', { withCredentials: true });

      this._eventSource.onmessage = (e) => {
        try {
          this.tables = JSON.parse(e.data);
        } catch { /* ignore malformed events */ }
      };

      this._eventSource.onerror = () => { this.liveDotColor = 'var(--error)'; };
      this._eventSource.onopen  = () => { this.liveDotColor = 'var(--tertiary)'; };
    },
  },

  async mounted() {
    document.documentElement.lang = this.$i18n.locale;

    // Auth check
    const res = await fetch('/admin/state', { credentials: 'include' });
    if (res.status === 401) { window.location.href = '/admin/login'; return; }

    try {
      const data = await api('GET', '/admin/state');
      if (data) this.tables = data;
    } catch (e) {
      showToast(this.$t('failedLoadState', { msg: e.message }), 'error');
    }

    this.initialLoaded = true;
    this.connectSSE();

    // Close modal on Escape
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.showModal) this.closeCreateModal();
    });
  },

  beforeUnmount() {
    if (this._eventSource) this._eventSource.close();
  },
});

app.use(_i18n).mount('#app');
