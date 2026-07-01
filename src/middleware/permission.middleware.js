const ROLE_LEVELS = { system_administrator: 5, admin: 4, manager: 3, employee: 2, readonly: 1 };
const RESERVED_API_OBJECT_NAMES = new Set([
  'portal',
  'auth',
  'email',
  'activity-email-templates',
  'bulk',
  'lookup',
  'debug',
  'reports',
  'search',
  'meta',
  'campaigns',
  'chatter'
]);

function requireAdminPanel(req, res, next) {
  if (req.user?.isSystemAdmin) return next();

  return res.status(403).json({
    error: 'Admin panel access requires System Administrator profile.',
    code: 'ADMIN_PANEL_REQUIRED'
  });
}

function requireAdmin(req, res, next) {
  if (req.user?.isSystemAdmin) return next();
  return res.status(403).json({
    error: 'This action requires admin access.',
    code: 'INSUFFICIENT_ACCESS'
  });
}

function checkRole(minimumRole) {
  return (req, res, next) => {
    if (req.user?.isSystemAdmin) return next();
    return res.status(403).json({
      error: 'This action requires System Administrator profile access.',
      code: 'INSUFFICIENT_ROLE'
    });
  };
}

function isFullAccessUser(user = {}) {
  return Boolean(user.isSystemAdmin);
}

function permissionDeniedMessage() {
  return 'You do not have the level of access necessary to perform the operation you requested.';
}

function bulkOperationAction(operation) {
  return {
    insert: 'can_create',
    update: 'can_edit',
    upsert: 'can_edit',
    delete: 'can_delete'
  }[operation];
}

function createPermissionMiddleware({
  perfAudit,
  getEffectivePermissions,
  permissionsFromRequestContext
}) {
  function checkPermission(sfObject, action) {
    return async (req, res, next) => {
      const startedAt = performance.now();
      try {
        const role = req.user.role;

        if (isFullAccessUser(req.user)) {
          perfAudit.recordEvent('permission', `${sfObject}.${action}.admin-bypass`, performance.now() - startedAt);
          return next();
        }

        if (role === 'readonly' && action !== 'can_read') {
          perfAudit.recordEvent('permission', `${sfObject}.${action}.readonly-deny`, performance.now() - startedAt);
          return res.status(403).json({
            error: permissionDeniedMessage(),
            code: 'PERMISSION_DENIED'
          });
        }

        const perms = permissionsFromRequestContext(req, sfObject) ||
          await getEffectivePermissions(req.user.id, sfObject);
        if (!perms || !perms[action]) {
          perfAudit.recordEvent('permission', `${sfObject}.${action}.deny`, performance.now() - startedAt);
          return res.status(403).json({
            error: permissionDeniedMessage(),
            code: 'PERMISSION_DENIED'
          });
        }

        perfAudit.recordEvent('permission', `${sfObject}.${action}.allow`, performance.now() - startedAt);
        next();
      } catch (err) {
        perfAudit.recordEvent('permission', `${sfObject}.${action}.error`, performance.now() - startedAt, { error: err.message });
        console.error('Permission check error:', err.message);
        res.status(500).json({ error: 'Could not verify permissions' });
      }
    };
  }

  return { checkPermission };
}

module.exports = {
  ROLE_LEVELS,
  RESERVED_API_OBJECT_NAMES,
  requireAdminPanel,
  requireAdmin,
  checkRole,
  isFullAccessUser,
  permissionDeniedMessage,
  bulkOperationAction,
  createPermissionMiddleware
};
