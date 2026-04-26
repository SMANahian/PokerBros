'use strict';

const express = require('express');
const http    = require('http');
const { Server } = require('socket.io');
const { v4: uuidv4 } = require('uuid');
const RoomManager = require('./src/RoomManager');

const PORT = process.env.PORT || 3000;
const app    = express();
const server = http.createServer(app);
const io     = new Server(server, { cors: { origin: '*' } });
const rooms  = new RoomManager();

app.use(express.static('public'));
app.use(express.json());

app.get('/api/new-room', (req, res) => {
  const roomId = uuidv4().slice(0, 8).toUpperCase();
  res.json({ roomId });
});
app.get('/',     (req, res) => res.sendFile(__dirname + '/public/index.html'));
app.get('/game', (req, res) => res.sendFile(__dirname + '/public/game.html'));

// ── Broadcast personalised state to every player in a room ───────────────────
function broadcastState(roomId, game) {
  for (const [playerId] of game.players) {
    const sock = io.sockets.sockets.get(playerId);
    if (sock) sock.emit('game_state', game.getPublicState(playerId));
  }
}

// ── Action timer (decision clock + time bank) ────────────────────────────────
const actionTimers    = new Map(); // roomId → timerId
const autoStartTimers = new Map(); // roomId → timerId

function clearActionTimer(roomId) {
  const t = actionTimers.get(roomId);
  if (t) { clearTimeout(t); actionTimers.delete(roomId); }
  const game = rooms.get(roomId);
  if (game) { game.timerStart = null; game.timerDuration = null; }
}

function clearAutoStart(roomId) {
  const t = autoStartTimers.get(roomId);
  if (t) { clearTimeout(t); autoStartTimers.delete(roomId); }
}

function startActionTimer(roomId) {
  clearActionTimer(roomId);
  const game = rooms.get(roomId);
  if (!game) return;

  const { decisionTime, timeBankLength } = game.settings;
  if (!decisionTime || decisionTime <= 0) return;
  if (game.actionQueue.length === 0) return;

  const currentSeat = game.actionQueue[0];
  const playerId    = game.seats[currentSeat];
  if (!playerId) return;

  game.timerStart    = Date.now();
  game.timerDuration = decisionTime * 1000;
  broadcastState(roomId, game);

  const timer = setTimeout(() => {
    const g = rooms.get(roomId);
    if (!g || g.actionQueue[0] !== currentSeat) return;

    const player = g.players.get(playerId);

    // Try time bank first
    if (player && player.timeBank > 0 && timeBankLength > 0) {
      const tbSecs = Math.min(player.timeBank, timeBankLength);
      player.timeBank   = Math.max(0, player.timeBank - tbSecs);
      g.timerStart      = Date.now();
      g.timerDuration   = tbSecs * 1000;
      g.addLog(`${player.name} uses time bank (${tbSecs}s)`);
      broadcastState(roomId, g);

      const tbTimer = setTimeout(() => {
        const g2 = rooms.get(roomId);
        if (!g2 || g2.actionQueue[0] !== currentSeat) return;
        g2.playerAction(playerId, 'fold');
        g2.timerStart = null; g2.timerDuration = null;
        broadcastState(roomId, g2);
        scheduleAutoStart(roomId);
        startActionTimer(roomId);
      }, tbSecs * 1000);
      actionTimers.set(roomId, tbTimer);
    } else {
      g.playerAction(playerId, 'fold');
      g.timerStart = null; g.timerDuration = null;
      broadcastState(roomId, g);
      scheduleAutoStart(roomId);
      startActionTimer(roomId);
    }
  }, decisionTime * 1000);

  actionTimers.set(roomId, timer);
}

function scheduleAutoStart(roomId) {
  const game = rooms.get(roomId);
  if (!game || !game.settings.autoStart) return;
  if (game.state !== 'SHOWDOWN' && game.state !== 'WAITING') return;

  clearAutoStart(roomId);
  const delay = (game.settings.autoStartDelay || 5) * 1000;

  const t = setTimeout(() => {
    const g = rooms.get(roomId);
    if (!g || !g.settings.autoStart) return;
    const result = g.startHand();
    if (!result.error) {
      broadcastState(roomId, g);
      startActionTimer(roomId);
    }
    autoStartTimers.delete(roomId);
  }, delay);

  autoStartTimers.set(roomId, t);
  game.addLog(`Next hand in ${game.settings.autoStartDelay}s…`);
  broadcastState(roomId, game);
}

