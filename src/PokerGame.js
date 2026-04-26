'use strict';

const Deck = require('./Deck');
const { bestHand, compareHands } = require('./HandEvaluator');

const STATES = {
  WAITING: 'WAITING',
  PREFLOP: 'PREFLOP',
  FLOP: 'FLOP',
  TURN: 'TURN',
  RIVER: 'RIVER',
  SHOWDOWN: 'SHOWDOWN',
};

const DEFAULT_SETTINGS = {
  // Blinds & Structure
  anteEnabled: false,
  anteAmount: 0,
  straddleEnabled: false,
  // Timing
  decisionTime: 0,           // seconds; 0 = unlimited
  timeBankLength: 30,        // seconds per refill
  timeBankRechargeHands: 10, // refill every N hands
  autoStart: false,
  autoStartDelay: 5,         // seconds between hands
  showdownTime: 6,           // 3 / 6 / 9
  // Special rules
  runItTwice: 'no',          // 'always' | 'ask' | 'no'
  rabbitHunting: false,
  bombPotEnabled: false,
  bombPotNextHand: false,
  bombPotAmount: 0,          // 0 = auto (2× BB per player)
  bounty72: 0,               // chips; 0 = off
  // Table management
  dealToAway: false,
  revealAllIn: true,
  spectatorsAllowed: true,
  guestChatEnabled: true,
  autoTrimBets: true,
};

class PokerGame {
  constructor(roomId, hostId) {
    this.roomId       = roomId;
    this.hostId       = hostId;
    this.players      = new Map();
    this.seats        = new Array(9).fill(null);
    this.state        = STATES.WAITING;
    this.deck         = new Deck();
    this.communityCards = [];
    this.pot          = 0;
    this.currentBet   = 0;
    this.minRaise     = 0;
    this.dealerSeat   = -1;
    this.actionQueue  = [];
    this.smallBlind   = 10;
    this.bigBlind     = 20;
    this.startingChips = 1000;
    this.log          = [];
    this.chatHistory  = [];
    this.handNumber   = 0;
    this.sbSeat       = -1;
    this.bbSeat       = -1;
    this.straddleSeat = -1;
    this.lastWinners  = [];
    this.rabbitCards  = [];
    this.timerStart   = null;
    this.timerDuration = null;
    this.settings     = { ...DEFAULT_SETTINGS };
  }

  // ─── Player management ────────────────────────────────────────────────────

  addPlayer(socketId, name, preferredSeat) {
    if (this.players.has(socketId)) return this.players.get(socketId);
    let seatIndex = -1;
    if (preferredSeat !== undefined && preferredSeat >= 0 && preferredSeat < 9 && !this.seats[preferredSeat]) {
      seatIndex = preferredSeat;
    } else {
      for (let i = 0; i < 9; i++) {
        if (!this.seats[i]) { seatIndex = i; break; }
      }
    }
    if (seatIndex === -1) return null;

    const isHost = socketId === this.hostId || this.players.size === 0;
    if (isHost) this.hostId = socketId;

    const player = {
      id: socketId,
      name: name || `Player${seatIndex + 1}`,
      chips: this.startingChips,
      cards: [],
      bet: 0,
      totalBet: 0,
      status: 'active',
      seatIndex,
      isHost,
      timeBank: this.settings.timeBankLength,
      handsPlayed: 0,
      note: '',
    };
    this.players.set(socketId, player);
    this.seats[seatIndex] = socketId;
    return player;
  }

  removePlayer(socketId) {
    const p = this.players.get(socketId);
    if (!p) return;
    this.seats[p.seatIndex] = null;
    this.players.delete(socketId);
    this.actionQueue = this.actionQueue.filter(s => s !== p.seatIndex);
    if (socketId === this.hostId) {
      const next = [...this.players.values()][0];
      if (next) { next.isHost = true; this.hostId = next.id; }
    }
  }

  getActivePlayers() {
    return [...this.players.values()].filter(p =>
      this.settings.dealToAway ? true : p.status !== 'sitting-out'
    );
  }

  getHandPlayers() {
    return [...this.players.values()].filter(p => ['active', 'all-in'].includes(p.status));
  }

  getHandSeatsFrom(afterSeat) {
    const seats = [...this.players.values()]
      .filter(p => ['active', 'all-in'].includes(p.status))
      .map(p => p.seatIndex)
      .sort((a, b) => a - b);
    if (seats.length === 0) return [];
    let startIdx = seats.findIndex(s => s > afterSeat);
    if (startIdx === -1) startIdx = 0;
    return [...seats.slice(startIdx), ...seats.slice(0, startIdx)];
  }

