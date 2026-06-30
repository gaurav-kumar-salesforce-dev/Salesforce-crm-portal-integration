// =============================================================================
// db.js — Supabase Client + Permission Resolution Helper
// Place this at: /src/db.js  (or wherever your server.js can import it)
// =============================================================================

const { createClient } = require('@supabase/supabase-js');

// ALWAYS use SERVICE_ROLE_KEY in Node.js — this bypasses RLS and gives full
// database access. NEVER expose this key in frontend code.
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

module.exports.supabase = supabase;

const USER_CONTEXT_TTL_MS = 10 * 60 * 1000;
const userContextCache = new Map();
const userContextInflight = new Map();
const userContextStats = {
  hits: 0,
  misses: 0,
  builds: 0,
  invalidations: 0
};

const denyPermissions = Object.freeze({
  can_read: false,
  can_create: false,
  can_edit: false,
  can_delete: false
});

function cloneJson(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function fullPermissions() {
  return { can_read: true, can_create: true, can_edit: true, can_delete: true };
}

function denyPermissionSet() {
  return { ...denyPermissions };
}

function mergeObjectPermissions(base, additions = []) {
  const result = { ...(base || denyPermissions) };
  additions.forEach((perm) => {
    result.can_read = Boolean(result.can_read || perm.can_read);
    result.can_create = Boolean(result.can_create || perm.can_create);
    result.can_edit = Boolean(result.can_edit || perm.can_edit);
    result.can_delete = Boolean(result.can_delete || perm.can_delete);
  });
  return result;
}

function cachedUserContext(userId) {
  const entry = userContextCache.get(userId);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    userContextCache.delete(userId);
    return null;
  }
  return entry.value;
}

function invalidateUserContextCache(userId) {
  if (!userId) return;
  if (userContextCache.delete(userId)) userContextStats.invalidations += 1;
  userContextInflight.delete(userId);
}

function invalidateAllUserContextCache() {
  if (userContextCache.size) userContextStats.invalidations += userContextCache.size;
  userContextCache.clear();
  userContextInflight.clear();
}

function getUserContextCacheStats() {
  const total = userContextStats.hits + userContextStats.misses;
  return {
    ...userContextStats,
    size: userContextCache.size,
    hitRatio: total ? Number((userContextStats.hits / total).toFixed(4)) : 0
  };
}

async function getEffectivePermissionSetIds(userId) {
  const cached = cachedUserContext(userId);
  if (cached?.effectivePermissionSetIds) {
    return [...cached.effectivePermissionSetIds];
  }

  const [
    { data: directAssignments, error: directError },
    { data: groupAssignments, error: groupError }
  ] = await Promise.all([
    supabase
      .from('user_permission_set_assignments')
      .select('perm_set_id')
      .eq('user_id', userId),
    supabase
      .from('user_permission_set_group_assignments')
      .select('group_id')
      .eq('user_id', userId)
  ]);

  if (directError) throw directError;
  if (groupError) throw groupError;

  const ids = new Set();
  (directAssignments || []).forEach((row) => {
    if (row.perm_set_id) ids.add(row.perm_set_id);
  });

  const groupIds = [...new Set((groupAssignments || []).map((row) => row.group_id).filter(Boolean))];
  if (groupIds.length) {
    const { data: groupMembers, error: groupMembersError } = await supabase
      .from('permission_set_groups')
      .select(`
        id,
        permission_set_group_members (
          perm_set_id
        )
      `)
      .in('id', groupIds)
      .eq('is_active', true);

    if (groupMembersError) throw groupMembersError;

    (groupMembers || []).forEach((group) => {
      (group.permission_set_group_members || []).forEach((member) => {
        if (member.perm_set_id) ids.add(member.perm_set_id);
      });
    });
  }

  return [...ids];
}

module.exports.getEffectivePermissionSetIds = getEffectivePermissionSetIds;


