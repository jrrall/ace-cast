const GameRoom = require('./GameRoom');

class GameManager {
  constructor() {
    this.rooms = new Map();
  }

  generateRoomCode() {
    // Generate a 4-letter room code
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    let code;
    let attempts = 0;

    do {
      code = '';
      for (let i = 0; i < 4; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
      }
      attempts++;
    } while (this.rooms.has(code) && attempts < 100);

    if (attempts >= 100) {
      throw new Error('Unable to generate unique room code');
    }

    return code;
  }

  createRoom(roomCode) {
    if (this.rooms.has(roomCode)) {
      throw new Error('Room code already exists');
    }

    const room = new GameRoom(roomCode);
    this.rooms.set(roomCode, room);

    console.log(`Created room: ${roomCode}`);
    return room;
  }

  getRoom(roomCode) {
    return this.rooms.get(roomCode);
  }

  removeRoom(roomCode) {
    const room = this.rooms.get(roomCode);
    if (room) {
      room.cleanup();
      this.rooms.delete(roomCode);
      console.log(`Removed room: ${roomCode}`);
      return true;
    }
    return false;
  }

  getAllRooms() {
    return Array.from(this.rooms.values());
  }

  getRoomCount() {
    return this.rooms.size;
  }

  // Clean up inactive rooms (could be called periodically)
  cleanupInactiveRooms() {
    const now = Date.now();
    const inactiveThreshold = 2 * 60 * 60 * 1000; // 2 hours

    for (const [roomCode, room] of this.rooms.entries()) {
      if (room.players.size === 0 && (now - room.lastActivity) > inactiveThreshold) {
        this.removeRoom(roomCode);
      }
    }
  }
}

// Export singleton instance
module.exports = new GameManager();
