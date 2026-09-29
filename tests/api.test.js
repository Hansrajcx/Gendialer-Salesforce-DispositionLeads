jest.mock('../src/services/salesforce/client', () => ({
  post: jest.fn(),
  patch: jest.fn(),
  get: jest.fn(),
  delete: jest.fn(),
}));

const request = require('supertest');
const client = require('../src/services/salesforce/client');
const { createApp } = require('../src/app');
const { AppError } = require('../src/utils/errors');
const { OBJECT_NAME, SALESFORCE_FIELDS } = require('../src/services/salesforce/schema');

const app = createApp();
const RECORD_ID = 'a01ABCDEFGHIJKLMNO';

const createBody = {
  contactId: '003ABCDEFGHIJKLMNO',
  firstName: 'John',
  middleName: 'A',
  lastName: 'Doe',
  phone1: '9876543210',
  email1: 'john@example.com',
  country: 'India',
  city: 'Mumbai',
  state: 'Maharashtra',
  street: 'ABC Street',
  zip: '400001',
  metric1: 10,
  metric2: 20,
  metric3: 30,
  metric4: 40,
  dispositionStatus: 'Interested',
  dispositionDateTime: '2026-09-28T09:15:00Z',
};

describe('disposition lead API', () => {
  let originalCorsOrigins;

  beforeEach(() => {
    originalCorsOrigins = process.env.CORS_ORIGINS;
    process.env.CORS_ORIGINS = 'http://localhost:3000';
    client.post.mockReset();
    client.patch.mockReset();
    client.get.mockReset();
  });

  afterEach(() => {
    if (originalCorsOrigins === undefined) {
      delete process.env.CORS_ORIGINS;
    } else {
      process.env.CORS_ORIGINS = originalCorsOrigins;
    }
  });

  test('answers allowed browser preflight requests without a redirect', async () => {
    const response = await request(app)
      .options('/api/disposition-leads')
      .set('Origin', 'http://localhost:3000')
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'content-type,ngrok-skip-browser-warning');

    expect(response.status).toBe(204);
    expect(response.headers['access-control-allow-origin']).toBe('http://localhost:3000');
    expect(response.headers['access-control-allow-methods']).toContain('POST');
    expect(response.headers['access-control-allow-headers']).toContain('Content-Type');
    expect(response.headers['access-control-allow-headers']).toContain('ngrok-skip-browser-warning');
  });

  test('does not allow an origin outside the configured allowlist', async () => {
    const response = await request(app)
      .options('/api/disposition-leads')
      .set('Origin', 'https://untrusted.example')
      .set('Access-Control-Request-Method', 'POST');

    expect(response.status).toBe(200);
    expect(response.headers).not.toHaveProperty('access-control-allow-origin');
  });

  test('creates a new history record', async () => {
    client.post.mockResolvedValue({ id: RECORD_ID, success: true });

    const response = await request(app)
      .post('/api/disposition-leads')
      .send(createBody);

    expect(response.status).toBe(201);
    expect(response.body).toEqual({
      success: true,
      id: RECORD_ID,
      message: 'Disposition lead created successfully',
    });
    expect(client.post).toHaveBeenCalledWith(`/sobjects/${OBJECT_NAME}`, {
      [SALESFORCE_FIELDS.contactId]: '003ABCDEFGHIJKLMNO',
      [SALESFORCE_FIELDS.firstName]: 'John',
      [SALESFORCE_FIELDS.middleName]: 'A',
      [SALESFORCE_FIELDS.lastName]: 'Doe',
      [SALESFORCE_FIELDS.phone1]: '9876543210',
      [SALESFORCE_FIELDS.email1]: 'john@example.com',
      [SALESFORCE_FIELDS.country]: 'India',
      [SALESFORCE_FIELDS.city]: 'Mumbai',
      [SALESFORCE_FIELDS.state]: 'Maharashtra',
      [SALESFORCE_FIELDS.street]: 'ABC Street',
      [SALESFORCE_FIELDS.zip]: '400001',
      [SALESFORCE_FIELDS.metric1]: 10,
      [SALESFORCE_FIELDS.metric2]: 20,
      [SALESFORCE_FIELDS.metric3]: 30,
      [SALESFORCE_FIELDS.metric4]: 40,
      [SALESFORCE_FIELDS.dispositionStatus]: 'Interested',
      [SALESFORCE_FIELDS.dispositionDateTime]: '2026-09-28T09:15:00.000Z',
    });
    expect(client.patch).not.toHaveBeenCalled();
    expect(client.get).not.toHaveBeenCalled();
  });

  test('defaults dispositionDateTime to the current UTC time', async () => {
    client.post.mockResolvedValue({ id: RECORD_ID, success: true });
    const before = Date.now();

    const response = await request(app)
      .post('/api/disposition-leads')
      .send({ phone1: '9876543210' });

    expect(response.status).toBe(201);
    const sent = client.post.mock.calls[0][1][SALESFORCE_FIELDS.dispositionDateTime];
    expect(new Date(sent).getTime()).toBeGreaterThanOrEqual(before - 1000);
    expect(sent.endsWith('Z')).toBe(true);
  });

  test('requires phone1 or email1', async () => {
    const response = await request(app)
      .post('/api/disposition-leads')
      .send({ firstName: 'John' });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'At least phone1 or email1 is required',
      },
    });
    expect(client.post).not.toHaveBeenCalled();
  });

  test('rejects an invalid disposition date', async () => {
    const response = await request(app)
      .post('/api/disposition-leads')
      .send({ phone1: '9876543210', dispositionDateTime: 'yesterday' });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(client.post).not.toHaveBeenCalled();
  });

  test('returns a safe error when Salesforce create fails', async () => {
    client.post.mockRejectedValue(new AppError(
      502,
      'SALESFORCE_API_ERROR',
      'Salesforce request failed'
    ));

    const response = await request(app)
      .post('/api/disposition-leads')
      .send({ email1: 'john@example.com' });

    expect(response.status).toBe(502);
    expect(response.body).toEqual({
      success: false,
      error: {
        code: 'SALESFORCE_API_ERROR',
        message: 'Salesforce request failed',
      },
    });
    expect(JSON.stringify(response.body)).not.toMatch(/BEGIN PRIVATE KEY|access_token/);
  });

  test('updates only the supplied fields', async () => {
    client.patch.mockResolvedValue(null);

    const response = await request(app)
      .patch(`/api/disposition-leads/${RECORD_ID}`)
      .send({ dispositionStatus: 'Callback', metric1: 25 });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      success: true,
      id: RECORD_ID,
      message: 'Disposition lead updated successfully',
    });
    expect(client.patch).toHaveBeenCalledWith(
      `/sobjects/${OBJECT_NAME}/${RECORD_ID}`,
      {
        [SALESFORCE_FIELDS.dispositionStatus]: 'Callback',
        [SALESFORCE_FIELDS.metric1]: 25,
      }
    );
    expect(client.post).not.toHaveBeenCalled();
  });

  test('clears a field when the update sends null', async () => {
    client.patch.mockResolvedValue(null);

    const response = await request(app)
      .patch(`/api/disposition-leads/${RECORD_ID}`)
      .send({ dispositionStatus: null });

    expect(response.status).toBe(200);
    expect(client.patch).toHaveBeenCalledWith(
      `/sobjects/${OBJECT_NAME}/${RECORD_ID}`,
      { [SALESFORCE_FIELDS.dispositionStatus]: null }
    );
  });

  test('rejects an empty update', async () => {
    const response = await request(app)
      .patch(`/api/disposition-leads/${RECORD_ID}`)
      .send({});

    expect(response.status).toBe(400);
    expect(response.body.error.message).toBe('At least one field is required');
    expect(client.patch).not.toHaveBeenCalled();
  });

  test('rejects an invalid Salesforce id before calling Salesforce', async () => {
    const response = await request(app)
      .patch('/api/disposition-leads/not-an-id')
      .send({ dispositionStatus: 'Callback' });

    expect(response.status).toBe(400);
    expect(response.body.error).toEqual({
      code: 'VALIDATION_ERROR',
      message: 'Invalid Salesforce record id',
    });
    expect(client.patch).not.toHaveBeenCalled();
  });

  test('returns not found when Salesforce does not have the record', async () => {
    client.patch.mockRejectedValue(new AppError(404, 'NOT_FOUND', 'Disposition lead not found'));

    const response = await request(app)
      .patch(`/api/disposition-leads/${RECORD_ID}`)
      .send({ metric1: 1 });

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('NOT_FOUND');
  });

  test('searches with combined filters and returns camelCase records', async () => {
    client.get.mockImplementation((resourcePath, options) => {
      if (options.query.q.startsWith('SELECT COUNT')) {
        return { records: [{ total: 1 }] };
      }
      return {
        records: [{
          Id: RECORD_ID,
          [SALESFORCE_FIELDS.contactId]: '003ABCDEFGHIJKLMNO',
          [SALESFORCE_FIELDS.firstName]: 'John',
          [SALESFORCE_FIELDS.middleName]: 'A',
          [SALESFORCE_FIELDS.lastName]: 'Doe',
          [SALESFORCE_FIELDS.phone1]: '9876543210',
          [SALESFORCE_FIELDS.email1]: 'john@example.com',
          [SALESFORCE_FIELDS.country]: 'India',
          [SALESFORCE_FIELDS.city]: 'Mumbai',
          [SALESFORCE_FIELDS.state]: 'Maharashtra',
          [SALESFORCE_FIELDS.street]: 'ABC Street',
          [SALESFORCE_FIELDS.zip]: '400001',
          [SALESFORCE_FIELDS.metric1]: 10,
          [SALESFORCE_FIELDS.metric2]: 20,
          [SALESFORCE_FIELDS.metric3]: 30,
          [SALESFORCE_FIELDS.metric4]: 40,
          [SALESFORCE_FIELDS.dispositionStatus]: 'Interested',
          [SALESFORCE_FIELDS.dispositionDateTime]: '2026-09-28T09:15:00.000+0000',
        }],
      };
    });

    const response = await request(app).get('/api/disposition-leads').query({
      phone1: '9876543210',
      dispositionStatus: 'Interested',
      fromDate: '2026-09-01',
      toDate: '2026-09-28',
      sort: 'newest',
    });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.page).toBe(1);
    expect(response.body.pageSize).toBe(50);
    expect(response.body.totalSize).toBe(1);
    expect(response.body.data[0].dispositionDateTime).toBe('2026-09-28T09:15:00.000Z');
    expect(response.body.data[0].phone1).toBe('9876543210');

    const soql = client.get.mock.calls[0][1].query.q;
    expect(soql).toContain(`${SALESFORCE_FIELDS.phone1} = '9876543210'`);
    expect(soql).toContain(`${SALESFORCE_FIELDS.dispositionStatus} = 'Interested'`);
    expect(soql).toContain(`${SALESFORCE_FIELDS.dispositionDateTime} >= 2026-09-01T00:00:00.000Z`);
    expect(soql).toContain(`${SALESFORCE_FIELDS.dispositionDateTime} < 2026-09-29T00:00:00.000Z`);
    expect(soql).toContain(`ORDER BY ${SALESFORCE_FIELDS.dispositionDateTime} DESC`);
    expect(soql).toContain(`FROM ${OBJECT_NAME}`);
    expect(response.body.data[0]).toEqual({
      id: RECORD_ID,
      contactId: '003ABCDEFGHIJKLMNO',
      firstName: 'John',
      middleName: 'A',
      lastName: 'Doe',
      phone1: '9876543210',
      email1: 'john@example.com',
      country: 'India',
      city: 'Mumbai',
      state: 'Maharashtra',
      street: 'ABC Street',
      zip: '400001',
      metric1: 10,
      metric2: 20,
      metric3: 30,
      metric4: 40,
      dispositionStatus: 'Interested',
      dispositionDateTime: '2026-09-28T09:15:00.000Z',
    });
  });

  test('does not add a WHERE clause when no filters are provided', async () => {
    client.get.mockImplementation((resourcePath, options) => {
      if (options.query.q.startsWith('SELECT COUNT')) {
        return { records: [{ total: 0 }] };
      }
      return { records: [] };
    });

    const response = await request(app).get('/api/disposition-leads');
    expect(response.status).toBe(200);
    expect(response.body.data).toEqual([]);
    const soql = client.get.mock.calls[0][1].query.q;
    expect(soql).toContain(`FROM ${OBJECT_NAME}`);
    expect(soql).toContain(`ORDER BY ${SALESFORCE_FIELDS.dispositionDateTime} DESC`);
    expect(client.get.mock.calls[1][1].query.q).toBe(`SELECT COUNT(Id) total FROM ${OBJECT_NAME}`);
    expect(soql).not.toContain('WHERE');
  });
});
