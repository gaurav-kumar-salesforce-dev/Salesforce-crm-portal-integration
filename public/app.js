const OBJECT_META = {
  Account: {
    title: 'Accounts',
    icon: 'account',
    columns: ['Name', 'Type', 'Industry', 'Phone', 'BillingCity', 'BillingState'],
    editable: ['Name', 'Type', 'Industry', 'Phone', 'Website', 'BillingCity', 'BillingState']
  },
  Contact: {
    title: 'Contacts',
    icon: 'contact',
    columns: ['Name', 'Account.Name', 'Email', 'Phone', 'Title'],
    editable: ['FirstName', 'LastName', 'Email', 'Phone', 'Title', 'AccountId'],
    lookups: { AccountId: { object: 'Account', label: 'Account' } }
  },
  Opportunity: {
    title: 'Opportunities',
    icon: 'opportunity',
    columns: ['Name', 'StageName', 'Amount', 'CloseDate', 'Account.Name', 'Probability'],
    editable: ['Name', 'StageName', 'Amount', 'CloseDate', 'AccountId', 'Probability', 'LeadSource'],
    lookups: { AccountId: { object: 'Account', label: 'Account' } }
  },
  Case: {
    title: 'Cases',
    icon: 'case',
    columns: ['CaseNumber', 'Subject', 'Status', 'Priority', 'Type', 'Account.Name', 'CreatedDate'],
    editable: ['Subject', 'Status', 'Priority', 'Type', 'AccountId', 'Description'],
    lookups: { AccountId: { object: 'Account', label: 'Account' } }
  },
  Lead: {
    title: 'Leads',
    icon: 'lead',
    columns: ['Name', 'Email', 'Phone', 'Company', 'Status', 'Title', 'LeadSource'],
    editable: ['FirstName', 'LastName', 'Email', 'Phone', 'Company', 'Status', 'Title', 'LeadSource']
  },
  Campaign: {
    title: 'Campaigns',
    icon: 'campaign',
    columns: ['Name', 'Type', 'Status', 'StartDate', 'EndDate', 'IsActive', 'NumberOfContacts', 'NumberOfLeads'],
    editable: ['Name', 'Type', 'Status', 'StartDate', 'EndDate', 'IsActive', 'Description']
  },
  User: {
    title: 'Users',
    icon: 'user',
    columns: ['Name', 'Email', 'Username', 'Title'],
    editable: []
  }
};

let currentObject = 'Account';
let currentRecords = [];
let currentColumns = [];
let currentViewId = 'all';
let sfListViews = [];
let searchTimer = null;
let globalTimer = null;
let lookupTimer = null;
let editingRecord = null;
let deletingRecord = null;
let currentUser = null;
let sortState = { field: null, direction: 'asc' };
let currentPage = 1;
let pageSize = 25;
let totalRecords = 0;
let listContentHtml = '';
let viewingDetail = false;
let detailRecordState = null;
let activeCampaign = null;
let campaignMembers = [];
let campaignMemberSelection = new Set();
let memberCandidateObject = 'Contact';
let memberCandidateSelection = new Set();
let currentCampaignCandidates = [];
let emailTemplates = [];

const $ = (id) => document.getElementById(id);

function getLocalViews() {
  return JSON.parse(localStorage.getItem('sfmListViews') || '{}');
}

function setLocalViews(views) {
  localStorage.setItem('sfmListViews', JSON.stringify(views));
}

function objectLocalViews() {
  return getLocalViews()[currentObject] || [];
}

function objectIcon(objectName) {
  const key = OBJECT_META[objectName]?.icon || String(objectName).toLowerCase();
  const labels = {
    account: 'Acct',
    contact: 'Cont',
    opportunity: 'Opp',
    case: 'Case',
    lead: 'Lead',
    campaign: 'Camp',
    user: 'User'
  };
  return `<span class="object-icon object-icon-${key}">${labels[key] || key.slice(0, 4)}</span>`;
}

function objectFromId(id) {
  const prefix = String(id || '').slice(0, 3);
  return {
    '001': 'Account',
    '003': 'Contact',
    '006': 'Opportunity',
    '500': 'Case',
    '00Q': 'Lead',
    '701': 'Campaign'
  }[prefix] || currentObject;
}

function relatedObjectForField(field, record) {
  if (field.startsWith('Account.')) return 'Account';
  if (field.startsWith('Contact.')) return 'Contact';
  if (field.startsWith('Owner.')) return 'User';
  const idField = `${field.split('.')[0]}Id`;
  return objectFromId(record?.[idField]);
}

function getValue(record, path) {
  return path.split('.').reduce((value, key) => value && value[key], record);
}

function setValue(body, field, value) {
  if (value !== undefined && value !== null && String(value).trim() !== '') {
    body[field] = String(value).trim();
  }
}

