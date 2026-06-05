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


// =============================================================================
// getEffectivePermissions
// The core of the RBAC system. Called in checkPermission middleware.
// Calls the SQL function we created in the migration.
// Returns: { can_read, can_create, can_edit, can_delete }
// All FALSE if user has no profile or no permission at all on that object.
// =============================================================================
async function getEffectivePermissions(userId, sfObject) {
  const { data, error } = await supabase.rpc('get_effective_permissions', {
    p_user_id:   userId,
    p_sf_object: sfObject,
  });

  if (error) {
    console.error('[getEffectivePermissions] DB error:', error);
    // Fail closed — deny everything on DB error (safer than fail open)
    return { can_read: false, can_create: false, can_edit: false, can_delete: false };
  }

  // rpc returns an array (RETURNS TABLE) — we always want the first (only) row
  if (!data || data.length === 0) {
    return { can_read: false, can_create: false, can_edit: false, can_delete: false };
  }

  return data[0];
}

module.exports.getEffectivePermissions = getEffectivePermissions;


// =============================================================================
// getUserWithPermissions
// Called after login / on GET /api/portal/me
// Returns the user row + their full permission map across all SF objects.
// This is what gets cached in the frontend as window.userPerms.
// =============================================================================
async function getUserWithPermissions(userId) {
  // 1. Fetch user
  const { data: user, error: userErr } = await supabase
    .from('users')
    .select('id, email, name, role, is_active, must_change_pw, last_login_at')
    .eq('id', userId)
    .eq('is_active', true)
    .single();

  if (userErr || !user) return null;

  // 2. Fetch their profile assignment
  const { data: profileData } = await supabase
    .from('user_profile_assignments')
    .select('profile_id, profiles(id, name, description)')
    .eq('user_id', userId)
    .single();

  // 3. Fetch all SF objects
  const { data: sfObjects } = await supabase
    .from('sf_objects')
    .select('api_name, label')
    .eq('is_active', true)
    .order('sort_order');

  // 4. Compute effective permissions for each SF object
  const permissions = {};
  if (sfObjects) {
    await Promise.all(
      sfObjects.map(async (obj) => {
        permissions[obj.api_name] = await getEffectivePermissions(userId, obj.api_name);
      })
    );
  }

  return {
    ...user,
    profile: profileData?.profiles || null,
    permissions,  // { Account: { can_read, can_create, can_edit, can_delete }, ... }
  };
}

module.exports.getUserWithPermissions = getUserWithPermissions;


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
