const { AppError } = require('./errors');
const { SALESFORCE_FIELDS } = require('../services/salesforce/schema');

const FIELD_SPECS = [
  { name: 'contactId', salesforce: SALESFORCE_FIELDS.contactId, type: 'string', maxLength: 18 },
  { name: 'firstName', salesforce: SALESFORCE_FIELDS.firstName, type: 'string', maxLength: 255 },
  { name: 'middleName', salesforce: SALESFORCE_FIELDS.middleName, type: 'string', maxLength: 255 },
  { name: 'lastName', salesforce: SALESFORCE_FIELDS.lastName, type: 'string', maxLength: 255 },
  { name: 'phone1', salesforce: SALESFORCE_FIELDS.phone1, type: 'string', maxLength: 40 },
  { name: 'email1', salesforce: SALESFORCE_FIELDS.email1, type: 'email', maxLength: 80 },
  { name: 'country', salesforce: SALESFORCE_FIELDS.country, type: 'string', maxLength: 255 },
  { name: 'city', salesforce: SALESFORCE_FIELDS.city, type: 'string', maxLength: 255 },
  { name: 'state', salesforce: SALESFORCE_FIELDS.state, type: 'string', maxLength: 255 },
  { name: 'street', salesforce: SALESFORCE_FIELDS.street, type: 'string', maxLength: 255 },
  { name: 'zip', salesforce: SALESFORCE_FIELDS.zip, type: 'string', maxLength: 255 },
  { name: 'metric1', salesforce: SALESFORCE_FIELDS.metric1, type: 'number' },
  { name: 'metric2', salesforce: SALESFORCE_FIELDS.metric2, type: 'number' },
  { name: 'metric3', salesforce: SALESFORCE_FIELDS.metric3, type: 'number' },
  { name: 'metric4', salesforce: SALESFORCE_FIELDS.metric4, type: 'number' },
  { name: 'dispositionStatus', salesforce: SALESFORCE_FIELDS.dispositionStatus, type: 'string', maxLength: 255 },
  { name: 'dispositionDateTime', salesforce: SALESFORCE_FIELDS.dispositionDateTime, type: 'datetime' },
];

const FIELD_BY_NAME = new Map(FIELD_SPECS.map((field) => [field.name, field]));
const SALESFORCE_ID = /^[a-zA-Z0-9]{15}(?:[a-zA-Z0-9]{3})?$/;
const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CONTROL_CHARS = /[\u0000-\u001F\u007F]/;
const MAX_OFFSET = 2000;
const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;

function assertObject(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Request body must be a JSON object');
  }
}

function rejectUnknownFields(body) {
  for (const key of Object.keys(body)) {
    if (!FIELD_BY_NAME.has(key)) {
      throw new AppError(400, 'VALIDATION_ERROR', `Unknown field: ${key}`);
    }
  }
}

function validateFieldValue(field, value) {
  if (field.type === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new AppError(400, 'VALIDATION_ERROR', `${field.name} must be a number`);
    }
    return value;
  }

  if (field.type === 'datetime') {
    return parseInstant(value, field.name);
  }

  if (typeof value !== 'string') {
    throw new AppError(400, 'VALIDATION_ERROR', `${field.name} must be a string`);
  }

  const trimmed = value.trim();
  if (!trimmed) {
    throw new AppError(400, 'VALIDATION_ERROR', `${field.name} must not be empty`);
  }
  if (CONTROL_CHARS.test(trimmed)) {
    throw new AppError(400, 'VALIDATION_ERROR', `${field.name} contains invalid characters`);
  }
  if (trimmed.length > field.maxLength) {
    throw new AppError(
      400,
      'VALIDATION_ERROR',
      `${field.name} must be ${field.maxLength} characters or fewer`
    );
  }
  if (field.type === 'email' && !EMAIL.test(trimmed)) {
    throw new AppError(400, 'VALIDATION_ERROR', `${field.name} must be a valid email`);
  }

  return trimmed;
}

function parseInstant(value, label) {
  if (typeof value !== 'string' || !ISO_INSTANT.test(value.trim())) {
    throw new AppError(
      400,
      'VALIDATION_ERROR',
      `${label} must be an ISO-8601 UTC timestamp`
    );
  }

  const date = new Date(value.trim());
  if (Number.isNaN(date.getTime())) {
    throw new AppError(400, 'VALIDATION_ERROR', `${label} must be an ISO-8601 UTC timestamp`);
  }

  return date.toISOString();
}

function mapFields(body, { allowNull }) {
  const record = {};

  for (const [key, value] of Object.entries(body)) {
    const field = FIELD_BY_NAME.get(key);
    if (value === null) {
      if (!allowNull) {
        throw new AppError(400, 'VALIDATION_ERROR', `${field.name} must not be null`);
      }
      record[field.salesforce] = null;
      continue;
    }

    const validated = validateFieldValue(field, value);
    record[field.salesforce] = field.type === 'datetime' ? validated : validated;
  }

  return record;
}

function validateCreateBody(body, now = new Date()) {
  assertObject(body);
  rejectUnknownFields(body);

  const record = mapFields(body, { allowNull: false });
  const phone = record[SALESFORCE_FIELDS.phone1];
  const email = record[SALESFORCE_FIELDS.email1];
  if (!phone && !email) {
    throw new AppError(400, 'VALIDATION_ERROR', 'At least phone1 or email1 is required');
  }

  if (!Object.prototype.hasOwnProperty.call(body, 'dispositionDateTime')) {
    record[SALESFORCE_FIELDS.dispositionDateTime] = now.toISOString();
  }

  return record;
}

