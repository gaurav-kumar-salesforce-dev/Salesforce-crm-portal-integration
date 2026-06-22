const state = {
  dashboards: [],
  folders: [],
  reports: [],
  activeDashboard: null,
  activeComponents: [],
  renderedComponents: [],
  filters: [],
  isDirty: false,
  view: 'recent',
  folderId: '',
  sort: 'updated_at',
  direction: 'desc',
  editingDashboardId: null,
  editingFolderId: null,
  editingComponentId: null,
  autoRefreshTimer: null,
  layoutAutosaveTimer: null,
  isEditMode: false,
  lastRefreshAt: null,
  fullscreenComponentId: null,
  tableState: {},
  hiddenLegend: {},
  drag: null,
  actionMenu: null
};

const CLIENT_CACHE_TTL_MS = 30 * 1000;
const browserMemoryCache = new Map();
const browserInFlightRequests = new Map();

const $ = (id) => document.getElementById(id);

document.addEventListener('DOMContentLoaded', async () => {
  initTheme();
  const appSidebarCollapsed = sessionStorage.getItem('reports_app_sidebar_collapsed') === '1';
  document.body.classList.toggle('sidebar-collapsed', appSidebarCollapsed);
  bindEvents();
  try {
    await Promise.all([loadFolders(), loadDashboards(), loadReports()]);
    const dashboardId = dashboardIdFromHash();
    if (dashboardId) await openDashboard(dashboardId, { pushState: false });
  } catch (err) {
    toast(err.message || 'Could not load dashboards', 'err');
  }
});

function bindEvents() {
  $('appSidebarToggle')?.addEventListener('click', toggleAppSidebar);
  $('newDashboardBtn').addEventListener('click', () => openDashboardEditorModal());
  $('newDashboardFolderBtn')?.addEventListener('click', () => openFolderModal());
  $('refreshDashboardsBtn').addEventListener('click', refreshDashboardHome);
  $('dashboardSearch').addEventListener('input', debounce(syncDashboardSearchAndLoad, 250));
  $('dashboardListSearch').addEventListener('input', debounce(syncDashboardSearchAndLoad, 250));
  $('dashboardFolderSearch')?.addEventListener('input', renderFolderTree);
  document.querySelectorAll('[data-dashboard-view]').forEach((button) => {
    button.addEventListener('click', () => selectDashboardView(button.dataset.dashboardView));
  });
  document.querySelectorAll('[data-dashboard-sort]').forEach((header) => {
    header.addEventListener('click', () => sortDashboards(header.dataset.dashboardSort));
  });
  $('dashboardName').addEventListener('input', markDirty);
  $('dashboardDescription').addEventListener('input', markDirty);
  $('saveDashboardBtn').addEventListener('click', saveDashboard);
  $('closeDashboardBtn').addEventListener('click', closeDashboard);
  $('dashboardEditModeBtn')?.addEventListener('click', () => setDashboardEditMode(!state.isEditMode));
  $('addComponentBtn').addEventListener('click', openComponentModal);
  $('dashboardPropertiesBtn')?.addEventListener('click', () => {
    if (!state.activeDashboard?.id) return toast('Save the dashboard before editing properties', 'info');
    openDashboardEditorModal(state.activeDashboard);
  });
  $('refreshDashboardRunBtn').addEventListener('click', () => runDashboard({ skipCache: true }));
  $('dashboardAutoRefresh')?.addEventListener('change', configureAutoRefresh);
  $('favoriteDashboardBtn').addEventListener('click', toggleFavorite);
  $('deleteDashboardBtn').addEventListener('click', deleteDashboard);
  $('closeDashboardEditorModalBtn')?.addEventListener('click', closeDashboardEditorModal);
  $('cancelDashboardEditorBtn')?.addEventListener('click', closeDashboardEditorModal);
  $('saveDashboardEditorBtn')?.addEventListener('click', saveDashboardFromEditor);
  $('cloneDashboardFromModalBtn')?.addEventListener('click', cloneDashboardFromEditor);
  $('deleteDashboardFromModalBtn')?.addEventListener('click', deleteDashboardFromEditor);
  $('closeDashboardFolderModalBtn')?.addEventListener('click', closeFolderModal);
  $('cancelDashboardFolderBtn')?.addEventListener('click', closeFolderModal);
  $('saveDashboardFolderBtn')?.addEventListener('click', saveFolderFromModal);
  $('deleteDashboardFolderBtn')?.addEventListener('click', deleteFolderFromModal);
  $('dashboardFiltersBtn')?.addEventListener('click', openDashboardFilterModal);
  $('closeDashboardFilterModalBtn')?.addEventListener('click', closeDashboardFilterModal);
  $('cancelDashboardFilterBtn')?.addEventListener('click', closeDashboardFilterModal);
  $('saveDashboardFilterBtn')?.addEventListener('click', addDashboardFilter);
  $('closeComponentModalBtn').addEventListener('click', closeComponentModal);
  $('cancelComponentBtn').addEventListener('click', closeComponentModal);
  $('componentType')?.addEventListener('change', syncComponentModalFields);
  $('saveComponentBtn').addEventListener('click', saveComponentFromModal);
  $('cloneComponentFromModalBtn')?.addEventListener('click', cloneComponentFromModal);
  $('deleteComponentFromModalBtn')?.addEventListener('click', deleteComponentFromModal);

  // Actions dropdown logic
  const dropdownTrigger = $('dashboardActionsBtn');
  const dropdownMenu = $('dashboardActionsMenu');
  if (dropdownTrigger && dropdownMenu) {
    dropdownTrigger.addEventListener('click', (e) => {
      e.stopPropagation();
      dropdownMenu.classList.toggle('show');
    });
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.actions-dropdown-container')) {
        dropdownMenu.classList.remove('show');
      }
    });
  }

  $('actionDashboardFilters')?.addEventListener('click', () => {
    dropdownMenu?.classList.remove('show');
    $('dashboardFiltersBtn')?.click();
  });
  $('actionDashboardProperties')?.addEventListener('click', () => {
    dropdownMenu?.classList.remove('show');
    $('dashboardPropertiesBtn')?.click();
  });
  $('actionDashboardFavorite')?.addEventListener('click', () => {
    dropdownMenu?.classList.remove('show');
    $('favoriteDashboardBtn')?.click();
  });
  $('actionDashboardClone')?.addEventListener('click', () => {
    dropdownMenu?.classList.remove('show');
    if (!state.activeDashboard?.id) return toast('Save the dashboard first', 'info');
    cloneDashboard(state.activeDashboard.id);
  });
  $('actionDashboardDelete')?.addEventListener('click', () => {
    dropdownMenu?.classList.remove('show');
    $('deleteDashboardBtn')?.click();
  });
  $('actionDashboardExport')?.addEventListener('click', () => {
    dropdownMenu?.classList.remove('show');
    toast('Dashboard export is not implemented in the backend', 'info');
  });
  $('actionDashboardSchedule')?.addEventListener('click', () => {
    dropdownMenu?.classList.remove('show');
    toast('Dashboard subscription schedule is not implemented in the backend', 'info');
  });
  $('actionDashboardShare')?.addEventListener('click', () => {
    dropdownMenu?.classList.remove('show');
    toast('Dashboard sharing is not implemented in the backend', 'info');
  });
  $('actionDashboardPrint')?.addEventListener('click', () => {
    dropdownMenu?.classList.remove('show');
    window.print();
  });

  document.addEventListener('pointermove', handleDashboardPointerMove);
  document.addEventListener('pointerup', handleDashboardPointerUp);
  document.addEventListener('click', (event) => {
    if (!event.target.closest('.dashboard-row-menu') && !event.target.closest('.row-action-btn')) closeActionMenu();
  });

  // Card selection/deselection when clicking in edit mode
  document.addEventListener('pointerdown', (event) => {
    if (!state.isEditMode) return;
    const card = event.target.closest('.dashboard-component-card');
    if (card) {
      document.querySelectorAll('.dashboard-component-card.selected').forEach(c => {
        if (c !== card) c.classList.remove('selected');
      });
      card.classList.add('selected');
    } else if (!event.target.closest('.dash-handle') && !event.target.closest('.dashboard-toolbar')) {
      document.querySelectorAll('.dashboard-component-card.selected').forEach(c => {
        c.classList.remove('selected');
      });
    }
  });

  // Handle window resizing to update grid background and component sizes instantly
  window.addEventListener('resize', () => {
    const canvas = $('dashboardCanvas');
    if (canvas && state.activeDashboard && state.isEditMode) {
      updateCanvasGridBackground(canvas);
      // Re-layout cards since colW changes
      state.activeComponents.forEach(comp => {
        const cardEl = canvas.querySelector(`.dashboard-component-card[data-component-id="${comp.id}"]`);
        if (cardEl && !cardEl.classList.contains('dragging')) {
          const geo = gridToPixels(canvas, comp.position_x || 0, comp.position_y || 0, comp.width || 6, comp.height || 3);
          applyCardGeometry(cardEl, geo.left, geo.top, geo.width, geo.height);
        }
      });
      resizeCanvasHeight(canvas);
    }
  });

  window.addEventListener('beforeunload', (event) => {
    if (!state.isDirty) return;
    event.preventDefault();
    event.returnValue = '';
  });
}

async function api(path, options = {}) {
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
  }
  const request = fetch(path, {
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
    '/api/dashboards',
    '/api/dashboards/folders',
    '/api/reports'
  ];
  if (!cacheable.some((prefix) => cleanPath === prefix || cleanPath.startsWith(`${prefix}/`) || cleanPath.startsWith(`${prefix}?`))) return '';
  if (cleanPath.includes('/run')) return '';
  return `saasray:v1:${cleanPath}`;
}

function browserCacheGet(key) {
  const item = browserMemoryCache.get(key);
  if (!item || Date.now() > item.expiresAt) {
    if (item) browserMemoryCache.delete(key);
    return null;
  }
  return item.value;
}

function browserCacheSet(key, value, ttlMs = 60 * 1000) {
  browserMemoryCache.set(key, { value, expiresAt: Date.now() + Math.min(ttlMs, CLIENT_CACHE_TTL_MS) });
}

