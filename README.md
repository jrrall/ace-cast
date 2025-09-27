# 🎮 Ace Cast

> A Chromecast-powered card game engine for instant party gaming

Turn any space into game night central! Ace Cast lets anyone join card games from their phone browser with zero app installs. From Texas Hold'em to party games, deal in your crew instantly—all local, all authentic fun.

## 🚀 Quick Start

### Prerequisites
- Node.js 18+ 
- A Chromecast device (or any device with a web browser for TV display)
- Local WiFi network

### Installation

```bash
# Clone the repository
git clone <your-repo-url>
cd ace-cast

# Install dependencies
npm install

# Start the server
npm start
```

The server will start on port 3001 and display connection URLs:
- **Host Interface**: `http://localhost:3001` 
- **Player Join**: `http://localhost:3001/player`
- **TV Display**: `http://localhost:3001/tv/[ROOM_CODE]`

### Network Access (for phones/tablets)

When you start the server, it will display network URLs like:
```
📲 Network URLs (for phones/tablets):
🌐 Network Host interface: http://192.168.1.160:3001
📱 Network Player join: http://192.168.1.160:3001/player  
📺 Network TV display: http://192.168.1.160:3001/tv/[ROOM_CODE]
```

Players can use these network URLs to join from their phones on the same WiFi network.

## 🎯 What is Ace Cast?

Ace Cast is a **local-network party game engine** that brings classic card games to the modern party experience:

- **No Downloads**: Players join instantly via browser - no app store visits
- **Chromecast Ready**: Big screen display for shared game state and drama
- **Local Network**: Everything runs on your WiFi - no cloud, no strangers
- **Drop-in/Drop-out**: Perfect for party-style gaming
- **Real-time**: WebSocket-powered instant synchronization

### Perfect For
- 🏠 House parties and gatherings
- 🎓 College dorm game nights  
- 👨‍👩‍👧‍👦 Family game time
- 🍻 Bar nights and social events

## 📁 Project Structure

```
ace-cast/
├── src/                    # Source code
│   ├── server/            # Express server & WebSocket handling
│   │   └── index.js       # Main server entry point
│   └── game/              # Game engine core
│       ├── GameManager.js # Manages rooms and game sessions
│       └── GameRoom.js    # Individual game room logic
├── public/                # Client-side assets
│   ├── js/               # Frontend JavaScript
│   │   ├── host.js       # Host interface logic
│   │   ├── player.js     # Player interface logic  
│   │   └── tv.js         # TV display logic
│   └── css/              # Stylesheets
│       ├── host.css      # Host interface styles
│       ├── player.css    # Player interface styles
│       └── tv.css        # TV display styles
├── views/                 # EJS templates
│   ├── host/             # Host interface templates
│   ├── player/           # Player interface templates
│   └── tv/               # TV display templates
├── tests/                 # Test suite
│   ├── setup.js          # Jest configuration & mocks
│   ├── game_manager.test.js
│   ├── game_room.test.js
│   └── test_game.test.js
├── .eslintrc.js          # ESLint configuration (Airbnb style)
├── jest.config.js        # Jest testing configuration
└── package.json          # Dependencies and scripts
```

## 🛠 Development Setup

### Development Commands

```bash
# Start development server with auto-reload
npm run dev

# Run tests
npm test

# Run tests in watch mode  
npm run test:watch

# Generate test coverage report
npm run test:coverage

# Lint code
npm run lint

# Auto-fix linting issues
npm run lint:fix
```

### Code Quality Standards

This project uses **strict ESLint rules** with Airbnb JavaScript style guide:

- **Strict Mode**: All ESLint rules are errors (no warnings)
- **Modern Standards**: ES2022+ JavaScript features
- **Best Practices**: Import/export, proper error handling
- **Consistency**: Enforced code formatting and style

### Testing Philosophy

- **Isolated Unit Tests**: Each component tested independently with mocks
- **Fast Execution**: Tests run quickly without shared state
- **High Coverage**: Aim for comprehensive test coverage
- **Located in `/tests`**: All tests centralized, not scattered in src

```bash
# Example test run
npm test

> ace-cast@1.0.0 test
> jest

 PASS  tests/game_manager.test.js
 PASS  tests/game_room.test.js
 PASS  tests/test_game.test.js

Test Suites: 3 passed, 3 total
Tests:       15 passed, 15 total
```

## 🏗 Architecture Overview

### Core Components

#### 1. **Server Layer** (`src/server/`)
- **Express.js** web server serving static assets and API endpoints
- **Socket.io** WebSocket server for real-time communication
- **EJS** templating for dynamic HTML generation
- **CORS** enabled for cross-origin requests

#### 2. **Game Engine** (`src/game/`)
- **GameManager**: Manages multiple game rooms, player connections
- **GameRoom**: Handles individual game sessions, state management
- **Modular Games**: Pluggable game implementations (TestGame included)

#### 3. **Client Applications** (`public/`)
- **Host Interface**: Room creation, game selection, management
- **Player Interface**: Join games, submit actions, view hand
- **TV Display**: Shared game state, real-time updates

### Network Flow

```
[Host Phone] ←→ [Express Server] ←→ [WebSocket Layer]
                      ↓
[Chromecast/TV] ←→ [Game Engine] ←→ [Player Phones]
```

1. **Host** starts server and creates game room
2. **TV/Chromecast** connects to room display URL
3. **Players** scan QR code or enter room code
4. **Game Engine** synchronizes all actions in real-time
5. **WebSockets** maintain live connections for instant updates

## 🎲 Adding New Games

Games are modular and pluggable! Here's how to add a new card game:

### 1. Create Game Class

