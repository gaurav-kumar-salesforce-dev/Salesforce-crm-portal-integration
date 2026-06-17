const state = {
  dashboards: [],
  reports: [],
  activeDashboard: null,
  activeComponents: [],
  renderedComponents: [],
  filters: [],
  isDirty: false
};

const $ = (id) => document.getElementById(id);

document.addEventListener('DOMContentLoaded', async () => {
  initTheme();
  bindEvents();
  try {
    await Promise.all([loadDashboards(), loadReports()]);
    const dashboardId = dashboardIdFromHash();
    if (dashboardId) await openDashboard(dashboardId, { pushState: false });
  } catch (err) {
    toast(err.message || 'Could not load dashboards', 'err');
  }
});

function bindEvents() {
  $('newDashboardBtn').addEventListener('click', newDashboard);
  $('refreshDashboardsBtn').addEventListener('click', loadDashboards);
  $('dashboardSearch').addEventListener('input', debounce(syncDashboardSearchAndLoad, 250));
  $('dashboardListSearch').addEventListener('input', debounce(syncDashboardSearchAndLoad, 250));
  $('dashboardName').addEventListener('input', markDirty);
  $('dashboardDescription').addEventListener('input', markDirty);
  $('saveDashboardBtn').addEventListener('click', saveDashboard);
  $('closeDashboardBtn').addEventListener('click', closeDashboard);
  $('addComponentBtn').addEventListener('click', openComponentModal);
  $('refreshDashboardRunBtn').addEventListener('click', runDashboard);
  $('favoriteDashboardBtn').addEventListener('click', toggleFavorite);
  $('deleteDashboardBtn').addEventListener('click', deleteDashboard);
  $('dashboardFiltersBtn')?.addEventListener('click', openDashboardFilterModal);
  $('closeDashboardFilterModalBtn')?.addEventListener('click', closeDashboardFilterModal);
  $('cancelDashboardFilterBtn')?.addEventListener('click', closeDashboardFilterModal);
  $('saveDashboardFilterBtn')?.addEventListener('click', addDashboardFilter);
  $('closeComponentModalBtn').addEventListener('click', closeComponentModal);
  $('cancelComponentBtn').addEventListener('click', closeComponentModal);
  $('saveComponentBtn').addEventListener('click', addComponent);
}

