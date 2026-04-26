'use strict';

// ── Client preferences (persisted in localStorage) ────────────────────────────
const PREF_KEY = 'pokerPrefs';

const DEFAULT_PREFS = {
  deckStyle:       '2color',
  displayMode:     'formatted',
  tableColor:      'default',
  soundEnabled:    true,
  secondarySounds: true,
  chatBeep:        false,
  autoTimeBank:    true,
};

function loadPrefs() {
  try { return { ...DEFAULT_PREFS, ...JSON.parse(localStorage.getItem(PREF_KEY) || '{}') }; }
  catch { return { ...DEFAULT_PREFS }; }
}

function savePrefs(prefs) {
  localStorage.setItem(PREF_KEY, JSON.stringify(prefs));
}

function applyClientPrefs(prefs) {
  document.body.classList.toggle('four-color', prefs.deckStyle === '4color');
  document.body.classList.remove('theme-blue', 'theme-red', 'theme-purple', 'theme-black');
  if (prefs.tableColor !== 'default') document.body.classList.add(`theme-${prefs.tableColor}`);
  if (typeof Sounds !== 'undefined') Sounds.setMuted(!prefs.soundEnabled);
}

// Apply saved prefs immediately on page load
applyClientPrefs(loadPrefs());

// ── Modal open / close ────────────────────────────────────────────────────────
function openSettings() {
  const prefs = loadPrefs();
  if (typeof state !== 'undefined' && state) {
    loadSettingsIntoForm(state);
    populatePlayersTab(state);
  }
  loadPrefsIntoForm(prefs);
  document.getElementById('sdlg-room').textContent =
    typeof ROOM_ID !== 'undefined' ? `Room: ${ROOM_ID}` : '';
  document.getElementById('settings-overlay').classList.add('open');
}

function closeSettings() {
  document.getElementById('settings-overlay').classList.remove('open');
}

function overlayClick(e) {
  if (e.target === document.getElementById('settings-overlay')) closeSettings();
}

// ── Tab switching ─────────────────────────────────────────────────────────────
function settingsTab(name) {
  document.querySelectorAll('.sdlg-tab').forEach(t =>
    t.classList.toggle('active', t.dataset.stab === name)
  );
  document.querySelectorAll('.sdlg-panel').forEach(p =>
    p.classList.toggle('active', p.id === `stab-${name}`)
  );
  if (name === 'players' && typeof state !== 'undefined' && state) populatePlayersTab(state);
}

// ── Radio group helpers ───────────────────────────────────────────────────────
function radioSelect(btn) {
  const group = btn.dataset.group;
  document.querySelectorAll(`.radio-opt[data-group="${group}"]`).forEach(b =>
    b.classList.toggle('active', b === btn)
  );
}

function radioVal(group) {
  const el = document.querySelector(`.radio-opt[data-group="${group}"].active`);
  return el ? el.dataset.val : null;
}

// ── Color swatches ────────────────────────────────────────────────────────────
function selectColor(swatch) {
  document.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('selected'));
  swatch.classList.add('selected');
}

// ── Load server settings → form ───────────────────────────────────────────────
function loadSettingsIntoForm(s) {
  if (!s) return;
  const st = s.settings || {};

  _sv('s-sb',            s.smallBlind);
  _sv('s-bb',            s.bigBlind);
  _sv('s-chips',         s.startingChips || 1000);
  _sv('s-ante-amt',      st.anteAmount   || 0);
  _sc('s-ante',          !!st.anteEnabled);
  _sc('s-straddle',      !!st.straddleEnabled);
  _sc('s-rabbit',        !!st.rabbitHunting);
  _sc('s-bombpot',       !!st.bombPotEnabled);
  _sv('s-bomb-amt',      st.bombPotAmount || 0);
  _sv('s-bounty72',      st.bounty72     || 0);
  _sc('s-reveal-allin',  st.revealAllIn  !== false);
  _sc('s-deal-away',     !!st.dealToAway);
  _sc('s-autotrim',      st.autoTrimBets !== false);
  _sc('s-spectators',    st.spectatorsAllowed !== false);
  _sc('s-guest-chat',    st.guestChatEnabled  !== false);

  _sv('s-decision-time',   st.decisionTime             || 0);
  _sv('s-timebank-len',    st.timeBankLength            !== undefined ? st.timeBankLength : 30);
  _sv('s-timebank-hands',  st.timeBankRechargeHands     !== undefined ? st.timeBankRechargeHands : 10);
  _sc('s-autostart',       !!st.autoStart);
  _sv('s-autostart-delay', st.autoStartDelay            || 5);

  _sr('rit',     st.runItTwice  || 'no');
  _sr('sdspeed', String(st.showdownTime || 6));

  // Bomb amount row visibility
  const bombRow = document.getElementById('bomb-amt-row');
  if (bombRow) bombRow.style.display = st.bombPotEnabled ? '' : 'none';
  const bombCk = document.getElementById('s-bombpot');
  if (bombCk) bombCk.onchange = function () {
    if (bombRow) bombRow.style.display = this.checked ? '' : 'none';
  };

  // Lock game/timing controls for non-hosts
  const amHost = typeof isHost !== 'undefined' && isHost;
  ['#stab-game', '#stab-timing'].forEach(sel => {
    document.querySelectorAll(`${sel} input, ${sel} select`).forEach(el => {
      el.disabled = !amHost;
    });
    document.querySelectorAll(`${sel} .radio-opt`).forEach(el => {
      el.disabled = !amHost;
      el.style.pointerEvents = amHost ? '' : 'none';
      el.style.opacity       = amHost ? '' : '0.45';
    });
  });

  const note = document.getElementById('sdlg-note');
  if (note) note.textContent = amHost ? '' : 'Only the host can change game settings.';
  const applyBtn = document.querySelector('.sdlg-footer .sfbtn.primary');
  if (applyBtn) applyBtn.textContent = amHost ? 'Apply Changes' : 'Save Preferences';
}

