export default {
  render(config, context) {
    const renderChatterPanel = context.renderChatterPanel || window.renderChatterPanel || (() => '');
    const objectName = context.objectName;
    const isCollapsed = !!config.collapsed;

    return `
      <div class="card-body record-chatter-body" style="display: ${isCollapsed ? 'none' : 'block'};">
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
