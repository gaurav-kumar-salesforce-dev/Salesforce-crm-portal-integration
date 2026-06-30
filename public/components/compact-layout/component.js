export default {
  render(config, context) {
    const esc = context.escapeHtml || window.escapeHtml || (x => x);
    const labelFor = context.labelFor || window.labelFor || (x => x);
    const getValue = context.getValue || window.getValue || ((r, f) => r[f]);
    const formatValue = context.formatValue || window.formatValue || ((f, v) => v);
    const record = context.record || {};
    const summaryFields = context.summaryFields || [];
    const isCollapsed = !!config.collapsed;
    const compTitle = config.title || '';

    return `
      ${compTitle ? `
        <div style="padding: 12px 20px; border-bottom: 1px solid var(--border); display: flex; justify-content: space-between; align-items: center; background: var(--surface-2);">
          <h3 style="margin: 0; font-size: 14px; font-weight: 600; color: var(--text-primary);">${esc(compTitle)}</h3>
        </div>
      ` : ''}
      <div class="record-summary" style="display: ${isCollapsed ? 'none' : 'grid'};">
        ${summaryFields
          .map(
            (field) => `
          <div>
            <span>${esc(labelFor(field))}</span>
            <strong>${formatValue(field, getValue(record, field), record)}</strong>
          </div>
        `,
          )
          .join("")}
      </div>
    `;
  }
};