// ── Load prefs → form ─────────────────────────────────────────────────────────
function loadPrefsIntoForm(prefs) {
  _sr('deck',     prefs.deckStyle    || '2color');
  _sr('dispmode', prefs.displayMode  || 'formatted');
  document.querySelectorAll('.color-swatch').forEach(s =>
    s.classList.toggle('selected', s.dataset.color === (prefs.tableColor || 'default'))
  );
  _sc('p-sound',     prefs.soundEnabled    !== false);
  _sc('p-secondary', prefs.secondarySounds !== false);
  _sc('p-chatbeep',  !!prefs.chatBeep);
  _sc('p-autotb',    prefs.autoTimeBank    !== false);
}

// ── Players tab ───────────────────────────────────────────────────────────────
function populatePlayersTab(s) {
  if (!s || !s.players) return;
  const tbody = document.getElementById('players-tbody');
  if (!tbody) return;
  const amHost = typeof isHost !== 'undefined' && isHost;

  tbody.innerHTML = s.players.map(p => {
    const color   = typeof AVATAR_COLORS !== 'undefined'
      ? AVATAR_COLORS[p.seatIndex % AVATAR_COLORS.length] : '#888';
    const initial = (p.name || '?').charAt(0).toUpperCase();
    const STATUS_MAP = {
      'active':      ['status-active',      'Active'],
      'folded':      ['status-folded',       'Folded'],
      'sitting-out': ['status-sitting-out',  'Away'],
      'all-in':      ['status-all-in',       'All-In'],
    };
    const [stCls, stLbl] = STATUS_MAP[p.status] || ['status-active', 'Active'];
    const tb      = p.timeBank !== undefined ? `${p.timeBank}s` : '—';
    const isMe    = typeof myId !== 'undefined' && p.id === myId;
    const chips   = typeof formatChips === 'function' ? formatChips(p.chips) : `$${p.chips}`;

    const actions = amHost ? `
      <div class="pl-actions">
        <button class="pl-btn" onclick="plSetChips('${p.id}','${_xe(p.name)}')">Set $</button>
        <button class="pl-btn" onclick="plAddChips('${p.id}','${_xe(p.name)}')">Add $</button>
        <button class="pl-btn warn" onclick="plRebuy('${p.id}')">Rebuy</button>
        <button class="pl-btn" onclick="plSitOut('${p.id}')">${p.status === 'sitting-out' ? 'Sit In' : 'Sit Out'}</button>
        ${!isMe ? `<button class="pl-btn danger" onclick="plKick('${p.id}')">Kick</button>` : ''}
      </div>` : '<span style="color:var(--muted);font-size:.75rem">—</span>';

    return `<tr>
      <td>
        <div class="pl-name-cell">
          <span class="pl-avatar-sm" style="background:${color}">${_xe(initial)}</span>
          <span>${_xe(p.name)}${isMe ? ' <em style="color:var(--muted);font-size:.7rem">(you)</em>' : ''}</span>
          ${amHost ? `<button class="pl-btn" style="margin-left:6px;padding:2px 6px" onclick="plRename('${p.id}','${_xe(p.name)}')" title="Rename">✎</button>` : ''}
        </div>
      </td>
      <td>${p.seatIndex + 1}</td>
      <td class="pl-chips-cell">${chips}</td>
      <td><span class="timebank-pill">${tb}</span></td>
      <td><span class="pl-status-badge ${stCls}">${stLbl}</span></td>
      <td><input class="pl-note-input" type="text" placeholder="Note…"
           value="${_xe(p.note || '')}" maxlength="60"
           ${!amHost ? 'disabled' : ''}
           onchange="plSetNote('${p.id}',this.value)"></td>
      <td>${actions}</td>
    </tr>`;
  }).join('');
}

// ── Player tab actions ────────────────────────────────────────────────────────
function plSetChips(id, name) {
  const v = prompt(`Set chips for ${name}:`, '1000');
  if (v === null) return;
  const amount = parseInt(v, 10);
  if (isNaN(amount) || amount < 0) return showToast('Invalid amount', true);
  socket.emit('host_set_chips', { targetId: id, amount });
}

