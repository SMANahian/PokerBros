'use strict';

// ── Seat positions (top%, left%) — relative to table oval ────────────────────
const SEAT_POS = [
  { top: '90%', left: '50%'  },  // 0  bottom-center (hero)
  { top: '82%', left: '72%'  },  // 1  bottom-right
  { top: '60%', left: '90%'  },  // 2  right
  { top: '22%', left: '82%'  },  // 3  top-right
  { top: '10%', left: '60%'  },  // 4  top-center-right
  { top: '10%', left: '38%'  },  // 5  top-center-left
  { top: '22%', left: '18%'  },  // 6  top-left
  { top: '60%', left: '10%'  },  // 7  left
  { top: '82%', left: '28%'  },  // 8  bottom-left
];

const AVATAR_COLORS = [
  '#e84e4e','#4e9de8','#4ec87a','#e8a44e',
  '#a44ee8','#e8e04e','#4ee8d8','#e84ea4','#7ae84e',
];

// ── Boot ──────────────────────────────────────────────────────────────────────
const params  = new URLSearchParams(location.search);
const ROOM_ID = (params.get('r') || '').toUpperCase();
const MY_NAME = decodeURIComponent(params.get('name') || localStorage.getItem('pokerName') || 'Player');

if (!ROOM_ID) location.href = '/';

Sounds.init();

const socket = io();

let myId          = null;
let isHost        = false;
let state         = null;
let prevState     = null;
let winnerShown   = false;
let winnerTimer   = null;
let mutedFlag     = false;
let timerRAF      = null;
let isBombPotHand = false;

// ── Socket ────────────────────────────────────────────────────────────────────
socket.on('connect', () => {
  socket.emit('join_room', { roomId: ROOM_ID, name: MY_NAME });
});

socket.on('joined', ({ playerId, isHost: h }) => {
  myId   = playerId;
  isHost = h;
  document.getElementById('host-tab').style.display = h ? '' : 'none';
  document.getElementById('room-badge').textContent = `Room: ${ROOM_ID}`;
});

socket.on('game_state', newState => {
  prevState = state;
  state     = newState;

  // Detect bomb pot hands: WAITING → FLOP means pre-flop was skipped
  if (prevState) {
    if (prevState.state === 'WAITING' && newState.state === 'FLOP') isBombPotHand = true;
    else if (newState.state === 'WAITING')                          isBombPotHand = false;
  }

  const me = state.players.find(p => p.id === myId);
  if (me) {
    isHost = me.isHost;
    document.getElementById('host-tab').style.display = isHost ? '' : 'none';
  }

  triggerSounds(prevState, newState);
  render(newState);
});

socket.on('chat',   entry        => appendChat(entry));
socket.on('error',  ({ msg })    => showToast(msg, true));
socket.on('kicked', ({ msg })    => { alert(msg); location.href = '/'; });

// Resume AudioContext on first interaction (browser policy)
document.addEventListener('click', () => Sounds.resume(), { once: true });

// ── Sound triggers ────────────────────────────────────────────────────────────
function triggerSounds(prev, next) {
  if (!prev) return;

  if (prev.state === 'WAITING' && next.state === 'PREFLOP') {
    Sounds.shuffle();
    return;
  }

  const prevCC = prev.communityCards?.length || 0;
  const nextCC = next.communityCards?.length || 0;
  if (nextCC > prevCC) {
    for (let i = prevCC; i < nextCC; i++) {
      setTimeout(() => Sounds.cardDeal(), (i - prevCC) * 120);
    }
  }

  if (next.currentPlayerId === myId && prev.currentPlayerId !== myId) Sounds.yourTurn();

  if (next.state === 'SHOWDOWN' && prev.state !== 'SHOWDOWN') setTimeout(() => Sounds.win(), 300);

  const potDiff = (next.pot || 0) - (prev.pot || 0);
  if (potDiff > 0) {
    const betDiff = (next.currentBet || 0) - (prev.currentBet || 0);
    if (betDiff > 0) Sounds.chipRaise();
    else             Sounds.chips(Math.min(Math.ceil(potDiff / 50), 5));
  }
}

