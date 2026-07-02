# Ace Cast - Code Refactoring Guide

## Overview

This document outlines the comprehensive refactoring of the Ace Cast codebase to make it more functional, reduce code duplication, and improve maintainability. The refactoring introduces several key improvements:

## 🎯 Key Improvements

### 1. **Functional Programming Patterns**
- **Pure functions** for better testability and predictability
- **Function composition** using `pipe` and `compose` utilities
- **Immutable state management** with deep cloning and immutable updates
- **Monads** (Maybe, Result) for better error handling and null safety

### 2. **Code Duplication Reduction** 
- **Centralized configuration** management
- **Reusable validation** utilities
- **Standardized error handling** patterns
- **Common socket event handlers**

### 3. **Better Architecture**
- **Game engine abstraction** with base classes and factory pattern
- **Dependency injection** through utility modules
- **Separation of concerns** with clear module boundaries

## 📁 New File Structure

```
src/
├── utils/
│   ├── config.js              # Centralized configuration
│   ├── validation.js          # Input validation utilities
│   ├── errorHandler.js        # Error handling and logging
│   ├── functional.js          # Functional programming utilities
│   └── socketHandlers.js      # Socket event handling utilities
├── game/
│   ├── engines/
│   │   ├── BaseGameEngine.js  # Abstract base class for games
│   │   └── GameEngineFactory.js # Factory for creating game engines
│   ├── GameManagerRefactored.js # Functional GameManager implementation
│   ├── GameManager.js         # Original (for comparison)
│   └── GameRoom.js           # Original (to be refactored next)
```

## 🚀 Usage Examples

### Configuration Management

**Before:**
```javascript
// Scattered magic numbers throughout code
const PORT = process.env.PORT || 3000;
const roomCode = Array.from({ length: 4 }, () => 'A').join('');
// Different validation patterns everywhere
```

**After:**
```javascript
const config = require('./src/utils/config');

// Centralized and consistent
const server = app.listen(config.server.port, config.server.host);
const roomCode = generateRoomCode(config.room.codeLength);
```

### Error Handling

**Before:**
```javascript
try {
  // Some operation
  res.json({ roomCode });
} catch (error) {
  console.error('Error:', error);
  res.status(500).json({ error: 'Something went wrong' });
}
```

**After:**
```javascript
const { asyncHandler, AppError } = require('./src/utils/errorHandler');

const createRoom = asyncHandler(async (req, res) => {
  const result = gameManager.createRoom(roomCode);
  
  if (result.isError()) {
    throw result.error;
  }
  
  res.json({ 
    success: true, 
    data: { roomCode: result.value.code } 
  });
});
```

### Validation

**Before:**
```javascript
// Inconsistent validation patterns
if (!roomCode || roomCode.length !== 4) {
  return res.status(400).json({ error: 'Invalid room code' });
}
```

**After:**
```javascript
const { validateRoomCode, safeValidate } = require('./src/utils/validation');

const validation = safeValidate(validateRoomCode, roomCode);
if (!validation.valid) {
  throw new AppError(validation.error.message, 400, 'VALIDATION_ERROR');
}
```

### Functional Game Manager

**Before:**
```javascript
// Imperative room creation
createRoom(roomCode) {
  if (this.rooms.has(roomCode)) {
    throw new Error('Room code already exists');
  }
  const room = new GameRoom(roomCode);
  this.rooms.set(roomCode, room);
  return room;
}
```

**After:**
```javascript
// Functional with Result monad
createRoom(roomCode) {
  try {
    validateRoomCode(roomCode);
    
    if (this.rooms.has(roomCode)) {
      return Result.Error(new AppError('Room code already exists', 400, 'ROOM_EXISTS'));
    }
    
    const room = new GameRoom(roomCode);
    this.rooms.set(roomCode, room);
    return Result.Ok(room);
  } catch (error) {
    return Result.Error(error);
  }
}
```

### Socket Event Handling

**Before:**
```javascript
// Duplicated event handling logic
socket.on('join-room', (data) => {
  const { roomCode, playerName, deviceType } = data;
  
  // Validation scattered throughout
  if (!roomCode) {
    socket.emit('error', { message: 'Room code required' });
    return;
  }
  
  // Handler logic...
});
```