function browserCacheInvalidate(path) {
  const scope = String(path || '').startsWith('/api/reports') ? 'saasray:v1:/api/reports' : 'saasray:v1:/api/dashboards';
  for (const key of browserMemoryCache.keys()) {
    if (key.startsWith(scope)) browserMemoryCache.delete(key);
  }
  for (const key of browserInFlightRequests.keys()) {
    if (key.startsWith(scope)) browserInFlightRequests.delete(key);
  }
}

async function loadDashboards(options = {}) {
  const q = ($('dashboardListSearch')?.value || $('dashboardSearch')?.value || '').trim();
  setPageBusy(true, 'Loading dashboards...');
  const params = new URLSearchParams();
  if (q) params.set('search', q);
  if (state.view) params.set('view', state.view);
  if (state.folderId) params.set('folderId', state.folderId);
  params.set('sort', sortFieldForApi(state.sort));
  params.set('direction', state.direction);
  const data = await api(`/api/dashboards?${params.toString()}`, {
    skipBrowserCache: Boolean(options.forceRefresh)
  }).finally(() => setPageBusy(false));
  state.dashboards = data.dashboards || [];
  const count = state.dashboards.length;
  $('dashboardCount').textContent = `${count} ${count === 1 ? 'item' : 'items'}`;
  $('dashboardsSubtitle').textContent = `${count} ${count === 1 ? 'item' : 'items'}`;
  $('dashboardsTitle').textContent = currentViewTitle();
  updateNavState();
  renderDashboards();
}

async function loadFolders() {
  const data = await api('/api/dashboards/folders');
  state.folders = data.folders || [];
  renderFolderTree();
}

async function loadReports() {
  const data = await api('/api/reports');
  state.reports = data.reports || [];
}

async function refreshDashboardHome() {
  await Promise.all([
    api('/api/dashboards/folders', { skipBrowserCache: true }).then((data) => {
      state.folders = data.folders || [];
      renderFolderTree();
    }),
    loadDashboards({ forceRefresh: true })
  ]);
}

function syncDashboardSearchAndLoad(event) {
  const value = event?.target?.value || '';
  if ($('dashboardSearch') !== event?.target) $('dashboardSearch').value = value;
  if ($('dashboardListSearch') !== event?.target) $('dashboardListSearch').value = value;
  loadDashboards();
}

function selectDashboardView(view, folderId = '') {
  state.view = view || 'recent';
  state.folderId = folderId;
  loadDashboards();
}

function sortDashboards(field) {
  const normalized = sortFieldForApi(field);
  if (state.sort === normalized) {
    state.direction = state.direction === 'asc' ? 'desc' : 'asc';
  } else {
    state.sort = normalized;
    state.direction = 'asc';
  }
  loadDashboards();
}

function sortFieldForApi(field) {
  if (field === 'name') return 'name';
  if (field === 'description') return 'description';
  if (field === 'visibility') return 'visibility';
  return 'updated_at';
}

function currentViewTitle() {
  if (state.folderId) return state.folders.find((folder) => folder.id === state.folderId)?.name || 'Folder';
  return ({
    recent: 'Recent',
    mine: 'Created by Me',
    created: 'Created by Me',
    private: 'Private Dashboards',
    public: 'Public Dashboards',
    shared: 'Shared With Me',
    folders: 'All Folders',
    favorites: 'All Favorites',
    all: 'All Dashboards'
  })[state.view] || 'Dashboards';
}

function updateNavState() {
  document.querySelectorAll('[data-dashboard-view]').forEach((button) => {
    const active = button.dataset.dashboardView === state.view && !state.folderId;
    button.classList.toggle('active', active);
  });
  document.querySelectorAll('[data-dashboard-folder-id]').forEach((button) => {
    button.classList.toggle('active', button.dataset.dashboardFolderId === state.folderId);
  });
  $('navCountRecent') && ($('navCountRecent').textContent = '');
  $('navCountAll') && ($('navCountAll').textContent = '');
  $('navCountFavorites') && ($('navCountFavorites').textContent = '');
}

function renderFolderTree() {
  const tree = $('dashboardFolderTree');
  if (!tree) return;
  const needle = ($('dashboardFolderSearch')?.value || '').trim().toLowerCase();
  const folders = state.folders.filter((folder) => !needle || folder.name.toLowerCase().includes(needle));
  tree.innerHTML = folders.length ? folders.map((folder) => `
    <button class="folder-tree-item ${state.folderId === folder.id ? 'active' : ''}" type="button" data-dashboard-folder-id="${esc(folder.id)}" onclick="selectDashboardView('all', '${esc(folder.id)}')">
      <span>${folder.is_favorite ? '★ ' : ''}${esc(folder.name)}</span>
      <small>${Number(folder.count || 0)}</small>
    </button>
  `).join('') : '<div class="folder-empty">No folders</div>';
}

function renderDashboards() {
  if (!state.dashboards.length) {
    $('dashboardsList').innerHTML = '<tr><td colspan="7" class="reports-empty-row">No dashboards found. Click <strong>New Dashboard</strong> to create one.</td></tr>';
    return;
  }
  $('dashboardsList').innerHTML = state.dashboards.map((dashboard) => `
    <tr class="${state.activeDashboard?.id === dashboard.id ? 'active' : ''}">
      <td>
        <button class="report-name-link" onclick="openDashboard('${esc(dashboard.id)}')">${dashboard.is_favorite ? starIcon() : ''}${esc(dashboard.name)}</button>
      </td>
      <td style="color:var(--text-2)">${esc(dashboard.description || '-')}</td>
      <td>${esc(dashboard.folder_name || 'Private Dashboards')}</td>
      <td>${esc(dashboard.owner_name || dashboard.owner_email || '-')}</td>
      <td><span class="dashboard-pill">${esc(titleCase(dashboard.visibility))}</span></td>
      <td style="color:var(--text-2)">${new Date(dashboard.updated_at).toLocaleString()}</td>
      <td><button class="row-action-btn" onclick="toggleDashboardRowMenu(event, '${esc(dashboard.id)}')" title="Dashboard actions">${moreIcon()}</button></td>
    </tr>
  `).join('');
}

function toggleDashboardRowMenu(event, dashboardId) {
  event.stopPropagation();
  const dashboard = state.dashboards.find((item) => item.id === dashboardId);
  if (!dashboard) return;
  closeActionMenu();
  const menu = document.createElement('div');
  menu.className = 'dashboard-row-menu';
  menu.innerHTML = `
    <button onclick="openDashboard('${esc(dashboard.id)}')">Run</button>
    <button onclick="openDashboardEditorModalById('${esc(dashboard.id)}')" ${dashboard.can_edit ? '' : 'disabled'}>Edit Properties</button>
    <button onclick="cloneDashboard('${esc(dashboard.id)}')">Clone</button>
    <button onclick="toggleDashboardFavoriteById('${esc(dashboard.id)}')">${dashboard.is_favorite ? 'Remove Favorite' : 'Favorite'}</button>
    <button onclick="openDashboardEditorModalById('${esc(dashboard.id)}')" ${dashboard.can_edit ? '' : 'disabled'}>Move</button>
    <button class="danger" onclick="deleteDashboardById('${esc(dashboard.id)}')" ${dashboard.can_edit ? '' : 'disabled'}>Delete</button>
  `;
  document.body.appendChild(menu);
  const rect = event.currentTarget.getBoundingClientRect();
  menu.style.top = `${rect.bottom + window.scrollY + 4}px`;
  menu.style.left = `${Math.max(12, rect.right + window.scrollX - 190)}px`;
  state.actionMenu = menu;
}

function closeActionMenu() {
  state.actionMenu?.remove();
  state.actionMenu = null;
}

function openDashboardEditorModal(dashboard = null) {
  state.editingDashboardId = dashboard?.id || null;
  const currentUser = currentUserInfo();
  const isEdit = Boolean(dashboard?.id);
  $('dashboardEditorTitle').textContent = isEdit ? 'Dashboard Properties' : 'New Dashboard';
  $('dashboardEditorName').value = dashboard?.name || 'New Dashboard';
  $('dashboardEditorDescription').value = dashboard?.description || '';
  $('dashboardEditorVisibility').value = normalizeVisibility(dashboard?.visibility || 'private');
  $('dashboardEditorOwner').value = dashboard?.owner_name || dashboard?.owner_email || currentUser.name || currentUser.email || 'Current user';
  populateDashboardFolderSelect($('dashboardEditorFolder'), dashboard?.folder_id || state.folderId || '');
  $('deleteDashboardFromModalBtn').style.display = isEdit ? '' : 'none';
  $('cloneDashboardFromModalBtn').style.display = isEdit ? '' : 'none';
  $('saveDashboardEditorBtn').textContent = isEdit ? 'Save Changes' : 'Create Dashboard';
  $('dashboardEditorModal').style.display = 'flex';
}

function openDashboardEditorModalById(dashboardId) {
  closeActionMenu();
  const dashboard = state.dashboards.find((item) => item.id === dashboardId) || state.activeDashboard;
  if (!dashboard) return toast('Dashboard not found in the current list', 'err');
  openDashboardEditorModal(dashboard);
}

function closeDashboardEditorModal() {
  state.editingDashboardId = null;
  $('dashboardEditorModal').style.display = 'none';
}

async function saveDashboardFromEditor() {
  const payload = dashboardEditorPayload();
  if (!payload.name) return toast('Dashboard name is required', 'err');
  const button = $('saveDashboardEditorBtn');
  const editingId = state.editingDashboardId;
  setBusy(button, true, editingId ? 'Saving...' : 'Creating...');
  try {
    const data = editingId
      ? await api(`/api/dashboards/${editingId}`, { method: 'PATCH', body: JSON.stringify(payload) })
      : await api('/api/dashboards', { method: 'POST', body: JSON.stringify({ ...payload, layout: { columns: 12, rowHeight: 90 }, filters: [] }) });
    closeDashboardEditorModal();
    await Promise.all([loadFolders(), loadDashboards()]);
    if (!editingId) await openDashboard(data.dashboard.id);
    if (state.activeDashboard?.id === data.dashboard.id) {
      state.activeDashboard = { ...state.activeDashboard, ...data.dashboard };
      $('dashboardName').value = data.dashboard.name || '';
      $('dashboardDescription').value = data.dashboard.description || '';
      markSaved();
    }
    toast(editingId ? 'Dashboard updated' : 'Dashboard created', 'ok');
  } catch (err) {
    toast(err.message, 'err');
  } finally {
    setBusy(button, false, editingId ? 'Save Changes' : 'Create Dashboard');
  }
}

