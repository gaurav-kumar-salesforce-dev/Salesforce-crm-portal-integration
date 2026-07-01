function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function flattenRecord(record = {}) {
  const flat = {};
  for (const [key, value] of Object.entries(record)) {
    if (key === 'attributes') continue;
    flat[key] = value;
  }
  return flat;
}

function csvEscape(value) {
  if (value === null || value === undefined) return '';
  const text = value instanceof Date ? value.toISOString() : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function recordsToCsv(records = []) {
  const rows = records.map(flattenRecord);
  const fieldSet = new Set();
  rows.forEach((row) => Object.keys(row).forEach((key) => fieldSet.add(key)));
  const fields = [...fieldSet];
  if (!fields.length) throw new Error('Bulk jobs require at least one field');

  return [
    fields.map(csvEscape).join(','),
    ...rows.map((row) => fields.map((field) => csvEscape(row[field])).join(','))
  ].join('\n');
}

function parseCsv(text = '') {
  const rows = [];
  let row = [];
  let value = '';
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];

    if (quoted) {
      if (char === '"' && next === '"') {
        value += '"';
        i += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        value += char;
      }
      continue;
    }

    if (char === '"') quoted = true;
    else if (char === ',') {
      row.push(value);
      value = '';
    } else if (char === '\n') {
      row.push(value);
      rows.push(row);
      row = [];
      value = '';
    } else if (char !== '\r') {
      value += char;
    }
  }

  if (value || row.length) {
    row.push(value);
    rows.push(row);
  }

  if (!rows.length) return [];
  const headers = rows.shift();
  return rows
    .filter((item) => item.some((cell) => cell !== ''))
    .map((item) => headers.reduce((record, header, index) => {
      record[header] = item[index] ?? '';
      return record;
    }, {}));
}

function normalizeBulkSoql(soql) {
  const compact = String(soql || '').replace(/\s+/g, ' ').trim();
  if (!/^SELECT\s+/i.test(compact)) throw new Error('Bulk query requires a SELECT SOQL statement');
  if (/\bCOUNT\s*\(/i.test(compact) || /\b(GROUP\s+BY|OFFSET|TYPEOF)\b/i.test(compact)) {
    throw new Error('Bulk API 2.0 query does not support COUNT(), GROUP BY, OFFSET, or TYPEOF');
  }
  if (/\(\s*SELECT\s+/i.test(compact)) {
    throw new Error('Bulk API 2.0 query does not support parent-to-child subqueries');
  }
  return compact;
}

module.exports = {
  sleep,
  flattenRecord,
  csvEscape,
  recordsToCsv,
  parseCsv,
  normalizeBulkSoql
};
