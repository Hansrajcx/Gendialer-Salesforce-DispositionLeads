const fs = require('fs');
const path = require('path');

const { buildStoredZip } = require('./zipStore');

const PROJECT_ROOT = path.join(__dirname, '..', '..');
const OBJECT_DIR = path.join(
  PROJECT_ROOT,
  'force-app',
  'main',
  'default',
  'objects',
  'DispositionLead__c'
);
const PERMISSION_SET_PATH = path.join(
  PROJECT_ROOT,
  'force-app',
  'main',
  'default',
  'permissionsets',
  'DispositionLeadIntegration.permissionset-meta.xml'
);
const LAYOUT_PATH = path.join(
  PROJECT_ROOT,
  'force-app',
  'main',
  'default',
  'layouts',
  'DispositionLead__c-Disposition Lead Layout.layout-meta.xml'
);

function metadataApiVersion(apiVersion) {
  return String(apiVersion || '').replace(/^v/i, '');
}

function fieldToObjectXml(xml) {
  const inner = xml
    .replace(/<\?xml[\s\S]*?\?>/, '')
    .replace(/<CustomField\b[^>]*>/, '')
    .replace(/<\/CustomField>\s*$/, '')
    .trim();

  const indented = inner
    .split(/\r?\n/)
    .map((line) => `    ${line}`)
    .join('\n');

  return `    <fields>\n${indented}\n    </fields>`;
}

function buildCustomObjectXml() {
  const objectXml = fs.readFileSync(
    path.join(OBJECT_DIR, 'DispositionLead__c.object-meta.xml'),
    'utf8'
  );
  const fieldNames = fs.readdirSync(path.join(OBJECT_DIR, 'fields'))
    .filter((name) => name.endsWith('.field-meta.xml'))
    .sort();

  const fields = fieldNames.map((name) => {
    const xml = fs.readFileSync(path.join(OBJECT_DIR, 'fields', name), 'utf8');
    return fieldToObjectXml(xml);
  });

  return objectXml.replace(
    '</CustomObject>',
    `${fields.join('\n')}\n</CustomObject>`
  );
}

function buildPackageXml(apiVersion) {
  const version = metadataApiVersion(apiVersion);
  return `<?xml version="1.0" encoding="UTF-8"?>
<Package xmlns="http://soap.sforce.com/2006/04/metadata">
    <types>
        <members>DispositionLead__c</members>
        <name>CustomObject</name>
    </types>
    <types>
        <members>DispositionLeadIntegration</members>
        <name>PermissionSet</name>
    </types>
    <types>
      <members>DispositionLead__c-Disposition Lead Layout</members>
      <name>Layout</name>
    </types>
    <version>${version}</version>
</Package>
`;
}

function buildMetadataFiles(apiVersion) {
  return [
    {
      name: 'package.xml',
      data: buildPackageXml(apiVersion),
    },
    {
      name: 'objects/DispositionLead__c.object',
      data: buildCustomObjectXml(),
    },
    {
      name: 'permissionsets/DispositionLeadIntegration.permissionset',
      data: fs.readFileSync(PERMISSION_SET_PATH, 'utf8'),
    },
    {
      name: 'layouts/DispositionLead__c-Disposition Lead Layout.layout',
      data: fs.readFileSync(LAYOUT_PATH, 'utf8'),
    },
  ];
}

function buildMetadataZip(apiVersion) {
  return buildStoredZip(buildMetadataFiles(apiVersion));
}

module.exports = {
  buildMetadataFiles,
  buildMetadataZip,
  metadataApiVersion,
};