function dashboardEditorPayload() {
  return {
    name: $('dashboardEditorName').value.trim(),
    description: $('dashboardEditorDescription').value.trim(),
    folderId: $('dashboardEditorFolder').value || null,
    visibility: normalizeVisibility($('dashboardEditorVisibility').value)
  };
}

async function cloneDashboardFromEditor() {
  if (!state.editingDashboardId) return;
  await cloneDashboard(state.editingDashboardId, dashboardEditorPayload());
  closeDashboardEditorModal();
}

async function deleteDashboardFromEditor() {
  if (!state.editingDashboardId) return;
  await deleteDashboardById(state.editingDashboardId);
  closeDashboardEditorModal();
}

async function cloneDashboard(dashboardId, overrides = {}) {
  closeActionMenu();
  const source = state.dashboards.find((item) => item.id === dashboardId) || state.activeDashboard;
  const payload = {
    name: overrides.name && overrides.name !== source?.name ? overrides.name : `${source?.name || 'Dashboard'} Copy`,
    description: overrides.description ?? source?.description ?? '',
    folderId: overrides.folderId || source?.folder_id || null,
    visibility: normalizeVisibility(overrides.visibility || source?.visibility || 'private')
  };
  setPageBusy(true, 'Cloning dashboard...');
  try {
    const data = await api(`/api/dashboards/${dashboardId}/clone`, { method: 'POST', body: JSON.stringify(payload) });
    await Promise.all([loadFolders(), loadDashboards()]);
    toast('Dashboard cloned', 'ok');
    await openDashboard(data.dashboard.id);
  } catch (err) {
    toast(err.message, 'err');
  } finally {
    setPageBusy(false);
  }
}

async function toggleDashboardFavoriteById(dashboardId) {
  closeActionMenu();
  const dashboard = state.dashboards.find((item) => item.id === dashboardId);
  const favorite = !dashboard?.is_favorite;
  try {
    await api(`/api/dashboards/${dashboardId}/favorite`, { method: favorite ? 'POST' : 'DELETE', body: favorite ? '{}' : undefined });
    await loadDashboards();
    toast(favorite ? 'Dashboard favorited' : 'Favorite removed', 'ok');
  } catch (err) {
    toast(err.message, 'err');
  }
}

async function deleteDashboardById(dashboardId) {
  closeActionMenu();
  const dashboard = state.dashboards.find((item) => item.id === dashboardId) || state.activeDashboard;
  if (!confirm(`Delete "${dashboard?.name || 'this dashboard'}"?`)) return;
  setPageBusy(true, 'Deleting dashboard...');
  try {
    await api(`/api/dashboards/${dashboardId}`, { method: 'DELETE' });
    if (state.activeDashboard?.id === dashboardId) closeDashboard();
    await Promise.all([loadFolders(), loadDashboards()]);
    toast('Dashboard deleted', 'ok');
  } catch (err) {
    toast(err.message, 'err');
  } finally {
    setPageBusy(false);
  }
}

function openFolderModal(folder = null) {
  state.editingFolderId = folder?.id || null;
  const isEdit = Boolean(folder?.id);
  $('dashboardFolderTitle').textContent = isEdit ? 'Edit Folder' : 'New Folder';
  $('dashboardFolderName').value = folder?.name || '';
  $('dashboardFolderDescription').value = folder?.description || '';
  $('dashboardFolderVisibility').value = normalizeVisibility(folder?.visibility || 'private');
  $('deleteDashboardFolderBtn').style.display = isEdit ? '' : 'none';
  $('saveDashboardFolderBtn').textContent = isEdit ? 'Save Folder' : 'Create Folder';
  $('dashboardFolderModal').style.display = 'flex';
}

function openFolderModalById(folderId) {
  const folder = state.folders.find((item) => item.id === folderId);
  if (!folder) return toast('Folder not found', 'err');
  openFolderModal(folder);
}

function closeFolderModal() {
  state.editingFolderId = null;
  $('dashboardFolderModal').style.display = 'none';
}

async function saveFolderFromModal() {
  const payload = {
    name: $('dashboardFolderName').value.trim(),
    description: $('dashboardFolderDescription').value.trim(),
    visibility: normalizeVisibility($('dashboardFolderVisibility').value)
  };
  if (!payload.name) return toast('Folder name is required', 'err');
  const button = $('saveDashboardFolderBtn');
  const editingId = state.editingFolderId;
  setBusy(button, true, editingId ? 'Saving...' : 'Creating...');
  try {
    await api(editingId ? `/api/dashboards/folders/${editingId}` : '/api/dashboards/folders', {
      method: editingId ? 'PATCH' : 'POST',
      body: JSON.stringify(payload)
    });
    closeFolderModal();
    await Promise.all([loadFolders(), loadDashboards()]);
    toast(editingId ? 'Folder updated' : 'Folder created', 'ok');
  } catch (err) {
    toast(err.message, 'err');
  } finally {
    setBusy(button, false, editingId ? 'Save Folder' : 'Create Folder');
  }
}

async function deleteFolderFromModal() {
  if (!state.editingFolderId) return;
  const folder = state.folders.find((item) => item.id === state.editingFolderId);
  if (!confirm(`Delete "${folder?.name || 'this folder'}"? Dashboards will move to no folder.`)) return;
  const button = $('deleteDashboardFolderBtn');
  setBusy(button, true, 'Deleting...');
  try {
    await api(`/api/dashboards/folders/${state.editingFolderId}`, { method: 'DELETE' });
    if (state.folderId === state.editingFolderId) {
      state.folderId = '';
      state.view = 'all';
    }
    closeFolderModal();
    await Promise.all([loadFolders(), loadDashboards()]);
    toast('Folder deleted', 'ok');
  } catch (err) {
    toast(err.message, 'err');
  } finally {
    setBusy(button, false, 'Delete Folder');
  }
}

function populateDashboardFolderSelect(select, selectedId = '') {
  if (!select) return;
  const options = ['<option value="">Private Dashboards</option>'].concat(
    state.folders
      .filter((folder) => folder.can_edit || folder.id === selectedId)
      .map((folder) => `<option value="${esc(folder.id)}">${esc(folder.name)} (${esc(titleCase(folder.visibility))})</option>`)
  );
  select.innerHTML = options.join('');
  select.value = selectedId || '';
}

async function openDashboard(id, options = {}) {
  const data = await api(`/api/dashboards/${id}`);
  state.activeDashboard = data.dashboard;
  state.activeComponents = data.dashboard.components || [];
  state.renderedComponents = [];
  if (options.pushState !== false) window.history.replaceState(null, '', `#dashboard/${id}`);
  showBuilder();
  setDashboardEditMode(false);
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
  setDashboardEditMode(true);
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
  updateDashboardEditControls();
}

function closeDashboard() {
  if (state.isDirty && !confirm('You have unsaved dashboard changes. Leave this dashboard?')) return;
  state.activeDashboard = null;
  state.activeComponents = [];
  state.renderedComponents = [];
  configureAutoRefresh(0);
  setDashboardEditMode(false);
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
    folderId: state.activeDashboard?.folder_id || null,
    visibility: normalizeVisibility(state.activeDashboard?.visibility || 'private')
  };
  if (!payload.name) return toast('Dashboard name is required', 'err');
  const button = $('saveDashboardBtn');
  
  // Set draft indicator to Saving...
  const indicator = $('dashboardDraftIndicator');
  if (indicator) {
    indicator.textContent = 'Saving...';
    indicator.className = 'draft-indicator saving';
  }
  setBusy(button, true, 'Saving...');

  try {
    const data = state.activeDashboard
      ? await api(`/api/dashboards/${state.activeDashboard.id}`, { method: 'PATCH', body: JSON.stringify(payload) })
      : await api('/api/dashboards', { method: 'POST', body: JSON.stringify(payload) });
    state.activeDashboard = data.dashboard;
    window.history.replaceState(null, '', `#dashboard/${state.activeDashboard.id}`);
    
    // Explicitly persist all layout positions
    if (state.activeComponents.length) {
      await Promise.all(state.activeComponents.map(component => persistComponentLayout(component)));
    }

    await loadDashboards();
    markSaved();
    toast('Dashboard saved', 'ok');
  } catch (err) {
    toast(err.message, 'err');
    if (indicator) {
      indicator.textContent = 'Unsaved changes';
      indicator.className = 'draft-indicator dirty';
    }
  } finally {
    setBusy(button, false, 'Save');
    updateDashboardEditControls();
  }
}

