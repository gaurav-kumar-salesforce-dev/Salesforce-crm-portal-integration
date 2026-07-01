const state = {
  reports: [],
  folders: [],
  selectedFolderId: '',
  reportView: 'recent',
  reportActionMenuId: '',
  objects: [],
  reportTypes: [],
  fields: [],
  selectedFields: [],
  filters: [],
  crossFilters: [],
  bucketFields: [],
  rowFormulas: [],
  summaryFormulas: [],
  conditionalFormatting: [],
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
    valueField: '',
    title: '',
    subtitle: '',
    legendPosition: 'right',
    xAxisLabel: '',
    yAxisLabel: '',
    sortOrder: 'none',
    colors: [],
    showDataLabels: true,
    nullHandling: 'zero',
    stacked: false
  },
  // Footer toggle state
  showRowCounts: true,
  showDetailRows: true,
  showSubtotals: true,
  showGrandTotal: true
};

const CLIENT_CACHE_TTL_MS = 30 * 1000;
const REPORT_METADATA_SESSION_TTL_MS = 5 * 60 * 1000;
const REPORT_SESSION_PREFIX = 'saasray:reports:';
const browserMemoryCache = new Map();
const browserInFlightRequests = new Map();
const sharedPerformanceCache = window.SaaSRAYPerformance || null;

const $ = (id) => document.getElementById(id);

const REPORT_PAGE = (() => {
  const file = (window.location.pathname.split('/').pop() || 'reports.html').toLowerCase();
  const params = new URLSearchParams(window.location.search);
  const hash = window.location.hash.match(/^#report\/([A-Za-z0-9-]+)$/);
  return {
    file,
    mode: file === 'reports-builder.html' ? 'builder' : file === 'reports-view.html' ? 'viewer' : 'list',
    reportId: params.get('id') || (hash ? hash[1] : ''),
    usesDedicatedPage: file === 'reports-builder.html' || file === 'reports-view.html'
  };
})();

const REPORT_RUN_CACHE_TTL_MS = 60 * 1000;

function reportListUrl() {
  return 'reports.html';
}

function reportBuilderUrl(id = '') {
  return id ? `reports-builder.html?id=${encodeURIComponent(id)}` : 'reports-builder.html';
}

function reportViewUrl(id = '') {
  return id ? `reports-view.html?id=${encodeURIComponent(id)}` : 'reports.html';
}

function navigateToReportBuilder(id = '') {
  window.location.href = reportBuilderUrl(id);
}

function navigateToReportView(id = '') {
  window.location.href = reportViewUrl(id);
}

function setReportUiMode(mode) {
  document.body.classList.toggle('reports-page-list', mode === 'list');
  document.body.classList.toggle('reports-page-builder', mode === 'builder');
  document.body.classList.toggle('reports-page-viewer', mode === 'viewer');
}

function primeDedicatedReportPage() {
  setReportUiMode(REPORT_PAGE.mode);
  if (!REPORT_PAGE.usesDedicatedPage) return;

  const listView = $('reportsListView');
  const header = $('reportsHeader');
  const builder = $('reportBuilderView');
  if (listView) listView.style.display = 'none';
  if (header) header.style.display = 'none';
  if (builder) builder.style.display = '';
  document.body.classList.add('reports-builder-mode');
  document.body.classList.toggle('reports-view-mode', REPORT_PAGE.mode === 'viewer');
  if ($('reportName')) $('reportName').value = REPORT_PAGE.mode === 'viewer' ? 'Opening report...' : 'Loading report...';
  if ($('reportDescription')) $('reportDescription').value = '';
  showReportPageLoading(REPORT_PAGE.mode === 'viewer' ? 'Preparing run mode...' : 'Loading report builder...');
}

function showReportPageLoading(message = 'Loading report...') {
  let overlay = document.getElementById('reportPageLoading');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'reportPageLoading';
    overlay.className = 'report-page-loading';
    overlay.innerHTML = `
      <div class="report-page-loading-card">
        <span class="report-page-loading-spinner"></span>
        <strong>Loading report</strong>
        <p data-report-loading-text></p>
      </div>
    `;
    document.body.appendChild(overlay);
  }
  const text = overlay.querySelector('[data-report-loading-text]');
  if (text) text.textContent = message;
  overlay.hidden = false;
}

function hideReportPageLoading() {
  const overlay = document.getElementById('reportPageLoading');
  if (overlay) overlay.hidden = true;
}

document.addEventListener('DOMContentLoaded', async () => {
  sharedPerformanceCache?.markModuleInitialized?.('reports');
  primeDedicatedReportPage();
  initTheme();
  bindEvents();
  try {
    const metadataPromise = Promise.all([loadFolders(), loadObjects(), loadReportTypes()]);
    if (REPORT_PAGE.mode === 'builder') {
      showReportPageLoading(REPORT_PAGE.reportId ? 'Loading report builder...' : 'Preparing new report...');
      await metadataPromise;
      if (REPORT_PAGE.reportId) {
        await openReport(REPORT_PAGE.reportId, { pushState: false });
      } else {
        await newReport({ localOnly: true });
      }
      hideReportPageLoading();
      loadReports({ silent: true }).catch(() => {});
      return;
    }
    if (REPORT_PAGE.mode === 'viewer') {
      showReportPageLoading('Opening report...');
      await metadataPromise;
      if (REPORT_PAGE.reportId) {
        await openReportViewer(REPORT_PAGE.reportId);
      } else {
        showReportViewError('No report selected.');
      }
      hideReportPageLoading();
      loadReports({ silent: true }).catch(() => {});
      return;
    }
    const hashReportId = reportIdFromHash();
    if (hashReportId) {
      showReportPageLoading('Opening report...');
      await metadataPromise;
      await openReportViewer(hashReportId);
      hideReportPageLoading();
      loadReports({ silent: true }).catch(() => {});
      return;
    }
    await metadataPromise;
    showReportListMode();
    await loadReports();
  } catch (err) {
    hideReportPageLoading();
    toast(err.message || 'Could not load reports', 'err');
  }
});

function bindEvents() {
  $('appSidebarToggle')?.addEventListener('click', toggleAppSidebar);
  $('newReportBtn').addEventListener('click', newReport);
  $('newFolderBtn')?.addEventListener('click', () => openFolderModal());
  $('newReportTypeBtn')?.addEventListener('click', openReportTypeModal);
  $('refreshReportsBtn').addEventListener('click', () => loadReports({ forceRefresh: true }));
  $('reportSearch').addEventListener('input', debounce(syncReportSearchAndLoad, 250));
  $('reportListSearch')?.addEventListener('input', debounce(syncReportSearchAndLoad, 250));
  $('toggleReportSidebarBtn')?.addEventListener('click', toggleReportSidebar);
  $('reportSidebarResizer')?.addEventListener('mousedown', startSidebarResize);
  $('toggleBuilderPanelBtn').addEventListener('click', (event) => {
    event.stopPropagation();
    toggleBuilderPanel();
  });
  $('expandChartBtn')?.addEventListener('click', openChartZoomModal);
  $('closeChartZoomBtn')?.addEventListener('click', closeChartZoomModal);
  $('chartZoomModal')?.addEventListener('click', (event) => {
    if (event.target?.id === 'chartZoomModal') closeChartZoomModal();
  });
  $('builderLeftResizer').addEventListener('mousedown', startBuilderPanelResize);
  $('builderLeftPanel')?.addEventListener('click', (event) => {
    const workspace = $('builderWorkspace');
    if (!workspace?.classList.contains('builder-panel-collapsed')) return;
    if (event.target.closest('#toggleBuilderPanelBtn') || event.currentTarget === event.target) {
      workspace.classList.remove('builder-panel-collapsed');
      sessionStorage.setItem('reports_builder_panel_collapsed', '0');
      updateBuilderPanelToggleText();
    }
  });
  document.addEventListener('mousemove', resizeReportSidebar);
  document.addEventListener('mousemove', resizeBuilderPanel);
  document.addEventListener('mouseup', stopSidebarResize);
  document.addEventListener('mouseup', stopBuilderPanelResize);
  document.addEventListener('click', (event) => {
    if (!event.target.closest('.report-action-menu') && !event.target.closest('.row-action-btn')) {
      closeReportActionMenu();
    }
  });
  $('autoPreviewToggle').addEventListener('change', () => {
    sessionStorage.setItem('reports_auto_preview', $('autoPreviewToggle').checked ? '1' : '0');
    scheduleAutoPreview();
  });
  $('reportFolder')?.addEventListener('change', markDirty);
  $('reportType').addEventListener('change', () => {
    markDirty();
    syncReportTypeUi();
    clearResults();
    scheduleAutoPreview();
  });
  $('reportTypeSource')?.addEventListener('change', async () => {
    const selected = selectedReportType();
    if (selected) {
      $('reportObject').value = selected.primary_object;
      updateObjectChip();
      state.selectedFields = [];
      await loadFields($('reportObject').value);
      renderSelectedFields();
    }
    markDirty();
    syncReportTypeUi();
    scheduleAutoPreview();
  });
  $('reportObject').addEventListener('change', async () => {
    markDirty();
    updateObjectChip();
    state.selectedFields = [];
    state.bucketFields = [];
    state.rowFormulas = [];
    state.summaryFormulas = [];
    state.conditionalFormatting = [];
    state.crossFilters = [];
    await loadFields($('reportObject').value);
    renderSelectedFields();
    renderAdvancedMetadata();
    renderCrossFilters();
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
  $('addCrossFilterBtn')?.addEventListener('click', addCrossFilter);
  $('runReportBtn').addEventListener('click', runPreview);
  $('runFullReportBtn').addEventListener('click', () => {
    runFullReport(REPORT_PAGE.mode === 'builder' ? { openViewer: true } : {});
  });
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
  $('refreshReportViewBtn')?.addEventListener('click', () => {
    if (state.activeReport?.id) openReportViewer(state.activeReport.id, { forceRefresh: true });
  });
  $('editReportBtn')?.addEventListener('click', () => {
    if (state.activeReport?.id) navigateToReportBuilder(state.activeReport.id);
  });
  $('cloneReportBtn').addEventListener('click', cloneReport);
  $('favoriteReportBtn').addEventListener('click', toggleFavorite);
  $('exportReportBtn').addEventListener('click', exportReport);
  $('exportExcelBtn')?.addEventListener('click', () => exportReport('xlsx'));
  $('asyncExportBtn')?.addEventListener('click', asyncExportReport);
  $('scheduleReportBtn')?.addEventListener('click', scheduleReport);
  $('deleteReportBtn').addEventListener('click', deleteReport);

  // Actions dropdown logic for Reports
  const reportActionsBtn = $('reportActionsBtn');
  const reportActionsMenu = $('reportActionsMenu');
  if (reportActionsBtn && reportActionsMenu) {
    reportActionsBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      reportActionsMenu.classList.toggle('show');
    });
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.actions-dropdown-container')) {
        reportActionsMenu.classList.remove('show');
      }
    });
  }

  $('actionReportFavorite')?.addEventListener('click', () => {
    reportActionsMenu?.classList.remove('show');
    $('favoriteReportBtn')?.click();
  });
  $('actionReportClone')?.addEventListener('click', () => {
    reportActionsMenu?.classList.remove('show');
    $('cloneReportBtn')?.click();
  });
  $('actionReportDelete')?.addEventListener('click', () => {
    reportActionsMenu?.classList.remove('show');
    $('deleteReportBtn')?.click();
  });
  $('actionReportExportCSV')?.addEventListener('click', () => {
    reportActionsMenu?.classList.remove('show');
    $('exportReportBtn')?.click();
  });
  $('actionReportExportExcel')?.addEventListener('click', () => {
    reportActionsMenu?.classList.remove('show');
    $('exportExcelBtn')?.click();
  });
  $('actionReportAsyncExport')?.addEventListener('click', () => {
    reportActionsMenu?.classList.remove('show');
    $('asyncExportBtn')?.click();
  });
  $('actionReportSchedule')?.addEventListener('click', () => {
    reportActionsMenu?.classList.remove('show');
    $('scheduleReportBtn')?.click();
  });
  $('actionReportPrint')?.addEventListener('click', () => {
    reportActionsMenu?.classList.remove('show');
    window.print();
  });

  $('addBucketFieldBtn')?.addEventListener('click', addBucketField);
  $('addRowFormulaBtn')?.addEventListener('click', addRowFormula);
  $('addSummaryFormulaBtn')?.addEventListener('click', addSummaryFormula);
  $('addConditionalFormatBtn')?.addEventListener('click', addConditionalFormat);
  $('advancedModalClose')?.addEventListener('click', closeAdvancedModal);
  $('advancedModalCancel')?.addEventListener('click', closeAdvancedModal);

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
  document.querySelectorAll('.home-nav-item[data-report-view]').forEach((item) => {
    item.addEventListener('click', function () {
      document.querySelectorAll('.home-nav-item').forEach((el) => el.classList.remove('active'));
      this.classList.add('active');
      state.reportView = this.dataset.reportView || 'recent';
      state.selectedFolderId = '';
      const label = this.textContent.trim();
      if ($('reportsTitle')) $('reportsTitle').textContent = label;
      loadReports();
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
  window.SaaSRAYSession?.markActivity?.();
  await window.SaaSRAYSession?.refreshSession?.().catch(() => null);
  const token = localStorage.getItem('saasray_token');
  if (!token) {
    window.location.href = '/';
    throw new Error('Login required');
  }
  const method = String(options.method || 'GET').toUpperCase();
  const cacheKey = browserCacheKey(path);
  if (method === 'GET' && cacheKey && !options.skipBrowserCache) {
    const cached = browserCacheGet(cacheKey);
    if (cached) return cached;
    if (browserInFlightRequests.has(cacheKey)) return browserInFlightRequests.get(cacheKey);
    if (sharedPerformanceCache?.fetchJson) {
      const sharedRequest = sharedPerformanceCache.fetchJson(path, {
        ...options,
        cacheKey,
        cacheType: 'resource',
        ttlMs: CLIENT_CACHE_TTL_MS,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          ...(options.headers || {})
        }
      });
      browserInFlightRequests.set(cacheKey, sharedRequest);
      sharedRequest
        .then((data) => browserCacheSet(cacheKey, data))
        .finally(() => browserInFlightRequests.delete(cacheKey))
        .catch(() => {});
      return sharedRequest;
    }
  }
  const fetcher = window.SaaSRAYSession?.authorizedFetch || fetch;
  const request = fetcher(path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(options.headers || {})
    }
  }).then(async (res) => {
    const text = await res.text();
    const data = text ? JSON.parse(text) : {};
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    if (method === 'GET' && cacheKey) browserCacheSet(cacheKey, data);
    if (method !== 'GET') browserCacheInvalidate(path);
    return data;
  });
  if (method === 'GET' && cacheKey) {
    browserInFlightRequests.set(cacheKey, request);
    request.finally(() => browserInFlightRequests.delete(cacheKey));
  }
  return request;
}

function browserCacheKey(path) {
  const cleanPath = String(path || '');
  const cacheable = [
    '/api/reports',
    '/api/reports/folders',
    '/api/reports/metadata',
    '/api/dashboards'
  ];
  if (!cacheable.some((prefix) => cleanPath === prefix || cleanPath.startsWith(`${prefix}/`) || cleanPath.startsWith(`${prefix}?`))) return '';
  if (cleanPath.includes('/run') || cleanPath.includes('/preview') || cleanPath.includes('/export')) return '';
  return `saasray:v1:${cleanPath}`;
}

