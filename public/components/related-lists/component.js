export default {
  render(config, context) {
    const esc = context.escapeHtml || window.escapeHtml || (x => x);
    const getRelatedListConfigs = context.getRelatedListConfigs || window.getRelatedListConfigs || (() => []);
    const renderRelatedListShell = context.renderRelatedListShell || window.renderRelatedListShell || (() => '');
    const objectName = context.objectName;
    const isCollapsed = !!config.collapsed;

    let configs = [];
    if (config.relatedLists && config.relatedLists.length > 0) {
      configs = config.relatedLists.filter(c => c && c.enabled);
    }
    if (configs.length === 0) {
      configs = getRelatedListConfigs(objectName);
    }

    return `
      <div class="card-body" style="display: ${isCollapsed ? 'none' : 'block'};">
        <div class="record-related-card-container">
          ${configs.map((listConfig, index) => renderRelatedListShell(listConfig, index === 0)).join("")}
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