async function runDashboard(options = {}) {
  if (!state.activeDashboard?.id) {
    renderDashboardCanvas();
    return;
  }
  const button = $('refreshDashboardRunBtn');
  setBusy(button, true, 'Refreshing...');
  if (!state.renderedComponents.length && state.activeComponents.length) {
    state.renderedComponents = state.activeComponents.map((component) => ({
      componentId: component.id,
      title: component.title,
      type: component.component_type,
      chartType: component.config?.chartType,
      config: component.config || {},
      layout: {
        x: component.position_x,
        y: component.position_y,
        w: component.width,
        h: component.height
      },
      rows: [],
      columns: [],
      meta: { reportName: 'Loading...' }
    }));
    renderDashboardCanvas();
    document.querySelectorAll('.dashboard-component-card').forEach((card) => card.classList.add('loading'));
  }
  try {
    const data = await api(`/api/dashboards/${state.activeDashboard.id}/run`, { method: 'POST', body: JSON.stringify({ skipCache: Boolean(options.skipCache) }) });
    state.renderedComponents = data.components || [];
    state.lastRefreshAt = new Date();
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
  const container = $('dashboardGlobalFilters');
  if (!container) return;
  if (state.filters.length) {
    container.innerHTML = state.filters.map((filter, index) => `
      <span class="field-pill">${esc(filter.field)} ${esc(filter.operator)} ${esc(filter.value)}
        <button onclick="removeDashboardFilter(${index})">&times;</button>
      </span>
    `).join('');
  } else {
    if (state.isEditMode) {
      container.innerHTML = `
        <div class="empty-filters-banner">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"></polygon></svg>
          <div class="empty-filters-text">
            <strong>Add Global Filters</strong>
            <span>Global filters let users filter all components in the dashboard by a shared field.</span>
          </div>
          <button type="button" class="btn btn-ghost btn-sm" onclick="$('dashboardFiltersBtn')?.click()">+ Add Filter</button>
        </div>
      `;
    } else {
      container.innerHTML = '<span class="muted">No dashboard global filters.</span>';
    }
  }
}

function openComponentModal(component = null) {
  if (!state.isEditMode) return toast('Switch to Edit Mode to change dashboard components', 'info');
  if (!state.activeDashboard?.id) return toast('Save the dashboard before adding components', 'info');
  state.editingComponentId = component?.id || component?.componentId || null;
  const type = component?.component_type || component?.type || 'chart';
  const config = component?.config || {};
  $('componentTitle').value = component?.title || '';
  $('componentReport').innerHTML = state.reports
    .map((report) => `<option value="${esc(report.id)}">${esc(report.name)}</option>`)
    .join('');
  $('componentReport').value = component?.report_id || config.reportId || component?.reportId || '';
  $('componentType').value = type;
  $('componentChartType').value = config.chartType || component?.chartType || (type === 'gauge' ? 'gauge' : 'bar');
  $('componentWidth').value = String(component?.width || component?.layout?.w || 6);
  $('componentHeight').value = String(component?.height || component?.layout?.h || (type === 'kpi' ? 2 : 3));
  $('componentLimit').value = String(config.limit || 10);
  $('componentGaugeMax').value = String(config.max || 100);
  $('componentTarget').value = config.target ?? '';
  $('componentRichText').value = config.text || '';
  $('componentImageUrl').value = config.imageUrl || '';
  $('saveComponentBtn').textContent = state.editingComponentId ? 'Save Component' : 'Add Component';
  $('deleteComponentFromModalBtn').style.display = state.editingComponentId ? '' : 'none';
  $('cloneComponentFromModalBtn').style.display = state.editingComponentId ? '' : 'none';
  syncComponentModalFields();
  $('componentModal').style.display = 'flex';
}

function closeComponentModal() {
  state.editingComponentId = null;
  $('componentModal').style.display = 'none';
}

function syncComponentModalFields() {
  const type = $('componentType').value;
  const needsReport = !['rich_text', 'image'].includes(type);
  $('componentReport').closest('.form-field').style.display = needsReport ? '' : 'none';
  $('componentChartTypeField').style.display = type === 'chart' ? '' : 'none';
  $('componentLimitField').style.display = ['chart', 'table'].includes(type) ? '' : 'none';
  $('componentGaugeMaxField').style.display = type === 'gauge' ? '' : 'none';
  $('componentTargetField').style.display = ['kpi', 'gauge'].includes(type) ? '' : 'none';
  $('componentRichTextField').style.display = type === 'rich_text' ? '' : 'none';
  $('componentImageUrlField').style.display = type === 'image' ? '' : 'none';
}

function componentPayloadFromModal(source = null) {
  const type = $('componentType').value;
  const reportId = $('componentReport').value;
  const report = state.reports.find((item) => item.id === reportId);
  const config = {
    chartType: type === 'gauge' ? 'gauge' : $('componentChartType').value,
    limit: Number($('componentLimit').value || 10),
    max: Number($('componentGaugeMax').value || 100),
    target: $('componentTarget').value === '' ? null : Number($('componentTarget').value),
    text: $('componentRichText').value.trim(),
    imageUrl: $('componentImageUrl').value.trim()
  };
  return {
    title: $('componentTitle').value.trim() || report?.name || 'Dashboard Component',
    reportId: ['rich_text', 'image'].includes(type) ? null : reportId,
    componentType: type,
    width: Number($('componentWidth').value || 6),
    height: Number($('componentHeight').value || (type === 'kpi' ? 2 : 3)),
    positionX: Number(source?.position_x ?? source?.layout?.x ?? 0),
    positionY: Number(source?.position_y ?? source?.layout?.y ?? state.activeComponents.length * 3),
    config
  };
}

async function saveComponentFromModal() {
  const source = state.editingComponentId ? state.activeComponents.find((item) => item.id === state.editingComponentId) : null;
  const payload = componentPayloadFromModal(source);
  if (!payload.reportId && !['rich_text', 'image'].includes(payload.componentType)) return toast('Select a saved report', 'err');
  if (payload.componentType === 'image' && !payload.config.imageUrl) return toast('Enter an image URL', 'err');
  if (payload.componentType === 'rich_text' && !payload.config.text) return toast('Enter rich text content', 'err');
  const button = $('saveComponentBtn');
  setBusy(button, true, state.editingComponentId ? 'Saving...' : 'Adding...');
  try {
    const path = state.editingComponentId
      ? `/api/dashboards/${state.activeDashboard.id}/components/${state.editingComponentId}`
      : `/api/dashboards/${state.activeDashboard.id}/components`;
    await api(path, {
      method: state.editingComponentId ? 'PATCH' : 'POST',
      body: JSON.stringify(payload)
    });
    closeComponentModal();
    const data = await api(`/api/dashboards/${state.activeDashboard.id}`);
    state.activeDashboard = data.dashboard;
    state.activeComponents = data.dashboard.components || [];
    await runDashboard();
    toast(state.editingComponentId ? 'Component updated' : 'Component added', 'ok');
  } catch (err) {
    toast(err.message, 'err');
  } finally {
    setBusy(button, false, state.editingComponentId ? 'Save Component' : 'Add Component');
  }
}

function editComponent(componentId) {
  if (!state.isEditMode) return toast('Switch to Edit Mode to edit components', 'info');
  const source = state.activeComponents.find((item) => item.id === componentId);
  const rendered = state.renderedComponents.find((item) => item.componentId === componentId) || {};
  if (!source && !rendered) return toast('Component not found', 'err');
  openComponentModal({ ...rendered, ...source, config: source?.config || rendered.config || {} });
}

async function cloneComponent(componentId) {
  if (!state.isEditMode) return toast('Switch to Edit Mode to clone components', 'info');
  const source = state.activeComponents.find((item) => item.id === componentId);
  if (!source) return toast('Component not found', 'err');
  const payload = {
    title: `${source.title || 'Component'} Copy`,
    reportId: source.report_id || null,
    componentType: source.component_type,
    width: source.width,
    height: source.height,
    positionX: Math.min((source.position_x || 0) + 1, 11),
    positionY: (source.position_y || 0) + 1,
    config: source.config || {}
  };
  setPageBusy(true, 'Cloning component...');
  try {
    await api(`/api/dashboards/${state.activeDashboard.id}/components`, { method: 'POST', body: JSON.stringify(payload) });
    await reloadActiveDashboardAndRun();
    toast('Component cloned', 'ok');
  } catch (err) {
    toast(err.message, 'err');
  } finally {
    setPageBusy(false);
  }
}

async function cloneComponentFromModal() {
  if (!state.editingComponentId) return;
  await cloneComponent(state.editingComponentId);
  closeComponentModal();
}

async function deleteComponentFromModal() {
  if (!state.editingComponentId) return;
  await removeComponent(state.editingComponentId);
  closeComponentModal();
}

async function removeComponent(componentId) {
  if (!state.isEditMode) return toast('Switch to Edit Mode to delete components', 'info');
  if (!confirm('Remove this dashboard component?')) return;
  await api(`/api/dashboards/${state.activeDashboard.id}/components/${componentId}`, { method: 'DELETE' });
  state.activeComponents = state.activeComponents.filter((component) => component.id !== componentId);
  state.renderedComponents = state.renderedComponents.filter((component) => component.componentId !== componentId);
  renderDashboardCanvas();
}

async function refreshComponent(componentId) {
  if (!state.activeDashboard?.id) return;
  setComponentLoading(componentId, true);
  try {
    const data = await api(`/api/dashboards/${state.activeDashboard.id}/components/${componentId}/run`, {
      method: 'POST',
      body: JSON.stringify({ skipCache: true })
    });
    const rendered = data.component;
    state.renderedComponents = state.renderedComponents.map((component) => (
      component.componentId === componentId ? rendered : component
    ));
    if (!state.renderedComponents.some((component) => component.componentId === componentId)) {
      state.renderedComponents.push(rendered);
    }
    state.lastRefreshAt = new Date();
    renderDashboardCanvas();
  } catch (err) {
    toast(err.message, 'err');
    setComponentLoading(componentId, false);
  }
}

async function reloadActiveDashboardAndRun() {
  const data = await api(`/api/dashboards/${state.activeDashboard.id}`);
  state.activeDashboard = data.dashboard;
  state.activeComponents = data.dashboard.components || [];
  await runDashboard();
}

/* =================================================================
   GRID MATH HELPERS — same constants used by Salesforce Dashboard
   ================================================================= */

const DB_COLS = 12;         // number of columns
const DB_PAD_X = 24;        // horizontal padding (left and right)
const DB_PAD_Y = 18;        // top padding
const DB_PAD_BOTTOM = 48;   // bottom padding
const DB_GAP = 14;          // gap between cells
const DB_ROW_H = 82;        // height of a single grid row, in px

// Compute the pixel left/top/width/height of a grid cell.
// col and row are 0-indexed; colSpan and rowSpan in grid units.
function gridToPixels(canvas, col, row, colSpan, rowSpan) {
  const contentW = canvas.clientWidth - DB_PAD_X * 2;
  const colW = (contentW - (DB_COLS - 1) * DB_GAP) / DB_COLS;
  const left = DB_PAD_X + col * (colW + DB_GAP);
  const top  = DB_PAD_Y + row * (DB_ROW_H + DB_GAP);
  const width  = colSpan * colW + (colSpan - 1) * DB_GAP;
  const height = rowSpan * DB_ROW_H + (rowSpan - 1) * DB_GAP;
  return { left, top, width, height, colW };
}

// Snap pixel offset to nearest column/row.
function pixelsToGrid(canvas, pixelLeft, pixelTop) {
  const contentW = canvas.clientWidth - DB_PAD_X * 2;
  const colW = (contentW - (DB_COLS - 1) * DB_GAP) / DB_COLS;
  const col = Math.round((pixelLeft - DB_PAD_X) / (colW + DB_GAP));
  const row = Math.round((pixelTop  - DB_PAD_Y) / (DB_ROW_H + DB_GAP));
  return { col, row };
}

// Apply pixel geometry to a card element.
function applyCardGeometry(cardEl, left, top, width, height) {
  cardEl.style.left   = `${left}px`;
  cardEl.style.top    = `${top}px`;
  cardEl.style.width  = `${width}px`;
  cardEl.style.height = `${height}px`;
}

// Compute the total canvas height needed and set it.
function resizeCanvasHeight(canvas) {
  let maxBottom = 0;
  canvas.querySelectorAll('.dashboard-component-card').forEach(card => {
    const t = parseFloat(card.style.top) || 0;
    const h = parseFloat(card.style.height) || 0;
    if (t + h > maxBottom) maxBottom = t + h;
  });
  canvas.style.minHeight = `${maxBottom + DB_PAD_BOTTOM}px`;
}

/* ================================================
   DRAG — startComponentDrag
   ================================================ */
function startComponentDrag(event, componentId) {
  if (!state.isEditMode) return;
  if (event.button !== 0) return;
  const card = event.target.closest('.dashboard-component-card');
  const source = state.activeComponents.find(item => item.id === componentId);
  if (!card || !source) return;
  event.preventDefault();

  // Pointer capture ensures movement works even if cursor leaves the card
  try {
    event.target.setPointerCapture(event.pointerId);
  } catch (err) {}

  // Disable text selection on body
  document.body.style.userSelect = 'none';
  document.body.style.webkitUserSelect = 'none';

  // Make sure card selection state is active
  document.querySelectorAll('.dashboard-component-card.selected').forEach(c => {
    if (c !== card) c.classList.remove('selected');
  });
  card.classList.add('selected');

  const cardRect = card.getBoundingClientRect();
  state.drag = {
    mode: 'move',
    componentId,
    // offset of pointer inside the card at drag-start
    offsetX: event.clientX - cardRect.left,
    offsetY: event.clientY - cardRect.top,
    startCol: Number(source.position_x || 0),
    startRow: Number(source.position_y || 0),
    startWidth: Number(source.width || 6),
    startHeight: Number(source.height || 3),
    card
  };

  card.classList.add('dragging');
  // Move card to the top of the stacking order
  card.parentElement.appendChild(card);

  // Bind global pointer move / up on window so card doesn't escape
  window.addEventListener('pointermove', handleDashboardPointerMove, { passive: true });
  window.addEventListener('pointerup', handleDashboardPointerUp);
}

/* ================================================
   RESIZE — startComponentResize
   ================================================ */
function startComponentResize(event, componentId, handleDir) {
  if (!state.isEditMode) return;
  if (event.button !== 0) return;
  const card = event.target.closest('.dashboard-component-card');
  const source = state.activeComponents.find(item => item.id === componentId);
  if (!card || !source) return;
  event.preventDefault();
  event.stopPropagation();

  // Pointer capture on the handle
  try {
    event.target.setPointerCapture(event.pointerId);
  } catch (err) {}

  // Disable text selection on body
  document.body.style.userSelect = 'none';
  document.body.style.webkitUserSelect = 'none';

  // Card selection
  document.querySelectorAll('.dashboard-component-card.selected').forEach(c => {
    if (c !== card) c.classList.remove('selected');
  });
  card.classList.add('selected');

  state.drag = {
    mode: 'resize',
    componentId,
    handleDir: handleDir || 'se',
    startX: event.clientX,
    startY: event.clientY,
    startWidth: Number(source.width || 6),
    startHeight: Number(source.height || 3),
    startCol: Number(source.position_x || 0),
    startRow: Number(source.position_y || 0),
    card
  };

  card.classList.add('dragging');
  card.parentElement.appendChild(card);

  window.addEventListener('pointermove', handleDashboardPointerMove, { passive: true });
  window.addEventListener('pointerup', handleDashboardPointerUp);
}

/* ================================================
   POINTER MOVE
   ================================================ */
function handleDashboardPointerMove(event) {
  if (!state.drag) return;
  const canvas = $('dashboardCanvas');
  if (!canvas) return;
  const canvasRect = canvas.getBoundingClientRect();
  const component = state.activeComponents.find(item => item.id === state.drag.componentId);
  if (!component) return;

  autoScrollDashboard(event.clientY);

  if (state.drag.mode === 'move') {
    // Compute absolute position the card's top-left corner should be at
    const absLeft = event.clientX - canvasRect.left + canvas.scrollLeft - state.drag.offsetX;
    const absTop  = event.clientY - canvasRect.top - state.drag.offsetY;

    // Move the actual dragging card to follow the cursor exactly
    state.drag.card.style.left = `${absLeft}px`;
    state.drag.card.style.top  = `${Math.max(DB_PAD_Y, absTop)}px`;

    // Snap to grid cell for the drop preview
    const snapped = pixelsToGrid(canvas, absLeft, absTop);
    const newCol = clamp(snapped.col, 0, DB_COLS - Number(component.width || 6));
    const newRow = Math.max(0, snapped.row);

    component.position_x = newCol;
    component.position_y = newRow;
    
    showDropIndicator(canvas, component);
    updateOtherCardPositions(canvas, component);

  } else /* resize */ {
    const dx = event.clientX - state.drag.startX;
    const dy = event.clientY - state.drag.startY;
    const contentW = canvas.clientWidth - DB_PAD_X * 2;
    const colW = (contentW - (DB_COLS - 1) * DB_GAP) / DB_COLS;
    const colDelta = Math.round(dx / (colW + DB_GAP));
    const rowDelta = Math.round(dy / (DB_ROW_H + DB_GAP));

    // 8-point resize calculations
    const dir = state.drag.handleDir || 'se';
    let newCol = state.drag.startCol;
    let newW = state.drag.startWidth;
    let newRow = state.drag.startRow;
    let newH = state.drag.startHeight;

    if (dir.includes('e')) {
      newW = clamp(state.drag.startWidth + colDelta, 2, DB_COLS - state.drag.startCol);
    } else if (dir.includes('w')) {
      newCol = clamp(state.drag.startCol + colDelta, 0, state.drag.startCol + state.drag.startWidth - 2);
      newW = state.drag.startWidth + (state.drag.startCol - newCol);
    }

    if (dir.includes('s')) {
      newH = clamp(state.drag.startHeight + rowDelta, 2, 20);
    } else if (dir.includes('n')) {
      newRow = clamp(state.drag.startRow + rowDelta, 0, state.drag.startRow + state.drag.startHeight - 2);
      newH = state.drag.startHeight + (state.drag.startRow - newRow);
    }

    component.width  = newW;
    component.height = newH;
    component.position_x = newCol;
    component.position_y = newRow;

    // Update the dragging card size and position live
    const geo = gridToPixels(canvas, newCol, newRow, newW, newH);
    applyCardGeometry(state.drag.card, geo.left, geo.top, geo.width, geo.height);

    showDropIndicator(canvas, component);
    updateOtherCardPositions(canvas, component);
    resizeCanvasHeight(canvas);
  }
}

/* ================================================
   POINTER UP
   ================================================ */
function handleDashboardPointerUp(event) {
  if (!state.drag) return;
  const drag = state.drag;
  state.drag = null;

  window.removeEventListener('pointermove', handleDashboardPointerMove);
  window.removeEventListener('pointerup', handleDashboardPointerUp);

  // Restore user selection
  document.body.style.userSelect = '';
  document.body.style.webkitUserSelect = '';

  // Release pointer capture
  if (event && event.pointerId) {
    try {
      event.target.releasePointerCapture(event.pointerId);
    } catch (e) {}
  }

  drag.card.classList.remove('dragging');
  drag.card.style.cursor = '';

  const component = state.activeComponents.find(item => item.id === drag.componentId);
  hideDropIndicator();

  if (component) {
    // RESOLVE collisions one final time and save final positions
    const resolved = resolveCollisions($('dashboardCanvas'), state.activeComponents, component.id);
    resolved.forEach(item => {
      const comp = state.activeComponents.find(c => c.id === item.id);
      if (comp) {
        comp.position_x = item.x;
        comp.position_y = item.y;
        comp.width = item.w;
        comp.height = item.h;
      }
    });

    // Snap card exactly to its final grid position with spring snap glide
    const canvas = $('dashboardCanvas');
    const geo = gridToPixels(canvas, component.position_x || 0, component.position_y || 0, component.width || 6, component.height || 3);
    
    drag.card.classList.add('snapping');
    applyCardGeometry(drag.card, geo.left, geo.top, geo.width, geo.height);
    
    setTimeout(() => {
      drag.card.classList.remove('snapping');
    }, 200);

    // Apply layout positions to all other cards
    state.activeComponents.forEach(comp => {
      const cardEl = canvas.querySelector(`.dashboard-component-card[data-component-id="${comp.id}"]`);
      if (cardEl && comp.id !== component.id) {
        const geoOther = gridToPixels(canvas, comp.position_x || 0, comp.position_y || 0, comp.width || 6, comp.height || 3);
        applyCardGeometry(cardEl, geoOther.left, geoOther.top, geoOther.width, geoOther.height);
      }
    });

    resizeCanvasHeight(canvas);
  }

  markDirty();
}

/* ================================================
   COLLISION RESOLVER & CASCADING REFLOW
   ================================================ */
function collides(a, b) {
  return a.x < b.x + b.w &&
         a.x + a.w > b.x &&
         a.y < b.y + b.h &&
         a.y + a.h > b.y;
}

function resolveCollisions(canvas, activeComponents, activeId) {
  // Map layouts to simple coords
  const items = activeComponents.map(c => ({
    id: c.id,
    x: Number(c.position_x || 0),
    y: Number(c.position_y || 0),
    w: Number(c.width || 6),
    h: Number(c.height || 3),
    isDragged: c.id === activeId
  }));

  const draggedItem = items.find(item => item.isDragged);
  const nonDragged = items.filter(item => !item.isDragged);

  // Sort items from top-to-bottom so push-down behaves naturally
  nonDragged.sort((a, b) => a.y - b.y || a.x - b.x);

  const resolved = [];
  if (draggedItem) {
    resolved.push(draggedItem);
  }

  for (const item of nonDragged) {
    let collision = true;
    while (collision) {
      collision = false;
      for (const other of resolved) {
        if (collides(item, other)) {
          item.y = other.y + other.h;
          collision = true;
        }
      }
    }
    resolved.push(item);
  }

  return resolved;
}

function updateOtherCardPositions(canvas, draggingComponent) {
  const resolved = resolveCollisions(canvas, state.activeComponents, draggingComponent.id);
  resolved.forEach(item => {
    if (item.isDragged) return; // Managed by pointer event cursor positions
    const cardEl = canvas.querySelector(`.dashboard-component-card[data-component-id="${item.id}"]`);
    if (cardEl) {
      const geo = gridToPixels(canvas, item.x, item.y, item.w, item.h);
      cardEl.style.left = `${geo.left}px`;
      cardEl.style.top = `${geo.top}px`;
    }
  });
}

/* ================================================
   SHOW / HIDE DROP PLACEHOLDER
   ================================================ */
function showDropIndicator(canvas, component) {
  let indicator = $('dashboardDropIndicator');
  if (!indicator) {
    indicator = document.createElement('div');
    indicator.id = 'dashboardDropIndicator';
    indicator.className = 'dashboard-drop-placeholder';
    indicator.textContent = '';
    canvas.insertBefore(indicator, canvas.firstChild);
  }
  const col = clamp(Number(component.position_x || 0), 0, DB_COLS - 1);
  const row = Math.max(0, Number(component.position_y || 0));
  const w   = clamp(Number(component.width  || 6), 1, DB_COLS);
  const h   = clamp(Number(component.height || 3), 1, 20);
  const geo = gridToPixels(canvas, col, row, w, h);
  applyCardGeometry(indicator, geo.left, geo.top, geo.width, geo.height);
}

function hideDropIndicator() {
  $('dashboardDropIndicator')?.remove();
}

function autoScrollDashboard(pointerY) {
  const margin = 80;
  if (pointerY < margin) window.scrollBy({ top: -18 });
  if (pointerY > window.innerHeight - margin) window.scrollBy({ top: 18 });
}

/* =================================================================
   DYNAMIC CANVAS GRID BACKGROUND
   ================================================================= */
function updateCanvasGridBackground(canvas) {
  if (!canvas) canvas = $('dashboardCanvas');
  if (!canvas) return;

  if (!state.isEditMode) {
    canvas.style.backgroundImage = 'none';
    return;
  }

  const contentW = canvas.clientWidth - DB_PAD_X * 2;
  const colW = (contentW - (DB_COLS - 1) * DB_GAP) / DB_COLS;
  const stepX = colW + DB_GAP;
  const stepY = DB_ROW_H + DB_GAP;

  canvas.style.backgroundImage = `
    linear-gradient(to right, rgba(215, 230, 248, 0.4) ${colW}px, transparent ${colW}px),
    linear-gradient(to bottom, rgba(215, 230, 248, 0.4) ${DB_ROW_H}px, transparent ${DB_ROW_H}px)
  `;
  canvas.style.backgroundSize = `${stepX}px ${stepY}px`;
  canvas.style.backgroundPosition = `${DB_PAD_X}px ${DB_PAD_Y}px`;
  canvas.style.backgroundRepeat = 'repeat';
}

/* ================================================
   RENDER CANVAS (position:absolute, not CSS Grid)
   ================================================ */
function renderDashboardCanvas() {
  const canvas = $('dashboardCanvas');
  if (!canvas) return;
  canvas.querySelectorAll('.dashboard-component-card, .dashboard-drop-placeholder').forEach(node => node.remove());
  $('dashboardEmpty').style.display = state.renderedComponents.length ? 'none' : '';
  updateCanvasGridBackground(canvas);

  const sorted = [...state.renderedComponents].sort((a, b) => {
    const as = state.activeComponents.find(item => item.id === a.componentId) || {};
    const bs = state.activeComponents.find(item => item.id === b.componentId) || {};
    return (Number(as.position_y || 0) - Number(bs.position_y || 0))
        || (Number(as.position_x || 0) - Number(bs.position_x || 0));
  });

  sorted.forEach(component => {
    const source  = state.activeComponents.find(item => item.id === component.componentId) || {};
    const col     = clamp(Number(source.position_x ?? 0), 0, DB_COLS - 1);
    const row     = Math.max(0, Number(source.position_y ?? 0));
    const colSpan = clamp(Number(source.width  || 6), 1, DB_COLS - col);
    const rowSpan = Math.max(2, Number(source.height || 3));

    const card = document.createElement('article');
    card.className = `dashboard-component-card dashboard-component-${component.type}`;
    if (!state.isEditMode) card.classList.add('view-mode');
    card.dataset.componentId = component.componentId;

    const geo = gridToPixels(canvas, col, row, colSpan, rowSpan);
    applyCardGeometry(card, geo.left, geo.top, geo.width, geo.height);

    const asOfTime = state.lastRefreshAt
      ? `As of ${state.lastRefreshAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
      : 'As of Not refreshed';

    const reportName = component.meta?.reportName || source.report_name || 'Source Report';
    const hasReport = !!(source.report_id || component.reportId);

    let toolbarHtml = '';
    if (state.isEditMode) {
      const isExpanded = colSpan >= 12;
      const expandCollapseTitle = isExpanded ? 'Collapse width' : 'Expand width';
      const expandCollapseIcon = isExpanded
        ? `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 14h6v6M10 14L3 21M20 10h-6V4M14 10l7-7"/></svg>`
        : `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/></svg>`;

      toolbarHtml = `
        <button type="button" onclick="editComponent('${esc(component.componentId)}')" title="Component properties">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"></path><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"></path></svg>
        </button>
        <button type="button" onclick="toggleComponentExpanded('${esc(component.componentId)}')" title="${expandCollapseTitle}">
          ${expandCollapseIcon}
        </button>
        <button type="button" onclick="cloneComponent('${esc(component.componentId)}')" title="Clone component">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
        </button>
        <button type="button" class="danger" onclick="removeComponent('${esc(component.componentId)}')" title="Delete component">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
        </button>`;
    } else {
      toolbarHtml = `
        <button type="button" onclick="refreshComponent('${esc(component.componentId)}')" title="Refresh component">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M23 4v6h-6"></path><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path></svg>
        </button>
        <button type="button" onclick="openSourceReport('${esc(source.report_id || component.reportId || '')}')" title="Open source report">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>
        </button>
        <button type="button" onclick="openComponentFullscreen('${esc(component.componentId)}')" title="Maximize">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"></path></svg>
        </button>`;
    }

    let handlesHtml = '';
    if (state.isEditMode) {
      handlesHtml = `
        <div class="dash-handle dash-handle-nw" onpointerdown="startComponentResize(event, '${esc(component.componentId)}', 'nw')"></div>
        <div class="dash-handle dash-handle-n" onpointerdown="startComponentResize(event, '${esc(component.componentId)}', 'n')"></div>
        <div class="dash-handle dash-handle-ne" onpointerdown="startComponentResize(event, '${esc(component.componentId)}', 'ne')"></div>
        <div class="dash-handle dash-handle-e" onpointerdown="startComponentResize(event, '${esc(component.componentId)}', 'e')"></div>
        <div class="dash-handle dash-handle-se" onpointerdown="startComponentResize(event, '${esc(component.componentId)}', 'se')"></div>
        <div class="dash-handle dash-handle-s" onpointerdown="startComponentResize(event, '${esc(component.componentId)}', 's')"></div>
        <div class="dash-handle dash-handle-sw" onpointerdown="startComponentResize(event, '${esc(component.componentId)}', 'sw')"></div>
        <div class="dash-handle dash-handle-w" onpointerdown="startComponentResize(event, '${esc(component.componentId)}', 'w')"></div>
      `;
    }

    const subtitleHtml = hasReport
      ? `<a class="dashboard-component-subtitle" onpointerdown="event.stopPropagation()" onclick="openSourceReport('${esc(source.report_id || component.reportId || '')}')" title="View Source Report: ${esc(reportName)}">${esc(reportName)}</a>`
      : `<span class="dashboard-component-subtitle" style="color:var(--text-3); cursor:default; text-decoration:none;">No source report</span>`;

    const badgeHtml = component.meta?.cached
      ? `<span class="cached-badge">Cached</span>`
      : '';

    card.innerHTML = `
      <div class="dashboard-component-header" onpointerdown="startComponentDrag(event, '${esc(component.componentId)}')" title="Drag to move">
        <div class="dashboard-component-drag">
          <h3 class="dashboard-component-title" onpointerdown="event.stopPropagation()">${esc(component.title || 'Component')}</h3>
          ${subtitleHtml}
          <div class="dashboard-component-meta">
            <span>${esc(asOfTime)}</span>
            ${badgeHtml}
          </div>
        </div>
        <div class="dashboard-component-toolbar" onpointerdown="event.stopPropagation()">
          ${toolbarHtml}
        </div>
      </div>
      <div class="dashboard-component-body">${renderComponentBody(component)}</div>
      ${handlesHtml}
    `;

    canvas.appendChild(card);
  });

  resizeCanvasHeight(canvas);
}




