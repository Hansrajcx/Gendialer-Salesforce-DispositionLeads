const jwt = require('jsonwebtoken');

const {
  snapshotEnv,
  restoreEnv,
  clearSalesforceEnv,
  generateKeyPair,
  applyTestConfig,
} = require('./helpers');
const { JWT_EXPIRY_SECONDS, TOKEN_TTL_MS } = require('../src/config/salesforce');
const {
  getSalesforceAccessToken,
  resetTokenCache,
  GRANT_TYPE,
} = require('../src/services/salesforce/auth');

describe('Salesforce JWT authentication', () => {
  const snapshot = snapshotEnv();
  const keys = generateKeyPair();
  let dateNow;

  let originalFetch;

  beforeEach(() => {
    originalFetch = global.fetch;
    clearSalesforceEnv();
    applyTestConfig(keys.privateKey);
    resetTokenCache();
    dateNow = jest.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    global.fetch = originalFetch;
    resetTokenCache();
    jest.restoreAllMocks();
  });

  afterAll(() => {
    restoreEnv(snapshot);
  });

  function mockTokenResponse(body, ok = true, status = 200) {
    global.fetch = jest.fn().mockResolvedValue({
      ok,
      status,
      text: async () => JSON.stringify(body),
    });
  }

  function loggedText() {
    return [...console.log.mock.calls, ...console.error.mock.calls]
      .flat()
      .map((part) => String(part))
      .join('\n');
  }

  test('signs a JWT with the client id, username, and login URL', async () => {
    mockTokenResponse({
      access_token: 'test-access-token',
      instance_url: 'https://example.my.salesforce.com',
    });

    const token = await getSalesforceAccessToken();
    const params = new URLSearchParams(global.fetch.mock.calls[0][1].body);
    const assertion = params.get('assertion');
    const decoded = jwt.verify(assertion, keys.publicKey, { algorithms: ['RS256'] });

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch.mock.calls[0][0]).toBe('https://login.salesforce.com/services/oauth2/token');
    expect(global.fetch.mock.calls[0][1].headers['Content-Type']).toBe('application/x-www-form-urlencoded');
    expect(params.get('grant_type')).toBe(GRANT_TYPE);
    expect(decoded.iss).toBe('test-client-id');
    expect(decoded.sub).toBe('integration@example.com');
    expect(decoded.aud).toBe('https://login.salesforce.com');
    expect(decoded.exp).toBe(Math.floor(1_700_000_000_000 / 1000) + JWT_EXPIRY_SECONDS);
    expect(decoded.iat).toBeUndefined();
    expect(token).toEqual({
      accessToken: 'test-access-token',
      instanceUrl: 'https://example.my.salesforce.com',
    });
    expect(loggedText()).not.toContain(assertion);
    expect(loggedText()).not.toContain(keys.privateKey);
    expect(loggedText()).not.toContain('test-access-token');
  });

  test('reuses a cached token until it is near expiration', async () => {
    let call = 0;
    global.fetch = jest.fn().mockImplementation(async () => {
      const accessToken = call === 0 ? 'cached-token' : 'refreshed-token';
      call += 1;
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          access_token: accessToken,
          instance_url: 'https://example.my.salesforce.com/',
        }),
      };
    });

    await getSalesforceAccessToken();
    await getSalesforceAccessToken();
    expect(global.fetch).toHaveBeenCalledTimes(1);

    dateNow.mockReturnValue(1_700_000_000_000 + TOKEN_TTL_MS);
    const refreshed = await getSalesforceAccessToken();
    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(refreshed.accessToken).toBe('refreshed-token');
    expect(refreshed.instanceUrl).toBe('https://example.my.salesforce.com');
  });

  test('shares one token request while the first request is in flight', async () => {
    let resolveFetch;
    global.fetch = jest.fn().mockReturnValue(new Promise((resolve) => {
      resolveFetch = resolve;
    }));

    const first = getSalesforceAccessToken();
    const second = getSalesforceAccessToken();
    resolveFetch({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        access_token: 'shared-token',
        instance_url: 'https://example.my.salesforce.com',
      }),
    });

    await expect(Promise.all([first, second])).resolves.toEqual([
      { accessToken: 'shared-token', instanceUrl: 'https://example.my.salesforce.com' },
      { accessToken: 'shared-token', instanceUrl: 'https://example.my.salesforce.com' },
    ]);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  test('returns a generic auth error and does not leak the assertion', async () => {
    mockTokenResponse({ error: 'invalid_grant', error_description: 'user not approved' }, false, 400);

    await expect(getSalesforceAccessToken()).rejects.toMatchObject({
      status: 502,
      code: 'SALESFORCE_AUTH_ERROR',
      message: 'Unable to authenticate with Salesforce',
    });

    const assertion = new URLSearchParams(global.fetch.mock.calls[0][1].body).get('assertion');
    expect(loggedText()).not.toContain(assertion);
    expect(loggedText()).not.toContain('invalid_grant');
    expect(loggedText()).not.toContain(keys.privateKey);
  });

  test('fails when Salesforce configuration is missing', async () => {
    clearSalesforceEnv();
    global.fetch = jest.fn();

    await expect(getSalesforceAccessToken()).rejects.toMatchObject({
      status: 500,
      code: 'CONFIG_ERROR',
      message: 'Salesforce configuration is incomplete',
    });
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