// ── Main render ───────────────────────────────────────────────────────────────
function render(s) {
  renderTable(s);
  renderHeroCards(s);
  renderLog(s);
  renderActionBar(s);
  renderWaitingOverlay(s);
  renderHostPanel(s);
  renderBombBanner(s);
  renderRabbitStrip(s);
  if (s.state === 'SHOWDOWN') maybeShowWinner(s);
  else                        hideWinner();
  if (s.timerStart && s.timerDuration) startTimerAnimation();
  else                                 stopTimerAnimation();
}

// ── Table ─────────────────────────────────────────────────────────────────────
function renderTable(s) {
  const table = document.getElementById('poker-table');
  table.querySelectorAll('.seat').forEach(el => el.remove());

  const me     = s.players.find(p => p.id === myId);
  const mySeat = me ? me.seatIndex : 0;

  for (let vis = 0; vis < 9; vis++) {
    const actual   = (vis + mySeat) % 9;
    const playerId = s.seats[actual];
    const player   = playerId ? s.players.find(p => p.id === playerId) : null;
    const pos      = SEAT_POS[vis];

    const el = document.createElement('div');
    el.className = 'seat';
    el.style.top  = pos.top;
    el.style.left = pos.left;

    if (!player) {
      el.innerHTML = `<div class="seat-box"><span class="seat-empty-label">Empty seat</span></div>`;
    } else {
      const isMe       = player.id === myId;
      const isTurn     = player.id === s.currentPlayerId;
      const isWinner   = s.lastWinners?.some(w => w.playerId === player.id);
      const folded     = player.status === 'folded';
      const sittingOut = player.status === 'sitting-out';
      const allIn      = player.status === 'all-in';
      const color      = AVATAR_COLORS[actual % AVATAR_COLORS.length];
      const initial    = player.name.charAt(0).toUpperCase();

      const boxCls = [
        'seat-box',
        isTurn     ? 'active-turn' : '',
        folded     ? 'folded'      : '',
        sittingOut ? 'sitting-out' : '',
        isWinner   ? 'winner'      : '',
        isMe       ? 'hero'        : '',
      ].filter(Boolean).join(' ');

      // Role + straddle badges
      const badges = [];
      if (player.seatIndex === s.dealerSeat)
        badges.push(`<span class="badge badge-d">D</span>`);
      if (player.seatIndex === s.sbSeat && player.seatIndex !== s.dealerSeat)
        badges.push(`<span class="badge badge-sb">SB</span>`);
      if (player.seatIndex === s.bbSeat)
        badges.push(`<span class="badge badge-bb">BB</span>`);
      if (player.seatIndex === s.sbSeat && player.seatIndex === s.dealerSeat)
        badges.push(`<span class="badge badge-sb">SB</span>`);
      if (s.straddleSeat >= 0 && player.seatIndex === s.straddleSeat)
        badges.push(`<span class="badge badge-str">STR</span>`);

      // Status labels
      let statusHtml = '';
      if (folded)     statusHtml = `<div class="seat-status-label">Fold</div>`;
      if (sittingOut) statusHtml = `<div class="seat-status-label">Away</div>`;
      if (allIn)      statusHtml = `<div class="seat-status-label allin">All-In</div>`;

      const handHtml = (s.state === 'SHOWDOWN' && player.handResult)
        ? `<div class="seat-hand-label">${esc(player.handResult.name)}</div>` : '';

      const cardsHtml = !isMe ? renderSeatCards(player, s.state) : '';
      const betHtml   = player.bet > 0
        ? `<div class="seat-bet-chip">💰 ${formatChips(player.bet)}</div>` : '';

      // Countdown bar — animated via rAF
      const timerHtml = (isTurn && s.timerDuration > 0)
        ? `<div class="timer-wrap"><div class="timer-fill" id="active-timer-fill"></div></div>` : '';

      el.innerHTML = `
        <div class="${boxCls}">
          ${badges.length ? `<div class="badges">${badges.join('')}</div>` : ''}
          <div class="seat-avatar" style="background:${color}">${esc(initial)}</div>
          <div class="seat-name">${esc(player.name)}${isMe ? ' <span style="opacity:.5;font-size:.65rem">(you)</span>' : ''}</div>
          <div class="seat-chips">${formatChips(player.chips)}</div>
          ${statusHtml}${handHtml}${timerHtml}
        </div>
        ${cardsHtml}
        ${betHtml}`;
    }
    table.appendChild(el);
  }

  // Community cards
  const cc = document.getElementById('community-cards');
  cc.innerHTML = '';
  for (let i = 0; i < 5; i++) {
    const card = s.communityCards[i];
    cc.appendChild(card ? makeCardEl(card) : makePlaceholder());
  }

  // Pot
  const pa = document.getElementById('pot-area');
  if (s.pot > 0) {
    pa.style.display = 'flex';
    document.getElementById('pot-value').textContent = formatChips(s.pot);
  } else {
    pa.style.display = 'none';
  }

  const labels = { PREFLOP:'Pre-Flop', FLOP:'Flop', TURN:'Turn', RIVER:'River', SHOWDOWN:'Showdown' };
  document.getElementById('street-label').textContent = labels[s.state] || '';
}

