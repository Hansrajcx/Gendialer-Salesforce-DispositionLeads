const jwt = require('jsonwebtoken');

const { getSalesforceConfig } = require('../../config/salesforce');
const { AppError } = require('../../utils/errors');

const GRANT_TYPE = 'urn:ietf:params:oauth:grant-type:jwt-bearer';

let cache = null;
let inflight = null;

function resetTokenCache() {
  cache = null;
  inflight = null;
}

function isCacheValid(now = Date.now()) {
  if (!cache) {
    return false;
  }

  const { tokenRefreshSkewMs } = getSalesforceConfig();
  return now < cache.expiresAt - tokenRefreshSkewMs;
}

function buildJwtPayload(config, nowSeconds) {
  return {
    iss: config.clientId,
    sub: config.username,
    aud: config.loginUrl,
    exp: nowSeconds + config.jwtExpirySeconds,
  };
}

function assertConfigured(config) {
  if (
    !config.loginUrl ||
    !config.clientId ||
    !config.username ||
    !config.privateKey ||
    !config.apiVersion
  ) {
    throw new AppError(500, 'CONFIG_ERROR', 'Salesforce configuration is incomplete');
  }
}

async function requestAccessToken(config) {
  const payload = buildJwtPayload(config, Math.floor(Date.now() / 1000));
  let assertion;

  try {
    assertion = jwt.sign(payload, config.privateKey, {
      algorithm: 'RS256',
      noTimestamp: true,
    });
  } catch (error) {
    throw new AppError(502, 'SALESFORCE_AUTH_ERROR', 'Unable to authenticate with Salesforce');
  }

  let response;
  try {
    response = await fetch(config.tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: GRANT_TYPE,
        assertion,
      }),
    });
  } catch (error) {
    throw new AppError(502, 'SALESFORCE_AUTH_ERROR', 'Unable to authenticate with Salesforce');
  }

  let data = {};
  try {
    const text = await response.text();
    data = text ? JSON.parse(text) : {};
  } catch (error) {
    data = {};
  }

  if (!response.ok || !data.access_token || !data.instance_url) {
    throw new AppError(502, 'SALESFORCE_AUTH_ERROR', 'Unable to authenticate with Salesforce');
  }

  return {
    accessToken: data.access_token,
    instanceUrl: String(data.instance_url).replace(/\/+$/, ''),
    expiresAt: Date.now() + config.tokenTtlMs,
  };
}

async function getSalesforceAccessToken() {
  const config = getSalesforceConfig();
  assertConfigured(config);

  if (isCacheValid()) {
    return {
      accessToken: cache.accessToken,
      instanceUrl: cache.instanceUrl,
    };
  }

  if (!inflight) {
    inflight = requestAccessToken(config)
      .then((token) => {
        cache = token;
        return token;
      })
      .finally(() => {
        inflight = null;
      });
  }

  try {
    const token = await inflight;
    return {
      accessToken: token.accessToken,
      instanceUrl: token.instanceUrl,
    };
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }
    throw new AppError(502, 'SALESFORCE_AUTH_ERROR', 'Unable to authenticate with Salesforce');
  }
}

module.exports = {
  getSalesforceAccessToken,
  resetTokenCache,
  buildJwtPayload,
  GRANT_TYPE,
};