async function api(path, options = {}) {
  const token = localStorage.getItem('saasray_token');
  if (!token) {
    window.location.href = '/';
    throw new Error('Login required');
  }
  const res = await fetch(path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(options.headers || {})
    }
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

async function loadDashboards() {
  const q = ($('dashboardListSearch')?.value || $('dashboardSearch')?.value || '').trim();
  const data = await api(`/api/dashboards${q ? `?search=${encodeURIComponent(q)}` : ''}`);
  state.dashboards = data.dashboards || [];
  const count = state.dashboards.length;
  $('dashboardCount').textContent = `${count} ${count === 1 ? 'item' : 'items'}`;
  $('dashboardsSubtitle').textContent = `${count} ${count === 1 ? 'item' : 'items'}`;
  renderDashboards();
}

async function loadReports() {
  const data = await api('/api/reports');
  state.reports = data.reports || [];
}

function syncDashboardSearchAndLoad(event) {
  const value = event?.target?.value || '';
  if ($('dashboardSearch') !== event?.target) $('dashboardSearch').value = value;
  if ($('dashboardListSearch') !== event?.target) $('dashboardListSearch').value = value;
  loadDashboards();
}

function renderDashboards() {
  if (!state.dashboards.length) {
    $('dashboardsList').innerHTML = '<tr><td colspan="6" class="reports-empty-row">No dashboards found. Click <strong>New Dashboard</strong> to create one.</td></tr>';
    return;
  }
  $('dashboardsList').innerHTML = state.dashboards.map((dashboard) => `
    <tr class="${state.activeDashboard?.id === dashboard.id ? 'active' : ''}">
      <td>
        <button class="report-name-link" onclick="openDashboard('${esc(dashboard.id)}')">${dashboard.is_favorite ? starIcon() : ''}${esc(dashboard.name)}</button>
      </td>
      <td style="color:var(--text-2)">${esc(dashboard.description || '-')}</td>
      <td>${esc(dashboard.folder_name || 'Private Dashboards')}</td>
      <td><span class="dashboard-pill">${esc(titleCase(dashboard.visibility))}</span></td>
      <td style="color:var(--text-2)">${new Date(dashboard.updated_at).toLocaleString()}</td>
      <td><button class="row-action-btn" onclick="openDashboard('${esc(dashboard.id)}')" title="Open dashboard">${moreIcon()}</button></td>
    </tr>
  `).join('');
}

async function openDashboard(id, options = {}) {
  const data = await api(`/api/dashboards/${id}`);
  state.activeDashboard = data.dashboard;
  state.activeComponents = data.dashboard.components || [];
  if (options.pushState !== false) window.history.replaceState(null, '', `#dashboard/${id}`);
  showBuilder();
  $('dashboardName').value = state.activeDashboard.name || '';
  $('dashboardDescription').value = state.activeDashboard.description || '';
  state.filters = Array.isArray(state.activeDashboard.filters) ? [...state.activeDashboard.filters] : [];
  renderDashboardFilters();
  markSaved();
  renderDashboards();
  await runDashboard();
}

function newDashboard() {
  state.activeDashboard = null;
  state.activeComponents = [];
  state.renderedComponents = [];
  state.filters = [];
  showBuilder();
  $('dashboardName').value = 'New Dashboard';
  $('dashboardDescription').value = '';
  renderDashboardFilters();
  markDirty();
  renderDashboardCanvas();
}

function showBuilder() {
  $('dashboardsHeader').style.display = 'none';
  $('dashboardsListView').style.display = 'none';
  $('dashboardBuilderView').style.display = '';
}

function closeDashboard() {
  state.activeDashboard = null;
  state.activeComponents = [];
  state.renderedComponents = [];
  window.history.replaceState(null, '', window.location.pathname);
  $('dashboardBuilderView').style.display = 'none';
  $('dashboardsHeader').style.display = '';
  $('dashboardsListView').style.display = '';
  renderDashboards();
}

async function saveDashboard() {
  const payload = {
    name: $('dashboardName').value.trim(),
    description: $('dashboardDescription').value.trim(),
    layout: { columns: 12, rowHeight: 90 },
    filters: state.filters,
    visibility: 'private'
  };
  if (!payload.name) return toast('Dashboard name is required', 'err');
  const button = $('saveDashboardBtn');
  setBusy(button, true, 'Saving...');
  try {
    const data = state.activeDashboard
      ? await api(`/api/dashboards/${state.activeDashboard.id}`, { method: 'PATCH', body: JSON.stringify(payload) })
      : await api('/api/dashboards', { method: 'POST', body: JSON.stringify(payload) });
    state.activeDashboard = data.dashboard;
    window.history.replaceState(null, '', `#dashboard/${state.activeDashboard.id}`);
    await loadDashboards();
    markSaved();
    toast('Dashboard saved', 'ok');
  } catch (err) {
    toast(err.message, 'err');
  } finally {
    setBusy(button, false, 'Save');
  }
}

async function runDashboard() {
  if (!state.activeDashboard?.id) {
    renderDashboardCanvas();
    return;
  }
  const button = $('refreshDashboardRunBtn');
  setBusy(button, true, 'Refreshing...');
  try {
    const data = await api(`/api/dashboards/${state.activeDashboard.id}/run`, { method: 'POST', body: '{}' });
    state.renderedComponents = data.components || [];
    renderDashboardCanvas();
  } catch (err) {
    toast(err.message, 'err');
  } finally {
    setBusy(button, false, 'Refresh');
  }
}

function openDashboardFilterModal() {
  $('dashboardFilterField').value = '';
  $('dashboardFilterOperator').value = 'eq';
  $('dashboardFilterValue').value = '';
  $('dashboardFilterModal').style.display = 'flex';
}

function closeDashboardFilterModal() {
  $('dashboardFilterModal').style.display = 'none';
}

function addDashboardFilter() {
  const field = $('dashboardFilterField').value.trim();
  const value = $('dashboardFilterValue').value.trim();
  if (!field || !value) return toast('Enter a field and value for the filter', 'err');
  state.filters.push({ field, operator: $('dashboardFilterOperator').value, value });
  closeDashboardFilterModal();
  renderDashboardFilters();
  markDirty();
}

function removeDashboardFilter(index) {
  state.filters.splice(index, 1);
  renderDashboardFilters();
  markDirty();
}

function renderDashboardFilters() {
  if (!$('dashboardGlobalFilters')) return;
  $('dashboardGlobalFilters').innerHTML = state.filters.length
    ? state.filters.map((filter, index) => `
      <span class="field-pill">${esc(filter.field)} ${esc(filter.operator)} ${esc(filter.value)}
        <button onclick="removeDashboardFilter(${index})">&times;</button>
      </span>
    `).join('')
    : '<span class="muted">No dashboard global filters.</span>';
}

function openComponentModal() {
  if (!state.activeDashboard?.id) return toast('Save the dashboard before adding components', 'info');
  $('componentTitle').value = '';
  $('componentReport').innerHTML = state.reports
    .map((report) => `<option value="${esc(report.id)}">${esc(report.name)}</option>`)
    .join('');
  $('componentType').value = 'chart';
  $('componentWidth').value = '6';
  $('componentModal').style.display = 'flex';
}

function closeComponentModal() {
  $('componentModal').style.display = 'none';
}

async function addComponent() {
  const reportId = $('componentReport').value;
  if (!reportId) return toast('Select a saved report', 'err');
  const report = state.reports.find((item) => item.id === reportId);
  const payload = {
    title: $('componentTitle').value.trim() || report?.name || 'Dashboard Component',
    reportId,
    componentType: $('componentType').value,
    width: Number($('componentWidth').value || 6),
    height: $('componentType').value === 'kpi' ? 2 : 3,
    positionX: 0,
    positionY: state.activeComponents.length * 3,
    config: {
      chartType: report?.definition?.chart?.type || 'bar',
      limit: 10
    }
  };
  const button = $('saveComponentBtn');
  setBusy(button, true, 'Adding...');
  try {
    await api(`/api/dashboards/${state.activeDashboard.id}/components`, {
      method: 'POST',
      body: JSON.stringify(payload)
    });
    closeComponentModal();
    const data = await api(`/api/dashboards/${state.activeDashboard.id}`);
    state.activeDashboard = data.dashboard;
    state.activeComponents = data.dashboard.components || [];
    await runDashboard();
    toast('Component added', 'ok');
  } catch (err) {
    toast(err.message, 'err');
  } finally {
    setBusy(button, false, 'Add Component');
  }
}

async function removeComponent(componentId) {
  if (!confirm('Remove this dashboard component?')) return;
  await api(`/api/dashboards/${state.activeDashboard.id}/components/${componentId}`, { method: 'DELETE' });
  state.activeComponents = state.activeComponents.filter((component) => component.id !== componentId);
  state.renderedComponents = state.renderedComponents.filter((component) => component.componentId !== componentId);
  renderDashboardCanvas();
}

async function toggleFavorite() {
  if (!state.activeDashboard?.id) return toast('Save the dashboard first', 'info');
  const dashboard = state.dashboards.find((item) => item.id === state.activeDashboard.id);
  const favorite = !dashboard?.is_favorite;
  await api(`/api/dashboards/${state.activeDashboard.id}/favorite`, { method: favorite ? 'POST' : 'DELETE', body: favorite ? '{}' : undefined });
  await loadDashboards();
  toast(favorite ? 'Dashboard favorited' : 'Favorite removed', 'ok');
}

async function deleteDashboard() {
  if (!state.activeDashboard?.id) return closeDashboard();
  if (!confirm(`Delete "${state.activeDashboard.name}"?`)) return;
  await api(`/api/dashboards/${state.activeDashboard.id}`, { method: 'DELETE' });
  closeDashboard();
  await loadDashboards();
  toast('Dashboard deleted', 'ok');
}

function renderDashboardCanvas() {
  const components = state.renderedComponents;
  $('dashboardEmpty').style.display = components.length ? 'none' : '';
  $('dashboardCanvas').querySelectorAll('.dashboard-component-card').forEach((node) => node.remove());
  components.forEach((component) => {
    const card = document.createElement('article');
    card.className = `dashboard-component-card dashboard-component-${component.type}`;
    card.style.gridColumn = `span ${component.layout?.w || 6}`;
    card.innerHTML = `
      <div class="dashboard-component-header">
        <div>
          <h3>${esc(component.title || 'Component')}</h3>
          <span>${esc(component.meta?.reportName || '')}${component.meta?.cached ? ' - cached' : ''}</span>
        </div>
        <button class="row-action-btn" onclick="removeComponent('${esc(component.componentId)}')" title="Remove component">&times;</button>
      </div>
      <div class="dashboard-component-body">${renderComponentBody(component)}</div>
    `;
    $('dashboardCanvas').appendChild(card);
  });
}

function renderComponentBody(component) {
  if (component.error) return `<div class="dashboard-component-error">${esc(component.error)}</div>`;
  if (component.type === 'kpi') {
    return `<div class="dashboard-kpi-value">${esc(formatNumber(component.value))}</div><div class="dashboard-kpi-caption">${esc(component.meta?.reportType || 'report')}</div>`;
  }
  if (component.type === 'table') {
    const columns = (component.columns || []).slice(0, 5);
    return `<div class="dashboard-table-wrap"><table class="dashboard-table">
      <thead><tr>${columns.map((column) => `<th>${esc(column.label)}</th>`).join('')}</tr></thead>
      <tbody>${(component.rows || []).map((row) => `<tr>${columns.map((column) => `<td>${esc(readPath(row, column.field) ?? '')}</td>`).join('')}</tr>`).join('') || `<tr><td colspan="${Math.max(columns.length, 1)}">No rows</td></tr>`}</tbody>
    </table></div>`;
  }
  return renderChartComponent(component);
}

function renderChartComponent(component) {
  const columns = component.columns || [];
  const rows = component.rows || [];
  const labelColumn = columns.find((column) => column.group || (!column.aggregate && !column.total && !column.matrixColumnKey)) || columns[0];
  const valueColumn = columns.find((column) => column.aggregate || column.total || column.matrixColumnKey);
  const points = rows.slice(0, 10).map((row, index) => ({
    label: String(readPath(row, labelColumn?.field) ?? `Row ${index + 1}`),
    value: Number(valueColumn ? readPath(row, valueColumn.field) : 1) || 0
  }));
  if (!points.length) return '<div class="dashboard-component-empty">No chart data</div>';
  if (component.chartType === 'donut') return renderDonut(points);
  return renderBars(points);
}

function renderBars(points) {
  const max = Math.max(...points.map((point) => point.value), 1);
  return `<div class="dashboard-bars">${points.map((point) => `
    <div class="dashboard-bar-row">
      <span>${esc(shortLabel(point.label, 18))}</span>
      <div><i style="width:${Math.max((point.value / max) * 100, 3)}%"></i></div>
      <strong>${esc(formatNumber(point.value))}</strong>
    </div>
  `).join('')}</div>`;
}

function renderDonut(points) {
  const total = points.reduce((sum, point) => sum + Math.max(point.value, 0), 0) || 1;
  return `<div class="dashboard-donut-lite"><div>${esc(formatNumber(total))}</div><span>Total across ${points.length} groups</span></div>`;
}

function dashboardIdFromHash() {
  const match = window.location.hash.match(/^#dashboard\/([A-Za-z0-9-]+)$/);
  return match ? match[1] : '';
}

function markDirty() {
  state.isDirty = true;
  $('dashboardDraftIndicator').textContent = 'Unsaved changes';
  $('dashboardDraftIndicator').classList.add('dirty');
}

function markSaved() {
  state.isDirty = false;
  $('dashboardDraftIndicator').textContent = 'Saved';
  $('dashboardDraftIndicator').classList.remove('dirty');
}

function setBusy(button, busy, label) {
  if (!button) return;
  button.disabled = busy;
  button.textContent = label;
}

function readPath(row, path) {
  if (Object.prototype.hasOwnProperty.call(row || {}, path)) return row[path];
  return String(path || '').split('.').reduce((value, key) => value?.[key], row);
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 1 });
}