function renderSeatCards(player) {
  if (!player.cards || !player.cardCount) return '';
  return `<div class="seat-cards-row">${
    player.cards.map(c => c.id === 'back'
      ? `<div class="card card-sm back"></div>`
      : cardHtml(c, 'card-sm')
    ).join('')
  }</div>`;
}

// ── Hero cards ────────────────────────────────────────────────────────────────
function renderHeroCards(s) {
  const me = s.players.find(p => p.id === myId);
  const el = document.getElementById('hero-cards');
  if (!me || !me.cards || me.cards.length === 0) { el.innerHTML = ''; return; }
  el.innerHTML = me.cards.map(c =>
    c.id === 'back' ? `<div class="card card-hero back"></div>` : cardHtml(c, 'card-hero')
  ).join('');
}

// ── Card helpers ──────────────────────────────────────────────────────────────
const SUIT_SYM = { s:'♠', h:'♥', d:'♦', c:'♣' };
function suitSym(s)  { return SUIT_SYM[s] || s; }
function rankDisp(r) { return r === 'T' ? '10' : r; }

function cardHtml(card, extraClass = '') {
  const suitCls = `card-${card.suit}`;
  const r = rankDisp(card.rank);
  const s = suitSym(card.suit);
  return `<div class="card ${extraClass} ${suitCls}">
    <div class="c-tl">${r}<div class="c-suit">${s}</div></div>
    <div class="c-mid">${s}</div>
    <div class="c-br">${r}<div class="c-suit">${s}</div></div>
  </div>`;
}

function makeCardEl(card, small = false) {
  const tmp = document.createElement('div');
  tmp.innerHTML = cardHtml(card, small ? 'card-sm' : '');
  return tmp.firstElementChild;
}

function makePlaceholder() {
  const el = document.createElement('div');
  el.className = 'card ph';
  return el;
}

// ── Bomb pot banner ───────────────────────────────────────────────────────────
function renderBombBanner(s) {
  const el   = document.getElementById('bomb-banner');
  const show = isBombPotHand || !!(s.settings && s.settings.bombPotNextHand);
  el.classList.toggle('show', show);
  el.textContent = isBombPotHand ? '💣 BOMB POT' : '💣 BOMB POT NEXT HAND';
}

// ── Rabbit hunting strip ──────────────────────────────────────────────────────
function renderRabbitStrip(s) {
  const el    = document.getElementById('rabbit-strip');
  const cards = s.rabbitCards;
  if (!cards || cards.length === 0) { el.classList.remove('show'); return; }
  el.classList.add('show');
  el.innerHTML = `<span class="rabbit-label">🐇 Rabbit</span>` +
    cards.map(c => cardHtml(c, 'card-sm')).join('');
}

