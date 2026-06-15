const { buildTabularSOQL, reportSourceFields } = require('./report-query-builder');
const reportCache = require('./report-cache');

async function runTabularReport(report, user, deps, options = {}) {
  const definition = report.definition || report;
  const requestStartedAt = Date.now();

  if (!deps.objects[definition.primaryObject]) {
    const error = new Error(`Unknown object: ${definition.primaryObject}`);
    error.statusCode = 400;
    throw error;
  }

  const objectPerms = await deps.getEffectivePermissions(user.id, definition.primaryObject);
  if (!user.isSystemAdmin && !objectPerms?.can_read) {
    const error = new Error(deps.permissionDeniedMessage());
    error.statusCode = 403;
    throw error;
  }

  const availableFields = await deps.getObjectFieldSet(definition.primaryObject);
  const fieldPerms = await deps.getEffectiveFieldPerms(
    user.id,
    definition.primaryObject,
    user.role,
    user.isSystemAdmin
  );

  const hiddenFields = fieldPerms?.hiddenFields || new Set();
  const readonlyFields = fieldPerms?.readonlyFields || new Set();
  const cacheKey = reportCache.cacheKey({
    reportId: report.id || 'unsaved',
    updatedAt: report.updated_at || '',
    userId: user.id,
    userRole: user.role || '',
    isSystemAdmin: Boolean(user.isSystemAdmin),
    objectPerms,
    hiddenFields: [...hiddenFields].sort(),
    readonlyFields: [...readonlyFields].sort(),
    definition,
    exportMode: Boolean(options.exportMode),
    previewMode: Boolean(options.previewMode)
  });

  if (!options.skipCache) {
    const cached = reportCache.get(cacheKey);
    if (cached) return { ...cached, cached: true };
  }

  const sourceFields = reportSourceFields(definition);
  const allowedFields = sourceFields.filter((field) => !hiddenFields.has(field));
  const allowedGroupBy = (definition.groupBy || []).filter((field) => !hiddenFields.has(field));
  const allowedGroupColumns = (definition.groupColumns || []).filter((field) => !hiddenFields.has(field));
  const allowedAggregates = (definition.aggregates || [])
    .filter((aggregate) => !aggregate.field || !hiddenFields.has(aggregate.field));

  if ((definition.reportType === 'summary' || definition.reportType === 'matrix') && !allowedGroupBy.length) {
    const error = new Error('The selected grouping field is hidden by field-level security.');
    error.statusCode = 403;
    throw error;
  }

  if (definition.reportType === 'matrix' && !allowedGroupColumns.length) {
    const error = new Error('The selected matrix column grouping field is hidden by field-level security.');
    error.statusCode = 403;
    throw error;
  }

  if (!allowedFields.length) {
    const error = new Error('All selected fields are hidden by field-level security.');
    error.statusCode = 403;
    throw error;
  }

  const scopedDefinition = {
    ...definition,
    fields: allowedFields,
    groupBy: allowedGroupBy,
    groupColumns: allowedGroupColumns,
    aggregates: allowedAggregates,
    rowLimit: options.previewMode
      ? Math.min(Number(definition.rowLimit || 20), 20)
      : definition.rowLimit
  };
  const scope = await deps.buildReadableRecordScopeFilter(
    definition.primaryObject,
    user,
    `report-${report.id || 'unsaved'}`
  );
  const { soql, selectedFields } = buildTabularSOQL(
    scopedDefinition,
    availableFields,
    deps.escapeSOQL,
    scope.clause
  );

  const sfStartedAt = Date.now();
  const data = await deps.sfGet('/query', { q: soql }, { headers: deps.queryBatchHeaders || {} });
  const sfMs = Date.now() - sfStartedAt;

  const ownedRecords = await deps.hydrateRecordOwners(data.records || [], definition.primaryObject);
  const visibleRecords = await deps.applyRecordVisibility(
    ownedRecords,
    user.id,
    user.role,
    definition.primaryObject,
    user.isSystemAdmin,
    `report-${report.id || 'unsaved'}`
  );

  const rows = visibleRecords.map((record) => deps.applyFieldSecurity(record, fieldPerms));
  const detailColumns = selectedFields
    .filter((field) => field !== 'Id' && !hiddenFields.has(field))
    .map((field) => ({
      field,
      label: fieldToLabel(field),
      readonly: readonlyFields.has(field)
    }));

  const result = definition.reportType === 'matrix'
    ? buildMatrixResult(report, scopedDefinition, rows, data, soql, sfMs, requestStartedAt, options)
    : definition.reportType === 'summary'
      ? buildSummaryResult(report, scopedDefinition, rows, data, soql, sfMs, requestStartedAt, options)
      : {
    reportId: report.id || null,
    reportName: report.name || 'Unsaved Report',
    reportType: 'tabular',
    primaryObject: definition.primaryObject,
    columns: detailColumns,
    rows,
    totalSize: rows.length,
    salesforceTotalSize: data.totalSize || 0,
    done: Boolean(data.done),
    soql,
    cached: false,
    timings: {
      salesforceMs: sfMs,
      totalMs: Date.now() - requestStartedAt
    }
  };

  reportCache.set(cacheKey, result);
  return result;
}