function shortLabel(value, max = 14) {
  const label = String(value || '(Blank)');
  return label.length > max ? `${label.slice(0, max - 1)}...` : label;
}

function titleCase(value) {
  return String(value || '').replace(/\b\w/g, (char) => char.toUpperCase());
}

function starIcon() {
  return '<svg width="12" height="12" viewBox="0 0 24 24" fill="var(--warning)" stroke="var(--warning)" stroke-width="2" style="vertical-align:-1px;margin-right:4px"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>';
}

function moreIcon() {
  return '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/></svg>';
}

function toast(message, type = 'info') {
  const stack = $('toastStack');
  if (!stack) return;
  const item = document.createElement('div');
  item.className = `toast toast-${type === 'err' ? 'err' : type === 'ok' ? 'ok' : 'info'} in`;
  item.innerHTML = `
    <div class="toast-inner">
      <span class="toast-icon">${type === 'ok' ? '✓' : type === 'err' ? '×' : 'i'}</span>
      <div class="toast-content">
        <div class="toast-label">${type === 'ok' ? 'Success' : type === 'err' ? 'Error' : 'Info'}</div>
        <div class="toast-msg">${esc(message)}</div>
      </div>
      <button class="toast-close" onclick="this.closest('.toast').remove()">×</button>
    </div>`;
  stack.appendChild(item);
  setTimeout(() => item.remove(), 5000);
}

function initTheme() {
  const saved = localStorage.getItem('saasray_theme');
  if (saved === 'dark') document.documentElement.setAttribute('data-theme', 'dark');
}

function toggleTheme() {
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  if (isDark) {
    document.documentElement.removeAttribute('data-theme');
    localStorage.setItem('saasray_theme', 'light');
  } else {
    document.documentElement.setAttribute('data-theme', 'dark');
    localStorage.setItem('saasray_theme', 'dark');
  }
}

function debounce(fn, wait) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[char]));
}