function labelFor(field) {
  return field.replace(/\./g, ' ').replace(/Id$/, '').replace(/([a-z])([A-Z])/g, '$1 $2');
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Request failed with ${response.status}`);
  return data;
}

function formatValue(field, value, record = null) {
  if (value === null || value === undefined || value === '') return '<span class="cell-empty">-</span>';
  if (field === 'Amount' || field === 'AnnualRevenue') {
    return `<span class="cell-amount">${Number(value).toLocaleString(undefined, {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 0
    })}</span>`;
  }
  if (field.includes('Date')) return new Date(value).toLocaleDateString();
  if (field === 'Email') return `<a class="cell-email" href="mailto:${escapeHtml(value)}">${escapeHtml(value)}</a>`;
  if (['Status', 'StageName', 'Priority', 'Type'].includes(field)) {
    return `<span class="badge badge-neutral">${escapeHtml(value)}</span>`;
  }
  if (field.endsWith('.Name')) {
    const relatedObject = relatedObjectForField(field, record);
    const idField = `${field.split('.')[0]}Id`;
    const relatedId = record?.[idField];
    if (relatedId && OBJECT_META[relatedObject]) {
      return `<button class="cell-button-link" onclick="event.stopPropagation(); openRecordDetail('${relatedObject}', '${relatedId}')">${escapeHtml(value)}</button>`;
    }
    return `<span class="cell-link">${escapeHtml(value)}</span>`;
  }
  if (field === 'Name' || field === 'CaseNumber') {
    return `<button class="cell-button-link" onclick="event.stopPropagation(); openRecordDetail('${currentObject}', '${record?.Id || ''}')">${escapeHtml(value)}</button>`;
  }
  return escapeHtml(String(value));
}

async function checkConnection() {
  const status = $('connStatus');
  const dot = status.querySelector('.conn-dot');
  const text = status.querySelector('.conn-text');
  const authBtn = $('authBtn');

  try {
    const data = await api('/api/auth/test');
    dot.className = 'conn-dot connected';
    text.textContent = 'Connected';
    if (authBtn) authBtn.style.display = 'none';
    await loadProfile();
    return data;
  } catch (err) {
    dot.className = 'conn-dot error';
    text.textContent = 'Auth failed';
    if (authBtn) authBtn.style.display = 'inline-flex';
    showAuthRequired(err.message);
    return null;
  }
}

async function loadProfile() {
  try {
    currentUser = await api('/api/me');
    const initials = (currentUser.name || 'SF').split(/\s+/).map((p) => p[0]).join('').slice(0, 2);
    $('profileButton').textContent = initials || 'SF';
    $('profileName').textContent = currentUser.name || 'Salesforce User';
    $('profileEmail').textContent = currentUser.email || currentUser.username || 'Connected';
  } catch (err) {
    $('profileButton').textContent = 'SF';
  }
}

function connectSalesforce() {
  window.location.href = '/auth/salesforce';
}

async function logoutSalesforce() {
  await api('/api/auth/logout', { method: 'POST' }).catch(() => null);
  closeProfileMenu();
  currentRecords = [];
  currentUser = null;
  showAuthRequired('Logged out locally. Connect Salesforce again to load CRM data.');
  $('authBtn').style.display = 'inline-flex';
  $('connStatus').querySelector('.conn-dot').className = 'conn-dot error';
  $('connStatus').querySelector('.conn-text').textContent = 'Logged out';
}

function toggleProfileMenu() {
  $('profilePopover').classList.toggle('open');
}

function closeProfileMenu() {
  $('profilePopover').classList.remove('open');
}

function openUserInfo() {
  closeProfileMenu();
  if (!currentUser) {
    toast('User profile is still loading', 'info');
    return;
  }
  $('detailObjIcon').innerHTML = '<span class="object-icon object-icon-user">User</span>';
  $('detailTitle').textContent = currentUser.name || 'Salesforce User';
  $('detailSub').textContent = currentUser.username || currentUser.email || '';
  $('detailBody').innerHTML = `
    <div class="detail-grid">
      ${[
        ['Name', currentUser.name],
        ['Email', currentUser.email],
        ['Username', currentUser.username],
        ['Title', currentUser.title],
        ['User Id', currentUser.id]
      ].map(([label, value]) => `
        <div class="detail-field">
          <div class="detail-label">${label}</div>
          <div class="detail-value">${escapeHtml(value || '-')}</div>
        </div>
      `).join('')}
    </div>
  `;
  $('detailEditBtn').onclick = () => openRecordDetail('User', currentUser.id);
  $('detailEditBtn').style.display = 'none';
  $('detailOverlay').classList.add('open');
}

function showAuthRequired(message) {
  const meta = OBJECT_META[currentObject];
  $('pageIcon').innerHTML = objectIcon(currentObject);
  $('pageTitle').textContent = 'Connect Salesforce';
  $('pageSub').textContent = 'Authenticate first, then CRM records will load here.';
  $('stateLoading').style.display = 'none';
  $('tableCard').style.display = 'none';
  $('stateError').style.display = 'flex';
  $('errMsg').textContent = 'Salesforce authentication required';
  $('errDetail').textContent = message || 'Click Connect Salesforce and approve the Connected App.';
  const retryBtn = $('stateError').querySelector('button');
  retryBtn.textContent = 'Connect Salesforce';
  retryBtn.onclick = connectSalesforce;
}

async function loadListViews() {
  try {
    const data = await api(`/api/${currentObject}/listviews`);
    sfListViews = data.listviews || [];
  } catch (err) {
    sfListViews = [];
  }
  renderListViewSelect();
}

function renderListViewSelect() {
  const select = $('listViewSelect');
  const locals = objectLocalViews();
  select.innerHTML = `
    <option value="all">All ${OBJECT_META[currentObject].title}</option>
    ${sfListViews.map((view) => `<option value="sf:${view.id}">Salesforce: ${escapeHtml(view.label)}</option>`).join('')}
    ${locals.map((view) => `<option value="local:${view.id}">Portal: ${escapeHtml(view.name)}</option>`).join('')}
  `;
  select.value = currentViewId;
  if (select.value !== currentViewId) {
    currentViewId = 'all';
    select.value = 'all';
  }
}

async function handleListViewChange(value) {
  currentViewId = value;
  currentPage = 1;
  sortState = { field: null, direction: 'asc' };
  await loadData();
}

async function loadData() {
  const search = $('objSearch')?.value || '';
  const meta = OBJECT_META[currentObject];
  currentColumns = meta.columns.slice();

  $('pageIcon').innerHTML = objectIcon(currentObject);
  $('pageTitle').textContent = getCurrentViewName();
  $('pageSub').textContent = `Loading ${meta.title.toLowerCase()} from Salesforce...`;
  $('stateLoading').style.display = 'flex';
  $('stateError').style.display = 'none';
  $('tableCard').style.display = 'none';

  try {
    if (currentViewId.startsWith('sf:')) {
      const viewId = currentViewId.slice(3);
      const data = await api(`/api/${currentObject}/listviews/${viewId}/results`);
      currentRecords = data.records || [];
      currentColumns = normalizeListViewColumns(data.columns);
    } else {
      const params = new URLSearchParams({
        page: String(currentPage),
        pageSize: String(pageSize)
      });
      if (search) params.set('search', search);
      const query = `?${params.toString()}`;
      const data = await api(`/api/${currentObject}${query}`);
      currentRecords = data.records || [];
      totalRecords = data.totalSize || currentRecords.length;
      applyLocalView();
    }

    if (currentViewId.startsWith('sf:')) {
      totalRecords = currentRecords.length;
    }

    applySort();
    renderTable();
    updatePagination();
    updateBadge(currentObject, currentRecords.length);
    $('pageSub').textContent = `${totalRecords} records available`;
    $('recCount').textContent = currentViewId.startsWith('sf:')
      ? `${currentRecords.length} records`
      : `${pageRangeStart()}-${pageRangeEnd()} of ${totalRecords}`;
    $('stateLoading').style.display = 'none';
    $('tableCard').style.display = 'block';
  } catch (err) {
    $('stateLoading').style.display = 'none';
    $('stateError').style.display = 'flex';
    $('errMsg').textContent = 'Could not load Salesforce data';
    $('errDetail').textContent = err.message;
    $('pageSub').textContent = 'Salesforce request failed';
    const retryBtn = $('stateError').querySelector('button');
    const authError = /auth|oauth|token|unknown_error/i.test(err.message);
    retryBtn.textContent = authError ? 'Connect Salesforce' : 'Retry';
    retryBtn.onclick = authError ? connectSalesforce : loadData;
  }
}

function normalizeListViewColumns(columns) {
  const fields = (columns || [])
    .map((column) => column.fieldNameOrPath || column.fieldName)
    .filter((field) => field && field !== 'Id' && !field.includes('attributes'));
  return fields.length ? [...new Set(fields)].slice(0, 8) : OBJECT_META[currentObject].columns.slice();
}

function getCurrentViewName() {
  if (currentViewId.startsWith('sf:')) {
    const view = sfListViews.find((item) => item.id === currentViewId.slice(3));
    return view?.label || OBJECT_META[currentObject].title;
  }
  if (currentViewId.startsWith('local:')) {
    const view = objectLocalViews().find((item) => item.id === currentViewId.slice(6));
    return view?.name || OBJECT_META[currentObject].title;
  }
  return OBJECT_META[currentObject].title;
}

function applyLocalView() {
  if (!currentViewId.startsWith('local:')) return;
  const view = objectLocalViews().find((item) => item.id === currentViewId.slice(6));
  if (!view) return;
  currentColumns = view.columns?.length ? view.columns : currentColumns;
  if (view.search) {
    const q = view.search.toLowerCase();
    currentRecords = currentRecords.filter((record) =>
      currentColumns.some((field) => String(getValue(record, field) || '').toLowerCase().includes(q))
    );
  }
}

function renderTable() {
  const recordsToRender = getRecordsToRender();

  $('thead').innerHTML = `
    <tr>
      ${currentColumns.map((field) => `
        <th class="${sortState.field === field ? 'sorted' : ''}" onclick="sortBy('${field}')">
          ${labelFor(field)}
          <span class="sort-arrow">${sortState.field === field ? (sortState.direction === 'asc' ? '^' : 'v') : '-'}</span>
        </th>
      `).join('')}
      <th>Actions</th>
    </tr>
  `;

  if (!recordsToRender.length) {
    $('tbody').innerHTML = `
      <tr>
        <td class="table-empty" colspan="${currentColumns.length + 1}">
          <div class="table-empty-icon">${objectIcon(currentObject)}</div>
          <h3>No records found</h3>
          <p>Try a different search, list view, or create a new record.</p>
        </td>
      </tr>
    `;
    return;
  }

  $('tbody').innerHTML = recordsToRender.map((record) => `
    <tr onclick="openRecordDetail('${currentObject}', '${record.Id}')">
      ${currentColumns.map((field) => `<td>${formatValue(field, getValue(record, field), record)}</td>`).join('')}
      <td class="actions-col">
        <div class="row-acts">
          <button class="row-action edit" title="Edit" aria-label="Edit" onclick="event.stopPropagation(); openEdit('${record.Id}')">
            <svg viewBox="0 0 20 20" width="15" height="15" fill="currentColor">
              <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793z"/>
              <path d="M11.379 5.793L3 14.172V17h2.828l8.379-8.379-2.828-2.828z"/>
            </svg>
          </button>
          <button class="row-action del" title="Delete" aria-label="Delete" onclick="event.stopPropagation(); openDelete('${record.Id}')">
            <svg viewBox="0 0 20 20" width="15" height="15" fill="currentColor">
              <path fill-rule="evenodd" d="M8 2a1 1 0 00-.894.553L6.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-2.382l-.724-1.447A1 1 0 0012 2H8zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clip-rule="evenodd"/>
            </svg>
          </button>
        </div>
      </td>
    </tr>
  `).join('');
}

function getRecordsToRender() {
  if (currentViewId.startsWith('sf:')) return currentRecords;
  if (currentRecords.length <= pageSize) return currentRecords;
  const start = (currentPage - 1) * pageSize;
  return currentRecords.slice(start, start + pageSize);
}

function sortBy(field) {
  sortState = {
    field,
    direction: sortState.field === field && sortState.direction === 'asc' ? 'desc' : 'asc'
  };
  applySort();
  renderTable();
}

function applySort() {
  if (!sortState.field) return;
  const dir = sortState.direction === 'asc' ? 1 : -1;
  currentRecords.sort((a, b) => {
    const av = getValue(a, sortState.field);
    const bv = getValue(b, sortState.field);
    if (av === bv) return 0;
    if (av === null || av === undefined) return 1;
    if (bv === null || bv === undefined) return -1;
    if (!Number.isNaN(Number(av)) && !Number.isNaN(Number(bv))) return (Number(av) - Number(bv)) * dir;
    return String(av).localeCompare(String(bv)) * dir;
  });
}

async function switchObject(objectName) {
  if (viewingDetail) restoreListContent(false);
  currentObject = objectName;
  currentRecords = [];
  currentPage = 1;
  totalRecords = 0;
  currentViewId = 'all';
  sortState = { field: null, direction: 'asc' };
  $('objSearch').value = '';
  document.querySelectorAll('.nav-item').forEach((item) => {
    item.classList.toggle('active', item.dataset.obj === objectName);
  });
  closeSidebar();
  await loadListViews();
  await loadData();
}

function restoreListContent(shouldLoad = true) {
  if (!listContentHtml) return;
  $('content').innerHTML = listContentHtml;
  viewingDetail = false;
  detailRecordState = null;
  document.querySelectorAll('.nav-item').forEach((item) => {
    item.classList.toggle('active', item.dataset.obj === currentObject);
  });
  if (shouldLoad) {
    renderListViewSelect();
    loadData();
  }
}

function updateBadge(objectName, count) {
  const badge = $(`badge-${objectName}`);
  if (badge) badge.textContent = count;
}

function handleObjSearch(value) {
  clearTimeout(searchTimer);
  currentPage = 1;
  currentViewId = currentViewId.startsWith('sf:') ? 'all' : currentViewId;
  $('listViewSelect').value = currentViewId;
  searchTimer = setTimeout(loadData, value ? 350 : 0);
}

function pageRangeStart() {
  if (!totalRecords || !currentRecords.length) return 0;
  return (currentPage - 1) * pageSize + 1;
}

function pageRangeEnd() {
  if (!totalRecords || !currentRecords.length) return 0;
  return Math.min(currentPage * pageSize, totalRecords);
}

function updatePagination() {
  const bar = $('paginationBar');
  if (!bar) return;

  const isServerPaged = !currentViewId.startsWith('sf:');
  bar.style.display = isServerPaged ? 'flex' : 'none';
  if (!isServerPaged) return;

  const totalPages = Math.max(Math.ceil(totalRecords / pageSize), 1);
  $('pageSizeSelect').value = String(pageSize);
  $('pageStatus').textContent = `Page ${currentPage} of ${totalPages}`;
  $('prevPageBtn').disabled = currentPage <= 1;
  $('nextPageBtn').disabled = currentPage >= totalPages;
}

async function changePage(direction) {
  const totalPages = Math.max(Math.ceil(totalRecords / pageSize), 1);
  const nextPage = Math.min(Math.max(currentPage + direction, 1), totalPages);
  if (nextPage === currentPage) return;
  currentPage = nextPage;
  await loadData();
}

async function changePageSize(value) {
  pageSize = Number(value) || 25;
  currentPage = 1;
  await loadData();
}

function toggleSidebar() {
  $('sidebar').classList.toggle('open');
}

function closeSidebar() {
  $('sidebar').classList.remove('open');
}

async function handleGlobalSearch(value) {
  clearTimeout(globalTimer);
  globalTimer = setTimeout(async () => {
    const results = $('globalResults');
    const q = value.trim();
    if (!q) {
      results.classList.remove('open');
      results.innerHTML = '';
      return;
    }
    try {
      const data = await api(`/api/search/global?q=${encodeURIComponent(q)}`);
      renderGlobalResults(data.searchRecords || []);
    } catch (err) {
      results.innerHTML = `<div class="res-empty">${escapeHtml(err.message)}</div>`;
      results.classList.add('open');
    }
  }, 300);
}

function renderGlobalResults(records) {
  const results = $('globalResults');
  const grouped = records.reduce((acc, record) => {
    const type = record.attributes?.type || 'Record';
    acc[type] = acc[type] || [];
    acc[type].push(record);
    return acc;
  }, {});
  const html = Object.entries(grouped).map(([name, groupRecords]) => `
    <div class="res-group">
      <div class="res-group-label">${escapeHtml(name)}</div>
      ${groupRecords.map((record) => `
        <div class="res-item" onclick="openRecordDetail('${name}', '${record.Id}'); $('globalResults').classList.remove('open');">
          <div class="res-obj-icon">${objectIcon(name)}</div>
          <div>
            <button class="res-main result-link" onclick="event.stopPropagation(); openRecordDetail('${name}', '${record.Id}'); $('globalResults').classList.remove('open');">${escapeHtml(record.Name || record.Subject || record.CaseNumber || record.Id)}</button>
            <div class="res-sub">${escapeHtml(record.Email || record.Company || record.StageName || record.Status || '')}</div>
          </div>
        </div>
      `).join('')}
    </div>
  `).join('');
  results.innerHTML = html || '<div class="res-empty">No matches found</div>';
  results.classList.add('open');
}

function handleSearchKeydown(event) {
  if (event.key === 'Escape') {
    $('globalResults').classList.remove('open');
    event.currentTarget.blur();
  }
}

function openCreate() {
  editingRecord = null;
  openRecordModal(`New ${currentObject}`, {});
}

function openEdit(id) {
  editingRecord = currentRecords.find((record) => record.Id === id);
  openRecordModal(`Edit ${currentObject}`, editingRecord || {});
}

async function openRecordModal(title, record, fields = null) {
  const meta = OBJECT_META[currentObject];
  $('modalObjIcon').innerHTML = objectIcon(currentObject);
  $('modalTitle').textContent = title;
  const fullFields = fields || await getEditableFields(record);
  $('modalBody').innerHTML = `
    <div class="form-grid">
      ${fullFields.map((field) => renderFieldControl(field.name || field, record, field)).join('')}
    </div>
  `;
  $('modalOverlay').classList.add('open');
}

async function getEditableFields(record) {
  try {
    const data = await api(`/api/${currentObject}/fields`);
    const fields = data.fields
      .filter((field) => editingRecord ? field.updateable : field.createable)
      .filter((field) => !['Id', 'IsDeleted', 'CreatedDate', 'CreatedById', 'LastModifiedDate', 'LastModifiedById', 'SystemModstamp', 'LastViewedDate', 'LastReferencedDate'].includes(field.name))
      .filter((field) => field.type !== 'address')
      .slice(0, 80);
    return fields.length ? fields : OBJECT_META[currentObject].editable.map((name) => ({ name, label: labelFor(name) }));
  } catch (err) {
    return OBJECT_META[currentObject].editable.map((name) => ({ name, label: labelFor(name) }));
  }
}

function renderFieldControl(field, record, fieldMeta = {}) {
  fieldMeta = typeof fieldMeta === 'string' ? { name: field, label: labelFor(field) } : fieldMeta;
  const lookup = OBJECT_META[currentObject].lookups?.[field] || (fieldMeta.referenceTo?.length ? { object: fieldMeta.referenceTo[0], label: fieldMeta.label || labelFor(field) } : null);
  const label = fieldMeta.label || lookup?.label || labelFor(field);
  const value = record[field] ?? '';
  const type = fieldMeta.type || 'string';
  const required = fieldMeta.nillable === false ? '<span class="form-req">*</span>' : '';
  const spanClass = shouldSpanField(field, type) ? 'span-2' : '';

  if (lookup) {
    const displayValue = getValue(record, field.replace(/Id$/, '.Name')) || '';
    return `
      <div class="form-group">
        <label class="form-label" for="field-${field}-search">${escapeHtml(label)}${required}</label>
        <div class="lookup-wrap">
          <input class="form-ctrl" id="field-${field}-search" value="${escapeHtml(displayValue)}"
                 placeholder="Search ${escapeHtml(lookup.object)}..." autocomplete="off"
                 oninput="lookupSearch('${field}', '${lookup.object}', this.value)">
          <input type="hidden" id="field-${field}" name="${field}" value="${escapeHtml(record[field] || '')}">
          <div class="lookup-results" id="lookup-${field}"></div>
        </div>
      </div>
    `;
  }

  if (type === 'picklist') {
    return `
      <div class="form-group ${spanClass}">
        <label class="form-label" for="field-${field}">${escapeHtml(label)}${required}</label>
        <select class="form-ctrl" id="field-${field}" name="${field}">
          <option value=""></option>
          ${renderPicklistOptions(fieldMeta.picklistValues, value)}
        </select>
      </div>
    `;
  }

  if (type === 'multipicklist') {
    const selectedValues = String(value || '').split(';').filter(Boolean);
    return `
      <div class="form-group ${spanClass}">
        <label class="form-label" for="field-${field}">${escapeHtml(label)}${required}</label>
        <select class="form-ctrl multi-select" id="field-${field}" name="${field}" multiple>
          ${renderPicklistOptions(fieldMeta.picklistValues, selectedValues)}
        </select>
      </div>
    `;
  }

  if (type === 'textarea' || type === 'encryptedtextarea' || type === 'address') {
    return `
      <div class="form-group span-2">
        <label class="form-label" for="field-${field}">${escapeHtml(label)}${required}</label>
        <textarea class="form-ctrl" id="field-${field}" name="${field}">${escapeHtml(formatEditableValue(value, type))}</textarea>
      </div>
    `;
  }

  if (type === 'boolean') {
    return `
      <div class="form-group ${spanClass}">
        <label class="check-item form-check">
          <input type="checkbox" id="field-${field}" name="${field}" ${value ? 'checked' : ''}>
          <span>${escapeHtml(label)}${required}</span>
        </label>
      </div>
    `;
  }

  const inputType = {
    date: 'date',
    datetime: 'datetime-local',
    time: 'time',
    int: 'number',
    double: 'number',
    currency: 'number',
    percent: 'number',
    email: 'email',
    phone: 'tel',
    url: 'url'
  }[type] || 'text';

  return `
    <div class="form-group ${spanClass}">
      <label class="form-label" for="field-${field}">${escapeHtml(label)}${required}</label>
      <input class="form-ctrl" id="field-${field}" name="${field}" type="${inputType}" value="${escapeHtml(formatEditableValue(value, type))}">
    </div>
  `;
}

function renderPicklistOptions(values = [], selected) {
  const selectedSet = Array.isArray(selected) ? new Set(selected.map(String)) : new Set([String(selected || '')]);
  return (values || []).map((value) => `
    <option value="${escapeHtml(value)}" ${selectedSet.has(String(value)) ? 'selected' : ''}>${escapeHtml(value)}</option>
  `).join('');
}

function shouldSpanField(field, type) {
  return ['Description', 'Website'].includes(field) || ['textarea', 'encryptedtextarea', 'multipicklist', 'address'].includes(type);
}

function formatEditableValue(value, type) {
  if (value === null || value === undefined) return '';
  if (type === 'date') return String(value).slice(0, 10);
  if (type === 'datetime') return String(value).slice(0, 16);
  if (type === 'address') return formatAddress(value).replace(/<br>/g, '\n');
  return String(value);
}

function lookupSearch(field, objectName, value) {
  clearTimeout(lookupTimer);
  lookupTimer = setTimeout(async () => {
    const box = $(`lookup-${field}`);
    if (!value.trim()) {
      box.classList.remove('open');
      box.innerHTML = '';
      $(`field-${field}`).value = '';
      return;
    }
    try {
      const data = await api(`/api/lookup/${objectName}?search=${encodeURIComponent(value)}`);
      box.innerHTML = (data.records || []).map((record) => `
        <button type="button" class="lookup-item" onclick="selectLookup('${field}', '${record.Id}', '${encodeURIComponent(record.Name)}')">
          <span>${escapeHtml(record.Name)}</span>
          <small>${record.Id}</small>
        </button>
      `).join('') || '<div class="lookup-empty">No matches</div>';
      box.classList.add('open');
    } catch (err) {
      box.innerHTML = `<div class="lookup-empty">${escapeHtml(err.message)}</div>`;
      box.classList.add('open');
    }
  }, 250);
}

function selectLookup(field, id, name) {
  $(`field-${field}`).value = id;
  $(`field-${field}-search`).value = decodeURIComponent(name);
  $(`lookup-${field}`).classList.remove('open');
}

function closeModal() {
  $('modalOverlay').classList.remove('open');
}

async function openRecordDetail(objectName, id) {
  if (!id || !OBJECT_META[objectName]) return;

  try {
    $('content').innerHTML = `
      <div class="state-box">
        <div class="spinner-ring"><div></div><div></div><div></div><div></div></div>
        <p>Loading record detail...</p>
      </div>
    `;
    viewingDetail = true;

    const data = await api(`/api/${objectName}/${id}`);
    const record = data.record || {};
    const fields = data.fields || [];
    const title = record.Name || record.Subject || record.CaseNumber || record.Email || id;
    const displayFields = fields
      .filter((field) => record[field.name] !== null && record[field.name] !== undefined && field.name !== 'attributes')
      .slice(0, 80);

    currentObject = objectName;
    detailRecordState = { objectName, id, record, fields };
    document.querySelectorAll('.nav-item').forEach((item) => {
      item.classList.toggle('active', item.dataset.obj === objectName);
    });
    renderRecordDetailPage(objectName, record, fields, displayFields, title, id);
    if (objectName === 'Campaign') {
      activeCampaign = record;
      await loadCampaignMembers(id);
    }
  } catch (err) {
    $('content').innerHTML = `
      <div class="state-box error-state">
        <h3>Could not load record</h3>
        <p>${escapeHtml(err.message)}</p>
        <button class="btn btn-ghost" onclick="restoreListContent()">Back to List</button>
      </div>
    `;
  }
}

function renderRecordDetailPage(objectName, record, fields, displayFields, title, id) {
  const summaryFields = getSummaryFields(objectName).filter((field) => getValue(record, field) !== undefined).slice(0, 4);
  $('content').innerHTML = `
    <div class="record-page">
      <div class="record-hero">
        <div class="record-title-row">
          <div class="page-title-group">
            <div class="page-icon">${objectIcon(objectName)}</div>
            <div>
              <div class="record-kicker">${escapeHtml(objectName)}</div>
              <h1 class="page-title">${escapeHtml(title)}</h1>
            </div>
          </div>
          <div class="page-actions">
            <button class="btn btn-ghost" onclick="restoreListContent()">Back</button>
            <button class="btn btn-primary" onclick="editCurrentDetailRecord()">Edit</button>
          </div>
        </div>
        <div class="record-summary">
          ${summaryFields.map((field) => `
            <div>
              <span>${escapeHtml(labelFor(field))}</span>
              <strong>${formatValue(field, getValue(record, field), record)}</strong>
            </div>
          `).join('')}
        </div>
      </div>

      <div class="record-layout">
        <section class="record-main">
          <div class="record-tabs">
            <button class="record-tab active" id="tabRelatedBtn" onclick="showRecordTab('related')">Related</button>
            <button class="record-tab" id="tabDetailsBtn" onclick="showRecordTab('details')">Details</button>
          </div>
          <div id="recordRelatedPanel" class="record-tab-panel">
            ${renderRelatedPanel(objectName)}
          </div>
          <div id="recordDetailsPanel" class="record-tab-panel" style="display:none">
            <div class="detail-grid">
              ${displayFields.map((field) => renderDetailField(objectName, record, field)).join('')}
            </div>
          </div>
        </section>
        <aside class="record-side">
          <div class="activity-card">
            <div class="activity-head"><h3>Activity</h3></div>
            <div class="activity-empty">
              <p>Emails sent from this portal are logged to the Contact or Lead activity timeline in Salesforce.</p>
            </div>
          </div>
        </aside>
      </div>
    </div>
  `;
}

function getSummaryFields(objectName) {
  return {
    Account: ['Type', 'Industry', 'Phone', 'BillingCity'],
    Contact: ['Title', 'Email', 'Phone', 'Account.Name'],
    Lead: ['Company', 'Status', 'Email', 'Phone'],
    Opportunity: ['StageName', 'Amount', 'CloseDate', 'Probability'],
    Case: ['Status', 'Priority', 'Type', 'CreatedDate'],
    Campaign: ['Type', 'Status', 'StartDate', 'EndDate'],
    User: ['Email', 'Username', 'Title']
  }[objectName] || OBJECT_META[objectName]?.columns || [];
}

function renderRelatedPanel(objectName) {
  if (objectName === 'Campaign') return renderCampaignMembersShell();
  return `
    <div class="related-panel no-margin">
      <div class="related-head">
        <div>
          <h3>Related Records</h3>
          <p>Open related records from lookup links in Details.</p>
        </div>
      </div>
      <div class="table-empty">
        <h3>No portal related list configured</h3>
        <p>Use the Details tab or Salesforce Activity Timeline for this record.</p>
      </div>
    </div>
  `;
}

function showRecordTab(name) {
  $('recordRelatedPanel').style.display = name === 'related' ? 'block' : 'none';
  $('recordDetailsPanel').style.display = name === 'details' ? 'block' : 'none';
  $('tabRelatedBtn').classList.toggle('active', name === 'related');
  $('tabDetailsBtn').classList.toggle('active', name === 'details');
}

function editCurrentDetailRecord() {
  if (!detailRecordState) return;
  currentObject = detailRecordState.objectName;
  editingRecord = detailRecordState.record;
  openRecordModal(
    `Edit ${detailRecordState.objectName}`,
    detailRecordState.record,
    detailRecordState.fields.filter((field) => field.updateable)
  );
}

function renderDetailField(objectName, record, field) {
  const value = record[field.name];
  const label = field.label || labelFor(field.name);
  let display = formatDetailValue(value, field.type);

  if (field.type === 'reference' && value && field.referenceTo?.[0] && OBJECT_META[field.referenceTo[0]]) {
    display = `<button class="cell-button-link" onclick="openRecordDetail('${field.referenceTo[0]}', '${value}')">${escapeHtml(value)}</button>`;
  }

  return `
    <div class="detail-field">
      <div class="detail-label">${escapeHtml(label)}</div>
      <div class="detail-value">${display}</div>
    </div>
  `;
}

function formatDetailValue(value, type = '') {
  if (value === null || value === undefined || value === '') return '<span class="cell-empty">-</span>';
  if (type === 'multipicklist') return escapeHtml(String(value).split(';').filter(Boolean).join(', '));
  if (type === 'date') return new Date(value).toLocaleDateString();
  if (type === 'datetime') return new Date(value).toLocaleString();
  if (type === 'address' || isAddressObject(value)) return formatAddress(value);
  if (typeof value === 'object') return escapeHtml(value.Name || Object.entries(value)
    .filter(([, item]) => item !== null && item !== undefined && item !== '')
    .map(([key, item]) => `${labelFor(key)}: ${item}`)
    .join('\n'));
  return escapeHtml(String(value));
}

function isAddressObject(value) {
  return value && typeof value === 'object' && ['street', 'city', 'state', 'postalCode', 'country'].some((key) => key in value);
}

function formatAddress(value) {
  if (!isAddressObject(value)) return escapeHtml(String(value || ''));
  const lines = [
    value.street,
    [value.city, value.state, value.postalCode].filter(Boolean).join(', '),
    value.country
  ].filter(Boolean);

  return lines.length
    ? lines.map((line) => escapeHtml(line)).join('<br>')
    : '<span class="cell-empty">-</span>';
}

function closeDetailModal() {
  $('detailOverlay').classList.remove('open');
  $('detailEditBtn').style.display = 'inline-flex';
}

function renderCampaignMembersShell() {
  return `
    <div class="related-panel">
      <div class="related-head">
        <div>
          <h3>Campaign Members</h3>
          <p id="campaignMemberSummary">Loading members...</p>
        </div>
        <div class="related-actions">
          <button class="btn btn-ghost" onclick="openCampaignMemberModal('Lead')">Add Leads</button>
          <button class="btn btn-ghost" onclick="openCampaignMemberModal('Contact')">Add Contacts</button>
          <button class="btn btn-primary" onclick="openCampaignEmailModal()">Send Mass Email</button>
        </div>
      </div>
      <div class="mini-table-wrap" id="campaignMembersTable"></div>
    </div>
  `;
}

async function loadCampaignMembers(campaignId) {
  const table = $('campaignMembersTable');
  if (!table) return;
  table.innerHTML = '<div class="state-box compact">Loading campaign members...</div>';
  try {
    const data = await api(`/api/campaigns/${campaignId}/members`);
    campaignMembers = data.records || [];
    campaignMemberSelection = new Set(campaignMembers.filter((member) => member.email).map((member) => member.id));
    renderCampaignMembers();
  } catch (err) {
    table.innerHTML = `<div class="error-state compact"><p>${escapeHtml(err.message)}</p></div>`;
  }
}

function renderCampaignMembers() {
  const table = $('campaignMembersTable');
  if (!table) return;
  $('campaignMemberSummary').textContent = `${campaignMembers.length} members, ${campaignMembers.filter((member) => member.email).length} with email`;
  if (!campaignMembers.length) {
    table.innerHTML = '<div class="table-empty"><h3>No campaign members yet</h3><p>Add contacts or leads to this campaign.</p></div>';
    return;
  }
  table.innerHTML = `
    <table class="mini-table">
      <thead>
        <tr>
          <th><input type="checkbox" aria-label="Select all email recipients" ${campaignMemberSelection.size ? 'checked' : ''} onchange="toggleAllCampaignMembers(this.checked)"></th>
          <th>Type</th>
          <th>Status</th>
          <th>Name</th>
          <th>Company</th>
          <th>Email</th>
        </tr>
      </thead>
      <tbody>
        ${campaignMembers.map((member) => `
          <tr>
            <td><input type="checkbox" value="${member.id}" ${campaignMemberSelection.has(member.id) ? 'checked' : ''} ${member.email ? '' : 'disabled'} onchange="toggleCampaignMemberSelection('${member.id}', this.checked)"></td>
            <td><span class="badge badge-neutral">${escapeHtml(member.type)}</span></td>
            <td>${escapeHtml(member.status || '-')}</td>
            <td><button class="cell-button-link" onclick="openRecordDetail('${member.type}', '${member.personId}')">${escapeHtml(member.name || '-')}</button></td>
            <td>${escapeHtml(member.company || '-')}</td>
            <td>${member.email ? `<a class="cell-email" href="mailto:${escapeHtml(member.email)}">${escapeHtml(member.email)}</a>` : '<span class="cell-empty">-</span>'}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}

function toggleCampaignMemberSelection(id, checked) {
  if (checked) campaignMemberSelection.add(id);
  else campaignMemberSelection.delete(id);
}

function toggleAllCampaignMembers(checked) {
  campaignMemberSelection = new Set(checked ? campaignMembers.filter((member) => member.email).map((member) => member.id) : []);
  renderCampaignMembers();
}

async function openCampaignMemberModal(objectName) {
  if (!activeCampaign?.Id) return;
  memberCandidateObject = objectName;
  memberCandidateSelection = new Set();
  $('campaignMemberTitle').textContent = `Add ${objectName}s to Campaign`;
  $('campaignMemberSearch').value = '';
  $('campaignMemberOverlay').classList.add('open');
  await loadCampaignCandidates('');
}

function closeCampaignMemberModal() {
  $('campaignMemberOverlay').classList.remove('open');
}

function searchCampaignCandidates(value) {
  clearTimeout(lookupTimer);
  lookupTimer = setTimeout(() => loadCampaignCandidates(value), 300);
}

async function loadCampaignCandidates(search) {
  const box = $('campaignMemberCandidates');
  box.innerHTML = '<div class="state-box compact">Loading records...</div>';
  try {
    const data = await api(`/api/campaigns/${activeCampaign.Id}/candidates/${memberCandidateObject}?search=${encodeURIComponent(search || '')}`);
    const records = data.records || [];
    currentCampaignCandidates = records;
    $('campaignMemberSelectedCount').textContent = `${memberCandidateSelection.size} selected`;
    box.innerHTML = renderCampaignCandidateTable(records);
  } catch (err) {
    box.innerHTML = `<div class="error-state compact"><p>${escapeHtml(err.message)}</p></div>`;
  }
}

function renderCampaignCandidateTable(records) {
  if (!records.length) return '<div class="table-empty"><h3>No records found</h3><p>Try another search.</p></div>';
  const isContact = memberCandidateObject === 'Contact';
  const selectable = records.filter((record) => !record.alreadyMember);
  const allVisibleSelected = selectable.length > 0 && selectable.every((record) => memberCandidateSelection.has(record.Id));
  return `
    <table class="mini-table">
      <thead>
        <tr>
          <th><input type="checkbox" aria-label="Select all visible records" ${allVisibleSelected ? 'checked' : ''} onchange="toggleAllCandidateSelection(this.checked)"></th>
          <th>Name</th>
          <th>${isContact ? 'Account' : 'Company'}</th>
          <th>Phone</th>
          <th>Email</th>
          <th>${isContact ? 'Title' : 'Status'}</th>
        </tr>
      </thead>
      <tbody>
        ${records.map((record) => `
          <tr class="${record.alreadyMember ? 'muted-row' : ''}">
            <td><input type="checkbox" value="${record.Id}" ${memberCandidateSelection.has(record.Id) ? 'checked' : ''} ${record.alreadyMember ? 'disabled' : ''} onchange="toggleCandidateSelection('${record.Id}', this.checked)"></td>
            <td>${escapeHtml(record.Name || '-')}</td>
            <td>${escapeHtml(isContact ? record.Account?.Name || '-' : record.Company || '-')}</td>
            <td>${escapeHtml(record.Phone || '-')}</td>
            <td>${record.Email ? `<a class="cell-email" href="mailto:${escapeHtml(record.Email)}">${escapeHtml(record.Email)}</a>` : '<span class="cell-empty">-</span>'}</td>
            <td>${escapeHtml((isContact ? record.Title : record.Status) || (record.alreadyMember ? 'Already member' : '-'))}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}

function toggleCandidateSelection(id, checked) {
  if (checked) memberCandidateSelection.add(id);
  else memberCandidateSelection.delete(id);
  $('campaignMemberSelectedCount').textContent = `${memberCandidateSelection.size} selected`;
}

function toggleAllCandidateSelection(checked) {
  currentCampaignCandidates
    .filter((record) => !record.alreadyMember)
    .forEach((record) => {
      if (checked) memberCandidateSelection.add(record.Id);
      else memberCandidateSelection.delete(record.Id);
    });
  $('campaignMemberSelectedCount').textContent = `${memberCandidateSelection.size} selected`;
  $('campaignMemberCandidates').innerHTML = renderCampaignCandidateTable(currentCampaignCandidates);
}

async function addSelectedCampaignMembers() {
  const ids = [...memberCandidateSelection];
  if (!ids.length) {
    toast('Select at least one record', 'err');
    return;
  }
  try {
    $('addCampaignMembersBtn').disabled = true;
    const result = await api(`/api/campaigns/${activeCampaign.Id}/members`, {
      method: 'POST',
      body: JSON.stringify({ object: memberCandidateObject, ids })
    });
    toast(`${result.created || 0} members added`, 'ok');
    closeCampaignMemberModal();
    await loadCampaignMembers(activeCampaign.Id);
  } catch (err) {
    toast(err.message, 'err');
  } finally {
    $('addCampaignMembersBtn').disabled = false;
  }
}

async function openCampaignEmailModal() {
  if (!activeCampaign?.Id) return;
  if (!campaignMemberSelection.size) {
    toast('Select campaign members with email first', 'err');
    return;
  }
  $('campaignEmailOverlay').classList.add('open');
  $('emailTemplateSelect').innerHTML = '<option value="">Loading templates...</option>';
  $('emailRecipientCount').textContent = `${campaignMemberSelection.size} recipients`;
  $('emailPreviewSubject').textContent = 'Select a template to preview.';
  $('emailPreviewBody').innerHTML = '';
  try {
    const data = await api(`/api/campaigns/${activeCampaign.Id}/email-templates`);
    emailTemplates = data.records || [];
    $('emailTemplateSelect').innerHTML = `
      <option value="">Select template...</option>
      ${emailTemplates.map((template) => `<option value="${template.Id}">${escapeHtml(template.Name)}${template.Subject ? ` - ${escapeHtml(template.Subject)}` : ''}</option>`).join('')}
    `;
  } catch (err) {
    $('emailTemplateSelect').innerHTML = '<option value="">Could not load templates</option>';
    $('emailPreviewBody').innerHTML = `<div class="error-state compact"><p>${escapeHtml(err.message)}</p></div>`;
  }
}

function closeCampaignEmailModal() {
  $('campaignEmailOverlay').classList.remove('open');
}

async function loadCampaignEmailPreview() {
  const templateId = $('emailTemplateSelect').value;
  if (!templateId) {
    $('emailPreviewSubject').textContent = 'Select a template to preview.';
    $('emailPreviewBody').innerHTML = '';
    return;
  }
  $('emailPreviewSubject').textContent = 'Loading preview...';
  $('emailPreviewBody').innerHTML = '';
  try {
    const data = await api(`/api/campaigns/${activeCampaign.Id}/email-preview`, {
      method: 'POST',
      body: JSON.stringify({ templateId, memberIds: [...campaignMemberSelection] })
    });
    $('emailPreviewSubject').textContent = data.subject || '(No subject)';
    $('emailPreviewBody').innerHTML = data.html || `<pre>${escapeHtml(data.text || '')}</pre>`;
  } catch (err) {
    $('emailPreviewSubject').textContent = 'Preview failed';
    $('emailPreviewBody').innerHTML = `<div class="error-state compact"><p>${escapeHtml(err.message)}</p></div>`;
  }
}

async function sendCampaignEmail() {
  const templateId = $('emailTemplateSelect').value;
  if (!templateId) {
    toast('Select an email template', 'err');
    return;
  }
  try {
    $('sendCampaignEmailBtn').disabled = true;
    const result = await api(`/api/campaigns/${activeCampaign.Id}/send-email`, {
      method: 'POST',
      body: JSON.stringify({ templateId, memberIds: [...campaignMemberSelection] })
    });
    const logText = result.logWarning
      ? ` Activity log warning: ${result.logWarning}`
      : ` ${result.logged || 0} activities logged.`;
    toast(`${result.sent || 0} emails sent.${logText}`, result.logWarning ? 'info' : 'ok');
    closeCampaignEmailModal();
  } catch (err) {
    toast(err.message, 'err');
  } finally {
    $('sendCampaignEmailBtn').disabled = false;
  }
}

async function saveRecord() {
  const body = {};
  $('modalBody').querySelectorAll('[name]').forEach((input) => {
    if (input.type === 'checkbox') {
      body[input.name] = input.checked;
      return;
    }
    if (input.multiple) {
      const values = [...input.selectedOptions].map((option) => option.value).filter(Boolean);
      if (values.length) body[input.name] = values.join(';');
      return;
    }
    setValue(body, input.name, input.value);
  });
  try {
    $('saveBtn').disabled = true;
    if (editingRecord) {
      await api(`/api/${currentObject}/${editingRecord.Id}`, {
        method: 'PATCH',
        body: JSON.stringify(body)
      });
      toast('Record updated', 'ok');
    } else {
      await api(`/api/${currentObject}`, {
        method: 'POST',
        body: JSON.stringify(body)
      });
      toast('Record created', 'ok');
    }
    closeModal();
    if (viewingDetail && detailRecordState) {
      await openRecordDetail(detailRecordState.objectName, detailRecordState.id);
    } else {
      await loadData();
    }
  } catch (err) {
    toast(err.message, 'err');
  } finally {
    $('saveBtn').disabled = false;
  }
}

function openDelete(id) {
  deletingRecord = currentRecords.find((record) => record.Id === id);
  $('delRecordName').textContent = deletingRecord?.Name || deletingRecord?.Subject || deletingRecord?.Id || '';
  $('delOverlay').classList.add('open');
}

function closeDeleteModal() {
  $('delOverlay').classList.remove('open');
  deletingRecord = null;
}

async function confirmDelete() {
  if (!deletingRecord) return;
  try {
    $('confirmDelBtn').disabled = true;
    await api(`/api/${currentObject}/${deletingRecord.Id}`, { method: 'DELETE' });
    toast('Record deleted', 'ok');
    closeDeleteModal();
    await loadData();
  } catch (err) {
    toast(err.message, 'err');
  } finally {
    $('confirmDelBtn').disabled = false;
  }
}

function openListViewModal() {
  const meta = OBJECT_META[currentObject];
  $('listViewBody').innerHTML = `
    <div class="form-grid">
      <div class="form-group span-2">
        <label class="form-label" for="viewName">List View Name</label>
        <input class="form-ctrl" id="viewName" placeholder="Example: Key Accounts">
      </div>
      <div class="form-group span-2">
        <label class="form-label" for="viewSearch">Contains Text</label>
        <input class="form-ctrl" id="viewSearch" placeholder="Optional filter text">
      </div>
      <div class="form-group span-2">
        <label class="form-label">Columns</label>
        <div class="check-grid">
          ${meta.columns.concat(meta.editable).filter((v, i, arr) => arr.indexOf(v) === i).map((field) => `
            <label class="check-item">
              <input type="checkbox" value="${field}" ${meta.columns.includes(field) ? 'checked' : ''}>
              <span>${labelFor(field)}</span>
            </label>
          `).join('')}
        </div>
      </div>
    </div>
  `;
  $('listViewOverlay').classList.add('open');
}

function closeListViewModal() {
  $('listViewOverlay').classList.remove('open');
}

function saveLocalListView() {
  const name = $('viewName').value.trim();
  if (!name) {
    toast('List view name is required', 'err');
    return;
  }
  const columns = [...$('listViewBody').querySelectorAll('input[type="checkbox"]:checked')].map((input) => input.value);
  const views = getLocalViews();
  views[currentObject] = views[currentObject] || [];
  const view = {
    id: `${Date.now()}`,
    name,
    search: $('viewSearch').value.trim(),
    columns: columns.length ? columns : OBJECT_META[currentObject].columns
  };
  views[currentObject].push(view);
  setLocalViews(views);
  currentViewId = `local:${view.id}`;
  closeListViewModal();
  renderListViewSelect();
  loadData();
}

function overlayClick(event, overlayId, closeFn) {
  if (event.target.id === overlayId) closeFn();
}

function toast(message, type = 'info') {
  const item = document.createElement('div');
  item.className = `toast toast-${type}`;
  item.innerHTML = `<span class="toast-icon">${type === 'err' ? '!' : 'OK'}</span><span>${escapeHtml(message)}</span>`;
  $('toastStack').appendChild(item);
  requestAnimationFrame(() => item.classList.add('in'));
  setTimeout(() => {
    item.classList.add('out');
    setTimeout(() => item.remove(), 350);
  }, 3200);
}

document.addEventListener('click', (event) => {
  if (!event.target.closest('.profile-menu')) closeProfileMenu();
});

document.addEventListener('DOMContentLoaded', () => {
  listContentHtml = $('content').innerHTML;
  checkConnection().then(async (connection) => {
    if (connection?.success) {
      await loadListViews();
      await loadData();
    }
  });
});
