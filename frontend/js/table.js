/* ═══════════════════════════════════════════════════════════════════════════
   PPSC — Table Queue Page (Vue 3 + vue-i18n)
   ═══════════════════════════════════════════════════════════════════════════ */

const tableId = window.location.pathname.split('/').filter(Boolean)[1];
const PLAYER_KEY = 'ppsc_player';
const TABLE_KEY  = `ppsc_table_${tableId}`;

// ── Module-level helpers (no reactivity needed) ───────────────────────────────

function _getRegistration() {
  try { return JSON.parse(localStorage.getItem(PLAYER_KEY) || 'null'); } catch { return null; }
}

function _getTableIdentity() {
  try { return JSON.parse(localStorage.getItem(TABLE_KEY) || 'null'); } catch { return null; }
}

function _matchPlayer(p, identity) {
  if (identity.playerId && p.registered_id) return p.registered_id === identity.playerId;
  return p.nickname === identity.nickname;
}

function _getUserGameInfo(state, identity) {
  if (!identity || !state) return null;

  if (state.current_game) {
    const p = state.current_game.players.find(p =>
      _matchPlayer(p, identity) && (identity.gameId ? state.current_game.id === identity.gameId : true)
    );
    if (p) return { location: 'playing', game: state.current_game, side: 'current' };
  }
  if (state.opponent) {
    const p = state.opponent.players.find(p =>
      _matchPlayer(p, identity) && (identity.gameId ? state.opponent.id === identity.gameId : true)
    );
    if (p) return { location: 'playing', game: state.opponent, side: 'opponent' };
  }
  for (let i = 0; i < (state.queue || []).length; i++) {
    const game = state.queue[i];
    const found = game.players.some(p =>
      _matchPlayer(p, identity) && (identity.gameId ? game.id === identity.gameId : true)
    );
    if (found) return { location: 'queue', position: i + 1, game };
  }
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

function _alertPlayerTurn() {
  if ('vibrate' in navigator) navigator.vibrate([300, 120, 300, 120, 300]);
  try {
    const ctx = new AudioContext();
    [[440, 0], [660, 0.25]].forEach(([freq, offset]) => {
      const osc  = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.4, ctx.currentTime + offset);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + offset + 0.6);
      osc.start(ctx.currentTime + offset);
      osc.stop(ctx.currentTime + offset + 0.6);
    });
  } catch { /* audio not available */ }
}

function _urlBase64ToUint8Array(b64) {
  const padded = b64 + '='.repeat((4 - b64.length % 4) % 4);
  const raw = atob(padded.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
}

async function _registerServiceWorker() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
  try {
    await navigator.serviceWorker.register('/sw.js', { scope: '/' });
  } catch (e) {
    console.warn('SW registration failed:', e);
  }
}

async function _subscribeToPush(gameId) {
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
    console.warn('Push subscribe failed:', e);
  }
}

// ── i18n setup ────────────────────────────────────────────────────────────────

const _savedLocale = localStorage.getItem('ppsc_locale') ||
  (navigator.language.startsWith('de') ? 'de' : 'en');

const _i18n = VueI18n.createI18n({
  locale: _savedLocale,
  fallbackLocale: 'en',
  messages: PPSC_MESSAGES,
});

// ── Vue app ───────────────────────────────────────────────────────────────────