  getPlayerAtSeat(seat) {
    const id = this.seats[seat];
    return id ? this.players.get(id) : null;
  }

  // ─── Hand lifecycle ───────────────────────────────────────────────────────

  startHand() {
    // Handle bomb pot next hand
    if (this.settings.bombPotEnabled && this.settings.bombPotNextHand) {
      return this.startBombPot();
    }

    const active = this.getActivePlayers().filter(p => p.status !== 'sitting-out' || this.settings.dealToAway);
    const eligible = active.filter(p => p.chips > 0);
    if (eligible.length < 2) return { error: 'Need at least 2 players with chips' };

    this.handNumber++;
    this.communityCards = [];
    this.rabbitCards    = [];
    this.pot            = 0;
    this.currentBet     = 0;
    this.lastWinners    = [];
    this.straddleSeat   = -1;

    this.deck.reset();
    this.deck.shuffle();

    // Recharge time banks
    for (const p of eligible) {
      p.handsPlayed = (p.handsPlayed || 0) + 1;
      if (p.timeBank === undefined) p.timeBank = this.settings.timeBankLength;
      if (this.settings.timeBankRechargeHands > 0 &&
          p.handsPlayed % this.settings.timeBankRechargeHands === 0) {
        p.timeBank = Math.min(p.timeBank + this.settings.timeBankLength, this.settings.timeBankLength * 3);
      }
    }

    for (const p of eligible) {
      p.cards    = [];
      p.bet      = 0;
      p.totalBet = 0;
      p.status   = 'active';
      p.handResult = null;
    }
    // Sitting-out players stay sitting-out
    for (const p of this.players.values()) {
      if (!eligible.includes(p)) {
        p.cards = []; p.bet = 0; p.totalBet = 0;
      }
    }

    // Advance dealer button
    const activeSeats = eligible.map(p => p.seatIndex).sort((a, b) => a - b);
    if (this.dealerSeat === -1 || !activeSeats.includes(this.dealerSeat)) {
      this.dealerSeat = activeSeats[0];
    } else {
      const di = activeSeats.indexOf(this.dealerSeat);
      this.dealerSeat = activeSeats[(di + 1) % activeSeats.length];
    }

    const n  = activeSeats.length;
    const di = activeSeats.indexOf(this.dealerSeat);

    let sbIdx, bbIdx, firstActIdx;
    if (n === 2) {
      sbIdx      = di;
      bbIdx      = (di + 1) % n;
      firstActIdx = di;
    } else {
      sbIdx      = (di + 1) % n;
      bbIdx      = (di + 2) % n;
      firstActIdx = (di + 3) % n;
    }

    this.sbSeat = activeSeats[sbIdx];
    this.bbSeat = activeSeats[bbIdx];

    const sbPlayer = this.getPlayerAtSeat(this.sbSeat);
    const bbPlayer = this.getPlayerAtSeat(this.bbSeat);

    this.postBlind(sbPlayer, this.smallBlind);
    this.postBlind(bbPlayer, this.bigBlind);
    this.currentBet = this.bigBlind;
    this.minRaise   = this.bigBlind;

    // Antes
    if (this.settings.anteEnabled && this.settings.anteAmount > 0) {
      let totalAnte = 0;
      for (const p of eligible) {
        const ante = Math.min(this.settings.anteAmount, p.chips);
        if (ante > 0) {
          p.chips    -= ante;
          p.totalBet += ante;
          this.pot   += ante;
          totalAnte  += ante;
          if (p.chips === 0) p.status = 'all-in';
        }
      }
      if (totalAnte > 0) this.addLog(`Antes collected (${this.settings.anteAmount} each)`);
    }

    // Straddle (UTG, n >= 3)
    if (this.settings.straddleEnabled && n >= 3) {
      const utgIdx   = (di + 3) % n;
      const utgPlayer = this.getPlayerAtSeat(activeSeats[utgIdx]);
      const strAmt   = this.bigBlind * 2;
      if (utgPlayer && utgPlayer.chips >= strAmt && utgPlayer.status === 'active') {
        this.postBlind(utgPlayer, strAmt);
        this.currentBet   = strAmt;
        this.minRaise     = strAmt;
        this.straddleSeat = activeSeats[utgIdx];
        firstActIdx       = (di + 4) % n;  // action starts UTG+1
        this.addLog(`${utgPlayer.name} straddles ${strAmt}`);
      }
    }

    // Deal 2 hole cards
    for (const p of eligible) {
      p.cards = [this.deck.deal(), this.deck.deal()];
    }

    // Build pre-flop action queue (modular wrap covers straddle case naturally)
    this.actionQueue = [];
    for (let i = 0; i < n; i++) {
      this.actionQueue.push(activeSeats[(firstActIdx + i) % n]);
    }
    this.actionQueue = this.actionQueue.filter(s => {
      const p = this.getPlayerAtSeat(s);
      return p && p.status === 'active';
    });

    this.state = STATES.PREFLOP;
    this.addLog(`── Hand #${this.handNumber} ──`);
    this.addLog(`Dealer: ${this.getPlayerAtSeat(this.dealerSeat)?.name}`);
    this.addLog(`${sbPlayer?.name} posts SB ${this.smallBlind}`);
    this.addLog(`${bbPlayer?.name} posts BB ${this.bigBlind}`);
    return { success: true };
  }