function plAddChips(id, name) {
  const v = prompt(`Add/remove chips for ${name} (negative to remove):`, '500');
  if (v === null) return;
  const amount = parseInt(v, 10);
  if (isNaN(amount)) return showToast('Invalid amount', true);
  socket.emit('host_add_chips', { targetId: id, amount });
}

function plRebuy(id)  { socket.emit('host_rebuy',   { targetId: id }); }
function plSitOut(id) { socket.emit('host_sit_out', { targetId: id }); }

function plKick(id) {
  if (confirm('Remove this player from the table?')) socket.emit('host_kick', { targetId: id });
}

function plRename(id, current) {
  const name = prompt('New name:', current);
  if (!name || !name.trim()) return;
  socket.emit('host_set_player_name', { targetId: id, name: name.trim().slice(0, 20) });
}

function plSetNote(id, note) {
  socket.emit('host_set_player_note', { targetId: id, note: (note || '').trim().slice(0, 60) });
}

// ── Apply settings ────────────────────────────────────────────────────────────
function applySettings() {
  const amHost = typeof isHost !== 'undefined' && isHost;

  if (amHost) {
    const sb = parseInt(document.getElementById('s-sb').value, 10);
    const bb = parseInt(document.getElementById('s-bb').value, 10);
    if (sb >= 1 && bb > sb) socket.emit('host_set_blinds', { sb, bb });

    const chips = parseInt(document.getElementById('s-chips').value, 10);
    if (chips >= 1) socket.emit('host_set_starting_chips', { amount: chips });

    socket.emit('update_settings', {
      anteEnabled:           document.getElementById('s-ante').checked,
      anteAmount:            parseInt(document.getElementById('s-ante-amt').value, 10)     || 0,
      straddleEnabled:       document.getElementById('s-straddle').checked,
      rabbitHunting:         document.getElementById('s-rabbit').checked,
      bombPotEnabled:        document.getElementById('s-bombpot').checked,
      bombPotAmount:         parseInt(document.getElementById('s-bomb-amt').value, 10)     || 0,
      bounty72:              parseInt(document.getElementById('s-bounty72').value, 10)     || 0,
      revealAllIn:           document.getElementById('s-reveal-allin').checked,
      dealToAway:            document.getElementById('s-deal-away').checked,
      autoTrimBets:          document.getElementById('s-autotrim').checked,
      spectatorsAllowed:     document.getElementById('s-spectators').checked,
      guestChatEnabled:      document.getElementById('s-guest-chat').checked,
      runItTwice:            radioVal('rit')     || 'no',
      showdownTime:          parseInt(radioVal('sdspeed') || '6', 10),
      decisionTime:          parseInt(document.getElementById('s-decision-time').value, 10) || 0,
      timeBankLength:        parseInt(document.getElementById('s-timebank-len').value, 10)  || 30,
      timeBankRechargeHands: parseInt(document.getElementById('s-timebank-hands').value, 10)|| 10,
      autoStart:             document.getElementById('s-autostart').checked,
      autoStartDelay:        parseInt(document.getElementById('s-autostart-delay').value, 10) || 5,
    });
  }

  const prefs = {
    deckStyle:       radioVal('deck')     || '2color',
    displayMode:     radioVal('dispmode') || 'formatted',
    tableColor:      document.querySelector('.color-swatch.selected')?.dataset.color || 'default',
    soundEnabled:    document.getElementById('p-sound').checked,
    secondarySounds: document.getElementById('p-secondary').checked,
    chatBeep:        document.getElementById('p-chatbeep').checked,
    autoTimeBank:    document.getElementById('p-autotb').checked,
  };
  savePrefs(prefs);
  applyClientPrefs(prefs);
  closeSettings();
  if (typeof showToast === 'function') showToast('Settings applied');
}

// ── Bomb pot host button ──────────────────────────────────────────────────────
function triggerBombPot() {
  socket.emit('host_bomb_pot_next');
}

// ── Chip formatting (used by both settings.js and game.js) ───────────────────
function formatChips(amount) {
  const prefs = loadPrefs();
  if (prefs.displayMode === 'none') return '•••';
  if (prefs.displayMode === 'bb') {
    const bb = (typeof state !== 'undefined' && state) ? (state.bigBlind || 0) : 0;
    if (bb > 0) return `${(amount / bb).toFixed(1)} BB`;
  }
  return `$${(amount || 0).toLocaleString()}`;
}

// ── Private DOM helpers ───────────────────────────────────────────────────────
function _sv(id, val) { const el = document.getElementById(id); if (el) el.value = val; }
function _sc(id, val) { const el = document.getElementById(id); if (el) el.checked = !!val; }
function _sr(group, val) {
  document.querySelectorAll(`.radio-opt[data-group="${group}"]`).forEach(b =>
    b.classList.toggle('active', b.dataset.val === String(val))
  );
}
function _xe(str) {
  return String(str)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
