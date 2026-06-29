export default {
  render(config, context) {
    const esc = context.escapeHtml || window.escapeHtml || (x => x);
    const renderRelatedListShell = context.renderRelatedListShell || window.renderRelatedListShell || (() => '');
    const isCollapsed = !!config.collapsed;
    
    // Fallback configurations if properties are not customized yet
    const configData = config.config || {};
    const key = configData.key || `rel_single_${Math.random().toString(36).substring(2, 9)}`;
    const relationshipName = configData.relationshipName || 'Related List';
    const childObject = configData.childObject || '';
    const field = configData.field || '';
    const title = configData.title || config.title || relationshipName;
    const fields = configData.fields || ['Name'];
    const limit = configData.limit || 5;
    const sortBy = configData.sortBy || 'CreatedDate';
    const sortDir = configData.sortDir || 'DESC';
    const showNew = configData.showNew !== false;
    const showViewAll = configData.showViewAll !== false;

    // Convert configData into standard list config for renderRelatedListShell
    const mappedConfig = {
      key,
      objectName: childObject,
      relationshipName,
      field,
      title,
      fields,
      limit,
      sortBy,
      sortDir,
      showNew,
      showViewAll
    };

    if (!childObject || !relationshipName) {
      return `
        <div style="padding: 12px 20px; border-bottom: 1px solid var(--border); display: flex; justify-content: space-between; align-items: center; background: var(--surface-2);">
          <h3 style="margin: 0; font-size: 14px; font-weight: 600; color: var(--text-primary);">${esc(title)}</h3>
        </div>
        <div class="card-body" style="padding: 20px; text-align: center; color: var(--text-muted); font-style: italic;">
          Please select a Related List from the configuration sidebar.
        </div>
      `;
    }

    // Render the standard related list shell wrapper
    return `
      <div class="card-body" style="display: ${isCollapsed ? 'none' : 'block'}; padding: 0;">
        <div class="record-related-card-container" style="padding: 0;">
          ${renderRelatedListShell(mappedConfig, true)}
        </div>
      </div>
    `;
  },
  mount(container, config, context) {
    if (typeof window.loadRelatedRecords === 'function') {
      window.loadRelatedRecords(context.objectName, context.id);
    }
  }
};
