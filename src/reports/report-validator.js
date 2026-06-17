const SUPPORTED_REPORT_TYPES = new Set(['tabular', 'summary', 'matrix', 'joined']);
const SUPPORTED_AGGREGATES = new Set(['count', 'sum', 'avg', 'min', 'max', 'distinct_count']);
const SUPPORTED_BUCKET_OPERATORS = new Set(['eq', 'neq', 'contains', 'starts_with', 'gt', 'gte', 'lt', 'lte', 'between', 'is_blank']);
const SUPPORTED_HIGHLIGHT_OPERATORS = new Set(['eq', 'neq', 'contains', 'gt', 'gte', 'lt', 'lte', 'is_blank', 'is_not_blank']);
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
const SUPPORTED_CROSS_FILTERS = new Set(['with', 'without']);
const SUPPORTED_CHART_TYPES = new Set([
  'bar', 'column', 'stacked_bar', 'stacked_column', 'line', 'area', 'stacked_area',
  'pie', 'donut', 'scatter', 'bubble', 'funnel', 'gauge', 'treemap', 'heatmap', 'combo'
]);

const FIELD_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)?$/;

function normalizeReportDefinition(input = {}) {
  const definition = input.definition || input;
  const reportType = definition.reportType || definition.report_type || 'tabular';
  if (!SUPPORTED_REPORT_TYPES.has(reportType)) {
    const error = new Error('Supported report types are tabular, summary, matrix, and joined.');
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

  if (reportType !== 'joined' && !fields.length && !groupBy.length) {
    const error = new Error('Select at least one report column.');
    error.statusCode = 400;
    throw error;
  }

  const normalized = {
    reportType,
    primaryObject,
    reportTypeId: String(definition.reportTypeId || definition.report_type_id || '').trim() || null,
    fields,
    groupBy,
    groupColumns: reportType === 'matrix' ? groupColumns : [],
    aggregates: reportType === 'summary' || reportType === 'matrix' ? aggregates : [],
    bucketFields: normalizeBucketFields(definition.bucketFields || definition.bucket_fields || []),
    rowFormulas: normalizeFormulas(definition.rowFormulas || definition.row_formulas || [], 5),
    summaryFormulas: normalizeFormulas(definition.summaryFormulas || definition.summary_formulas || [], 5),
    conditionalFormatting: normalizeConditionalFormatting(definition.conditionalFormatting || definition.conditional_formatting || []),
    crossFilters: normalizeCrossFilters(definition.crossFilters || definition.cross_filters || []),
    chart: normalizeChart(definition.chart || {}),
    filters: normalizeFilters(definition.filters || []),
    sort: normalizeSort(definition.sort || []),
    rowLimit: clampInt(definition.rowLimit || definition.row_limit || 200, 1, 2000)
  };

  if (reportType === 'joined') {
    normalized.blocks = normalizeJoinedBlocks(definition.blocks || [], primaryObject);
  }

  return normalized;
}

function normalizeJoinedBlocks(blocks, fallbackObject) {
  if (!Array.isArray(blocks)) return [];
  return blocks
    .map((block, index) => ({
      id: String(block.id || `block_${index + 1}`).replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 40),
      name: String(block.name || `Block ${index + 1}`).trim().slice(0, 80),
      definition: normalizeJoinedBlockDefinition(block.definition || block, fallbackObject)
    }))
    .filter((block) => block.definition.fields.length || block.definition.groupBy.length)
    .slice(0, 5);
}

function normalizeJoinedBlockDefinition(input, fallbackObject) {
  const reportType = ['summary', 'matrix'].includes(input.reportType) ? input.reportType : 'tabular';
  const fields = uniqueStrings(input.fields || []).filter(isValidFieldName).slice(0, 50);
  const groupBy = uniqueStrings(input.groupBy || []).filter(isValidFieldName).slice(0, 3);
  const groupColumns = uniqueStrings(input.groupColumns || []).filter(isValidFieldName).slice(0, 2);
  return {
    reportType,
    primaryObject: String(input.primaryObject || fallbackObject || '').trim(),
    reportTypeId: String(input.reportTypeId || '').trim() || null,
    fields,
    groupBy,
    groupColumns: reportType === 'matrix' ? groupColumns : [],
    aggregates: reportType === 'summary' || reportType === 'matrix' ? normalizeAggregates(input.aggregates || []) : [],
    bucketFields: normalizeBucketFields(input.bucketFields || []),
    rowFormulas: normalizeFormulas(input.rowFormulas || [], 5),
    summaryFormulas: normalizeFormulas(input.summaryFormulas || [], 5),
    conditionalFormatting: normalizeConditionalFormatting(input.conditionalFormatting || []),
    crossFilters: normalizeCrossFilters(input.crossFilters || []),
    chart: normalizeChart(input.chart || {}),
    filters: normalizeFilters(input.filters || []),
    sort: normalizeSort(input.sort || []),
    rowLimit: clampInt(input.rowLimit || 200, 1, 2000)
  };
}

