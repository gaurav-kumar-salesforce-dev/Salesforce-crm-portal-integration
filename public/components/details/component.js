export default {
  render(config, context) {
    const esc = context.escapeHtml || window.escapeHtml || (x => x);
    const renderConfiguredDetailSections = context.renderConfiguredDetailSections || window.renderConfiguredDetailSections || (() => '');
    const utilityIconSvg = context.utilityIconSvg || window.utilityIconSvg || (() => '');
    const objectName = context.objectName;
    const record = context.record || {};
    const fields = context.fields || [];
    const displayFields = context.displayFields || [];
    const isCollapsed = !!config.collapsed;
    const compLabel = 'Details';
    const compTitle = config.title || compLabel;

    return `
      <div style="padding: 12px 20px; border-bottom: 1px solid var(--border); display: flex; justify-content: space-between; align-items: center; background: var(--surface-2);">
        <h3 style="margin: 0; font-size: 14px; font-weight: 600; color: var(--text-primary);">${esc(compTitle)}</h3>
        <div style="display: flex; align-items: center; gap: 12px;">
          <button class="btn btn-ghost btn-sm" onclick="toggleCardCollapse(this)" style="padding: 4px; display: flex; align-items: center; justify-content: center; border: none; background: transparent; cursor: pointer; transform: ${isCollapsed ? 'rotate(-90deg)' : 'none'}; transition: transform 0.2s;">
            ${utilityIconSvg("chevronDown")}
          </button>
        </div>
      </div>
      <div class="card-body" style="padding: 20px; display: ${isCollapsed ? 'none' : 'block'};" id="detailsContent">
        ${renderConfiguredDetailSections(objectName, record, fields, displayFields)}
      </div>
    `;
  }
};
