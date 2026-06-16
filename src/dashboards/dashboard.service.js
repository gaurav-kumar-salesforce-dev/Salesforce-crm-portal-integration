const { supabase } = require('../../db');
const reportService = require('../reports/report.service');

const COMPONENT_TYPES = new Set(['kpi', 'chart', 'table']);

async function listDashboards(user, query = {}) {
  const search = String(query.search || '').trim();
  let builder = supabase
    .from('dashboards')
    .select(`
      *,
      dashboard_folders(name),
      dashboard_favorites(user_id)
    `)
    .is('deleted_at', null)
    .order('updated_at', { ascending: false });

  if (search) builder = builder.ilike('name', `%${search}%`);

  const { data, error } = await builder.limit(200);
  if (error) throw error;
  let dashboards = data || [];

  if (!user.isSystemAdmin) {
    const { data: shares, error: sharesError } = await supabase
      .from('dashboard_shares')
      .select('dashboard_id')
      .eq('shared_with_user_id', user.id);
    if (sharesError) throw sharesError;
    const sharedIds = new Set((shares || []).map((share) => share.dashboard_id));
    dashboards = dashboards.filter((dashboard) => (
      dashboard.owner_id === user.id ||
      dashboard.visibility === 'public' ||
      sharedIds.has(dashboard.id)
    ));
  }

  return dashboards.map((dashboard) => ({
    ...dashboard,
    folder_name: dashboard.dashboard_folders?.name || null,
    is_favorite: (dashboard.dashboard_favorites || []).some((fav) => fav.user_id === user.id)
  }));
}

async function listFolders(user) {
  const { data, error } = await supabase
    .from('dashboard_folders')
    .select('*')
    .or(`owner_id.eq.${user.id},visibility.eq.public`)
    .order('name');
  if (error) throw error;
  return data || [];
}

async function createDashboard(user, payload) {
  const name = String(payload.name || '').trim();
  if (!name) throw badRequest('Dashboard name is required.');
  const { data, error } = await supabase
    .from('dashboards')
    .insert({
      name,
      description: payload.description || null,
      folder_id: payload.folderId || payload.folder_id || null,
      owner_id: user.id,
      layout: normalizeLayout(payload.layout),
      filters: Array.isArray(payload.filters) ? payload.filters : [],
      visibility: payload.visibility === 'public' ? 'public' : 'private',
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
    .select('*')
    .eq('id', dashboardId)
    .is('deleted_at', null)
    .maybeSingle();
  if (error) throw error;
  if (!dashboard) throw notFound('Dashboard not found.');

  if (user.isSystemAdmin || dashboard.owner_id === user.id || dashboard.visibility === 'public') {
    if (mode === 'write' && !user.isSystemAdmin && dashboard.owner_id !== user.id) {
      throw forbidden('Only the dashboard owner can edit this dashboard.');
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
  if ('folderId' in payload || 'folder_id' in payload) patch.folder_id = payload.folderId || payload.folder_id || null;
  if ('layout' in payload) patch.layout = normalizeLayout(payload.layout);
  if ('filters' in payload) patch.filters = Array.isArray(payload.filters) ? payload.filters : [];
  if ('visibility' in payload) patch.visibility = payload.visibility === 'public' ? 'public' : 'private';
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

async function runDashboard(dashboardId, user, deps) {
  const dashboard = await getDashboardForUser(dashboardId, user);
  const components = await listComponents(dashboardId);
  const rendered = await Promise.all(components.map(async (component) => {
    try {
      const result = await reportService.runReport(component.report_id, user, deps, {
        previewMode: true,
        dashboardMode: true,
        skipCache: false
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
  return { dashboard, components: rendered };
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
  if (component.component_type === 'kpi') {
    return renderKpiComponent(component, result);
  }
  if (component.component_type === 'table') {
    return {
      componentId: component.id,
      type: 'table',
      title: component.title,
      layout: componentLayout(component),
      columns: result.columns || [],
      rows: (result.rows || []).slice(0, component.config?.limit || 10),
      meta: componentMeta(result)
    };
  }
  return {
    componentId: component.id,
    type: 'chart',
    chartType: component.config?.chartType || result.definition?.chart?.type || 'bar',
    title: component.title,
    layout: componentLayout(component),
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
    if (!reportId) throw badRequest('Select a report for this component.');
    patch.report_id = reportId;
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
  createDashboard,
  getDashboard,
  getDashboardForUser,
  updateDashboard,
  deleteDashboard,
  listComponents,
  addComponent,
  updateComponent,
  deleteComponent,
  runDashboard,
  setFavorite
};