function browserCacheGet(key) {
  const shared = sharedPerformanceCache?.getCacheValue?.(key, 'resource');
  if (shared) return shared;
  const item = browserMemoryCache.get(key);
  if (!item || Date.now() > item.expiresAt) {
    if (item) browserMemoryCache.delete(key);
    return null;
  }
  return item.value;
}

function browserCacheSet(key, value, ttlMs = 60 * 1000) {
  browserMemoryCache.set(key, { value, expiresAt: Date.now() + Math.min(ttlMs, CLIENT_CACHE_TTL_MS) });
  sharedPerformanceCache?.setCacheValue?.(key, value, {
    type: 'resource',
    ttlMs: Math.min(ttlMs, CLIENT_CACHE_TTL_MS)
  });
}

function sessionCacheGet(key) {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.expiresAt || parsed.expiresAt < Date.now()) {
      sessionStorage.removeItem(key);
      return null;
    }
    return parsed.value;
  } catch {
    return null;
  }
}

function sessionCacheSet(key, value, ttlMs = REPORT_METADATA_SESSION_TTL_MS) {
  try {
    sessionStorage.setItem(key, JSON.stringify({ value, expiresAt: Date.now() + ttlMs }));
  } catch {}
}

function clearReportSessionCache() {
  try {
    Object.keys(sessionStorage).forEach((key) => {
      if (key.startsWith(REPORT_SESSION_PREFIX)) sessionStorage.removeItem(key);
    });
  } catch {}
}

function reportListSessionKey(params) {
  return `${REPORT_SESSION_PREFIX}list:${params.toString() || 'default'}`;
}

function renderReportsFromData(reports) {
  state.reports = Array.isArray(reports) ? reports : [];
  const count = state.reports.length;
  if ($('reportCount')) $('reportCount').textContent = `${count} ${count === 1 ? 'item' : 'items'}`;
  if ($('reportsSubtitle')) $('reportsSubtitle').textContent = `${count} ${count === 1 ? 'item' : 'items'}`;
  renderReports();
}

function browserCacheInvalidate(path) {
  if (String(path || '').startsWith('/api/reports')) clearReportSessionCache();
  const scopes = String(path || '').startsWith('/api/dashboards')
    ? ['saasray:v1:/api/dashboards']
    : ['saasray:v1:/api/reports', 'saasray:v1:/api/dashboards'];
  for (const key of browserMemoryCache.keys()) {
    if (scopes.some((scope) => key.startsWith(scope))) browserMemoryCache.delete(key);
  }
  for (const key of browserInFlightRequests.keys()) {
    if (scopes.some((scope) => key.startsWith(scope))) browserInFlightRequests.delete(key);
  }
  scopes.forEach((scope) => sharedPerformanceCache?.invalidate?.(scope));
}

async function loadFolders(options = {}) {
  const sessionKey = `${REPORT_SESSION_PREFIX}folders`;
  const cached = !options.forceRefresh ? sessionCacheGet(sessionKey) : null;
  if (cached) {
    state.folders = cached.folders || [];
    renderFolderOptions();
    renderFolderNav();
    return;
  }

  const data = await api('/api/reports/folders', { skipBrowserCache: Boolean(options.forceRefresh) });
  state.folders = data.folders || [];
  sessionCacheSet(sessionKey, { folders: state.folders });
  renderFolderOptions();
  renderFolderNav();
}

function renderFolderOptions() {
  const select = $('reportFolder');
  if (!select) return;
  const current = select.value;
  select.innerHTML = [
    '<option value="">Private Reports</option>',
    ...state.folders.map((folder) => `<option value="${esc(folder.id)}">${esc(folder.name)}</option>`)
  ].join('');
  if ([...select.options].some((option) => option.value === current)) select.value = current;
}

function renderFolderNav() {
  const target = $('folderNavList');
  if (!target) return;
  target.innerHTML = state.folders.length
    ? state.folders.map((folder) => `
      <button class="home-nav-item folder-nav-item ${state.selectedFolderId === folder.id ? 'active' : ''}" type="button" onclick="selectReportFolder('${esc(folder.id)}')">
        ${esc(folder.name)}
      </button>
    `).join('')
    : '<div class="folder-empty">No folders yet</div>';
}

function selectReportFolder(folderId) {
  state.selectedFolderId = folderId || '';
  document.querySelectorAll('.home-nav-item').forEach((el) => el.classList.remove('active'));
  renderFolderNav();
  const folder = state.folders.find((item) => item.id === state.selectedFolderId);
  if ($('reportsTitle')) $('reportsTitle').textContent = folder ? folder.name : 'Recent';
  loadReports();
}

function openFolderModal(folder = null) {
  const existingFolder = folder && folder.id ? folder : null;
  openAdvancedModal({
    title: existingFolder ? 'Edit Folder' : 'New Report Folder',
    saveLabel: existingFolder ? 'Save Folder' : 'Create Folder',
    body: `
      <div class="advanced-modal-grid">
        <label>Folder Name<input id="folderModalName" value="${escAttr(existingFolder?.name || '')}" placeholder="e.g. Public Sales Reports"></label>
        <label>Visibility<select id="folderModalVisibility">
          <option value="private" ${existingFolder?.visibility !== 'public' ? 'selected' : ''}>Private</option>
          <option value="public" ${existingFolder?.visibility === 'public' ? 'selected' : ''}>Public</option>
        </select></label>
        <label style="grid-column:1 / -1">Description<input id="folderModalDescription" value="${escAttr(existingFolder?.description || '')}" placeholder="Optional description"></label>
      </div>
      <div class="advanced-preview-box">Folder metadata is stored in Supabase only. Salesforce records are not duplicated.</div>
      <div id="advancedValidation" class="advanced-validation"></div>
    `,
    onSave: async () => {
      const name = $('folderModalName').value.trim();
      if (!name) return setAdvancedValidation('Folder name is required.');
      const payload = {
        name,
        visibility: $('folderModalVisibility').value,
        description: $('folderModalDescription').value.trim()
      };
      const data = existingFolder
        ? await api(`/api/reports/folders/${existingFolder.id}`, { method: 'PATCH', body: JSON.stringify(payload) })
        : await api('/api/reports/folders', { method: 'POST', body: JSON.stringify(payload) });
      closeAdvancedModal();
      await loadFolders();
      if (!existingFolder && $('reportFolder')) $('reportFolder').value = data.folder.id;
      toast(existingFolder ? 'Folder updated' : 'Folder created', 'ok');
    }
  });
}

async function loadObjects() {
  const data = await api('/api/reports/metadata/objects');
  state.objects = data.objects || [];
  $('reportObject').innerHTML = state.objects
    .map((obj) => `<option value="${esc(obj.apiName)}">${esc(obj.label)}</option>`)
    .join('');
}

async function loadReportTypes() {
  const data = await api('/api/reports/metadata/types');
  state.reportTypes = data.reportTypes || [];
  const options = [
    '<option value="">Single Salesforce Object</option>',
    ...state.reportTypes.map((type) => `<option value="${esc(type.id)}">${esc(type.name)}</option>`)
  ];
  if ($('reportTypeSource')) $('reportTypeSource').innerHTML = options.join('');
}

function selectedReportType() {
  const id = $('reportTypeSource')?.value || '';
  return state.reportTypes.find((type) => type.id === id) || null;
}

async function loadReports(options = {}) {
  const q = ($('reportListSearch')?.value || $('reportSearch')?.value || '').trim();
  const params = new URLSearchParams();
  if (q) params.set('search', q);
  if (state.selectedFolderId) params.set('folderId', state.selectedFolderId);
  if (!state.selectedFolderId && state.reportView) params.set('view', state.reportView);

  const endpoint = `/api/reports${params.toString() ? `?${params.toString()}` : ''}`;
  const sessionKey = reportListSessionKey(params);
  const cached = !options.forceRefresh ? sessionCacheGet(sessionKey) : null;
  if (cached) {
    renderReportsFromData(cached.reports || []);
    return;
  }

  if (!options.silent) showReportsLoading();
  try {
    const data = await api(endpoint, {
      skipBrowserCache: Boolean(options.forceRefresh)
    });
    sessionCacheSet(sessionKey, { reports: data.reports || [] });
    renderReportsFromData(data.reports || []);
  } catch (err) {
    const list = $('reportsList');
    if (list) list.innerHTML = `<tr><td colspan="6" class="reports-empty-row">Could not load reports: ${esc(err.message)}</td></tr>`;
  }
}

function showReportsLoading() {
  const list = $('reportsList');
  if (!list) return;
  list.innerHTML = `
    <tr>
      <td colspan="6" class="reports-loading-row">
        <span class="mini-spinner"></span>
        Loading reports...
      </td>
    </tr>
  `;
}

function syncReportSearchAndLoad(event) {
  const value = event?.target?.value || '';
  if ($('reportSearch') && $('reportSearch') !== event?.target) $('reportSearch').value = value;
  if ($('reportListSearch') && $('reportListSearch') !== event?.target) $('reportListSearch').value = value;
  loadReports();
}

function openReportTypeModal() {
  const relationshipTemplates = reportRelationshipOptionsFromRegistry();
  const effectiveTemplates = relationshipTemplates.length
    ? relationshipTemplates
    : [
        { key: 'Account:Contact:AccountId', parentObject: 'Account', childObject: 'Contact', parentField: 'AccountId' },
        { key: 'Account:Opportunity:AccountId', parentObject: 'Account', childObject: 'Opportunity', parentField: 'AccountId' },
        { key: 'Account:Case:AccountId', parentObject: 'Account', childObject: 'Case', parentField: 'AccountId' },
        { key: 'Campaign:Lead:CampaignId', parentObject: 'Campaign', childObject: 'Lead', parentField: 'CampaignId' }
      ];
  const templates = Object.fromEntries(effectiveTemplates.map((item) => [
    item.key.toLowerCase().replace(/[^a-z0-9]+/g, '_'),
    {
      label: `${objectLabel(item.parentObject)} + ${objectLabel(item.childObject)}`,
      primaryObject: item.parentObject,
      childObject: item.childObject,
      childAlias: objectLabel(item.childObject),
      relationshipField: item.parentField
    }
  ]));
  openAdvancedModal({
    title: 'New Custom Report Type',
    saveLabel: 'Create Type',
    body: `
      <div class="advanced-modal-grid">
        <label><span>Report Type Name</span><input id="customTypeName" placeholder="Accounts with Active Contacts"></label>
        <label><span>Relationship</span>
          <select id="customTypeTemplate">
            ${Object.entries(templates).map(([key, value]) => `<option value="${esc(key)}">${esc(value.label)}</option>`).join('')}
          </select>
        </label>
        <label style="grid-column:1 / -1"><span>Description</span><input id="customTypeDescription" placeholder="Optional description"></label>
      </div>
      <div id="advancedValidation" class="advanced-validation"></div>
    `,
    onSave: async () => {
      const name = $('customTypeName').value.trim();
      const template = templates[$('customTypeTemplate').value];
      if (!name) return setAdvancedValidation('Enter a report type name.');
      const parentAlias = template.primaryObject;
      const definition = {
        primaryObject: template.primaryObject,
        objects: [
          { alias: parentAlias, object: template.primaryObject, label: template.primaryObject, relationship: 'primary' },
          { alias: template.childAlias, object: template.childObject, label: template.childObject, parentAlias, relationshipField: template.relationshipField }
        ],
        relationships: [
          { parentAlias, childAlias: template.childAlias, childObject: template.childObject, parentField: template.relationshipField }
        ]
      };
      const data = await api('/api/reports/metadata/types', {
        method: 'POST',
        body: JSON.stringify({
          name,
          description: $('customTypeDescription').value.trim(),
          primaryObject: template.primaryObject,
          definition
        })
      });
      closeAdvancedModal();
      await loadReportTypes();
      if ($('reportTypeSource')) $('reportTypeSource').value = data.reportType.id;
      toast('Custom report type created', 'ok');
    }
  });
}

function renderReports() {
  if (!state.reports.length) {
    $('reportsList').innerHTML = '<tr><td colspan="6" class="reports-empty-row">No reports found. Click <strong>New Report</strong> to create one.</td></tr>';
    return;
  }
  $('reportsList').innerHTML = state.reports.map((report) => `
    <tr class="${state.activeReport?.id === report.id ? 'active' : ''}">
      <td>
        <button class="report-name-link" onclick="openReportViewerFromList('${esc(report.id)}')">${report.is_favorite ? '<svg width="12" height="12" viewBox="0 0 24 24" fill="var(--warning)" stroke="var(--warning)" stroke-width="2" style="vertical-align:-1px;margin-right:4px"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>' : ''}${esc(report.name)}</button>
      </td>
      <td style="color:var(--text-2)">${esc(report.description || '—')}</td>
      <td>${esc(report.folder_name || 'Private Reports')}</td>
      <td>
        <span style="display:inline-flex;align-items:center;gap:4px;background:var(--surface-2);border:1px solid var(--border);border-radius:4px;padding:2px 8px;font-size:11px;font-weight:700;color:var(--text-2)">${esc(titleCase(report.report_type))}</span>
      </td>
      <td style="color:var(--text-2)">${new Date(report.updated_at).toLocaleString()}</td>
      <td class="report-action-cell">
        <button class="row-action-btn" onclick="toggleReportActionMenu('${esc(report.id)}', event)" title="Report actions">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/></svg>
        </button>
        ${state.reportActionMenuId === report.id ? renderReportActionMenu(report) : ''}
      </td>
    </tr>
  `).join('');
}

function toggleReportActionMenu(reportId, event) {
  event?.stopPropagation();
  state.reportActionMenuId = state.reportActionMenuId === reportId ? '' : reportId;
  renderReports();
}

function closeReportActionMenu() {
  if (!state.reportActionMenuId) return;
  state.reportActionMenuId = '';
  renderReports();
}

function renderReportActionMenu(report) {
  const canEdit = Boolean(report.can_edit);
  return `
    <div class="report-action-menu" onclick="event.stopPropagation()">
      <button onclick="runReportFromList('${esc(report.id)}')">Run</button>
      <button onclick="openReportViewerFromList('${esc(report.id)}')">View</button>
      <button onclick="navigateToReportBuilder('${esc(report.id)}')" ${canEdit ? '' : 'disabled'}>Edit</button>
      <button onclick="shareReportFromList('${esc(report.id)}')" ${canEdit ? '' : 'disabled'}>Share</button>
      <button onclick="scheduleReportFromList('${esc(report.id)}')" ${canEdit ? '' : 'disabled'}>Subscribe</button>
      <button onclick="exportReportFromList('${esc(report.id)}', 'csv')">Export CSV</button>
      <button onclick="exportReportFromList('${esc(report.id)}', 'xlsx')">Export Excel</button>
      <button onclick="addReportToDashboardFromList('${esc(report.id)}')" ${canEdit ? '' : 'disabled'}>Add to Dashboard</button>
      <button onclick="toggleFavoriteFromList('${esc(report.id)}')">${report.is_favorite ? 'Unfavorite' : 'Favorite'}</button>
      <button onclick="moveReportFromList('${esc(report.id)}')" ${canEdit ? '' : 'disabled'}>Move</button>
      <button class="danger" onclick="deleteReportFromList('${esc(report.id)}')" ${canEdit ? '' : 'disabled'}>Delete</button>
    </div>
  `;
}

