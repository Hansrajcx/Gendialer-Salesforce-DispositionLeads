const { createApp } = require('./app');
const { validateSalesforceConfig, formatConfigReport } = require('./config/salesforce');

function start() {
  const { status, ok } = validateSalesforceConfig();
  console.log(formatConfigReport(status));

  if (!ok) {
    console.error('Missing Salesforce configuration. Refusing to start.');
    process.exit(1);
  }

  const port = Number(process.env.PORT) || 3000;
  const app = createApp();
  app.listen(port, () => {
    console.log(`Disposition Lead API listening on port ${port}`);
  });
}

module.exports = {
  start,
};

if (require.main === module) {
  start();
}
