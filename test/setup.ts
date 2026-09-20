// Global test timeout
jest.setTimeout(10000);

// Silence console.error in tests unless explicitly testing errors
const originalError = console.error;
beforeAll(() => {
  console.error = (...args) => {
    if (args[0]?.includes?.('Warning:') || args[0]?.includes?.('act(')) return;
    originalError.apply(console, args);
  };
});

afterAll(() => {
  console.error = originalError;
});