// ── Action timer (countdown bar via requestAnimationFrame) ────────────────────
function startTimerAnimation() {
  if (timerRAF) cancelAnimationFrame(timerRAF);
  function tick() {
    if (!state || !state.timerStart || !state.timerDuration) { timerRAF = null; return; }
    const ratio = Math.max(0, 1 - (Date.now() - state.timerStart) / state.timerDuration);
    const fill  = document.getElementById('active-timer-fill');
    if (fill) {
      fill.style.transform = `scaleX(${ratio})`;
      fill.classList.toggle('urgent', ratio < 0.25);
    }
    timerRAF = requestAnimationFrame(tick);
  }
  timerRAF = requestAnimationFrame(tick);
}

function stopTimerAnimation() {
  if (timerRAF) { cancelAnimationFrame(timerRAF); timerRAF = null; }
  const fill = document.getElementById('active-timer-fill');
  if (fill) fill.style.transform = 'scaleX(1)';
}

// ── Action bar ────────────────────────────────────────────────────────────────
function renderActionBar(s) {
  const bar    = document.getElementById('action-area');
  const me     = s.players.find(p => p.id === myId);
  const myTurn = s.currentPlayerId === myId && ['PREFLOP','FLOP','TURN','RIVER'].includes(s.state);

  if (!myTurn || !me) { bar.classList.add('hidden'); return; }
  bar.classList.remove('hidden');

  const toCall   = Math.max(0, s.currentBet - (me.bet || 0));
  const callAmt  = Math.min(toCall, me.chips);
  const minTo    = s.currentBet + s.minRaise;
  const maxTo    = (me.bet || 0) + me.chips;
  const canRaise = maxTo >= minTo;

  const chk = document.getElementById('btn-check');
  const cal = document.getElementById('btn-call');
  if (toCall <= 0) {
    chk.style.display = '';
    cal.style.display = 'none';
  } else {
    chk.style.display = 'none';
    cal.style.display = '';
    cal.textContent   = `Call ${formatChips(callAmt)}`;
  }

  const raiseArea = document.querySelector('.raise-area');
  if (!canRaise) {
    raiseArea.style.display = 'none';
  } else {
    raiseArea.style.display = '';
    const rv = document.getElementById('raise-val');
    const rs = document.getElementById('raise-slider');
    rv.min = minTo; rv.max = maxTo;
    rs.min = minTo; rs.max = maxTo;
    if (!rv.value || +rv.value < minTo || +rv.value > maxTo) {
      rv.value = minTo; rs.value = minTo;
    }
    rv.oninput = () => rs.value = rv.value;
    rs.oninput = () => rv.value = rs.value;
  }

  document.getElementById('action-info').textContent =
    toCall > 0 ? `To call: ${formatChips(callAmt)}` : 'Your action';
}

function quickRaise(type) {
  if (!state) return;
  const me = state.players.find(p => p.id === myId);
  if (!me) return;
  const pot    = state.pot;
  const maxTo  = (me.bet || 0) + me.chips;
  const curBet = state.currentBet;
  let val;
  if      (type === 'half') val = curBet + Math.floor(pot / 2);
  else if (type === 'pot')  val = curBet + pot;
  else if (type === '2x')   val = curBet + pot * 2;
  else                      val = maxTo;
  val = Math.max(curBet + state.minRaise, Math.min(val, maxTo));
  document.getElementById('raise-val').value    = val;
  document.getElementById('raise-slider').value = val;
}

