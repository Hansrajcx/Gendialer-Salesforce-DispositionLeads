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
  beforeEach(() => {
    client.post.mockReset();
    client.patch.mockReset();
    client.get.mockReset();
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
    expect(client.post).toHaveBeenCalledWith('/sobjects/DispositionLead__c', {
      ContactId__c: '003ABCDEFGHIJKLMNO',
      FirstName__c: 'John',
      MiddleName__c: 'A',
      LastName__c: 'Doe',
      Phone1__c: '9876543210',
      Email1__c: 'john@example.com',
      Country__c: 'India',
      City__c: 'Mumbai',
      State__c: 'Maharashtra',
      Street__c: 'ABC Street',
      Zip__c: '400001',
      Metric1__c: 10,
      Metric2__c: 20,
      Metric3__c: 30,
      Metric4__c: 40,
      DispositionStatus__c: 'Interested',
      DispositionDateTime__c: '2026-09-28T09:15:00.000Z',
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
    const sent = client.post.mock.calls[0][1].DispositionDateTime__c;
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
      `/sobjects/DispositionLead__c/${RECORD_ID}`,
      {
        DispositionStatus__c: 'Callback',
        Metric1__c: 25,
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
      `/sobjects/DispositionLead__c/${RECORD_ID}`,
      { DispositionStatus__c: null }
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
          ContactId__c: '003ABCDEFGHIJKLMNO',
          FirstName__c: 'John',
          MiddleName__c: 'A',
          LastName__c: 'Doe',
          Phone1__c: '9876543210',
          Email1__c: 'john@example.com',
          Country__c: 'India',
          City__c: 'Mumbai',
          State__c: 'Maharashtra',
          Street__c: 'ABC Street',
          Zip__c: '400001',
          Metric1__c: 10,
          Metric2__c: 20,
          Metric3__c: 30,
          Metric4__c: 40,
          DispositionStatus__c: 'Interested',
          DispositionDateTime__c: '2026-09-28T09:15:00.000+0000',
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
    expect(soql).toContain("Phone1__c = '9876543210'");
    expect(soql).toContain("DispositionStatus__c = 'Interested'");
    expect(soql).toContain('DispositionDateTime__c >= 2026-09-01T00:00:00.000Z');
    expect(soql).toContain('DispositionDateTime__c < 2026-09-29T00:00:00.000Z');
    expect(soql).toContain('ORDER BY DispositionDateTime__c DESC');
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
    expect(client.get.mock.calls[0][1].query.q).not.toContain('WHERE');
  });
});