  startBombPot() {
    this.settings.bombPotNextHand = false;
    const active = [...this.players.values()].filter(p => p.status !== 'sitting-out' && p.chips > 0);
    if (active.length < 2) return { error: 'Need at least 2 players' };

    this.handNumber++;
    this.communityCards = [];
    this.rabbitCards    = [];
    this.pot            = 0;
    this.currentBet     = 0;
    this.lastWinners    = [];
    this.straddleSeat   = -1;
    this.deck.reset();
    this.deck.shuffle();

    for (const p of active) {
      p.cards = []; p.bet = 0; p.totalBet = 0; p.status = 'active'; p.handResult = null;
    }

    const bombAmt = this.settings.bombPotAmount > 0
      ? this.settings.bombPotAmount
      : this.bigBlind * 2;

    for (const p of active) {
      const amt = Math.min(bombAmt, p.chips);
      p.chips -= amt; p.bet += amt; p.totalBet += amt; this.pot += amt;
      if (p.chips === 0) p.status = 'all-in';
    }
    this.currentBet = bombAmt;
    this.minRaise   = bombAmt;

    const activeSeats = active.map(p => p.seatIndex).sort((a, b) => a - b);
    if (!activeSeats.includes(this.dealerSeat)) this.dealerSeat = activeSeats[0];

    for (const p of active) p.cards = [this.deck.deal(), this.deck.deal()];

    // Post-flop style action from left of dealer
    this.actionQueue = this.getHandSeatsFrom(this.dealerSeat)
      .filter(s => this.getPlayerAtSeat(s)?.status === 'active');

    this.state = STATES.FLOP;
    this.communityCards.push(this.deck.deal(), this.deck.deal(), this.deck.deal());
    this.currentBet = 0;
    this.minRaise   = this.bigBlind;
    for (const p of active) p.bet = 0;

    this.addLog(`── BOMB POT Hand #${this.handNumber} ──`);
    this.addLog(`Everyone posts ${bombAmt}`);
    this.addLog(`Flop: ${this.communityCards.map(c => c.display).join(' ')}`);
    return { success: true };
  }

  postBlind(player, amount) {
    if (!player) return;
    const actual = Math.min(amount, player.chips);
    player.chips    -= actual;
    player.bet      += actual;
    player.totalBet += actual;
    this.pot        += actual;
    if (player.chips === 0) player.status = 'all-in';
  }

  // ─── Player actions ───────────────────────────────────────────────────────

