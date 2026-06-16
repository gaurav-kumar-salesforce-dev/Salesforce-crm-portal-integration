const SUPPORTED_REPORT_TYPES = new Set(['tabular', 'summary', 'matrix']);
const SUPPORTED_AGGREGATES = new Set(['count', 'sum', 'avg', 'min', 'max', 'distinct_count']);
const SUPPORTED_OPERATORS = new Set([
  'eq',
  'neq',
  'contains',
  'starts_with',
  'gt',
  'gte',
  'lt',
  'lte',
  'is_null',
  'is_not_null'
]);

const FIELD_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)?$/;

function normalizeReportDefinition(input = {}) {
  const definition = input.definition || input;
  const reportType = definition.reportType || definition.report_type || 'tabular';
  if (!SUPPORTED_REPORT_TYPES.has(reportType)) {
    const error = new Error('Supported report types are tabular, summary, and matrix.');
    error.statusCode = 400;
    throw error;
  }

  const primaryObject = String(definition.primaryObject || definition.primary_object || '').trim();
  if (!primaryObject) {
    const error = new Error('Primary Salesforce object is required.');
    error.statusCode = 400;
    throw error;
  }

  const fields = uniqueStrings(definition.fields || [])
    .filter(isValidFieldName)
    .slice(0, 50);
  const groupBy = uniqueStrings(definition.groupBy || definition.group_by || [])
    .filter(isValidFieldName)
    .slice(0, 3);
  const groupColumns = uniqueStrings(definition.groupColumns || definition.group_columns || [])
    .filter(isValidFieldName)
    .slice(0, 2);
  const aggregates = normalizeAggregates(definition.aggregates || []);

  if ((reportType === 'summary' || reportType === 'matrix') && !groupBy.length) {
    const error = new Error(`${titleCase(reportType)} reports require at least one row grouping field.`);
    error.statusCode = 400;
    throw error;
  }

  if (reportType === 'matrix' && !groupColumns.length) {
    const error = new Error('Matrix reports require at least one column grouping field.');
    error.statusCode = 400;
    throw error;
  }

  if (!fields.length && !groupBy.length) {
    const error = new Error('Select at least one report column.');
    error.statusCode = 400;
    throw error;
  }

  return {
    reportType,
    primaryObject,
    fields,
    groupBy,
    groupColumns: reportType === 'matrix' ? groupColumns : [],
    aggregates: reportType === 'summary' || reportType === 'matrix' ? aggregates : [],
    chart: normalizeChart(definition.chart || {}),
    filters: normalizeFilters(definition.filters || []),
    sort: normalizeSort(definition.sort || []),
    rowLimit: clampInt(definition.rowLimit || definition.row_limit || 200, 1, 2000)
  };
}

function normalizeChart(chart) {
  const enabled = Boolean(chart.enabled);
  const type = ['bar', 'line', 'donut'].includes(chart.type) ? chart.type : 'bar';
  const labelField = String(chart.labelField || '').trim();
  const valueField = String(chart.valueField || '').trim();
  return {
    enabled,
    type,
    labelField: isValidFieldName(labelField) || labelField === '__count' ? labelField : '',
    valueField: isValidFieldName(valueField) || valueField === '__count' ? valueField : ''
  };
}

function titleCase(value) {
  return String(value || '').replace(/\b\w/g, (char) => char.toUpperCase());
}

function normalizeAggregates(aggregates) {
  const normalized = Array.isArray(aggregates) ? aggregates : [];
  const result = normalized
    .map((aggregate) => ({
      function: String(aggregate.function || aggregate.fn || 'count').toLowerCase(),
      field: String(aggregate.field || '').trim(),
      label: String(aggregate.label || '').trim()
    }))
    .filter((aggregate) => (
      SUPPORTED_AGGREGATES.has(aggregate.function) &&
      (aggregate.function === 'count' || isValidFieldName(aggregate.field))
    ))
    .slice(0, 8);

  if (!result.some((aggregate) => aggregate.function === 'count')) {
    result.unshift({ function: 'count', field: '', label: 'Record Count' });
  }

  return result;
}

function normalizeFilters(filters) {
  if (!Array.isArray(filters)) return [];
  return filters
    .map((filter) => ({
      field: String(filter.field || '').trim(),
      operator: String(filter.operator || 'eq').trim(),
      value: filter.value
    }))
    .filter((filter) => isValidFieldName(filter.field) && SUPPORTED_OPERATORS.has(filter.operator))
    .slice(0, 20);
}

function normalizeSort(sort) {
  if (!Array.isArray(sort)) return [];
  return sort
    .map((item) => ({
      field: String(item.field || '').trim(),
      direction: String(item.direction || 'asc').toLowerCase() === 'desc' ? 'DESC' : 'ASC'
    }))
    .filter((item) => isValidFieldName(item.field))
    .slice(0, 3);
}

function uniqueStrings(values) {
  return [...new Set((values || []).map((value) => String(value || '').trim()).filter(Boolean))];
}

function isValidFieldName(field) {
  return FIELD_NAME_PATTERN.test(String(field || ''));
}

function clampInt(value, min, max) {
  const parsed = parseInt(value, 10);
  if (!Number.isFinite(parsed)) return min;
  return Math.min(Math.max(parsed, min), max);
}

module.exports = {
  normalizeReportDefinition,
  isValidFieldName
};
