function createAuthMiddleware({
  jwt,
  jwtSecret,
  getUserWithPermissions,
  getUserContextCacheStats,
  getOrganizationId
}) {
  const requestContextStats = {
    hits: 0,
    misses: 0,
    duplicatePermissionPrevented: 0
  };

  function requestContextLog(...args) {
    if (process.env.NODE_ENV !== 'production') {
      console.log('[request-context]', ...args);
    }
  }

  function deepFreeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    Object.freeze(value);
    Object.values(value).forEach(deepFreeze);
    return value;
  }

  function buildRequestUser(context, decoded = {}) {
    return {
      ...decoded,
      id: context.id,
      email: context.email,
      name: context.name,
      role: context.role,
      isSystemAdmin: Boolean(context.profile?.is_system_admin)
    };
  }

  async function resolveRequestContext(req, decoded) {
    if (req.userContext) return req.userContext;
    if (req.userContextPromise) return req.userContextPromise;

    req.userContextPromise = getUserWithPermissions(decoded.id)
      .then((context) => {
        if (!context?.id) return null;
        const requestContext = deepFreeze({
          user: {
            id: context.id,
            email: context.email,
            name: context.name,
            role: context.role,
            profile_image: context.profile_image || null,
            is_active: context.is_active,
            must_change_pw: context.must_change_pw,
            last_login_at: context.last_login_at
          },
          profile: context.profile || null,
          role: context.role,
          permissions: context.permissions || {},
          effectivePermissionSetIds: context.effectivePermissionSetIds || [],
          directPermissionSetIds: context.directPermissionSetIds || [],
          permissionGroups: context.permissionGroups || [],
          profileAssignment: context.profileAssignment || null,
          sfObjects: context.sfObjects || [],
          profilePermissions: context.profilePermissions || [],
          permissionSetPermissions: context.permissionSetPermissions || [],
          isSystemAdmin: Boolean(context.profile?.is_system_admin),
          organizationId: getOrganizationId(),
          raw: context
        });
        req.userContext = requestContext;
        req.user = buildRequestUser(context, decoded);
        return requestContext;
      })
      .finally(() => {
        req.userContextPromise = null;
      });

    return req.userContextPromise;
  }

  function permissionsFromRequestContext(req, sfObject) {
    const perms = req.userContext?.permissions?.[sfObject];
    if (!perms) return null;
    requestContextStats.duplicatePermissionPrevented += 1;
    requestContextLog('Duplicate Permission Prevented', sfObject);
    return { ...perms };
  }

  function getRequestContextStats() {
    const userStats = getUserContextCacheStats();
    return {
      ...requestContextStats,
      userContextCache: userStats
    };
  }

  async function checkAuth(req, res, next) {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'Login required', code: 'NO_TOKEN' });
    try {
      const decoded = jwt.verify(token, jwtSecret);

      const before = getUserContextCacheStats();
      const context = await resolveRequestContext(req, decoded);
      const after = getUserContextCacheStats();
      if (after.hits > before.hits) {
        requestContextStats.hits += 1;
        requestContextLog('Request Context Cache Hit', decoded.id);
      } else if (after.misses > before.misses) {
        requestContextStats.misses += 1;
        requestContextLog('Request Context Cache Miss', decoded.id);
      }

      if (!context?.user?.is_active) {
        return res.status(401).json({ error: 'Session expired. Please log in again.', code: 'USER_INACTIVE' });
      }

      next();
    } catch (err) {
      const code = err.name === 'TokenExpiredError' ? 'TOKEN_EXPIRED' : 'TOKEN_INVALID';
      return res.status(401).json({ error: 'Session expired. Please log in again.', code });
    }
  }

  return {
    checkAuth,
    resolveRequestContext,
    permissionsFromRequestContext,
    getRequestContextStats
  };
}

module.exports = {
  createAuthMiddleware
};