// =============================================================================
// getEffectivePermissions
// The core of the RBAC system. Called in checkPermission middleware.
// Calls the SQL function we created in the migration.
// Returns: { can_read, can_create, can_edit, can_delete }
// All FALSE if user has no profile or no permission at all on that object.
// =============================================================================
async function getEffectivePermissions(userId, sfObject) {
  const cached = cachedUserContext(userId);
  if (cached?.permissions && cached.permissions[sfObject]) {
    return { ...cached.permissions[sfObject] };
  }

  const deny = denyPermissionSet();

  const { data: assignment, error: assignmentError } = await supabase
    .from('user_profile_assignments')
    .select('profiles(id, is_system_admin)')
    .eq('user_id', userId)
    .maybeSingle();

  if (assignmentError) {
    console.error('[getEffectivePermissions] Profile lookup error:', assignmentError);
    return deny;
  }

  const profile = assignment?.profiles;
  if (!profile?.id) return deny;

  if (profile.is_system_admin) {
    return { can_read: true, can_create: true, can_edit: true, can_delete: true };
  }

  const { data: profilePermission, error: profilePermissionError } = await supabase
    .from('profile_object_permissions')
    .select('can_read, can_create, can_edit, can_delete')
    .eq('profile_id', profile.id)
    .eq('sf_object', sfObject)
    .maybeSingle();

  if (profilePermissionError) {
    console.error('[getEffectivePermissions] Profile permission lookup error:', profilePermissionError);
    return deny;
  }

  let permissionSetIds = [];
  try {
    permissionSetIds = await getEffectivePermissionSetIds(userId);
  } catch (error) {
    console.error('[getEffectivePermissions] Permission set lookup error:', error);
    return profilePermission || deny;
  }

  let permissionSetPermissions = [];
  if (permissionSetIds.length) {
    const { data, error } = await supabase
      .from('permission_set_object_perms')
      .select('can_read, can_create, can_edit, can_delete')
      .in('perm_set_id', permissionSetIds)
      .eq('sf_object', sfObject);

    if (error) {
      console.error('[getEffectivePermissions] Permission set object lookup error:', error);
      return profilePermission || deny;
    }
    permissionSetPermissions = data || [];
  }

  const result = { ...(profilePermission || deny) };
  permissionSetPermissions.forEach((perm) => {
    result.can_read = Boolean(result.can_read || perm.can_read);
    result.can_create = Boolean(result.can_create || perm.can_create);
    result.can_edit = Boolean(result.can_edit || perm.can_edit);
    result.can_delete = Boolean(result.can_delete || perm.can_delete);
  });

  return result;
}

module.exports.getEffectivePermissions = getEffectivePermissions;