// ── Helper: after any action that might advance the game ─────────────────────
function afterAction(roomId, game) {
  broadcastState(roomId, game);
  if (['SHOWDOWN','WAITING'].includes(game.state)) {
    clearActionTimer(roomId);
    scheduleAutoStart(roomId);
  } else {
    startActionTimer(roomId);
  }
}

// ── Socket events ────────────────────────────────────────────────────────────
io.on('connection', socket => {
  console.log(`+ ${socket.id}`);

  // ── Join ────────────────────────────────────────────────────────────────────
  socket.on('join_room', ({ roomId, name }) => {
    if (!roomId) return socket.emit('error', { msg: 'Room ID required' });

    const game   = rooms.getOrCreate(roomId, socket.id);
    const player = game.addPlayer(socket.id, name);
    if (!player) return socket.emit('error', { msg: 'Table is full (max 9 players)' });

    socket.join(roomId);
    socket.data.roomId   = roomId;
    socket.data.playerId = socket.id;

    socket.emit('joined', { playerId: socket.id, seatIndex: player.seatIndex, isHost: player.isHost });
    game.addLog(`${player.name} joined`);
    broadcastState(roomId, game);
  });

  // ── Start hand ──────────────────────────────────────────────────────────────
  socket.on('start_hand', () => {
    const { roomId } = socket.data;
    const game = rooms.get(roomId);
    if (!game) return socket.emit('error', { msg: 'Room not found' });
    if (game.hostId !== socket.id) return socket.emit('error', { msg: 'Host only' });

    clearAutoStart(roomId);
    const result = game.startHand();
    if (result.error) return socket.emit('error', { msg: result.error });
    broadcastState(roomId, game);
    startActionTimer(roomId);
  });

  // ── Player action ───────────────────────────────────────────────────────────
  socket.on('player_action', ({ action, amount }) => {
    const { roomId } = socket.data;
    const game = rooms.get(roomId);
    if (!game) return socket.emit('error', { msg: 'Room not found' });

    clearActionTimer(roomId);
    const result = game.playerAction(socket.id, action, amount);
    if (result?.error) return socket.emit('error', { msg: result.error });
    afterAction(roomId, game);
  });

  // ── Next hand ───────────────────────────────────────────────────────────────
  socket.on('next_hand', () => {
    const { roomId } = socket.data;
    const game = rooms.get(roomId);
    if (!game || game.hostId !== socket.id) return;

    clearAutoStart(roomId);
    if (!['WAITING','SHOWDOWN'].includes(game.state)) game.hostEndHand();
    const result = game.startHand();
    if (result.error) return socket.emit('error', { msg: result.error });
    broadcastState(roomId, game);
    startActionTimer(roomId);
  });

  // ── End hand ────────────────────────────────────────────────────────────────
  socket.on('end_hand', () => {
    const { roomId } = socket.data;
    const game = rooms.get(roomId);
    if (!game || game.hostId !== socket.id) return;
    clearActionTimer(roomId);
    clearAutoStart(roomId);
    game.hostEndHand();
    broadcastState(roomId, game);
  });

  // ── Host: update settings ───────────────────────────────────────────────────
  socket.on('update_settings', (newSettings) => {
    const { roomId } = socket.data;
    const game = rooms.get(roomId);
    if (!game || game.hostId !== socket.id) return;
    game.updateSettings(newSettings);
    // If blinds included, update main blind values too
    if (newSettings.smallBlind) game.smallBlind = Math.max(1, Number(newSettings.smallBlind));
    if (newSettings.bigBlind)   game.bigBlind   = Math.max(2, Number(newSettings.bigBlind));
    if (newSettings.startingChips) game.startingChips = Math.max(1, Number(newSettings.startingChips));
    broadcastState(roomId, game);
  });

  // ── Host: chip management ───────────────────────────────────────────────────
  socket.on('host_add_chips', ({ targetId, amount }) => {
    const { roomId } = socket.data;
    const game = rooms.get(roomId);
    if (!game || game.hostId !== socket.id) return;
    const result = game.hostAddChips(targetId, amount);
    if (result.error) return socket.emit('error', { msg: result.error });
    broadcastState(roomId, game);
  });

  socket.on('host_set_chips', ({ targetId, amount }) => {
    const { roomId } = socket.data;
    const game = rooms.get(roomId);
    if (!game || game.hostId !== socket.id) return;
    const result = game.hostSetChips(targetId, amount);
    if (result.error) return socket.emit('error', { msg: result.error });
    broadcastState(roomId, game);
  });

  socket.on('host_rebuy', ({ targetId }) => {
    const { roomId } = socket.data;
    const game = rooms.get(roomId);
    if (!game || game.hostId !== socket.id) return;
    const result = game.hostRebuy(targetId);
    if (result.error) return socket.emit('error', { msg: result.error });
    broadcastState(roomId, game);
  });

  // ── Host: player management ─────────────────────────────────────────────────
  socket.on('host_set_blinds', ({ sb, bb }) => {
    const { roomId } = socket.data;
    const game = rooms.get(roomId);
    if (!game || game.hostId !== socket.id) return;
    game.hostSetBlinds(Number(sb), Number(bb));
    broadcastState(roomId, game);
  });

  socket.on('host_kick', ({ targetId }) => {
    const { roomId } = socket.data;
    const game = rooms.get(roomId);
    if (!game || game.hostId !== socket.id) return;
    const result = game.hostKick(targetId);
    if (result.kickedId) {
      const kicked = io.sockets.sockets.get(result.kickedId);
      if (kicked) kicked.emit('kicked', { msg: 'You were removed by the host' });
    }
    broadcastState(roomId, game);
  });

  socket.on('host_sit_out', ({ targetId }) => {
    const { roomId } = socket.data;
    const game = rooms.get(roomId);
    if (!game || game.hostId !== socket.id) return;
    game.hostToggleSitOut(targetId);
    afterAction(roomId, game);
  });

  socket.on('host_set_starting_chips', ({ amount }) => {
    const { roomId } = socket.data;
    const game = rooms.get(roomId);
    if (!game || game.hostId !== socket.id) return;
    game.startingChips = Math.max(1, Number(amount));
    game.addLog(`Starting chips set to ${game.startingChips}`);
    broadcastState(roomId, game);
  });

  socket.on('host_set_player_name', ({ targetId, name }) => {
    const { roomId } = socket.data;
    const game = rooms.get(roomId);
    if (!game || game.hostId !== socket.id) return;
    game.hostSetPlayerName(targetId, name);
    broadcastState(roomId, game);
  });

  socket.on('host_set_player_note', ({ targetId, note }) => {
    const { roomId } = socket.data;
    const game = rooms.get(roomId);
    if (!game || game.hostId !== socket.id) return;
    game.hostSetPlayerNote(targetId, note);
    broadcastState(roomId, game);
  });

  socket.on('host_bomb_pot_next', () => {
    const { roomId } = socket.data;
    const game = rooms.get(roomId);
    if (!game || game.hostId !== socket.id) return;
    game.settings.bombPotNextHand = !game.settings.bombPotNextHand;
    game.addLog(`Bomb pot ${game.settings.bombPotNextHand ? 'scheduled for next hand' : 'cancelled'}`);
    broadcastState(roomId, game);
  });

  // ── Chat ────────────────────────────────────────────────────────────────────
  socket.on('chat', ({ msg }) => {
    const { roomId } = socket.data;
    const game = rooms.get(roomId);
    if (!game) return;
    const entry = game.addChat(socket.id, msg);
    if (entry) io.to(roomId).emit('chat', entry);
  });

  // ── Disconnect ──────────────────────────────────────────────────────────────
  socket.on('disconnect', () => {
    console.log(`- ${socket.id}`);
    const { roomId } = socket.data || {};
    if (!roomId) return;
    const game = rooms.get(roomId);
    if (!game) return;
    const player = game.players.get(socket.id);
    if (player) {
      game.addLog(`${player.name} disconnected`);
      clearActionTimer(roomId);
      if (game.actionQueue[0] === player.seatIndex) {
        game.playerAction(socket.id, 'fold');
      }
      game.removePlayer(socket.id);
      afterAction(roomId, game);
    }
    if (game.players.size === 0) {
      clearActionTimer(roomId);
      clearAutoStart(roomId);
      rooms.delete(roomId);
    }
  });
});

server.listen(PORT, () => {
  console.log(`\n🃏 PokerBros running at http://localhost:${PORT}\n`);
});
