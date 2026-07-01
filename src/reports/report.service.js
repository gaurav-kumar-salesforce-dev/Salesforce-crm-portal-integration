const { supabase } = require('../../db');
const { normalizeReportDefinition } = require('./report-validator');
const { runTabularReport } = require('./report-engine');
const { toCsv, toXlsx } = require('./report-exporter');
const reportCache = require('../cache/report-cache');

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

async function updateFolder(folderId, user, payload) {
  const folder = await getFolderForUser(folderId, user, 'write');
  const patch = {};
  if ('name' in payload) {
    const name = String(payload.name || '').trim();
    if (!name) throw badRequest('Folder name is required.');
    patch.name = name;
  }
  if ('description' in payload) patch.description = payload.description || null;
  if ('visibility' in payload) patch.visibility = payload.visibility === 'public' ? 'public' : 'private';
  patch.updated_at = new Date().toISOString();
  const { data, error } = await supabase
    .from('report_folders')
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
    .from('reports')
    .update({ folder_id: null, updated_at: new Date().toISOString() })
    .eq('folder_id', folder.id);
  if (moveError) throw moveError;
  const { error } = await supabase.from('report_folders').delete().eq('id', folder.id);
  if (error) throw error;
}

async function setFolderFavorite(folderId, user, isFavorite) {
  await getFolderForUser(folderId, user);
  if (!isFavorite) {
    const { error } = await supabase
      .from('report_folder_favorites')
      .delete()
      .eq('folder_id', folderId)
      .eq('user_id', user.id);
    if (error) throw error;
    return { favorite: false };
  }
  const { error } = await supabase
    .from('report_folder_favorites')
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
    .from('report_folder_shares')
    .insert({
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
  const { data: folder, error } = await supabase
    .from('report_folders')
    .select('*')
    .eq('id', folderId)
    .maybeSingle();
  if (error) throw error;
  if (!folder) throw notFound('Folder not found.');
  if (user.isSystemAdmin || folder.owner_id === user.id) return folder;
  if (mode === 'read' && folder.visibility === 'public') return folder;
  throw forbidden(mode === 'write' ? 'Only the folder owner can edit this folder.' : 'You do not have access to this folder.');
}

async function listReports(user, query = {}) {
  const search = String(query.search || '').trim();
  let builder = supabase
    .from('reports')
    .select(`
      *,
      report_folders(name, visibility, owner_id)
    `)
    .is('deleted_at', null)
    .order('updated_at', { ascending: false });

  if (search) builder = builder.ilike('name', `%${search}%`);
  if (query.folderId || query.folder_id) builder = builder.eq('folder_id', query.folderId || query.folder_id);

  const { data, error } = await builder.limit(200);
  if (error) throw error;
  let reports = data || [];

  const { data: favoriteRows, error: favoriteError } = await supabase
    .from('report_favorites')
    .select('report_id')
    .eq('user_id', user.id);
  if (favoriteError) throw favoriteError;
  const favoriteIds = new Set((favoriteRows || []).map((row) => row.report_id));

  const sharedAccessByReportId = new Map();
  const { data: shares, error: sharesError } = await supabase
    .from('report_shares')
    .select('report_id, access_level')
    .eq('shared_with_user_id', user.id);
  if (sharesError) throw sharesError;
  (shares || []).forEach((share) => sharedAccessByReportId.set(share.report_id, share.access_level || 'read'));

  const isPublicReport = (report) => (
    report.visibility === 'public' ||
    report.report_folders?.visibility === 'public'
  );
  const isPrivateReport = (report) => !isPublicReport(report);

  if (!user.isSystemAdmin) {
    reports = reports.filter((report) => (
      report.owner_id === user.id ||
      isPublicReport(report) ||
      sharedAccessByReportId.has(report.id)
    ));
  }
  const view = String(query.view || '').toLowerCase();
  if (view === 'mine') reports = reports.filter((report) => report.owner_id === user.id);
  if (view === 'private') reports = reports.filter(isPrivateReport);
  if (view === 'public') reports = reports.filter(isPublicReport);
  if (view === 'shared') reports = reports.filter((report) => sharedAccessByReportId.has(report.id));
  if (view === 'favorites') reports = reports.filter((report) => favoriteIds.has(report.id));
  return reports.map((report) => ({
    ...report,
    folder_name: report.report_folders?.name || null,
    folder_visibility: report.report_folders?.visibility || null,
    is_favorite: favoriteIds.has(report.id),
    can_edit: Boolean(
      user.isSystemAdmin ||
      report.owner_id === user.id ||
      sharedAccessByReportId.get(report.id) === 'edit'
    )
  }));
}

async function getReportForUser(reportId, user, mode = 'read') {
  const { data: report, error } = await supabase
    .from('reports')
    .select('*, report_folders(visibility)')
    .eq('id', reportId)
    .is('deleted_at', null)
    .maybeSingle();
  if (error) throw error;
  if (!report) throw notFound('Report not found.');

  const publicByFolder = report.report_folders?.visibility === 'public';
  if (user.isSystemAdmin || report.owner_id === user.id || report.visibility === 'public' || publicByFolder) {
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

async function shareReport(reportId, user, payload) {
  await getReportForUser(reportId, user, 'write');
  const email = String(payload.email || payload.userEmail || '').trim().toLowerCase();
  if (!email) throw badRequest('User email is required.');
  const { data: targetUser, error: userError } = await supabase
    .from('users')
    .select('id, email')
    .ilike('email', email)
    .maybeSingle();
  if (userError) throw userError;
  if (!targetUser) throw notFound('No portal user found for that email.');
  const { error: deleteError } = await supabase
    .from('report_shares')
    .delete()
    .eq('report_id', reportId)
    .eq('shared_with_user_id', targetUser.id);
  if (deleteError) throw deleteError;
  const { data, error } = await supabase
    .from('report_shares')
    .insert({
      report_id: reportId,
      shared_with_user_id: targetUser.id,
      access_level: payload.accessLevel === 'edit' ? 'edit' : 'read',
      created_by: user.id
    })
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

async function runReport(reportId, user, deps, options = {}) {
  let report = null;
  try {
    report = await getReportForUser(reportId, user);
    const hydrated = await hydrateReport(report);
    if (Array.isArray(options.additionalFilters) && options.additionalFilters.length) {
      hydrated.definition = {
        ...hydrated.definition,
        filters: [...(hydrated.definition.filters || []), ...options.additionalFilters]
      };
    }
    const result = await runTabularReport(hydrated, user, deps, options);
    await logExecution(report.id, user.id, result, null, options);
    return result;
  } catch (error) {
    await logExecution(report?.id || reportId, user.id, null, error, options);
    throw error;
  }
}

async function runAdhocReport(user, deps, payload) {
  const definition = normalizeReportDefinition(payload);
  try {
    const result = await runTabularReport({ name: 'Preview', definition: await hydrateDefinition(definition) }, user, deps, {
      previewMode: true,
      skipCache: false
    });
    await logExecution(null, user.id, result, null, { previewMode: true, adhoc: true });
    return result;
  } catch (error) {
    await logExecution(null, user.id, null, error, { previewMode: true, adhoc: true });
    throw error;
  }
}

async function runDraftReport(user, deps, payload) {
  const definition = normalizeReportDefinition(payload);
  try {
    const result = await runTabularReport({ name: 'Run Report', definition: await hydrateDefinition(definition) }, user, deps, {
      previewMode: false,
      skipCache: false
    });
    await logExecution(null, user.id, result, null, { draftRun: true });
    return result;
  } catch (error) {
    await logExecution(null, user.id, null, error, { draftRun: true });
    throw error;
  }
}

async function exportReportCsv(reportId, user, deps) {
  const result = await runReport(reportId, user, deps, { exportMode: true, skipCache: true });
  return {
    filename: `${safeFilename(result.reportName)}.csv`,
    csv: toCsv(result.columns, result.rows)
  };
}

async function exportReportXlsx(reportId, user, deps) {
  const result = await runReport(reportId, user, deps, { exportMode: true, skipCache: true });
  return {
    filename: `${safeFilename(result.reportName)}.xlsx`,
    buffer: toXlsx(result.columns, result.rows, result.reportName)
  };
}

async function metadata(user, deps) {
  const objects = Object.keys(deps.objects)
    .filter((name) => deps.getObjectConfig?.(name)?.supportsReports !== false);

  const readable = [];
  await Promise.all(objects.map(async (objectName) => {
    const perms = await deps.getEffectivePermissions(user.id, objectName);
    if (user.isSystemAdmin || perms?.can_read) readable.push({
      apiName: objectName,
      label: deps.getObjectConfig?.(objectName)?.label || objectName
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

async function listReportTypes(user) {
  const { data, error } = await supabase
    .from('custom_report_types')
    .select('*')
    .eq('is_active', true)
    .order('is_standard', { ascending: false })
    .order('name');
  if (error) throw error;
  return data || [];
}

async function createReportType(user, payload) {
  if (!user.isSystemAdmin) throw forbidden('Only system administrators can create report types.');
  const record = normalizeReportTypePayload(payload, user);
  const { data, error } = await supabase
    .from('custom_report_types')
    .insert(record)
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

async function updateReportType(typeId, user, payload) {
  if (!user.isSystemAdmin) throw forbidden('Only system administrators can edit report types.');
  const patch = normalizeReportTypePayload(payload, user, { partial: true });
  patch.updated_at = new Date().toISOString();
  const { data, error } = await supabase
    .from('custom_report_types')
    .update(patch)
    .eq('id', typeId)
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

async function fieldsForReportType(typeId, user, deps) {
  const reportType = await getReportType(typeId);
  const definition = reportType.definition || {};
  const objects = Array.isArray(definition.objects) && definition.objects.length
    ? definition.objects
    : [{ alias: reportType.primary_object, object: reportType.primary_object, label: reportType.primary_object, relationship: 'primary' }];
  const isCrossObject = Array.isArray(definition.relationships) && definition.relationships.length > 0;
  const lists = await Promise.all(objects.map(async (objectMeta) => {
    const fields = await fieldsForObject(objectMeta.object, user, deps);
    if (!isCrossObject) return fields;
    return fields.map((field) => ({
      ...field,
      name: `${objectMeta.alias}.${field.name}`,
      sourceName: field.name,
      objectAlias: objectMeta.alias,
      objectName: objectMeta.object,
      label: `${objectMeta.label || objectMeta.alias}: ${field.label}`
    }));
  }));
  return lists.flat().sort((a, b) => a.label.localeCompare(b.label));
}

async function listSchedules(reportId, user) {
  await getReportForUser(reportId, user);
  const { data, error } = await supabase
    .from('report_schedules')
    .select('*')
    .eq('report_id', reportId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

async function createSchedule(reportId, user, payload) {
  await getReportForUser(reportId, user, 'write');
  const schedule = normalizeSchedule(payload, user);
  const { data, error } = await supabase
    .from('report_schedules')
    .insert({ ...schedule, report_id: reportId, owner_id: user.id })
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

async function updateSchedule(scheduleId, user, payload) {
  const { data: schedule, error: scheduleError } = await supabase
    .from('report_schedules')
    .select('*')
    .eq('id', scheduleId)
    .maybeSingle();
  if (scheduleError) throw scheduleError;
  if (!schedule) throw notFound('Schedule not found.');
  await getReportForUser(schedule.report_id, user, 'write');
  const patch = normalizeSchedule(payload, user, { partial: true });
  patch.updated_at = new Date().toISOString();
  const { data, error } = await supabase
    .from('report_schedules')
    .update(patch)
    .eq('id', scheduleId)
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

async function deleteSchedule(scheduleId, user) {
  const { data: schedule, error: scheduleError } = await supabase
    .from('report_schedules')
    .select('*')
    .eq('id', scheduleId)
    .maybeSingle();
  if (scheduleError) throw scheduleError;
  if (!schedule) throw notFound('Schedule not found.');
  await getReportForUser(schedule.report_id, user, 'write');
  const { error } = await supabase.from('report_schedules').delete().eq('id', scheduleId);
  if (error) throw error;
}

async function createExportJob(reportId, user, deps, payload = {}) {
  const report = await getReportForUser(reportId, user);
  const format = payload.format === 'xlsx' ? 'xlsx' : 'csv';
  const { data: job, error } = await supabase
    .from('report_export_jobs')
    .insert({
      report_id: reportId,
      user_id: user.id,
      format,
      status: 'queued',
      definition_snapshot: report.definition || {},
      file_name: `${safeFilename(report.name)}.${format}`
    })
    .select('*')
    .single();
  if (error) throw error;
  setImmediate(() => processExportJob(job.id, user, deps).catch(() => null));
  return job;
}

async function getExportJob(jobId, user) {
  const { data: job, error } = await supabase
    .from('report_export_jobs')
    .select('*')
    .eq('id', jobId)
    .maybeSingle();
  if (error) throw error;
  if (!job) throw notFound('Export job not found.');
  if (!user.isSystemAdmin && job.user_id !== user.id) throw forbidden('You do not have access to this export job.');
  return job;
}

async function processExportJob(jobId, user, deps) {
  await supabase
    .from('report_export_jobs')
    .update({
      status: 'running',
      started_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      progress: 10
    })
    .eq('id', jobId);
  try {
    const job = await getExportJob(jobId, user);
    await supabase
      .from('report_export_jobs')
      .update({ attempts: Number(job.attempts || 0) + 1, updated_at: new Date().toISOString() })
      .eq('id', jobId)
      .then(() => null, () => null);
    const file = job.format === 'xlsx'
      ? await exportReportXlsx(job.report_id, user, deps)
      : await exportReportCsv(job.report_id, user, deps);
    const resultText = job.format === 'xlsx'
      ? file.buffer.toString('base64')
      : file.csv;
    await supabase
      .from('report_export_jobs')
      .update({
        status: 'completed',
        file_name: file.filename,
        result_text: resultText,
        finished_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        progress: 100
      })
      .eq('id', jobId);
  } catch (error) {
    const { data: failedJob } = await supabase
      .from('report_export_jobs')
      .select('attempts, max_attempts')
      .eq('id', jobId)
      .maybeSingle();
    const attempts = Number(failedJob?.attempts || 0);
    const maxAttempts = Number(failedJob?.max_attempts || 3);
    if (attempts < maxAttempts) {
      await supabase
        .from('report_export_jobs')
        .update({
          status: 'queued',
          error_message: error.message || 'Export retry scheduled',
          last_error_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          progress: 0
        })
        .eq('id', jobId)
        .then(() => null, () => null);
      setTimeout(() => processExportJob(jobId, user, deps).catch(() => null), Math.min(30000, 1000 * Math.pow(2, attempts)));
      return;
    }
    await supabase
      .from('report_export_jobs')
      .update({
        status: 'failed',
        error_message: error.message || 'Export failed',
        last_error_at: new Date().toISOString(),
        finished_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        progress: 100
      })
      .eq('id', jobId);
  }
}

async function hydrateReport(report) {
  return { ...report, definition: await hydrateDefinition(report.definition || {}) };
}

async function hydrateDefinition(definition) {
  const output = { ...definition };
  if (output.reportTypeId) {
    const type = await getReportType(output.reportTypeId);
    output.reportTypeDefinition = type.definition || {};
    output.primaryObject = output.primaryObject || type.primary_object;
  }
  if (output.reportType === 'joined' && Array.isArray(output.blocks)) {
    output.blocks = await Promise.all(output.blocks.map(async (block) => ({
      ...block,
      definition: await hydrateDefinition(block.definition || {})
    })));
  }
  return output;
}

async function getReportType(typeId) {
  const { data, error } = await supabase
    .from('custom_report_types')
    .select('*')
    .eq('id', typeId)
    .eq('is_active', true)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw notFound('Report type not found.');
  return data;
}

function normalizeReportTypePayload(payload, user, options = {}) {
  const name = String(payload.name || '').trim();
  const primaryObject = String(payload.primaryObject || payload.primary_object || '').trim();
  if (!options.partial && (!name || !primaryObject)) throw badRequest('Report type name and primary object are required.');
  const patch = {};
  if (name) patch.name = name;
  if ('description' in payload) patch.description = payload.description || null;
  if (primaryObject) patch.primary_object = primaryObject;
  if ('isActive' in payload || 'is_active' in payload) patch.is_active = payload.isActive ?? payload.is_active;
  if ('definition' in payload) patch.definition = normalizeReportTypeDefinition(payload.definition, primaryObject);
  if (!options.partial) {
    patch.developer_name = String(payload.developerName || payload.developer_name || name)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
    patch.definition = patch.definition || normalizeReportTypeDefinition(payload.definition || {}, primaryObject);
    patch.created_by = user.id;
    patch.is_standard = false;
  }
  return patch;
}

function normalizeReportTypeDefinition(definition = {}, primaryObject) {
  if (Array.isArray(definition.objects) && Array.isArray(definition.relationships)) return definition;
  return {
    primaryObject,
    objects: [{ alias: primaryObject, object: primaryObject, label: primaryObject, relationship: 'primary' }],
    relationships: []
  };
}

function normalizeSchedule(payload, user, options = {}) {
  const patch = {};
  if (!options.partial || 'cronExpression' in payload || 'cron_expression' in payload) {
    patch.cron_expression = String(payload.cronExpression || payload.cron_expression || '0 8 * * 1').trim();
  }
  if ('timezone' in payload || !options.partial) patch.timezone = String(payload.timezone || 'UTC').trim();
  if ('recipients' in payload || !options.partial) {
    patch.recipients = Array.isArray(payload.recipients)
      ? payload.recipients
      : String(payload.recipients || user.email || '').split(',').map((item) => item.trim()).filter(Boolean);
  }
  if ('format' in payload || !options.partial) patch.format = payload.format === 'xlsx' ? 'xlsx' : 'csv';
  if ('isActive' in payload || 'is_active' in payload || !options.partial) patch.is_active = Boolean(payload.isActive ?? payload.is_active);
  if ('nextRunAt' in payload || 'next_run_at' in payload) patch.next_run_at = payload.nextRunAt || payload.next_run_at || null;
  return patch;
}

async function logExecution(reportId, userId, result, error, options = {}) {
  await supabase.from('report_execution_logs').insert({
    report_id: reportId,
    user_id: userId,
    status: error ? 'error' : 'success',
    row_count: result?.rows?.length || 0,
    duration_ms: result?.timings?.totalMs || null,
    error_message: error?.message || null
  }).then(() => null, () => null);

  await supabase.from('report_execution_metrics').insert({
    report_id: reportId || null,
    dashboard_id: options.dashboardId || options.dashboard_id || null,
    component_id: options.componentId || options.component_id || null,
    user_id: userId,
    execution_type: options.dashboardMode ? 'component' : (options.exportMode ? 'export' : (options.previewMode ? 'preview' : 'report')),
    cache_hit: Boolean(result?.cached),
    bypass_cache: Boolean(options.skipCache),
    sf_ms: Number.isFinite(Number(result?.timings?.salesforceMs)) ? Number(result.timings.salesforceMs) : null,
    security_ms: Number.isFinite(Number(result?.timings?.securityMs)) ? Number(result.timings.securityMs) : null,
    total_ms: Number.isFinite(Number(result?.timings?.totalMs)) ? Number(result.timings.totalMs) : null,
    rows_returned: Number(result?.totalSize || result?.rows?.length || 0),
    rows_processed: Number(result?.sourceRowCount || result?.rows?.length || result?.totalSize || 0),
    soql: result?.soql || null,
    status: error ? 'error' : 'success',
    error_message: error?.message || null,
    metadata: {
      cache: reportCache.snapshotStats(),
      reportType: result?.reportType || null,
      salesforceTotalSize: result?.salesforceTotalSize || null,
      done: result?.done ?? null
    }
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
  updateFolder,
  deleteFolder,
  setFolderFavorite,
  shareFolder,
  listReports,
  getReportForUser,
  createReport,
  updateReport,
  cloneReport,
  deleteReport,
  setFavorite,
  shareReport,
  runReport,
  runAdhocReport,
  runDraftReport,
  exportReportCsv,
  exportReportXlsx,
  listReportTypes,
  createReportType,
  updateReportType,
  fieldsForReportType,
  listSchedules,
  createSchedule,
  updateSchedule,
  deleteSchedule,
  createExportJob,
  getExportJob,
  metadata,
  fieldsForObject
};
