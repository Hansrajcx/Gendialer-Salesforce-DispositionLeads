function escapeSoqlString(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function toSoqlDateTime(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error('Invalid datetime');
  }
  return date.toISOString();
}

module.exports = {
  escapeSoqlString,
  toSoqlDateTime,
};
