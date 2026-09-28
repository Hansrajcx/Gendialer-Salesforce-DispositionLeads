jest.mock('../src/services/salesforce/auth', () => ({
  getSalesforceAccessToken: jest.fn(),
  resetTokenCache: jest.fn(),
}));

const auth = require('../src/services/salesforce/auth');
const client = require('../src/services/salesforce/client');
const { OBJECT_NAME, SALESFORCE_FIELDS } = require('../src/services/salesforce/schema');
const { applyTestConfig, clearSalesforceEnv, snapshotEnv, restoreEnv } = require('./helpers');

describe('Salesforce REST client', () => {
  const snapshot = snapshotEnv();

  beforeEach(() => {
    clearSalesforceEnv();
    applyTestConfig('test-private-key');
    auth.getSalesforceAccessToken.mockResolvedValue({
      accessToken: 'test-access-token',
      instanceUrl: 'https://example.my.salesforce.com',
    });
  });

  afterAll(() => {
    restoreEnv(snapshot);
  });

  test('sends GET, POST, PATCH, and DELETE with a bearer token', async () => {
    global.fetch = jest.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ records: [] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 201,
        text: async () => JSON.stringify({ id: 'a01ABCDEFGHIJKLMNO', success: true }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 204,
        text: async () => '',
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 204,
        text: async () => '',
      });

    await client.get('/query', { query: { q: `SELECT Id FROM ${OBJECT_NAME}` } });
    await client.post(`/sobjects/${OBJECT_NAME}`, { [SALESFORCE_FIELDS.phone1]: '9876543210' });
    await client.patch(`/sobjects/${OBJECT_NAME}/a01ABCDEFGHIJKLMNO`, { [SALESFORCE_FIELDS.metric1]: 25 });
    await client.delete(`/sobjects/${OBJECT_NAME}/a01ABCDEFGHIJKLMNO`);

    const methods = global.fetch.mock.calls.map((call) => call[1].method);
    expect(methods).toEqual(['GET', 'POST', 'PATCH', 'DELETE']);
    expect(String(global.fetch.mock.calls[0][0])).toContain(
      'https://example.my.salesforce.com/services/data/v64.0/query?q='
    );
    expect(global.fetch.mock.calls[0][1].headers.Authorization).toBe('Bearer test-access-token');
    expect(JSON.parse(global.fetch.mock.calls[1][1].body)).toEqual({
      [SALESFORCE_FIELDS.phone1]: '9876543210',
    });
    expect(global.fetch.mock.calls[2][1].body).toBe(JSON.stringify({
      [SALESFORCE_FIELDS.metric1]: 25,
    }));
  });

  test('refreshes the token once after a 401', async () => {
    auth.getSalesforceAccessToken
      .mockResolvedValueOnce({
        accessToken: 'expired-token',
        instanceUrl: 'https://example.my.salesforce.com',
      })
      .mockResolvedValueOnce({
        accessToken: 'fresh-token',
        instanceUrl: 'https://example.my.salesforce.com',
      });

    global.fetch = jest.fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: async () => JSON.stringify([{ errorCode: 'INVALID_SESSION_ID', message: 'Session expired' }]),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ records: [] }),
      });

    await client.get('/query', { query: { q: `SELECT Id FROM ${OBJECT_NAME}` } });

    expect(auth.resetTokenCache).toHaveBeenCalledTimes(1);
    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(global.fetch.mock.calls[1][1].headers.Authorization).toBe('Bearer fresh-token');
  });

  test('hides secrets in Salesforce error messages', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 400,
      text: async () => JSON.stringify([{
        message: 'rejected access_token=test-access-token',
        errorCode: 'INVALID_SESSION',
      }]),
    });

    await expect(client.post(`/sobjects/${OBJECT_NAME}`, {})).rejects.toMatchObject({
      status: 502,
      code: 'SALESFORCE_API_ERROR',
      message: 'Salesforce request failed',
    });
  });

  test('returns a safe message for a Salesforce field error', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 400,
      text: async () => JSON.stringify([{
        message: 'Required fields are missing',
        errorCode: 'REQUIRED_FIELD_MISSING',
      }]),
    });

    await expect(client.post(`/sobjects/${OBJECT_NAME}`, {})).rejects.toMatchObject({
      code: 'SALESFORCE_API_ERROR',
      message: 'Required fields are missing',
    });
  });

  test('maps an unknown Salesforce id to not found', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 404,
      text: async () => JSON.stringify([{
        errorCode: 'NOT_FOUND',
        message: 'The requested resource does not exist',
      }]),
    });

    await expect(
      client.patch(`/sobjects/${OBJECT_NAME}/a01ABCDEFGHIJKLMNO`, { [SALESFORCE_FIELDS.metric1]: 1 })
    ).rejects.toMatchObject({
      status: 404,
      code: 'NOT_FOUND',
      message: 'Disposition lead not found',
    });
  });
});
