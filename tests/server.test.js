jest.mock('../src/app', () => ({
  createApp: jest.fn(() => ({
    listen: jest.fn((port, callback) => {
      if (callback) {
        callback();
      }
      return { close: jest.fn() };
    }),
  })),
}));

const { createApp } = require('../src/app');
const { start } = require('../src/server');
const {
  snapshotEnv,
  restoreEnv,
  clearSalesforceEnv,
  generateKeyPair,
  applyTestConfig,
} = require('./helpers');

describe('server startup', () => {
  const snapshot = snapshotEnv();

  beforeEach(() => {
    createApp.mockClear();
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(process, 'exit').mockImplementation((code) => {
      throw new Error(`exit:${code}`);
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(() => {
    restoreEnv(snapshot);
  });

  test('refuses to start when Salesforce configuration is missing', () => {
    clearSalesforceEnv();

    expect(() => start()).toThrow('exit:1');
    const report = console.log.mock.calls.map((call) => call.join(' ')).join('\n');
    expect(report).toContain('PRIVATE_KEY: missing');
    expect(report).not.toMatch(/BEGIN PRIVATE KEY/);
    expect(createApp).not.toHaveBeenCalled();
  });

  test('starts when configuration is present without printing secrets', () => {
    const { privateKey } = generateKeyPair();
    clearSalesforceEnv();
    applyTestConfig(privateKey);

    start();

    const report = console.log.mock.calls.map((call) => call.join(' ')).join('\n');
    expect(report).toContain('PRIVATE_KEY: configured');
    expect(report).toContain('API_VERSION: configured');
    expect(report).toContain('Disposition Lead API listening on port 3000');
    expect(report).not.toContain(privateKey);
    expect(report).not.toContain('test-client-id');
    expect(createApp).toHaveBeenCalled();
  });
});