// ── Waiting overlay ───────────────────────────────────────────────────────────
function renderWaitingOverlay(s) {
  const ov  = document.getElementById('waiting-overlay');
  const btn = document.getElementById('start-game-btn');
  if (s.state === 'WAITING') {
    ov.classList.remove('hidden');
    const n = s.players.length;
    document.getElementById('waiting-title').textContent = n < 2 ? 'Waiting for players…' : 'Ready to play!';
    document.getElementById('waiting-sub').textContent   = `${n} player${n !== 1 ? 's' : ''} at the table`;
    btn.style.display = (isHost && n >= 2) ? '' : 'none';
  } else {
    ov.classList.add('hidden');
  }
}

// ── Winner banner ─────────────────────────────────────────────────────────────
function maybeShowWinner(s) {
  if (winnerShown || !s.lastWinners?.length) return;
  winnerShown = true;
  const w = s.lastWinners[0];
  const p = s.players.find(pl => pl.id === w.playerId);
  if (!p) return;
  document.getElementById('wb-name').textContent = p.name;
  document.getElementById('wb-hand').textContent = w.handName || '';
  document.getElementById('wb-amt').textContent  = `+${formatChips(w.amount)}`;
  document.getElementById('winner-banner').classList.add('show');
  if (winnerTimer) clearTimeout(winnerTimer);
  winnerTimer = setTimeout(hideWinner, 4500);
}

function hideWinner() {
  winnerShown = false;
  document.getElementById('winner-banner').classList.remove('show');
}

// ── Log ───────────────────────────────────────────────────────────────────────
function renderLog(s) {
  const el   = document.getElementById('log-panel');
  const atBt = el.scrollHeight - el.scrollTop <= el.clientHeight + 30;
  el.innerHTML = s.log.map(entry => {
    const text = entry.msg || '';
    let cls = '';
    if (text.startsWith('──'))        cls = 'log-hand';
    else if (text.includes('wins'))   cls = 'log-win';
    else if (text.includes('joined')) cls = 'log-join';
    return `<div class="log-entry${cls ? ' '+cls : ''}">${esc(text)}</div>`;
  }).join('');
  if (atBt) el.scrollTop = el.scrollHeight;
}

// ── Chat ──────────────────────────────────────────────────────────────────────
const CHAT_COLORS = ['#4e9de8','#4ec87a','#e8a44e','#a44ee8','#e84e4e','#e8e04e','#4ee8d8'];
let chatNameColors = {};

function appendChat(entry) {
  const msgs = document.getElementById('chat-messages');
  if (!chatNameColors[entry.player]) {
    chatNameColors[entry.player] = CHAT_COLORS[Object.keys(chatNameColors).length % CHAT_COLORS.length];
  }
  const color = chatNameColors[entry.player];
  const div   = document.createElement('div');
  div.className = 'chat-msg';
  div.innerHTML = `<span class="chat-name" style="color:${color}">${esc(entry.player)}</span>: <span class="chat-text">${esc(entry.msg)}</span>`;
  msgs.appendChild(div);
  msgs.scrollTop = msgs.scrollHeight;

  // Optional chat beep
  const prefs = loadPrefs();
  if (prefs.chatBeep && prefs.soundEnabled && typeof Sounds !== 'undefined') Sounds.check();
}

function sendChat(e) {
  e.preventDefault();
  const input = document.getElementById('chat-input');
  const msg   = input.value.trim();
  if (!msg) return;
  socket.emit('chat', { msg });
  input.value = '';
}