function validateUpdateBody(body) {
  assertObject(body);
  rejectUnknownFields(body);

  if (Object.keys(body).length === 0) {
    throw new AppError(400, 'VALIDATION_ERROR', 'At least one field is required');
  }

  return mapFields(body, { allowNull: true });
}

function isSalesforceId(value) {
  return typeof value === 'string' && SALESFORCE_ID.test(value);
}

function readQueryValue(query, name) {
  if (!query || !Object.prototype.hasOwnProperty.call(query, name)) {
    return undefined;
  }

  const value = query[name];
  if (Array.isArray(value)) {
    throw new AppError(400, 'VALIDATION_ERROR', `${name} must be a single value`);
  }
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== 'string') {
    throw new AppError(400, 'VALIDATION_ERROR', `${name} must be a string`);
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function parseDateOnly(value) {
  const match = DATE_ONLY.exec(value);
  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const utc = new Date(Date.UTC(year, month - 1, day));
  if (
    utc.getUTCFullYear() !== year ||
    utc.getUTCMonth() !== month - 1 ||
    utc.getUTCDate() !== day
  ) {
    throw new AppError(400, 'VALIDATION_ERROR', `${value} is not a valid calendar date`);
  }

  return utc;
}

function parseFilterInstant(value, label) {
  if (DATE_ONLY.test(value)) {
    return { kind: 'date', day: parseDateOnly(value) };
  }

  if (!ISO_INSTANT.test(value)) {
    throw new AppError(
      400,
      'VALIDATION_ERROR',
      `${label} must be a UTC date (YYYY-MM-DD) or an ISO-8601 timestamp`
    );
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new AppError(
      400,
      'VALIDATION_ERROR',
      `${label} must be a UTC date (YYYY-MM-DD) or an ISO-8601 timestamp`
    );
  }

  return { kind: 'instant', value: date };
}

function nextUtcDay(date) {
  return new Date(Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate() + 1
  ));
}

function validateSearchQuery(query) {
  const phone1 = readQueryValue(query, 'phone1');
  const email1 = readQueryValue(query, 'email1');
  const dispositionStatus = readQueryValue(query, 'dispositionStatus');
  const fromRaw = readQueryValue(query, 'fromDate');
  const toRaw = readQueryValue(query, 'toDate');
  const dateRaw = readQueryValue(query, 'date');
  const sortRaw = readQueryValue(query, 'sort') || 'newest';
  const pageRaw = readQueryValue(query, 'page');
  const pageSizeRaw = readQueryValue(query, 'pageSize');

  if (phone1) {
    validateFieldValue(FIELD_BY_NAME.get('phone1'), phone1);
  }
  if (email1) {
    validateFieldValue(FIELD_BY_NAME.get('email1'), email1);
  }
  if (dispositionStatus) {
    validateFieldValue(FIELD_BY_NAME.get('dispositionStatus'), dispositionStatus);
  }

  if (sortRaw !== 'newest' && sortRaw !== 'earliest') {
    throw new AppError(400, 'VALIDATION_ERROR', 'sort must be earliest or newest');
  }

  const page = pageRaw === undefined ? 1 : parsePositiveInt(pageRaw, 'page');
  const pageSize = pageSizeRaw === undefined
    ? DEFAULT_PAGE_SIZE
    : parsePositiveInt(pageSizeRaw, 'pageSize');

  if (pageSize > MAX_PAGE_SIZE) {
    throw new AppError(
      400,
      'VALIDATION_ERROR',
      `pageSize must be an integer between 1 and ${MAX_PAGE_SIZE}`
    );
  }

  const offset = (page - 1) * pageSize;
  if (offset > MAX_OFFSET) {
    throw new AppError(400, 'VALIDATION_ERROR', 'page is too large');
  }

  const bounds = [];
  if (dateRaw) {
    if (!DATE_ONLY.test(dateRaw)) {
      throw new AppError(400, 'VALIDATION_ERROR', 'date must be a UTC date (YYYY-MM-DD)');
    }
    const day = parseDateOnly(dateRaw);
    bounds.push({ op: '>=', value: day });
    bounds.push({ op: '<', value: nextUtcDay(day) });
  }

  const fromBound = fromRaw ? parseFilterInstant(fromRaw, 'fromDate') : null;
  const toBound = toRaw ? parseFilterInstant(toRaw, 'toDate') : null;

  if (fromBound) {
    bounds.push({
      op: '>=',
      value: fromBound.kind === 'date' ? fromBound.day : fromBound.value,
    });
  }
  if (toBound) {
    if (toBound.kind === 'date') {
      bounds.push({ op: '<', value: nextUtcDay(toBound.day) });
    } else {
      bounds.push({ op: '<=', value: toBound.value });
    }
  }

  const lower = bounds.filter((bound) => bound.op === '>=').map((bound) => bound.value.getTime());
  const upper = bounds
    .filter((bound) => bound.op === '<' || bound.op === '<=')
    .map((bound) => bound.value.getTime());
  if (lower.length && upper.length && Math.max(...lower) > Math.min(...upper)) {
    throw new AppError(400, 'VALIDATION_ERROR', 'fromDate must be on or before toDate');
  }

  return {
    phone1,
    email1,
    dispositionStatus,
    bounds,
    sortDirection: sortRaw === 'earliest' ? 'ASC' : 'DESC',
    page,
    pageSize,
    offset,
  };
}

function parsePositiveInt(value, label) {
  if (!/^[1-9]\d*$/.test(value)) {
    throw new AppError(400, 'VALIDATION_ERROR', `${label} must be a positive integer`);
  }
  return Number(value);
}

module.exports = {
  FIELD_SPECS,
  validateCreateBody,
  validateUpdateBody,
  validateSearchQuery,
  isSalesforceId,
};
