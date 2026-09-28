const client = require('./client');
const { AppError } = require('../../utils/errors');
const { escapeSoqlString, toSoqlDateTime } = require('../../utils/soql');
const {
  FIELD_SPECS,
  validateCreateBody,
  validateUpdateBody,
  validateSearchQuery,
  isSalesforceId,
} = require('../../utils/validation');

const OBJECT_NAME = 'DispositionLead__c';
const SELECT_FIELDS = ['Id', ...FIELD_SPECS.map((field) => field.salesforce)].join(', ');

function toUtcIso(value) {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.toISOString();
}

function fromSalesforce(record) {
  const mapped = { id: record.Id || null };

  for (const field of FIELD_SPECS) {
    const value = record[field.salesforce];
    if (value === undefined || value === null) {
      mapped[field.name] = null;
      continue;
    }

    if (field.type === 'datetime') {
      mapped[field.name] = toUtcIso(value);
    } else if (field.type === 'number') {
      mapped[field.name] = Number(value);
    } else {
      mapped[field.name] = value;
    }
  }

  return mapped;
}

async function createDispositionLead(body, now) {
  const record = validateCreateBody(body, now);
  const result = await client.post(`/sobjects/${OBJECT_NAME}`, record);

  if (!result || !result.id) {
    throw new AppError(502, 'SALESFORCE_API_ERROR', 'Salesforce did not return a record id');
  }

  return result.id;
}

async function updateDispositionLead(id, body) {
  if (!isSalesforceId(id)) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Invalid Salesforce record id');
  }

  const record = validateUpdateBody(body);
  await client.patch(`/sobjects/${OBJECT_NAME}/${id}`, record);
  return id;
}

function buildSearchQuery(query) {
  const parsed = validateSearchQuery(query);
  const clauses = [];

  if (parsed.phone1) {
    clauses.push(`Phone1__c = '${escapeSoqlString(parsed.phone1)}'`);
  }
  if (parsed.email1) {
    clauses.push(`Email1__c = '${escapeSoqlString(parsed.email1)}'`);
  }
  if (parsed.dispositionStatus) {
    clauses.push(`DispositionStatus__c = '${escapeSoqlString(parsed.dispositionStatus)}'`);
  }

  for (const bound of parsed.bounds) {
    clauses.push(`DispositionDateTime__c ${bound.op} ${toSoqlDateTime(bound.value)}`);
  }

  const whereSql = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';
  const soql = [
    `SELECT ${SELECT_FIELDS}`,
    `FROM ${OBJECT_NAME}${whereSql}`,
    `ORDER BY DispositionDateTime__c ${parsed.sortDirection}`,
    `LIMIT ${parsed.pageSize}`,
    `OFFSET ${parsed.offset}`,
  ].join(' ');
  const countSoql = `SELECT COUNT(Id) total FROM ${OBJECT_NAME}${whereSql}`;

  return {
    soql,
    countSoql,
    page: parsed.page,
    pageSize: parsed.pageSize,
  };
}

async function searchDispositionLeads(query) {
  const built = buildSearchQuery(query);
  const [listResult, countResult] = await Promise.all([
    client.get('/query', { query: { q: built.soql } }),
    client.get('/query', { query: { q: built.countSoql } }),
  ]);

  const records = listResult && Array.isArray(listResult.records) ? listResult.records : [];
  const totalValue = countResult && countResult.records && countResult.records[0]
    ? countResult.records[0].total
    : 0;

  return {
    data: records.map(fromSalesforce),
    page: built.page,
    pageSize: built.pageSize,
    totalSize: Number(totalValue) || 0,
  };
}

module.exports = {
  createDispositionLead,
  updateDispositionLead,
  searchDispositionLeads,
  buildSearchQuery,
  fromSalesforce,
};