function buildMatrixResult(report, definition, sourceRows, sfData, soql, sfMs, requestStartedAt, options = {}) {
  const rowFields = definition.groupBy || [];
  const columnFields = definition.groupColumns || [];
  const aggregates = definition.aggregates?.length
    ? definition.aggregates
    : [{ function: 'count', field: '', label: 'Record Count' }];
  const primaryAggregate = aggregates[0] || { function: 'count', field: '', label: 'Record Count' };

  const rowMap = new Map();
  const columnMap = new Map();
  const cellMap = new Map();

  sourceRows.forEach((row) => {
    const rowKeys = rowFields.map((field) => displayValue(readPath(row, field)));
    const columnKeys = columnFields.map((field) => displayValue(readPath(row, field)));
    const rowKey = JSON.stringify(rowKeys);
    const columnKey = JSON.stringify(columnKeys);

    if (!rowMap.has(rowKey)) rowMap.set(rowKey, { key: rowKey, keys: rowKeys, rows: [] });
    if (!columnMap.has(columnKey)) columnMap.set(columnKey, { key: columnKey, keys: columnKeys, rows: [] });
    rowMap.get(rowKey).rows.push(row);
    columnMap.get(columnKey).rows.push(row);

    const cellKey = `${rowKey}::${columnKey}`;
    if (!cellMap.has(cellKey)) cellMap.set(cellKey, []);
    cellMap.get(cellKey).push(row);
  });

  const rowGroups = [...rowMap.values()].sort(compareGroupKeys);
  const columnGroups = [...columnMap.values()].sort(compareGroupKeys);
  const aggregateField = aggregateKey(primaryAggregate);
  const columns = [
    ...rowFields.map((field, index) => ({
      field: `row_group_${index + 1}`,
      sourceField: field,
      label: fieldToLabel(field),
      group: true
    })),
    ...columnGroups.map((group, index) => ({
      field: `matrix_col_${index}`,
      matrixColumnKey: group.key,
      label: group.keys.join(' / ') || '(Blank)',
      aggregate: true
    })),
    {
      field: 'row_total',
      label: 'Row Total',
      aggregate: true,
      total: true
    }
  ];

  const rows = rowGroups.map((rowGroup) => {
    const output = {};
    rowGroup.keys.forEach((value, index) => {
      output[`row_group_${index + 1}`] = value;
    });
    columnGroups.forEach((columnGroup, index) => {
      output[`matrix_col_${index}`] = calculateAggregate(
        cellMap.get(`${rowGroup.key}::${columnGroup.key}`) || [],
        primaryAggregate
      );
    });
    output.row_total = calculateAggregate(rowGroup.rows, primaryAggregate);
    return output;
  });

  const columnTotals = {};
  columnGroups.forEach((columnGroup, index) => {
    columnTotals[`matrix_col_${index}`] = calculateAggregate(columnGroup.rows, primaryAggregate);
  });
  columnTotals.row_total = calculateAggregate(sourceRows, primaryAggregate);

  return {
    reportId: report.id || null,
    reportName: report.name || 'Unsaved Report',
    reportType: 'matrix',
    primaryObject: definition.primaryObject,
    rowGroupBy: rowFields,
    columnGroupBy: columnFields,
    aggregates,
    primaryAggregate,
    aggregateField,
    columns,
    rows,
    rowGroups: rowGroups.map((group) => ({ keys: group.keys, count: group.rows.length })),
    columnGroups: columnGroups.map((group) => ({ keys: group.keys, count: group.rows.length })),
    columnTotals,
    grandTotals: { [aggregateField]: calculateAggregate(sourceRows, primaryAggregate) },
    sourceRowCount: sourceRows.length,
    totalSize: rows.length,
    salesforceTotalSize: sfData.totalSize || 0,
    done: Boolean(sfData.done),
    soql,
    cached: false,
    timings: {
      salesforceMs: sfMs,
      totalMs: Date.now() - requestStartedAt
    }
  };
}

