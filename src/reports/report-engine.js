const { buildTabularSOQL, reportSourceFields } = require('./report-query-builder');
const reportCache = require('../cache/report-cache');

async function runTabularReport(report, user, deps, options = {}) {
  const definition = report.definition || report;
  const requestStartedAt = Date.now();

  if (definition.reportType === 'joined') {
    return runJoinedReport(report, user, deps, options);
  }

  if (definition.reportTypeDefinition?.relationships?.length) {
    return runCrossObjectReport(report, user, deps, options);
  }

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
  const displayFields = (definition.fields || []).filter((field) => !hiddenFields.has(field));
  const allowedGroupBy = (definition.groupBy || []).filter((field) => !hiddenFields.has(field));
  const allowedGroupColumns = (definition.groupColumns || []).filter((field) => !hiddenFields.has(field));
  let allowedAggregates = (definition.aggregates || [])
    .filter((aggregate) => !aggregate.field || !hiddenFields.has(aggregate.field));
  const allowedBucketFields = (definition.bucketFields || [])
    .filter((bucket) => bucket.sourceField && !hiddenFields.has(bucket.sourceField));
  const allowedRowFormulas = (definition.rowFormulas || [])
    .filter((formula) => formulaFields(formula.formula).every((field) => !hiddenFields.has(field)));
  const allowedSummaryFormulas = (definition.summaryFormulas || [])
    .filter((formula) => formulaFields(formula.formula).every((field) => !hiddenFields.has(field)));
  allowedAggregates = mergeAggregates(allowedAggregates, aggregateRefsFromFormulas(allowedSummaryFormulas));
  const allowedConditionalFormatting = (definition.conditionalFormatting || [])
    .filter((rule) => !rule.field || !hiddenFields.has(rule.field));

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
    displayFields,
    groupBy: allowedGroupBy,
    groupColumns: allowedGroupColumns,
    aggregates: allowedAggregates,
    bucketFields: allowedBucketFields,
    rowFormulas: allowedRowFormulas,
    summaryFormulas: allowedSummaryFormulas,
    conditionalFormatting: allowedConditionalFormatting,
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

  const crossFilteredRecords = await applyCrossFilters(
    visibleRecords,
    definition.primaryObject,
    definition,
    user,
    deps,
    `report-${report.id || 'unsaved'}`
  );

  const rows = crossFilteredRecords.map((record) => applyDerivedFields(
    deps.applyFieldSecurity(record, fieldPerms),
    scopedDefinition
  ));
  const detailColumns = displayFields
    .filter((field) => field !== 'Id' && !hiddenFields.has(field))
    .map((field) => ({
      field,
      label: fieldToLabel(field),
      readonly: readonlyFields.has(field)
    }))
    .concat((scopedDefinition.bucketFields || []).map((bucket) => ({
      field: bucket.fieldName,
      label: bucket.label,
      bucket: true
    })))
    .concat((scopedDefinition.rowFormulas || []).map((formula) => ({
      field: formula.fieldName,
      label: formula.label,
      formula: true
    })));

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
    rows: applyConditionalFormatting(rows, detailColumns, scopedDefinition),
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

async function runJoinedReport(report, user, deps, options = {}) {
  const definition = report.definition || report;
  const blocks = Array.isArray(definition.blocks) ? definition.blocks.slice(0, 5) : [];
  if (!blocks.length) {
    const error = new Error('Joined reports require at least one report block.');
    error.statusCode = 400;
    throw error;
  }

  const startedAt = Date.now();
  const renderedBlocks = [];
  for (const [index, block] of blocks.entries()) {
    const blockDefinition = {
      ...block.definition,
      reportType: block.definition?.reportType === 'joined' ? 'tabular' : (block.definition?.reportType || 'tabular')
    };
    renderedBlocks.push({
      id: block.id || `block_${index + 1}`,
      name: block.name || `Block ${index + 1}`,
      result: await runTabularReport(
        { id: `${report.id || 'unsaved'}:${index}`, name: block.name || `Block ${index + 1}`, definition: blockDefinition },
        user,
        deps,
        { ...options, skipCache: options.skipCache }
      )
    });
  }

  return {
    reportId: report.id || null,
    reportName: report.name || 'Unsaved Joined Report',
    reportType: 'joined',
    primaryObject: definition.primaryObject,
    blocks: renderedBlocks,
    columns: [],
    rows: [],
    totalSize: renderedBlocks.reduce((sum, block) => sum + Number(block.result?.totalSize || 0), 0),
    cached: false,
    timings: { totalMs: Date.now() - startedAt }
  };
}

async function runCrossObjectReport(report, user, deps, options = {}) {
  const definition = report.definition || report;
  const requestStartedAt = Date.now();
  const reportTypeDefinition = definition.reportTypeDefinition || {};
  const objects = Array.isArray(reportTypeDefinition.objects) ? reportTypeDefinition.objects : [];
  const relationships = Array.isArray(reportTypeDefinition.relationships) ? reportTypeDefinition.relationships : [];
  const primaryAlias = objects.find((item) => item.relationship === 'primary')?.alias || definition.primaryObject;
  const primaryObject = reportTypeDefinition.primaryObject || definition.primaryObject;
  const relationship = relationships[0];

  if (!primaryObject || !relationship) {
    const error = new Error('Cross-object report type is not configured correctly.');
    error.statusCode = 400;
    throw error;
  }

  const childMeta = objects.find((item) => item.alias === relationship.childAlias);
  if (!childMeta) {
    const error = new Error('Cross-object child object is missing from the report type.');
    error.statusCode = 400;
    throw error;
  }

  const security = {};
  for (const objectMeta of objects) {
    if (!deps.objects[objectMeta.object]) {
      const error = new Error(`Unknown object: ${objectMeta.object}`);
      error.statusCode = 400;
      throw error;
    }
    const objectPerms = await deps.getEffectivePermissions(user.id, objectMeta.object);
    if (!user.isSystemAdmin && !objectPerms?.can_read) {
      const error = new Error(deps.permissionDeniedMessage());
      error.statusCode = 403;
      throw error;
    }
    security[objectMeta.alias] = {
      objectName: objectMeta.object,
      objectPerms,
      fields: await deps.getObjectFieldSet(objectMeta.object),
      fieldPerms: await deps.getEffectiveFieldPerms(user.id, objectMeta.object, user.role, user.isSystemAdmin)
    };
  }

  const hiddenByAlias = new Map(Object.entries(security).map(([alias, item]) => [
    alias,
    item.fieldPerms?.hiddenFields || new Set()
  ]));

  const scopedDefinition = filterCrossObjectDefinition(definition, objects, hiddenByAlias, options);
  if (!scopedDefinition.fields.length && !scopedDefinition.groupBy.length) {
    const error = new Error('All selected fields are hidden by field-level security.');
    error.statusCode = 403;
    throw error;
  }

  const cacheKey = reportCache.cacheKey({
    reportId: report.id || 'unsaved-cross',
    updatedAt: report.updated_at || '',
    userId: user.id,
    userRole: user.role || '',
    isSystemAdmin: Boolean(user.isSystemAdmin),
    definition: scopedDefinition,
    exportMode: Boolean(options.exportMode),
    previewMode: Boolean(options.previewMode)
  });
  if (!options.skipCache) {
    const cached = reportCache.get(cacheKey);
    if (cached) return { ...cached, cached: true };
  }

  const selectedByAlias = fieldsByAlias(reportSourceFields(scopedDefinition), objects);
  const parentFields = ensureFields(selectedByAlias.get(primaryAlias), ['Id']);
  const childFields = ensureFields(selectedByAlias.get(relationship.childAlias), ['Id', relationship.parentField]);

  const parentScope = await deps.buildReadableRecordScopeFilter(primaryObject, user, `report-cross-${report.id || 'unsaved'}-parent`);
  const parentLimit = options.previewMode ? 20 : Math.min(Number(scopedDefinition.rowLimit || 200), 2000);
  const parentSoql = [
    `SELECT ${parentFields.filter((field) => security[primaryAlias].fields.has(field)).join(', ')}`,
    `FROM ${primaryObject}`,
    parentScope.clause ? `WHERE ${parentScope.clause}` : '',
    `LIMIT ${parentLimit}`
  ].filter(Boolean).join(' ');

  const sfStartedAt = Date.now();
  const parentData = await deps.sfGet('/query', { q: parentSoql }, { headers: deps.queryBatchHeaders || {} });
  const parentOwned = await deps.hydrateRecordOwners(parentData.records || [], primaryObject);
  const parentVisible = await deps.applyRecordVisibility(
    parentOwned,
    user.id,
    user.role,
    primaryObject,
    user.isSystemAdmin,
    `report-cross-${report.id || 'unsaved'}-parent`
  );

  const parentIds = parentVisible.map((record) => record.Id).filter(Boolean);
  let childVisible = [];
  let childSoql = '';
  if (parentIds.length) {
    const childObject = childMeta.object;
    const childScope = await deps.buildReadableRecordScopeFilter(childObject, user, `report-cross-${report.id || 'unsaved'}-child`);
    const parentIdList = parentIds.map((id) => `'${deps.escapeSOQL(id)}'`).join(', ');
    const where = [`${relationship.parentField} IN (${parentIdList})`];
    if (childScope.clause) where.push(childScope.clause);
    childSoql = [
      `SELECT ${childFields.filter((field) => security[relationship.childAlias].fields.has(field)).join(', ')}`,
      `FROM ${childObject}`,
      `WHERE ${where.join(' AND ')}`,
      `LIMIT ${options.previewMode ? 100 : 2000}`
    ].join(' ');
    const childData = await deps.sfGet('/query', { q: childSoql }, { headers: deps.queryBatchHeaders || {} });
    const childOwned = await deps.hydrateRecordOwners(childData.records || [], childObject);
    childVisible = await deps.applyRecordVisibility(
      childOwned,
      user.id,
      user.role,
      childObject,
      user.isSystemAdmin,
      `report-cross-${report.id || 'unsaved'}-child`
    );
  }
  const sfMs = Date.now() - sfStartedAt;

  const childByParent = new Map();
  childVisible.forEach((record) => {
    const parentId = record[relationship.parentField];
    if (!childByParent.has(parentId)) childByParent.set(parentId, []);
    childByParent.get(parentId).push(record);
  });

  const rows = [];
  parentVisible.forEach((parent) => {
    const cleanParent = deps.applyFieldSecurity(parent, security[primaryAlias].fieldPerms);
    const children = childByParent.get(parent.Id) || [null];
    children.forEach((child) => {
      const row = prefixRecord(primaryAlias, cleanParent);
      if (child) Object.assign(row, prefixRecord(relationship.childAlias, deps.applyFieldSecurity(child, security[relationship.childAlias].fieldPerms)));
      rows.push(applyDerivedFields(row, scopedDefinition));
    });
  });

  const crossFilteredRows = await applyCrossFilters(
    rows,
    primaryObject,
    scopedDefinition,
    user,
    deps,
    `report-cross-${report.id || 'unsaved'}`,
    { parentAlias: primaryAlias }
  );
  const filteredRows = applyReportFilters(crossFilteredRows, scopedDefinition.filters || []);
  const sfData = {
    totalSize: parentData.totalSize || parentVisible.length,
    done: Boolean(parentData.done),
    records: parentData.records || []
  };
  const detailColumns = buildCrossColumns(scopedDefinition, objects, hiddenByAlias);
  const result = scopedDefinition.reportType === 'matrix'
    ? buildMatrixResult(report, scopedDefinition, filteredRows, sfData, `${parentSoql}; ${childSoql}`.trim(), sfMs, requestStartedAt, options)
    : scopedDefinition.reportType === 'summary'
      ? buildSummaryResult(report, scopedDefinition, filteredRows, sfData, `${parentSoql}; ${childSoql}`.trim(), sfMs, requestStartedAt, options)
      : {
        reportId: report.id || null,
        reportName: report.name || 'Unsaved Cross Object Report',
        reportType: 'tabular',
        primaryObject,
        reportTypeId: definition.reportTypeId || null,
        columns: detailColumns,
        rows: applyConditionalFormatting(filteredRows, detailColumns, scopedDefinition),
        totalSize: filteredRows.length,
        salesforceTotalSize: sfData.totalSize,
        done: sfData.done,
        soql: `${parentSoql}; ${childSoql}`.trim(),
        cached: false,
        timings: { salesforceMs: sfMs, totalMs: Date.now() - requestStartedAt }
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
  const summaryFormulaColumns = (definition.summaryFormulas || []).map((formula) => ({
    field: formula.fieldName,
    label: formula.label,
    aggregate: true,
    formula: true
  }));
  const columns = [
    ...rowFields.map((field, index) => ({
      field: `row_group_${index + 1}`,
      sourceField: field,
      label: reportFieldLabel(definition, field),
      group: true
    })),
    ...columnGroups.map((group, index) => ({
      field: `matrix_col_${index}`,
      matrixColumnKey: group.key,
      label: group.keys.join(' / ') || '(Blank)',
      sourceField: primaryAggregate.field || '',
      aggregate: true
    })),
    {
      field: 'row_total',
      label: 'Row Total',
      sourceField: primaryAggregate.field || '',
      aggregate: true,
      total: true
    },
    ...summaryFormulaColumns
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
    applySummaryFormulasToRow(output, definition.summaryFormulas || []);
    return output;
  });

  const columnTotals = {};
  columnGroups.forEach((columnGroup, index) => {
    columnTotals[`matrix_col_${index}`] = calculateAggregate(columnGroup.rows, primaryAggregate);
  });
  columnTotals.row_total = calculateAggregate(sourceRows, primaryAggregate);
  applySummaryFormulasToRow(columnTotals, definition.summaryFormulas || []);

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
    rows: applyConditionalFormatting(rows, columns, definition),
    rowGroups: rowGroups.map((group) => ({ keys: group.keys, count: group.rows.length })),
    columnGroups: columnGroups.map((group) => ({ keys: group.keys, count: group.rows.length })),
    columnTotals,
    grandTotals: applySummaryFormulasToRow(
      { [aggregateField]: calculateAggregate(sourceRows, primaryAggregate), row_total: calculateAggregate(sourceRows, primaryAggregate) },
      definition.summaryFormulas || []
    ),
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
    label: aggregate.label || aggregateLabel(aggregate, definition),
    sourceField: aggregate.field || '',
    aggregate: true
  })).concat((definition.summaryFormulas || []).map((formula) => ({
    field: formula.fieldName,
    label: formula.label,
    aggregate: true,
    formula: true
  })));
  const columns = [
    ...groupFields.map((field, index) => ({
      field: `group_${index + 1}`,
      sourceField: field,
      label: reportFieldLabel(definition, field),
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
      applySummaryFormulasToRow(row, definition.summaryFormulas || []);
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
    rows: applyConditionalFormatting(rows, columns, definition),
    groups: [...grouped.values()].map((group) => ({
      keys: group.keys,
      count: group.rows.length,
      rows: options.previewMode ? group.rows.slice(0, 20) : group.rows
    })),
    detailColumns: (definition.displayFields || definition.fields || [])
      .filter((field) => !groupFields.includes(field))
      .map((field) => ({ field, label: reportFieldLabel(definition, field) })),
    grandTotals: applySummaryFormulasToRow(aggregateTotals(sourceRows, aggregates), definition.summaryFormulas || []),
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

function mergeAggregates(aggregates, extraAggregates) {
  const byKey = new Map();
  (aggregates || []).concat(extraAggregates || []).forEach((aggregate) => {
    byKey.set(aggregateKey(aggregate), aggregate);
  });
  return [...byKey.values()];
}

function aggregateRefsFromFormulas(formulas) {
  const refs = [];
  (formulas || []).forEach((formula) => {
    const expression = normalizeSummaryFormulaExpression(formula.formula);
    [...String(expression || '').matchAll(/\{agg_(count|sum|avg|min|max|distinct_count)_([^}]+)\}/g)]
      .forEach((match) => {
        const fn = match[1];
        const field = match[2] === 'records' ? '' : match[2];
        refs.push({ function: fn, field, label: aggregateLabel({ function: fn, field }) });
      });
  });
  return refs;
}

function applyDerivedFields(row, definition) {
  const output = { ...row };
  (definition.bucketFields || []).forEach((bucket) => {
    output[bucket.fieldName] = bucketValue(readPath(output, bucket.sourceField), bucket);
  });
  (definition.rowFormulas || []).forEach((formula) => {
    output[formula.fieldName] = evaluateFormula(formula.formula, output);
  });
  return output;
}

function bucketValue(value, bucket) {
  const rules = bucket.rules || [];
  const matched = rules.find((rule) => bucketRuleMatches(value, rule));
  return matched?.label || bucket.defaultLabel || 'Other';
}

function bucketRuleMatches(value, rule) {
  const text = String(value ?? '');
  const ruleValue = String(rule.value ?? '');
  const values = Array.isArray(rule.values) ? rule.values.map((item) => String(item)) : [];
  if (rule.operator === 'is_blank') return text === '';
  if (rule.operator === 'neq') return text !== ruleValue;
  if (rule.operator === 'contains') return text.toLowerCase().includes(ruleValue.toLowerCase());
  if (rule.operator === 'starts_with') return text.toLowerCase().startsWith(ruleValue.toLowerCase());
  if (rule.operator === 'between') {
    const number = Number(value);
    return Number.isFinite(number) && number >= Number(rule.min) && number <= Number(rule.max);
  }
  if (['gt', 'gte', 'lt', 'lte'].includes(rule.operator)) {
    const left = Number(value);
    const right = Number(rule.value);
    if (!Number.isFinite(left) || !Number.isFinite(right)) return false;
    if (rule.operator === 'gt') return left > right;
    if (rule.operator === 'gte') return left >= right;
    if (rule.operator === 'lt') return left < right;
    if (rule.operator === 'lte') return left <= right;
  }
  if (values.length) return values.includes(text);
  return text === ruleValue;
}

function applySummaryFormulasToRow(row, formulas) {
  (formulas || []).forEach((formula) => {
    row[formula.fieldName] = evaluateFormula(normalizeSummaryFormulaExpression(formula.formula), row);
  });
  return row;
}

function normalizeSummaryFormulaExpression(expression) {
  return String(expression || '')
    .replace(/\bCOUNT\s*\(\s*Id\s*\)/gi, '{agg_count_records}')
    .replace(/\b(SUM|AVG|MIN|MAX)\s*\(\s*([A-Za-z_][A-Za-z0-9_.]*)\s*\)/gi, (_, fn, field) => `{${aggregateKey({ function: fn.toLowerCase(), field })}}`);
}

function evaluateFormula(formula, context) {
  const expression = String(formula || '').replace(/\{([^}]+)\}/g, (_, token) => {
    const raw = readPath(context, String(token || '').trim());
    const number = Number(raw);
    return Number.isFinite(number) ? String(number) : '0';
  });
  if (!/^[0-9+\-*/().\s]+$/.test(expression)) return null;
  try {
    const value = Function(`"use strict"; return (${expression});`)();
    return Number.isFinite(value) ? roundNumber(value) : null;
  } catch (err) {
    return null;
  }
}

function formulaFields(formula) {
  const tokenFields = [...String(formula || '').matchAll(/\{([^}]+)\}/g)]
    .map((match) => String(match[1] || '').trim())
    .filter((field) => field && !/^(__count|agg_|bucket_|row_|summary_|matrix_col_|row_group_|group_)/i.test(field));
  const aggregateFields = [...String(formula || '').matchAll(/\b(?:SUM|AVG|MIN|MAX)\s*\(\s*([A-Za-z_][A-Za-z0-9_.]*)\s*\)/gi)]
    .map((match) => String(match[1] || '').trim())
    .filter(Boolean);
  return [...new Set(tokenFields.concat(aggregateFields))];
}

function filterCrossObjectDefinition(definition, objects, hiddenByAlias, options = {}) {
  const keepField = (field) => {
    const parsed = parseAliasField(field, objects, definition.primaryObject);
    if (!parsed) return false;
    return !(hiddenByAlias.get(parsed.alias) || new Set()).has(parsed.field);
  };
  const bucketFields = (definition.bucketFields || []).filter((bucket) => keepField(bucket.sourceField));
  const rowFormulas = (definition.rowFormulas || [])
    .filter((formula) => formulaFields(formula.formula).every(keepField));
  const summaryFormulas = (definition.summaryFormulas || [])
    .filter((formula) => formulaFields(formula.formula).every(keepField));
  return {
    ...definition,
    fields: (definition.fields || []).filter(keepField),
    displayFields: (definition.fields || []).filter(keepField),
    groupBy: (definition.groupBy || []).filter(keepField),
    groupColumns: (definition.groupColumns || []).filter(keepField),
    aggregates: (definition.aggregates || []).filter((aggregate) => !aggregate.field || keepField(aggregate.field)),
    bucketFields,
    rowFormulas,
    summaryFormulas,
    conditionalFormatting: (definition.conditionalFormatting || []).filter((rule) => !rule.field || keepField(rule.field) || isDerivedFieldName(rule.field)),
    rowLimit: options.previewMode ? Math.min(Number(definition.rowLimit || 20), 20) : definition.rowLimit
  };
}

function fieldsByAlias(fields, objects) {
  const aliases = new Set(objects.map((item) => item.alias));
  const byAlias = new Map(objects.map((item) => [item.alias, new Set()]));
  (fields || []).forEach((field) => {
    const [first, ...rest] = String(field || '').split('.');
    if (aliases.has(first) && rest.length) {
      byAlias.get(first).add(rest.join('.'));
    }
  });
  return byAlias;
}

function parseAliasField(field, objects, fallbackObject) {
  const aliases = new Set(objects.map((item) => item.alias));
  const parts = String(field || '').split('.');
  if (parts.length > 1 && aliases.has(parts[0])) {
    return { alias: parts[0], field: parts.slice(1).join('.') };
  }
  const primaryAlias = objects.find((item) => item.relationship === 'primary')?.alias || fallbackObject;
  return field ? { alias: primaryAlias, field } : null;
}

function ensureFields(fields, required) {
  const result = new Set(fields || []);
  (required || []).forEach((field) => result.add(field));
  return [...result];
}

function prefixRecord(alias, record = {}) {
  const output = {};
  Object.entries(record || {}).forEach(([key, value]) => {
    if (key !== 'attributes') output[`${alias}.${key}`] = value;
  });
  return output;
}

function buildCrossColumns(definition, objects, hiddenByAlias) {
  return (definition.displayFields || definition.fields || [])
    .map((field) => {
      const parsed = parseAliasField(field, objects, definition.primaryObject);
      if (!parsed || (hiddenByAlias.get(parsed.alias) || new Set()).has(parsed.field)) return null;
      return {
        field,
        label: reportFieldLabel(definition, field),
        objectAlias: parsed.alias
      };
    })
    .filter(Boolean)
    .concat((definition.bucketFields || []).map((bucket) => ({
      field: bucket.fieldName,
      label: bucket.label,
      bucket: true
    })))
    .concat((definition.rowFormulas || []).map((formula) => ({
      field: formula.fieldName,
      label: formula.label,
      formula: true
    })));
}

function applyReportFilters(rows, filters = []) {
  if (!filters.length) return rows;
  return rows.filter((row) => filters.every((filter) => filterMatches(readPath(row, filter.field), filter)));
}

async function applyCrossFilters(rows, primaryObject, definition, user, deps, requestId, options = {}) {
  const crossFilters = Array.isArray(definition.crossFilters) ? definition.crossFilters : [];
  if (!crossFilters.length || !rows.length) return rows;

  let output = rows;
  for (const crossFilter of crossFilters) {
    const relationship = normalizeCrossFilterRelationship(primaryObject, crossFilter, deps);
    if (!relationship) continue;

    const childPerms = await deps.getEffectivePermissions(user.id, relationship.childObject);
    if (!user.isSystemAdmin && !childPerms?.can_read) {
      const error = new Error(deps.permissionDeniedMessage());
      error.statusCode = 403;
      throw error;
    }

    const childFields = await deps.getObjectFieldSet(relationship.childObject);
    const childFieldPerms = await deps.getEffectiveFieldPerms(
      user.id,
      relationship.childObject,
      user.role,
      user.isSystemAdmin
    );
    const hiddenChildFields = childFieldPerms?.hiddenFields || new Set();
    const readableSubfilters = (relationship.subfilters || []).filter((filter) => (
      childFields.has(filter.field) && !hiddenChildFields.has(filter.field)
    ));

    const parentIds = [...new Set(output.map((row) => parentRecordId(row, options.parentAlias)).filter(Boolean))];
    if (!parentIds.length) {
      output = relationship.type === 'without' ? output : [];
      continue;
    }

    const childParentIds = await relatedParentIdsForCrossFilter({
      relationship,
      parentIds,
      readableSubfilters,
      user,
      deps,
      requestId
    });

    output = output.filter((row) => {
      const parentId = parentRecordId(row, options.parentAlias);
      const hasChild = childParentIds.has(parentId);
      return relationship.type === 'without' ? !hasChild : hasChild;
    });
  }
  return output;
}

async function relatedParentIdsForCrossFilter({ relationship, parentIds, readableSubfilters, user, deps, requestId }) {
  const selectedFields = new Set(['Id', relationship.parentField]);
  readableSubfilters.forEach((filter) => selectedFields.add(filter.field));
  const chunks = chunkArray(parentIds, 150);
  const parentIdsWithChildren = new Set();

  for (const chunk of chunks) {
    const scope = await deps.buildReadableRecordScopeFilter(
      relationship.childObject,
      user,
      `${requestId}-cross-${relationship.childObject}`
    );
    const whereParts = [
      `${relationship.parentField} IN (${chunk.map((id) => `'${deps.escapeSOQL(id)}'`).join(', ')})`
    ];
    const subfilterClause = buildCrossSubfilterClause(readableSubfilters, deps.escapeSOQL);
    if (subfilterClause) whereParts.push(subfilterClause);
    if (scope.clause) whereParts.push(scope.clause);

    const soql = [
      `SELECT ${[...selectedFields].join(', ')}`,
      `FROM ${relationship.childObject}`,
      `WHERE ${whereParts.join(' AND ')}`,
      'LIMIT 2000'
    ].join(' ');
    const data = await deps.sfGet('/query', { q: soql }, { headers: deps.queryBatchHeaders || {} });
    const owned = await deps.hydrateRecordOwners(data.records || [], relationship.childObject);
    const visible = await deps.applyRecordVisibility(
      owned,
      user.id,
      user.role,
      relationship.childObject,
      user.isSystemAdmin,
      `${requestId}-cross-${relationship.childObject}`
    );
    visible.forEach((record) => {
      const parentId = record[relationship.parentField];
      if (parentId) parentIdsWithChildren.add(parentId);
    });
  }

  return parentIdsWithChildren;
}

function buildCrossSubfilterClause(filters, escapeSOQL) {
  const parts = [];
  (filters || []).forEach((filter) => {
    const field = filter.field;
    const value = filter.value;
    switch (filter.operator) {
      case 'eq':
        parts.push(`${field} = '${escapeSOQL(value)}'`);
        break;
      case 'neq':
        parts.push(`${field} != '${escapeSOQL(value)}'`);
        break;
      case 'contains':
        parts.push(`${field} LIKE '%${escapeSOQL(value)}%'`);
        break;
      case 'starts_with':
        parts.push(`${field} LIKE '${escapeSOQL(value)}%'`);
        break;
      case 'gt':
      case 'gte':
      case 'lt':
      case 'lte': {
        const op = { gt: '>', gte: '>=', lt: '<', lte: '<=' }[filter.operator];
        const comparable = /^-?\d+(\.\d+)?$/.test(String(value)) ? String(value) : `'${escapeSOQL(value)}'`;
        parts.push(`${field} ${op} ${comparable}`);
        break;
      }
      case 'is_null':
        parts.push(`${field} = null`);
        break;
      case 'is_not_null':
        parts.push(`${field} != null`);
        break;
      default:
        break;
    }
  });
  return parts.length ? `(${parts.join(' AND ')})` : '';
}

function normalizeCrossFilterRelationship(primaryObject, crossFilter, deps = {}) {
  const configured = deps.getReportRelationshipMap?.() || {};
  const childObject = crossFilter.childObject;
  const parentField = crossFilter.parentField || configured[primaryObject]?.[childObject];
  if (!childObject || !parentField) return null;
  return {
    type: crossFilter.type === 'without' ? 'without' : 'with',
    parentObject: crossFilter.parentObject || primaryObject,
    childObject,
    parentField,
    subfilters: Array.isArray(crossFilter.subfilters) ? crossFilter.subfilters : []
  };
}

function parentRecordId(row, parentAlias = '') {
  if (parentAlias && row?.[`${parentAlias}.Id`]) return row[`${parentAlias}.Id`];
  return row?.Id || row?.[`${parentAlias}.Id`];
}

function chunkArray(values, size) {
  const chunks = [];
  for (let index = 0; index < values.length; index += size) chunks.push(values.slice(index, index + size));
  return chunks;
}

function filterMatches(value, filter) {
  const text = String(value ?? '');
  const expected = String(filter.value ?? '');
  if (filter.operator === 'neq') return text !== expected;
  if (filter.operator === 'contains') return text.toLowerCase().includes(expected.toLowerCase());
  if (filter.operator === 'starts_with') return text.toLowerCase().startsWith(expected.toLowerCase());
  if (filter.operator === 'is_null') return value === null || value === undefined || value === '';
  if (filter.operator === 'is_not_null') return !(value === null || value === undefined || value === '');
  if (['gt', 'gte', 'lt', 'lte'].includes(filter.operator)) {
    const left = Number(value);
    const right = Number(filter.value);
    if (!Number.isFinite(left) || !Number.isFinite(right)) return false;
    if (filter.operator === 'gt') return left > right;
    if (filter.operator === 'gte') return left >= right;
    if (filter.operator === 'lt') return left < right;
    if (filter.operator === 'lte') return left <= right;
  }
  return text === expected;
}

function isDerivedFieldName(field) {
  return /^[_A-Za-z][_A-Za-z0-9]*$/.test(String(field || ''));
}

function applyConditionalFormatting(rows, columns, definition) {
  const rules = definition.conditionalFormatting || [];
  if (!rules.length) return rows;
  return rows.map((row) => {
    const cellFormats = {};
    rules.forEach((rule) => {
      matchingFormatColumns(rule, columns).forEach((column) => {
        if (highlightRuleMatches(readPath(row, column.field), rule)) {
          cellFormats[column.field] = rule.style || 'yellow';
        }
      });
    });
    return Object.keys(cellFormats).length ? { ...row, __cellFormats: cellFormats } : row;
  });
}

function matchingFormatColumns(rule, columns = []) {
  return columns.filter((column) => (
    column.field === rule.field ||
    column.sourceField === rule.field ||
    (column.aggregate && column.sourceField && rule.field === column.sourceField)
  ));
}

function highlightRuleMatches(value, rule) {
  const text = String(value ?? '');
  const expected = String(rule.value ?? '');
  if (rule.operator === 'is_blank') return text === '';
  if (rule.operator === 'is_not_blank') return text !== '';
  if (rule.operator === 'contains') return text.toLowerCase().includes(expected.toLowerCase());
  if (rule.operator === 'neq') return text !== expected;
  if (['gt', 'gte', 'lt', 'lte'].includes(rule.operator)) {
    const left = Number(value);
    const right = Number(rule.value);
    if (!Number.isFinite(left) || !Number.isFinite(right)) return false;
    if (rule.operator === 'gt') return left > right;
    if (rule.operator === 'gte') return left >= right;
    if (rule.operator === 'lt') return left < right;
    if (rule.operator === 'lte') return left <= right;
  }
  return text === expected;
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

function aggregateLabel(aggregate, definition = null) {
  if ((aggregate.function || 'count') === 'count') return 'Record Count';
  return `${String(aggregate.function || '').replace('_', ' ').toUpperCase()} ${definition ? reportFieldLabel(definition, aggregate.field) : fieldToLabel(aggregate.field)}`;
}

function compareGroupKeys(a, b) {
  return (a.keys || []).join('|').localeCompare((b.keys || []).join('|'));
}

function readPath(row, path) {
  if (row && Object.prototype.hasOwnProperty.call(row, path)) return row[path];
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

function reportFieldLabel(definition, field) {
  const virtualField = (definition.bucketFields || []).find((item) => item.fieldName === field) ||
    (definition.rowFormulas || []).find((item) => item.fieldName === field) ||
    (definition.summaryFormulas || []).find((item) => item.fieldName === field);
  return virtualField?.label || fieldToLabel(field);
}

module.exports = {
  runTabularReport
};
