const XLSX = require('xlsx');

function toCsv(columns = [], rows = []) {
  const headers = columns.map((column) => column.label || column.field || column);
  const lines = [headers.map(csvCell).join(',')];
  rows.forEach((row) => {
    lines.push(columns.map((column) => csvCell(readPath(row, column.field || column))).join(','));
  });
  return lines.join('\r\n');
}

function toXlsx(columns = [], rows = [], sheetName = 'Report') {
  const headers = columns.map((column) => column.label || column.field || column);
  const body = rows.map((row) => columns.map((column) => readPath(row, column.field || column)));
  const worksheet = XLSX.utils.aoa_to_sheet([headers, ...body]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, safeSheetName(sheetName));
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
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

function safeSheetName(name) {
  const text = String(name || 'Report').replace(/[\][*?/\\:]/g, ' ').trim() || 'Report';
  return text.slice(0, 31);
}

module.exports = {
  toCsv,
  toXlsx
};