function renderComponentBody(component) {
  if (component.error) return `<div class="dashboard-component-error">${esc(component.error)}</div>`;
  if (component.type === 'kpi') {
    return renderKpi(component);
  }
  if (component.type === 'gauge') return renderGauge(component);
  if (component.type === 'rich_text') return `<div class="dashboard-rich-text">${esc(component.config?.text || '').replace(/\n/g, '<br>')}</div>`;
  if (component.type === 'image') return `<div class="dashboard-image-wrap"><img src="${esc(component.config?.imageUrl || '')}" alt="${esc(component.title || 'Dashboard image')}"></div>`;
  if (component.type === 'table') {
    return renderDashboardTable(component);
  }
  return renderChartComponent(component);
}

function renderKpi(component) {
  const value = Number(component.value || 0);
  const target = component.config?.target == null ? null : Number(component.config.target);
  const variance = target == null ? null : value - target;
  const percentDiff = (target != null && target !== 0) ? Math.round((variance / target) * 100) : null;
  
  let status = 'neutral';
  let arrowIcon = '';
  let statusPillClass = 'status-neutral';
  let statusLabel = '';
  
  if (variance != null) {
    if (variance >= 0) {
      status = 'good';
      statusPillClass = 'status-good';
      arrowIcon = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="19" x2="12" y2="5"></line><polyline points="5 12 12 5 19 12"></polyline></svg>`;
      statusLabel = `+${formatNumber(variance)} (${percentDiff >= 0 ? '+' : ''}${percentDiff}%)`;
    } else if (variance >= -(target * 0.1)) {
      status = 'warn';
      statusPillClass = 'status-warn';
      arrowIcon = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><polyline points="19 12 12 19 5 12"></polyline></svg>`;
      statusLabel = `${formatNumber(variance)} (${percentDiff}%)`;
    } else {
      status = 'bad';
      statusPillClass = 'status-bad';
      arrowIcon = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><polyline points="19 12 12 19 5 12"></polyline></svg>`;
      statusLabel = `${formatNumber(variance)} (${percentDiff}%)`;
    }
  }

  const caption = component.config?.subtitle || component.meta?.reportType || 'Total';
  const description = component.config?.description ? `<div class="kpi-description">${esc(component.config.description)}</div>` : '';
  const targetHtml = target == null
    ? ''
    : `<div class="kpi-target-label">Target: <span class="kpi-target-val">${esc(formatNumber(target))}</span></div>`;

  const trendHtml = variance == null
    ? ''
    : `<div class="kpi-status-pill ${statusPillClass}">
        ${arrowIcon}
        <span>${esc(statusLabel)}</span>
       </div>`;

  return `
    <div class="kpi-card-inner">
      <div class="kpi-caption-top">${esc(caption)}</div>
      <div class="kpi-value-container">
        <span class="kpi-value-num">${esc(formatNumber(value))}</span>
        ${trendHtml}
      </div>
      <div class="kpi-footer-row">
        ${targetHtml}
        ${description}
      </div>
    </div>
  `;
}

function renderDashboardTable(component) {
  const columns = (component.columns || []).slice(0, component.config?.columns || 8);
  const tableState = state.tableState[component.componentId] || { page: 0, sort: '', direction: 'asc' };
  const pageSize = Number(component.config?.pageSize || 8);
  let rows = [...(component.rows || [])];
  if (tableState.sort) {
    rows.sort((a, b) => {
      const av = readPath(a, tableState.sort) ?? '';
      const bv = readPath(b, tableState.sort) ?? '';
      return String(av).localeCompare(String(bv), undefined, { numeric: true }) * (tableState.direction === 'desc' ? -1 : 1);
    });
  }
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
  const page = clamp(tableState.page || 0, 0, pageCount - 1);
  const visibleRows = rows.slice(page * pageSize, page * pageSize + pageSize);
  return `<div class="dashboard-table-shell">
    <div class="dashboard-table-wrap"><table class="dashboard-table">
      <thead><tr>${columns.map((column) => `<th onclick="sortDashboardTable('${esc(component.componentId)}','${esc(column.field)}')">${esc(column.label)} ${tableState.sort === column.field ? (tableState.direction === 'asc' ? '^' : 'v') : ''}</th>`).join('')}</tr></thead>
      <tbody>${visibleRows.map((row) => `<tr>${columns.map((column) => `<td>${esc(readPath(row, column.field) ?? '')}</td>`).join('')}</tr>`).join('') || `<tr><td colspan="${Math.max(columns.length, 1)}">No rows</td></tr>`}</tbody>
    </table></div>
    <div class="dashboard-table-pager">
      <span>${esc(formatNumber(rows.length))} rows</span>
      <button type="button" onclick="pageDashboardTable('${esc(component.componentId)}', -1)" ${page <= 0 ? 'disabled' : ''}>Prev</button>
      <span>${page + 1} / ${pageCount}</span>
      <button type="button" onclick="pageDashboardTable('${esc(component.componentId)}', 1)" ${page >= pageCount - 1 ? 'disabled' : ''}>Next</button>
    </div>
  </div>`;
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
  const visiblePoints = points.filter((_, index) => !(state.hiddenLegend[component.componentId] || new Set()).has(index));
  const chartPoints = visiblePoints.length ? visiblePoints : points;
  let chart = '';
  if (component.chartType === 'donut' || component.chartType === 'pie') chart = renderDonut(chartPoints, component.chartType);
  else if (component.chartType === 'line' || component.chartType === 'area') chart = renderLineArea(chartPoints, component.chartType === 'area');
  else if (component.chartType === 'funnel') chart = renderFunnel(chartPoints);
  else if (component.chartType === 'gauge') chart = renderGauge({ ...component, value: chartPoints.reduce((sum, point) => sum + point.value, 0) });
  else chart = renderBars(chartPoints);
  return `<div class="dashboard-chart-shell">
    ${chart}
    <div class="dashboard-chart-legend">${points.map((point, index) => `
      <button type="button" class="${(state.hiddenLegend[component.componentId] || new Set()).has(index) ? 'muted' : ''}" onclick="toggleChartLegend('${esc(component.componentId)}', ${index})">
        <i style="background:${chartColor(index)}"></i>${esc(shortLabel(point.label, 20))}<strong>${esc(formatNumber(point.value))}</strong>
      </button>
    `).join('')}</div>
  </div>`;
}

function renderGauge(component) {
  const value = Number(component.value || component.rows?.length || 0);
  const max = Number(component.config?.max || Math.max(value, 100));
  const percent = Math.max(0, Math.min(100, (value / max) * 100));
  return `<div class="dashboard-gauge">
    <div class="dashboard-gauge-arc" style="--gauge:${percent * 1.8}deg"><span>${esc(formatNumber(value))}</span></div>
    <div class="dashboard-gauge-scale"><span>0</span><span>${esc(formatNumber(max))}</span></div>
  </div>`;
}

function renderBars(points) {
  const max = Math.max(...points.map((point) => point.value), 1);
  return `<div class="dashboard-bars">${points.map((point, index) => `
    <div class="dashboard-bar-row">
      <span>${esc(shortLabel(point.label, 18))}</span>
      <div><i style="width:${Math.max((point.value / max) * 100, 3)}%"></i></div>
      <strong>${esc(formatNumber(point.value))}</strong>
    </div>
  `).join('')}</div>`;
}

function renderDonut(points, type = 'donut') {
  const total = points.reduce((sum, point) => sum + Math.max(point.value, 0), 0) || 1;
  let cursor = 0;
  const stops = points.map((point, index) => {
    const start = cursor;
    cursor += (Math.max(point.value, 0) / total) * 100;
    return `${chartColor(index)} ${start}% ${cursor}%`;
  }).join(', ');
  return `<div class="dashboard-donut-wrap">
    <div class="dashboard-donut-lite ${type === 'pie' ? 'pie' : ''}" style="--donut:${stops}">
      <div>${esc(formatNumber(total))}</div><span>Total</span>
    </div>
  </div>`;
}

function renderLineArea(points, fill = false) {
  const max = Math.max(...points.map((point) => point.value), 1);
  const width = 520;
  const height = 170;
  const step = points.length > 1 ? width / (points.length - 1) : width;
  const coords = points.map((point, index) => {
    const x = index * step;
    const y = height - (point.value / max) * (height - 18) - 8;
    return `${x},${y}`;
  });
  const area = `0,${height} ${coords.join(' ')} ${width},${height}`;
  return `<div class="dashboard-svg-chart"><svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Line chart">
    ${fill ? `<polygon points="${area}" fill="rgba(0,112,210,.16)"></polygon>` : ''}
    <polyline points="${coords.join(' ')}" fill="none" stroke="var(--accent)" stroke-width="3"></polyline>
    ${points.map((point, index) => {
      const [x, y] = coords[index].split(',');
      return `<circle cx="${x}" cy="${y}" r="4" fill="var(--accent)"><title>${esc(point.label)}: ${esc(formatNumber(point.value))}</title></circle>`;
    }).join('')}
  </svg></div>`;
}

function renderFunnel(points) {
  const sorted = [...points].sort((a, b) => b.value - a.value).slice(0, 8);
  const max = Math.max(...sorted.map((point) => point.value), 1);
  return `<div class="dashboard-funnel">${sorted.map((point, index) => {
    const width = Math.max((point.value / max) * 100, 12);
    return `<div class="dashboard-funnel-stage" style="width:${width}%">
      <span>${esc(shortLabel(point.label, 22))}</span><strong>${esc(formatNumber(point.value))}</strong>
    </div>`;
  }).join('')}</div>`;
}

function sortDashboardTable(componentId, field) {
  const current = state.tableState[componentId] || { page: 0, sort: '', direction: 'asc' };
  state.tableState[componentId] = {
    ...current,
    page: 0,
    sort: field,
    direction: current.sort === field && current.direction === 'asc' ? 'desc' : 'asc'
  };
  renderDashboardCanvas();
}

function pageDashboardTable(componentId, delta) {
  const current = state.tableState[componentId] || { page: 0, sort: '', direction: 'asc' };
  state.tableState[componentId] = { ...current, page: Math.max(0, Number(current.page || 0) + delta) };
  renderDashboardCanvas();
}

function toggleChartLegend(componentId, index) {
  const hidden = state.hiddenLegend[componentId] || new Set();
  hidden.has(index) ? hidden.delete(index) : hidden.add(index);
  state.hiddenLegend[componentId] = hidden;
  renderDashboardCanvas();
}

function chartColor(index) {
  return ['#0176d3', '#2e844a', '#ba0517', '#fe9339', '#706eeb', '#017e7e', '#dd7a01', '#747474', '#8e44ad', '#45c65a'][index % 10];
}

function openSourceReport(reportId) {
  if (!reportId) return toast('This component has no source report', 'info');
  window.location.href = `/reports.html#report/${encodeURIComponent(reportId)}`;
}

function toggleComponentExpanded(componentId) {
  if (!state.isEditMode) return openComponentFullscreen(componentId);
  const component = state.activeComponents.find((item) => item.id === componentId);
  if (!component) return;
  component.width = Number(component.width || 6) >= 12 ? 6 : 12;
  component.position_x = 0;
  compactDashboardLayout(componentId);
  renderDashboardCanvas();
  markDirty();
}

function openComponentFullscreen(componentId) {
  const component = state.renderedComponents.find((item) => item.componentId === componentId);
  if (!component) return toast('Component not found', 'err');
  closeComponentFullscreen();
  const modal = document.createElement('div');
  modal.id = 'dashboardComponentFullscreen';
  modal.className = 'dashboard-component-fullscreen';
  modal.innerHTML = `
    <div class="dashboard-component-fullscreen-card">
      <div class="dashboard-component-fullscreen-header">
        <div>
          <h2>${esc(component.title || 'Component')}</h2>
          <span>${esc(component.meta?.reportName || '')}</span>
        </div>
        <button type="button" onclick="closeComponentFullscreen()">Close</button>
      </div>
      <div class="dashboard-component-fullscreen-body">${renderComponentBody(component)}</div>
    </div>
  `;
  document.body.appendChild(modal);
}

function closeComponentFullscreen() {
  $('dashboardComponentFullscreen')?.remove();
}

function dashboardIdFromHash() {
  const match = window.location.hash.match(/^#dashboard\/([A-Za-z0-9-]+)$/);
  return match ? match[1] : '';
}

function markDirty() {
  state.isDirty = true;
  const indicator = $('dashboardDraftIndicator');
  if (indicator) {
    indicator.textContent = 'Unsaved changes';
    indicator.className = 'draft-indicator dirty';
  }
  updateDashboardEditControls();
}

function markSaved() {
  state.isDirty = false;
  const indicator = $('dashboardDraftIndicator');
  if (indicator) {
    indicator.textContent = 'Saved';
    indicator.className = 'draft-indicator';
  }
  updateDashboardEditControls();
}

function setBusy(button, busy, label) {
  if (!button) return;
  button.disabled = busy;
  button.textContent = label;
}

function setPageBusy(busy, message = 'Loading...') {
  let overlay = $('dashboardPageBusy');
  if (busy) {
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'dashboardPageBusy';
      overlay.className = 'dashboard-page-busy';
      document.body.appendChild(overlay);
    }
    overlay.innerHTML = `<div class="dashboard-spinner"></div><span>${esc(message)}</span>`;
    overlay.style.display = 'flex';
    return;
  }
  if (overlay) overlay.style.display = 'none';
}

function currentUserInfo() {
  const token = localStorage.getItem('saasray_token') || '';
  try {
    const body = token.split('.')[1] || '';
    const payload = JSON.parse(atob(body.replace(/-/g, '+').replace(/_/g, '/')));
    return {
      id: payload.id || payload.sub || '',
      email: payload.email || '',
      name: payload.full_name || payload.name || payload.email || ''
    };
  } catch (err) {
    return {};
  }
}

function normalizeVisibility(value) {
  return ['public', 'shared'].includes(value) ? value : 'private';
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

function renderFolderTree() {
  const tree = $('dashboardFolderTree');
  if (!tree) return;
  const needle = ($('dashboardFolderSearch')?.value || '').trim().toLowerCase();
  const folders = state.folders.filter((folder) => !needle || folder.name.toLowerCase().includes(needle));
  tree.innerHTML = folders.length ? folders.map((folder) => `
    <div class="folder-tree-row ${state.folderId === folder.id ? 'active' : ''}">
      <button class="folder-tree-item" type="button" data-dashboard-folder-id="${esc(folder.id)}" onclick="selectDashboardView('all', '${esc(folder.id)}')">
        <span>${folder.is_favorite ? '★ ' : ''}${esc(folder.name)}</span>
        <small>${Number(folder.count || 0)}</small>
      </button>
      <button class="folder-edit-btn" type="button" onclick="event.stopPropagation(); toggleDashboardFolderFavoriteById('${esc(folder.id)}')" title="${folder.is_favorite ? 'Remove favorite' : 'Favorite folder'}">${folder.is_favorite ? '★' : '☆'}</button>
      <button class="folder-edit-btn" type="button" onclick="event.stopPropagation(); openFolderModalById('${esc(folder.id)}')" title="Edit folder" ${folder.can_edit ? '' : 'disabled'}>Edit</button>
    </div>
  `).join('') : '<div class="folder-empty">No folders</div>';
}

async function toggleDashboardFolderFavoriteById(folderId) {
  const folder = state.folders.find((item) => item.id === folderId);
  const favorite = !folder?.is_favorite;
  try {
    await api(`/api/dashboards/folders/${folderId}/favorite`, { method: favorite ? 'POST' : 'DELETE', body: favorite ? '{}' : undefined });
    await loadFolders();
    toast(favorite ? 'Folder favorited' : 'Folder favorite removed', 'ok');
  } catch (err) {
    toast(err.message, 'err');
  }
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


function toggleAppSidebar() {
  document.body.classList.toggle('sidebar-collapsed');
  sessionStorage.setItem('reports_app_sidebar_collapsed', document.body.classList.contains('sidebar-collapsed') ? '1' : '0');
}

/* ===========================
   PERSISTENCE / LAYOUT SAVE
   =========================== */

// Re-stack all components to prevent overlap — used after expand/clone.
// Priority component keeps its current position; others are pushed below.
function compactDashboardLayout(priorityId = '') {
  const components = [...state.activeComponents].sort((a, b) => {
    if (a.id === priorityId) return -1;
    if (b.id === priorityId) return 1;
    return (Number(a.position_y || 0) - Number(b.position_y || 0))
        || (Number(a.position_x || 0) - Number(b.position_x || 0));
  });
  const occupied = new Map();
  components.forEach(comp => {
    const w = Math.max(1, Math.min(Number(comp.width || 6), DB_COLS));
    const h = Math.max(2, Number(comp.height || 3));
    let row = Math.max(0, Number(comp.position_y || 0));
    let col = clamp(Number(comp.position_x || 0), 0, DB_COLS - w);
    while (!gridSlotFree(occupied, col, row, w, h)) {
      col++;
      if (col > DB_COLS - w) { col = 0; row++; }
    }
    comp.position_x = col;
    comp.position_y = row;
    comp.width = w;
    comp.height = h;
    markOccupied(occupied, col, row, w, h);
  });
}

function gridSlotFree(occupied, col, row, w, h) {
  for (let y = row; y < row + h; y++) {
    const set = occupied.get(y) || new Set();
    for (let x = col; x < col + w; x++) if (set.has(x)) return false;
  }
  return true;
}

function markOccupied(occupied, col, row, w, h) {
  for (let y = row; y < row + h; y++) {
    if (!occupied.has(y)) occupied.set(y, new Set());
    const set = occupied.get(y);
    for (let x = col; x < col + w; x++) set.add(x);
  }
}


async function persistComponentLayout(component) {
  await api(`/api/dashboards/${state.activeDashboard.id}/components/${component.id}`, {
    method: 'PATCH',
    body: JSON.stringify({
      positionX: Number(component.position_x || 0),
      positionY: Number(component.position_y || 0),
      width: Number(component.width || 6),
      height: Number(component.height || 3)
    })
  });
}


function scheduleLayoutAutosave() {
  clearTimeout(state.layoutAutosaveTimer);
  state.layoutAutosaveTimer = setTimeout(persistAllComponentLayouts, 900);
}

async function persistAllComponentLayouts() {
  if (!state.activeDashboard?.id || !state.activeComponents.length) return;
  const button = $('saveDashboardBtn');
  setBusy(button, true, 'Saving...');
  try {
    await Promise.all(state.activeComponents.map(component => persistComponentLayout(component)));
    markSaved();
    toast('Layout saved', 'ok');
  } catch (err) {
    toast(err.message || 'Could not auto-save layout', 'err');
    updateDashboardEditControls();
  } finally {
    setBusy(button, false, 'Save');
    updateDashboardEditControls();
  }
}

function setComponentLoading(componentId, loading) {
  const card = document.querySelector(`.dashboard-component-card[data-component-id="${cssEscape(componentId)}"]`);
  card?.classList.toggle('loading', loading);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function configureAutoRefresh(value) {
  clearInterval(state.autoRefreshTimer);
  state.autoRefreshTimer = null;
  const seconds = Number(typeof value === 'number' ? value : $('dashboardAutoRefresh')?.value || 0);
  if ($('dashboardAutoRefresh') && typeof value === 'number') $('dashboardAutoRefresh').value = String(value);
  if (!seconds || !state.activeDashboard?.id) return;
  state.autoRefreshTimer = setInterval(() => runDashboard({ skipCache: true }), seconds * 1000);
  toast(`Dashboard will refresh every ${seconds / 60} minute${seconds === 60 ? '' : 's'}`, 'info');
}

function setDashboardEditMode(enabled) {
  state.isEditMode = Boolean(enabled);
  $('dashboardBuilderView')?.classList.toggle('dashboard-edit-mode', state.isEditMode);
  updateDashboardEditControls();
  renderDashboardCanvas();
}

function updateDashboardEditControls() {
  const editButton = $('dashboardEditModeBtn');
  if (editButton) {
    editButton.textContent = state.isEditMode ? 'Done' : 'Edit';
    editButton.classList.toggle('btn-primary', !state.isEditMode);
    editButton.classList.toggle('btn-ghost', state.isEditMode);
  }
  ['addComponentBtn', 'dashboardFiltersBtn', 'dashboardPropertiesBtn', 'deleteDashboardBtn'].forEach((id) => {
    const node = $(id);
    if (node) node.disabled = !state.isEditMode;
  });
  const saveButton = $('saveDashboardBtn');
  if (saveButton) saveButton.disabled = !state.isEditMode || !state.isDirty;
}

function cssEscape(value) {
  if (window.CSS?.escape) return CSS.escape(String(value));
  return String(value).replace(/"/g, '\\"');
}

async function toggleFavorite() {
  if (!state.activeDashboard?.id) return toast('Save the dashboard first', 'info');
  const dashboard = state.dashboards.find(item => item.id === state.activeDashboard.id);
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
