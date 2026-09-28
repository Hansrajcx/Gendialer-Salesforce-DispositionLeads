const { buildSearchQuery } = require('../src/services/salesforce/dispositionLead');
const { OBJECT_NAME, SALESFORCE_FIELDS } = require('../src/services/salesforce/schema');
const { escapeSoqlString } = require('../src/utils/soql');

describe('disposition lead queries', () => {
  test('escapes quotes and backslashes', () => {
    expect(escapeSoqlString("O'Hara\\path")).toBe("O\\'Hara\\\\path");
  });

  test('filters by phone', () => {
    const { soql } = buildSearchQuery({ phone1: '9876543210' });
    expect(soql).toContain(`${SALESFORCE_FIELDS.phone1} = '9876543210'`);
    expect(soql).toContain(`ORDER BY ${SALESFORCE_FIELDS.dispositionDateTime} DESC`);
  });

  test('filters by email', () => {
    const { soql } = buildSearchQuery({ email1: 'john@example.com' });
    expect(soql).toContain(`${SALESFORCE_FIELDS.email1} = 'john@example.com'`);
  });

  test('filters by disposition status', () => {
    const { soql } = buildSearchQuery({ dispositionStatus: 'Interested' });
    expect(soql).toContain(`${SALESFORCE_FIELDS.dispositionStatus} = 'Interested'`);
  });

  test('filters a UTC date range inclusively', () => {
    const { soql } = buildSearchQuery({
      fromDate: '2026-09-01',
      toDate: '2026-09-28',
    });
    expect(soql).toContain(`${SALESFORCE_FIELDS.dispositionDateTime} >= 2026-09-01T00:00:00.000Z`);
    expect(soql).toContain(`${SALESFORCE_FIELDS.dispositionDateTime} < 2026-09-29T00:00:00.000Z`);
  });

  test('filters exact ISO-8601 instants', () => {
    const { soql } = buildSearchQuery({
      fromDate: '2026-09-01T00:00:00Z',
      toDate: '2026-09-28T23:59:59Z',
    });
    expect(soql).toContain(`${SALESFORCE_FIELDS.dispositionDateTime} >= 2026-09-01T00:00:00.000Z`);
    expect(soql).toContain(`${SALESFORCE_FIELDS.dispositionDateTime} <= 2026-09-28T23:59:59.000Z`);
  });

  test('sorts earliest first', () => {
    const { soql } = buildSearchQuery({ sort: 'earliest' });
    expect(soql).toContain(`ORDER BY ${SALESFORCE_FIELDS.dispositionDateTime} ASC`);
    expect(soql).not.toContain('WHERE');
  });

  test('sorts newest first by default', () => {
    const { soql, countSoql } = buildSearchQuery({});
    expect(soql).toContain(`ORDER BY ${SALESFORCE_FIELDS.dispositionDateTime} DESC`);
    expect(soql).toContain('LIMIT 50 OFFSET 0');
    expect(soql).not.toContain('WHERE');
    expect(countSoql).toBe(`SELECT COUNT(Id) total FROM ${OBJECT_NAME}`);
  });

  test('combines filters with AND', () => {
    const { soql } = buildSearchQuery({
      phone1: '9876543210',
      email1: 'john@example.com',
      dispositionStatus: 'Interested',
      fromDate: '2026-09-01',
      toDate: '2026-09-28',
      sort: 'newest',
    });

    expect(soql).toContain(`${SALESFORCE_FIELDS.phone1} = '9876543210'`);
    expect(soql).toContain(`${SALESFORCE_FIELDS.email1} = 'john@example.com'`);
    expect(soql).toContain(`${SALESFORCE_FIELDS.dispositionStatus} = 'Interested'`);
    expect(soql).toContain(`${SALESFORCE_FIELDS.dispositionDateTime} >= 2026-09-01T00:00:00.000Z`);
    expect(soql).toContain(`${SALESFORCE_FIELDS.dispositionDateTime} < 2026-09-29T00:00:00.000Z`);
    expect(soql).toContain(`ORDER BY ${SALESFORCE_FIELDS.dispositionDateTime} DESC`);
    expect(soql.match(/ AND /g)).toHaveLength(4);
  });

  test('keeps injected quotes inside a single string literal', () => {
    const { soql } = buildSearchQuery({ phone1: "98765' OR Id != null" });
    expect(soql).toContain(`${SALESFORCE_FIELDS.phone1} = '98765\\' OR Id != null'`);
    expect(soql).not.toContain(`${SALESFORCE_FIELDS.phone1} = '98765' OR`);
  });

  test('rejects an invalid sort and an invalid date', () => {
    expect(() => buildSearchQuery({ sort: 'oldest' })).toThrow('sort must be earliest or newest');
    expect(() => buildSearchQuery({ fromDate: '09/01/2026' })).toThrow('fromDate');
  });

  test('uses namespaced object and fields throughout generated SOQL', () => {
    const { soql, countSoql } = buildSearchQuery({
      phone1: '9876543211',
      email1: 'jane@example.com',
      dispositionStatus: 'Callback',
      date: '2026-09-28',
    });
    const allSoql = `${soql} ${countSoql}`;

    expect(soql).toContain(`FROM ${OBJECT_NAME}`);
    expect(soql).toContain(`ORDER BY ${SALESFORCE_FIELDS.dispositionDateTime} DESC`);
    expect(soql).toContain(`${SALESFORCE_FIELDS.phone1} = '9876543211'`);
    expect(soql).toContain(`${SALESFORCE_FIELDS.email1} = 'jane@example.com'`);
    expect(soql).toContain(`${SALESFORCE_FIELDS.dispositionStatus} = 'Callback'`);
    expect(countSoql).toBe(`SELECT COUNT(Id) total FROM ${OBJECT_NAME} WHERE ${SALESFORCE_FIELDS.phone1} = '9876543211' AND ${SALESFORCE_FIELDS.email1} = 'jane@example.com' AND ${SALESFORCE_FIELDS.dispositionStatus} = 'Callback' AND ${SALESFORCE_FIELDS.dispositionDateTime} >= 2026-09-28T00:00:00.000Z AND ${SALESFORCE_FIELDS.dispositionDateTime} < 2026-09-29T00:00:00.000Z`);

    for (const fieldName of ['DispositionLead__c', 'Phone1__c', 'Email1__c', 'DispositionStatus__c', 'DispositionDateTime__c']) {
      expect(allSoql).not.toMatch(new RegExp(`(?<!voiceraFlex__)${fieldName}`));
    }
    for (const fieldName of ['voiceraFlex__DispositionLead__c', 'voiceraFlex__Phone1__c', 'voiceraFlex__Email1__c', 'voiceraFlex__DispositionStatus__c', 'voiceraFlex__DispositionDateTime__c']) {
      expect(allSoql).toContain(fieldName);
    }
  });
});
