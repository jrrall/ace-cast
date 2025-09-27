// Jest setup file for isolated unit tests

// Set test timeout
jest.setTimeout(10000);

// Global test utilities
global.createMockSocket = () => ({
  id: 'test-socket-id',
  emit: jest.fn(),
  join: jest.fn(),
  disconnect: jest.fn(),
});

// Mock console methods to prevent spam during tests
const originalConsole = {
  log: console.log,
  error: console.error,
  warn: console.warn,
  info: console.info,
};

beforeEach(() => {
  // Mock console methods for cleaner test output
  console.log = jest.fn();
  console.error = jest.fn();
  console.warn = jest.fn();
  console.info = jest.fn();
});

afterEach(() => {
  // Restore console methods
  Object.assign(console, originalConsole);
  
  // Clear all timers
  jest.clearAllTimers();
  
  // Clear module cache to ensure test isolation
  jest.resetModules();
});