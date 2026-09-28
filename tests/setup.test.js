const { crc32 } = require('../src/setup/zipStore');
const { buildMetadataFiles, buildMetadataZip } = require('../src/setup/metadataPackage');
const {
  deployMetadata,
  assignIntegrationPermissionSet,
  failureLines,
  buildMultipartBody,
} = require('../src/setup/deploy');
const { AppError } = require('../src/utils/errors');

describe('Salesforce setup package', () => {
  test('computes the standard CRC-32', () => {
    expect(crc32(Buffer.from('123456789'))).toBe(0xcbf43926);
  });

  test('packages the object, fields, permission set, and page layout for the API version', () => {
    const files = buildMetadataFiles('v64.0');
    const byName = Object.fromEntries(files.map((file) => [file.name, String(file.data)]));

    expect(byName['package.xml']).toContain('<members>DispositionLead__c</members>');
    expect(byName['package.xml']).toContain('<name>PermissionSet</name>');
    expect(byName['package.xml']).toContain('<members>DispositionLead__c-Disposition Lead Layout</members>');
    expect(byName['package.xml']).toContain('<name>Layout</name>');
    expect(byName['package.xml']).toContain('<version>64.0</version>');

    const objectXml = byName['objects/DispositionLead__c.object'];
    expect(objectXml).toContain('<label>Disposition Lead</label>');
    expect(objectXml).toContain('<fullName>ContactId__c</fullName>');
    expect(objectXml).toContain('<fullName>Phone1__c</fullName>');
    expect(objectXml).toContain('<fullName>Email1__c</fullName>');
    expect(objectXml).toContain('<fullName>DispositionDateTime__c</fullName>');
    expect(objectXml).toContain('<fullName>Metric4__c</fullName>');
    expect(objectXml.match(/<fields>/g)).toHaveLength(17);
    expect(objectXml).not.toContain('<CustomField');

    expect(byName['permissionsets/DispositionLeadIntegration.permissionset'])
      .toContain('<object>DispositionLead__c</object>');

    const layoutXml = byName['layouts/DispositionLead__c-Disposition Lead Layout.layout'];
    for (const field of [
      'DispositionStatus__c', 'ContactId__c', 'DispositionDateTime__c', 'OwnerId',
      'FirstName__c', 'MiddleName__c', 'LastName__c', 'Phone1__c', 'Email1__c', 'Country__c',
      'Street__c', 'City__c', 'State__c', 'Zip__c',
      'Metric1__c', 'Metric2__c', 'Metric3__c', 'Metric4__c',
      'CreatedById', 'LastModifiedById',
    ]) {
      expect(layoutXml.match(new RegExp(`<field>${field}</field>`, 'g'))).toHaveLength(1);
    }
    for (const section of [
      'Disposition Information', 'Contact Information', 'Address', 'Metrics', 'System Information',
    ]) {
      expect(layoutXml).toContain(`<label>${section}</label>`);
    }
    expect(layoutXml).not.toContain('<field>Name</field>');
    expect(layoutXml).not.toContain('<field>CreatedDate</field>');
    expect(layoutXml).not.toContain('<field>LastModifiedDate</field>');

    const zip = buildMetadataZip('v64.0');
    expect(zip.subarray(0, 2).toString()).toBe('PK');
    expect(zip.toString('utf8')).toContain('DispositionDateTime__c');
    expect(zip.toString('utf8')).toContain('DispositionLead__c-Disposition Lead Layout');
  });
});

describe('Salesforce metadata deploy', () => {
  test('sends the metadata zip as multipart form data', () => {
    const zip = Buffer.from('PK metadata');
    const body = buildMultipartBody(zip, 'BoundaryTest');
    const text = body.toString('utf8');

    expect(text).toContain('name="entity_content"');
    expect(text).toContain('"singlePackage":true');
    expect(text).toContain('name="file"; filename="deploy.zip"');
    expect(body.includes(zip)).toBe(true);
    expect(text).not.toContain('zipFile');
  });

  test('polls until the deploy succeeds', async () => {
    const zip = Buffer.from('metadata');
    const startDeploy = jest.fn().mockResolvedValue({ id: '0Af000000000001AAA' });
    const client = {
      get: jest.fn()
        .mockResolvedValueOnce({
          deployResult: { status: 'InProgress', success: false, done: false },
        })
        .mockResolvedValueOnce({
          deployResult: { status: 'Succeeded', success: true, done: true },
        }),
    };

    const result = await deployMetadata({
      client,
      zipBuffer: zip,
      startDeploy,
      sleepFn: async () => {},
    });

    expect(result.status).toBe('Succeeded');
    expect(startDeploy).toHaveBeenCalledWith(zip);
    expect(client.get).toHaveBeenLastCalledWith('/metadata/deployRequest/0Af000000000001AAA', {
      query: { includeDetails: 'true' },
    });
  });

  test('describes component failures without secrets', () => {
    const lines = failureLines({
      status: 'Failed',
      details: {
        componentFailures: {
          fullName: 'DispositionLead__c',
          problem: 'bad access_token=secret',
        },
      },
    });

    expect(lines).toEqual(['DispositionLead__c: Salesforce metadata deploy failed']);
  });

  test('assigns the permission set to the env user and skips a duplicate', async () => {
    const client = {
      get: jest.fn()
        .mockResolvedValueOnce({ records: [{ Id: '005000000000001AAA' }] })
        .mockResolvedValueOnce({ records: [{ Id: '0PS000000000001AAA' }] })
        .mockResolvedValueOnce({ records: [] }),
      post: jest.fn().mockResolvedValue({ id: '0Pa000000000001AAA', success: true }),
    };

    const created = await assignIntegrationPermissionSet({
      client,
      username: "integration'user@example.com",
      sleepFn: async () => {},
    });

    expect(created).toEqual({ alreadyAssigned: false });
    expect(client.get.mock.calls[0][1].query.q).toContain("integration\\'user@example.com");
    expect(client.post).toHaveBeenCalledWith('/sobjects/PermissionSetAssignment', {
      AssigneeId: '005000000000001AAA',
      PermissionSetId: '0PS000000000001AAA',
    });

    client.get.mockReset();
    client.post.mockReset();
    client.get
      .mockResolvedValueOnce({ records: [{ Id: '005000000000001AAA' }] })
      .mockResolvedValueOnce({ records: [{ Id: '0PS000000000001AAA' }] })
      .mockResolvedValueOnce({ records: [{ Id: '0Pa000000000001AAA' }] });

    const existing = await assignIntegrationPermissionSet({
      client,
      username: 'integration@example.com',
      sleepFn: async () => {},
    });

    expect(existing).toEqual({ alreadyAssigned: true });
    expect(client.post).not.toHaveBeenCalled();
  });

  test('treats a duplicate assignment error as already assigned', async () => {
    const client = {
      get: jest.fn()
        .mockResolvedValueOnce({ records: [{ Id: '005000000000001AAA' }] })
        .mockResolvedValueOnce({ records: [{ Id: '0PS000000000001AAA' }] })
        .mockResolvedValueOnce({ records: [] }),
      post: jest.fn().mockRejectedValue(new AppError(502, 'SALESFORCE_API_ERROR', 'duplicate value found')),
    };

    await expect(assignIntegrationPermissionSet({
      client,
      username: 'integration@example.com',
      sleepFn: async () => {},
    })).resolves.toEqual({ alreadyAssigned: true });
  });
});