**After:**
```javascript
const { createConnectionHandler } = require('./src/utils/socketHandlers');

// Centralized, reusable handlers with built-in validation
const connectionHandler = createConnectionHandler(gameManager, io);
io.on('connection', connectionHandler);
```

### Game Engine Architecture

**Before:**
```javascript
// Tight coupling in GameRoom
switch (gameType.toLowerCase()) {
  case 'poker':
    this.gameEngine = new TestGame(this, options); // Fallback
    break;
  case 'test':
    this.gameEngine = new TestGame(this, options);
    break;
}
```

**After:**
```javascript
const gameEngineFactory = require('./src/game/engines/GameEngineFactory');

// Flexible, extensible factory pattern
startGame(gameType, options = {}) {
  try {
    this.gameEngine = gameEngineFactory.createEngineWithValidation(
      gameType, 
      this, 
      options
    );
    // ...
  } catch (error) {
    throw new AppError(`Cannot start game: ${error.message}`, 400);
  }
}
```

## 🔄 Migration Path

### Phase 1: Utility Integration (Immediate)
1. Replace scattered constants with `config.js`
2. Implement `validation.js` for input validation
3. Use `errorHandler.js` for consistent error handling

### Phase 2: Socket Handling (Week 1)
1. Integrate `socketHandlers.js` into existing server
2. Replace duplicate socket logic with centralized handlers
3. Add validation and throttling to socket events

### Phase 3: Game Engine Refactoring (Week 2)
1. Migrate existing games to extend `BaseGameEngine`
2. Use `GameEngineFactory` for game creation
3. Replace direct instantiation with factory pattern

### Phase 4: Complete GameManager Migration (Week 3)
1. Replace original `GameManager` with `GameManagerRefactored`
2. Update all references to use Result monads
3. Implement functional room management patterns

## 🧪 Testing Benefits

The refactored code offers significant testing advantages:

```javascript
// Pure functions are easy to test
describe('generateRoomCode', () => {
  test('generates code of correct length', () => {
    const code = generateRoomCode();
    expect(code).toHaveLength(config.room.codeLength);
    expect(code).toMatch(config.validation.roomCode);
  });
});

// Result monads make error testing clear
describe('GameManager.createRoom', () => {
  test('returns error for duplicate room', () => {
    const result = gameManager.createRoom('TEST');
    expect(result.isError()).toBe(true);
    expect(result.error.code).toBe('ROOM_EXISTS');
  });
});
```

## 🎮 Game Development Benefits

Creating new games is now much simpler:

```javascript
class PokerGameEngine extends BaseGameEngine {
  setupActionHandlers() {
    super.setupActionHandlers();
    this.registerActionHandler('bet', this.handleBet.bind(this));
    this.registerActionHandler('fold', this.handleFold.bind(this));
    this.registerActionHandler('call', this.handleCall.bind(this));
  }
  
  handleBet(playerId, { amount }) {
    // Game-specific logic with automatic validation, logging, and state management
    if (this.state.players[playerId].chips < amount) {
      return this.createErrorResult('Insufficient chips');
    }
    
    // Update state immutably
    this.state = immutableSet(this.state, `players.${playerId}.chips`, 
      this.state.players[playerId].chips - amount);
      
    return this.createActionResult('game-update', this.getGameState());
  }
}

// Register the new game
gameEngineFactory.registerEngine('poker', PokerGameEngine);
```

## 📊 Performance Improvements

1. **Reduced Memory Usage**: Immutable state management prevents memory leaks
2. **Better Caching**: Pure functions enable memoization
3. **Faster Debugging**: Structured logging and error handling
4. **Scalable Architecture**: Factory patterns and dependency injection

## 🔧 Maintenance Benefits

1. **Single Source of Truth**: Configuration centralization
2. **Consistent Error Handling**: Standardized error responses
3. **Easier Testing**: Pure functions and dependency injection
4. **Better Documentation**: Self-documenting functional code
5. **Reduced Bugs**: Type safety through validation utilities

## 🚀 Next Steps

1. **Client-Side Refactoring**: Apply similar patterns to `host.js` and `player.js`
2. **Database Integration**: Add persistence layer with functional patterns
3. **Performance Monitoring**: Integrate structured logging and metrics
4. **Advanced Game Features**: Build more complex games using the new architecture

The refactored codebase provides a solid foundation for scaling the Ace Cast platform while maintaining code quality and developer productivity.