const crypto = require('crypto');

const ENV_KEYS = [
  'SALESFORCE_LOGIN_URL',
  'SALESFORCE_CLIENT_ID',
  'SALESFORCE_USERNAME',
  'SALESFORCE_PRIVATE_KEY',
  'SALESFORCE_PRIVATE_KEY_PATH',
  'SALESFORCE_API_VERSION',
  'PORT',
];

function snapshotEnv() {
  return Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
}

function restoreEnv(snapshot) {
  for (const key of ENV_KEYS) {
    if (snapshot[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = snapshot[key];
    }
  }
}

function clearSalesforceEnv() {
  for (const key of ENV_KEYS) {
    delete process.env[key];
  }
}

function fingerprint(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function generateKeyPair() {
  return crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
}

function applyTestConfig(privateKey) {
  process.env.SALESFORCE_LOGIN_URL = 'https://login.salesforce.com';
  process.env.SALESFORCE_CLIENT_ID = 'test-client-id';
  process.env.SALESFORCE_USERNAME = 'integration@example.com';
  process.env.SALESFORCE_PRIVATE_KEY = privateKey;
  delete process.env.SALESFORCE_PRIVATE_KEY_PATH;
  process.env.SALESFORCE_API_VERSION = 'v64.0';
}

module.exports = {
  ENV_KEYS,
  snapshotEnv,
  restoreEnv,
  clearSalesforceEnv,
  fingerprint,
  generateKeyPair,
  applyTestConfig,
};