```javascript path=null start=null
// src/game/games/MyNewGame.js
class MyNewGame {
  constructor(room) {
    this.room = room;
    this.gameState = {
      phase: 'waiting',
      players: {},
      // ... your game state
    };
  }

  // Called when game starts
  startGame() {
    this.gameState.phase = 'playing';
    this.notifyPlayers();
  }

  // Handle player actions
  handleAction(playerId, action, data) {
    switch (action) {
      case 'play_card':
        return this.playCard(playerId, data);
      default:
        return { success: false, error: 'Unknown action' };
    }
  }

  // Get game state for players
  getGameState() {
    return this.gameState;
  }

  // Private helper methods
  playCard(playerId, cardData) {
    // Implement your game logic
    this.notifyPlayers();
    return { success: true };
  }

  notifyPlayers() {
    this.room.broadcastGameState();
  }
}

module.exports = MyNewGame;
```

### 2. Register Game Type

```javascript path=null start=null
// In src/server/index.js, add to game registry
const gameRegistry = {
  'test': TestGame,
  'mynewgame': MyNewGame,  // Add your game here
};
```

### 3. Create Client UI

Add game-specific UI elements in the respective client files:
- `public/js/player.js` - Player actions and hand management
- `public/js/tv.js` - Shared game board display
- `public/css/` - Game-specific styling

### 4. Write Tests

```javascript path=null start=null
// tests/my_new_game.test.js
const MyNewGame = require('../src/game/games/MyNewGame');

describe('MyNewGame', () => {
  let mockRoom;
  let game;

  beforeEach(() => {
    mockRoom = {
      broadcastGameState: jest.fn(),
      // ... other room methods
    };
    game = new MyNewGame(mockRoom);
  });

  it('should initialize with waiting phase', () => {
    expect(game.gameState.phase).toBe('waiting');
  });

  // ... more tests
});
```

## 🚀 Deployment

### Local Network Deployment

For house parties and local gaming:

1. **Ensure all devices on same WiFi network**
2. **Start server**: `npm start`
3. **Note the network IP**: Server displays network URLs on startup
4. **Connect TV**: Navigate Chromecast to `http://[IP]:3001/tv/[ROOM_CODE]`
5. **Share player link**: `http://[IP]:3001/player`

### Production Deployment Options

#### Option 1: Raspberry Pi Home Server
Perfect for permanent game night setup:

```bash
# On Raspberry Pi
git clone <repo-url>
cd ace-cast
npm install --production
npm start
```

#### Option 2: Cloud Deployment (Heroku/Railway/etc.)
For remote play capabilities:

```bash
# Set environment variables
PORT=3001
NODE_ENV=production

# Deploy with your preferred platform
```

## 🧪 Testing

### Test Structure

Tests are **isolated and independent**:
- **No shared state** between tests
- **Mocked dependencies** for fast execution
- **Comprehensive coverage** of core functionality

```bash
# Run full test suite
npm test

# Watch mode for development
npm run test:watch  

# Coverage report
npm run test:coverage
```

### Writing Tests

Follow these patterns:

```javascript path=null start=null
describe('ComponentName', () => {
  let mockDependency;
  let component;

  beforeEach(() => {
    // Reset mocks for each test
    mockDependency = {
      method: jest.fn(),
    };
    component = new Component(mockDependency);
  });

  it('should do something specific', () => {
    // Arrange
    const input = 'test-input';
    
    // Act  
    const result = component.doSomething(input);
    
    // Assert
    expect(result).toBe('expected-output');
    expect(mockDependency.method).toHaveBeenCalledWith(input);
  });
});
```

## 🔄 CI/CD Pipeline

This project uses **Trunk-Based Development** with automated semantic versioning:

### Workflows
- **CI**: Runs tests and linting on all pushes and PRs
- **Release**: Automatic versioning and releases on main branch
- **Quality Gates**: ESLint, tests, and coverage must pass

### Conventional Commits
Use conventional commit format for automatic versioning:

```bash
# Feature (minor version bump)
git commit -m "feat: add new card game"

# Bug fix (patch version bump) 
git commit -m "fix: resolve disconnection issue"

# Breaking change (major version bump)
git commit -m "feat!: redesign game API

BREAKING CHANGE: API structure changed"
```

See [CI/CD Documentation](docs/CI_CD.md) for complete details.

## 🤝 Contributing

### Development Workflow

1. **Fork and clone** the repository
2. **Create feature branch**: `git checkout -b feat/awesome-game`
3. **Make changes** with conventional commits
4. **Add tests** for new functionality
5. **Run quality checks**: `npm run lint && npm test`
6. **Push branch** - CI will run automatically
7. **Create pull request** to main

### Code Style Requirements

- **ESLint compliance**: All code must pass `npm run lint`
- **Test coverage**: New features require tests
- **Documentation**: Update README for new features
- **Commit style**: Clear, descriptive commit messages

## 📜 License

MIT License - see [LICENSE](LICENSE) file for details.

## 🎯 Roadmap

### Current Features ✅
- [x] Local network game server
- [x] WebSocket real-time communication
- [x] Basic test game implementation
- [x] Player/Host/TV interfaces
- [x] Comprehensive test suite
- [x] Strict code quality standards

### Coming Soon 🚧
- [ ] Texas Hold'em poker game
- [ ] Cards Against Humanity style game  
- [ ] Advanced player management
- [ ] Game replay and statistics
- [ ] Custom deck support
- [ ] Theme and visual customization

### Future Vision 🌟
- [ ] Multiple simultaneous game rooms
- [ ] Tournament modes
- [ ] Game recording and highlights
- [ ] Advanced Chromecast integration
- [ ] Mobile-optimized interfaces

---

**Ready to deal in some fun?** 🃏

```bash
npm install && npm start
```

Join the party at `http://localhost:3001` or scan the QR code to get started!