async function openReport(id, options = {}) {
  const data = await api(`/api/reports/${id}`);
  state.activeReport = data.report;
  if (options.pushState !== false && !REPORT_PAGE.usesDedicatedPage) window.history.replaceState(null, '', `#report/${id}`);
  const definition = state.activeReport.definition || {};
  showBuilderMode();
  $('reportName').value = state.activeReport.name || '';
  $('reportDescription').value = state.activeReport.description || '';
  $('reportType').value = definition.reportType || state.activeReport.report_type || 'tabular';
  if ($('reportTypeSource')) $('reportTypeSource').value = definition.reportTypeId || '';
  $('reportObject').value = definition.primaryObject || state.activeReport.primary_object;
  updateObjectChip();
  $('reportLimit').value = definition.rowLimit || 200;
  if ($('reportFolder')) $('reportFolder').value = state.activeReport.folder_id || '';
  state.selectedFields = [...(definition.fields || [])];
  state.filters = [...(definition.filters || [])];
  state.crossFilters = [...(definition.crossFilters || [])];
  state.bucketFields = [...(definition.bucketFields || [])];
  state.rowFormulas = [...(definition.rowFormulas || [])];
  state.summaryFormulas = [...(definition.summaryFormulas || [])];
  state.conditionalFormatting = [...(definition.conditionalFormatting || [])];
  await loadFields($('reportObject').value);
  $('summaryGroupOne').value = definition.groupBy?.[0] || '';
  $('summaryGroupTwo').value = definition.groupBy?.[1] || '';
  $('matrixColumnGroup').value = definition.groupColumns?.[0] || '';
  const firstAggregate = (definition.aggregates || []).find((aggregate) => aggregate.function !== 'count') || (definition.aggregates || [])[0] || {};
  $('summaryAggregateFn').value = firstAggregate.function || 'count';
  $('summaryAggregateField').value = firstAggregate.field || '';
  state.chart = normalizeChartConfig(definition.chart);
  syncReportTypeUi();
  syncChartControls();
  markSaved();
  renderReports();
  renderSelectedFields();
  renderFilters();
  renderCrossFilters();
  renderAdvancedMetadata();
  renderGroupChips();
  clearResults();
}

async function newReport(options = {}) {
  if (REPORT_PAGE.mode === 'list' && !options.localOnly) {
    navigateToReportBuilder();
    return;
  }
  state.activeReport = null;
  showBuilderMode();
  $('reportName').value = 'New Tabular Report';
  $('reportDescription').value = '';
  $('reportType').value = 'tabular';
  if ($('reportTypeSource')) $('reportTypeSource').value = '';
  $('reportObject').value = state.objects[0]?.apiName || 'Account';
  updateObjectChip();
  $('reportLimit').value = 200;
  if ($('reportFolder')) $('reportFolder').value = '';
  state.selectedFields = [];
  state.filters = [];
  state.crossFilters = [];
  state.bucketFields = [];
  state.rowFormulas = [];
  state.summaryFormulas = [];
  state.conditionalFormatting = [];
  state.chart = normalizeChartConfig();
  await loadFields($('reportObject').value);
  syncReportTypeUi();
  syncChartControls();
  markDirty();
  renderReports();
  renderSelectedFields();
  renderFilters();
  renderCrossFilters();
  renderAdvancedMetadata();
  renderGroupChips();
  clearResults();
}

function showBuilderMode() {
  setReportUiMode('builder');
  state.wasSidebarCollapsedBeforeBuilder = document.body.classList.contains('sidebar-collapsed');
  if ($('reportsListView')) $('reportsListView').style.display = 'none';
  if ($('reportsHeader')) $('reportsHeader').style.display = 'none';
  if ($('reportBuilderView')) $('reportBuilderView').style.display = '';
  // CSS handles collapsing sidebar via body.reports-builder-mode rules
  document.body.classList.add('reports-builder-mode');
  document.body.classList.remove('reports-view-mode');
}

function showReportListMode() {
  setReportUiMode('list');
  if ($('reportBuilderView')) $('reportBuilderView').style.display = 'none';
  if ($('reportsListView')) $('reportsListView').style.display = '';
  if ($('reportsHeader')) $('reportsHeader').style.display = '';
  document.body.classList.remove('reports-builder-mode', 'reports-view-mode');
}

function showViewerMode() {
  setReportUiMode('viewer');
  if ($('reportsListView')) $('reportsListView').style.display = 'none';
  if ($('reportsHeader')) $('reportsHeader').style.display = 'none';
  if ($('reportBuilderView')) $('reportBuilderView').style.display = '';
  document.body.classList.add('reports-builder-mode', 'reports-view-mode');
}

function closeBuilder() {
  if (REPORT_PAGE.usesDedicatedPage) {
    window.location.href = reportListUrl();
    return;
  }
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

function reportRunCacheKey(reportId, definition) {
  return `report-run:${reportId || 'draft'}:${JSON.stringify(definition || {})}`;
}

function readReportRunCache(reportId, definition) {
  const entry = browserMemoryCache.get(reportRunCacheKey(reportId, definition));
  if (!entry) return null;
  if (Date.now() - entry.timestamp > REPORT_RUN_CACHE_TTL_MS) {
    browserMemoryCache.delete(reportRunCacheKey(reportId, definition));
    return null;
  }
  return entry.result;
}

function writeReportRunCache(reportId, definition, result) {
  if (!reportId || !result) return;
  browserMemoryCache.set(reportRunCacheKey(reportId, definition), {
    timestamp: Date.now(),
    result
  });
}

function reportRunDraftKey(reportId) {
  return `saasray:report-run-draft:${reportId}`;
}

function storeReportRunDraft(reportId, definition, result) {
  if (!reportId || !result) return;
  try {
    sessionStorage.setItem(reportRunDraftKey(reportId), JSON.stringify({
      timestamp: Date.now(),
      definition,
      result
    }));
  } catch {}
}

function readReportRunDraft(reportId) {
  if (!reportId) return null;
  try {
    const raw = sessionStorage.getItem(reportRunDraftKey(reportId));
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data?.result || Date.now() - data.timestamp > 2 * 60 * 1000) {
      sessionStorage.removeItem(reportRunDraftKey(reportId));
      return null;
    }
    return data;
  } catch {
    return null;
  }
}

function clearReportRunDraft(reportId) {
  if (!reportId) return;
  try {
    sessionStorage.removeItem(reportRunDraftKey(reportId));
  } catch {}
}

async function openReportViewer(reportId, options = {}) {
  showViewerMode();
  showReportViewLoading();
  try {
    await openReport(reportId, { pushState: false });
    showViewerMode();
    const definition = definitionFromForm();
    const draft = options.forceRefresh ? null : readReportRunDraft(reportId);
    if (draft?.result) {
      renderReport(draft.result, { previewMode: false, viewerMode: true });
      clearReportRunDraft(reportId);
      return;
    }
    const cached = options.forceRefresh ? null : readReportRunCache(reportId, definition);
    if (cached) {
      renderReport(cached, { previewMode: false, viewerMode: true });
      return;
    }
    await runFullReport({ silentBusy: true, stayOnPage: true, viewerMode: true });
  } catch (err) {
    showReportViewError(err.message || 'Could not load report');
  }
}

function openReportViewerFromList(reportId) {
  closeReportActionMenu();
  navigateToReportView(reportId);
}

function showReportViewLoading() {
  const head = $('reportResultsHead');
  const body = $('reportResultsBody');
  const foot = $('reportResultsFoot');
  if (head) head.innerHTML = '';
  if (foot) foot.innerHTML = '';
  if (body) {
    body.innerHTML = `
      <tr>
        <td class="report-run-loading-cell">
          <div class="report-run-loading">
            <span class="spinner"></span>
            <strong>Loading report...</strong>
            <span>Preparing secure Salesforce results.</span>
          </div>
        </td>
      </tr>
    `;
  }
}

function showReportViewError(message) {
  showViewerMode();
  const head = $('reportResultsHead');
  const body = $('reportResultsBody');
  const foot = $('reportResultsFoot');
  if (head) head.innerHTML = '';
  if (foot) foot.innerHTML = '';
  if (body) {
    body.innerHTML = `
      <tr>
        <td class="report-run-loading-cell">
          <div class="report-run-error">
            <strong>Could not load report</strong>
            <span>${esc(message)}</span>
          </div>
        </td>
      </tr>
    `;
  }
}

async function loadFields(objectName) {
  if (!objectName) return;
  const reportType = selectedReportType();
  const url = reportType
    ? `/api/reports/metadata/types/${encodeURIComponent(reportType.id)}/fields`
    : `/api/reports/metadata/${encodeURIComponent(objectName)}/fields`;
  const data = await api(url);
  state.fields = data.fields || [];
  if (!state.selectedFields.length) {
    const preferred = ['Name', 'Account.Name', 'Contact.Name', 'Contact.Email', 'Opportunity.Name', 'Case.CaseNumber', 'Campaign.Name', 'Lead.Name', 'Email', 'Phone', 'Status', 'StageName', 'Amount', 'CloseDate'];
    state.selectedFields = state.fields
      .filter((field) => preferred.includes(field.name))
      .slice(0, 6)
      .map((field) => field.name);
  }
  renderFieldList();
  renderSummaryFieldOptions();
  renderFilterFieldOptions();
  renderAdvancedMetadata();
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
  refreshChartFieldOptions(window.currentReportResult);
  renderChartForCurrentResult();
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

  const baseDefinition = {
    reportType,
    primaryObject: $('reportObject').value,
    reportTypeId: $('reportTypeSource')?.value || null,
    fields: state.selectedFields,
    groupBy: reportType === 'summary' || reportType === 'matrix' ? groupBy : [],
    groupColumns: reportType === 'matrix' ? groupColumns : [],
    aggregates: reportType === 'summary' || reportType === 'matrix' ? aggregates : [],
    bucketFields: state.bucketFields,
    rowFormulas: state.rowFormulas,
    summaryFormulas: reportType === 'summary' || reportType === 'matrix' ? state.summaryFormulas : [],
    conditionalFormatting: state.conditionalFormatting,
    crossFilters: state.crossFilters,
    chart: normalizeChartConfig(state.chart),
    filters: state.filters,
    sort: [],
    rowLimit: Number($('reportLimit').value || 200)
  };

  if (reportType === 'joined') {
    return {
      ...baseDefinition,
      blocks: [{
        id: 'block_1',
        name: `${$('reportObject').value} Block`,
        definition: {
          ...baseDefinition,
          reportType: state.selectedFields.length ? 'tabular' : 'summary',
          groupBy: groupBy.length ? groupBy : [],
          groupColumns: [],
          aggregates: aggregates
        }
      }]
    };
  }

  return baseDefinition;
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
    folderId: $('reportFolder')?.value || null,
    definition: definitionFromForm(),
    visibility: 'private'
  };
  const button = $('saveReportBtn');
  const indicator = $('draftIndicator');
  if (!options.silent && indicator) {
    indicator.textContent = 'Saving...';
    indicator.className = 'draft-indicator saving';
  }
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
    if (!options.silent && indicator) {
      indicator.textContent = 'Unsaved changes';
      indicator.className = 'draft-indicator dirty';
    }
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
    await runFullReport({ silentBusy: true, openViewer: true });
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
    renderReport(result, { previewMode: true });
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
    const definition = definitionFromForm();
    const result = await api('/api/reports/run', {
      method: 'POST',
      body: JSON.stringify({ definition })
    });
    writeReportRunCache(state.activeReport?.id, definition, result);
    if (options.openViewer && REPORT_PAGE.mode === 'builder' && state.activeReport?.id && !options.stayOnPage) {
      storeReportRunDraft(state.activeReport.id, definition, result);
      navigateToReportView(state.activeReport.id);
      return result;
    }
    renderReport(result, { previewMode: false, viewerMode: Boolean(options.viewerMode) });
    return result;
  } catch (err) {
    toast(err.message, 'err');
  } finally {
    if (!options.silentBusy) setBusy(button, false, 'Run');
  }
}

