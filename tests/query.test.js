const { buildSearchQuery } = require('../src/services/salesforce/dispositionLead');
const { escapeSoqlString } = require('../src/utils/soql');

describe('disposition lead queries', () => {
  test('escapes quotes and backslashes', () => {
    expect(escapeSoqlString("O'Hara\\path")).toBe("O\\'Hara\\\\path");
  });

  test('filters by phone', () => {
    const { soql } = buildSearchQuery({ phone1: '9876543210' });
    expect(soql).toContain("Phone1__c = '9876543210'");
    expect(soql).toContain('ORDER BY DispositionDateTime__c DESC');
  });

  test('filters by email', () => {
    const { soql } = buildSearchQuery({ email1: 'john@example.com' });
    expect(soql).toContain("Email1__c = 'john@example.com'");
  });

  test('filters by disposition status', () => {
    const { soql } = buildSearchQuery({ dispositionStatus: 'Interested' });
    expect(soql).toContain("DispositionStatus__c = 'Interested'");
  });

  test('filters a UTC date range inclusively', () => {
    const { soql } = buildSearchQuery({
      fromDate: '2026-09-01',
      toDate: '2026-09-28',
    });
    expect(soql).toContain('DispositionDateTime__c >= 2026-09-01T00:00:00.000Z');
    expect(soql).toContain('DispositionDateTime__c < 2026-09-29T00:00:00.000Z');
  });

  test('filters exact ISO-8601 instants', () => {
    const { soql } = buildSearchQuery({
      fromDate: '2026-09-01T00:00:00Z',
      toDate: '2026-09-28T23:59:59Z',
    });
    expect(soql).toContain('DispositionDateTime__c >= 2026-09-01T00:00:00.000Z');
    expect(soql).toContain('DispositionDateTime__c <= 2026-09-28T23:59:59.000Z');
  });

  test('sorts earliest first', () => {
    const { soql } = buildSearchQuery({ sort: 'earliest' });
    expect(soql).toContain('ORDER BY DispositionDateTime__c ASC');
    expect(soql).not.toContain('WHERE');
  });

  test('sorts newest first by default', () => {
    const { soql, countSoql } = buildSearchQuery({});
    expect(soql).toContain('ORDER BY DispositionDateTime__c DESC');
    expect(soql).toContain('LIMIT 50 OFFSET 0');
    expect(soql).not.toContain('WHERE');
    expect(countSoql).toBe('SELECT COUNT(Id) total FROM DispositionLead__c');
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

    expect(soql).toContain("Phone1__c = '9876543210'");
    expect(soql).toContain("Email1__c = 'john@example.com'");
    expect(soql).toContain("DispositionStatus__c = 'Interested'");
    expect(soql).toContain('DispositionDateTime__c >= 2026-09-01T00:00:00.000Z');
    expect(soql).toContain('DispositionDateTime__c < 2026-09-29T00:00:00.000Z');
    expect(soql).toContain('ORDER BY DispositionDateTime__c DESC');
    expect(soql.match(/ AND /g)).toHaveLength(4);
  });

  test('keeps injected quotes inside a single string literal', () => {
    const { soql } = buildSearchQuery({ phone1: "98765' OR Id != null" });
    expect(soql).toContain("Phone1__c = '98765\\' OR Id != null'");
    expect(soql).not.toContain("Phone1__c = '98765' OR");
  });

  test('rejects an invalid sort and an invalid date', () => {
    expect(() => buildSearchQuery({ sort: 'oldest' })).toThrow('sort must be earliest or newest');
    expect(() => buildSearchQuery({ fromDate: '09/01/2026' })).toThrow('fromDate');
  });
});