Vue.createApp({

  data() {
    return {
      tableState:        null,
      loading:           true,
      error:             false,
      liveDotColor:      'var(--tertiary)',
      // Form state
      joinMode:          'pair',
      partnerNickname:   '',
      partnerSkill:      '',
      joinSubmitting:    false,
      gameDoneSubmitting: false,
      // Identity (reactive so userInfo re-computes when we join)
      registration:      _getRegistration(),
      tableIdentity:     _getTableIdentity(),
      // Autocomplete
      registeredPlayers: [],
      // Internal: SSE handle
      _eventSource:      null,
    };
  },

  computed: {
    identity() {
      const reg   = this.registration;
      const table = this.tableIdentity;
      if (!reg) return null;
      return { nickname: reg.name, playerId: reg.playerId, ...(table || {}) };
    },
    userInfo() {
      return _getUserGameInfo(this.tableState, this.identity);
    },
    soloPool() {
      return this.tableState?.solo_pool || [];
    },
    userInPool() {
      return this.userInfo?.location === 'pool';
    },
    myAvatar() {
      return this.registration?.avatar || '';
    },
    filteredRegisteredPlayers() {
      const myId = this.registration?.playerId;
      return this.registeredPlayers.filter(p => p.id !== myId);
    },
    partnerPlayerId() {
      const match = this.registeredPlayers.find(p => p.name === this.partnerNickname);
      return match ? match.id : '';
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

    // ── Helpers ─────────────────────────────────────────────────────────────

    initial(name) {
      return name ? name.charAt(0).toUpperCase() : '?';
    },

    playerAvatarUrl(p) {
      return p?.avatar || '';
    },

    teamName(game) {
      if (!game) return '';
      return game.players.map(p => p.nickname).join(' & ');
    },

    isMe(p) {
      const id = this.identity;
      if (!id) return false;
      if (id.playerId && p.registered_id) return p.registered_id === id.playerId;
      return p.nickname === id.nickname;
    },

    isInPool(p) {
      const id = this.identity;
      if (!id) return false;
      if (id.playerId && p.registered_id) return p.registered_id === id.playerId;
      if (id.soloPlayerId) return p.id === id.soloPlayerId;
      return p.nickname === id.nickname;
    },

    isUserSide(sideKey) {
      return this.userInfo?.location === 'playing' && this.userInfo?.side === sideKey;
    },

    formatWaitTime(iso) {
      if (!iso) return '';
      const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
      if (diff < 60)   return `${diff}s`;
      if (diff < 3600) return `${Math.floor(diff / 60)}m`;
      return `${Math.floor(diff / 3600)}h`;
    },

    _setTableIdentity(data) {
      localStorage.setItem(TABLE_KEY, JSON.stringify(data));
      this.tableIdentity = data;   // keep reactive copy in sync
    },

    // ── Actions ─────────────────────────────────────────────────────────────

    async submitJoin() {
      const reg = this.registration;
      if (!reg?.skill) {
        window.location.href = `/register?next=${encodeURIComponent(window.location.pathname)}`;
        return;
      }

      this.joinSubmitting = true;
      const nickname = reg.name;
      const mode     = this.joinMode;

      try {
        if (this.tableState.type === 'singles' || mode === 'pair') {
          const body = {
            nickname,
            skill:     reg.skill,
            player_id: reg.playerId,
            avatar:    reg.avatar || undefined,
          };
          if (this.tableState.type === 'doubles') {
            body.partner_nickname = this.partnerNickname;
            body.partner_skill    = this.partnerSkill;
            if (this.partnerPlayerId) body.partner_player_id = this.partnerPlayerId;
            const partner = this.registeredPlayers.find(p => p.name === this.partnerNickname);
            if (partner?.avatar) body.partner_avatar = partner.avatar;
          }
          const res = await fetch(`/table/${tableId}/join`, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify(body),
          });
          if (!res.ok) {
            const err = await res.json().catch(() => ({ detail: 'Error joining' }));
            throw new Error(err.detail || 'Error joining');
          }
          const data = await res.json();
          this._setTableIdentity({
            gameId: data.game_id,
            type:   this.tableState.type === 'singles' ? 'singles' : 'doubles_pair',
          });
          this.showNotification(
            data.position === 0
              ? this.$t('youreUpNotif')
              : this.$t('joinedPosition', { position: data.position })
          );
          if (data.position !== 0) _subscribeToPush(data.game_id);
        } else {
          // Solo pool
          const res = await fetch(`/table/${tableId}/join-solo`, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ nickname, skill: reg.skill, player_id: reg.playerId, avatar: reg.avatar || undefined }),
          });
          if (!res.ok) {
            const err = await res.json().catch(() => ({ detail: 'Error joining' }));
            throw new Error(err.detail || 'Error joining');
          }
          const data = await res.json();
          if (data.status === 'paired') {
            this._setTableIdentity({ gameId: data.game_id, soloPlayerId: data.player_id, type: 'doubles_solo' });
            this.showNotification(this.$t('pairedWith', { name: data.paired_with }));
            _subscribeToPush(data.game_id);
          } else {
            this._setTableIdentity({ gameId: null, soloPlayerId: data.player_id, type: 'doubles_solo' });
            this.showNotification(this.$t('waitingPartnerNotif'));
          }
        }
      } catch (err) {
        this.showNotification(`❌ ${err.message}`, 'error');
      } finally {
        this.joinSubmitting = false;
      }
    },

    async gameDone() {
      this.gameDoneSubmitting = true;
      try {
        const res = await fetch(`/table/${tableId}/done`, { method: 'POST' });
        if (!res.ok) throw new Error('Failed');
      } catch { /* SSE will reflect the updated state */ }
      finally { this.gameDoneSubmitting = false; }
    },

    async declareWinner(side) {
      try {
        const res = await fetch(`/table/${tableId}/winner`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ winner_side: side }),
        });
        if (!res.ok) throw new Error('Failed');
      } catch {
        this.showNotification(this.$t('failedWinner'), 'error');
      }
    },

    // ── Notifications ────────────────────────────────────────────────────────

    showNotification(msg, type = 'success') {
      const existing = document.querySelector('.notification');
      if (existing) existing.remove();
      const el = document.createElement('div');
      el.className = 'notification';
      if (type === 'error') el.style.background = 'var(--error)';
      el.textContent = msg;
      document.body.appendChild(el);
      setTimeout(() => {
        el.classList.add('dismissing');
        setTimeout(() => el.remove(), 350);
      }, 3500);
    },

    // ── SSE ──────────────────────────────────────────────────────────────────

    connectSSE() {
      if (this._eventSource) this._eventSource.close();
      this._eventSource = new EventSource(`/table/${tableId}/stream`);

      this._eventSource.onmessage = (e) => {
        try {
          const newState = JSON.parse(e.data);
          this._checkTransitions(this.tableState, newState);
          this.tableState = newState;
        } catch { /* ignore malformed events */ }
      };

      this._eventSource.onerror = () => { this.liveDotColor = 'var(--error)'; };
      this._eventSource.onopen  = () => { this.liveDotColor = 'var(--tertiary)'; };
    },

    _checkTransitions(prevState, newState) {
      const id = this.identity;
      if (!prevState || !id) return;
      const prevInfo = _getUserGameInfo(prevState, id);
      const currInfo = _getUserGameInfo(newState, id);

      // queue → playing: it's the player's turn
      if (prevInfo?.location === 'queue' && currInfo?.location === 'playing') {
        _alertPlayerTurn();
      }
      // pool → paired
      if (prevInfo?.location === 'pool' && currInfo?.location !== 'pool') {
        const partner = currInfo?.game?.players.find(p => p.nickname !== id.nickname);
        if (partner) {
          this.showNotification(this.$t('pairedWith', { name: partner.nickname }));
          this._setTableIdentity({ ..._getTableIdentity(), gameId: currInfo.game.id });
          _subscribeToPush(currInfo.game.id);
        }
      }
    },

    // ── Push notifications ───────────────────────────────────────────────────

    async _resubscribeIfNeeded() {
      const id = this.identity;
      if (!id?.gameId) return;
      if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
      try {
        const reg      = await navigator.serviceWorker.ready;
        const existing = await reg.pushManager.getSubscription();
        if (!existing) return;
        await fetch(`/table/${tableId}/push-subscribe`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ game_id: id.gameId, subscription: existing.toJSON() }),
        });
      } catch (e) {
        console.warn('[PPSC] Push re-subscribe failed:', e);
      }
    },

    // ── Registered players (partner autocomplete) ────────────────────────────

    async loadRegisteredPlayers() {
      try {
        const res = await fetch('/players');
        if (res.ok) this.registeredPlayers = await res.json();
      } catch { /* non-fatal */ }
    },
  },

  // ── Lifecycle ────────────────────────────────────────────────────────────────

  async mounted() {
    document.documentElement.lang = this.$i18n.locale;
    _registerServiceWorker();

    if (!tableId) {
      this.loading = false;
      this.error   = true;
      return;
    }

    // Registration gate
    const reg = this.registration;
    if (!reg) {
      window.location.href = `/register?next=${encodeURIComponent(window.location.pathname)}`;
      return;
    }

    // Validate registration is still live on the server (handles server restarts)
    try {
      const checkRes  = await fetch(`/register/check/${encodeURIComponent(reg.playerId)}`);
      const checkData = await checkRes.json();
      if (!checkData.valid) {
        localStorage.removeItem(PLAYER_KEY);
        window.location.href = `/register?next=${encodeURIComponent(window.location.pathname)}`;
        return;
      }
    } catch { /* network error — proceed anyway, name is in localStorage */ }

    try {
      const res = await fetch(`/table/${tableId}/state`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      this.tableState = await res.json();
      this.loading    = false;
      this._resubscribeIfNeeded();
      this.connectSSE();
      this.loadRegisteredPlayers();
    } catch {
      this.loading = false;
      this.error   = true;
    }
  },

  beforeUnmount() {
    if (this._eventSource) this._eventSource.close();
  },

}).use(_i18n).mount('#app');
