const { supabase } = require('../../db');
const reportService = require('../reports/report.service');
const crypto = require('crypto');

const COMPONENT_TYPES = new Set(['kpi', 'chart', 'table', 'gauge', 'rich_text', 'image']);

async function listDashboards(user, query = {}) {
  const search = String(query.search || '').trim();
  const view = String(query.view || 'recent').toLowerCase();
  const folderId = query.folderId || query.folder_id || '';
  const sort = ['name', 'description', 'updated_at', 'visibility'].includes(query.sort) ? query.sort : 'updated_at';
  const ascending = String(query.direction || '').toLowerCase() === 'asc';
  let builder = supabase
    .from('dashboards')
    .select(`
      *,
      dashboard_folders(name, visibility, owner_id),
      dashboard_favorites(user_id)
    `)
    .is('deleted_at', null)
    .order(sort, { ascending });

  if (search) builder = builder.ilike('name', `%${search}%`);
  if (folderId) builder = builder.eq('folder_id', folderId);

  const { data, error } = await builder.limit(200);
  if (error) throw error;
  let dashboards = data || [];

  const { data: shares, error: sharesError } = await supabase
    .from('dashboard_shares')
    .select('dashboard_id, access_level')
    .eq('shared_with_user_id', user.id);
  if (sharesError) throw sharesError;
  const sharedAccessByDashboardId = new Map((shares || []).map((share) => [share.dashboard_id, share.access_level || 'read']));

  const folderAccess = await getAccessibleFolderAccess(user);

  if (!user.isSystemAdmin) {
    dashboards = dashboards.filter((dashboard) => (
      dashboard.owner_id === user.id ||
      dashboard.visibility === 'public' ||
      dashboard.dashboard_folders?.visibility === 'public' ||
      sharedAccessByDashboardId.has(dashboard.id) ||
      folderAccess.has(dashboard.folder_id)
    ));
  }

  const favoriteIds = new Set(
    dashboards
      .filter((dashboard) => (dashboard.dashboard_favorites || []).some((fav) => fav.user_id === user.id))
      .map((dashboard) => dashboard.id)
  );

  const isPublicDashboard = (dashboard) => (
    dashboard.visibility === 'public' ||
    dashboard.dashboard_folders?.visibility === 'public'
  );

  if (view === 'mine' || view === 'created') dashboards = dashboards.filter((dashboard) => dashboard.owner_id === user.id);
  if (view === 'private') dashboards = dashboards.filter((dashboard) => !isPublicDashboard(dashboard));
  if (view === 'public') dashboards = dashboards.filter(isPublicDashboard);
  if (view === 'shared') dashboards = dashboards.filter((dashboard) => sharedAccessByDashboardId.has(dashboard.id) || folderAccess.has(dashboard.folder_id));
  if (view === 'favorites') dashboards = dashboards.filter((dashboard) => favoriteIds.has(dashboard.id));

  const ownerIds = [...new Set(dashboards.map((dashboard) => dashboard.owner_id).filter(Boolean))];
  const ownerMap = await getUsersById(ownerIds);

  return dashboards.map((dashboard) => ({
    ...dashboard,
    folder_name: dashboard.dashboard_folders?.name || null,
    folder_visibility: dashboard.dashboard_folders?.visibility || null,
    owner_name: ownerMap.get(dashboard.owner_id)?.full_name || ownerMap.get(dashboard.owner_id)?.email || null,
    owner_email: ownerMap.get(dashboard.owner_id)?.email || null,
    is_favorite: favoriteIds.has(dashboard.id),
    can_edit: Boolean(
      user.isSystemAdmin ||
      dashboard.owner_id === user.id ||
      sharedAccessByDashboardId.get(dashboard.id) === 'edit' ||
      folderAccess.get(dashboard.folder_id) === 'edit'
    )
  }));
}