  playerAction(socketId, action, amount) {
    if (!['PREFLOP','FLOP','TURN','RIVER'].includes(this.state)) {
      return { error: 'No action allowed right now' };
    }
    const player = this.players.get(socketId);
    if (!player) return { error: 'Not in game' };
    if (this.actionQueue.length === 0 || this.actionQueue[0] !== player.seatIndex) {
      return { error: 'Not your turn' };
    }

    const toCall  = this.currentBet - player.bet;
    let isRaise   = false;

    switch (action) {
      case 'fold':
        player.status = 'folded';
        this.addLog(`${player.name} folds`);
        break;

      case 'check':
        if (toCall > 0) return { error: `Must call ${toCall} or fold` };
        this.addLog(`${player.name} checks`);
        break;

      case 'call': {
        const callAmt = Math.min(toCall, player.chips);
        if (callAmt === 0) { this.addLog(`${player.name} checks`); break; }
        player.chips    -= callAmt;
        player.bet      += callAmt;
        player.totalBet += callAmt;
        this.pot        += callAmt;
        if (player.chips === 0) player.status = 'all-in';
        this.addLog(`${player.name} calls ${callAmt}`);
        break;
      }

      case 'raise': {
        if (amount === undefined || amount <= this.currentBet) {
          return { error: `Raise must be above ${this.currentBet}` };
        }
        let raiseTo = Math.min(amount, player.bet + player.chips);
        // Auto-trim to effective stack
        if (this.settings.autoTrimBets) {
          const maxOpponent = Math.max(
            ...[...this.players.values()]
              .filter(p => p.id !== socketId && !['folded','sitting-out'].includes(p.status))
              .map(p => p.chips + p.bet)
          );
          raiseTo = Math.min(raiseTo, maxOpponent);
          raiseTo = Math.max(raiseTo, this.currentBet + this.minRaise);
        }
        const increase = raiseTo - this.currentBet;
        if (increase < this.minRaise && player.bet + player.chips > this.currentBet + this.minRaise) {
          return { error: `Minimum raise to ${this.currentBet + this.minRaise}` };
        }
        const raiseAmt = raiseTo - player.bet;
        player.chips    -= raiseAmt;
        player.bet      += raiseAmt;
        player.totalBet += raiseAmt;
        this.pot        += raiseAmt;
        this.minRaise    = Math.max(this.minRaise, increase);
        this.currentBet  = raiseTo;
        if (player.chips === 0) player.status = 'all-in';
        this.addLog(`${player.name} raises to ${raiseTo}`);
        isRaise = true;
        break;
      }

      case 'allin': {
        const allInAmt    = player.chips;
        const newTotalBet = player.bet + allInAmt;
        if (newTotalBet > this.currentBet) {
          const increase   = newTotalBet - this.currentBet;
          this.minRaise    = Math.max(this.minRaise, increase);
          this.currentBet  = newTotalBet;
          isRaise          = true;
          this.addLog(`${player.name} all-in for ${newTotalBet}`);
        } else {
          this.addLog(`${player.name} calls all-in ${allInAmt}`);
        }
        player.bet      += allInAmt;
        player.totalBet += allInAmt;
        this.pot        += allInAmt;
        player.chips     = 0;
        player.status    = 'all-in';
        break;
      }

      default:
        return { error: 'Unknown action' };
    }

    // 7-2 bounty tracking
    if (action === 'fold' && this.settings.bounty72 > 0) {
      // Note: bounty is paid at showdown if winner holds 7-2
    }

    this.actionQueue.shift();

    if (isRaise) {
      const others = this.getHandSeatsFrom(player.seatIndex).filter(s => {
        const p = this.getPlayerAtSeat(s);
        return p && p.status === 'active' && s !== player.seatIndex;
      });
      this.actionQueue = others;
    }

    const remaining = this.getHandPlayers().filter(p => p.status !== 'folded');
    if (remaining.length === 1) return this.awardUncontestedPot(remaining[0]);

    const stillActive = this.getHandPlayers().filter(p => p.status === 'active');
    if (stillActive.length === 0) this.actionQueue = [];

    if (this.actionQueue.length === 0) this.advanceStreet();
    return { success: true };
  }

  // ─── Street progression ───────────────────────────────────────────────────

  advanceStreet() {
    for (const p of this.players.values()) p.bet = 0;
    this.currentBet = 0;
    this.minRaise   = this.bigBlind;

    switch (this.state) {
      case STATES.PREFLOP:
        this.communityCards.push(this.deck.deal(), this.deck.deal(), this.deck.deal());
        this.state = STATES.FLOP;
        this.addLog(`Flop: ${this.communityCards.map(c => c.display).join(' ')}`);
        break;
      case STATES.FLOP:
        this.communityCards.push(this.deck.deal());
        this.state = STATES.TURN;
        this.addLog(`Turn: ${this.communityCards[3].display}`);
        break;
      case STATES.TURN:
        this.communityCards.push(this.deck.deal());
        this.state = STATES.RIVER;
        this.addLog(`River: ${this.communityCards[4].display}`);
        break;
      case STATES.RIVER:
        this.showdown();
        return;
    }

    const handSeats = this.getHandSeatsFrom(this.dealerSeat).filter(s => {
      const p = this.getPlayerAtSeat(s);
      return p && p.status === 'active';
    });
    this.actionQueue = handSeats;

    if (this.actionQueue.length === 0) this.advanceStreet();
  }