async function cloneReport() {
  if (!state.activeReport) return toast('Save the report before cloning', 'info');
  setPageBusy(true, 'Cloning report...');
  try {
    const data = await api(`/api/reports/${state.activeReport.id}/clone`, { method: 'POST', body: '{}' });
    await loadReports();
    await openReport(data.report.id);
    toast('Report cloned', 'ok');
  } finally {
    setPageBusy(false);
  }
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

async function exportReport(format = 'csv') {
  if (format && typeof format !== 'string') format = 'csv';
  format = format === 'xlsx' ? 'xlsx' : 'csv';
  if (!state.activeReport) return toast('Save the report before exporting', 'info');
  await window.SaaSRAYSession?.refreshSession?.().catch(() => null);
  const token = localStorage.getItem('saasray_token');
  const fetcher = window.SaaSRAYSession?.authorizedFetch || fetch;
  const res = await fetcher(`/api/reports/${state.activeReport.id}/export.${format}`, {
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
  link.download = `${($('reportName').value || 'report').replace(/[^a-z0-9_-]+/gi, '_')}.${format}`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

async function runReportFromList(reportId) {
  closeReportActionMenu();
  navigateToReportView(reportId);
}

async function exportReportFromList(reportId, format = 'csv') {
  closeReportActionMenu();
  const previous = state.activeReport;
  const report = state.reports.find((item) => item.id === reportId);
  state.activeReport = report || { id: reportId, name: 'report' };
  setPageBusy(true, `Exporting ${format === 'xlsx' ? 'Excel' : 'CSV'}...`);
  try {
    await exportReport(format);
  } finally {
    state.activeReport = previous;
    setPageBusy(false);
  }
}

async function toggleFavoriteFromList(reportId) {
  closeReportActionMenu();
  const report = state.reports.find((item) => item.id === reportId);
  if (!report) return;
  setPageBusy(true, report.is_favorite ? 'Removing favorite...' : 'Adding favorite...');
  try {
    await api(`/api/reports/${reportId}/favorite`, { method: report.is_favorite ? 'DELETE' : 'POST', body: report.is_favorite ? undefined : '{}' });
    await loadReports();
  } finally {
    setPageBusy(false);
  }
}

async function deleteReportFromList(reportId) {
  closeReportActionMenu();
  const report = state.reports.find((item) => item.id === reportId);
  if (!report || !confirm(`Delete "${report.name}"?`)) return;
  setPageBusy(true, 'Deleting report...');
  try {
    await api(`/api/reports/${reportId}`, { method: 'DELETE' });
    if (state.activeReport?.id === reportId) state.activeReport = null;
    await loadReports();
    toast('Report deleted', 'ok');
  } finally {
    setPageBusy(false);
  }
}

function moveReportFromList(reportId) {
  closeReportActionMenu();
  const report = state.reports.find((item) => item.id === reportId);
  if (!report) return;
  openMoveReportModal(report);
}

function shareReportFromList(reportId) {
  closeReportActionMenu();
  const report = state.reports.find((item) => item.id === reportId);
  if (!report) return;
  openShareReportModal(report);
}

function scheduleReportFromList(reportId) {
  closeReportActionMenu();
  const report = state.reports.find((item) => item.id === reportId);
  if (!report) return;
  state.activeReport = report;
  scheduleReport();
}

async function addReportToDashboardFromList(reportId) {
  closeReportActionMenu();
  const report = state.reports.find((item) => item.id === reportId);
  if (!report) return;
  setPageBusy(true, 'Loading dashboards...');
  try {
    const data = await api('/api/dashboards');
    setPageBusy(false);
    const dashboards = data.dashboards || [];
    if (!dashboards.length) return toast('Create a dashboard first, then add this report.', 'info');
    openAdvancedModal({
      title: 'Add to Dashboard',
      saveLabel: 'Add',
      body: `
        <div class="advanced-modal-grid">
          <label>Dashboard<select id="addDashboardId">
            ${dashboards.map((dashboard) => `<option value="${esc(dashboard.id)}">${esc(dashboard.name)}</option>`).join('')}
          </select></label>
          <label>Component Type<select id="addDashboardType">
            <option value="chart">Chart</option>
            <option value="table">Table</option>
            <option value="kpi">KPI</option>
          </select></label>
          <label style="grid-column:1 / -1">Component Title<input id="addDashboardTitle" value="${escAttr(report.name)}"></label>
        </div>
        <div id="advancedValidation" class="advanced-validation"></div>
      `,
      onSave: async () => {
        const dashboardId = $('addDashboardId').value;
        if (!dashboardId) return setAdvancedValidation('Select a dashboard.');
        setAdvancedValidation('Adding component...', 'advancedValidation', 'ok');
        await api(`/api/dashboards/${dashboardId}/components`, {
          method: 'POST',
          body: JSON.stringify({
            reportId,
            title: $('addDashboardTitle').value.trim() || report.name,
            componentType: $('addDashboardType').value,
            width: 6,
            height: 3,
            config: { chartType: report.definition?.chart?.type || 'bar' }
          })
        });
        closeAdvancedModal();
        toast('Report added to dashboard', 'ok');
      }
    });
  } catch (err) {
    setPageBusy(false);
    toast(err.message || 'Could not load dashboards', 'err');
  }
}

function openMoveReportModal(report) {
  openAdvancedModal({
    title: 'Move Report',
    saveLabel: 'Move',
    body: `
      <div class="advanced-modal-grid">
        <label style="grid-column:1 / -1">Folder<select id="moveReportFolder">
          <option value="">Private Reports</option>
          ${state.folders.map((folder) => `<option value="${esc(folder.id)}" ${report.folder_id === folder.id ? 'selected' : ''}>${esc(folder.name)}</option>`).join('')}
        </select></label>
      </div>
      <div id="advancedValidation" class="advanced-validation"></div>
    `,
    onSave: async () => {
      setAdvancedValidation('Moving...', 'advancedValidation', 'ok');
      await api(`/api/reports/${report.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ name: report.name, folderId: $('moveReportFolder').value || null })
      });
      closeAdvancedModal();
      await loadReports();
      toast('Report moved', 'ok');
    }
  });
}

function openShareReportModal(report) {
  openAdvancedModal({
    title: 'Share Report',
    saveLabel: 'Share',
    body: `
      <div class="advanced-modal-grid">
        <label>User Email<input id="shareReportEmail" placeholder="user@example.com"></label>
        <label>Access<select id="shareReportAccess">
          <option value="read">View Only</option>
          <option value="edit">View and Edit</option>
        </select></label>
      </div>
      <div class="advanced-preview-box">Private reports can be shared with portal users without changing Salesforce data access. Report results still enforce object, field, and record security.</div>
      <div id="advancedValidation" class="advanced-validation"></div>
    `,
    onSave: async () => {
      const email = $('shareReportEmail').value.trim();
      if (!email) return setAdvancedValidation('Enter a user email.');
      setAdvancedValidation('Sharing...', 'advancedValidation', 'ok');
      await api(`/api/reports/${report.id}/shares`, {
        method: 'POST',
        body: JSON.stringify({ email, accessLevel: $('shareReportAccess').value })
      });
      closeAdvancedModal();
      await loadReports();
      toast('Report shared', 'ok');
    }
  });
}

async function asyncExportReport() {
  if (!state.activeReport) return toast('Save the report before starting an export job', 'info');
  const format = confirm('Create Excel async export? Click Cancel for CSV.') ? 'xlsx' : 'csv';
  const data = await api(`/api/reports/${state.activeReport.id}/export-jobs`, {
    method: 'POST',
    body: JSON.stringify({ format })
  });
  toast('Export job started', 'ok');
  pollExportJob(data.job.id);
}

async function pollExportJob(jobId, tries = 0) {
  const data = await api(`/api/reports/export-jobs/${jobId}`);
  if (data.job.status === 'completed') {
    toast('Export ready. Downloading...', 'ok');
    await downloadExportJob(jobId, data.job);
    return;
  }
  if (data.job.status === 'failed') return toast(data.job.error_message || 'Export failed', 'err');
  if (tries < 30) setTimeout(() => pollExportJob(jobId, tries + 1), 1500);
}

async function downloadExportJob(jobId, job) {
  await window.SaaSRAYSession?.refreshSession?.().catch(() => null);
  const token = localStorage.getItem('saasray_token');
  const fetcher = window.SaaSRAYSession?.authorizedFetch || fetch;
  const res = await fetcher(`/api/reports/export-jobs/${jobId}/download`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!res.ok) return toast('Could not download export job', 'err');
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = job.file_name || `report.${job.format || 'csv'}`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

async function scheduleReport() {
  if (!state.activeReport) return toast('Save the report before scheduling', 'info');
  openAdvancedModal({
    title: 'Schedule Report',
    saveLabel: 'Save Schedule',
    body: `
      <div class="advanced-modal-grid">
        <label><span>Recipients</span><input id="scheduleRecipients" placeholder="user@example.com, team@example.com"></label>
        <label><span>Frequency</span>
          <select id="scheduleCron">
            <option value="0 8 * * 1">Weekly - Monday 8 AM</option>
            <option value="0 8 * * *">Daily - 8 AM</option>
            <option value="0 8 1 * *">Monthly - first day 8 AM</option>
          </select>
        </label>
        <label><span>Format</span>
          <select id="scheduleFormat"><option value="csv">CSV</option><option value="xlsx">Excel</option></select>
        </label>
        <label><span>Status</span>
          <select id="scheduleActive"><option value="true">Active</option><option value="false">Inactive</option></select>
        </label>
      </div>
      <div id="advancedValidation" class="advanced-validation"></div>
    `,
    onSave: async () => {
      const recipients = $('scheduleRecipients').value.trim();
      if (!recipients) return setAdvancedValidation('Enter at least one recipient.');
      await api(`/api/reports/${state.activeReport.id}/schedules`, {
        method: 'POST',
        body: JSON.stringify({
          recipients,
          cronExpression: $('scheduleCron').value,
          format: $('scheduleFormat').value,
          isActive: $('scheduleActive').value === 'true',
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
        })
      });
      closeAdvancedModal();
      toast('Report schedule saved', 'ok');
    }
  });
}

function renderReport(result, options = { previewMode: true }) {
  return renderResults(result, options);
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
  if (type === 'joined') return 'Run Joined';
  return 'Run Preview';
}

function renderResultTable(result, options = { previewMode: true }) {
  window.currentReportResult = result;
  window.currentReportResultOptions = options;
  const columns = result.columns || [];

  if (result.reportType === 'joined') {
    const blockHtml = (result.blocks || []).map((block) => {
      const blockResult = block.result || {};
      const blockColumns = blockResult.columns || [];
      const rows = (blockResult.rows || []).map((row) => `
        <tr>${blockColumns.map((column) => `<td class="${cellFormatClass(row, column.field)}">${esc(readPath(row, column.field) ?? '')}</td>`).join('')}</tr>
      `).join('') || `<tr><td colspan="${Math.max(blockColumns.length, 1)}" class="muted" style="text-align:center;padding:20px">No rows found</td></tr>`;
      return `
        <tr class="summary-group-row"><td colspan="99">${esc(block.name || blockResult.reportName || 'Report Block')}</td></tr>
        <tr>${blockColumns.map((column) => `<th>${esc(column.label)}</th>`).join('')}</tr>
        ${rows}
      `;
    }).join('');
    $('reportResultsHead').innerHTML = '<tr><th>Joined Report Blocks</th></tr>';
    $('reportResultsBody').innerHTML = blockHtml || '<tr><td class="muted" style="text-align:center;padding:32px">No blocks configured</td></tr>';
    $('reportResultsFoot').innerHTML = '';
    $('reportResultMeta').textContent = `${result.blocks?.length || 0} blocks, ${result.totalSize || 0} rows`;
    return;
  }

  // Column headers with sort indicators
  $('reportResultsHead').innerHTML = `<tr>${columns.map((column) => `<th>${esc(column.label)} <span class="col-sort-indicator">↕</span></th>`).join('')}</tr>`;
  $('reportResultsFoot').innerHTML = '';

  if (result.reportType === 'matrix') {
    renderMatrixTable(result, columns);
  } else if (result.reportType === 'summary') {
    renderSummaryTable(result, columns);
  } else {
    $('reportResultsBody').innerHTML = (result.rows || []).map((row) => `
      <tr>${columns.map((column) => `<td class="${cellFormatClass(row, column.field)}">${esc(readPath(row, column.field) ?? '')}</td>`).join('')}</tr>
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
  const allowedTypes = [
    'bar', 'column', 'stacked_bar', 'stacked_column',
    'line', 'area', 'stacked_area', 'pie', 'donut',
    'scatter', 'bubble', 'funnel', 'gauge', 'treemap',
    'heatmap', 'combo'
  ];
  return {
    enabled: Boolean(chart.enabled),
    type: allowedTypes.includes(chart.type) ? chart.type : 'bar',
    labelField: chart.labelField || '',
    valueField: chart.valueField || '',
    title: chart.title || '',
    subtitle: chart.subtitle || '',
    legendPosition: chart.legendPosition || 'right',
    xAxisLabel: chart.xAxisLabel || '',
    yAxisLabel: chart.yAxisLabel || '',
    sortOrder: chart.sortOrder || 'none',
    colors: Array.isArray(chart.colors) ? chart.colors.slice(0, 12) : [],
    showDataLabels: chart.showDataLabels !== false,
    nullHandling: chart.nullHandling || 'zero',
    stacked: Boolean(chart.stacked)
  };
}

function enableChart() {
  state.chart = normalizeChartConfig({ ...state.chart, enabled: true });
  syncChartControls();
  markDirty();
  renderChartForCurrentResult();
  openChartPropertiesModal();
}

function removeChart() {
  state.chart = normalizeChartConfig({ enabled: false });
  syncChartControls();
  markDirty();
  renderChartForCurrentResult();
}

function syncChartFromControls() {
  state.chart = normalizeChartConfig({
    ...state.chart,
    enabled: true,
    type: $('chartType')?.value || state.chart.type,
    labelField: $('chartLabelField')?.value || state.chart.labelField,
    valueField: $('chartValueField')?.value || state.chart.valueField
  });
  syncChartControls();
}

function syncChartControls() {
  const chart = normalizeChartConfig(state.chart);
  state.chart = chart;
  if ($('chartConfigStrip')) $('chartConfigStrip').style.display = chart.enabled ? '' : 'none';
  if ($('chartType')) $('chartType').value = chart.type;
  refreshChartFieldOptions(window.currentReportResult);
}

function openChartPropertiesModal() {
  state.chart = normalizeChartConfig({ ...state.chart, enabled: true });
  const options = chartFieldOptions(window.currentReportResult);
  openAdvancedModal({
    title: 'Chart Properties',
    saveLabel: 'Save Chart',
    body: `
      <div class="advanced-modal-grid chart-modal-grid">
        <label>Chart Type<select id="chartModalType">
          ${chartTypeOptions().map((type) => `<option value="${esc(type.value)}" ${state.chart.type === type.value ? 'selected' : ''}>${esc(type.label)}</option>`).join('')}
        </select></label>
        <label>Title<input id="chartModalTitle" value="${escAttr(state.chart.title)}" placeholder="Report Chart"></label>
        <label>Subtitle<input id="chartModalSubtitle" value="${escAttr(state.chart.subtitle)}" placeholder="Optional subtitle"></label>
        <label>Legend<select id="chartModalLegend">
          ${['right', 'bottom', 'left', 'top', 'none'].map((item) => `<option value="${item}" ${state.chart.legendPosition === item ? 'selected' : ''}>${esc(titleCase(item))}</option>`).join('')}
        </select></label>
        <label>Label Field<select id="chartModalLabel">
          ${options.labels.map((field) => `<option value="${esc(field.field)}" ${state.chart.labelField === field.field ? 'selected' : ''}>${esc(field.label)}</option>`).join('')}
        </select></label>
        <label>Value Field<select id="chartModalValue">
          ${options.values.map((field) => `<option value="${esc(field.field)}" ${state.chart.valueField === field.field ? 'selected' : ''}>${esc(field.label)}</option>`).join('')}
        </select></label>
        <label>X Axis<input id="chartModalXAxis" value="${escAttr(state.chart.xAxisLabel)}" placeholder="Optional axis label"></label>
        <label>Y Axis<input id="chartModalYAxis" value="${escAttr(state.chart.yAxisLabel)}" placeholder="Optional axis label"></label>
        <label>Sort<select id="chartModalSort">
          ${[
            ['none', 'Report order'],
            ['label_asc', 'Label ascending'],
            ['label_desc', 'Label descending'],
            ['value_asc', 'Value ascending'],
            ['value_desc', 'Value descending']
          ].map(([value, label]) => `<option value="${value}" ${state.chart.sortOrder === value ? 'selected' : ''}>${esc(label)}</option>`).join('')}
        </select></label>
        <label>Null Handling<select id="chartModalNulls">
          <option value="zero" ${state.chart.nullHandling === 'zero' ? 'selected' : ''}>Show as zero</option>
          <option value="exclude" ${state.chart.nullHandling === 'exclude' ? 'selected' : ''}>Exclude nulls</option>
        </select></label>
      </div>
      <label class="modal-check"><input id="chartModalLabels" type="checkbox" ${state.chart.showDataLabels ? 'checked' : ''}> Show data labels</label>
      <label class="modal-check"><input id="chartModalStacked" type="checkbox" ${state.chart.stacked ? 'checked' : ''}> Stack series where supported</label>
      <div class="advanced-preview-box">Chart changes reuse the current report result. No Salesforce query runs until Preview or Run.</div>
      <div id="advancedValidation" class="advanced-validation"></div>
    `,
    onSave: () => {
      state.chart = normalizeChartConfig({
        enabled: true,
        type: $('chartModalType').value,
        labelField: $('chartModalLabel').value,
        valueField: $('chartModalValue').value,
        title: $('chartModalTitle').value.trim(),
        subtitle: $('chartModalSubtitle').value.trim(),
        legendPosition: $('chartModalLegend').value,
        xAxisLabel: $('chartModalXAxis').value.trim(),
        yAxisLabel: $('chartModalYAxis').value.trim(),
        sortOrder: $('chartModalSort').value,
        nullHandling: $('chartModalNulls').value,
        showDataLabels: $('chartModalLabels').checked,
        stacked: $('chartModalStacked').checked
      });
      closeAdvancedModal();
      syncChartControls();
      markDirty();
      renderChartForCurrentResult();
    }
  });
}

function chartTypeOptions() {
  return [
    ['bar', 'Bar'],
    ['column', 'Column'],
    ['stacked_bar', 'Stacked Bar'],
    ['stacked_column', 'Stacked Column'],
    ['line', 'Line'],
    ['area', 'Area'],
    ['stacked_area', 'Stacked Area'],
    ['pie', 'Pie'],
    ['donut', 'Donut'],
    ['scatter', 'Scatter Plot'],
    ['bubble', 'Bubble Chart'],
    ['funnel', 'Funnel'],
    ['gauge', 'Gauge'],
    ['treemap', 'Treemap'],
    ['heatmap', 'Heat Map'],
    ['combo', 'Combo Chart']
  ].map(([value, label]) => ({ value, label }));
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
  if ($('reportChartTitle')) $('reportChartTitle').textContent = state.chart.title || `${titleCase(state.chart.type.replace(/_/g, ' '))} Chart`;
  if ($('reportChartSubtitle')) {
    $('reportChartSubtitle').textContent = state.chart.subtitle || (points.length
      ? `${labelForChartField(state.chart.valueField)} by ${labelForChartField(state.chart.labelField)}`
      : 'Run Preview or Run Report to populate the chart');
  }
  canvas.innerHTML = points.length
    ? renderChartSvg(points, state.chart.type)
    : '<div class="chart-empty">Run Preview or Run Report to populate the chart.</div>';
}

function openChartZoomModal() {
  const modal = $('chartZoomModal');
  const body = $('chartZoomBody');
  if (!modal || !body || !state.chart?.enabled) return;

  const points = buildChartPoints(window.currentReportResult);
  if ($('chartZoomTitle')) $('chartZoomTitle').textContent = $('reportChartTitle')?.textContent || 'Report Chart';
  if ($('chartZoomSubtitle')) $('chartZoomSubtitle').textContent = $('reportChartSubtitle')?.textContent || 'Uses current preview or run results';
  body.innerHTML = points.length
    ? renderChartSvg(points, state.chart.type)
    : '<div class="chart-empty">Run Preview or Run Report to populate the chart.</div>';
  modal.style.display = 'flex';
  document.body.classList.add('modal-open');
}

function closeChartZoomModal() {
  const modal = $('chartZoomModal');
  if (!modal) return;
  modal.style.display = 'none';
  $('chartZoomBody') && ($('chartZoomBody').innerHTML = '');
  document.body.classList.remove('modal-open');
}

function labelForChartField(field) {
  const options = chartFieldOptions(window.currentReportResult);
  return options.labels.concat(options.values).find((option) => option.field === field)?.label || field || 'Value';
}

function buildChartPoints(result) {
  if (!result?.rows?.length) return [];
  const labelField = state.chart.labelField || chartFieldOptions(result).labels[0]?.field;
  const valueField = state.chart.valueField || chartFieldOptions(result).values[0]?.field;
  const normalizeValue = (value) => {
    if ((value === null || value === undefined || value === '') && state.chart.nullHandling === 'exclude') return null;
    const number = Number(value || 0);
    return Number.isFinite(number) ? number : null;
  };

  if (result.reportType === 'tabular') {
    const grouped = new Map();
    result.rows.forEach((row) => {
      const label = String(readPath(row, labelField) ?? '(Blank)');
      const increment = valueField === '__count' ? 1 : normalizeValue(readPath(row, valueField));
      if (increment === null) return;
      grouped.set(label, (grouped.get(label) || 0) + increment);
    });
    return sortChartPoints(Array.from(grouped.entries()).map(([label, value]) => ({ label, value }))).slice(0, 12);
  }

  return sortChartPoints(result.rows.map((row) => ({
    label: String(readPath(row, labelField) ?? '(Blank)'),
    value: valueField === '__count' ? 1 : normalizeValue(readPath(row, valueField))
  })).filter((point) => Number.isFinite(point.value))).slice(0, 12);
}

function sortChartPoints(points) {
  const order = state.chart?.sortOrder || 'none';
  const sorted = [...points];
  if (order === 'label_asc') sorted.sort((a, b) => a.label.localeCompare(b.label));
  if (order === 'label_desc') sorted.sort((a, b) => b.label.localeCompare(a.label));
  if (order === 'value_asc') sorted.sort((a, b) => a.value - b.value);
  if (order === 'value_desc') sorted.sort((a, b) => b.value - a.value);
  return sorted;
}

function renderChartSvg(points, type) {
  if (type === 'funnel') return renderFunnelChart(points);
  if (type === 'gauge') return renderGaugeChart(points);
  if (type === 'treemap') return renderTreemapChart(points);
  if (type === 'heatmap') return renderHeatmapChart(points);
  if (type === 'pie') return renderPieChart(points);
  if (type === 'donut') return renderDonutChart(points);
  if (['bar', 'stacked_bar'].includes(type)) return renderHorizontalBarChart(points);
  if (['line', 'area', 'stacked_area', 'combo', 'scatter', 'bubble'].includes(type)) return renderLineChart(points, type);
  return renderBarChart(points, type);
}

function renderBarChart(points, type = 'column') {
  const width = Math.max(820, points.length * 92 + 90);
  const height = 260;
  const top = 20;
  const left = 46;
  const chartHeight = 170;
  const max = Math.max(...points.map((point) => point.value), 1);
  const slot = (width - left - 24) / points.length;
  const colors = chartColors();
  const bars = points.map((point, index) => {
    const barHeight = Math.max((point.value / max) * chartHeight, 2);
    const x = left + index * slot + slot * 0.2;
    const y = top + chartHeight - barHeight;
    const w = Math.max(slot * 0.55, 10);
    const fill = type === 'stacked_column' ? ` fill="${colors[index % colors.length]}"` : '';
    return `
      <rect class="chart-bar" x="${x}" y="${y}" width="${w}" height="${barHeight}" rx="3"${fill}></rect>
      ${state.chart.showDataLabels ? `<text class="chart-value" x="${x + w / 2}" y="${y - 6}" text-anchor="middle">${esc(formatChartNumber(point.value))}</text>` : ''}
      <text class="chart-label" x="${x + w / 2}" y="${top + chartHeight + 28}" text-anchor="middle">${esc(shortLabel(point.label, 18))}</text>
    `;
  }).join('');
  return `<svg class="chart-svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img">
    <line class="chart-axis" x1="${left}" y1="${top + chartHeight}" x2="${width - 20}" y2="${top + chartHeight}"></line>
    ${bars}
  </svg>`;
}

function renderHorizontalBarChart(points) {
  const height = Math.max(230, points.length * 34 + 46);
  const width = 820;
  const left = 180;
  const right = 40;
  const top = 20;
  const rowHeight = 26;
  const gap = 8;
  const max = Math.max(...points.map((point) => point.value), 1);
  const colors = chartColors();
  const bars = points.map((point, index) => {
    const y = top + index * (rowHeight + gap);
    const w = Math.max(((width - left - right) * point.value) / max, 3);
    return `
      <text class="chart-label" x="${left - 10}" y="${y + 17}" text-anchor="end">${esc(shortLabel(point.label, 24))}</text>
      <rect class="chart-bar" x="${left}" y="${y}" width="${w}" height="${rowHeight}" rx="3" fill="${colors[index % colors.length]}"></rect>
      ${state.chart.showDataLabels ? `<text class="chart-value" x="${left + w + 8}" y="${y + 17}">${esc(formatChartNumber(point.value))}</text>` : ''}
    `;
  }).join('');
  return `<svg class="chart-svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img">${bars}</svg>`;
}

function renderLineChart(points, type = 'line') {
  const width = Math.max(820, points.length * 92 + 90);
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
  const areaPath = `M ${left} ${top + chartHeight} ${path.replace(/^M/, 'L')} L ${coords.at(-1)?.x || left} ${top + chartHeight} Z`;
  const markers = coords.map((coord, index) => {
    const radius = type === 'bubble' ? Math.max(4, Math.min(16, 5 + (coord.point.value / max) * 12)) : 4;
    if (type === 'scatter' || type === 'bubble') {
      return `<circle class="chart-point" cx="${coord.x}" cy="${coord.y}" r="${radius}"></circle>
        ${state.chart.showDataLabels ? `<text class="chart-value" x="${coord.x}" y="${coord.y - radius - 5}" text-anchor="middle">${esc(formatChartNumber(coord.point.value))}</text>` : ''}`;
    }
    return `<circle class="chart-point" cx="${coord.x}" cy="${coord.y}" r="4"></circle>
      ${state.chart.showDataLabels ? `<text class="chart-value" x="${coord.x}" y="${coord.y - 9}" text-anchor="middle">${esc(formatChartNumber(coord.point.value))}</text>` : ''}
      <text class="chart-label" x="${coord.x}" y="${top + chartHeight + 28}" text-anchor="middle">${esc(shortLabel(coord.point.label, 18))}</text>`;
  }).join('');
  return `<svg class="chart-svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img">
    <line class="chart-axis" x1="${left}" y1="${top + chartHeight}" x2="${width - 20}" y2="${top + chartHeight}"></line>
    ${['area', 'stacked_area', 'combo'].includes(type) ? `<path class="chart-area" d="${areaPath}"></path>` : ''}
    ${['scatter', 'bubble'].includes(type) ? '' : `<path class="chart-line" d="${path}"></path>`}
    ${type === 'combo' ? renderComboBars(points, width, left, top, chartHeight, max) : ''}
    ${markers}
  </svg>`;
}

function renderComboBars(points, width, left, top, chartHeight, max) {
  const slot = (width - left - 40) / Math.max(points.length, 1);
  return points.map((point, index) => {
    const h = Math.max((point.value / max) * chartHeight, 2);
    const x = left + index * slot + slot * 0.3;
    const y = top + chartHeight - h;
    return `<rect class="chart-bar combo-bar" x="${x}" y="${y}" width="${Math.max(slot * 0.24, 8)}" height="${h}" rx="2"></rect>`;
  }).join('');
}

function chartColors() {
  return ['#0176d3', '#2e844a', '#ba0517', '#dd7a01', '#747474', '#706eec', '#06a59a', '#8e44ad', '#e67e22', '#1b96ff', '#45c65a', '#ffb75d'];
}

function renderFunnelChart(points) {
  const ordered = [...points]
    .filter((point) => Number(point.value) > 0)
    .sort((a, b) => b.value - a.value);
  if (!ordered.length) return '<div class="chart-empty">No positive values to display in the funnel.</div>';

  const colors = chartColors();
  const max = Math.max(...ordered.map((point) => point.value), 1);
  const stageHeight = 36;
  const gap = 4;
  const width = 760;
  const left = 34;
  const center = 280;
  const top = 14;
  const totalHeight = top * 2 + ordered.length * (stageHeight + gap);
  const stages = ordered.map((point, index) => {
    const currentWidth = Math.max(96, 430 * (point.value / max));
    const nextValue = ordered[index + 1]?.value ?? Math.max(point.value * 0.72, 1);
    const nextWidth = Math.max(72, 430 * (nextValue / max));
    const y = top + index * (stageHeight + gap);
    const pointsAttr = [
      `${center - currentWidth / 2},${y}`,
      `${center + currentWidth / 2},${y}`,
      `${center + nextWidth / 2},${y + stageHeight}`,
      `${center - nextWidth / 2},${y + stageHeight}`
    ].join(' ');
    return `
      <polygon class="funnel-stage" points="${pointsAttr}" fill="${colors[index % colors.length]}"></polygon>
      <text class="funnel-stage-label" x="${center}" y="${y + 22}" text-anchor="middle">${esc(shortLabel(point.label, 24))}</text>
      ${state.chart.showDataLabels ? `<text class="funnel-stage-value" x="${center + currentWidth / 2 + 18}" y="${y + 22}">${esc(formatChartNumber(point.value))}</text>` : ''}
    `;
  }).join('');
  const legend = ordered.map((point, index) => `
    <div class="chart-legend-item"><span style="background:${colors[index % colors.length]}"></span>${esc(shortLabel(point.label, 28))}<strong>${esc(formatChartNumber(point.value))}</strong></div>
  `).join('');
  return `<div class="funnel-chart">
    <svg class="funnel-svg" width="${width}" height="${Math.max(totalHeight, 190)}" viewBox="0 0 ${width} ${Math.max(totalHeight, 190)}" role="img">
      ${stages}
    </svg>
    <div class="chart-legend funnel-legend">${legend}</div>
  </div>`;
}

function renderGaugeChart(points) {
  const value = points.reduce((sum, point) => sum + Math.max(point.value, 0), 0);
  const max = Math.max(value * 1.25, 100);
  const pct = Math.max(0, Math.min(value / max, 1));
  const angle = -90 + pct * 180;
  const needleX = 120 + Math.cos((angle * Math.PI) / 180) * 76;
  const needleY = 118 + Math.sin((angle * Math.PI) / 180) * 76;
  return `<div class="gauge-chart">
    <svg class="gauge-svg" width="300" height="190" viewBox="0 0 300 190" role="img">
      <path class="gauge-track" d="M40 120 A80 80 0 0 1 200 120"></path>
      <path class="gauge-low" d="M40 120 A80 80 0 0 1 92 45"></path>
      <path class="gauge-mid" d="M92 45 A80 80 0 0 1 148 45"></path>
      <path class="gauge-high" d="M148 45 A80 80 0 0 1 200 120"></path>
      <line class="gauge-needle" x1="120" y1="120" x2="${needleX}" y2="${needleY}"></line>
      <circle class="gauge-pin" cx="120" cy="120" r="6"></circle>
      <text class="donut-total" x="120" y="154" text-anchor="middle">${esc(formatChartNumber(value))}</text>
      <text class="donut-caption" x="120" y="172" text-anchor="middle">${esc(labelForChartField(state.chart.valueField))}</text>
    </svg>
    <div class="chart-legend gauge-legend">${points.slice(0, 6).map((point) => `
      <div class="chart-legend-item"><span></span>${esc(shortLabel(point.label, 28))}<strong>${esc(formatChartNumber(point.value))}</strong></div>
    `).join('')}</div>
  </div>`;
}

function renderPieChart(points) {
  const total = points.reduce((sum, point) => sum + Math.max(point.value, 0), 0) || 1;
  const colors = chartColors();
  let startAngle = -90;
  const segments = points.map((point, index) => {
    const pct = Math.max(point.value, 0) / total;
    const endAngle = startAngle + pct * 360;
    const path = describePieSlice(90, 90, 72, startAngle, endAngle);
    startAngle = endAngle;
    return `<path class="pie-segment" d="${path}" fill="${colors[index % colors.length]}"></path>`;
  }).join('');
  const legend = points.map((point, index) => `
    <div class="chart-legend-item"><span style="background:${colors[index % colors.length]}"></span>${esc(shortLabel(point.label, 22))} <strong>${esc(formatChartNumber(point.value))}</strong></div>
  `).join('');
  return `<div class="donut-chart pie-chart">
    <svg class="donut-svg" viewBox="0 0 180 180" role="img">${segments}</svg>
    <div class="chart-legend">${legend}</div>
  </div>`;
}

function describePieSlice(cx, cy, radius, startAngle, endAngle) {
  const start = polarToCartesian(cx, cy, radius, endAngle);
  const end = polarToCartesian(cx, cy, radius, startAngle);
  const largeArcFlag = endAngle - startAngle <= 180 ? '0' : '1';
  return [
    `M ${cx} ${cy}`,
    `L ${start.x} ${start.y}`,
    `A ${radius} ${radius} 0 ${largeArcFlag} 0 ${end.x} ${end.y}`,
    'Z'
  ].join(' ');
}

function polarToCartesian(cx, cy, radius, angleDegrees) {
  const angleRadians = (angleDegrees * Math.PI) / 180;
  return {
    x: cx + radius * Math.cos(angleRadians),
    y: cy + radius * Math.sin(angleRadians)
  };
}

function renderTreemapChart(points) {
  const colors = chartColors();
  const total = points.reduce((sum, point) => sum + Math.max(point.value, 0), 0) || 1;
  const width = 780;
  const height = 210;
  let x = 0;
  const tiles = points.map((point, index) => {
    const w = Math.max(54, (Math.max(point.value, 0) / total) * width);
    const tile = `
      <g>
        <rect class="treemap-tile" x="${x}" y="0" width="${w}" height="${height}" fill="${colors[index % colors.length]}"></rect>
        <text class="treemap-label" x="${x + 10}" y="24">${esc(shortLabel(point.label, Math.max(10, Math.floor(w / 8))))}</text>
        ${state.chart.showDataLabels ? `<text class="treemap-value" x="${x + 10}" y="44">${esc(formatChartNumber(point.value))}</text>` : ''}
      </g>
    `;
    x += w;
    return tile;
  }).join('');
  return `<svg class="chart-svg treemap-svg" width="${Math.max(width, x)}" height="${height}" viewBox="0 0 ${Math.max(width, x)} ${height}" role="img">${tiles}</svg>`;
}

function renderHeatmapChart(points) {
  const colors = chartColors();
  const cell = 84;
  const cols = Math.min(6, Math.max(1, Math.ceil(Math.sqrt(points.length))));
  const rows = Math.ceil(points.length / cols);
  const max = Math.max(...points.map((point) => point.value), 1);
  const cells = points.map((point, index) => {
    const col = index % cols;
    const row = Math.floor(index / cols);
    const intensity = Math.max(0.18, point.value / max);
    return `
      <g>
        <rect class="heatmap-cell" x="${col * cell}" y="${row * cell}" width="${cell - 5}" height="${cell - 5}" rx="5" fill="${colors[index % colors.length]}" opacity="${intensity}"></rect>
        <text class="heatmap-label" x="${col * cell + 8}" y="${row * cell + 22}">${esc(shortLabel(point.label, 10))}</text>
        ${state.chart.showDataLabels ? `<text class="heatmap-value" x="${col * cell + 8}" y="${row * cell + 43}">${esc(formatChartNumber(point.value))}</text>` : ''}
      </g>
    `;
  }).join('');
  return `<svg class="chart-svg heatmap-svg" width="${cols * cell}" height="${rows * cell}" viewBox="0 0 ${cols * cell} ${rows * cell}" role="img">${cells}</svg>`;
}

function renderDonutChart(points, type = 'donut') {
  const total = points.reduce((sum, point) => sum + Math.max(point.value, 0), 0) || 1;
  let offset = 0;
  const colors = chartColors();
  const strokeWidth = type === 'pie' ? 52 : 28;
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
  return `<div class="donut-chart ${type === 'pie' ? 'pie-chart' : ''}">
    <svg class="donut-svg" viewBox="0 0 180 180" role="img" style="--donut-stroke:${strokeWidth}">
      <circle class="donut-track" r="52" cx="90" cy="90"></circle>
      ${segments}
      ${type === 'pie' ? '' : `<text class="donut-total" x="90" y="86" text-anchor="middle">${esc(formatChartNumber(total))}</text>
      <text class="donut-caption" x="90" y="105" text-anchor="middle">Total</text>`}
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
      ${rowGroupColumns.map((column) => `<td class="matrix-row-header ${cellFormatClass(row, column.field)}">${esc(readPath(row, column.field) ?? '')}</td>`).join('')}
      ${matrixColumns.map((column) => `<td class="matrix-value-cell ${cellFormatClass(row, column.field)}">${esc(readPath(row, column.field) ?? 0)}</td>`).join('')}
      ${totalColumn ? `<td class="matrix-total-cell ${cellFormatClass(row, totalColumn.field)}">${esc(readPath(row, totalColumn.field) ?? 0)}</td>` : ''}
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
        ${aggregateColumns.map((column) => `<td class="${cellFormatClass(summary, column.field)}">${esc(summary[column.field] ?? '')}</td>`).join('')}
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
            ${aggregateColumns.map((column) => `<td class="${cellFormatClass(summary, column.field)}">${esc(summary[column.field] ?? '')}</td>`).join('')}
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
  const previous = {
    rowOne: $('summaryGroupOne')?.value || '',
    rowTwo: $('summaryGroupTwo')?.value || '',
    matrix: $('matrixColumnGroup')?.value || '',
    aggregate: $('summaryAggregateField')?.value || ''
  };
  const groupOptions = ['<option value="">None</option>']
    .concat(reportGroupingFields().map((field) => `<option value="${esc(field.name)}">${esc(field.label)}</option>`))
    .join('');
  const aggregateOptions = ['<option value="">None</option>']
    .concat(reportAggregateFields().map((field) => `<option value="${esc(field.name)}">${esc(field.label)}</option>`))
    .join('');
  $('summaryGroupOne').innerHTML = groupOptions;
  $('summaryGroupTwo').innerHTML = groupOptions;
  $('matrixColumnGroup').innerHTML = groupOptions;
  $('summaryAggregateField').innerHTML = aggregateOptions;
  restoreSelectValue('summaryGroupOne', previous.rowOne);
  restoreSelectValue('summaryGroupTwo', previous.rowTwo);
  restoreSelectValue('matrixColumnGroup', previous.matrix);
  restoreSelectValue('summaryAggregateField', previous.aggregate);
  syncAggregateFieldState();
  renderGroupChips();
  renderColumnGroupChips();
}

function restoreSelectValue(id, value) {
  if (!value || !$(`${id}`)) return;
  if ([...$(id).options].some((option) => option.value === value)) $(id).value = value;
}

function reportGroupingFields() {
  return [
    ...state.fields.map((field) => ({ name: field.name, label: field.label, virtual: false })),
    ...state.bucketFields.map((field) => ({ name: field.fieldName, label: field.label, virtual: true })),
    ...state.rowFormulas.map((field) => ({ name: field.fieldName, label: field.label, virtual: true }))
  ];
}

function reportAggregateFields() {
  return [
    ...state.fields.map((field) => ({ name: field.name, label: field.label })),
    ...state.rowFormulas.map((field) => ({ name: field.fieldName, label: field.label }))
  ];
}

function syncReportTypeUi() {
  const isSummary = $('reportType').value === 'summary';
  const isMatrix = $('reportType').value === 'matrix';
  $('summaryConfig').style.display = isSummary || isMatrix ? '' : 'none';
  $('matrixColumnConfig').style.display = isMatrix ? '' : 'none';
  $('summaryGroupTwo').style.display = isMatrix ? 'none' : '';
  if ($('reportObject')) $('reportObject').disabled = Boolean($('reportTypeSource')?.value);
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
  const container = $('activeFilters');
  if (!container) return;
  
  if (state.filters.length) {
    container.innerHTML = state.filters.map((filter, index) => `
      <span class="field-pill">
        ${esc(labelForField(filter.field))} ${esc(operatorLabel(filter.operator))}${filter.value ? ` ${esc(filter.value)}` : ''}
        <button onclick="removeFilter(${index})">&times;</button>
      </span>
    `).join('');
  } else {
    container.innerHTML = `
      <div class="empty-filters-banner">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"></polygon></svg>
        <div class="empty-filters-text">
          <strong>Add Filters</strong>
          <span>Filter this report to focus only on records that match your specific criteria.</span>
        </div>
      </div>
    `;
  }
}

function addCrossFilter() {
  openCrossFilterModal();
}

function editCrossFilter(index) {
  openCrossFilterModal(index);
}

function duplicateCrossFilter(index) {
  const source = state.crossFilters[index];
  if (!source) return;
  state.crossFilters.push({ ...JSON.parse(JSON.stringify(source)), id: `cf_${Date.now()}` });
  markDirtyAndPreview();
  renderCrossFilters();
}

function removeCrossFilter(index) {
  state.crossFilters.splice(index, 1);
  markDirtyAndPreview();
  renderCrossFilters();
}

function renderCrossFilters() {
  const target = $('crossFilterChips');
  if (!target) return;
  if (state.crossFilters.length) {
    target.innerHTML = state.crossFilters.map((filter, index) => `
      <span class="field-pill metadata-pill">
        ${esc(crossFilterLabel(filter))}
        ${metadataActions('editCrossFilter', 'duplicateCrossFilter', 'removeCrossFilter', index)}
      </span>
    `).join('');
  } else {
    target.innerHTML = `
      <div class="empty-filters-banner">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"></polygon></svg>
        <div class="empty-filters-text">
          <strong>Add Cross Filters</strong>
          <span>Cross filters let you filter a report by the relationship between parent and child objects.</span>
        </div>
      </div>
    `;
  }
}

function openCrossFilterModal(index = null) {
  const filter = state.crossFilters[index] || defaultCrossFilter();
  openAdvancedModal({
    title: index === null ? 'New Cross Filter' : 'Edit Cross Filter',
    saveLabel: index === null ? 'Create Cross Filter' : 'Save Cross Filter',
    body: renderCrossFilterModalBody(filter),
    onOpen: () => {
      $('crossFilterRelationship').addEventListener('change', () => renderCrossSubfilters(readCrossSubfilters()));
      renderCrossSubfilters(filter.subfilters || []);
    },
    onSave: () => {
      const relationship = crossFilterRelationshipOptions().find((item) => item.key === $('crossFilterRelationship').value);
      if (!relationship) return setAdvancedValidation('Select a relationship.');
      const next = {
        id: filter.id || `cf_${Date.now()}`,
        type: $('crossFilterType').value,
        parentObject: relationship.parentObject,
        childObject: relationship.childObject,
        parentField: relationship.parentField,
        label: `${relationship.parentObject} ${$('crossFilterType').value.toUpperCase()} ${relationship.childObject}`,
        subfilters: readCrossSubfilters()
      };
      if (index === null) state.crossFilters.push(next);
      else state.crossFilters[index] = next;
      closeAdvancedModal();
      markDirtyAndPreview();
      renderCrossFilters();
    }
  });
}

function renderCrossFilterModalBody(filter) {
  const options = crossFilterRelationshipOptions();
  const selectedKey = crossFilterKey(filter) || options[0]?.key || '';
  return `
    <div class="advanced-modal-grid">
      <label>Relationship<select id="crossFilterRelationship">
        ${options.map((option) => `<option value="${esc(option.key)}" ${selectedKey === option.key ? 'selected' : ''}>${esc(option.parentObject)} / ${esc(option.childObject)}</option>`).join('')}
      </select></label>
      <label>Filter Type<select id="crossFilterType">
        <option value="with" ${filter.type !== 'without' ? 'selected' : ''}>WITH related records</option>
        <option value="without" ${filter.type === 'without' ? 'selected' : ''}>WITHOUT related records</option>
      </select></label>
    </div>
    <div class="advanced-modal-section">
      <div class="advanced-modal-title">Sub-filters</div>
      <div id="crossSubfilterRows"></div>
      <button class="btn btn-ghost" type="button" onclick="addCrossSubfilterRow()">+ Add Sub-filter</button>
    </div>
    <div class="advanced-preview-box">Example: Accounts WITH Opportunities WHERE StageName = Closed Won.</div>
    <div id="advancedValidation" class="advanced-validation"></div>
  `;
}

function renderCrossSubfilters(filters = []) {
  const relationship = crossFilterRelationshipOptions().find((item) => item.key === $('crossFilterRelationship')?.value) || crossFilterRelationshipOptions()[0];
  const fields = crossFilterFields(relationship?.childObject);
  $('crossSubfilterRows').innerHTML = (filters.length ? filters : []).map((filter, index) => `
    <div class="bucket-definition-row cross-subfilter-row">
      <select class="cross-subfilter-field">
        ${fields.map((field) => `<option value="${esc(field.name)}" ${filter.field === field.name ? 'selected' : ''}>${esc(field.label)}</option>`).join('')}
      </select>
      <select class="cross-subfilter-operator">
        ${['eq', 'neq', 'contains', 'starts_with', 'gt', 'gte', 'lt', 'lte', 'is_null', 'is_not_null'].map((op) => `<option value="${op}" ${filter.operator === op ? 'selected' : ''}>${esc(operatorLabel(op))}</option>`).join('')}
      </select>
      <input class="cross-subfilter-value" value="${esc(filter.value || '')}" placeholder="Value">
      <button type="button" onclick="removeCrossSubfilterRow(${index})">&times;</button>
    </div>
  `).join('') || '<div class="muted">No sub-filters. The relationship alone will be evaluated.</div>';
}

function addCrossSubfilterRow() {
  const rows = readCrossSubfilters();
  const relationship = crossFilterRelationshipOptions().find((item) => item.key === $('crossFilterRelationship')?.value) || crossFilterRelationshipOptions()[0];
  const field = crossFilterFields(relationship?.childObject)[0]?.name || 'Name';
  rows.push({ field, operator: 'eq', value: '' });
  renderCrossSubfilters(rows);
}

function removeCrossSubfilterRow(index) {
  const rows = readCrossSubfilters();
  rows.splice(index, 1);
  renderCrossSubfilters(rows);
}

function readCrossSubfilters() {
  return [...document.querySelectorAll('#crossSubfilterRows .cross-subfilter-row')].map((row) => ({
    field: row.querySelector('.cross-subfilter-field')?.value || '',
    operator: row.querySelector('.cross-subfilter-operator')?.value || 'eq',
    value: row.querySelector('.cross-subfilter-value')?.value || ''
  })).filter((filter) => filter.field);
}

function defaultCrossFilter() {
  const relationship = crossFilterRelationshipOptions()[0] || { parentObject: 'Account', childObject: 'Contact', parentField: 'AccountId' };
  return {
    id: `cf_${Date.now()}`,
    type: 'with',
    parentObject: relationship.parentObject,
    childObject: relationship.childObject,
    parentField: relationship.parentField,
    subfilters: []
  };
}

function crossFilterRelationshipOptions() {
  const primary = $('reportObject')?.value || 'Account';
  const options = reportRelationshipOptionsFromRegistry().filter((item) => item.parentObject === primary);
  return options.length ? options : [{ key: 'Account:Contact:AccountId', parentObject: 'Account', childObject: 'Contact', parentField: 'AccountId' }];
}

function objectLabel(apiName) {
  return window.SaaSRAY_OBJECT_REGISTRY?.[apiName]?.label || apiName;
}

function reportRelationshipOptionsFromRegistry() {
  const registry = window.SaaSRAY_OBJECT_REGISTRY || {};
  return Object.values(registry).flatMap((objectConfig) =>
    (objectConfig.reportRelationships || []).map((relationship) => ({
      key: `${objectConfig.apiName}:${relationship.childObject}:${relationship.parentField}`,
      parentObject: objectConfig.apiName,
      childObject: relationship.childObject,
      parentField: relationship.parentField
    }))
  );
}

function crossFilterFields(childObject) {
  const fields = {
    Contact: [
      { name: 'Name', label: 'Contact Name' },
      { name: 'Email', label: 'Email' },
      { name: 'Title', label: 'Title' },
      { name: 'Phone', label: 'Phone' }
    ],
    Opportunity: [
      { name: 'Name', label: 'Opportunity Name' },
      { name: 'StageName', label: 'Stage' },
      { name: 'Amount', label: 'Amount' },
      { name: 'CloseDate', label: 'Close Date' }
    ],
    Case: [
      { name: 'CaseNumber', label: 'Case Number' },
      { name: 'Status', label: 'Status' },
      { name: 'Priority', label: 'Priority' },
      { name: 'Subject', label: 'Subject' }
    ],
    Lead: [
      { name: 'Name', label: 'Lead Name' },
      { name: 'Company', label: 'Company' },
      { name: 'Status', label: 'Status' },
      { name: 'Email', label: 'Email' }
    ]
  };
  return fields[childObject] || [{ name: 'Name', label: 'Name' }];
}

function crossFilterKey(filter) {
  return filter?.parentObject && filter?.childObject && filter?.parentField
    ? `${filter.parentObject}:${filter.childObject}:${filter.parentField}`
    : '';
}

function crossFilterLabel(filter) {
  const type = filter.type === 'without' ? 'WITHOUT' : 'WITH';
  const subfilters = (filter.subfilters || []).length
    ? ` WHERE ${(filter.subfilters || []).map((item) => `${item.field} ${operatorLabel(item.operator)} ${item.value || ''}`).join(' AND ')}`
    : '';
  return `${filter.parentObject || $('reportObject')?.value || 'Records'} ${type} ${filter.childObject}${subfilters}`;
}

function addBucketField() {
  openBucketFieldModal();
}

function editBucketField(index) {
  openBucketFieldModal(index);
}

function removeBucketField(index) {
  state.bucketFields.splice(index, 1);
  markDirtyAndPreview();
  renderAdvancedMetadata();
}

function duplicateBucketField(index) {
  const item = state.bucketFields[index];
  if (!item) return;
  state.bucketFields.push({ ...JSON.parse(JSON.stringify(item)), fieldName: derivedFieldName('bucket', `${item.label} Copy`), label: `${item.label} Copy` });
  markDirtyAndPreview();
  renderAdvancedMetadata();
}

function addRowFormula() {
  openRowFormulaModal();
}

function editRowFormula(index) {
  openRowFormulaModal(index);
}

function removeRowFormula(index) {
  state.rowFormulas.splice(index, 1);
  markDirtyAndPreview();
  renderAdvancedMetadata();
}

function duplicateRowFormula(index) {
  const item = state.rowFormulas[index];
  if (!item) return;
  state.rowFormulas.push({ ...JSON.parse(JSON.stringify(item)), fieldName: derivedFieldName('formula', `${item.label} Copy`), label: `${item.label} Copy` });
  markDirtyAndPreview();
  renderAdvancedMetadata();
}

function addSummaryFormula() {
  if (!['summary', 'matrix'].includes($('reportType').value)) {
    return toast('Summary formulas are available for summary and matrix reports', 'info');
  }
  openSummaryFormulaModal();
}

function editSummaryFormula(index) {
  openSummaryFormulaModal(index);
}

function removeSummaryFormula(index) {
  state.summaryFormulas.splice(index, 1);
  markDirtyAndPreview();
  renderAdvancedMetadata();
}

function duplicateSummaryFormula(index) {
  const item = state.summaryFormulas[index];
  if (!item) return;
  state.summaryFormulas.push({ ...JSON.parse(JSON.stringify(item)), fieldName: derivedFieldName('summary', `${item.label} Copy`), label: `${item.label} Copy` });
  markDirtyAndPreview();
  renderAdvancedMetadata();
}

function addConditionalFormat() {
  openConditionalFormatModal();
}

function editConditionalFormat(index) {
  openConditionalFormatModal(index);
}

function removeConditionalFormat(index) {
  state.conditionalFormatting.splice(index, 1);
  markDirtyAndPreview();
  renderAdvancedMetadata();
}

function duplicateConditionalFormat(index) {
  const item = state.conditionalFormatting[index];
  if (!item) return;
  state.conditionalFormatting.push({ ...JSON.parse(JSON.stringify(item)) });
  markDirtyAndPreview();
  renderAdvancedMetadata();
}

function renderAdvancedMetadata() {
  renderMetadataChips('bucketFieldChips', state.bucketFields, (bucket, index) => (
    `${esc(bucket.label)} from ${esc(labelForField(bucket.sourceField))}${metadataActions('editBucketField', 'duplicateBucketField', 'removeBucketField', index)}`
  ), 'No bucket fields.');
  renderMetadataChips('rowFormulaChips', state.rowFormulas, (formula, index) => (
    `${esc(formula.label)}${metadataActions('editRowFormula', 'duplicateRowFormula', 'removeRowFormula', index)}`
  ), 'No row formulas.');
  renderMetadataChips('summaryFormulaChips', state.summaryFormulas, (formula, index) => (
    `${esc(formula.label)}${metadataActions('editSummaryFormula', 'duplicateSummaryFormula', 'removeSummaryFormula', index)}`
  ), 'No summary formulas.');
  renderMetadataChips('conditionalFormatChips', state.conditionalFormatting, (rule, index) => (
    `${esc(labelForField(rule.field))} ${esc(operatorLabel(rule.operator))} ${esc(rule.value || '')}${metadataActions('editConditionalFormat', 'duplicateConditionalFormat', 'removeConditionalFormat', index)}`
  ), 'No formatting rules.');
  renderMetadataChips('advancedFieldChips', advancedMetadataItems(), (item) => item.html, 'No buckets, formulas, or formatting rules.');
}

function advancedMetadataItems() {
  return [
    ...state.bucketFields.map((bucket, index) => ({
      html: `<strong>Bucket</strong> ${esc(bucket.label)} from ${esc(labelForField(bucket.sourceField))}${metadataActions('editBucketField', 'duplicateBucketField', 'removeBucketField', index)}`
    })),
    ...state.rowFormulas.map((formula, index) => ({
      html: `<strong>Row Formula</strong> ${esc(formula.label)}${metadataActions('editRowFormula', 'duplicateRowFormula', 'removeRowFormula', index)}`
    })),
    ...state.summaryFormulas.map((formula, index) => ({
      html: `<strong>Summary Formula</strong> ${esc(formula.label)}${metadataActions('editSummaryFormula', 'duplicateSummaryFormula', 'removeSummaryFormula', index)}`
    })),
    ...state.conditionalFormatting.map((rule, index) => ({
      html: `<strong>Format</strong> ${esc(labelForField(rule.field))} ${esc(operatorLabel(rule.operator))} ${esc(rule.value || '')}${metadataActions('editConditionalFormat', 'duplicateConditionalFormat', 'removeConditionalFormat', index)}`
    }))
  ];
}

function metadataActions(editFn, duplicateFn, removeFn, index) {
  return `<button title="Edit" onclick="${editFn}(${index})">Edit</button><button title="Duplicate" onclick="${duplicateFn}(${index})">Copy</button><button title="Delete" onclick="${removeFn}(${index})">&times;</button>`;
}

function renderMetadataChips(targetId, items, renderer, emptyText) {
  const target = $(targetId);
  if (!target) return;
  target.innerHTML = items.length
    ? items.map((item, index) => `<span class="field-pill metadata-pill">${renderer(item, index)}</span>`).join('')
    : `<span class="muted">${esc(emptyText)}</span>`;
}

function openBucketFieldModal(index = null) {
  const bucket = state.bucketFields[index] || {
    label: '',
    sourceField: state.fields[0]?.name || '',
    bucketType: 'text',
    defaultLabel: 'Other',
    rules: [
      { label: 'Small', operator: 'between', min: 0, max: 100000 },
      { label: 'Medium', operator: 'between', min: 100001, max: 1000000 },
      { label: 'Enterprise', operator: 'gt', value: 1000000 }
    ]
  };
  openAdvancedModal({
    title: index === null ? 'New Bucket Field' : 'Edit Bucket Field',
    saveLabel: index === null ? 'Create Bucket' : 'Save Bucket',
    body: renderBucketModalBody(bucket),
    onOpen: () => {
      $('bucketModalName').value = bucket.label || '';
      $('bucketModalSource').value = bucket.sourceField || state.fields[0]?.name || '';
      $('bucketModalType').value = bucket.bucketType || 'text';
      renderBucketDefinitionRows(bucket.rules || []);
      refreshBucketPreview();
    },
    onSave: () => {
      const label = $('bucketModalName').value.trim();
      const sourceField = $('bucketModalSource').value;
      const rules = readBucketDefinitionRows();
      if (!label) return setAdvancedValidation('Bucket name is required.');
      if (!sourceField) return setAdvancedValidation('Select a source field.');
      if (!rules.length) return setAdvancedValidation('Add at least one bucket definition.');
      const next = {
        fieldName: bucket.fieldName || derivedFieldName('bucket', label),
        label,
        sourceField,
        bucketType: $('bucketModalType').value,
        defaultLabel: 'Other',
        rules
      };
      if (index === null) state.bucketFields.push(next);
      else state.bucketFields[index] = next;
      closeAdvancedModal();
      markDirtyAndPreview();
      renderAdvancedMetadata();
    }
  });
}

function renderBucketModalBody(bucket) {
  return `
    <div class="advanced-modal-grid bucket-modal-grid">
      <label>Bucket Name<input id="bucketModalName" placeholder="e.g. Revenue Segment"></label>
      <label>Source Field<select id="bucketModalSource">${fieldOptions(bucket.sourceField)}</select></label>
      <label>Bucket Type<select id="bucketModalType">
        <option value="numeric">Numeric</option>
        <option value="text">Text</option>
        <option value="picklist">Picklist</option>
      </select></label>
    </div>
    <div class="advanced-modal-section">
      <div class="advanced-modal-title">Bucket Definitions</div>
      <div class="bucket-definition-table">
        <div class="bucket-definition-head"><span>Name</span><span>Operator</span><span>Value / Range</span><span></span></div>
        <div id="bucketDefinitionRows"></div>
      </div>
      <button class="btn btn-ghost" type="button" onclick="addBucketDefinitionRow()">+ Add Bucket</button>
    </div>
    <div class="advanced-modal-section">
      <div class="advanced-modal-title">Preview Results</div>
      <div id="bucketPreview" class="advanced-preview-box"></div>
    </div>
    <div id="advancedValidation" class="advanced-validation"></div>
  `;
}

function renderBucketDefinitionRows(rules = []) {
  $('bucketDefinitionRows').innerHTML = (rules.length ? rules : [{ label: '', operator: 'eq', values: [] }]).map((rule, index) => `
    <div class="bucket-definition-row" data-index="${index}">
      <input class="bucket-rule-label" value="${esc(rule.label || '')}" placeholder="Bucket label">
      <select class="bucket-rule-operator">
        ${['eq', 'contains', 'starts_with', 'between', 'gt', 'gte', 'lt', 'lte', 'is_blank'].map((op) => `<option value="${op}" ${rule.operator === op ? 'selected' : ''}>${esc(bucketOperatorLabel(op))}</option>`).join('')}
      </select>
      <input class="bucket-rule-value" value="${esc(bucketRuleValue(rule))}" placeholder="Value, value1,value2, or min-max">
      <div class="bucket-row-actions">
        <button type="button" onclick="moveBucketDefinitionRow(${index}, -1)">↑</button>
        <button type="button" onclick="moveBucketDefinitionRow(${index}, 1)">↓</button>
        <button type="button" onclick="removeBucketDefinitionRow(${index})">×</button>
      </div>
    </div>
  `).join('');
  document.querySelectorAll('#bucketDefinitionRows input, #bucketDefinitionRows select, #bucketModalSource').forEach((el) => {
    el.addEventListener('input', refreshBucketPreview);
    el.addEventListener('change', refreshBucketPreview);
  });
}

function addBucketDefinitionRow() {
  const rules = readBucketDefinitionRows();
  rules.push({ label: '', operator: 'eq', values: [] });
  renderBucketDefinitionRows(rules);
  refreshBucketPreview();
}

function removeBucketDefinitionRow(index) {
  const rules = readBucketDefinitionRows();
  rules.splice(index, 1);
  renderBucketDefinitionRows(rules);
  refreshBucketPreview();
}

function moveBucketDefinitionRow(index, direction) {
  const rules = readBucketDefinitionRows();
  const target = index + direction;
  if (target < 0 || target >= rules.length) return;
  [rules[index], rules[target]] = [rules[target], rules[index]];
  renderBucketDefinitionRows(rules);
  refreshBucketPreview();
}

function readBucketDefinitionRows() {
  return [...document.querySelectorAll('#bucketDefinitionRows .bucket-definition-row')]
    .map((row) => parseBucketRule(
      row.querySelector('.bucket-rule-label')?.value,
      row.querySelector('.bucket-rule-operator')?.value,
      row.querySelector('.bucket-rule-value')?.value
    ))
    .filter((rule) => rule.label);
}

function parseBucketRule(label, operator, valueText) {
  const rule = { label: String(label || '').trim(), operator: operator || 'eq' };
  const text = String(valueText || '').trim();
  if (operator === 'between') {
    const [min, max] = text.split('-').map((part) => Number(part.trim()));
    rule.min = Number.isFinite(min) ? min : null;
    rule.max = Number.isFinite(max) ? max : null;
  } else if (operator === 'eq' && text.includes(',')) {
    rule.values = text.split(',').map((value) => value.trim()).filter(Boolean);
  } else {
    rule.value = text;
  }
  return rule;
}

function bucketRuleValue(rule) {
  if (rule.operator === 'between') return `${rule.min ?? ''}-${rule.max ?? ''}`;
  if (Array.isArray(rule.values) && rule.values.length) return rule.values.join(', ');
  return rule.value ?? '';
}

function refreshBucketPreview() {
  const target = $('bucketPreview');
  if (!target) return;
  const field = $('bucketModalSource')?.value;
  const rules = readBucketDefinitionRows();
  const rows = (window.currentReportResult?.rows || []).slice(0, 20);
  if (!field || !rows.length) {
    target.innerHTML = '<span class="muted">Run Preview to see bucket sample results.</span>';
    return;
  }
  const counts = {};
  rows.forEach((row) => {
    const label = previewBucketValue(readPath(row, field), rules);
    counts[label] = (counts[label] || 0) + 1;
  });
  target.innerHTML = Object.entries(counts).map(([label, count]) => `<span class="preview-chip">${esc(label)}: ${count}</span>`).join('');
}

function previewBucketValue(value, rules) {
  const text = String(value ?? '');
  const number = Number(value);
  const match = rules.find((rule) => {
    if (rule.operator === 'is_blank') return text === '';
    if (rule.operator === 'between') return Number.isFinite(number) && number >= Number(rule.min) && number <= Number(rule.max);
    if (['gt', 'gte', 'lt', 'lte'].includes(rule.operator)) {
      const right = Number(rule.value);
      if (!Number.isFinite(number) || !Number.isFinite(right)) return false;
      if (rule.operator === 'gt') return number > right;
      if (rule.operator === 'gte') return number >= right;
      if (rule.operator === 'lt') return number < right;
      return number <= right;
    }
    if (rule.operator === 'contains') return text.toLowerCase().includes(String(rule.value || '').toLowerCase());
    if (rule.operator === 'starts_with') return text.toLowerCase().startsWith(String(rule.value || '').toLowerCase());
    if (Array.isArray(rule.values) && rule.values.length) return rule.values.includes(text);
    return text === String(rule.value ?? '');
  });
  return match?.label || 'Other';
}

function openRowFormulaModal(index = null) {
  const formula = state.rowFormulas[index] || { label: '', formula: '', format: 'number' };
  openFormulaModal({
    mode: 'row',
    title: index === null ? 'New Row Formula' : 'Edit Row Formula',
    formula,
    onSave: (next) => {
      const value = { fieldName: formula.fieldName || derivedFieldName('row', next.label), ...next };
      if (index === null) state.rowFormulas.push(value);
      else state.rowFormulas[index] = value;
    }
  });
}

function openSummaryFormulaModal(index = null) {
  const formula = state.summaryFormulas[index] || { label: '', formula: '', format: 'number' };
  openFormulaModal({
    mode: 'summary',
    title: index === null ? 'New Summary Formula' : 'Edit Summary Formula',
    formula,
    onSave: (next) => {
      const value = { fieldName: formula.fieldName || derivedFieldName('summary', next.label), ...next };
      if (index === null) state.summaryFormulas.push(value);
      else state.summaryFormulas[index] = value;
    }
  });
}

function openFormulaModal({ mode, title, formula, onSave }) {
  openAdvancedModal({
    title,
    saveLabel: 'Save Formula',
    body: `
      <div class="formula-builder">
        <aside class="formula-fields-panel">
          <div class="advanced-modal-title">${mode === 'summary' ? 'Aggregate References' : 'Available Fields'}</div>
          <input id="formulaFieldSearch" placeholder="Search fields...">
          <div id="formulaFieldList" class="formula-field-list"></div>
        </aside>
        <section class="formula-editor-panel">
          <div class="advanced-modal-grid">
            <label>Formula Name<input id="formulaModalName" placeholder="e.g. Weighted Revenue"></label>
            <label>Return Type<select id="formulaReturnType">
              <option value="number">Number</option>
              <option value="currency">Currency</option>
              <option value="percent">Percent</option>
            </select></label>
          </div>
          <label class="formula-expression-label">Formula Expression<textarea id="formulaExpression" rows="7" placeholder="${mode === 'summary' ? 'SUM(AnnualRevenue) / COUNT(Id)' : '{Amount} * 0.1'}"></textarea></label>
          <div class="formula-actions">
            <button class="btn btn-ghost" type="button" onclick="validateFormulaModal('${mode}')">Validate Formula</button>
            <button class="btn btn-ghost" type="button" onclick="previewFormulaModal('${mode}')">Preview</button>
          </div>
          <div id="formulaValidation" class="advanced-validation"></div>
          <div id="formulaPreview" class="advanced-preview-box"></div>
        </section>
      </div>
    `,
    onOpen: () => {
      $('formulaModalName').value = formula.label || '';
      $('formulaReturnType').value = formula.format || formula.dataType || 'number';
      $('formulaExpression').value = formula.formula || '';
      renderFormulaFieldList(mode);
      $('formulaFieldSearch').addEventListener('input', () => renderFormulaFieldList(mode));
      $('formulaExpression').addEventListener('input', () => validateFormulaModal(mode, true));
    },
    onSave: () => {
      const label = $('formulaModalName').value.trim();
      const expression = $('formulaExpression').value.trim();
      if (!label) return setAdvancedValidation('Formula name is required.', 'formulaValidation');
      if (!expression) return setAdvancedValidation('Formula expression is required.', 'formulaValidation');
      const normalized = mode === 'summary' ? normalizeSummaryFormulaExpression(expression) : expression;
      const validation = validateFormulaExpression(normalized);
      if (!validation.ok) return setAdvancedValidation(validation.message, 'formulaValidation');
      onSave({ label, formula: normalized, format: $('formulaReturnType').value, dataType: $('formulaReturnType').value });
      closeAdvancedModal();
      markDirtyAndPreview();
      renderAdvancedMetadata();
    }
  });
}

function renderFormulaFieldList(mode) {
  const q = ($('formulaFieldSearch')?.value || '').toLowerCase();
  const items = mode === 'summary' ? aggregateFormulaOptions() : state.fields.map((field) => ({
    label: field.label,
    token: `{${field.name}}`
  }));
  $('formulaFieldList').innerHTML = items
    .filter((item) => !q || item.label.toLowerCase().includes(q) || item.token.toLowerCase().includes(q))
    .map((item) => `<button type="button" onclick="insertFormulaToken('${escAttr(item.token)}')"><span>${esc(item.label)}</span><code>${esc(item.token)}</code></button>`)
    .join('');
}

function aggregateFormulaOptions() {
  const selected = $('summaryAggregateField')?.value;
  const aggregateFn = $('summaryAggregateFn')?.value || 'count';
  const options = [{ label: 'Record Count', token: '{agg_count_records}' }];
  if (selected && aggregateFn !== 'count') {
    options.push({ label: `${aggregateFn.toUpperCase()} ${labelForField(selected)}`, token: `{${aggregateAlias(aggregateFn, selected)}}` });
  }
  state.fields.slice(0, 40).forEach((field) => {
    options.push({ label: `SUM(${field.label})`, token: `SUM(${field.name})` });
    options.push({ label: `AVG(${field.label})`, token: `AVG(${field.name})` });
  });
  return options;
}

function insertFormulaToken(token) {
  const input = $('formulaExpression');
  if (!input) return;
  const start = input.selectionStart || input.value.length;
  const end = input.selectionEnd || input.value.length;
  input.value = `${input.value.slice(0, start)}${token}${input.value.slice(end)}`;
  input.focus();
  input.selectionStart = input.selectionEnd = start + token.length;
  validateFormulaModal('row', true);
}

function validateFormulaModal(mode, silent = false) {
  const normalized = mode === 'summary'
    ? normalizeSummaryFormulaExpression($('formulaExpression')?.value || '')
    : $('formulaExpression')?.value || '';
  const validation = validateFormulaExpression(normalized);
  if (!silent || validation.ok) setAdvancedValidation(validation.ok ? 'Formula is valid.' : validation.message, 'formulaValidation', validation.ok ? 'ok' : 'err');
  return validation.ok;
}

function previewFormulaModal(mode) {
  const normalized = mode === 'summary'
    ? normalizeSummaryFormulaExpression($('formulaExpression')?.value || '')
    : $('formulaExpression')?.value || '';
  const sample = mode === 'summary' ? sampleAggregateContext() : (window.currentReportResult?.rows || [])[0] || {};
  const preview = evaluateFormulaPreview(normalized, sample);
  $('formulaPreview').innerHTML = preview.ok
    ? `<span class="preview-chip">Preview value: ${esc(preview.value)}</span>`
    : `<span class="muted">${esc(preview.message)}</span>`;
}

function normalizeSummaryFormulaExpression(expression) {
  return String(expression || '')
    .replace(/\bCOUNT\s*\(\s*Id\s*\)/gi, '{agg_count_records}')
    .replace(/\b(SUM|AVG|MIN|MAX)\s*\(\s*([A-Za-z_][A-Za-z0-9_.]*)\s*\)/gi, (_, fn, field) => `{${aggregateAlias(fn.toLowerCase(), field)}}`);
}

function aggregateAlias(fn, field) {
  return `agg_${fn}_${field || 'records'}`.replace(/[^A-Za-z0-9_]/g, '_');
}

function validateFormulaExpression(expression) {
  const replaced = String(expression || '').replace(/\{([^}]+)\}/g, '1');
  if (!replaced.trim()) return { ok: false, message: 'Formula expression is required.' };
  if (!/^[0-9+\-*/().\s]+$/.test(replaced)) {
    return { ok: false, message: 'Only numeric operators and field tokens are supported in this release.' };
  }
  try {
    Function(`"use strict"; return (${replaced});`)();
    return { ok: true };
  } catch (err) {
    return { ok: false, message: 'Formula syntax is not valid.' };
  }
}

function evaluateFormulaPreview(expression, sample) {
  const validation = validateFormulaExpression(expression);
  if (!validation.ok) return validation;
  const parsed = String(expression || '').replace(/\{([^}]+)\}/g, (_, token) => {
    const number = Number(readPath(sample, token.trim()));
    return Number.isFinite(number) ? String(number) : '0';
  });
  try {
    const value = Function(`"use strict"; return (${parsed});`)();
    return { ok: true, value: Number.isFinite(value) ? Math.round(value * 100) / 100 : '' };
  } catch (err) {
    return { ok: false, message: 'No preview value available.' };
  }
}

function sampleAggregateContext() {
  const row = (window.currentReportResult?.rows || [])[0] || {};
  if (Object.keys(row).length) return row;
  return { agg_count_records: 1 };
}

function openConditionalFormatModal(index = null) {
  const rule = state.conditionalFormatting[index] || {
    field: state.selectedFields[0] || state.bucketFields[0]?.fieldName || '',
    operator: 'eq',
    value: '',
    style: 'yellow'
  };
  openAdvancedModal({
    title: index === null ? 'New Conditional Formatting Rule' : 'Edit Conditional Formatting Rule',
    saveLabel: 'Save Rule',
    body: `
      <div class="advanced-modal-grid">
        <label>Target Field<select id="formatTargetField">${reportResultFieldOptions(rule.field)}</select></label>
        <label>Operator<select id="formatOperator">
          ${['eq', 'neq', 'contains', 'gt', 'gte', 'lt', 'lte', 'is_blank', 'is_not_blank'].map((op) => `<option value="${op}" ${rule.operator === op ? 'selected' : ''}>${esc(operatorLabel(op))}</option>`).join('')}
        </select></label>
        <label>Value<input id="formatValue" value="${esc(rule.value || '')}" placeholder="Compare value"></label>
        <label>Style<select id="formatStyle">
          ${['green', 'yellow', 'red', 'blue'].map((style) => `<option value="${style}" ${rule.style === style ? 'selected' : ''}>${esc(titleCase(style))}</option>`).join('')}
        </select></label>
      </div>
      <div class="advanced-modal-section">
        <div class="advanced-modal-title">Live Preview</div>
        <div id="formatPreview" class="advanced-preview-box"></div>
      </div>
      <div id="advancedValidation" class="advanced-validation"></div>
    `,
    onOpen: () => {
      ['formatTargetField', 'formatOperator', 'formatValue', 'formatStyle'].forEach((id) => {
        $(id)?.addEventListener('input', refreshFormatPreview);
        $(id)?.addEventListener('change', refreshFormatPreview);
      });
      refreshFormatPreview();
    },
    onSave: () => {
      const next = {
        field: $('formatTargetField').value,
        operator: $('formatOperator').value,
        value: $('formatValue').value,
        style: $('formatStyle').value
      };
      if (!next.field) return setAdvancedValidation('Select a target field.');
      if (!['is_blank', 'is_not_blank'].includes(next.operator) && !String(next.value).trim()) {
        return setAdvancedValidation('Enter a comparison value.');
      }
      if (index === null) state.conditionalFormatting.push(next);
      else state.conditionalFormatting[index] = next;
      closeAdvancedModal();
      markDirtyAndPreview();
      renderAdvancedMetadata();
    }
  });
}

function reportResultFieldOptions(selected) {
  const fields = [
    ...state.selectedFields.map((field) => ({ field, label: labelForField(field) })),
    ...state.bucketFields.map((field) => ({ field: field.fieldName, label: field.label })),
    ...state.rowFormulas.map((field) => ({ field: field.fieldName, label: field.label })),
    ...state.summaryFormulas.map((field) => ({ field: field.fieldName, label: field.label }))
  ];
  return fields.map((field) => `<option value="${esc(field.field)}" ${selected === field.field ? 'selected' : ''}>${esc(field.label)}</option>`).join('');
}

function refreshFormatPreview() {
  const style = $('formatStyle')?.value || 'yellow';
  const field = $('formatTargetField')?.value || '';
  const label = labelForField(field);
  $('formatPreview').innerHTML = `<span class="format-preview-cell report-cell-highlight report-cell-${esc(style)}">${esc(label)} will use ${esc(titleCase(style))} highlighting when the rule matches.</span>`;
}

function openAdvancedModal({ title, body, saveLabel = 'Save', onOpen, onSave }) {
  $('advancedModalTitle').textContent = title;
  $('advancedModalBody').innerHTML = body;
  $('advancedModalSave').textContent = saveLabel;
  $('advancedModalSave').onclick = onSave;
  $('advancedReportModal').style.display = 'flex';
  setAdvancedValidation('');
  if (typeof onOpen === 'function') onOpen();
}

function closeAdvancedModal() {
  if ($('advancedReportModal')) $('advancedReportModal').style.display = 'none';
  if ($('advancedModalBody')) $('advancedModalBody').innerHTML = '';
}

function setAdvancedValidation(message, targetId = 'advancedValidation', type = 'err') {
  const target = $(targetId);
  if (!target) return false;
  target.textContent = message || '';
  target.className = `advanced-validation ${type === 'ok' ? 'ok' : ''}`;
  return false;
}

function fieldOptions(selected) {
  return state.fields.map((field) => `<option value="${esc(field.name)}" ${selected === field.name ? 'selected' : ''}>${esc(field.label)}</option>`).join('');
}

function bucketOperatorLabel(operator) {
  return ({
    eq: 'Equals any',
    contains: 'Contains',
    starts_with: 'Starts With',
    between: 'Between',
    gt: 'Greater Than',
    gte: 'Greater Or Equal',
    lt: 'Less Than',
    lte: 'Less Or Equal',
    is_blank: 'Is Blank'
  })[operator] || operator;
}

function derivedFieldName(prefix, label) {
  const slug = String(label || prefix)
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40) || prefix;
  return `${prefix}_${slug}`;
}

function markDirtyAndPreview() {
  markDirty();
  renderSummaryFieldOptions();
  refreshChartFieldOptions(window.currentReportResult);
  scheduleAutoPreview();
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
    indicator.className = 'draft-indicator dirty';
  }
}

function markSaved() {
  state.isDirty = false;
  const indicator = $('draftIndicator');
  if (indicator) {
    indicator.textContent = 'Saved';
    indicator.className = 'draft-indicator';
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

function cellFormatClass(row, field) {
  const style = row?.__cellFormats?.[field];
  if (!style) return '';
  return `report-cell-highlight report-cell-${String(style).replace(/[^a-z0-9_-]/gi, '').toLowerCase() || 'yellow'}`;
}

function setBusy(button, busy, label) {
  if (!button) return;
  button.disabled = busy;
  if (busy) {
    button.dataset.originalText = button.dataset.originalText || button.textContent;
    button.innerHTML = `<span class="btn-spinner"></span>${esc(label || 'Working...')}`;
  } else {
    button.textContent = label || button.dataset.originalText || 'Save';
    delete button.dataset.originalText;
  }
}

function setPageBusy(busy, message = 'Working...') {
  let overlay = $('reportsPageBusy');
  if (busy && !overlay) {
    overlay = document.createElement('div');
    overlay.id = 'reportsPageBusy';
    overlay.className = 'reports-page-busy';
    document.body.appendChild(overlay);
  }
  if (!overlay) return;
  overlay.innerHTML = `<div class="reports-page-busy-box"><span class="mini-spinner"></span>${esc(message)}</div>`;
  overlay.style.display = busy ? 'flex' : 'none';
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

function escAttr(value) {
  return esc(value).replace(/`/g, '&#96;');
}