// ── Host panel ────────────────────────────────────────────────────────────────
function renderHostPanel(s) {
  if (!isHost) return;
  const sbIn = document.getElementById('sb-in');
  const bbIn = document.getElementById('bb-in');
  if (document.activeElement !== sbIn) sbIn.value = s.smallBlind;
  if (document.activeElement !== bbIn) bbIn.value = s.bigBlind;

  // Bomb pot button state
  const bpBtn = document.getElementById('bomb-pot-btn');
  if (bpBtn && s.settings) {
    bpBtn.textContent    = s.settings.bombPotNextHand ? '💣 Cancel Bomb Pot' : '💣 Bomb Pot Next';
    bpBtn.style.borderColor = s.settings.bombPotNextHand ? 'var(--orange)' : '';
    bpBtn.style.color       = s.settings.bombPotNextHand ? 'var(--orange)' : '';
  }

  const list = document.getElementById('host-players');
  list.innerHTML = s.players.map(p => {
    const color   = AVATAR_COLORS[p.seatIndex % AVATAR_COLORS.length];
    const initial = p.name.charAt(0).toUpperCase();
    return `<div class="player-row">
      <div class="pr-avatar" style="background:${color}">${esc(initial)}</div>
      <span class="pr-name" title="${esc(p.name)}">${esc(p.name)}${p.id === myId ? ' (you)' : ''}</span>
      <span class="pr-chips">${formatChips(p.chips)}</span>
      <div class="pr-actions">
        <button class="pr-btn" onclick="hostChips('${p.id}','${esc(p.name)}')">±</button>
        <button class="pr-btn" onclick="hostSitOut('${p.id}')">${p.status === 'sitting-out' ? '↩' : 'Out'}</button>
        ${p.id !== myId ? `<button class="pr-btn kick" onclick="hostKick('${p.id}')">✕</button>` : ''}
      </div>
    </div>`;
  }).join('');
}

// ── Tabs ──────────────────────────────────────────────────────────────────────
function switchTab(name) {
  document.querySelectorAll('.tab').forEach(t =>
    t.classList.toggle('active', t.dataset.tab === name)
  );
  document.querySelectorAll('.tab-panel').forEach(p =>
    p.classList.toggle('active', p.id === `tab-${name}`)
  );
}

// ── Socket emitters ───────────────────────────────────────────────────────────
function act(action) {
  Sounds.resume();
  if (action === 'raise') {
    const amount = parseInt(document.getElementById('raise-val').value, 10);
    socket.emit('player_action', { action, amount });
  } else {
    socket.emit('player_action', { action });
  }
}

function emitStart()  { socket.emit('start_hand'); }
function emitNext()   { socket.emit('next_hand');  }

function confirmEnd() {
  if (confirm('End the current hand early?')) socket.emit('end_hand');
}

function setBlindsDirect() {
  const sb = +document.getElementById('sb-in').value;
  const bb = +document.getElementById('bb-in').value;
  if (!sb || !bb || sb < 1 || bb <= sb) return showToast('Invalid blinds', true);
  socket.emit('host_set_blinds', { sb, bb });
}

function hostChips(targetId, name) {
  const v = prompt(`Add/remove chips for ${name}:\n(use negative to remove)`, '500');
  if (v === null) return;
  const amount = parseInt(v, 10);
  if (isNaN(amount)) return showToast('Invalid', true);
  socket.emit('host_add_chips', { targetId, amount });
}

function hostKick(targetId) {
  if (confirm('Remove this player?')) socket.emit('host_kick', { targetId });
}

function hostSitOut(targetId) { socket.emit('host_sit_out', { targetId }); }

// ── Mute ──────────────────────────────────────────────────────────────────────
function toggleMute() {
  mutedFlag = !mutedFlag;
  Sounds.setMuted(mutedFlag);
  document.getElementById('mute-btn').textContent = mutedFlag ? '🔇' : '🔊';
}

// ── Share / Leave ─────────────────────────────────────────────────────────────
function shareLink() {
  const url = `${location.origin}/?r=${ROOM_ID}`;
  navigator.clipboard.writeText(url)
    .then(() => showToast('Link copied!'))
    .catch(() => prompt('Share this link:', url));
}

function leaveGame() { location.href = '/'; }

// ── Utilities ─────────────────────────────────────────────────────────────────
function showToast(msg, isErr = false) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.style.borderColor = isErr ? '#e05555' : '#2a3347';
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 2800);
}

function esc(str) {
  return String(str)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Seed chat history on first state ─────────────────────────────────────────
let chatSeeded = false;
socket.on('game_state', s => {
  if (!chatSeeded && s.chatHistory?.length) {
    s.chatHistory.forEach(e => appendChat(e));
    chatSeeded = true;
  }
});