  // ─── Showdown & pot award ─────────────────────────────────────────────────

  showdown() {
    this.state = STATES.SHOWDOWN;
    const eligible = this.getHandPlayers().filter(p => p.status !== 'folded');

    for (const p of eligible) {
      p.handResult = bestHand(p.cards, this.communityCards);
    }

    // 7-2 bounty: if winner holds 7-2, pay bounty from losers
    this.lastWinners = this.awardPots(eligible);
    for (const { player, amount, handName } of this.lastWinners) {
      this.addLog(`${player.name} wins ${amount}${handName ? ` with ${handName}` : ''}`);
    }

    if (this.settings.bounty72 > 0) this.check72Bounty(eligible);
  }

  check72Bounty(eligible) {
    const bountyAmt = this.settings.bounty72;
    for (const winner of this.lastWinners) {
      const p = winner.player;
      const has72 = p.cards.some(c => c.value === 7) && p.cards.some(c => c.value === 2);
      if (has72) {
        for (const loser of eligible) {
          if (loser.id !== p.id && loser.chips >= bountyAmt) {
            loser.chips -= bountyAmt;
            p.chips     += bountyAmt;
          }
        }
        this.addLog(`${p.name} collects 7-2 bounty (${bountyAmt} per player)`);
      }
    }
  }

  awardPots(eligiblePlayers) {
    const allHand = this.getHandPlayers();
    const contributions = allHand
      .map(p => ({ id: p.id, totalBet: p.totalBet }))
      .sort((a, b) => a.totalBet - b.totalBet);

    const pots = [];
    let prev = 0;
    for (const { totalBet } of contributions) {
      if (totalBet > prev) {
        const level   = totalBet - prev;
        const count   = contributions.filter(c => c.totalBet >= totalBet).length;
        const amount  = level * count;
        const elig    = eligiblePlayers.filter(p => p.totalBet >= totalBet);
        if (elig.length > 0) pots.push({ amount, eligible: elig });
        prev = totalBet;
      }
    }

    const potTotal = pots.reduce((s, p) => s + p.amount, 0);
    if (this.pot > potTotal && pots.length > 0) {
      pots[pots.length - 1].amount += this.pot - potTotal;
    } else if (pots.length === 0) {
      pots.push({ amount: this.pot, eligible: eligiblePlayers });
    }

    const winners = [];
    for (const { amount, eligible } of pots) {
      if (eligible.length === 1) {
        eligible[0].chips += amount;
        winners.push({ player: eligible[0], amount, handName: eligible[0].handResult?.name });
        continue;
      }
      let bestResult = null;
      let potWinners = [];
      for (const p of eligible) {
        const result = p.handResult;
        if (!result) continue;
        const cmp = bestResult ? compareHands(result, bestResult) : 1;
        if (cmp > 0) { bestResult = result; potWinners = [p]; }
        else if (cmp === 0) potWinners.push(p);
      }
      const share     = Math.floor(amount / potWinners.length);
      const remainder = amount % potWinners.length;
      for (let i = 0; i < potWinners.length; i++) {
        const award = share + (i === 0 ? remainder : 0);
        potWinners[i].chips += award;
        winners.push({ player: potWinners[i], amount: award, handName: potWinners[i].handResult?.name });
      }
    }

    this.pot = 0;
    return winners;
  }

  awardUncontestedPot(winner) {
    const amount = this.pot;
    winner.chips += amount;
    this.addLog(`${winner.name} wins ${amount} (uncontested)`);
    this.pot = 0;
    this.state = STATES.SHOWDOWN;
    this.lastWinners = [{ player: winner, amount, handName: null }];

    // Rabbit hunting
    if (this.settings.rabbitHunting && this.communityCards.length < 5) {
      this.rabbitCards = [];
      const needed = 5 - this.communityCards.length;
      for (let i = 0; i < needed; i++) {
        try { this.rabbitCards.push(this.deck.deal()); } catch (e) {}
      }
      if (this.rabbitCards.length > 0) {
        this.addLog(`Rabbit: ${this.rabbitCards.map(c => c.display).join(' ')}`);
      }
    }
    return { success: true };
  }

  // ─── Host controls ────────────────────────────────────────────────────────

