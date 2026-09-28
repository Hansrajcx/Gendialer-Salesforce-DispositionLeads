const { AppError } = require('../src/utils/errors');
const {
  validateSalesforceConfig,
  formatConfigReport,
  getSalesforceConfig,
} = require('../src/config/salesforce');
const { getSalesforceAccessToken } = require('../src/services/salesforce/auth');
const client = require('../src/services/salesforce/client');
const { createDispositionLead } = require('../src/services/salesforce/dispositionLead');
const { OBJECT_NAME, SALESFORCE_FIELDS } = require('../src/services/salesforce/schema');
const { escapeSoqlString } = require('../src/utils/soql');
const { SEED_RECORDS, recordsToCreate } = require('../src/setup/seedData');

async function loadExistingSeedRecords() {
  const emails = [...new Set(SEED_RECORDS.map((record) => record.email1))];
  const inList = emails.map((email) => `'${escapeSoqlString(email)}'`).join(', ');
  const result = await client.get('/query', {
    query: {
      q: `SELECT ${SALESFORCE_FIELDS.email1}, ${SALESFORCE_FIELDS.dispositionStatus}, ${SALESFORCE_FIELDS.dispositionDateTime} FROM ${OBJECT_NAME} WHERE ${SALESFORCE_FIELDS.email1} IN (${inList})`,
    },
  });
  const records = result && Array.isArray(result.records) ? result.records : [];

  return records.map((record) => ({
    email1: record[SALESFORCE_FIELDS.email1],
    dispositionStatus: record[SALESFORCE_FIELDS.dispositionStatus],
    dispositionDateTime: record[SALESFORCE_FIELDS.dispositionDateTime],
  }));
}

async function main() {
  const check = validateSalesforceConfig();
  console.log(formatConfigReport(check.status));

  if (!check.ok) {
    console.error('Missing Salesforce configuration. Update .env, then run npm run seed again.');
    process.exit(1);
  }

  const config = getSalesforceConfig();

  try {
    const auth = await getSalesforceAccessToken();
    console.log(`Salesforce user: ${config.username}`);
    console.log(`Salesforce org: ${auth.instanceUrl}`);

    const pending = recordsToCreate(await loadExistingSeedRecords());
    const skipped = SEED_RECORDS.length - pending.length;

    for (const record of pending) {
      const id = await createDispositionLead(record);
      console.log(`${id}  ${record.firstName} ${record.lastName}  ${record.dispositionStatus}  ${record.dispositionDateTime}`);
    }

    console.log(`Seed complete. Created ${pending.length}, skipped ${skipped}.`);
  } catch (error) {
    const message = error instanceof AppError
      ? error.message
      : 'Salesforce seed failed';
    console.error(message);
    process.exit(1);
  }
}

main();
