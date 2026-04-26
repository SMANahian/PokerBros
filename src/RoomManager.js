'use strict';

const PokerGame = require('./PokerGame');

class RoomManager {
  constructor() {
    this.rooms = new Map(); // roomId -> { game, createdAt }
    // Cleanup stale rooms every 30 minutes
    setInterval(() => this.cleanup(), 30 * 60 * 1000);
  }

  create(roomId, hostId) {
    const game = new PokerGame(roomId, hostId);
    this.rooms.set(roomId, { game, createdAt: Date.now() });
    return game;
  }

  get(roomId) {
    return this.rooms.get(roomId)?.game || null;
  }

  getOrCreate(roomId, hostId) {
    return this.get(roomId) || this.create(roomId, hostId);
  }

  delete(roomId) {
    this.rooms.delete(roomId);
  }

  cleanup() {
    const cutoff = Date.now() - 4 * 60 * 60 * 1000; // 4 hours
    for (const [id, { createdAt, game }] of this.rooms) {
      if (createdAt < cutoff && game.players.size === 0) {
        this.rooms.delete(id);
      }
    }
  }
}

module.exports = RoomManager;
