const { supabase } = require('../../db');
const { normalizeReportDefinition } = require('./report-validator');
const { runTabularReport } = require('./report-engine');
const { toCsv } = require('./report-exporter');
const reportCache = require('./report-cache');

async function listFolders(user) {
  const { data, error } = await supabase
    .from('report_folders')
    .select('*')
    .or(`owner_id.eq.${user.id},visibility.eq.public`)
    .order('name');
  if (error) throw error;
  return data || [];
}

async function createFolder(user, payload) {
  const name = String(payload.name || '').trim();
  if (!name) throw badRequest('Folder name is required.');
  const { data, error } = await supabase
    .from('report_folders')
    .insert({
      name,
      description: payload.description || null,
      owner_id: user.id,
      visibility: payload.visibility === 'public' ? 'public' : 'private'
    })
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

async function listReports(user, query = {}) {
  const search = String(query.search || '').trim();
  let builder = supabase
    .from('reports')
    .select(`
      *,
      report_folders(name),
      report_favorites(user_id)
    `)
    .is('deleted_at', null)
    .order('updated_at', { ascending: false });

  if (search) builder = builder.ilike('name', `%${search}%`);

  const { data, error } = await builder.limit(200);
  if (error) throw error;
  let reports = data || [];
  if (!user.isSystemAdmin) {
    const { data: shares, error: sharesError } = await supabase
      .from('report_shares')
      .select('report_id')
      .eq('shared_with_user_id', user.id);
    if (sharesError) throw sharesError;
    const sharedIds = new Set((shares || []).map((share) => share.report_id));
    reports = reports.filter((report) => (
      report.owner_id === user.id ||
      report.visibility === 'public' ||
      sharedIds.has(report.id)
    ));
  }
  return reports.map((report) => ({
    ...report,
    folder_name: report.report_folders?.name || null,
    is_favorite: (report.report_favorites || []).some((fav) => fav.user_id === user.id)
  }));
}

async function getReportForUser(reportId, user, mode = 'read') {
  const { data: report, error } = await supabase
    .from('reports')
    .select('*')
    .eq('id', reportId)
    .is('deleted_at', null)
    .maybeSingle();
  if (error) throw error;
  if (!report) throw notFound('Report not found.');

  if (user.isSystemAdmin || report.owner_id === user.id || report.visibility === 'public') {
    if (mode === 'write' && !user.isSystemAdmin && report.owner_id !== user.id) {
      throw forbidden('Only the report owner can edit this report.');
    }
    return report;
  }

  const { data: share, error: shareError } = await supabase
    .from('report_shares')
    .select('access_level')
    .eq('report_id', reportId)
    .eq('shared_with_user_id', user.id)
    .maybeSingle();
  if (shareError) throw shareError;
  if (!share) throw forbidden('You do not have access to this report.');
  if (mode === 'write' && share.access_level !== 'edit') {
    throw forbidden('You do not have edit access to this report.');
  }
  return report;
}

async function createReport(user, payload) {
  const name = String(payload.name || '').trim();
  if (!name) throw badRequest('Report name is required.');
  const definition = normalizeReportDefinition(payload);
  const { data, error } = await supabase
    .from('reports')
    .insert({
      name,
      description: payload.description || null,
      folder_id: payload.folderId || payload.folder_id || null,
      owner_id: user.id,
      report_type: definition.reportType,
      primary_object: definition.primaryObject,
      definition,
      visibility: payload.visibility === 'public' ? 'public' : 'private'
    })
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

async function updateReport(reportId, user, payload) {
  await getReportForUser(reportId, user, 'write');
  const patch = {};
  if ('name' in payload) patch.name = String(payload.name || '').trim();
  if ('description' in payload) patch.description = payload.description || null;
  if ('folderId' in payload || 'folder_id' in payload) patch.folder_id = payload.folderId || payload.folder_id || null;
  if ('visibility' in payload) patch.visibility = payload.visibility === 'public' ? 'public' : 'private';
  if ('definition' in payload || 'fields' in payload || 'primaryObject' in payload) {
    const definition = normalizeReportDefinition(payload);
    patch.report_type = definition.reportType;
    patch.primary_object = definition.primaryObject;
    patch.definition = definition;
  }
  patch.updated_at = new Date().toISOString();

  const { data, error } = await supabase
    .from('reports')
    .update(patch)
    .eq('id', reportId)
    .select('*')
    .single();
  if (error) throw error;
  reportCache.clearReport(reportId);
  return data;
}

async function cloneReport(reportId, user) {
  const report = await getReportForUser(reportId, user);
  const { data, error } = await supabase
    .from('reports')
    .insert({
      name: `${report.name} Copy`,
      description: report.description,
      folder_id: report.folder_id,
      owner_id: user.id,
      report_type: report.report_type,
      primary_object: report.primary_object,
      definition: report.definition,
      visibility: 'private'
    })
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

async function deleteReport(reportId, user) {
  await getReportForUser(reportId, user, 'write');
  const { error } = await supabase
    .from('reports')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', reportId);
  if (error) throw error;
  reportCache.clearReport(reportId);
}

async function setFavorite(reportId, user, isFavorite) {
  await getReportForUser(reportId, user);
  if (!isFavorite) {
    const { error } = await supabase
      .from('report_favorites')
      .delete()
      .eq('report_id', reportId)
      .eq('user_id', user.id);
    if (error) throw error;
    return { favorite: false };
  }
  const { error } = await supabase
    .from('report_favorites')
    .upsert({ report_id: reportId, user_id: user.id }, { onConflict: 'report_id,user_id' });
  if (error) throw error;
  return { favorite: true };
}

async function runReport(reportId, user, deps, options = {}) {
  const report = await getReportForUser(reportId, user);
  const result = await runTabularReport(report, user, deps, options);
  await logExecution(report.id, user.id, result, null);
  return result;
}

async function runAdhocReport(user, deps, payload) {
  const definition = normalizeReportDefinition(payload);
  return runTabularReport({ name: 'Preview', definition }, user, deps, {
    previewMode: true,
    skipCache: false
  });
}

async function runDraftReport(user, deps, payload) {
  const definition = normalizeReportDefinition(payload);
  return runTabularReport({ name: 'Run Report', definition }, user, deps, {
    previewMode: false,
    skipCache: false
  });
}

async function exportReportCsv(reportId, user, deps) {
  const result = await runReport(reportId, user, deps, { exportMode: true, skipCache: true });
  return {
    filename: `${safeFilename(result.reportName)}.csv`,
    csv: toCsv(result.columns, result.rows)
  };
}

async function metadata(user, deps) {
  const objects = Object.keys(deps.objects)
    .filter((name) => !['Task', 'Event', 'EmailMessage', 'Pricebook2', 'User'].includes(name));

  const readable = [];
  await Promise.all(objects.map(async (objectName) => {
    const perms = await deps.getEffectivePermissions(user.id, objectName);
    if (user.isSystemAdmin || perms?.can_read) readable.push({
      apiName: objectName,
      label: objectName
    });
  }));
  return readable.sort((a, b) => a.label.localeCompare(b.label));
}

async function fieldsForObject(objectName, user, deps) {
  if (!deps.objects[objectName]) throw badRequest('Unknown object.');
  const perms = await deps.getEffectivePermissions(user.id, objectName);
  if (!user.isSystemAdmin && !perms?.can_read) throw forbidden('You do not have access to this object.');

  const describe = await deps.sfGet(`/sobjects/${objectName}/describe`);
  const fieldPerms = await deps.getEffectiveFieldPerms(user.id, objectName, user.role, user.isSystemAdmin);
  const hidden = fieldPerms?.hiddenFields || new Set();

  return (describe.fields || [])
    .filter((field) => !field.deprecatedAndHidden && field.name !== 'attributes' && !hidden.has(field.name))
    .filter((field) => field.type !== 'address' && field.type !== 'location' && field.type !== 'base64')
    .map((field) => ({
      name: field.name,
      label: field.label,
      type: field.type,
      sortable: field.sortable !== false
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

async function logExecution(reportId, userId, result, error) {
  await supabase.from('report_execution_logs').insert({
    report_id: reportId,
    user_id: userId,
    status: error ? 'error' : 'success',
    row_count: result?.rows?.length || 0,
    duration_ms: result?.timings?.totalMs || null,
    error_message: error?.message || null
  }).then(() => null, () => null);
}

function safeFilename(name) {
  return String(name || 'report').replace(/[^a-z0-9_-]+/gi, '_').replace(/^_+|_+$/g, '') || 'report';
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
  listFolders,
  createFolder,
  listReports,
  getReportForUser,
  createReport,
  updateReport,
  cloneReport,
  deleteReport,
  setFavorite,
  runReport,
  runAdhocReport,
  runDraftReport,
  exportReportCsv,
  metadata,
  fieldsForObject
};
