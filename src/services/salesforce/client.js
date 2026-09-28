const { getSalesforceConfig } = require('../../config/salesforce');
const { getSalesforceAccessToken, resetTokenCache } = require('./auth');
const { AppError } = require('../../utils/errors');

const SECRET_PATTERN = /access_token|assertion|private key|BEGIN /i;

function buildResourceUrl(instanceUrl, apiVersion, resourcePath, query) {
  const path = resourcePath.startsWith('/') ? resourcePath : `/${resourcePath}`;
  const url = new URL(`${instanceUrl}/services/data/${apiVersion}${path}`);

  if (query) {
    for (const [key, value] of Object.entries(query)) {
      url.searchParams.set(key, String(value));
    }
  }

  return url;
}

function salesforceError(data, status) {
  const entries = Array.isArray(data) ? data : data ? [data] : [];
  const first = entries[0] || {};

  if (status === 404 || first.errorCode === 'NOT_FOUND' || first.errorCode === 'MALFORMED_ID') {
    return new AppError(404, 'NOT_FOUND', 'Disposition lead not found');
  }

  const raw = typeof first.message === 'string' ? first.message : '';
  if (!raw || SECRET_PATTERN.test(raw)) {
    return new AppError(502, 'SALESFORCE_API_ERROR', 'Salesforce request failed');
  }

  return new AppError(502, 'SALESFORCE_API_ERROR', raw);
}

async function readBody(response) {
  const text = await response.text();
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch (error) {
    return null;
  }
}

async function salesforceRequest(method, resourcePath, { body, query, retry = true } = {}) {
  const { accessToken, instanceUrl } = await getSalesforceAccessToken();
  const { apiVersion } = getSalesforceConfig();
  const url = buildResourceUrl(instanceUrl, apiVersion, resourcePath, query);
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    Accept: 'application/json',
  };
  const init = { method, headers };

  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }

  let response;
  try {
    response = await fetch(url, init);
  } catch (error) {
    throw new AppError(502, 'SALESFORCE_API_ERROR', 'Unable to reach Salesforce');
  }

  if (response.status === 401 && retry) {
    resetTokenCache();
    return salesforceRequest(method, resourcePath, { body, query, retry: false });
  }

  if (response.status === 401) {
    throw new AppError(502, 'SALESFORCE_AUTH_ERROR', 'Unable to authenticate with Salesforce');
  }

  if (response.status === 204) {
    return null;
  }

  const data = await readBody(response);
  if (!response.ok) {
    throw salesforceError(data, response.status);
  }

  return data;
}

function get(resourcePath, options) {
  return salesforceRequest('GET', resourcePath, options);
}

function post(resourcePath, body) {
  return salesforceRequest('POST', resourcePath, { body });
}

function patch(resourcePath, body) {
  return salesforceRequest('PATCH', resourcePath, { body });
}

function del(resourcePath) {
  return salesforceRequest('DELETE', resourcePath);
}

module.exports = {
  get,
  post,
  patch,
  delete: del,
  salesforceRequest,
};