function buildSummaryResult(report, definition, sourceRows, sfData, soql, sfMs, requestStartedAt, options = {}) {
  const groupFields = definition.groupBy || [];
  const aggregates = definition.aggregates?.length
    ? definition.aggregates
    : [{ function: 'count', field: '', label: 'Record Count' }];

  const grouped = new Map();
  sourceRows.forEach((row) => {
    const keyParts = groupFields.map((field) => displayValue(readPath(row, field)));
    const key = JSON.stringify(keyParts);
    if (!grouped.has(key)) {
      grouped.set(key, {
        keys: keyParts,
        rows: []
      });
    }
    grouped.get(key).rows.push(row);
  });

  const aggregateColumns = aggregates.map((aggregate) => ({
    field: aggregateKey(aggregate),
    label: aggregate.label || aggregateLabel(aggregate),
    aggregate: true
  }));
  const columns = [
    ...groupFields.map((field, index) => ({
      field: `group_${index + 1}`,
      sourceField: field,
      label: fieldToLabel(field),
      group: true
    })),
    ...aggregateColumns
  ];

  const rows = [...grouped.values()]
    .map((group) => {
      const row = {};
      group.keys.forEach((value, index) => {
        row[`group_${index + 1}`] = value;
      });
      aggregates.forEach((aggregate) => {
        row[aggregateKey(aggregate)] = calculateAggregate(group.rows, aggregate);
      });
      return row;
    })
    .sort((a, b) => groupFields.map((_, index) => String(a[`group_${index + 1}`] || ''))
      .join('|')
      .localeCompare(groupFields.map((_, index) => String(b[`group_${index + 1}`] || '')).join('|')));

  return {
    reportId: report.id || null,
    reportName: report.name || 'Unsaved Report',
    reportType: 'summary',
    primaryObject: definition.primaryObject,
    groupBy: groupFields,
    aggregates,
    columns,
    rows,
    groups: [...grouped.values()].map((group) => ({
      keys: group.keys,
      count: group.rows.length,
      rows: options.previewMode ? group.rows.slice(0, 20) : group.rows
    })),
    detailColumns: (definition.fields || [])
      .filter((field) => !groupFields.includes(field))
      .map((field) => ({ field, label: fieldToLabel(field) })),
    grandTotals: aggregateTotals(sourceRows, aggregates),
    sourceRowCount: sourceRows.length,
    totalSize: rows.length,
    salesforceTotalSize: sfData.totalSize || 0,
    done: Boolean(sfData.done),
    soql,
    cached: false,
    timings: {
      salesforceMs: sfMs,
      totalMs: Date.now() - requestStartedAt
    }
  };
}

function aggregateTotals(rows, aggregates) {
  const totals = {};
  (aggregates || []).forEach((aggregate) => {
    totals[aggregateKey(aggregate)] = calculateAggregate(rows, aggregate);
  });
  return totals;
}

function calculateAggregate(rows, aggregate) {
  const fn = aggregate.function || 'count';
  if (fn === 'count') return rows.length;

  const values = rows
    .map((row) => readPath(row, aggregate.field))
    .filter((value) => value !== null && value !== undefined && value !== '');

  if (fn === 'distinct_count') return new Set(values.map((value) => String(value))).size;

  const numbers = values
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value));

  if (!numbers.length) return 0;
  if (fn === 'sum') return roundNumber(numbers.reduce((sum, value) => sum + value, 0));
  if (fn === 'avg') return roundNumber(numbers.reduce((sum, value) => sum + value, 0) / numbers.length);
  if (fn === 'min') return Math.min(...numbers);
  if (fn === 'max') return Math.max(...numbers);
  return rows.length;
}

function aggregateKey(aggregate) {
  return `agg_${aggregate.function || 'count'}_${aggregate.field || 'records'}`.replace(/[^A-Za-z0-9_]/g, '_');
}

function aggregateLabel(aggregate) {
  if ((aggregate.function || 'count') === 'count') return 'Record Count';
  return `${String(aggregate.function || '').replace('_', ' ').toUpperCase()} ${fieldToLabel(aggregate.field)}`;
}

function compareGroupKeys(a, b) {
  return (a.keys || []).join('|').localeCompare((b.keys || []).join('|'));
}

function readPath(row, path) {
  return String(path || '').split('.').reduce((value, key) => value?.[key], row);
}

function displayValue(value) {
  if (value && typeof value === 'object') return value.Name || value.Id || JSON.stringify(value);
  if (value === null || value === undefined || value === '') return '(Blank)';
  return value;
}

function roundNumber(value) {
  return Math.round(value * 100) / 100;
}

function fieldToLabel(field) {
  return String(field || '')
    .split('.')
    .map((part) => part.replace(/__c$/, '').replace(/_/g, ' '))
    .join(' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

module.exports = {
  runTabularReport
};
