function toCsv(columns = [], rows = []) {
  const headers = columns.map((column) => column.label || column.field || column);
  const lines = [headers.map(csvCell).join(',')];
  rows.forEach((row) => {
    lines.push(columns.map((column) => csvCell(readPath(row, column.field || column))).join(','));
  });
  return lines.join('\r\n');
}

function csvCell(value) {
  if (value === null || value === undefined) return '';
  const text = typeof value === 'object' ? JSON.stringify(value) : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

function readPath(row, path) {
  if (Object.prototype.hasOwnProperty.call(row || {}, path)) return row[path];
  return String(path || '').split('.').reduce((value, key) => value?.[key], row);
}

module.exports = {
  toCsv
};
