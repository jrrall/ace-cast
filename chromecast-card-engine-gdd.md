# TBD Card Engine - Game Design Document

## Project Overview

### Title
TBD Card Engine

### Concept Statement
Turn any space into game night central: a Chromecast-powered card game engine that lets anyone jump in from their phone browser. From Texas Holdem to meme-packed drinking games, deal in your crew instantly, zero app installs, all local on one host.

### Genre
Party / Social Card Game Engine

### Target Audience
Gen-Z, Millennials, college crews, families, and party starters. Anyone looking for quick, authentic in-person fun—no tech headaches, just play.

### Unique Selling Point
No installs, no strangers—just your crew, browser-only entry, and throwback-to-now card classics on the big screen. IRL energy, swipe-easy, chaos and laughs amplified for the room, not the cloud. Game night? Just cast and go.

## Core Gameplay Features

### Host Device Capabilities
- One host phone runs the show: launches both TV (via Chromecast) and player browser UIs
- Runs local web server serving HTML/JS for both player and TV interfaces
- Controls all game logic and state management
- Manages player connections and real-time synchronization

### Player Experience
- Instant join via QR code or room code - no downloads or sign-ups required
- Browser-based UI for all interactions: draw cards, make plays, vote, spectate
- Drop-in/drop-out party-style gameplay
- Works on any device with a web browser

### Game Library Support
- **Classic Poker Games**: Texas Holdem, Five Card Draw, Omaha
- **Party Games**: Cards Against Humanity style games, meme decks
- **Drinking Games**: Kings, Never Have I Ever, custom house rules
- **Custom Game Creation**: Support for user-generated rulesets and card decks

### TV Display Features
- Real-time shared game board via Chromecast
- Card reveals and game state updates
- Interactive event feed showing player actions
- Visual effects for dramatic moments

## Technical Architecture

### Core Technology Stack
- **Host Server**: Lightweight web server (Node.js/Express or Python Flask)
- **Player UI**: Responsive HTML/CSS/JavaScript web application
- **TV Receiver**: Chromecast-compatible HTML/JS application
- **Communication**: WebSockets for real-time gameplay
- **Discovery**: QR codes and local network room codes

### Network Architecture
- Local area network (LAN) only - no cloud dependencies
- Host phone acts as server and Chromecast controller
- All player devices connect as clients to host server
- Real-time synchronization via WebSocket connections

### Data Management
- In-memory game state on host device
- JSON-based game rules and card definitions
- Local storage for game preferences and themes

## Monetization Strategy

### Revenue Model
- Single ad display per game session startup
- Optional cosmetic card theme packs and visual upgrades
- Never paywall core gameplay mechanics

### Monetization Features
- Quick, non-intrusive ad integration
- Theme store for card backs, UI skins, and visual effects
- Party pack bundles for special occasions

## User Experience Design

### Core Design Philosophy
- **Authentically Social**: Build the party, not the follower count
- **Frictionless**: Join in seconds, zero setup drama
- **Analog Vibes, Digital Speed**: Classic games in modern party flow
- **Privacy First**: Room-only gameplay, no cloud tracking

### User Flow
1. Host launches app and connects to Chromecast
2. TV displays QR code and room information
3. Players scan QR or enter room code in browsers
4. Host selects game type and rules
5. Game begins with synchronized play across all devices
6. Players interact via phone browsers, view shared state on TV

### UI/UX Requirements
- Mobile-first responsive design for player interfaces
- Large, TV-optimized display for shared game board
- Intuitive touch controls for card games
- Clear visual feedback for all actions
- Accessibility support for various devices and screen sizes

## Development Priorities

### Phase 1: Core Engine
- [ ] Basic host server implementation
- [ ] Chromecast receiver application
- [ ] Simple browser-based player UI
- [ ] WebSocket communication system
- [ ] Basic card game framework

### Phase 2: Game Implementation
- [ ] Texas Holdem implementation
- [ ] Cards Against Humanity style game
- [ ] Basic drinking game template
- [ ] Game state synchronization
- [ ] Player management system

### Phase 3: Polish & Monetization
- [ ] Ad integration system
- [ ] Theme and customization options
- [ ] Performance optimization
- [ ] Error handling and reconnection
- [ ] User testing and refinement

## Success Metrics

### Technical Metrics
- Connection reliability (>95% successful joins)
- Latency for game actions (<200ms local network)
- Simultaneous player capacity (target: 8-10 players)
- Cross-device compatibility

### Engagement Metrics
- Session duration (target: 20+ minutes average)
- Return usage rate
- Theme pack conversion rate
- Word-of-mouth sharing via QR code usage

## Risk Assessment

### Technical Risks
- **Chromecast API limitations**: Mitigation via fallback web-based TV display
- **Network connectivity issues**: Implement robust reconnection logic
- **Device compatibility**: Extensive cross-browser testing required

### Market Risks
- **Oversaturation of party games**: Focus on unique no-download advantage
- **Monetization challenges**: Keep ads minimal, focus on cosmetic upgrades

### User Experience Risks
- **Setup complexity**: Streamline host setup with clear onboarding
- **Learning curve**: Design intuitive interfaces requiring no tutorials

## Future Expansion Opportunities

### Additional Game Types
- Board game adaptations for card-based mechanics
- Trivia games with card-based scoring
- Custom tournament modes

### Platform Extensions
- Apple TV and Roku receiver app support
- Desktop browser host application
- Integration with streaming platforms

### Social Features
- Game session recording and highlights
- Custom deck sharing between friend groups
- Achievement and progression systems (local only)

---

**Document Version**: 1.0
**Last Updated**: September 26, 2025
**Document Type**: Game Design Document
**Target Platform**: Chromecast + Mobile Web Browsers
**Development Status**: Pre-Production