function normalizeBucketFields(bucketFields) {
  if (!Array.isArray(bucketFields)) return [];
  return bucketFields
    .map((bucket, index) => {
      const sourceField = String(bucket.sourceField || bucket.source_field || '').trim();
      const fieldName = safeDerivedName(bucket.fieldName || bucket.field_name || bucket.name || `bucket_${sourceField || index + 1}`);
      const rules = normalizeBucketRules(bucket.rules || bucket.buckets || bucket.values || []);
      return {
        fieldName,
        label: String(bucket.label || titleCase(fieldName.replace(/_/g, ' '))).trim().slice(0, 80),
        sourceField,
        defaultLabel: String(bucket.defaultLabel || bucket.default_label || 'Other').trim().slice(0, 80),
        rules
      };
    })
    .filter((bucket) => isValidFieldName(bucket.sourceField) && bucket.rules.length)
    .slice(0, 10);
}

function normalizeBucketRules(rules) {
  if (!Array.isArray(rules)) return [];
  return rules
    .map((rule) => ({
      label: String(rule.label || 'Bucket').trim().slice(0, 80),
      operator: SUPPORTED_BUCKET_OPERATORS.has(rule.operator) ? rule.operator : 'eq',
      value: rule.value,
      values: Array.isArray(rule.values) ? rule.values.slice(0, 100) : [],
      min: rule.min ?? null,
      max: rule.max ?? null,
      valueTo: rule.valueTo ?? rule.value_to ?? null
    }))
    .slice(0, 50);
}

function normalizeFormulas(formulas, max) {
  if (!Array.isArray(formulas)) return [];
  return formulas
    .map((formula, index) => {
      const fieldName = safeDerivedName(formula.fieldName || formula.field_name || formula.name || `formula_${index + 1}`);
      return {
        fieldName,
        label: String(formula.label || titleCase(fieldName.replace(/_/g, ' '))).trim().slice(0, 80),
        formula: String(formula.formula || '').trim().slice(0, 500),
        format: ['number', 'currency', 'percent', 'text'].includes(formula.format) ? formula.format : 'number'
      };
    })
    .filter((formula) => formula.formula)
    .slice(0, max);
}

function normalizeConditionalFormatting(rules) {
  if (!Array.isArray(rules)) return [];
  return rules
    .map((rule) => ({
      field: String(rule.field || '').trim(),
      operator: SUPPORTED_HIGHLIGHT_OPERATORS.has(rule.operator) ? rule.operator : 'eq',
      value: rule.value,
      style: ['green', 'yellow', 'red', 'blue'].includes(rule.style) ? rule.style : 'yellow'
    }))
    .filter((rule) => rule.field && (isValidFieldName(rule.field) || isDerivedFieldName(rule.field)))
    .slice(0, 20);
}

function normalizeChart(chart) {
  const enabled = Boolean(chart.enabled);
  const type = SUPPORTED_CHART_TYPES.has(chart.type) ? chart.type : 'bar';
  const labelField = String(chart.labelField || '').trim();
  const valueField = String(chart.valueField || '').trim();
  return {
    enabled,
    type,
    title: String(chart.title || '').trim().slice(0, 120),
    subtitle: String(chart.subtitle || '').trim().slice(0, 160),
    legendPosition: ['right', 'bottom', 'left', 'top', 'none'].includes(chart.legendPosition) ? chart.legendPosition : 'right',
    xAxisLabel: String(chart.xAxisLabel || '').trim().slice(0, 80),
    yAxisLabel: String(chart.yAxisLabel || '').trim().slice(0, 80),
    sortOrder: ['asc', 'desc', 'none'].includes(chart.sortOrder) ? chart.sortOrder : 'none',
    colors: Array.isArray(chart.colors) ? chart.colors.slice(0, 12).map((color) => String(color).trim()).filter(Boolean) : [],
    showDataLabels: chart.showDataLabels !== false,
    nullHandling: ['zero', 'hide', 'blank'].includes(chart.nullHandling) ? chart.nullHandling : 'blank',
    stacked: Boolean(chart.stacked),
    labelField: isValidFieldName(labelField) || labelField === '__count' ? labelField : '',
    valueField: isValidFieldName(valueField) || valueField === '__count' ? valueField : ''
  };
}

function normalizeCrossFilters(crossFilters) {
  if (!Array.isArray(crossFilters)) return [];
  return crossFilters
    .map((filter, index) => ({
      id: String(filter.id || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40) || `cf_${index + 1}`,
      type: SUPPORTED_CROSS_FILTERS.has(filter.type) ? filter.type : 'with',
      parentObject: String(filter.parentObject || filter.parent_object || '').trim(),
      childObject: String(filter.childObject || filter.child_object || '').trim(),
      parentField: String(filter.parentField || filter.parent_field || '').trim(),
      label: String(filter.label || '').trim().slice(0, 120),
      subfilters: normalizeFilters(filter.subfilters || filter.subFilters || []).slice(0, 10)
    }))
    .filter((filter) => filter.childObject && filter.parentField)
    .slice(0, 8);
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

function isDerivedFieldName(field) {
  return /^[_A-Za-z][_A-Za-z0-9]*$/.test(String(field || ''));
}

function safeDerivedName(value) {
  const normalized = String(value || '')
    .replace(/[^A-Za-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 50);
  return /^[A-Za-z_]/.test(normalized) ? normalized : `field_${normalized || 'value'}`;
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
