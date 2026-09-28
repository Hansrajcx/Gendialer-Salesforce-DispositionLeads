const fs = require('fs');
const path = require('path');

require('dotenv').config();

const TOKEN_TTL_MS = 50 * 60 * 1000;
const TOKEN_REFRESH_SKEW_MS = 60 * 1000;
const JWT_EXPIRY_SECONDS = 180;
const API_VERSION_PATTERN = /^v\d+\.\d+$/;

const STATUS_KEYS = [
  'LOGIN_URL',
  'CLIENT_ID',
  'USERNAME',
  'PRIVATE_KEY',
  'API_VERSION',
];

function normalizePrivateKey(value) {
  if (!value) {
    return '';
  }

  return String(value)
    .replace(/^\uFEFF/, '')
    .trim()
    .replace(/\\n/g, '\n');
}

function loadPrivateKey() {
  const inline = process.env.SALESFORCE_PRIVATE_KEY;
  if (inline && inline.trim()) {
    return {
      key: normalizePrivateKey(inline),
      source: 'SALESFORCE_PRIVATE_KEY',
    };
  }

  const keyPath = (process.env.SALESFORCE_PRIVATE_KEY_PATH || '').trim();
  if (!keyPath) {
    return { key: '', source: null };
  }

  let contents;
  try {
    contents = fs.readFileSync(path.resolve(keyPath), 'utf8');
  } catch (error) {
    const readError = new Error('Unable to read SALESFORCE_PRIVATE_KEY_PATH');
    readError.code = 'PRIVATE_KEY_READ_FAILED';
    throw readError;
  }

  return {
    key: normalizePrivateKey(contents),
    source: 'SALESFORCE_PRIVATE_KEY_PATH',
  };
}

function normalizeLoginUrl(value) {
  const trimmed = (value || '').trim().replace(/\/+$/, '');
  if (!trimmed) {
    return '';
  }

  try {
    const parsed = new URL(trimmed);
    const pathIsRoot = parsed.pathname === '' || parsed.pathname === '/';
    if (
      parsed.protocol !== 'https:' ||
      parsed.username ||
      parsed.password ||
      parsed.search ||
      parsed.hash ||
      !pathIsRoot
    ) {
      return '';
    }
    return parsed.origin;
  } catch (error) {
    return '';
  }
}

function getSalesforceConfig() {
  const loginUrl = normalizeLoginUrl(process.env.SALESFORCE_LOGIN_URL);
  const clientId = (process.env.SALESFORCE_CLIENT_ID || '').trim();
  const username = (process.env.SALESFORCE_USERNAME || '').trim();
  const apiVersion = (process.env.SALESFORCE_API_VERSION || '').trim();
  let privateKey = '';

  try {
    privateKey = loadPrivateKey().key;
  } catch (error) {
    privateKey = '';
  }

  return {
    loginUrl,
    clientId,
    username,
    apiVersion: API_VERSION_PATTERN.test(apiVersion) ? apiVersion : '',
    privateKey,
    tokenUrl: loginUrl ? `${loginUrl}/services/oauth2/token` : '',
    tokenTtlMs: TOKEN_TTL_MS,
    tokenRefreshSkewMs: TOKEN_REFRESH_SKEW_MS,
    jwtExpirySeconds: JWT_EXPIRY_SECONDS,
  };
}

function validateSalesforceConfig() {
  const config = getSalesforceConfig();
  const status = {
    LOGIN_URL: config.loginUrl ? 'configured' : 'missing',
    CLIENT_ID: config.clientId ? 'configured' : 'missing',
    USERNAME: config.username ? 'configured' : 'missing',
    PRIVATE_KEY: config.privateKey ? 'configured' : 'missing',
    API_VERSION: config.apiVersion ? 'configured' : 'missing',
  };
  const missing = STATUS_KEYS.filter((key) => status[key] === 'missing');

  return {
    status,
    missing,
    ok: missing.length === 0,
  };
}

function formatConfigReport(status) {
  const lines = ['Salesforce configuration:'];
  for (const key of STATUS_KEYS) {
    lines.push(`  ${key}: ${status[key]}`);
  }
  return lines.join('\n');
}

module.exports = {
  getSalesforceConfig,
  validateSalesforceConfig,
  formatConfigReport,
  normalizePrivateKey,
  loadPrivateKey,
  TOKEN_TTL_MS,
  TOKEN_REFRESH_SKEW_MS,
  JWT_EXPIRY_SECONDS,
};
