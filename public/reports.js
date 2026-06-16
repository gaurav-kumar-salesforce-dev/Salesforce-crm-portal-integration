const state = {
  reports: [],
  folders: [],
  objects: [],
  fields: [],
  selectedFields: [],
  filters: [],
  activeReport: null,
  isDirty: false,
  autoPreviewTimer: null,
  lastPreviewSignature: '',
  isResizingSidebar: false,
  isResizingBuilderPanel: false,
  builderTab: 'outline',
  wasSidebarCollapsedBeforeBuilder: false,
  expandedGroups: new Set(),
  chart: {
    enabled: false,
    type: 'bar',
    labelField: '',
    valueField: ''
  },
  // Footer toggle state
  showRowCounts: true,
  showDetailRows: true,
  showSubtotals: true,
  showGrandTotal: true
};

const $ = (id) => document.getElementById(id);

document.addEventListener('DOMContentLoaded', async () => {
  initTheme();
  bindEvents();
  try {
    await Promise.all([loadFolders(), loadObjects()]);
    await loadReports();
    const reportId = reportIdFromHash();
    if (reportId) await openReport(reportId, { pushState: false });
  } catch (err) {
    toast(err.message || 'Could not load reports', 'err');
  }
});

function bindEvents() {
  $('appSidebarToggle')?.addEventListener('click', toggleAppSidebar);
  $('newReportBtn').addEventListener('click', newReport);
  $('refreshReportsBtn').addEventListener('click', loadReports);
  $('reportSearch').addEventListener('input', debounce(syncReportSearchAndLoad, 250));
  $('reportListSearch')?.addEventListener('input', debounce(syncReportSearchAndLoad, 250));
  $('toggleReportSidebarBtn')?.addEventListener('click', toggleReportSidebar);
  $('reportSidebarResizer')?.addEventListener('mousedown', startSidebarResize);
  $('toggleBuilderPanelBtn').addEventListener('click', toggleBuilderPanel);
  $('builderLeftResizer').addEventListener('mousedown', startBuilderPanelResize);
  document.addEventListener('mousemove', resizeReportSidebar);
  document.addEventListener('mousemove', resizeBuilderPanel);
  document.addEventListener('mouseup', stopSidebarResize);
  document.addEventListener('mouseup', stopBuilderPanelResize);
  $('autoPreviewToggle').addEventListener('change', () => {
    sessionStorage.setItem('reports_auto_preview', $('autoPreviewToggle').checked ? '1' : '0');
    scheduleAutoPreview();
  });
  $('reportType').addEventListener('change', () => {
    markDirty();
    syncReportTypeUi();
    clearResults();
    scheduleAutoPreview();
  });
  $('reportObject').addEventListener('change', async () => {
    markDirty();
    updateObjectChip();
    state.selectedFields = [];
    await loadFields($('reportObject').value);
    renderSelectedFields();
    scheduleAutoPreview();
  });
  ['reportName', 'reportDescription', 'reportLimit', 'summaryGroupOne', 'summaryGroupTwo', 'matrixColumnGroup', 'summaryAggregateFn', 'summaryAggregateField']
    .forEach((id) => {
      $(id).addEventListener('input', () => {
        markDirty();
        if (id.startsWith('summary')) renderGroupChips();
        if (id === 'matrixColumnGroup') renderColumnGroupChips();
        if (id.startsWith('summary') || id === 'matrixColumnGroup' || id === 'reportLimit') scheduleAutoPreview();
      });
      $(id).addEventListener('change', () => {
        markDirty();
        if (id.startsWith('summary')) renderGroupChips();
        if (id === 'matrixColumnGroup') renderColumnGroupChips();
        if (id.startsWith('summary') || id === 'matrixColumnGroup' || id === 'reportLimit') scheduleAutoPreview();
      });
    });
  $('fieldSearch').addEventListener('input', renderFieldList);
  $('summaryAggregateFn').addEventListener('change', syncAggregateFieldState);
  $('filterOperator').addEventListener('change', syncFilterValueState);
  $('addFilterBtn').addEventListener('click', addFilter);
  $('runReportBtn').addEventListener('click', runPreview);
  $('runFullReportBtn').addEventListener('click', runFullReport);
  $('addChartBtn')?.addEventListener('click', enableChart);
  $('removeChartBtn')?.addEventListener('click', removeChart);
  ['chartType', 'chartLabelField', 'chartValueField'].forEach((id) => {
    $(id)?.addEventListener('change', () => {
      syncChartFromControls();
      markDirty();
      renderChartForCurrentResult();
    });
  });
  $('saveReportBtn').addEventListener('click', saveReport);
  $('saveRunReportBtn').addEventListener('click', saveAndRunReport);
  $('closeBuilderBtn').addEventListener('click', closeBuilder);
  $('cloneReportBtn').addEventListener('click', cloneReport);
  $('favoriteReportBtn').addEventListener('click', toggleFavorite);
  $('exportReportBtn').addEventListener('click', exportReport);
  $('deleteReportBtn').addEventListener('click', deleteReport);

  // Footer toggle events
  $('toggleRowCounts')?.addEventListener('change', (e) => {
    state.showRowCounts = e.target.checked;
    reRenderIfPossible();
  });
  $('toggleDetailRows')?.addEventListener('change', (e) => {
    state.showDetailRows = e.target.checked;
    reRenderIfPossible();
  });
  $('toggleSubtotals')?.addEventListener('change', (e) => {
    state.showSubtotals = e.target.checked;
    reRenderIfPossible();
  });
  $('toggleGrandTotal')?.addEventListener('change', (e) => {
    state.showGrandTotal = e.target.checked;
    reRenderIfPossible();
  });

  // Left nav items
  document.querySelectorAll('.home-nav-item').forEach((item) => {
    item.addEventListener('click', function () {
      document.querySelectorAll('.home-nav-item').forEach((el) => el.classList.remove('active'));
      this.classList.add('active');
      const label = this.textContent.trim();
      if ($('reportsTitle')) $('reportsTitle').textContent = label;
    });
  });

  restoreBuilderUiState();
}

