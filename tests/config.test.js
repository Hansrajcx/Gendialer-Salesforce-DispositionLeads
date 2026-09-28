const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  snapshotEnv,
  restoreEnv,
  clearSalesforceEnv,
  fingerprint,
  generateKeyPair,
} = require('./helpers');

const {
  validateSalesforceConfig,
  formatConfigReport,
  loadPrivateKey,
  normalizePrivateKey,
} = require('../src/config/salesforce');

describe('Salesforce configuration', () => {
  const snapshot = snapshotEnv();
  let tempDir;

  beforeEach(() => {
    clearSalesforceEnv();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-key-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  afterAll(() => {
    restoreEnv(snapshot);
  });

  test('reports missing configuration without secret values', () => {
    const { status, ok } = validateSalesforceConfig();
    const report = formatConfigReport(status);

    expect(ok).toBe(false);
    expect(report).toBe([
      'Salesforce configuration:',
      '  LOGIN_URL: missing',
      '  CLIENT_ID: missing',
      '  USERNAME: missing',
      '  PRIVATE_KEY: missing',
      '  API_VERSION: missing',
    ].join('\n'));
    expect(report).not.toMatch(/BEGIN PRIVATE KEY/);
  });

  test('converts escaped newlines in the inline private key', () => {
    const { privateKey } = generateKeyPair();
    process.env.SALESFORCE_PRIVATE_KEY = privateKey.replace(/\n/g, '\\n');

    const loaded = loadPrivateKey();
    expect(loaded.source).toBe('SALESFORCE_PRIVATE_KEY');
    expect(fingerprint(loaded.key)).toBe(fingerprint(privateKey));
    expect(loaded.key.includes('\n')).toBe(true);
  });

  test('reads the private key from a file when the inline value is empty', () => {
    const { privateKey } = generateKeyPair();
    const keyPath = path.join(tempDir, 'server.key');
    fs.writeFileSync(keyPath, privateKey.replace(/\n/g, '\\n'));
    process.env.SALESFORCE_PRIVATE_KEY_PATH = keyPath;

    const loaded = loadPrivateKey();
    expect(loaded.source).toBe('SALESFORCE_PRIVATE_KEY_PATH');
    expect(fingerprint(loaded.key)).toBe(fingerprint(privateKey));
  });

  test('prefers SALESFORCE_PRIVATE_KEY over SALESFORCE_PRIVATE_KEY_PATH', () => {
    const inline = generateKeyPair().privateKey;
    const fromFile = generateKeyPair().privateKey;
    const keyPath = path.join(tempDir, 'other.key');
    fs.writeFileSync(keyPath, fromFile);
    process.env.SALESFORCE_PRIVATE_KEY = inline;
    process.env.SALESFORCE_PRIVATE_KEY_PATH = keyPath;

    const loaded = loadPrivateKey();
    expect(loaded.source).toBe('SALESFORCE_PRIVATE_KEY');
    expect(fingerprint(loaded.key)).toBe(fingerprint(normalizePrivateKey(inline)));
    expect(fingerprint(loaded.key)).not.toBe(fingerprint(normalizePrivateKey(fromFile)));
  });

  test('treats an unreadable key path as missing configuration', () => {
    process.env.SALESFORCE_LOGIN_URL = 'https://login.salesforce.com';
    process.env.SALESFORCE_CLIENT_ID = 'test-client-id';
    process.env.SALESFORCE_USERNAME = 'integration@example.com';
    process.env.SALESFORCE_API_VERSION = 'v64.0';
    process.env.SALESFORCE_PRIVATE_KEY_PATH = path.join(tempDir, 'missing.key');

    const result = validateSalesforceConfig();
    expect(result.status.PRIVATE_KEY).toBe('missing');
    expect(result.status.LOGIN_URL).toBe('configured');
    expect(result.ok).toBe(false);
  });
});