  hostAddChips(targetId, amount) {
    const p = this.players.get(targetId);
    if (!p) return { error: 'Player not found' };
    p.chips = Math.max(0, p.chips + amount);
    this.addLog(`Host ${amount >= 0 ? 'added' : 'removed'} ${Math.abs(amount)} chips ${amount >= 0 ? 'to' : 'from'} ${p.name}`);
    return { success: true };
  }

  hostSetChips(targetId, amount) {
    const p = this.players.get(targetId);
    if (!p) return { error: 'Player not found' };
    p.chips = Math.max(0, amount);
    this.addLog(`Host set ${p.name}'s chips to ${amount}`);
    return { success: true };
  }

  hostSetPlayerName(targetId, name) {
    const p = this.players.get(targetId);
    if (!p) return { error: 'Player not found' };
    p.name = String(name).trim().slice(0, 20) || p.name;
    return { success: true };
  }

  hostSetPlayerNote(targetId, note) {
    const p = this.players.get(targetId);
    if (!p) return { error: 'Player not found' };
    p.note = String(note).slice(0, 100);
    return { success: true };
  }

  hostRebuy(targetId) {
    const p = this.players.get(targetId);
    if (!p) return { error: 'Player not found' };
    p.chips += this.startingChips;
    if (p.status === 'sitting-out') p.status = 'active';
    this.addLog(`${p.name} rebuys ${this.startingChips}`);
    return { success: true };
  }

  hostSetBlinds(sb, bb) {
    this.smallBlind = Math.max(1, sb);
    this.bigBlind   = Math.max(2, bb);
    this.addLog(`Blinds changed to ${this.smallBlind}/${this.bigBlind}`);
    return { success: true };
  }

  hostKick(targetId) {
    const p = this.players.get(targetId);
    if (!p) return { error: 'Player not found' };
    this.addLog(`${p.name} was removed by host`);
    this.removePlayer(targetId);
    return { success: true, kickedId: targetId };
  }

  hostToggleSitOut(targetId) {
    const p = this.players.get(targetId);
    if (!p) return { error: 'Player not found' };
    if (p.status === 'sitting-out') {
      p.status = 'active';
      this.addLog(`${p.name} is back in`);
    } else {
      p.status = 'sitting-out';
      this.addLog(`${p.name} sits out`);
      this.actionQueue = this.actionQueue.filter(s => s !== p.seatIndex);
      if (this.actionQueue.length === 0 && ['PREFLOP','FLOP','TURN','RIVER'].includes(this.state)) {
        this.advanceStreet();
      }
    }
    return { success: true };
  }

  hostEndHand() {
    this.state = STATES.WAITING;
    this.actionQueue = [];
    this.communityCards = [];
    this.pot = 0;
    this.rabbitCards = [];
    this.timerStart = null;
    this.timerDuration = null;
    for (const p of this.players.values()) {
      p.cards = []; p.bet = 0; p.totalBet = 0;
      if (p.status !== 'sitting-out') p.status = 'active';
      p.handResult = null;
    }
    this.addLog('Host ended the hand');
    return { success: true };
  }

