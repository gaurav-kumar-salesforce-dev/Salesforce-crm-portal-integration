function buildTabularSOQL(definition, availableFields, escapeSOQL, scopeClause = '') {
  const fields = reportSourceFields(definition).filter((field) => isSelectable(field, availableFields));
  if (!fields.includes('Id')) fields.unshift('Id');

  const whereParts = [];
  const filterClause = buildFilterClause(definition.filters, availableFields, escapeSOQL);
  if (filterClause) whereParts.push(filterClause);
  if (scopeClause) whereParts.push(scopeClause);

  const orderBy = buildOrderBy(definition.sort, availableFields);
  const limit = Math.min(Math.max(parseInt(definition.rowLimit, 10) || 200, 1), 2000);

  return {
    soql: [
      `SELECT ${[...new Set(fields)].join(', ')}`,
      `FROM ${definition.primaryObject}`,
      whereParts.length ? `WHERE ${whereParts.join(' AND ')}` : '',
      orderBy ? `ORDER BY ${orderBy}` : '',
      `LIMIT ${limit}`
    ].filter(Boolean).join(' '),
    selectedFields: [...new Set(fields)]
  };
}

function reportSourceFields(definition) {
  const fields = [
    ...(definition.fields || []),
    ...(definition.groupBy || []),
    ...(definition.groupColumns || []),
    ...((definition.aggregates || [])
      .map((aggregate) => aggregate.field)
      .filter(Boolean))
  ];
  return [...new Set(fields)];
}

function buildFilterClause(filters = [], availableFields, escapeSOQL) {
  const parts = [];
  (filters || []).forEach((filter) => {
    if (!isSelectable(filter.field, availableFields)) return;
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
        parts.push(`${field} > ${formatComparable(value, escapeSOQL)}`);
        break;
      case 'gte':
        parts.push(`${field} >= ${formatComparable(value, escapeSOQL)}`);
        break;
      case 'lt':
        parts.push(`${field} < ${formatComparable(value, escapeSOQL)}`);
        break;
      case 'lte':
        parts.push(`${field} <= ${formatComparable(value, escapeSOQL)}`);
        break;
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

function buildOrderBy(sort = [], availableFields) {
  return (sort || [])
    .filter((item) => isSelectable(item.field, availableFields))
    .map((item) => `${item.field} ${item.direction === 'DESC' ? 'DESC' : 'ASC'}`)
    .join(', ');
}

function isSelectable(field, availableFields) {
  if (!availableFields || availableFields.has(field)) return true;
  if (!field.includes('.')) return false;
  const root = field.split('.')[0];
  return availableFields.has(`${root}Id`);
}

function formatComparable(value, escapeSOQL) {
  if (value === null || value === undefined || value === '') return 'null';
  if (/^-?\d+(\.\d+)?$/.test(String(value))) return String(value);
  return `'${escapeSOQL(value)}'`;
}

module.exports = {
  buildTabularSOQL,
  reportSourceFields
};
