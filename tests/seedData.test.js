const { validateCreateBody } = require('../src/utils/validation');
const { SEED_RECORDS, recordsToCreate } = require('../src/setup/seedData');

describe('disposition lead seed data', () => {
  test('includes at least 10 valid history records', () => {
    expect(SEED_RECORDS.length).toBeGreaterThanOrEqual(10);

    for (const record of SEED_RECORDS) {
      expect(() => validateCreateBody(record)).not.toThrow();
    }
  });

  test('keeps several dispositions for the same phone', () => {
    const john = SEED_RECORDS.filter((record) => record.phone1 === '9876543210');
    const statuses = john.map((record) => record.dispositionStatus);

    expect(statuses).toEqual(['Interested', 'Callback', 'Converted']);
  });

  test('skips records that are already stored', () => {
    const pending = recordsToCreate([SEED_RECORDS[0], SEED_RECORDS[1]]);

    expect(pending).toHaveLength(SEED_RECORDS.length - 2);
    expect(pending.some((record) => record.dispositionStatus === 'Interested' && record.phone1 === '9876543210')).toBe(false);
    expect(pending.some((record) => record.dispositionStatus === 'Converted')).toBe(true);
  });
});