  updateSettings(newSettings) {
    const s = { ...this.settings };
    // Validate and merge
    if (typeof newSettings.anteEnabled       === 'boolean') s.anteEnabled       = newSettings.anteEnabled;
    if (typeof newSettings.anteAmount        === 'number')  s.anteAmount        = Math.max(0, newSettings.anteAmount);
    if (typeof newSettings.straddleEnabled   === 'boolean') s.straddleEnabled   = newSettings.straddleEnabled;
    if (typeof newSettings.decisionTime      === 'number')  s.decisionTime      = Math.max(0, newSettings.decisionTime);
    if (typeof newSettings.timeBankLength    === 'number')  s.timeBankLength    = Math.max(0, newSettings.timeBankLength);
    if (typeof newSettings.timeBankRechargeHands === 'number') s.timeBankRechargeHands = Math.max(0, newSettings.timeBankRechargeHands);
    if (typeof newSettings.autoStart         === 'boolean') s.autoStart         = newSettings.autoStart;
    if (typeof newSettings.autoStartDelay    === 'number')  s.autoStartDelay    = Math.max(1, newSettings.autoStartDelay);
    if (typeof newSettings.showdownTime      === 'number')  s.showdownTime      = [3,6,9].includes(newSettings.showdownTime) ? newSettings.showdownTime : 6;
    if (['always','ask','no'].includes(newSettings.runItTwice)) s.runItTwice     = newSettings.runItTwice;
    if (typeof newSettings.rabbitHunting     === 'boolean') s.rabbitHunting     = newSettings.rabbitHunting;
    if (typeof newSettings.bombPotEnabled    === 'boolean') s.bombPotEnabled    = newSettings.bombPotEnabled;
    if (typeof newSettings.bombPotNextHand   === 'boolean') s.bombPotNextHand   = newSettings.bombPotNextHand;
    if (typeof newSettings.bombPotAmount     === 'number')  s.bombPotAmount     = Math.max(0, newSettings.bombPotAmount);
    if (typeof newSettings.bounty72          === 'number')  s.bounty72          = Math.max(0, newSettings.bounty72);
    if (typeof newSettings.dealToAway        === 'boolean') s.dealToAway        = newSettings.dealToAway;
    if (typeof newSettings.revealAllIn       === 'boolean') s.revealAllIn       = newSettings.revealAllIn;
    if (typeof newSettings.spectatorsAllowed === 'boolean') s.spectatorsAllowed = newSettings.spectatorsAllowed;
    if (typeof newSettings.guestChatEnabled  === 'boolean') s.guestChatEnabled  = newSettings.guestChatEnabled;
    if (typeof newSettings.autoTrimBets      === 'boolean') s.autoTrimBets      = newSettings.autoTrimBets;
    this.settings = s;
    this.addLog('Table settings updated');
    return { success: true };
  }

  // ─── Chat ─────────────────────────────────────────────────────────────────

  addChat(playerId, msg) {
    const p = this.players.get(playerId);
    if (!p) return null;
    // Check guest chat permission
    if (!this.settings.guestChatEnabled && !p.isHost) return null;
    const entry = { player: p.name, msg: String(msg).slice(0, 300), time: Date.now() };
    this.chatHistory.push(entry);
    if (this.chatHistory.length > 200) this.chatHistory.shift();
    return entry;
  }

  addLog(msg) {
    this.log.push({ msg, time: Date.now() });
    if (this.log.length > 150) this.log.shift();
  }

  // ─── State serialization ──────────────────────────────────────────────────

  getPublicState(viewerId) {
    const isShowdown = this.state === STATES.SHOWDOWN;

    // Reveal all-in cards
    const allInReveal = this.settings.revealAllIn &&
      ['PREFLOP','FLOP','TURN','RIVER'].includes(this.state) &&
      this.getHandPlayers().filter(p => p.status !== 'folded').every(p => p.status === 'all-in');

    const players = [...this.players.values()].map(p => ({
      id: p.id,
      name: p.name,
      chips: p.chips,
      bet: p.bet,
      totalBet: p.totalBet,
      status: p.status,
      seatIndex: p.seatIndex,
      isHost: p.isHost,
      timeBank: p.timeBank,
      note: p.note || '',
      cards: (p.id === viewerId || isShowdown || allInReveal)
        ? p.cards
        : p.cards.map(() => ({ rank: '?', suit: '?', display: '?', id: 'back' })),
      cardCount: p.cards.length,
      handResult: (isShowdown || allInReveal) ? p.handResult : null,
    }));

    const currentPlayer = this.actionQueue.length > 0
      ? this.getPlayerAtSeat(this.actionQueue[0]) : null;

    return {
      roomId: this.roomId,
      hostId: this.hostId,
      state: this.state,
      players,
      seats: this.seats,
      communityCards: this.communityCards,
      rabbitCards: this.rabbitCards,
      pot: this.pot,
      currentBet: this.currentBet,
      minRaise: this.minRaise,
      dealerSeat: this.dealerSeat,
      sbSeat: this.sbSeat,
      bbSeat: this.bbSeat,
      straddleSeat: this.straddleSeat,
      currentPlayerId: currentPlayer?.id || null,
      smallBlind: this.smallBlind,
      bigBlind: this.bigBlind,
      handNumber: this.handNumber,
      log: this.log.slice(-30),
      chatHistory: this.chatHistory.slice(-60),
      lastWinners: this.lastWinners.map(w => ({ playerId: w.player.id, amount: w.amount, handName: w.handName })),
      startingChips: this.startingChips,
      settings: this.settings,
      timerStart: this.timerStart,
      timerDuration: this.timerDuration,
    };
  }
}

module.exports = PokerGame;