async function buildUserContext(userId) {
  userContextStats.builds += 1;

  const [
    { data: user, error: userErr },
    { data: profileData, error: profileErr },
    { data: sfObjects, error: sfObjectsErr },
    { data: directAssignments, error: directError },
    { data: groupAssignments, error: groupError }
  ] = await Promise.all([
    supabase
      .from('users')
      .select('id, email, name, role, profile_image, is_active, must_change_pw, last_login_at')
      .eq('id', userId)
      .eq('is_active', true)
      .single(),
    supabase
      .from('user_profile_assignments')
      .select('profile_id, profiles(id, name, description, is_system_admin)')
      .eq('user_id', userId)
      .maybeSingle(),
    supabase
      .from('sf_objects')
      .select('api_name, label')
      .eq('is_active', true)
      .order('sort_order'),
    supabase
      .from('user_permission_set_assignments')
      .select('perm_set_id')
      .eq('user_id', userId),
    supabase
      .from('user_permission_set_group_assignments')
      .select('group_id, permission_set_groups(id, name, description)')
      .eq('user_id', userId)
  ]);

  if (userErr || !user) return null;
  if (profileErr) {
    console.error('[getUserWithPermissions] Profile lookup error:', profileErr);
  }
  if (sfObjectsErr) throw sfObjectsErr;
  if (directError) throw directError;
  if (groupError) throw groupError;

  const profile = profileData?.profiles || null;
  const objects = sfObjects || [];
  const directPermissionSetIds = (directAssignments || [])
    .map((row) => row.perm_set_id)
    .filter(Boolean);
  const permissionGroups = (groupAssignments || [])
    .map((row) => row.permission_set_groups)
    .filter(Boolean);
  const groupIds = [...new Set((groupAssignments || []).map((row) => row.group_id).filter(Boolean))];
  const effectivePermissionSetIds = new Set(directPermissionSetIds);

  if (groupIds.length) {
    const { data: groupMembers, error: groupMembersError } = await supabase
      .from('permission_set_groups')
      .select(`
        id,
        permission_set_group_members (
          perm_set_id
        )
      `)
      .in('id', groupIds)
      .eq('is_active', true);

    if (groupMembersError) throw groupMembersError;
    (groupMembers || []).forEach((group) => {
      (group.permission_set_group_members || []).forEach((member) => {
        if (member.perm_set_id) effectivePermissionSetIds.add(member.perm_set_id);
      });
    });
  }

  const permissions = {};
  const permissionSetIds = [...effectivePermissionSetIds];
  let profilePermissions = [];
  let permissionSetPermissions = [];

  if (profile?.is_system_admin) {
    objects.forEach((obj) => {
      permissions[obj.api_name] = fullPermissions();
    });
  } else {
    const permissionQueries = [];
    if (profile?.id) {
      permissionQueries.push(
        supabase
          .from('profile_object_permissions')
          .select('sf_object, can_read, can_create, can_edit, can_delete')
          .eq('profile_id', profile.id)
      );
    } else {
      permissionQueries.push(Promise.resolve({ data: [], error: null }));
    }

    if (permissionSetIds.length) {
      permissionQueries.push(
        supabase
          .from('permission_set_object_perms')
          .select('sf_object, can_read, can_create, can_edit, can_delete')
          .in('perm_set_id', permissionSetIds)
      );
    } else {
      permissionQueries.push(Promise.resolve({ data: [], error: null }));
    }

    const [
      { data: profilePermissionRows, error: profilePermissionError },
      { data: permissionSetPermissionRows, error: permissionSetPermissionError }
    ] = await Promise.all(permissionQueries);

    if (profilePermissionError) {
      console.error('[getUserWithPermissions] Profile permission lookup error:', profilePermissionError);
    }
    if (permissionSetPermissionError) {
      console.error('[getUserWithPermissions] Permission set object lookup error:', permissionSetPermissionError);
    }

    profilePermissions = profilePermissionRows || [];
    permissionSetPermissions = permissionSetPermissionRows || [];

    const profileByObject = new Map(profilePermissions.map((perm) => [perm.sf_object, perm]));
    const permissionSetsByObject = permissionSetPermissions.reduce((acc, perm) => {
      if (!acc.has(perm.sf_object)) acc.set(perm.sf_object, []);
      acc.get(perm.sf_object).push(perm);
      return acc;
    }, new Map());

    objects.forEach((obj) => {
      permissions[obj.api_name] = mergeObjectPermissions(
        profileByObject.get(obj.api_name) || denyPermissions,
        permissionSetsByObject.get(obj.api_name) || []
      );
    });
  }

  return {
    ...user,
    profile,
    permissions,
    effectivePermissionSetIds: permissionSetIds,
    directPermissionSetIds,
    permissionGroups,
    profileAssignment: profileData ? {
      profile_id: profileData.profile_id,
      profile
    } : null,
    sfObjects: objects,
    profilePermissions,
    permissionSetPermissions
  };
}


// =============================================================================
// getUserWithPermissions
// Called after login / on GET /api/portal/me
// Returns the user row + their full permission map across all SF objects.
// This is what gets cached in the frontend as window.userPerms.
// =============================================================================
async function getUserWithPermissions(userId) {
  const cached = cachedUserContext(userId);
  if (cached) {
    userContextStats.hits += 1;
    return cloneJson(cached);
  }

  userContextStats.misses += 1;
  if (userContextInflight.has(userId)) {
    return cloneJson(await userContextInflight.get(userId));
  }

  const promise = buildUserContext(userId)
    .then((context) => {
      if (context) {
        userContextCache.set(userId, {
          value: context,
          expiresAt: Date.now() + USER_CONTEXT_TTL_MS
        });
      }
      return context;
    })
    .finally(() => userContextInflight.delete(userId));

  userContextInflight.set(userId, promise);
  return cloneJson(await promise);
}

module.exports.getUserWithPermissions = getUserWithPermissions;
module.exports.invalidateUserContextCache = invalidateUserContextCache;
module.exports.invalidateAllUserContextCache = invalidateAllUserContextCache;
module.exports.getUserContextCacheStats = getUserContextCacheStats;


// =============================================================================
// writeAuditLog
// Call this after any create/edit/delete action.
// Never throws — audit failure should not break the main request.
// =============================================================================
async function writeAuditLog({ userId, userEmail, userRole, action, sfObject, recordId, payload, ipAddress }) {
  try {
    await supabase.from('audit_log').insert({
      user_id:    userId,
      user_email: userEmail,
      user_role:  userRole,
      action,
      sf_object:  sfObject   || null,
      record_id:  recordId   || null,
      payload:    payload    || null,
      ip_address: ipAddress  || null,
    });
  } catch (err) {
    console.error('[writeAuditLog] Failed to write audit log:', err);
    // Silent fail — don't break the request for audit failures
  }
}

module.exports.writeAuditLog = writeAuditLog;
