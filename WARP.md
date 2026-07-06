# WARP.md

This file provides guidance to WARP (warp.dev) when working with code in this repository.

## Project Overview

Ace Cast is a **Chromecast-powered card game engine** for instant party gaming. It's a local-network multiplayer system where players join games via browser (no app installs) while the shared game state displays on a TV/Chromecast.

**Core concept**: One host phone runs a web server that serves three different interfaces:
- **Host Interface** (`/`) - Game management and control
- **Player Interface** (`/player`) - Join games, view hand, submit actions
- **TV Display** (`/tv/[ROOM_CODE]`) - Shared game board for Chromecast

## Essential Development Commands

```bash
# Installation and startup
npm install
npm start                    # Production server on port 3000

# Development workflow
npm run dev                  # Development server with auto-reload (nodemon)
npm run lint                 # ESLint code quality check
npm run lint:fix             # Auto-fix linting issues

# Testing
npm test                     # Run full test suite
npm run test:watch           # Watch mode for test-driven development
npm run test:coverage        # Generate coverage report

# Single test file (useful during development)
npx jest tests/game_room.test.js
npx jest --testNamePattern="should handle player actions"
```

## Architecture Overview

### Three-Tier Real-Time System

**Network Flow**: `[Host Phone] ←→ [Express Server] ←→ [WebSocket Layer] ←→ [Game Engine] ←→ [Player Phones + TV]`

#### 1. Server Layer (`src/server/`)
- **Express.js** web server with EJS templating
- **Socket.io** WebSocket server for real-time communication
- **Network discovery** - Auto-detects local IP and generates QR codes
- **CORS enabled** for cross-origin device connections

#### 2. Game Engine (`src/game/`)
**GameManager** (singleton):
- Manages multiple concurrent game rooms
- Generates unique 4-letter room codes
- Handles room lifecycle and cleanup

**GameRoom**:
- Individual game session management
- Player connection tracking with Socket.io references
- Game state synchronization across all connected devices
- Pluggable game engine architecture

#### 3. Client Applications (`public/`)
- **Host** (`public/js/host.js`) - Room creation, game selection
- **Player** (`public/js/player.js`) - Join games, hand management
- **TV** (`public/js/tv.js`) - Real-time shared game board

### Game Engine Architecture

Games are **modular and pluggable**. Each game class must implement:
```javascript
class NewGame {
  constructor(room) { /* Initialize with room reference */ }
  getInitialState() { /* Return starting game state */ }
  handlePlayerAction(playerId, actionData) { /* Process player moves */ }
  handlePlayerLeave(playerId) { /* Handle disconnections */ }
  cleanup() { /* Game cleanup */ }
}
```

**Current games**: TestGame (reference implementation)
**Planned games**: Texas Hold'em, Cards Against Humanity-style games

## Code Quality Standards

### ESLint Configuration
- **Airbnb JavaScript style** with strict enforcement
- **Modern ES2022+** features required
- **No warnings policy** - all rules are errors
- Key rules: single quotes, 2-space indentation, trailing commas, no console restrictions

### Testing Philosophy
- **Isolated unit tests** with comprehensive mocking
- **Test location**: All tests in `/tests` directory (not scattered in src)
- **Fast execution** - No shared state between tests
- **Mock everything** - Socket.io, external dependencies, console methods
- **Setup file**: `tests/setup.js` provides global test utilities

```bash
# Test pattern for new features
# 1. Write test first
npx jest --testNamePattern="should implement new feature" --watch

# 2. Implement feature
# 3. Ensure all tests pass
npm test
```

## WebSocket Event Patterns

**Key events for real-time gameplay**:
- `join-room` - Player/TV/Host connects to game room
- `player-action` - Player submits game moves
- `start-game` - Host initiates gameplay
- `game-update` - Broadcast game state changes
- `player-joined`/`player-left` - Room membership changes

**Client type detection**: Each socket has `deviceType` ('player', 'tv', 'host') determining available actions.

## Development Workflow

### Adding New Games
1. **Create game class** in `src/game/games/NewGame.js`
2. **Register in GameRoom.js** switch statement (lines 83-104)
3. **Add client-side UI** in respective `public/js/` files
4. **Write comprehensive tests** in `tests/new_game.test.js`
5. **Update game selection UI** in host interface

### Network Development
**Local testing**: Server auto-detects network IP and displays URLs for phones/tablets
**Port**: Default 3000 (configurable via PORT env var)
**CORS**: Enabled for cross-device development

## CI/CD Pipeline

### Trunk-Based Development
- **Main branch** only for production-ready code
- **Conventional commits** required for semantic versioning
- **Automated releases** on main branch pushes

### Commit Format Examples
```bash
feat: add Texas Hold'em poker game          # Minor version bump
fix: resolve player disconnection issues    # Patch version bump
feat!: redesign game state API             # Major version bump (breaking)
```

### Quality Gates
- ESLint (Airbnb style) must pass
- All unit tests must pass  
- Multi-Node.js version testing (18, 20, 22)
- Test coverage reporting

## Local Network Gaming

### Host Setup
```bash
npm start
# Note displayed network URLs:
# 🌐 Network Host interface: http://192.168.1.160:3000
# 📱 Network Player join: http://192.168.1.160:3000/player  
# 📺 Network TV display: http://192.168.1.160:3000/tv/[ROOM_CODE]
```

### Connection Flow
1. Host creates room → generates QR code
2. TV/Chromecast connects to `/tv/[ROOM_CODE]`
3. Players scan QR code or enter room code
4. Real-time WebSocket synchronization begins

## Key Implementation Details

### Room Code Generation
- 4-letter codes (A-Z only)
- Collision detection with 100-attempt retry
- Automatic cleanup of inactive rooms

### Player Management
- Each player has Socket.io reference for real-time communication  
- Player state includes hand, stats, connection status
- Graceful handling of disconnections during gameplay

### Game State Synchronization
- Game engine broadcasts state changes via `room.broadcastToPlayers()`
- TV display receives same game state as players
- WebSocket ensures sub-200ms local network latency

## Testing Utilities

Global test helpers in `tests/setup.js`:
```javascript
// Mock socket for game room testing
const mockSocket = createMockSocket();

// Console methods mocked automatically
// Module cache cleared between tests for isolation
```

Common test pattern:
```javascript
describe('Feature', () => {
  let mockRoom, mockSocket, component;
  
  beforeEach(() => {
    mockRoom = { broadcastToPlayers: jest.fn() };
    mockSocket = createMockSocket();
    component = new Component(mockRoom);
  });
});
```

## Performance Considerations

- **Local network only** - No cloud latency
- **WebSocket persistent connections** for real-time updates
- **Memory-based game state** - No database overhead
- **Automatic room cleanup** prevents memory leaks
- **Target capacity**: 8-10 simultaneous players per room