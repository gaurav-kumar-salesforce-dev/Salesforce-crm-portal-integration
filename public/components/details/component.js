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

    return `
      <div class="card-body record-details-body" style="display: ${isCollapsed ? 'none' : 'block'};" id="detailsContent">
        ${renderConfiguredDetailSections(objectName, record, fields, displayFields)}
      </div>
    `;
  }
};
