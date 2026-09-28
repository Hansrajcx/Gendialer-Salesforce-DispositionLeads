const crypto = require('crypto');

const { AppError } = require('../utils/errors');
const { escapeSoqlString } = require('../utils/soql');
const { getSalesforceConfig } = require('../config/salesforce');
const { getSalesforceAccessToken } = require('../services/salesforce/auth');

const SALESFORCE_ID = /^[a-zA-Z0-9]{15}(?:[a-zA-Z0-9]{3})?$/;
const SECRET_PATTERN = /access_token|assertion|private key|BEGIN /i;

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function deployOptions() {
  return {
    deployOptions: {
      allowMissingFiles: false,
      autoUpdatePackage: false,
      checkOnly: false,
      ignoreWarnings: true,
      performRetrieve: false,
      purgeOnDelete: false,
      rollbackOnError: true,
      singlePackage: true,
      testLevel: 'NoTestRun',
    },
  };
}

function buildMultipartBody(zipBuffer, boundary) {
  const preamble = Buffer.from(
    `--${boundary}\r\n`
    + 'Content-Disposition: form-data; name="entity_content"\r\n'
    + 'Content-Type: application/json\r\n\r\n'
    + `${JSON.stringify(deployOptions())}\r\n`
    + `--${boundary}\r\n`
    + 'Content-Disposition: form-data; name="file"; filename="deploy.zip"\r\n'
    + 'Content-Type: application/zip\r\n\r\n',
    'utf8'
  );
  const ending = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8');
  return Buffer.concat([preamble, zipBuffer, ending]);
}

async function readJson(response) {
  const text = await response.text();
  if (!text) {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    return null;
  }
}

function restErrorMessage(data) {
  const entries = Array.isArray(data) ? data : data ? [data] : [];
  const message = entries[0] && typeof entries[0].message === 'string' ? entries[0].message : '';
  return safeText(message);
}

async function startMetadataDeploy(zipBuffer) {
  const { accessToken, instanceUrl } = await getSalesforceAccessToken();
  const { apiVersion } = getSalesforceConfig();
  const boundary = `Boundary${crypto.randomBytes(16).toString('hex')}`;
  const url = `${instanceUrl}/services/data/${apiVersion}/metadata/deployRequest`;

  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
      },
      body: buildMultipartBody(zipBuffer, boundary),
    });
  } catch (error) {
    throw new AppError(502, 'SALESFORCE_API_ERROR', 'Unable to reach Salesforce');
  }

  const data = await readJson(response);
  if (!response.ok) {
    throw new AppError(502, 'SALESFORCE_API_ERROR', restErrorMessage(data));
  }

  return data;
}

function isTerminalDeploy(result) {
  const status = result && result.status;
  return status === 'Succeeded'
    || status === 'SucceededPartial'
    || status === 'Failed'
    || status === 'Canceled';
}

function safeText(value) {
  const text = value == null ? '' : String(value);
  if (!text || SECRET_PATTERN.test(text)) {
    return 'Salesforce metadata deploy failed';
  }
  return text;
}

function failureLines(result) {
  const details = (result && result.details) || {};
  const raw = details.componentFailures || [];
  const failures = Array.isArray(raw) ? raw : [raw];
  return failures
    .filter(Boolean)
    .map((failure) => {
      const name = failure.fullName || failure.fileName || 'component';
      const problem = safeText(failure.problem || result.errorMessage);
      return `${name}: ${problem}`;
    });
}

async function deployMetadata({
  client,
  zipBuffer,
  startDeploy = startMetadataDeploy,
  sleepFn = sleep,
  maxAttempts = 90,
  log = () => {},
}) {
  const created = await startDeploy(zipBuffer);
  const id = (created && created.id)
    || (created && created.deployResult && created.deployResult.id);

  if (!id || !SALESFORCE_ID.test(id)) {
    throw new AppError(502, 'SALESFORCE_API_ERROR', 'Salesforce did not return a metadata deploy id');
  }

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const status = await client.get(`/metadata/deployRequest/${id}`, {
      query: { includeDetails: 'true' },
    });
    const result = (status && status.deployResult) || status || {};
    log(`Deploy status: ${result.status || 'Pending'}`);
    if (isTerminalDeploy(result)) {
      return result;
    }
    await sleepFn(2000);
  }

  throw new AppError(502, 'SALESFORCE_API_ERROR', 'Salesforce metadata deploy timed out');
}

async function findPermissionSetId(client, sleepFn) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const result = await client.get('/query', {
      query: {
        q: "SELECT Id FROM PermissionSet WHERE Name = 'DispositionLeadIntegration'",
      },
    });
    const id = result && result.records && result.records[0] && result.records[0].Id;
    if (id) {
      return id;
    }
    await sleepFn(1000);
  }
  return null;
}

async function assignIntegrationPermissionSet({ client, username, sleepFn = sleep }) {
  const userResult = await client.get('/query', {
    query: {
      q: `SELECT Id FROM User WHERE Username = '${escapeSoqlString(username)}'`,
    },
  });
  const userId = userResult && userResult.records && userResult.records[0] && userResult.records[0].Id;

  if (!userId || !SALESFORCE_ID.test(userId)) {
    throw new AppError(502, 'SALESFORCE_API_ERROR', 'Salesforce user from SALESFORCE_USERNAME was not found');
  }

  const permissionSetId = await findPermissionSetId(client, sleepFn);
  if (!permissionSetId || !SALESFORCE_ID.test(permissionSetId)) {
    throw new AppError(
      502,
      'SALESFORCE_API_ERROR',
      'Permission set DispositionLeadIntegration was not found after deploy'
    );
  }

  const existing = await client.get('/query', {
    query: {
      q: `SELECT Id FROM PermissionSetAssignment WHERE AssigneeId = '${userId}' AND PermissionSetId = '${permissionSetId}'`,
    },
  });

  if (existing && existing.records && existing.records.length > 0) {
    return { alreadyAssigned: true };
  }

  try {
    await client.post('/sobjects/PermissionSetAssignment', {
      AssigneeId: userId,
      PermissionSetId: permissionSetId,
    });
  } catch (error) {
    if (error instanceof AppError && /duplicate/i.test(error.message)) {
      return { alreadyAssigned: true };
    }
    throw error;
  }

  return { alreadyAssigned: false };
}

module.exports = {
  deployMetadata,
  assignIntegrationPermissionSet,
  failureLines,
  buildMultipartBody,
  deployOptions,
};
