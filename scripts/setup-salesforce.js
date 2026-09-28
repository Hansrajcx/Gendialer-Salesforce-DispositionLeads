const { AppError } = require('../src/utils/errors');
const {
  validateSalesforceConfig,
  formatConfigReport,
  getSalesforceConfig,
} = require('../src/config/salesforce');
const { getSalesforceAccessToken } = require('../src/services/salesforce/auth');
const client = require('../src/services/salesforce/client');
const { buildMetadataZip } = require('../src/setup/metadataPackage');
const {
  deployMetadata,
  assignIntegrationPermissionSet,
  failureLines,
} = require('../src/setup/deploy');

function printFailure(message) {
  console.error(message);
  if (/insufficient|access|permission|customize application/i.test(message)) {
    console.error(
      'The user in SALESFORCE_USERNAME must be allowed to change metadata. Use an administrator for this script, or grant Customize Application, then run npm run setup again.'
    );
  }
}

async function main() {
  const check = validateSalesforceConfig();
  console.log(formatConfigReport(check.status));

  if (!check.ok) {
    console.error('Missing Salesforce configuration. Update .env for the target account, then run npm run setup again.');
    process.exit(1);
  }

  const config = getSalesforceConfig();

  try {
    const auth = await getSalesforceAccessToken();
    console.log(`Salesforce user: ${config.username}`);
    console.log(`Salesforce org: ${auth.instanceUrl}`);
    console.log('Deploying Disposition Lead object, fields, and permission set...');

    const result = await deployMetadata({
      client,
      zipBuffer: buildMetadataZip(config.apiVersion),
      log: (line) => console.log(line),
    });

    if (result.status !== 'Succeeded' && result.success !== true) {
      const lines = failureLines(result);
      printFailure(lines.length ? lines.join('\n') : 'Salesforce metadata deploy failed');
      process.exit(1);
    }

    console.log('Metadata deploy succeeded.');
    const assignment = await assignIntegrationPermissionSet({
      client,
      username: config.username,
    });
    console.log(assignment.alreadyAssigned
      ? 'Permission set is already assigned to this user.'
      : 'Permission set assigned to this user.');
    console.log('Salesforce setup complete for this account.');
  } catch (error) {
    const message = error instanceof AppError
      ? error.message
      : 'Salesforce setup failed';
    printFailure(message);
    process.exit(1);
  }
}

main();
