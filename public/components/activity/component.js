export default {
  render(config, context) {
    const objectName = context.objectName;
    const id = context.id;
    const isCollapsed = !!config.collapsed;

    return `
      <div class="card-body record-activity-body" style="display: ${isCollapsed ? 'none' : 'block'};">
        <div id="activityTimeline">
          <div class="activity-empty"><p>Loading activities...</p></div>
        </div>
      </div>
    `;
  },
  mount(container, config, context) {
    if (typeof window.loadRecordActivity === 'function') {
      window.loadRecordActivity(context.objectName, context.id);
    }
  }
};