function reRenderIfPossible() {
  if (window.currentReportResult) {
    renderResultTable(window.currentReportResult, window.currentReportResultOptions || { previewMode: true });
    renderChartForCurrentResult();
  }
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

async function loadFolders() {
  const data = await api('/api/reports/folders');
  state.folders = data.folders || [];
}

async function loadObjects() {
  const data = await api('/api/reports/metadata/objects');
  state.objects = data.objects || [];
  $('reportObject').innerHTML = state.objects
    .map((obj) => `<option value="${esc(obj.apiName)}">${esc(obj.label)}</option>`)
    .join('');
}

async function loadReports() {
  const q = ($('reportListSearch')?.value || $('reportSearch')?.value || '').trim();
  const data = await api(`/api/reports${q ? `?search=${encodeURIComponent(q)}` : ''}`);
  state.reports = data.reports || [];
  const count = state.reports.length;
  if ($('reportCount')) $('reportCount').textContent = `${count} ${count === 1 ? 'item' : 'items'}`;
  if ($('reportsSubtitle')) $('reportsSubtitle').textContent = `${count} ${count === 1 ? 'item' : 'items'}`;
  renderReports();
}

function syncReportSearchAndLoad(event) {
  const value = event?.target?.value || '';
  if ($('reportSearch') && $('reportSearch') !== event?.target) $('reportSearch').value = value;
  if ($('reportListSearch') && $('reportListSearch') !== event?.target) $('reportListSearch').value = value;
  loadReports();
}

function renderReports() {
  if (!state.reports.length) {
    $('reportsList').innerHTML = '<tr><td colspan="6" class="reports-empty-row">No reports found. Click <strong>New Report</strong> to create one.</td></tr>';
    return;
  }
  $('reportsList').innerHTML = state.reports.map((report) => `
    <tr class="${state.activeReport?.id === report.id ? 'active' : ''}">
      <td>
        <button class="report-name-link" onclick="openReport('${esc(report.id)}')">${report.is_favorite ? '<svg width="12" height="12" viewBox="0 0 24 24" fill="var(--warning)" stroke="var(--warning)" stroke-width="2" style="vertical-align:-1px;margin-right:4px"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>' : ''}${esc(report.name)}</button>
      </td>
      <td style="color:var(--text-2)">${esc(report.description || '—')}</td>
      <td>${esc(report.folder_name || 'Private Reports')}</td>
      <td>
        <span style="display:inline-flex;align-items:center;gap:4px;background:var(--surface-2);border:1px solid var(--border);border-radius:4px;padding:2px 8px;font-size:11px;font-weight:700;color:var(--text-2)">${esc(titleCase(report.report_type))}</span>
      </td>
      <td style="color:var(--text-2)">${new Date(report.updated_at).toLocaleString()}</td>
      <td><button class="row-action-btn" onclick="openReport('${esc(report.id)}')" title="Open report"><svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/></svg></button></td>
    </tr>
  `).join('');
}

async function openReport(id, options = {}) {
  const data = await api(`/api/reports/${id}`);
  state.activeReport = data.report;
  if (options.pushState !== false) window.history.replaceState(null, '', `#report/${id}`);
  const definition = state.activeReport.definition || {};
  showBuilderMode();
  $('reportName').value = state.activeReport.name || '';
  $('reportDescription').value = state.activeReport.description || '';
  $('reportType').value = definition.reportType || state.activeReport.report_type || 'tabular';
  $('reportObject').value = definition.primaryObject || state.activeReport.primary_object;
  updateObjectChip();
  $('reportLimit').value = definition.rowLimit || 200;
  state.selectedFields = [...(definition.fields || [])];
  await loadFields($('reportObject').value);
  $('summaryGroupOne').value = definition.groupBy?.[0] || '';
  $('summaryGroupTwo').value = definition.groupBy?.[1] || '';
  $('matrixColumnGroup').value = definition.groupColumns?.[0] || '';
  const firstAggregate = (definition.aggregates || []).find((aggregate) => aggregate.function !== 'count') || (definition.aggregates || [])[0] || {};
  $('summaryAggregateFn').value = firstAggregate.function || 'count';
  $('summaryAggregateField').value = firstAggregate.field || '';
  state.filters = [...(definition.filters || [])];
  state.chart = normalizeChartConfig(definition.chart);
  syncReportTypeUi();
  syncChartControls();
  markSaved();
  renderReports();
  renderSelectedFields();
  renderFilters();
  renderGroupChips();
  clearResults();
}

async function newReport() {
  state.activeReport = null;
  showBuilderMode();
  $('reportName').value = 'New Tabular Report';
  $('reportDescription').value = '';
  $('reportType').value = 'tabular';
  $('reportObject').value = state.objects[0]?.apiName || 'Account';
  updateObjectChip();
  $('reportLimit').value = 200;
  state.selectedFields = [];
  state.filters = [];
  state.chart = normalizeChartConfig();
  await loadFields($('reportObject').value);
  syncReportTypeUi();
  syncChartControls();
  markDirty();
  renderReports();
  renderSelectedFields();
  renderFilters();
  renderGroupChips();
  clearResults();
}

function showBuilderMode() {
  state.wasSidebarCollapsedBeforeBuilder = document.body.classList.contains('sidebar-collapsed');
  $('reportsListView').style.display = 'none';
  $('reportsHeader').style.display = 'none';
  $('reportBuilderView').style.display = '';
  // CSS handles collapsing sidebar via body.reports-builder-mode rules
  document.body.classList.add('reports-builder-mode');
}

function closeBuilder() {
  state.activeReport = null;
  window.history.replaceState(null, '', window.location.pathname);
  $('reportBuilderView').style.display = 'none';
  $('reportsListView').style.display = '';
  $('reportsHeader').style.display = '';
  document.body.classList.remove('reports-builder-mode');
  // Restore sidebar state from before entering builder
  document.body.classList.toggle('sidebar-collapsed', state.wasSidebarCollapsedBeforeBuilder);
  renderReports();
}

function reportIdFromHash() {
  const match = window.location.hash.match(/^#report\/([A-Za-z0-9-]+)$/);
  return match ? match[1] : '';
}

async function loadFields(objectName) {
  if (!objectName) return;
  const data = await api(`/api/reports/metadata/${encodeURIComponent(objectName)}/fields`);
  state.fields = data.fields || [];
  if (!state.selectedFields.length) {
    const preferred = ['Name', 'Account.Name', 'Email', 'Phone', 'Status', 'StageName', 'Amount', 'CloseDate'];
    state.selectedFields = state.fields
      .filter((field) => preferred.includes(field.name))
      .slice(0, 6)
      .map((field) => field.name);
  }
  renderFieldList();
  renderSummaryFieldOptions();
  renderFilterFieldOptions();
}

function renderFieldList() {
  const q = ($('fieldSearch').value || '').toLowerCase();
  $('fieldList').innerHTML = state.fields
    .filter((field) => !q || field.label.toLowerCase().includes(q) || field.name.toLowerCase().includes(q))
    .map((field) => `
      <label class="field-option">
        <input type="checkbox" value="${esc(field.name)}" ${state.selectedFields.includes(field.name) ? 'checked' : ''} onchange="toggleField('${esc(field.name)}', this.checked)">
        <span>${esc(field.label)}</span>
      </label>
    `).join('');
}

function toggleField(field, checked) {
  if (checked && !state.selectedFields.includes(field)) state.selectedFields.push(field);
  if (!checked) state.selectedFields = state.selectedFields.filter((item) => item !== field);
  markDirty();
  renderSelectedFields();
  scheduleAutoPreview();
}

function renderSelectedFields() {
  $('selectedFieldCount').textContent = `${state.selectedFields.length} selected`;
  $('selectedFields').innerHTML = state.selectedFields.length
    ? state.selectedFields.map((field) => `
      <span class="field-pill">${esc(labelForField(field))}<button onclick="removeField('${esc(field)}')">&times;</button></span>
    `).join('')
    : '<span class="muted">Select fields to build the report.</span>';
  renderFieldList();
}

function removeField(field) {
  state.selectedFields = state.selectedFields.filter((item) => item !== field);
  markDirty();
  renderSelectedFields();
  scheduleAutoPreview();
}

function definitionFromForm() {
  const reportType = $('reportType').value || 'tabular';
  const groupBySource = reportType === 'matrix'
    ? [$('summaryGroupOne').value]
    : [$('summaryGroupOne').value, $('summaryGroupTwo').value];
  const groupBy = groupBySource
    .filter(Boolean)
    .filter((value, index, arr) => arr.indexOf(value) === index);
  const groupColumns = [$('matrixColumnGroup').value].filter(Boolean);
  const aggregateFn = $('summaryAggregateFn').value || 'count';
  const aggregateField = $('summaryAggregateField').value || '';
  const aggregates = [{ function: 'count', field: '', label: 'Record Count' }];
  if ((reportType === 'summary' || reportType === 'matrix') && aggregateFn !== 'count') {
    aggregates.push({
      function: aggregateFn,
      field: aggregateField,
      label: `${aggregateFn.replace('_', ' ').toUpperCase()} ${labelForField(aggregateField)}`
    });
  }

  return {
    reportType,
    primaryObject: $('reportObject').value,
    fields: state.selectedFields,
    groupBy: reportType === 'summary' || reportType === 'matrix' ? groupBy : [],
    groupColumns: reportType === 'matrix' ? groupColumns : [],
    aggregates: reportType === 'summary' || reportType === 'matrix' ? aggregates : [],
    chart: normalizeChartConfig(state.chart),
    filters: state.filters,
    sort: [],
    rowLimit: Number($('reportLimit').value || 200)
  };
}

async function saveReport(options = {}) {
  if (!state.selectedFields.length && $('reportType').value === 'tabular') {
    if (!options.silent) toast('Select at least one field', 'err');
    return null;
  }
  if ($('reportType').value === 'summary' && !$('summaryGroupOne').value) {
    if (!options.silent) toast('Select a grouping field for summary reports', 'err');
    return null;
  }
  if ($('reportType').value === 'matrix' && (!$('summaryGroupOne').value || !$('matrixColumnGroup').value)) {
    if (!options.silent) toast('Select row and column grouping fields for matrix reports', 'err');
    return null;
  }
  const payload = {
    name: $('reportName').value.trim(),
    description: $('reportDescription').value.trim(),
    definition: definitionFromForm(),
    visibility: 'private'
  };
  const button = $('saveReportBtn');
  if (!options.silent) setBusy(button, true, 'Saving...');
  try {
    const data = state.activeReport
      ? await api(`/api/reports/${state.activeReport.id}`, { method: 'PATCH', body: JSON.stringify(payload) })
      : await api('/api/reports', { method: 'POST', body: JSON.stringify(payload) });
    state.activeReport = data.report;
    await loadReports();
    markSaved();
    if (!options.silent) toast('Report saved', 'ok');
    return data.report;
  } catch (err) {
    if (!options.silent) toast(err.message, 'err');
    return null;
  } finally {
    if (!options.silent) setBusy(button, false, 'Save');
  }
}

async function saveAndRunReport() {
  const button = $('saveRunReportBtn');
  setBusy(button, true, 'Saving...');
  try {
    const saved = await saveReport({ silent: true });
    if (!saved) return;
    setBusy(button, true, 'Running...');
    await runFullReport({ silentBusy: true });
    toast('Report saved and run completed', 'ok');
  } finally {
    setBusy(button, false, 'Save & Run');
  }
}

async function runPreview(options = {}) {
  if (!state.selectedFields.length && $('reportType').value === 'tabular') return toast('Select at least one field', 'err');
  if ($('reportType').value === 'summary' && !$('summaryGroupOne').value) {
    return toast('Select a grouping field for summary reports', 'err');
  }
  if ($('reportType').value === 'matrix' && (!$('summaryGroupOne').value || !$('matrixColumnGroup').value)) {
    return toast('Select row and column grouping fields for matrix reports', 'err');
  }
  const button = $('runReportBtn');
  if (!options.silentBusy) setBusy(button, true, 'Running...');
  try {
    const definition = definitionFromForm();
    const signature = JSON.stringify(definition);
    const result = await api('/api/reports/preview', {
      method: 'POST',
      body: JSON.stringify({ definition })
    });
    state.lastPreviewSignature = signature;
    renderResults(result, { previewMode: true });
  } catch (err) {
    toast(err.message, 'err');
  } finally {
    if (!options.silentBusy) setBusy(button, false, reportRunLabel());
  }
}

async function runFullReport(options = {}) {
  if (!state.selectedFields.length && $('reportType').value === 'tabular') return toast('Select at least one field', 'err');
  if ($('reportType').value === 'summary' && !$('summaryGroupOne').value) {
    return toast('Select a grouping field for summary reports', 'err');
  }
  if ($('reportType').value === 'matrix' && (!$('summaryGroupOne').value || !$('matrixColumnGroup').value)) {
    return toast('Select row and column grouping fields for matrix reports', 'err');
  }
  const button = $('runFullReportBtn');
  if (!options.silentBusy) setBusy(button, true, 'Running...');
  try {
    const result = await api('/api/reports/run', {
      method: 'POST',
      body: JSON.stringify({ definition: definitionFromForm() })
    });
    renderResults(result, { previewMode: false });
  } catch (err) {
    toast(err.message, 'err');
  } finally {
    if (!options.silentBusy) setBusy(button, false, 'Run');
  }
}

async function cloneReport() {
  if (!state.activeReport) return toast('Save the report before cloning', 'info');
  const data = await api(`/api/reports/${state.activeReport.id}/clone`, { method: 'POST', body: '{}' });
  await loadReports();
  await openReport(data.report.id);
  toast('Report cloned', 'ok');
}

async function toggleFavorite() {
  if (!state.activeReport) return toast('Save the report first', 'info');
  const report = state.reports.find((item) => item.id === state.activeReport.id);
  const favorite = !report?.is_favorite;
  await api(`/api/reports/${state.activeReport.id}/favorite`, { method: favorite ? 'POST' : 'DELETE', body: favorite ? '{}' : undefined });
  await loadReports();
}

async function deleteReport() {
  if (!state.activeReport) return toast('Save the report first', 'info');
  if (!confirm(`Delete "${state.activeReport.name}"?`)) return;
  await api(`/api/reports/${state.activeReport.id}`, { method: 'DELETE' });
  state.activeReport = null;
  closeBuilder();
  await loadReports();
  toast('Report deleted', 'ok');
}

async function exportReport() {
  if (!state.activeReport) return toast('Save the report before exporting', 'info');
  const token = localStorage.getItem('saasray_token');
  const res = await fetch(`/api/reports/${state.activeReport.id}/export.csv`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    return toast(data.error || 'Could not export report', 'err');
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${($('reportName').value || 'report').replace(/[^a-z0-9_-]+/gi, '_')}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function renderResults(result, options = { previewMode: true }) {
  state.expandedGroups.clear();
  if (result.reportType === 'summary' && result.groups?.length) {
    result.groups.forEach((_, index) => state.expandedGroups.add(String(index)));
  }
  renderResultTable(result, options);
  renderChartForCurrentResult();
}

function reportRunLabel() {
  const type = $('reportType')?.value;
  if (type === 'summary') return 'Run Summary';
  if (type === 'matrix') return 'Run Matrix';
  return 'Run Preview';
}

function renderResultTable(result, options = { previewMode: true }) {
  window.currentReportResult = result;
  window.currentReportResultOptions = options;
  const columns = result.columns || [];

  // Column headers with sort indicators
  $('reportResultsHead').innerHTML = `<tr>${columns.map((column) => `<th>${esc(column.label)} <span class="col-sort-indicator">↕</span></th>`).join('')}</tr>`;
  $('reportResultsFoot').innerHTML = '';

  if (result.reportType === 'matrix') {
    renderMatrixTable(result, columns);
  } else if (result.reportType === 'summary') {
    renderSummaryTable(result, columns);
  } else {
    $('reportResultsBody').innerHTML = (result.rows || []).map((row) => `
      <tr>${columns.map((column) => `<td>${esc(readPath(row, column.field) ?? '')}</td>`).join('')}</tr>
    `).join('') || `<tr><td colspan="${Math.max(columns.length, 1)}" class="muted" style="text-align:center;padding:32px">No rows found</td></tr>`;
  }

  const isPreview = options.previewMode !== false;
  const previewMsg = $('previewMessage');
  if (previewMsg) {
    const iconSpan = previewMsg.querySelector('.preview-icon');
    const textSpan = previewMsg.querySelector('span:last-child') || previewMsg;
    if (isPreview) {
      if (iconSpan) iconSpan.textContent = '✓';
      if (textSpan !== previewMsg) textSpan.textContent = 'Previewing a limited number of records. Run the report to see everything.';
      else previewMsg.innerHTML = '<span class="preview-icon">✓</span><span>Previewing a limited number of records. Run the report to see everything.</span>';
    } else {
      if (iconSpan) iconSpan.textContent = 'ℹ';
      if (textSpan !== previewMsg) textSpan.textContent = 'Run Mode: Showing records returned by the report run.';
      else previewMsg.innerHTML = '<span class="preview-icon">ℹ</span><span>Run Mode: Showing records returned by the report run.</span>';
    }
    previewMsg.classList.toggle('full-run', !isPreview);
  }

  $('reportResultMeta').textContent = result.reportType === 'matrix'
    ? `${result.totalSize || 0} row groups × ${result.columnGroups?.length || 0} column groups from ${result.sourceRowCount || 0} visible records${result.cached ? ' — cached' : ''}`
    : result.reportType === 'summary'
    ? `${result.totalSize || 0} groups from ${result.sourceRowCount || 0} visible records${result.cached ? ' — cached' : ''}`
    : `${result.totalSize || 0} rows shown${result.cached ? ' — cached' : ''}`;
}

function normalizeChartConfig(chart = {}) {
  return {
    enabled: Boolean(chart.enabled),
    type: ['bar', 'line', 'donut'].includes(chart.type) ? chart.type : 'bar',
    labelField: chart.labelField || '',
    valueField: chart.valueField || ''
  };
}

function enableChart() {
  state.chart = normalizeChartConfig({ ...state.chart, enabled: true });
  syncChartControls();
  markDirty();
  renderChartForCurrentResult();
}

function removeChart() {
  state.chart = normalizeChartConfig({ enabled: false });
  syncChartControls();
  markDirty();
  renderChartForCurrentResult();
}

function syncChartFromControls() {
  state.chart = normalizeChartConfig({
    enabled: true,
    type: $('chartType')?.value || state.chart.type,
    labelField: $('chartLabelField')?.value || state.chart.labelField,
    valueField: $('chartValueField')?.value || state.chart.valueField
  });
}

function syncChartControls() {
  const chart = normalizeChartConfig(state.chart);
  state.chart = chart;
  if ($('chartConfigStrip')) $('chartConfigStrip').style.display = chart.enabled ? '' : 'none';
  if ($('chartType')) $('chartType').value = chart.type;
  refreshChartFieldOptions(window.currentReportResult);
}

function refreshChartFieldOptions(result) {
  if (!$('chartLabelField') || !$('chartValueField')) return;
  const fields = chartFieldOptions(result);
  $('chartLabelField').innerHTML = fields.labels.map((field) => `<option value="${esc(field.field)}">${esc(field.label)}</option>`).join('') || '<option value="">Label</option>';
  $('chartValueField').innerHTML = fields.values.map((field) => `<option value="${esc(field.field)}">${esc(field.label)}</option>`).join('') || '<option value="">Value</option>';
  if (!fields.labels.some((field) => field.field === state.chart.labelField)) state.chart.labelField = fields.labels[0]?.field || '';
  if (!fields.values.some((field) => field.field === state.chart.valueField)) state.chart.valueField = fields.values[0]?.field || '';
  $('chartLabelField').value = state.chart.labelField;
  $('chartValueField').value = state.chart.valueField;
}

function chartFieldOptions(result) {
  const columns = result?.columns || [];
  const labelColumns = columns.filter((column) => column.group || (!column.aggregate && !column.total && !column.matrixColumnKey));
  const valueColumns = columns.filter((column) => column.aggregate || column.total || column.matrixColumnKey);
  if (result?.reportType === 'tabular') {
    return {
      labels: labelColumns.map(toChartOption),
      values: [{ field: '__count', label: 'Record Count' }]
    };
  }
  return {
    labels: (labelColumns.length ? labelColumns : columns.slice(0, 1)).map(toChartOption),
    values: (valueColumns.length ? valueColumns : [{ field: '__count', label: 'Record Count' }]).map(toChartOption)
  };
}

function toChartOption(column) {
  return {
    field: column.field || column.matrixColumnKey || column.fieldName || '',
    label: column.label || column.field || 'Value'
  };
}

function renderChartForCurrentResult() {
  const panel = $('reportChartPanel');
  const canvas = $('reportChartCanvas');
  if (!panel || !canvas) return;
  if (!state.chart?.enabled) {
    panel.style.display = 'none';
    canvas.innerHTML = '';
    return;
  }
  panel.style.display = '';
  refreshChartFieldOptions(window.currentReportResult);
  const points = buildChartPoints(window.currentReportResult);
  if ($('reportChartTitle')) $('reportChartTitle').textContent = `${titleCase(state.chart.type)} Chart`;
  if ($('reportChartSubtitle')) {
    $('reportChartSubtitle').textContent = points.length
      ? `${labelForChartField(state.chart.valueField)} by ${labelForChartField(state.chart.labelField)}`
      : 'Run Preview or Run Report to populate the chart';
  }
  canvas.innerHTML = points.length
    ? renderChartSvg(points, state.chart.type)
    : '<div class="chart-empty">Run Preview or Run Report to populate the chart.</div>';
}

function labelForChartField(field) {
  const options = chartFieldOptions(window.currentReportResult);
  return options.labels.concat(options.values).find((option) => option.field === field)?.label || field || 'Value';
}

function buildChartPoints(result) {
  if (!result?.rows?.length) return [];
  const labelField = state.chart.labelField || chartFieldOptions(result).labels[0]?.field;
  const valueField = state.chart.valueField || chartFieldOptions(result).values[0]?.field;

  if (result.reportType === 'tabular') {
    const grouped = new Map();
    result.rows.forEach((row) => {
      const label = String(readPath(row, labelField) ?? '(Blank)');
      const increment = valueField === '__count' ? 1 : Number(readPath(row, valueField) || 0);
      grouped.set(label, (grouped.get(label) || 0) + increment);
    });
    return Array.from(grouped.entries()).map(([label, value]) => ({ label, value })).slice(0, 12);
  }

  return result.rows.map((row) => ({
    label: String(readPath(row, labelField) ?? '(Blank)'),
    value: Number(valueField === '__count' ? 1 : readPath(row, valueField) || 0)
  })).filter((point) => Number.isFinite(point.value)).slice(0, 12);
}

function renderChartSvg(points, type) {
  if (type === 'donut') return renderDonutChart(points);
  if (type === 'line') return renderLineChart(points);
  return renderBarChart(points);
}

function renderBarChart(points) {
  const width = 820;
  const height = 260;
  const top = 20;
  const left = 46;
  const chartHeight = 170;
  const max = Math.max(...points.map((point) => point.value), 1);
  const slot = (width - left - 24) / points.length;
  const bars = points.map((point, index) => {
    const barHeight = Math.max((point.value / max) * chartHeight, 2);
    const x = left + index * slot + slot * 0.2;
    const y = top + chartHeight - barHeight;
    const w = Math.max(slot * 0.55, 10);
    return `
      <rect class="chart-bar" x="${x}" y="${y}" width="${w}" height="${barHeight}" rx="3"></rect>
      <text class="chart-value" x="${x + w / 2}" y="${y - 6}" text-anchor="middle">${esc(formatChartNumber(point.value))}</text>
      <text class="chart-label" x="${x + w / 2}" y="${top + chartHeight + 28}" text-anchor="middle">${esc(shortLabel(point.label))}</text>
    `;
  }).join('');
  return `<svg class="chart-svg" viewBox="0 0 ${width} ${height}" role="img">
    <line class="chart-axis" x1="${left}" y1="${top + chartHeight}" x2="${width - 20}" y2="${top + chartHeight}"></line>
    ${bars}
  </svg>`;
}

function renderLineChart(points) {
  const width = 820;
  const height = 260;
  const top = 24;
  const left = 46;
  const chartHeight = 168;
  const max = Math.max(...points.map((point) => point.value), 1);
  const step = points.length > 1 ? (width - left - 40) / (points.length - 1) : 0;
  const coords = points.map((point, index) => ({
    x: left + index * step,
    y: top + chartHeight - (point.value / max) * chartHeight,
    point
  }));
  const path = coords.map((coord, index) => `${index ? 'L' : 'M'} ${coord.x} ${coord.y}`).join(' ');
  return `<svg class="chart-svg" viewBox="0 0 ${width} ${height}" role="img">
    <line class="chart-axis" x1="${left}" y1="${top + chartHeight}" x2="${width - 20}" y2="${top + chartHeight}"></line>
    <path class="chart-line" d="${path}"></path>
    ${coords.map((coord) => `
      <circle class="chart-point" cx="${coord.x}" cy="${coord.y}" r="4"></circle>
      <text class="chart-value" x="${coord.x}" y="${coord.y - 9}" text-anchor="middle">${esc(formatChartNumber(coord.point.value))}</text>
      <text class="chart-label" x="${coord.x}" y="${top + chartHeight + 28}" text-anchor="middle">${esc(shortLabel(coord.point.label))}</text>
    `).join('')}
  </svg>`;
}

function renderDonutChart(points) {
  const total = points.reduce((sum, point) => sum + Math.max(point.value, 0), 0) || 1;
  let offset = 0;
  const colors = ['#0176d3', '#2e844a', '#ba0517', '#dd7a01', '#747474', '#706eec', '#06a59a', '#8e44ad', '#e67e22', '#1b96ff', '#45c65a', '#ffb75d'];
  const segments = points.map((point, index) => {
    const pct = Math.max(point.value, 0) / total;
    const dash = `${pct * 100} ${100 - pct * 100}`;
    const segment = `<circle class="donut-segment" r="52" cx="90" cy="90" stroke="${colors[index % colors.length]}" stroke-dasharray="${dash}" stroke-dashoffset="${-offset}"></circle>`;
    offset += pct * 100;
    return segment;
  }).join('');
  const legend = points.map((point, index) => `
    <div class="chart-legend-item"><span style="background:${colors[index % colors.length]}"></span>${esc(shortLabel(point.label, 22))} <strong>${esc(formatChartNumber(point.value))}</strong></div>
  `).join('');
  return `<div class="donut-chart">
    <svg class="donut-svg" viewBox="0 0 180 180" role="img">
      <circle class="donut-track" r="52" cx="90" cy="90"></circle>
      ${segments}
      <text class="donut-total" x="90" y="86" text-anchor="middle">${esc(formatChartNumber(total))}</text>
      <text class="donut-caption" x="90" y="105" text-anchor="middle">Total</text>
    </svg>
    <div class="chart-legend">${legend}</div>
  </div>`;
}

function shortLabel(value, max = 14) {
  const label = String(value || '(Blank)');
  return label.length > max ? `${label.slice(0, max - 1)}...` : label;
}

function formatChartNumber(value) {
  return Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 1 });
}

function renderMatrixTable(result, columns) {
  const rowGroupColumns = columns.filter((column) => column.group);
  const matrixColumns = columns.filter((column) => column.matrixColumnKey);
  const totalColumn = columns.find((column) => column.total);

  $('reportResultsHead').innerHTML = `
    <tr>
      ${rowGroupColumns.map((column) => `<th>${esc(column.label)} <span class="col-sort-indicator">↕</span></th>`).join('')}
      ${matrixColumns.map((column) => `<th class="matrix-column-header">${esc(column.label)} <span class="col-sort-indicator">↕</span></th>`).join('')}
      ${totalColumn ? `<th>${esc(totalColumn.label)}</th>` : ''}
    </tr>
  `;

  $('reportResultsBody').innerHTML = (result.rows || []).map((row) => `
    <tr>
      ${rowGroupColumns.map((column) => `<td class="matrix-row-header">${esc(readPath(row, column.field) ?? '')}</td>`).join('')}
      ${matrixColumns.map((column) => `<td class="matrix-value-cell">${esc(readPath(row, column.field) ?? 0)}</td>`).join('')}
      ${totalColumn ? `<td class="matrix-total-cell">${esc(readPath(row, totalColumn.field) ?? 0)}</td>` : ''}
    </tr>
  `).join('') || `<tr><td colspan="${Math.max(columns.length, 1)}" class="muted" style="text-align:center;padding:32px">No rows found</td></tr>`;

  // Grand Total row — respect footer toggle
  if (state.showGrandTotal) {
    $('reportResultsFoot').innerHTML = `
      <tr>
        <td colspan="${Math.max(rowGroupColumns.length, 1)}">Grand Total</td>
        ${matrixColumns.map((column) => `<td class="matrix-total-cell">${esc(result.columnTotals?.[column.field] ?? 0)}</td>`).join('')}
        ${totalColumn ? `<td class="matrix-grand-total">${esc(result.columnTotals?.[totalColumn.field] ?? 0)}</td>` : ''}
      </tr>
    `;
  } else {
    $('reportResultsFoot').innerHTML = '';
  }
}

function renderSummaryTable(result, columns) {
  const detailColumns = result.detailColumns || [];
  const aggregateColumns = columns.filter((column) => column.aggregate);
  const groupCount = (result.groupBy || []).length || 1;
  const bodyRows = [];

  (result.groups || []).forEach((group, groupIndex) => {
    const key = String(groupIndex);
    const expanded = state.expandedGroups.has(key);
    const groupLabel = (group.keys || []).join(' / ') || '(Blank)';
    const summary = (result.rows || [])[groupIndex] || {};

    // Row count display
    const rowCountDisplay = state.showRowCounts ? ` (${(group.rows || []).length})` : '';

    bodyRows.push(`
      <tr class="summary-group-row">
        <td colspan="${Math.max(groupCount, 1)}">
          <button class="group-toggle" onclick="toggleSummaryGroup('${key}')">${expanded ? '−' : '+'}</button>
          ${esc(groupLabel)}${rowCountDisplay}
        </td>
        ${aggregateColumns.map((column) => `<td>${esc(summary[column.field] ?? '')}</td>`).join('')}
      </tr>
    `);

    if (expanded && state.showDetailRows) {
      (group.rows || []).forEach((detailRow) => {
        bodyRows.push(`
          <tr class="summary-detail-row">
            <td colspan="${Math.max(groupCount, 1)}">${esc(detailColumns.map((column) => readPath(detailRow, column.field)).filter(Boolean).join(' | ') || 'Detail row')}</td>
            ${aggregateColumns.map(() => '<td></td>').join('')}
          </tr>
        `);
      });

      if (state.showSubtotals) {
        bodyRows.push(`
          <tr class="summary-total-row">
            <td colspan="${Math.max(groupCount, 1)}">Subtotal</td>
            ${aggregateColumns.map((column) => `<td>${esc(summary[column.field] ?? '')}</td>`).join('')}
          </tr>
        `);
      }
    }
  });

  $('reportResultsBody').innerHTML = bodyRows.join('') || `<tr><td colspan="${Math.max(columns.length, 1)}" class="muted" style="text-align:center;padding:32px">No rows found</td></tr>`;

  if (state.showGrandTotal) {
    $('reportResultsFoot').innerHTML = `
      <tr>
        <td colspan="${Math.max(groupCount, 1)}">Grand Total</td>
        ${aggregateColumns.map((column) => `<td>${esc(result.grandTotals?.[column.field] ?? '')}</td>`).join('')}
      </tr>
    `;
  } else {
    $('reportResultsFoot').innerHTML = '';
  }
}

function toggleSummaryGroup(key) {
  if (state.expandedGroups.has(key)) state.expandedGroups.delete(key);
  else state.expandedGroups.add(key);
  renderResultTable(window.currentReportResult || {}, window.currentReportResultOptions || { previewMode: true });
  renderChartForCurrentResult();
}

function renderSummaryFieldOptions() {
  const options = ['<option value="">None</option>']
    .concat(state.fields.map((field) => `<option value="${esc(field.name)}">${esc(field.label)}</option>`))
    .join('');
  $('summaryGroupOne').innerHTML = options;
  $('summaryGroupTwo').innerHTML = options;
  $('matrixColumnGroup').innerHTML = options;
  $('summaryAggregateField').innerHTML = options;
  syncAggregateFieldState();
  renderGroupChips();
  renderColumnGroupChips();
}

function syncReportTypeUi() {
  const isSummary = $('reportType').value === 'summary';
  const isMatrix = $('reportType').value === 'matrix';
  $('summaryConfig').style.display = isSummary || isMatrix ? '' : 'none';
  $('matrixColumnConfig').style.display = isMatrix ? '' : 'none';
  $('summaryGroupTwo').style.display = isMatrix ? 'none' : '';
  $('runReportBtn').textContent = reportRunLabel();
  $('reportName').placeholder = isMatrix ? 'New Matrix Report' : isSummary ? 'New Summary Report' : 'New Tabular Report';
  renderGroupChips();
  renderColumnGroupChips();
}

function syncAggregateFieldState() {
  const requiresField = $('summaryAggregateFn').value !== 'count';
  $('summaryAggregateField').disabled = !requiresField;
  if (!requiresField) $('summaryAggregateField').value = '';
}

function renderFilterFieldOptions() {
  const options = state.fields
    .map((field) => `<option value="${esc(field.name)}">${esc(field.label)}</option>`)
    .join('');
  $('filterField').innerHTML = options;
}

function addFilter() {
  const field = $('filterField').value;
  const operator = $('filterOperator').value;
  const value = $('filterValue').value;
  if (!field) return toast('Select a filter field', 'err');
  if (!['is_null', 'is_not_null'].includes(operator) && !String(value || '').trim()) {
    return toast('Enter a filter value', 'err');
  }
  state.filters.push({ field, operator, value });
  $('filterValue').value = '';
  markDirty();
  renderFilters();
  scheduleAutoPreview();
}

function removeFilter(index) {
  state.filters.splice(index, 1);
  markDirty();
  renderFilters();
  scheduleAutoPreview();
}

function renderFilters() {
  syncFilterValueState();
  $('activeFilters').innerHTML = state.filters.length
    ? state.filters.map((filter, index) => `
      <span class="field-pill">
        ${esc(labelForField(filter.field))} ${esc(operatorLabel(filter.operator))}${filter.value ? ` ${esc(filter.value)}` : ''}
        <button onclick="removeFilter(${index})">&times;</button>
      </span>
    `).join('')
    : '<span class="muted">No filters. All records allowed by security are included in preview.</span>';
}

function renderGroupChips() {
  const fields = [$('summaryGroupOne')?.value, $('summaryGroupTwo')?.value].filter(Boolean);
  const target = $('groupRowChips');
  if (!target) return;
  target.innerHTML = fields.length
    ? fields.map((field, index) => `
      <span class="field-pill">
        ${esc(labelForField(field))}
        <button onclick="clearGroupField(${index})">&times;</button>
      </span>
    `).join('')
    : '<span class="muted">No row groups. Add a row group for summary or matrix reports.</span>';
}

function clearGroupField(index) {
  if (index === 0) $('summaryGroupOne').value = '';
  if (index === 1) $('summaryGroupTwo').value = '';
  markDirty();
  renderGroupChips();
  scheduleAutoPreview();
}

function renderColumnGroupChips() {
  const target = $('groupColumnChips');
  if (!target) return;
  const field = $('matrixColumnGroup')?.value;
  target.innerHTML = field
    ? `<span class="field-pill">${esc(labelForField(field))}<button onclick="clearColumnGroupField()">&times;</button></span>`
    : '<span class="muted">No column group. Matrix reports require one column group.</span>';
}

function clearColumnGroupField() {
  $('matrixColumnGroup').value = '';
  markDirty();
  renderColumnGroupChips();
  scheduleAutoPreview();
}

function syncFilterValueState() {
  const noValue = ['is_null', 'is_not_null'].includes($('filterOperator').value);
  $('filterValue').disabled = noValue;
  if (noValue) $('filterValue').value = '';
}

function operatorLabel(operator) {
  return ({
    eq: '=',
    neq: '≠',
    contains: 'contains',
    starts_with: 'starts with',
    gt: '>',
    gte: '≥',
    lt: '<',
    lte: '≤',
    is_null: 'is blank',
    is_not_null: 'is not blank'
  })[operator] || operator;
}

function markDirty() {
  state.isDirty = true;
  const indicator = $('draftIndicator');
  if (indicator) {
    indicator.textContent = 'Unsaved changes';
    indicator.classList.add('dirty');
  }
}

function markSaved() {
  state.isDirty = false;
  const indicator = $('draftIndicator');
  if (indicator) {
    indicator.textContent = 'Saved';
    indicator.classList.remove('dirty');
  }
}

function scheduleAutoPreview() {
  clearTimeout(state.autoPreviewTimer);
  if (!$('autoPreviewToggle')?.checked) return;
  if (!state.selectedFields.length && $('reportType').value === 'tabular') return;
  if ($('reportType').value === 'summary' && !$('summaryGroupOne').value) return;
  if ($('reportType').value === 'matrix' && (!$('summaryGroupOne').value || !$('matrixColumnGroup').value)) return;
  state.autoPreviewTimer = setTimeout(() => {
    const signature = JSON.stringify(definitionFromForm());
    if (signature === state.lastPreviewSignature) return;
    runPreview().catch(() => {});
  }, 2500);
}

function restoreBuilderUiState() {
  const appSidebarCollapsed = sessionStorage.getItem('reports_app_sidebar_collapsed') === '1';
  document.body.classList.toggle('sidebar-collapsed', appSidebarCollapsed);
  const grid = $('reportsGrid');
  const collapsed = sessionStorage.getItem('reports_sidebar_collapsed') === '1';
  if (collapsed) grid?.classList.add('sidebar-collapsed');
  const width = Number(sessionStorage.getItem('reports_sidebar_width') || 0);
  if (width) grid?.style.setProperty('--reports-sidebar-w', `${Math.min(Math.max(width, 220), 420)}px`);
  $('autoPreviewToggle').checked = false;
  const builderCollapsed = sessionStorage.getItem('reports_builder_panel_collapsed') === '1';
  if (builderCollapsed) $('builderWorkspace')?.classList.add('builder-panel-collapsed');
  const builderWidth = Number(sessionStorage.getItem('reports_builder_panel_width') || 0);
  if (builderWidth) $('builderWorkspace')?.style.setProperty('--builder-panel-w', `${Math.min(Math.max(builderWidth, 240), 440)}px`);
  updateSidebarToggleText();
  updateBuilderPanelToggleText();
}

function toggleAppSidebar() {
  document.body.classList.toggle('sidebar-collapsed');
  sessionStorage.setItem('reports_app_sidebar_collapsed', document.body.classList.contains('sidebar-collapsed') ? '1' : '0');
}

function toggleReportSidebar() {
  const grid = $('reportsGrid');
  if (!grid) return;
  grid.classList.toggle('sidebar-collapsed');
  sessionStorage.setItem('reports_sidebar_collapsed', grid.classList.contains('sidebar-collapsed') ? '1' : '0');
  updateSidebarToggleText();
}

function updateSidebarToggleText() {
  const collapsed = $('reportsGrid')?.classList.contains('sidebar-collapsed');
  if ($('toggleReportSidebarBtn')) $('toggleReportSidebarBtn').textContent = collapsed ? 'Expand Reports' : 'Saved Reports';
}

function startSidebarResize(event) {
  if (!$('reportsGrid') || !$('reportSidebarResizer')) return;
  if ($('reportsGrid').classList.contains('sidebar-collapsed')) return;
  state.isResizingSidebar = true;
  $('reportSidebarResizer').classList.add('dragging');
  event.preventDefault();
}

function resizeReportSidebar(event) {
  if (!state.isResizingSidebar) return;
  if (!$('reportsGrid')) return;
  const gridLeft = $('reportsGrid').getBoundingClientRect().left;
  const width = Math.min(Math.max(event.clientX - gridLeft, 220), 420);
  $('reportsGrid').style.setProperty('--reports-sidebar-w', `${width}px`);
  sessionStorage.setItem('reports_sidebar_width', String(Math.round(width)));
}

function stopSidebarResize() {
  state.isResizingSidebar = false;
  $('reportSidebarResizer')?.classList.remove('dragging');
}

function toggleBuilderPanel() {
  const workspace = $('builderWorkspace');
  workspace.classList.toggle('builder-panel-collapsed');
  sessionStorage.setItem('reports_builder_panel_collapsed', workspace.classList.contains('builder-panel-collapsed') ? '1' : '0');
  updateBuilderPanelToggleText();
}

function updateBuilderPanelToggleText() {
  const collapsed = $('builderWorkspace')?.classList.contains('builder-panel-collapsed');
  if ($('toggleBuilderPanelBtn')) $('toggleBuilderPanelBtn').textContent = collapsed ? '>' : '<';
}

function startBuilderPanelResize(event) {
  if ($('builderWorkspace').classList.contains('builder-panel-collapsed')) return;
  state.isResizingBuilderPanel = true;
  $('builderLeftResizer').classList.add('dragging');
  event.preventDefault();
}

function resizeBuilderPanel(event) {
  if (!state.isResizingBuilderPanel) return;
  const left = $('builderWorkspace').getBoundingClientRect().left;
  const width = Math.min(Math.max(event.clientX - left, 240), 440);
  $('builderWorkspace').style.setProperty('--builder-panel-w', `${width}px`);
  sessionStorage.setItem('reports_builder_panel_width', String(Math.round(width)));
}

function stopBuilderPanelResize() {
  state.isResizingBuilderPanel = false;
  $('builderLeftResizer')?.classList.remove('dragging');
}

function setBuilderTab(tab) {
  state.builderTab = tab === 'filters' ? 'filters' : 'outline';
  $('outlineTabBtn').classList.toggle('active', state.builderTab === 'outline');
  $('filtersTabBtn').classList.toggle('active', state.builderTab === 'filters');
  $('outlinePanel').style.display = state.builderTab === 'outline' ? '' : 'none';
  $('filtersPanel').style.display = state.builderTab === 'filters' ? '' : 'none';
  // If panel is collapsed, clicking a tab should expand it
  const workspace = $('builderWorkspace');
  if (workspace?.classList.contains('builder-panel-collapsed')) {
    workspace.classList.remove('builder-panel-collapsed');
    sessionStorage.setItem('reports_builder_panel_collapsed', '0');
    updateBuilderPanelToggleText();
  }
}

function clearResults() {
  $('reportResultsHead').innerHTML = '';
  $('reportResultsBody').innerHTML = '';
  $('reportResultsFoot').innerHTML = '';
  $('reportResultMeta').textContent = '';
  const previewMsg = $('previewMessage');
  if (previewMsg) {
    previewMsg.innerHTML = '<span class="preview-icon">✓</span><span>Preview Mode: Showing first 20 records only. Run Report to see complete results.</span>';
    previewMsg.classList.remove('full-run');
  }
  window.currentReportResult = null;
  window.currentReportResultOptions = null;
  renderChartForCurrentResult();
}

function labelForField(fieldName) {
  return state.fields.find((field) => field.name === fieldName)?.label || fieldName;
}

function readPath(row, path) {
  if (Object.prototype.hasOwnProperty.call(row || {}, path)) return row[path];
  return String(path || '').split('.').reduce((value, key) => value?.[key], row);
}

function setBusy(button, busy, label) {
  button.disabled = busy;
  button.textContent = label;
}

function updateObjectChip() {
  const objectName = $('reportObject')?.value || 'Object';
  if ($('objectChip')) $('objectChip').textContent = objectName;
}

function toast(message, type = 'info') {
  const stack = $('toastStack');
  if (!stack) return;
  const item = document.createElement('div');
  item.className = `toast toast-${type === 'err' ? 'err' : type === 'ok' ? 'ok' : 'info'} in`;
  item.innerHTML = `
    <div class="toast-inner">
      <span class="toast-icon">${type === 'ok' ? '✓' : type === 'err' ? '✕' : 'ℹ'}</span>
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

function titleCase(value) {
  return String(value || '').replace(/\b\w/g, (char) => char.toUpperCase());
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
