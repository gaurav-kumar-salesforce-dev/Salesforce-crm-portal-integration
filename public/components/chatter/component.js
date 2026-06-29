export default {
  render(config, context) {
    const esc = context.escapeHtml || window.escapeHtml || (x => x);
    const utilityIconSvg = context.utilityIconSvg || window.utilityIconSvg || (() => '');
    const renderChatterPanel = context.renderChatterPanel || window.renderChatterPanel || (() => '');
    const objectName = context.objectName;
    const isCollapsed = !!config.collapsed;
    const compLabel = 'Chatter';
    const compTitle = config.title || compLabel;

    return `
      <div style="padding: 12px 20px; border-bottom: 1px solid var(--border); display: flex; justify-content: space-between; align-items: center; background: var(--surface-2);">
        <h3 style="margin: 0; font-size: 14px; font-weight: 600; color: var(--text-primary);">${esc(compTitle)}</h3>
        <button class="btn btn-ghost btn-sm" onclick="toggleCardCollapse(this)" style="padding: 4px; display: flex; align-items: center; justify-content: center; border: none; background: transparent; cursor: pointer; transform: ${isCollapsed ? 'rotate(-90deg)' : 'none'}; transition: transform 0.2s;">
          ${utilityIconSvg("chevronDown")}
        </button>
      </div>
      <div class="card-body" style="padding: 20px; display: ${isCollapsed ? 'none' : 'block'};">
        ${renderChatterPanel(objectName)}
      </div>
    `;
  },
  mount(container, config, context) {
    if (typeof window.loadChatterFeed === 'function') {
      window.loadChatterFeed(true);
    }
  }
};
