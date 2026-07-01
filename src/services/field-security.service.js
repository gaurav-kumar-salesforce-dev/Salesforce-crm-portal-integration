function createFieldSecurityService({ supabase, getEffectivePermissionSetIds }) {
  const fieldPermCache = new Map();

  function fieldPermCacheKey(userId, sfObject) {
    return `${userId}:${sfObject}`;
  }

  async function getEffectiveFieldPerms(userId, sfObject, userRole, isSystemAdmin = false, userContext = null) {
    const cacheKey = fieldPermCacheKey(userId, sfObject);
    if (fieldPermCache.has(cacheKey)) return fieldPermCache.get(cacheKey);

    const { data: sensitiveFields, error: sensitiveError } = await supabase
      .from('sensitive_fields')
      .select('field_name')
      .eq('sf_object', sfObject);

    if (sensitiveError) throw sensitiveError;

    if (!sensitiveFields?.length) {
      fieldPermCache.set(cacheKey, null);
      return null;
    }

    let profileAssignment = userContext?.profileAssignment;
    if (!profileAssignment) {
      const { data, error: profileError } = await supabase
        .from('user_profile_assignments')
        .select('profile_id')
        .eq('user_id', userId)
        .maybeSingle();
      if (profileError) throw profileError;
      profileAssignment = data;
    }

    let profilePerms = [];
    if (profileAssignment?.profile_id) {
      const { data, error } = await supabase
        .from('field_permissions')
        .select('field_name, can_view, can_edit')
        .eq('profile_id', profileAssignment.profile_id)
        .eq('sf_object', sfObject);
      if (error) throw error;
      profilePerms = data || [];
    }

    const permSetIds = userContext?.effectivePermissionSetIds
      ? [...userContext.effectivePermissionSetIds]
      : await getEffectivePermissionSetIds(userId);
    let permSetPerms = [];
    if (permSetIds.length) {
      const { data, error } = await supabase
        .from('field_permissions')
        .select('field_name, can_view, can_edit')
        .in('permission_set_id', permSetIds)
        .eq('sf_object', sfObject);
      if (error) throw error;
      permSetPerms = data || [];
    }

    const allowedMap = {};
    [...profilePerms, ...permSetPerms].forEach(f => {
      if (!allowedMap[f.field_name]) allowedMap[f.field_name] = { can_view: false, can_edit: false };
      allowedMap[f.field_name].can_view = Boolean(allowedMap[f.field_name].can_view || f.can_view);
      allowedMap[f.field_name].can_edit = Boolean(allowedMap[f.field_name].can_edit || f.can_edit);
    });

    const hiddenFields = new Set(
      sensitiveFields
        .filter(sf => !allowedMap[sf.field_name]?.can_view)
        .map(sf => sf.field_name)
    );

    const readonlyFields = new Set(
      sensitiveFields
        .filter(sf => allowedMap[sf.field_name]?.can_view && !allowedMap[sf.field_name]?.can_edit)
        .map(sf => sf.field_name)
    );

    const result = { hiddenFields, readonlyFields };
    fieldPermCache.set(cacheKey, result);
    return result;
  }

  function applyFieldSecurity(record, fieldPerms) {
    if (!fieldPerms || !record) return record;
    const { hiddenFields } = fieldPerms;
    if (!hiddenFields.size) return record;

    const cleaned = { ...record };
    hiddenFields.forEach(field => {
      if (field in cleaned) delete cleaned[field];
    });
    return cleaned;
  }

  function applyFieldWriteSecurity(body, fieldPerms) {
    if (!fieldPerms || !body) return body;
    const blocked = new Set([
      ...(fieldPerms.hiddenFields || []),
      ...(fieldPerms.readonlyFields || [])
    ]);
    if (!blocked.size) return body;
    const cleaned = { ...body };
    blocked.forEach(field => {
      if (field in cleaned) delete cleaned[field];
    });
    return cleaned;
  }

  function attachFieldPerms(sfObject) {
    return async (req, res, next) => {
      try {
        req.fieldPerms = await getEffectiveFieldPerms(
          req.user.id,
          sfObject,
          req.user.role,
          req.user.isSystemAdmin,
          req.userContext
        );
        next();
      } catch (err) {
        console.error('Field perm error:', err.message);
        req.fieldPerms = null;
        next();
      }
    };
  }

  function clearFieldPermCache(userId) {
    for (const key of fieldPermCache.keys()) {
      if (key.startsWith(`${userId}:`)) fieldPermCache.delete(key);
    }
  }

  function clearAllFieldPermCache() {
    fieldPermCache.clear();
  }

  return {
    getEffectiveFieldPerms,
    applyFieldSecurity,
    applyFieldWriteSecurity,
    attachFieldPerms,
    clearFieldPermCache,
    clearAllFieldPermCache
  };
}

module.exports = {
  createFieldSecurityService
};