async function listFolders(user) {
  let { data, error } = await supabase
    .from('dashboard_folders')
    .select('*, dashboard_folder_favorites(user_id)')
    .order('name');
  if (error) throw error;
  let folders = data || [];
  const folderAccess = await getAccessibleFolderAccess(user);
  if (!user.isSystemAdmin) {
    folders = folders.filter((folder) => (
      folder.owner_id === user.id ||
      folder.visibility === 'public' ||
      folderAccess.has(folder.id)
    ));
  }

  const folderIds = folders.map((folder) => folder.id);
  const dashboardCounts = await getDashboardCountsByFolder(folderIds, user);
  return folders.map((folder) => ({
    ...folder,
    count: dashboardCounts.get(folder.id) || 0,
    is_favorite: (folder.dashboard_folder_favorites || []).some((fav) => fav.user_id === user.id),
    can_edit: Boolean(user.isSystemAdmin || folder.owner_id === user.id || folderAccess.get(folder.id) === 'edit')
  }));
}

async function createFolder(user, payload) {
  const name = String(payload.name || '').trim();
  if (!name) throw badRequest('Folder name is required.');
  const { data, error } = await supabase
    .from('dashboard_folders')
    .insert({
      name,
      description: payload.description || null,
      owner_id: user.id,
      visibility: normalizeVisibility(payload.visibility)
    })
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

async function updateFolder(folderId, user, payload) {
  const folder = await getFolderForUser(folderId, user, 'write');
  const patch = {};
  if ('name' in payload) {
    const name = String(payload.name || '').trim();
    if (!name) throw badRequest('Folder name is required.');
    patch.name = name;
  }
  if ('description' in payload) patch.description = payload.description || null;
  if ('visibility' in payload) patch.visibility = normalizeVisibility(payload.visibility);
  patch.updated_at = new Date().toISOString();
  const { data, error } = await supabase
    .from('dashboard_folders')
    .update(patch)
    .eq('id', folder.id)
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

async function deleteFolder(folderId, user) {
  const folder = await getFolderForUser(folderId, user, 'write');
  const { error: moveError } = await supabase
    .from('dashboards')
    .update({ folder_id: null, updated_at: new Date().toISOString() })
    .eq('folder_id', folder.id);
  if (moveError) throw moveError;
  const { error } = await supabase.from('dashboard_folders').delete().eq('id', folder.id);
  if (error) throw error;
}

async function setFolderFavorite(folderId, user, isFavorite) {
  await getFolderForUser(folderId, user);
  if (!isFavorite) {
    const { error } = await supabase
      .from('dashboard_folder_favorites')
      .delete()
      .eq('folder_id', folderId)
      .eq('user_id', user.id);
    if (error) throw error;
    return { favorite: false };
  }
  const { error } = await supabase
    .from('dashboard_folder_favorites')
    .upsert({ folder_id: folderId, user_id: user.id }, { onConflict: 'folder_id,user_id' });
  if (error) throw error;
  return { favorite: true };
}

async function shareFolder(folderId, user, payload) {
  await getFolderForUser(folderId, user, 'write');
  const target = {
    shared_with_user_id: payload.userId || payload.shared_with_user_id || null,
    shared_with_role_id: payload.roleId || payload.shared_with_role_id || null,
    shared_with_group_id: payload.groupId || payload.shared_with_group_id || null
  };
  if ([target.shared_with_user_id, target.shared_with_role_id, target.shared_with_group_id].filter(Boolean).length !== 1) {
    throw badRequest('Select exactly one folder share target.');
  }
  const { data, error } = await supabase
    .from('dashboard_folder_shares')
    .upsert({
      folder_id: folderId,
      ...target,
      access_level: payload.accessLevel === 'edit' ? 'edit' : 'read',
      created_by: user.id
    })
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

async function getFolderForUser(folderId, user, mode = 'read') {
  if (!folderId) return null;
  const { data: folder, error } = await supabase
    .from('dashboard_folders')
    .select('*')
    .eq('id', folderId)
    .maybeSingle();
  if (error) throw error;
  if (!folder) throw notFound('Folder not found.');
  if (user.isSystemAdmin || folder.owner_id === user.id) return folder;
  if (mode === 'read' && folder.visibility === 'public') return folder;
  const access = await getFolderAccessForUser(folder.id, user);
  if (access && (mode === 'read' || access === 'edit')) return folder;
  throw forbidden(mode === 'write' ? 'Only the folder owner or editors can edit this folder.' : 'You do not have access to this folder.');
}

async function createDashboard(user, payload) {
  const name = String(payload.name || '').trim();
  if (!name) throw badRequest('Dashboard name is required.');
  const folderId = payload.folderId || payload.folder_id || null;
  if (folderId) await getFolderForUser(folderId, user, 'write');
  const { data, error } = await supabase
    .from('dashboards')
    .insert({
      name,
      description: payload.description || null,
      folder_id: folderId,
      owner_id: user.id,
      layout: normalizeLayout(payload.layout),
      filters: Array.isArray(payload.filters) ? payload.filters : [],
      visibility: normalizeVisibility(payload.visibility),
      theme: payload.theme || 'light'
    })
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

async function getDashboardForUser(dashboardId, user, mode = 'read') {
  const { data: dashboard, error } = await supabase
    .from('dashboards')
    .select('*, dashboard_folders(visibility, owner_id)')
    .eq('id', dashboardId)
    .is('deleted_at', null)
    .maybeSingle();
  if (error) throw error;
  if (!dashboard) throw notFound('Dashboard not found.');

  const folderAccess = dashboard.folder_id ? await getFolderAccessForUser(dashboard.folder_id, user) : null;
  const publicByFolder = dashboard.dashboard_folders?.visibility === 'public';
  if (user.isSystemAdmin || dashboard.owner_id === user.id || dashboard.visibility === 'public' || publicByFolder || folderAccess) {
    if (mode === 'write' && !user.isSystemAdmin && dashboard.owner_id !== user.id) {
      if (folderAccess !== 'edit') throw forbidden('Only the dashboard owner or editors can edit this dashboard.');
    }
    return dashboard;
  }

  const { data: share, error: shareError } = await supabase
    .from('dashboard_shares')
    .select('access_level')
    .eq('dashboard_id', dashboardId)
    .eq('shared_with_user_id', user.id)
    .maybeSingle();
  if (shareError) throw shareError;
  if (!share) throw forbidden('You do not have access to this dashboard.');
  if (mode === 'write' && share.access_level !== 'edit') {
    throw forbidden('You do not have edit access to this dashboard.');
  }
  return dashboard;
}

async function getDashboard(dashboardId, user) {
  const dashboard = await getDashboardForUser(dashboardId, user);
  return {
    ...dashboard,
    components: await listComponents(dashboardId)
  };
}

async function updateDashboard(dashboardId, user, payload) {
  await getDashboardForUser(dashboardId, user, 'write');
  const patch = {};
  if ('name' in payload) patch.name = String(payload.name || '').trim();
  if ('description' in payload) patch.description = payload.description || null;
  if ('folderId' in payload || 'folder_id' in payload) {
    const nextFolderId = payload.folderId || payload.folder_id || null;
    if (nextFolderId) await getFolderForUser(nextFolderId, user, 'write');
    patch.folder_id = nextFolderId;
  }
  if ('layout' in payload) patch.layout = normalizeLayout(payload.layout);
  if ('filters' in payload) patch.filters = Array.isArray(payload.filters) ? payload.filters : [];
  if ('visibility' in payload) patch.visibility = normalizeVisibility(payload.visibility);
  if ('theme' in payload) patch.theme = payload.theme || 'light';
  patch.updated_at = new Date().toISOString();

  const { data, error } = await supabase
    .from('dashboards')
    .update(patch)
    .eq('id', dashboardId)
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

async function cloneDashboard(dashboardId, user, payload = {}) {
  const source = await getDashboardForUser(dashboardId, user, 'read');
  const targetFolderId = payload.folderId || payload.folder_id || source.folder_id || null;
  if (targetFolderId) await getFolderForUser(targetFolderId, user, 'write');
  const { data: clone, error } = await supabase
    .from('dashboards')
    .insert({
      name: String(payload.name || `${source.name} Copy`).trim(),
      description: payload.description ?? source.description,
      folder_id: targetFolderId,
      owner_id: user.id,
      layout: normalizeLayout(source.layout),
      filters: Array.isArray(source.filters) ? source.filters : [],
      visibility: normalizeVisibility(payload.visibility || source.visibility),
      theme: source.theme || 'light'
    })
    .select('*')
    .single();
  if (error) throw error;

  const components = await listComponents(source.id);
  if (components.length) {
    const { error: componentError } = await supabase
      .from('dashboard_components')
      .insert(components.map((component) => ({
        dashboard_id: clone.id,
        report_id: component.report_id,
        title: component.title,
        component_type: component.component_type,
        config: component.config || {},
        position_x: component.position_x,
        position_y: component.position_y,
        width: component.width,
        height: component.height
      })));
    if (componentError) throw componentError;
  }
  return clone;
}

async function deleteDashboard(dashboardId, user) {
  await getDashboardForUser(dashboardId, user, 'write');
  const { error } = await supabase
    .from('dashboards')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', dashboardId);
  if (error) throw error;
}

async function listComponents(dashboardId) {
  const { data, error } = await supabase
    .from('dashboard_components')
    .select('*')
    .eq('dashboard_id', dashboardId)
    .order('position_y')
    .order('position_x');
  if (error) throw error;
  return data || [];
}

async function addComponent(dashboardId, user, payload) {
  await getDashboardForUser(dashboardId, user, 'write');
  const component = normalizeComponent(payload);
  const { data, error } = await supabase
    .from('dashboard_components')
    .insert({
      dashboard_id: dashboardId,
      ...component
    })
    .select('*')
    .single();
  if (error) throw error;
  await touchDashboard(dashboardId);
  return data;
}

async function updateComponent(dashboardId, componentId, user, payload) {
  await getDashboardForUser(dashboardId, user, 'write');
  const patch = normalizeComponent(payload, { partial: true });
  const { data, error } = await supabase
    .from('dashboard_components')
    .update(patch)
    .eq('id', componentId)
    .eq('dashboard_id', dashboardId)
    .select('*')
    .single();
  if (error) throw error;
  await touchDashboard(dashboardId);
  return data;
}

async function deleteComponent(dashboardId, componentId, user) {
  await getDashboardForUser(dashboardId, user, 'write');
  const { error } = await supabase
    .from('dashboard_components')
    .delete()
    .eq('id', componentId)
    .eq('dashboard_id', dashboardId);
  if (error) throw error;
  await touchDashboard(dashboardId);
}

async function runDashboard(dashboardId, user, deps, options = {}) {
  const dashboard = await getDashboardForUser(dashboardId, user);
  const components = await listComponents(dashboardId);
  const cacheKey = dashboardCacheKey(dashboard, components, user);
  const cached = options.skipCache ? null : await getDashboardCache(cacheKey);
  if (cached) return { ...cached, cached: true };

  const globalFilters = Array.isArray(dashboard.filters) ? dashboard.filters : [];
  const rendered = await Promise.all(components.map(async (component) => {
    try {
      if (component.component_type === 'rich_text' || component.component_type === 'image') {
        return renderComponent(component, null);
      }
      const result = await reportService.runReport(component.report_id, user, deps, {
        previewMode: true,
        dashboardMode: true,
        skipCache: false,
        additionalFilters: globalFilters
      });
      return renderComponent(component, result);
    } catch (error) {
      return {
        componentId: component.id,
        type: component.component_type,
        title: component.title,
        error: error.message || 'Could not run component'
      };
    }
  }));
  const result = { dashboard, components: rendered, cached: false };
  await setDashboardCache(cacheKey, dashboardId, user.id, result);
  return result;
}

async function getDashboardCache(cacheKey) {
  const { data, error } = await supabase
    .from('dashboard_cache')
    .select('result, expires_at')
    .eq('cache_key', cacheKey)
    .maybeSingle();
  if (error || !data) return null;
  if (new Date(data.expires_at).getTime() < Date.now()) {
    await supabase.from('dashboard_cache').delete().eq('cache_key', cacheKey);
    return null;
  }
  return data.result;
}

async function setDashboardCache(cacheKey, dashboardId, userId, result) {
  await supabase
    .from('dashboard_cache')
    .upsert({
      cache_key: cacheKey,
      dashboard_id: dashboardId,
      user_id: userId,
      result,
      expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString()
    }, { onConflict: 'cache_key' })
    .then(() => null, () => null);
}

function dashboardCacheKey(dashboard, components, user) {
  return crypto.createHash('sha256')
    .update(JSON.stringify({
      dashboardId: dashboard.id,
      updatedAt: dashboard.updated_at,
      filters: dashboard.filters || [],
      components: components.map((component) => ({
        id: component.id,
        reportId: component.report_id,
        updatedAt: component.updated_at,
        config: component.config
      })),
      userId: user.id,
      role: user.role,
      isSystemAdmin: Boolean(user.isSystemAdmin)
    }))
    .digest('hex');
}

async function setFavorite(dashboardId, user, isFavorite) {
  await getDashboardForUser(dashboardId, user);
  if (!isFavorite) {
    const { error } = await supabase
      .from('dashboard_favorites')
      .delete()
      .eq('dashboard_id', dashboardId)
      .eq('user_id', user.id);
    if (error) throw error;
    return { favorite: false };
  }
  const { error } = await supabase
    .from('dashboard_favorites')
    .upsert({ dashboard_id: dashboardId, user_id: user.id }, { onConflict: 'dashboard_id,user_id' });
  if (error) throw error;
  return { favorite: true };
}

function renderComponent(component, result) {
  if (component.component_type === 'rich_text') {
    return {
      componentId: component.id,
      type: 'rich_text',
      title: component.title,
      layout: componentLayout(component),
      config: component.config || {},
      meta: {}
    };
  }
  if (component.component_type === 'image') {
    return {
      componentId: component.id,
      type: 'image',
      title: component.title,
      layout: componentLayout(component),
      config: component.config || {},
      meta: {}
    };
  }
  if (component.component_type === 'kpi') {
    return renderKpiComponent(component, result);
  }
  if (component.component_type === 'table') {
    return {
      componentId: component.id,
      type: 'table',
      title: component.title,
      layout: componentLayout(component),
      config: component.config || {},
      columns: result.columns || [],
      rows: (result.rows || []).slice(0, component.config?.limit || 10),
      meta: componentMeta(result)
    };
  }
  return {
    componentId: component.id,
    type: component.component_type === 'gauge' ? 'gauge' : 'chart',
    chartType: component.component_type === 'gauge' ? 'gauge' : component.config?.chartType || result.definition?.chart?.type || 'bar',
    title: component.title,
    layout: componentLayout(component),
    config: component.config || {},
    columns: result.columns || [],
    rows: result.rows || [],
    meta: componentMeta(result)
  };
}

function renderKpiComponent(component, result) {
  const valueField = component.config?.valueField || result.columns?.find((column) => column.aggregate || column.total)?.field;
  const firstRow = result.rows?.[0] || {};
  const value = valueField ? readPath(firstRow, valueField) : result.totalSize || result.rows?.length || 0;
  return {
    componentId: component.id,
    type: 'kpi',
    title: component.title,
    layout: componentLayout(component),
    config: component.config || {},
    value,
    meta: componentMeta(result)
  };
}

function componentMeta(result) {
  return {
    reportName: result.reportName,
    reportType: result.reportType,
    totalSize: result.totalSize,
    sourceRowCount: result.sourceRowCount,
    cached: Boolean(result.cached)
  };
}

function normalizeLayout(layout = {}) {
  return {
    columns: Number(layout.columns || 12),
    rowHeight: Number(layout.rowHeight || 90)
  };
}

function normalizeComponent(payload = {}, options = {}) {
  const patch = {};
  if (!options.partial || 'title' in payload) patch.title = String(payload.title || 'Dashboard Component').trim();
  if (!options.partial || 'componentType' in payload || 'component_type' in payload) {
    const type = payload.componentType || payload.component_type || 'chart';
    if (!COMPONENT_TYPES.has(type)) throw badRequest('Invalid dashboard component type.');
    patch.component_type = type;
  }
  if (!options.partial || 'reportId' in payload || 'report_id' in payload) {
    const reportId = payload.reportId || payload.report_id;
    const type = payload.componentType || payload.component_type || patch.component_type;
    if (!reportId && !['rich_text', 'image'].includes(type)) throw badRequest('Select a report for this component.');
    patch.report_id = reportId || null;
  }
  if (!options.partial || 'config' in payload) patch.config = payload.config && typeof payload.config === 'object' ? payload.config : {};
  if (!options.partial || 'positionX' in payload || 'position_x' in payload) patch.position_x = Number(payload.positionX ?? payload.position_x ?? 0);
  if (!options.partial || 'positionY' in payload || 'position_y' in payload) patch.position_y = Number(payload.positionY ?? payload.position_y ?? 0);
  if (!options.partial || 'width' in payload) patch.width = Number(payload.width || 6);
  if (!options.partial || 'height' in payload) patch.height = Number(payload.height || 3);
  return patch;
}

function componentLayout(component) {
  return {
    x: component.position_x,
    y: component.position_y,
    w: component.width,
    h: component.height
  };
}

async function touchDashboard(dashboardId) {
  await supabase
    .from('dashboards')
    .update({ updated_at: new Date().toISOString() })
    .eq('id', dashboardId)
    .then(() => null, () => null);
}

async function getAccessibleFolderAccess(user) {
  const access = new Map();
  if (!user?.id) return access;
  const { roleId, groupIds } = await getFolderShareIdentity(user);
  const { data, error } = await supabase
    .from('dashboard_folder_shares')
    .select('folder_id, access_level')
    .or([
      `shared_with_user_id.eq.${user.id}`,
      roleId ? `shared_with_role_id.eq.${roleId}` : '',
      groupIds.length ? `shared_with_group_id.in.(${groupIds.join(',')})` : ''
    ].filter(Boolean).join(','));
  if (error) return access;
  (data || []).forEach((row) => access.set(row.folder_id, strongestAccess(access.get(row.folder_id), row.access_level)));
  return access;
}

async function getFolderAccessForUser(folderId, user) {
  if (!folderId || !user?.id) return null;
  const { roleId, groupIds } = await getFolderShareIdentity(user);
  const { data, error } = await supabase
    .from('dashboard_folder_shares')
    .select('access_level')
    .eq('folder_id', folderId)
    .or([
      `shared_with_user_id.eq.${user.id}`,
      roleId ? `shared_with_role_id.eq.${roleId}` : '',
      groupIds.length ? `shared_with_group_id.in.(${groupIds.join(',')})` : ''
    ].filter(Boolean).join(','));
  if (error || !data?.length) return null;
  return data.reduce((best, row) => strongestAccess(best, row.access_level), null);
}

async function getDashboardCountsByFolder(folderIds, user) {
  const counts = new Map();
  if (!folderIds.length) return counts;
  const dashboards = await listDashboards(user, { view: 'all' });
  dashboards.forEach((dashboard) => {
    if (dashboard.folder_id) counts.set(dashboard.folder_id, (counts.get(dashboard.folder_id) || 0) + 1);
  });
  return counts;
}

async function getUsersById(userIds) {
  const map = new Map();
  if (!userIds.length) return map;
  const { data, error } = await supabase
    .from('users')
    .select('id, full_name, email')
    .in('id', userIds);
  if (error) return map;
  (data || []).forEach((user) => map.set(user.id, user));
  return map;
}

function normalizeVisibility(value) {
  return ['public', 'shared'].includes(value) ? value : 'private';
}

function strongestAccess(current, next) {
  if (current === 'edit' || next === 'edit') return 'edit';
  return current || next || 'read';
}

async function getFolderShareIdentity(user) {
  const identity = { roleId: null, groupIds: [] };
  if (!user?.id) return identity;

  const { data: userRow } = await supabase
    .from('users')
    .select('org_role_id')
    .eq('id', user.id)
    .maybeSingle();
  identity.roleId = userRow?.org_role_id || null;

  let membershipQuery = supabase
    .from('public_group_members')
    .select('group_id, member_type, user_id, org_role_id')
    .or(`user_id.eq.${user.id}${identity.roleId ? `,org_role_id.eq.${identity.roleId}` : ''}`);
  const { data: memberships } = await membershipQuery;
  identity.groupIds = [...new Set((memberships || [])
    .filter((row) => row.member_type === 'user' || row.member_type === 'role')
    .map((row) => row.group_id)
    .filter(Boolean))];

  return identity;
}

function readPath(row, path) {
  if (Object.prototype.hasOwnProperty.call(row || {}, path)) return row[path];
  return String(path || '').split('.').reduce((value, key) => value?.[key], row);
}

function badRequest(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}

function forbidden(message) {
  const error = new Error(message);
  error.statusCode = 403;
  return error;
}

function notFound(message) {
  const error = new Error(message);
  error.statusCode = 404;
  return error;
}

module.exports = {
  listDashboards,
  listFolders,
  createFolder,
  updateFolder,
  deleteFolder,
  setFolderFavorite,
  shareFolder,
  createDashboard,
  getDashboard,
  getDashboardForUser,
  updateDashboard,
  cloneDashboard,
  deleteDashboard,
  listComponents,
  addComponent,
  updateComponent,
  deleteComponent,
  runDashboard,
  setFavorite
};
