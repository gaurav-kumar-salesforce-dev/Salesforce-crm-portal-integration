require('dotenv').config();
const express = require('express');
const axios = require('axios');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const {
  supabase,
  getEffectivePermissions,
  getEffectivePermissionSetIds,
  getUserWithPermissions,
  writeAuditLog
} = require('./db');
const { createReportsRouter } = require('./src/reports/report.routes');
const { createDashboardsRouter } = require('./src/dashboards/dashboard.routes');

const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '8h';

const { Resend } = require('resend');
const resend = new Resend(process.env.RESEND_API_KEY);

const app = express();
app.set('trust proxy', true);
app.use(express.json({ limit: process.env.JSON_BODY_LIMIT || '25mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Verifies JWT on every request. Attaches req.user = { id, email, role, name }
async function checkAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token  = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Login required', code: 'NO_TOKEN' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);

    const { data: activeUser, error: activeUserError } = await supabase
      .from('users')
      .select('id, email, name, role, is_active')
      .eq('id', decoded.id)
      .eq('is_active', true)
      .single();

    if (activeUserError || !activeUser) {
      return res.status(401).json({ error: 'Session expired. Please log in again.', code: 'USER_INACTIVE' });
    }

    const { data: profileAssignment } = await supabase
      .from('user_profile_assignments')
      .select('profiles(is_system_admin)')
      .eq('user_id', activeUser.id)
      .maybeSingle();

    req.user = {
      ...decoded,
      id: activeUser.id,
      email: activeUser.email,
      name: activeUser.name,
      role: activeUser.role,
      isSystemAdmin: Boolean(profileAssignment?.profiles?.is_system_admin)
    };
    next();
  } catch (err) {
    const code = err.name === 'TokenExpiredError' ? 'TOKEN_EXPIRED' : 'TOKEN_INVALID';
    return res.status(401).json({ error: 'Session expired. Please log in again.', code });
  }
}

// Role gate — use AFTER checkAuth. Roles in order: system_administrator > admin > manager > employee > readonly
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

// NEW: profile-based admin check
// isAdminPanel = requires System Administrator profile
// isAdminOrAbove = requires System Admin OR admin role (backward compat)
function requireAdminPanel(req, res, next) {
  // System Administrator profile always gets in
  if (req.user?.isSystemAdmin) return next();

  return res.status(403).json({
    error: 'Admin panel access requires System Administrator profile.',
    code:  'ADMIN_PANEL_REQUIRED'
  });
}

function requireAdmin(req, res, next) {
  if (req.user?.isSystemAdmin) return next();
  return res.status(403).json({
    error: 'This action requires admin access.',
    code:  'INSUFFICIENT_ACCESS'
  });
}

// Keep checkRole for backward compat but map to new functions
function checkRole(minimumRole) {
  return (req, res, next) => {
    if (req.user?.isSystemAdmin) return next();
    return res.status(403).json({
      error: 'This action requires System Administrator profile access.',
      code:  'INSUFFICIENT_ROLE'
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

// Checks user's effective permissions for a SF object before allowing the action
function checkPermission(sfObject, action) {
  return async (req, res, next) => {
    try {
      const role = req.user.role;

      // System Administrator profile, system_administrator role, and admin role bypass object permission checks
      if (isFullAccessUser(req.user)) {
        return next();
      }

      // readonly role can NEVER write
      if (role === 'readonly' && action !== 'can_read') {
        return res.status(403).json({
          error: permissionDeniedMessage(),
          code: 'PERMISSION_DENIED'
        });
      }

      const perms = await getEffectivePermissions(req.user.id, sfObject);
      if (!perms || !perms[action]) {
        return res.status(403).json({
          error: permissionDeniedMessage(),
          code: 'PERMISSION_DENIED'
        });
      }

      next();
    } catch (err) {
      console.error('Permission check error:', err.message);
      res.status(500).json({ error: 'Could not verify permissions' });
    }
  };
}

// ── FIELD LEVEL SECURITY ──────────────────────────────────────
// Cache field permissions per user per object (cleared on logout)
const fieldPermCache = new Map();

function fieldPermCacheKey(userId, sfObject) {
  return `${userId}:${sfObject}`;
}

async function getEffectiveFieldPerms(userId, sfObject, userRole, isSystemAdmin = false) {
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

  const { data: profileAssignment, error: profileError } = await supabase
    .from('user_profile_assignments')
    .select('profile_id')
    .eq('user_id', userId)
    .maybeSingle();

  if (profileError) throw profileError;

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

  const permSetIds = await getEffectivePermissionSetIds(userId);
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
// Strips hidden fields from a record object
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

// Middleware: attaches fieldPerms to req for use in route handlers
function attachFieldPerms(sfObject) {
  return async (req, res, next) => {
    try {
      req.fieldPerms = await getEffectiveFieldPerms(
        req.user.id,
        sfObject,
        req.user.role,
        req.user.isSystemAdmin
      );
      next();
    } catch (err) {
      console.error('Field perm error:', err.message);
      req.fieldPerms = null; // Fail open for field perms (object perms already enforced)
      next();
    }
  };
}

// Clear field perm cache for a user (call when profile/permset changes)
function clearFieldPermCache(userId) {
  for (const key of fieldPermCache.keys()) {
    if (key.startsWith(`${userId}:`)) fieldPermCache.delete(key);
  }
}

function clearAllFieldPermCache() {
  fieldPermCache.clear();
}

function normalizeProfileImage(value) {
  if (value === null || value === '') return null;
  if (value === undefined) return undefined;
  if (typeof value !== 'string') {
    const error = new Error('Profile image must be an image data URL');
    error.statusCode = 400;
    throw error;
  }
  if (!/^data:image\/(png|jpe?g|webp|gif);base64,/i.test(value)) {
    const error = new Error('Profile image must be PNG, JPG, WEBP, or GIF');
    error.statusCode = 400;
    throw error;
  }
  if (Buffer.byteLength(value, 'utf8') > 750 * 1024) {
    const error = new Error('Profile image must be smaller than 750 KB');
    error.statusCode = 400;
    throw error;
  }
  return value;
}
// ── SHARING-AWARE RECORD VISIBILITY ──────────────────────────

const PORTAL_OWNER_FIELD = 'Portal_Owner__c';
const PORTAL_AUDIT_FIELDS = [
  'Portal_Owner__c',
  'Portal_Created_By__c',
  'Portal_Last_Modified_By__c'
];
const roleVisibilityCache = new Map();
const owdCache = new Map();
const portalUserContextCache = new Map();
const publicGroupMembershipCache = new Map();
const sharingRulesCache = new Map();
const recordShareCache = new Map();
let securityPerfSeq = 0;

function msSince(startedAt) {
  return Number((performance.now() - startedAt).toFixed(1));
}

function securityPerfLog(requestId, label, data = {}) {
}

function clearSharingAccessCaches() {
  portalUserContextCache.clear();
  publicGroupMembershipCache.clear();
  sharingRulesCache.clear();
  recordShareCache.clear();
}

function getRecordOwnerId(record = {}) {
  return record?.[PORTAL_OWNER_FIELD] || null;
}

function roleVisibilityKey(viewerUserId, ownerUserId) {
  return `${viewerUserId}:${ownerUserId}`;
}

async function getOrgWideDefaultAccess(sfObject) {
  if (owdCache.has(sfObject)) return owdCache.get(sfObject);

  const { data, error } = await supabase
    .from('org_wide_defaults')
    .select('access_level')
    .eq('sf_object', sfObject)
    .maybeSingle();

  if (error) {
    console.error('[record-visibility] OWD lookup failed:', error.message);
    owdCache.set(sfObject, 'private');
    return 'private';
  }

  const accessLevel = data?.access_level || 'private';
  owdCache.set(sfObject, accessLevel);
  return accessLevel;
}

async function canViewerAccessOwnerRole(viewerUserId, ownerUserId) {
  if (!viewerUserId || !ownerUserId) return false;
  if (viewerUserId === ownerUserId) return true;

  const cacheKey = roleVisibilityKey(viewerUserId, ownerUserId);
  if (roleVisibilityCache.has(cacheKey)) return roleVisibilityCache.get(cacheKey);

  const { data: users, error: usersError } = await supabase
    .from('users')
    .select('id, org_role_id')
    .in('id', [viewerUserId, ownerUserId])
    .eq('is_active', true);

  if (usersError) {
    console.error('[record-visibility] user role lookup failed:', usersError.message);
    roleVisibilityCache.set(cacheKey, false);
    return false;
  }

  const viewer = (users || []).find(row => row.id === viewerUserId);
  const owner = (users || []).find(row => row.id === ownerUserId);
  const roleIds = [...new Set([viewer?.org_role_id, owner?.org_role_id].filter(Boolean))];
  if (!viewer?.org_role_id || !owner?.org_role_id || !roleIds.length) {
    roleVisibilityCache.set(cacheKey, false);
    return false;
  }

  const { data: roles, error: rolesError } = await supabase
    .from('org_roles')
    .select('id, path')
    .in('id', roleIds)
    .eq('is_active', true);

  if (rolesError) {
    console.error('[record-visibility] org role path lookup failed:', rolesError.message);
    roleVisibilityCache.set(cacheKey, false);
    return false;
  }

  const viewerPath = (roles || []).find(role => role.id === viewer.org_role_id)?.path;
  const ownerPath = (roles || []).find(role => role.id === owner.org_role_id)?.path;
  let allowed = false;

  if (viewerPath && ownerPath && viewer.org_role_id !== owner.org_role_id) {
    allowed = ownerPath.startsWith(`${viewerPath}/`);
  }

  roleVisibilityCache.set(cacheKey, allowed);
  return allowed;
}

function strongestRecordAccess(current, next) {
  const rank = { none: 0, read: 1, edit: 2 };
  if (!next?.allowed) return current;
  const currentRank = rank[current.accessLevel] || 0;
  const nextRank = rank[next.accessLevel] || 0;
  return nextRank > currentRank ? next : current;
}

async function getPortalUserRoleContext(userId) {
  if (!userId) return null;
  if (portalUserContextCache.has(userId)) return portalUserContextCache.get(userId);

  const promise = (async () => {
    try {
      const { data: user, error } = await supabase
        .from('users')
        .select('id, role, org_role_id')
        .eq('id', userId)
        .eq('is_active', true)
        .maybeSingle();

      if (error) {
        console.error('[record-visibility] portal user context lookup failed:', error.message);
        return null;
      }
      return user || null;
    } catch (err) {
      console.error('[record-visibility] portal user context lookup failed:', err.message);
      return null;
    }
  })();

  portalUserContextCache.set(userId, promise);
  return promise;
}

async function getPublicGroupIdsForUser(userId, orgRoleId) {
  const cacheKey = `${userId}:${orgRoleId || ''}`;
  if (publicGroupMembershipCache.has(cacheKey)) {
    return publicGroupMembershipCache.get(cacheKey);
  }

  const promise = (async () => {
    const directGroups = new Set();

    try {
      const { data, error } = await supabase
        .from('public_group_members')
        .select('group_id, member_type, user_id, org_role_id')
        .or(`user_id.eq.${userId}${orgRoleId ? `,org_role_id.eq.${orgRoleId}` : ''}`);

      if (error) {
        console.error('[record-visibility] public group membership lookup failed:', error.message);
        return directGroups;
      }

      const candidateRows = data || [];
      const groupIds = [...new Set(candidateRows.map(row => row.group_id).filter(Boolean))];
      if (!groupIds.length) return directGroups;

      const { data: groups, error: groupsError } = await supabase
        .from('public_groups')
        .select('id, is_active')
        .in('id', groupIds);

      if (groupsError) {
        console.error('[record-visibility] public group lookup failed:', groupsError.message);
        return directGroups;
      }

      const activeGroupIds = new Set((groups || []).filter(group => group.is_active).map(group => group.id));
      candidateRows.forEach((row) => {
        if (!activeGroupIds.has(row.group_id)) return;
        if (row.member_type === 'user' && row.user_id === userId) directGroups.add(row.group_id);
        if (row.member_type === 'role' && orgRoleId && row.org_role_id === orgRoleId) directGroups.add(row.group_id);
      });

      return directGroups;
    } catch (err) {
      console.error('[record-visibility] public group membership lookup failed:', err.message);
      return directGroups;
    }
  })();

  publicGroupMembershipCache.set(cacheKey, promise);
  return promise;
}

async function getSharingRulesForObject(sfObject) {
  if (sharingRulesCache.has(sfObject)) return sharingRulesCache.get(sfObject);

  const promise = (async () => {
    try {
      const { data: rules, error } = await supabase
        .from('sharing_rules')
        .select('*')
        .eq('sf_object', sfObject)
        .eq('is_active', true);

      if (error) {
        console.error('[record-visibility] sharing rule lookup failed:', error.message);
        return [];
      }
      return rules || [];
    } catch (err) {
      console.error('[record-visibility] sharing rule lookup failed:', err.message);
      return [];
    }
  })();

  sharingRulesCache.set(sfObject, promise);
  return promise;
}

async function getRecordSharesForViewer(recordId, sfObject, userId, viewerGroupIds) {
  if (!recordId) return [];
  const groupKey = [...viewerGroupIds].sort().join(',');
  const cacheKey = `${sfObject}:${recordId}:${userId}:${groupKey}`;
  if (recordShareCache.has(cacheKey)) return recordShareCache.get(cacheKey);

  const promise = (async () => {
    try {
      const orFilter = `shared_with.eq.${userId}${viewerGroupIds.size ? `,shared_with_group.in.(${[...viewerGroupIds].join(',')})` : ''}`;
      const { data: shares, error } = await supabase
        .from('record_shares')
        .select('access_level, shared_with, shared_with_group, expires_at')
        .eq('sf_object', sfObject)
        .eq('record_id', recordId)
        .or(orFilter);

      if (error) {
        console.error('[record-visibility] record share lookup failed:', error.message);
        return [];
      }

      const now = Date.now();
      return (shares || []).filter(share => !share.expires_at || new Date(share.expires_at).getTime() > now);
    } catch (err) {
      console.error('[record-visibility] record share lookup failed:', err.message);
      return [];
    }
  })();

  recordShareCache.set(cacheKey, promise);
  return promise;
}

async function getRecordSharesForViewerBatch(recordIds = [], sfObject, userId, viewerGroupIds) {
  const ids = [...new Set((recordIds || []).filter(Boolean))];
  const sharesByRecordId = new Map(ids.map(id => [id, []]));
  if (!ids.length) return sharesByRecordId;

  const groupIds = [...viewerGroupIds];
  const now = Date.now();
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    const orFilter = `shared_with.eq.${userId}${groupIds.length ? `,shared_with_group.in.(${groupIds.join(',')})` : ''}`;
    const { data: shares, error } = await supabase
      .from('record_shares')
      .select('record_id, access_level, shared_with, shared_with_group, expires_at')
      .eq('sf_object', sfObject)
      .in('record_id', chunk)
      .or(orFilter);

    if (error) {
      console.error('[record-visibility] batch record share lookup failed:', error.message);
      continue;
    }

    (shares || [])
      .filter(share => !share.expires_at || new Date(share.expires_at).getTime() > now)
      .forEach((share) => {
        if (!sharesByRecordId.has(share.record_id)) sharesByRecordId.set(share.record_id, []);
        sharesByRecordId.get(share.record_id).push(share);
      });
  }
  return sharesByRecordId;
}

async function buildVisibilityContext(userId, userRole, sfObject) {
  const viewer = await getPortalUserRoleContext(userId);
  const viewerGroupIds = await getPublicGroupIdsForUser(userId, viewer?.org_role_id);
  const rules = await getSharingRulesForObject(sfObject);
  return { viewer, viewerGroupIds, rules };
}

async function getUserIdsForOrgRoleIds(orgRoleIds = []) {
  const ids = [...new Set((orgRoleIds || []).filter(Boolean))];
  if (!ids.length) return [];

  const { data, error } = await supabase
    .from('users')
    .select('id')
    .in('org_role_id', ids)
    .eq('is_active', true);

  if (error) {
    console.error('[record-visibility] users for role lookup failed:', error.message);
    return [];
  }
  return (data || []).map(row => row.id).filter(Boolean);
}

async function getHierarchyVisibleOwnerIds(userId, orgRoleId) {
  const ownerIds = new Set([userId].filter(Boolean));
  if (!orgRoleId) return ownerIds;

  const { data: viewerRole, error: viewerRoleError } = await supabase
    .from('org_roles')
    .select('path')
    .eq('id', orgRoleId)
    .eq('is_active', true)
    .maybeSingle();

  if (viewerRoleError || !viewerRole?.path) return ownerIds;

  const { data: roleRows, error: roleError } = await supabase
    .from('org_roles')
    .select('id')
    .like('path', `${viewerRole.path}/%`)
    .eq('is_active', true);

  if (roleError) {
    console.error('[record-visibility] descendant role lookup failed:', roleError.message);
    return ownerIds;
  }

  const descendantRoleIds = (roleRows || []).map(row => row.id).filter(Boolean);
  (await getUserIdsForOrgRoleIds(descendantRoleIds)).forEach(id => ownerIds.add(id));
  return ownerIds;
}

async function getViewerRecordShareIds(sfObject, userId, viewerGroupIds) {
  const groupIds = [...viewerGroupIds];
  const recordIds = new Set();
  const orFilter = `shared_with.eq.${userId}${groupIds.length ? `,shared_with_group.in.(${groupIds.join(',')})` : ''}`;

  const { data, error } = await supabase
    .from('record_shares')
    .select('record_id, expires_at')
    .eq('sf_object', sfObject)
    .or(orFilter);

  if (error) {
    console.error('[record-visibility] viewer record share id lookup failed:', error.message);
    return recordIds;
  }

  const now = Date.now();
  (data || [])
    .filter(share => share.record_id && (!share.expires_at || new Date(share.expires_at).getTime() > now))
    .forEach(share => recordIds.add(share.record_id));
  return recordIds;
}

async function buildReadableRecordScopeFilter(sfObject, user, requestId = 'n/a') {
  const startedAt = performance.now();
  if (!user || isFullAccessUser(user)) return { clause: '', reason: 'admin' };
  const availableFields = await getObjectFieldSet(sfObject);
  if (!availableFields.has(PORTAL_OWNER_FIELD)) return { clause: '', reason: 'no_owner_field' };

  const owdAccess = await getOrgWideDefaultAccess(sfObject);
  if (['public_read', 'public_read_write'].includes(owdAccess)) {
    return { clause: '', reason: owdAccess };
  }

  const context = await buildVisibilityContext(user.id, user.role, sfObject);
  const ownerIds = await getHierarchyVisibleOwnerIds(user.id, context.viewer?.org_role_id);
  const matchedOwnerRoleIds = new Set();
  let unrestrictedBySharingRule = false;

  (context.rules || []).forEach((rule) => {
    const viewerMatches =
      (rule.shared_with_group_id && context.viewerGroupIds.has(rule.shared_with_group_id)) ||
      (rule.shared_with_org_role_id && context.viewer?.org_role_id === rule.shared_with_org_role_id) ||
      (!rule.shared_with_org_role_id && !rule.shared_with_group_id && rule.shared_with_role && user.role === rule.shared_with_role);

    if (!viewerMatches) return;
    if (!rule.owner_org_role_id && !rule.owner_role) {
      unrestrictedBySharingRule = true;
      return;
    }
    if (rule.owner_org_role_id) matchedOwnerRoleIds.add(rule.owner_org_role_id);
  });

  if (unrestrictedBySharingRule) {
    securityPerfLog(requestId, 'scopeFilter', { object: sfObject, reason: 'sharing_any_owner', ms: msSince(startedAt) });
    return { clause: '', reason: 'sharing_any_owner' };
  }

  (await getUserIdsForOrgRoleIds([...matchedOwnerRoleIds])).forEach(id => ownerIds.add(id));
  const sharedRecordIds = await getViewerRecordShareIds(sfObject, user.id, context.viewerGroupIds);

  if (ownerIds.size > 900 || sharedRecordIds.size > 900) {
    securityPerfLog(requestId, 'scopeFilter', {
      object: sfObject,
      reason: 'too_many_ids',
      owners: ownerIds.size,
      shares: sharedRecordIds.size,
      ms: msSince(startedAt)
    });
    return { clause: '', reason: 'too_many_ids' };
  }

  const parts = [];
  if (ownerIds.size) {
    parts.push(`${PORTAL_OWNER_FIELD} IN (${[...ownerIds].map(id => `'${escapeSOQL(id)}'`).join(', ')})`);
  }
  if (sharedRecordIds.size) {
    parts.push(`Id IN (${[...sharedRecordIds].map(id => `'${escapeSOQL(id)}'`).join(', ')})`);
  }

  const clause = parts.length ? `(${parts.join(' OR ')})` : `${PORTAL_OWNER_FIELD} = '${escapeSOQL(user.id)}'`;
  securityPerfLog(requestId, 'scopeFilter', {
    object: sfObject,
    reason: 'owner_scope',
    owners: ownerIds.size,
    shares: sharedRecordIds.size,
    ms: msSince(startedAt)
  });
  return { clause, reason: 'owner_scope' };
}

async function getSharingAccess(record, userId, userRole, sfObject, context = null) {
  const ownerId = getRecordOwnerId(record);
  const ctx = context || await buildVisibilityContext(userId, userRole, sfObject);
  const { viewer, viewerGroupIds, rules } = ctx;
  const owner =
    ctx.ownerContextById?.get(ownerId) ||
    (ownerId ? await getPortalUserRoleContext(ownerId) : null);

  let best = { allowed: false, accessLevel: 'none', via: 'sharing_rule' };
  (rules || []).forEach((rule) => {
    const ownerMatches =
      (!rule.owner_org_role_id && !rule.owner_role) ||
      (rule.owner_org_role_id && owner?.org_role_id === rule.owner_org_role_id) ||
      (!rule.owner_org_role_id && rule.owner_role && owner?.role === rule.owner_role);

    if (!ownerMatches) return;

    const viewerMatches =
      (rule.shared_with_group_id && viewerGroupIds.has(rule.shared_with_group_id)) ||
      (rule.shared_with_org_role_id && viewer?.org_role_id === rule.shared_with_org_role_id) ||
      (!rule.shared_with_org_role_id && !rule.shared_with_group_id && rule.shared_with_role && userRole === rule.shared_with_role);

    if (!viewerMatches) return;

    best = strongestRecordAccess(best, {
      allowed: true,
      accessLevel: rule.access_level === 'edit' ? 'edit' : 'read',
      via: rule.shared_with_group_id ? 'sharing_rule_public_group' : 'sharing_rule'
    });
  });

  const shares =
    ctx.recordSharesById?.get(record?.Id) ||
    await getRecordSharesForViewer(record?.Id, sfObject, userId, viewerGroupIds);

  (shares || []).forEach((share) => {
    const matchedUser = share.shared_with === userId;
    const matchedGroup = share.shared_with_group && viewerGroupIds.has(share.shared_with_group);
    if (!matchedUser && !matchedGroup) return;
    best = strongestRecordAccess(best, {
      allowed: true,
      accessLevel: share.access_level === 'edit' ? 'edit' : 'read',
      via: matchedGroup ? 'manual_public_group' : 'manual'
    });
  });

  return best;
}

async function evaluateRecordAccess(record, userId, userRole, sfObject, isSystemAdmin = false, context = null) {
  if (isSystemAdmin) return { allowed: true, accessLevel: 'edit', via: 'admin' };

  const ownerId = getRecordOwnerId(record);
  const owdAccess = await getOrgWideDefaultAccess(sfObject);
  let access = { allowed: false, accessLevel: 'none', via: 'denied' };

  if (owdAccess === 'public_read_write') {
    return { allowed: true, accessLevel: 'edit', via: 'owd' };
  }

  if (ownerId && ownerId === userId) {
    return { allowed: true, accessLevel: 'edit', via: 'owner' };
  }

  if (ownerId && await canViewerAccessOwnerRole(userId, ownerId)) {
    return { allowed: true, accessLevel: 'edit', via: 'hierarchy' };
  }

  if (owdAccess === 'public_read') {
    access = { allowed: true, accessLevel: 'read', via: 'owd' };
  }

  access = strongestRecordAccess(access, await getSharingAccess(record, userId, userRole, sfObject, context));

  if (!access.allowed && !ownerId) {
    return { allowed: false, accessLevel: 'none', via: 'missing_owner' };
  }

  return access;
}

async function canSeeRecord(record, userId, userRole, sfObject, isSystemAdmin = false) {
  const access = await evaluateRecordAccess(record, userId, userRole, sfObject, isSystemAdmin);
  return access.allowed;
}

async function applyRecordVisibility(records, userId, userRole, sfObject, isSystemAdmin = false, requestId = 'n/a') {
  const startedAt = performance.now();
  if (isSystemAdmin) return records;
  const rows = records || [];
  const context = await buildVisibilityContext(userId, userRole, sfObject);
  const ownerIds = [...new Set(rows.map(getRecordOwnerId).filter(Boolean))];
  context.ownerContextById = new Map();
  await Promise.all(ownerIds.map(async (ownerId) => {
    context.ownerContextById.set(ownerId, await getPortalUserRoleContext(ownerId));
  }));
  context.recordSharesById = await getRecordSharesForViewerBatch(
    rows.map(record => record?.Id).filter(Boolean),
    sfObject,
    userId,
    context.viewerGroupIds
  );

  const decisions = await Promise.all(
    rows.map(async (record) => ({
      record,
      allowed: (await evaluateRecordAccess(record, userId, userRole, sfObject, isSystemAdmin, context)).allowed
    }))
  );
  const visible = decisions.filter(item => item.allowed).map(item => item.record);
  securityPerfLog(requestId, 'applyRecordVisibility', {
    object: sfObject,
    evaluated: rows.length,
    visible: visible.length,
    owners: ownerIds.length,
    groups: context.viewerGroupIds.size,
    rules: context.rules.length,
    ms: msSince(startedAt)
  });
  return visible;
}

async function canEditRecord(record, userId, userRole, sfObject, isSystemAdmin = false) {
  const access = await evaluateRecordAccess(record, userId, userRole, sfObject, isSystemAdmin);
  return access.allowed && access.accessLevel === 'edit';
}

async function filterSearchRecordsByVisibility(searchRecords = [], req) {
  if (req.user?.isSystemAdmin) return searchRecords;

  const grouped = searchRecords.reduce((acc, record) => {
    const objectName = record?.attributes?.type;
    if (!OBJECTS[objectName]) return acc;
    if (!acc[objectName]) acc[objectName] = [];
    acc[objectName].push(record);
    return acc;
  }, {});

  const allowedByKey = new Set();
  await Promise.all(Object.entries(grouped).map(async ([objectName, records]) => {
    const perms = await getEffectivePermissions(req.user.id, objectName);
    if (!perms?.can_read) return;

    const ownedRecords = await hydrateRecordOwners(records, objectName);
    const visibleRecords = await applyRecordVisibility(
      ownedRecords,
      req.user.id,
      req.user.role,
      objectName,
      req.user.isSystemAdmin
    );
    visibleRecords.forEach(record => allowedByKey.add(`${objectName}:${record.Id}`));
  }));

  return searchRecords.filter(record => allowedByKey.has(`${record?.attributes?.type}:${record?.Id}`));
}

async function filterRelatedListsByVisibility(lists = [], req, requestId = 'related') {
  if (req.user?.isSystemAdmin) return lists;

  return Promise.all((lists || []).map(async (list) => {
    if (!OBJECTS[list.objectName]) return list;

    const perms = await getEffectivePermissions(req.user.id, list.objectName);
    if (!perms?.can_read) {
      return { ...list, records: [], totalSize: 0 };
    }

    const ownedRecords = await hydrateRecordOwners(list.records || [], list.objectName);
    const records = await applyRecordVisibility(
      ownedRecords,
      req.user.id,
      req.user.role,
      list.objectName,
      req.user.isSystemAdmin,
      requestId
    );

    return { ...list, records, totalSize: records.length };
  }));
}
// GET org wide defaults
app.get('/api/portal/owd', checkAuth, checkRole('admin'), async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('org_wide_defaults')
      .select('sf_object, access_level, description')
      .order('sf_object');
    if (error) throw error;
    const existingByObject = new Map((data || []).map(row => [row.sf_object, row]));
    const defaults = Object.keys(OBJECTS)
      .filter(objectName => !['Task', 'Event', 'EmailMessage', 'Pricebook2', 'User'].includes(objectName))
      .map(objectName => existingByObject.get(objectName) || {
        sf_object: objectName,
        access_level: 'private',
        description: null
      });
    res.json({ defaults });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PATCH update OWD for one object
app.patch('/api/portal/owd', checkAuth, checkRole('system_administrator'), async (req, res) => {
  const { sfObject, accessLevel } = req.body || {};
  const valid = ['private', 'public_read', 'public_read_write', 'controlled_by_parent'];
  if (!sfObject || !valid.includes(accessLevel)) {
    return res.status(400).json({ error: 'Invalid sfObject or accessLevel' });
  }
  try {
    const { error } = await supabase
      .from('org_wide_defaults')
      .upsert({
        sf_object: sfObject,
        access_level: accessLevel,
        updated_at: new Date().toISOString(),
        updated_by: req.user.id
      }, { onConflict: 'sf_object' });
    if (error) throw error;
    owdCache.delete(sfObject);
    await writeAuditLog({
      userId: req.user.id, userEmail: req.user.email,
      userRole: req.user.role, action: 'edit',
      payload: { type: 'owd_change', sfObject, accessLevel },
      ipAddress: req.ip
    });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});


// POST share a record with another user
app.post('/api/:object/:id/share', checkAuth, async (req, res) => {
  const { object, id } = req.params;
  const { sharedWithUserId, accessLevel = 'read', expiresAt } = req.body || {};

  if (!OBJECTS[object]) return res.status(400).json({ error: 'Unknown object' });
  if (!sharedWithUserId) return res.status(400).json({ error: 'sharedWithUserId required' });
  if (!['read', 'edit'].includes(accessLevel)) {
    return res.status(400).json({ error: 'accessLevel must be read or edit' });
  }

  try {
    // Verify sharer owns this record unless they have System Administrator profile
    if (!req.user.isSystemAdmin) {
      const record = await sfGet(`/sobjects/${object}/${id}?fields=Portal_Owner__c`);
      if (record.Portal_Owner__c !== req.user.id) {
        return res.status(403).json({ error: 'Only the record owner can share this record' });
      }
    }

    const { error } = await supabase
      .from('record_shares')
      .upsert({
        sf_object: object,
        record_id: id,
        shared_by: req.user.id,
        shared_with: sharedWithUserId,
        access_level: accessLevel,
        expires_at: expiresAt || null
      }, { onConflict: 'sf_object,record_id,shared_with' });

    if (error) throw error;
    clearSharingAccessCaches();

    await writeAuditLog({
      userId: req.user.id, userEmail: req.user.email,
      userRole: req.user.role, action: 'edit',
      payload: { type: 'manual_share', object, recordId: id, sharedWithUserId, accessLevel },
      ipAddress: req.ip
    });

    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE remove a manual share
app.delete('/api/:object/:id/share/:userId', checkAuth, async (req, res) => {
  const { object, id, userId } = req.params;
  try {
    await supabase
      .from('record_shares')
      .delete()
      .eq('sf_object', object)
      .eq('record_id', id)
      .eq('shared_with', userId);
    clearSharingAccessCaches();
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET sharing rules
app.get('/api/portal/sharing-rules', checkAuth, checkRole('admin'), async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('sharing_rules')
      .select('*')
      .order('sf_object');
    if (error) throw error;
    res.json({ rules: data || [] });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST create sharing rule
app.post('/api/portal/sharing-rules', checkAuth, checkRole('system_administrator'), async (req, res) => {
  const {
    name,
    sfObject,
    ownerRole,
    sharedWithRole,
    ownerOrgRoleId,
    sharedWithOrgRoleId,
    sharedWithGroupId,
    sharedWithType = sharedWithGroupId ? 'public_group' : 'role',
    accessLevel,
    description
  } = req.body || {};
  const hasShareTarget =
    (sharedWithType === 'public_group' && sharedWithGroupId) ||
    (sharedWithType !== 'public_group' && (sharedWithOrgRoleId || sharedWithRole));

  if (!name || !sfObject || !hasShareTarget || !accessLevel) {
    return res.status(400).json({ error: 'name, sfObject, share target, accessLevel required' });
  }
  try {
    const { data, error } = await supabase
      .from('sharing_rules')
      .insert({
        name, sf_object: sfObject,
        owner_role: ownerRole || null,
        shared_with_role: sharedWithRole || null,
        owner_org_role_id: ownerOrgRoleId || null,
        shared_with_org_role_id: sharedWithType === 'public_group' ? null : (sharedWithOrgRoleId || null),
        shared_with_group_id: sharedWithType === 'public_group' ? sharedWithGroupId : null,
        shared_with_type: sharedWithType === 'public_group' ? 'public_group' : 'role',
        access_level: accessLevel,
        description: description || null,
        created_by: req.user.id
      })
      .select('id').single();
    if (error) throw error;
    clearSharingAccessCaches();
    await writeAuditLog({
      userId: req.user.id, userEmail: req.user.email,
      userRole: req.user.role, action: 'create',
      payload: { type: 'sharing_rule', name, sfObject },
      ipAddress: req.ip
    });
    res.status(201).json({ success: true, id: data.id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PATCH toggle sharing rule active/inactive
app.patch('/api/portal/sharing-rules/:id', checkAuth, checkRole('system_administrator'), async (req, res) => {
  const {
    name,
    sfObject,
    ownerRole,
    sharedWithRole,
    ownerOrgRoleId,
    sharedWithOrgRoleId,
    sharedWithGroupId,
    sharedWithType,
    accessLevel,
    description,
    isActive
  } = req.body || {};

  const updates = {};
  if (name !== undefined) updates.name = String(name || '').trim();
  if (sfObject !== undefined) updates.sf_object = sfObject;
  if (ownerRole !== undefined) updates.owner_role = ownerRole || null;
  if (ownerOrgRoleId !== undefined) updates.owner_org_role_id = ownerOrgRoleId || null;
  if (accessLevel !== undefined) updates.access_level = accessLevel;
  if (description !== undefined) updates.description = description || null;
  if (isActive !== undefined) updates.is_active = Boolean(isActive);

  if (sharedWithType !== undefined || sharedWithOrgRoleId !== undefined || sharedWithGroupId !== undefined || sharedWithRole !== undefined) {
    const targetType = sharedWithType === 'public_group' ? 'public_group' : 'role';
    updates.shared_with_type = targetType;
    updates.shared_with_role = targetType === 'role' ? (sharedWithRole || null) : null;
    updates.shared_with_org_role_id = targetType === 'role' ? (sharedWithOrgRoleId || null) : null;
    updates.shared_with_group_id = targetType === 'public_group' ? (sharedWithGroupId || null) : null;
  }

  if (updates.name !== undefined && !updates.name) {
    return res.status(400).json({ error: 'Rule name is required' });
  }
  if (updates.access_level !== undefined && !['read', 'edit'].includes(updates.access_level)) {
    return res.status(400).json({ error: 'Access level must be read or edit' });
  }
  if (updates.shared_with_type === 'public_group' && !updates.shared_with_group_id) {
    return res.status(400).json({ error: 'Public group target is required' });
  }
  if (updates.shared_with_type === 'role' && !updates.shared_with_org_role_id && !updates.shared_with_role) {
    return res.status(400).json({ error: 'Role target is required' });
  }
  if (!Object.keys(updates).length) {
    return res.status(400).json({ error: 'No sharing rule changes provided' });
  }

  try {
    const { error } = await supabase
      .from('sharing_rules')
      .update(updates)
      .eq('id', req.params.id);
    if (error) throw error;
    clearSharingAccessCaches();
    await writeAuditLog({
      userId: req.user.id,
      userEmail: req.user.email,
      userRole: req.user.role,
      action: 'update',
      payload: { type: 'sharing_rule', id: req.params.id, fields: Object.keys(updates) },
      ipAddress: req.ip
    });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// DELETE sharing rule
app.delete('/api/portal/sharing-rules/:id', checkAuth, checkRole('system_administrator'), async (req, res) => {
  try {
    await supabase.from('sharing_rules').delete().eq('id', req.params.id);
    clearSharingAccessCaches();
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});



// ── PERMISSION SET GROUPS ─────────────────────────────────────

// GET all groups
app.get('/api/portal/permission-set-groups', checkAuth, checkRole('admin'), async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('permission_set_groups')
      .select(`
        id, name, description, is_active, created_at,
        permission_set_group_members (
          perm_set_id,
          permission_sets ( id, name )
        ),
        permission_set_group_muting (
          id, sf_object, field_name, muted_perm
        )
      `)
      .order('name');
    if (error) throw error;
    res.json({ groups: data || [] });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET groups assigned to a user
app.get('/api/portal/users/:id/permission-set-groups', checkAuth, checkRole('admin'), async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('user_permission_set_group_assignments')
      .select('group_id, permission_set_groups(id, name, description)')
      .eq('user_id', req.params.id);
    if (error) throw error;
    res.json({ groups: (data || []).map(r => r.permission_set_groups).filter(Boolean) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/portal/users/:id/effective-permissions/:object', checkAuth, checkRole('admin'), async (req, res) => {
  try {
    const permissions = await getEffectivePermissions(req.params.id, req.params.object);
    res.json({ userId: req.params.id, object: req.params.object, permissions });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST create group
app.post('/api/portal/permission-set-groups', checkAuth, checkRole('admin'), async (req, res) => {
  const { name, description, permSetIds = [], mutings = [] } = req.body || {};
  if (!name) return res.status(400).json({ error: 'Name is required' });
  try {
    const { data: group, error } = await supabase
      .from('permission_set_groups')
      .insert({ name: name.trim(), description: description?.trim() || null, created_by: req.user.id })
      .select('id').single();
    if (error) throw error;

    // Add member permission sets
    if (permSetIds.length) {
      await supabase.from('permission_set_group_members').insert(
        permSetIds.map(psId => ({ group_id: group.id, perm_set_id: psId }))
      );
    }

    // Add mutings
    if (mutings.length) {
      await supabase.from('permission_set_group_muting').insert(
        mutings.map(m => ({
          group_id: group.id,
          sf_object: m.sfObject,
          field_name: m.fieldName || null,
          muted_perm: m.mutedPerm
        }))
      );
    }

    await writeAuditLog({
      userId: req.user.id, userEmail: req.user.email,
      userRole: req.user.role, action: 'create',
      payload: { type: 'permission_set_group', name },
      ipAddress: req.ip
    });

    clearAllFieldPermCache();
    res.status(201).json({ success: true, id: group.id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PATCH update group
app.patch('/api/portal/permission-set-groups/:id', checkAuth, checkRole('admin'), async (req, res) => {
  const { name, description, isActive, permSetIds, mutings } = req.body || {};
  try {
    const updates = {};
    if (name !== undefined) updates.name = name;
    if (description !== undefined) updates.description = description;
    if (isActive !== undefined) updates.is_active = isActive;
    if (Object.keys(updates).length) {
      updates.updated_at = new Date().toISOString();
      await supabase.from('permission_set_groups').update(updates).eq('id', req.params.id);
    }

    // Sync member perm sets
    if (Array.isArray(permSetIds)) {
      await supabase.from('permission_set_group_members').delete().eq('group_id', req.params.id);
      if (permSetIds.length) {
        await supabase.from('permission_set_group_members').insert(
          permSetIds.map(psId => ({ group_id: req.params.id, perm_set_id: psId }))
        );
      }
    }

    // Sync mutings
    if (Array.isArray(mutings)) {
      await supabase.from('permission_set_group_muting').delete().eq('group_id', req.params.id);
      if (mutings.length) {
        await supabase.from('permission_set_group_muting').insert(
          mutings.map(m => ({
            group_id: req.params.id,
            sf_object: m.sfObject,
            field_name: m.fieldName || null,
            muted_perm: m.mutedPerm
          }))
        );
      }
    }

    clearAllFieldPermCache();
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// DELETE group
app.delete('/api/portal/permission-set-groups/:id', checkAuth, checkRole('admin'), async (req, res) => {
  try {
    await supabase.from('user_permission_set_group_assignments').delete().eq('group_id', req.params.id);
    await supabase.from('permission_set_group_members').delete().eq('group_id', req.params.id);
    await supabase.from('permission_set_group_muting').delete().eq('group_id', req.params.id);
    await supabase.from('permission_set_groups').delete().eq('id', req.params.id);
    clearAllFieldPermCache();
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST assign group to user
app.post('/api/portal/users/:id/permission-set-groups', checkAuth, checkRole('admin'), async (req, res) => {
  const { groupId } = req.body || {};
  if (!groupId) return res.status(400).json({ error: 'groupId required' });
  try {
    await supabase.from('user_permission_set_group_assignments').upsert({
      user_id: req.params.id,
      group_id: groupId,
      assigned_by: req.user.id
    }, { onConflict: 'user_id,group_id' });
    clearFieldPermCache(req.params.id);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// DELETE remove group from user
app.delete('/api/portal/users/:id/permission-set-groups/:groupId', checkAuth, checkRole('admin'), async (req, res) => {
  try {
    await supabase
      .from('user_permission_set_group_assignments')
      .delete()
      .eq('user_id', req.params.id)
      .eq('group_id', req.params.groupId);
    clearFieldPermCache(req.params.id);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});


// ================================================================
// ORG ROLE HIERARCHY ROUTES — Add to server.js
// Place after your permission-set-groups routes
// ================================================================

// GET full role tree
app.get('/api/portal/org-roles', checkAuth, checkRole('admin'), async (req, res) => {
  try {
    const { data, error } = await supabase.rpc('get_org_role_tree');
    if (error) throw error;
    res.json({ roles: data || [] });
  } catch(e) {
    console.error('GET org-roles error:', e.message);
    res.status(500).json({ error: e.message });
  }
});
// POST create role
app.post('/api/portal/org-roles', checkAuth, checkRole('system_administrator'), async (req, res) => {
  const {
    name,
    description,
    parentId,
    reportName,
    opportunityAccess = 'edit'
  } = req.body || {};

  if (!name?.trim()) {
    return res.status(400).json({ error: 'Label is required' });
  }

  // Auto-generate API name (Salesforce style)
  const apiName = name.trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

  try {
    const newId = crypto.randomUUID();

    let level = 1;
    let path = newId;

    if (parentId) {
      const { data: parent } = await supabase
        .from('org_roles')
        .select('level, path')
        .eq('id', parentId)
        .single();

      if (parent) {
        level = parent.level + 1;
        path = `${parent.path}/${newId}`;
      }
    }

    const { data: role, error } = await supabase
      .from('org_roles')
      .insert({
        id: newId,
        name: name.trim(),
        api_name: apiName,
        description: description?.trim() || null,
        report_name: reportName?.trim() || name.trim(),
        opportunity_access: opportunityAccess,
        parent_id: parentId || null,
        level,
        path,
        created_by: req.user.id
      })
      .select('id, name, api_name, level, path')
      .single();

    roleVisibilityCache.clear();
    clearSharingAccessCaches();

    if (error) {
      if (error.code === '23505') {
        return res.status(409).json({
          error: 'A role with this name already exists'
        });
      }
      throw error;
    }

    await writeAuditLog({
      userId: req.user.id,
      userEmail: req.user.email,
      userRole: req.user.role,
      action: 'create',
      payload: {
        type: 'org_role',
        name,
        apiName,
        parentId
      },
      ipAddress: req.ip
    });

    res.status(201).json({
      success: true,
      role
    });

  } catch (e) {
    console.error('POST org-roles error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// PATCH update role name/description only
// Note: we don't allow moving a role to a different parent
// (would require recomputing paths for all descendants — complex)
// Instead: delete and recreate if you need to move a role
// PATCH update role
app.patch('/api/portal/org-roles/:id', checkAuth, checkRole('system_administrator'), async (req, res) => {
  const {
    name,
    description,
    reportName,
    opportunityAccess,
    isActive
  } = req.body || {};

  if (!name?.trim()) {
    return res.status(400).json({ error: 'Label is required' });
  }

  try {
    const updates = {
      name: name.trim(),
      description: description?.trim() || null,
      report_name: reportName?.trim() || name.trim(),
      updated_at: new Date().toISOString()
    };

    // NEW: Opportunity access
    if (opportunityAccess !== undefined) {
      updates.opportunity_access = opportunityAccess;
    }

    // Existing active/inactive support
    if (isActive !== undefined) {
      updates.is_active = isActive;
    }

    const { error } = await supabase
      .from('org_roles')
      .update(updates)
      .eq('id', req.params.id);

    if (error) throw error;

    roleVisibilityCache.clear();
    clearSharingAccessCaches();

    await writeAuditLog({
      userId: req.user.id,
      userEmail: req.user.email,
      userRole: req.user.role,
      action: 'edit',
      payload: {
        type: 'org_role',
        id: req.params.id,
        name,
        reportName,
        opportunityAccess,
        isActive
      },
      ipAddress: req.ip
    });

    res.json({ success: true });

  } catch (e) {
    console.error('PATCH org-roles error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// DELETE role — only if no users assigned and no children
app.delete('/api/portal/org-roles/:id', checkAuth, checkRole('system_administrator'), async (req, res) => {
  try {
    // Check users assigned
    const { count: userCount } = await supabase
      .from('users')
      .select('*', { count: 'exact', head: true })
      .eq('org_role_id', req.params.id);

    if (userCount > 0) {
      return res.status(409).json({
        error: `Cannot delete — ${userCount} user(s) assigned to this role. Reassign them first.`
      });
    }

    // Check for child roles
    const { count: childCount } = await supabase
      .from('org_roles')
      .select('*', { count: 'exact', head: true })
      .eq('parent_id', req.params.id);

    if (childCount > 0) {
      return res.status(409).json({
        error: `Cannot delete — this role has ${childCount} child role(s). Delete or move them first.`
      });
    }

    const { error } = await supabase
      .from('org_roles')
      .delete()
      .eq('id', req.params.id);

    if (error) throw error;

    roleVisibilityCache.clear();
    clearSharingAccessCaches();

    res.json({ success: true });
  } catch(e) {
    console.error('DELETE org-roles error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// PATCH assign org role to a user
app.patch('/api/portal/users/:id/org-role', checkAuth, checkRole('admin'), async (req, res) => {
  const { orgRoleId } = req.body || {};
  try {
    const { error } = await supabase
      .from('users')
      .update({ org_role_id: orgRoleId || null })
      .eq('id', req.params.id);

    if (error) throw error;

    roleVisibilityCache.clear();

    await writeAuditLog({
      userId:    req.user.id,
      userEmail: req.user.email,
      userRole:  req.user.role,
      action:    'update_user',
      payload:   { type: 'org_role_assignment', targetUserId: req.params.id, orgRoleId },
      ipAddress: req.ip
    });

    res.json({ success: true });
  } catch(e) {
    console.error('PATCH user org-role error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ══ PUBLIC GROUPS ═════════════════════════════════════════════

// GET all groups
app.get('/api/portal/public-groups', checkAuth, checkRole('admin'), async (req, res) => {
  try {
    const { data: groups, error } = await supabase
      .from('public_groups')
      .select('id, name, description, is_active, created_at')
      .order('name');
    if (error) throw error;

    // Get member counts separately (avoids FK ambiguity)
    const enriched = await Promise.all((groups || []).map(async g => {
      const { count: userCount } = await supabase
        .from('public_group_members')
        .select('*', { count: 'exact', head: true })
        .eq('group_id', g.id)
        .eq('member_type', 'user');

      const { count: roleCount } = await supabase
        .from('public_group_members')
        .select('*', { count: 'exact', head: true })
        .eq('group_id', g.id)
        .eq('member_type', 'role');

      return { ...g, user_count: userCount || 0, role_count: roleCount || 0 };
    }));

    res.json({ groups: enriched });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// GET group members
app.get('/api/portal/public-groups/:id/members', checkAuth, checkRole('admin'), async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('public_group_members')
      .select('id, member_type, user_id, org_role_id')
      .eq('group_id', req.params.id);
    if (error) throw error;

    // Enrich with names
    const enriched = await Promise.all((data || []).map(async m => {
      if (m.member_type === 'user' && m.user_id) {
        const { data: u } = await supabase
          .from('users').select('id, name, email').eq('id', m.user_id).single();
        return { ...m, label: u?.name || m.user_id, sublabel: u?.email || '' };
      }
      if (m.member_type === 'role' && m.org_role_id) {
        const { data: r } = await supabase
          .from('org_roles').select('id, name').eq('id', m.org_role_id).single();
        return { ...m, label: r?.name || m.org_role_id, sublabel: 'Role (all users in this role)' };
      }
      return m;
    }));

    res.json({ members: enriched });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// POST create group
app.post('/api/portal/public-groups', checkAuth, checkRole('admin'), async (req, res) => {
  const { name, description } = req.body || {};
  if (!name?.trim()) return res.status(400).json({ error: 'Group name is required' });
  try {
    const { data, error } = await supabase
      .from('public_groups')
      .insert({ name: name.trim(), description: description?.trim() || null, created_by: req.user.id })
      .select('id').single();
    if (error) {
      if (error.code === '23505') return res.status(409).json({ error: 'A group with this name already exists' });
      throw error;
    }
    clearSharingAccessCaches();
    res.status(201).json({ success: true, id: data.id });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// PATCH update group
app.patch('/api/portal/public-groups/:id', checkAuth, checkRole('admin'), async (req, res) => {
  const { name, description, isActive } = req.body || {};
  try {
    const updates = { updated_at: new Date().toISOString() };
    if (name        !== undefined) updates.name        = name;
    if (description !== undefined) updates.description = description;
    if (isActive    !== undefined) updates.is_active   = isActive;
    await supabase.from('public_groups').update(updates).eq('id', req.params.id);
    clearSharingAccessCaches();
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// POST add member to group
app.post('/api/portal/public-groups/:id/members', checkAuth, checkRole('admin'), async (req, res) => {
  const { memberType, userId, orgRoleId } = req.body || {};
  if (!memberType || (memberType === 'user' && !userId) || (memberType === 'role' && !orgRoleId)) {
    return res.status(400).json({ error: 'memberType and userId or orgRoleId required' });
  }
  try {
    const insert = {
      group_id:     req.params.id,
      member_type:  memberType,
      user_id:      memberType === 'user'  ? userId     : null,
      org_role_id:  memberType === 'role'  ? orgRoleId  : null,
      added_by:     req.user.id
    };
    const { error } = await supabase.from('public_group_members').insert(insert);
    if (error) {
      if (error.code === '23505') return res.status(409).json({ error: 'Already a member of this group' });
      throw error;
    }
    clearSharingAccessCaches();
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// DELETE remove member from group
app.delete('/api/portal/public-groups/:id/members/:memberId', checkAuth, checkRole('admin'), async (req, res) => {
  try {
    await supabase.from('public_group_members')
      .delete().eq('id', req.params.memberId).eq('group_id', req.params.id);
    clearSharingAccessCaches();
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// DELETE group
app.delete('/api/portal/public-groups/:id', checkAuth, checkRole('admin'), async (req, res) => {
  try {
    await supabase.from('public_group_members').delete().eq('group_id', req.params.id);
    await supabase.from('public_groups').delete().eq('id', req.params.id);
    clearSharingAccessCaches();
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});


// ══ TEAMS ════════════════════════════════════════════════════

// ══ QUEUES ═══════════════════════════════════════════════════




function rejectReservedApiObject(req, res, next, objectName) {
  if (RESERVED_API_OBJECT_NAMES.has(String(objectName || '').toLowerCase())) {
    return res.status(404).json({ error: `No API route found for /api/${objectName}` });
  }
  next();
}

app.param('object', rejectReservedApiObject);


const PORT = process.env.PORT || 3000;

// ─── Salesforce Config ────────────────────────────────────────
const SF = {
  clientId: process.env.SF_CLIENT_ID,
  clientSecret: process.env.SF_CLIENT_SECRET,
  refreshToken: process.env.SF_REFRESH_TOKEN,
  instanceUrl: normalizeUrl(process.env.SF_INSTANCE_URL),
  loginUrl: normalizeUrl(process.env.SF_LOGIN_URL || 'https://login.salesforce.com'),
  redirectUri: process.env.SF_REDIRECT_URI || `http://localhost:${PORT}/oauth/callback`,
  version: 'v59.0'
};

const DEFAULT_ORG_KEY = 'default';
const ORGS_PATH = process.env.SF_ORGS_PATH || path.join(__dirname, 'sf-orgs.local.json');
let orgStore = loadOrgStore();
applyActiveOrg();

function normalizeUrl(url) {
  return url ? url.replace(/\/+$/, '') : url;
}

function isLocalUrl(url = '') {
  return /^https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?(?:\/|$)/i.test(String(url || ''));
}

function requestBaseUrl(req) {
  const configured = normalizeUrl(process.env.PUBLIC_BASE_URL || process.env.APP_BASE_URL || process.env.RENDER_EXTERNAL_URL || '');
  if (configured) return configured;
  if (req?.get) return `${req.protocol}://${req.get('host')}`;
  return `http://localhost:${PORT}`;
}

function requestRedirectUri(req, org = activeOrg()) {
  if (process.env.SF_REDIRECT_URI) return process.env.SF_REDIRECT_URI;
  if (org?.redirectUri && !isLocalUrl(org.redirectUri)) return org.redirectUri;
  return `${requestBaseUrl(req)}/oauth/callback`;
}

function sanitizeOrgKey(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

function envOrgConfig() {
  return {
    key: DEFAULT_ORG_KEY,
    label: process.env.SF_ORG_LABEL || 'Default Org',
    environment: process.env.SF_ENVIRONMENT || (String(process.env.SF_LOGIN_URL || '').includes('test.salesforce.com') ? 'sandbox' : 'production'),
    clientId: process.env.SF_CLIENT_ID || '',
    clientSecret: process.env.SF_CLIENT_SECRET || '',
    refreshToken: process.env.SF_REFRESH_TOKEN || '',
    instanceUrl: normalizeUrl(process.env.SF_INSTANCE_URL || ''),
    loginUrl: normalizeUrl(process.env.SF_LOGIN_URL || 'https://login.salesforce.com'),
    redirectUri: process.env.SF_REDIRECT_URI || `http://localhost:${PORT}/oauth/callback`
  };
}

function loadOrgStore() {
  let parsed = null;
  if (fs.existsSync(ORGS_PATH)) {
    try {
      parsed = JSON.parse(fs.readFileSync(ORGS_PATH, 'utf8'));
    } catch (err) {
      console.error('Could not read sf-orgs.local.json:', err.message);
    }
  }

  const envOrg = envOrgConfig();
  const store = parsed && typeof parsed === 'object'
    ? { activeOrgKey: sanitizeOrgKey(parsed.activeOrgKey) || DEFAULT_ORG_KEY, orgs: parsed.orgs || {} }
    : { activeOrgKey: DEFAULT_ORG_KEY, orgs: {} };

  store.orgs[DEFAULT_ORG_KEY] = {
    ...envOrg,
    ...(store.orgs[DEFAULT_ORG_KEY] || {}),
    key: DEFAULT_ORG_KEY,
    clientId: (store.orgs[DEFAULT_ORG_KEY]?.clientId || envOrg.clientId),
    clientSecret: (store.orgs[DEFAULT_ORG_KEY]?.clientSecret || envOrg.clientSecret),
    refreshToken: (store.orgs[DEFAULT_ORG_KEY]?.refreshToken || envOrg.refreshToken),
    instanceUrl: normalizeUrl(store.orgs[DEFAULT_ORG_KEY]?.instanceUrl || envOrg.instanceUrl),
    loginUrl: normalizeUrl(store.orgs[DEFAULT_ORG_KEY]?.loginUrl || envOrg.loginUrl),
    redirectUri: store.orgs[DEFAULT_ORG_KEY]?.redirectUri || envOrg.redirectUri
  };

  if (!store.orgs[store.activeOrgKey]) store.activeOrgKey = DEFAULT_ORG_KEY;
  return store;
}

function saveOrgStore() {
  fs.mkdirSync(path.dirname(ORGS_PATH), { recursive: true });
  fs.writeFileSync(ORGS_PATH, `${JSON.stringify(orgStore, null, 2)}\n`);
}

function activeOrg() {
  return orgStore.orgs[orgStore.activeOrgKey] || orgStore.orgs[DEFAULT_ORG_KEY];
}

function applyActiveOrg() {
  const org = activeOrg();
  SF.clientId = org.clientId || '';
  SF.clientSecret = org.clientSecret || '';
  SF.refreshToken = org.refreshToken || '';
  SF.instanceUrl = normalizeUrl(org.instanceUrl || '');
  SF.loginUrl = normalizeUrl(org.loginUrl || 'https://login.salesforce.com');
  SF.redirectUri = org.redirectUri || process.env.SF_REDIRECT_URI || `http://localhost:${PORT}/oauth/callback`;
  SF.version = SF.version || 'v59.0';
}

function switchActiveOrg(key) {
  const orgKey = sanitizeOrgKey(key);
  if (!orgStore.orgs[orgKey]) throw new Error(`Unknown Salesforce org: ${key}`);
  orgStore.activeOrgKey = orgKey;
  applyActiveOrg();
  _cachedToken = null;
  _tokenExpires = 0;
  describeFieldCache.clear();
  saveOrgStore();
  return activeOrg();
}

function publicOrg(org) {
  return {
    key: org.key,
    label: org.label || org.key,
    environment: org.environment || 'production',
    loginUrl: org.loginUrl,
    instanceUrl: org.instanceUrl,
    redirectUri: org.redirectUri,
    hasClientId: Boolean(org.clientId),
    hasClientSecret: Boolean(org.clientSecret),
    hasRefreshToken: Boolean(org.refreshToken),
    isActive: org.key === orgStore.activeOrgKey
  };
}

function persistActiveOrgTokens() {
  const org = activeOrg();
  org.refreshToken = SF.refreshToken || '';
  org.instanceUrl = SF.instanceUrl || org.instanceUrl || '';
  org.loginUrl = SF.loginUrl || org.loginUrl || 'https://login.salesforce.com';
  org.redirectUri = SF.redirectUri || org.redirectUri;
  saveOrgStore();

  if (org.key === DEFAULT_ORG_KEY) {
    upsertEnv({
      SF_REFRESH_TOKEN: org.refreshToken,
      SF_INSTANCE_URL: org.instanceUrl,
      SF_REDIRECT_URI: org.redirectUri
    });
  }
}

function validateConfig() {
  const missing = Object.entries({
    SF_CLIENT_ID: SF.clientId,
    SF_CLIENT_SECRET: SF.clientSecret,
    SF_INSTANCE_URL: SF.instanceUrl,
    SF_LOGIN_URL: SF.loginUrl
  })
    .filter(([, value]) => !value)
    .map(([key]) => key);

  if (missing.length) {
    throw new Error(`Missing required .env value(s): ${missing.join(', ')}`);
  }

  if (!SF.refreshToken) {
    throw new Error('No refresh token found. Open /auth/salesforce to connect Salesforce.');
  }
}

function upsertEnv(values) {
  const envPath = path.join(__dirname, '.env');
  const existing = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
  let next = existing;

  for (const [key, value] of Object.entries(values)) {
    const line = `${key}=${value}`;
    const pattern = new RegExp(`^${key}=.*$`, 'm');
    next = pattern.test(next)
      ? next.replace(pattern, line)
      : `${next.replace(/\s*$/, '')}\n${line}\n`;
  }

  fs.writeFileSync(envPath, next);
}

async function sfAuthedRequest(method, url, data, config = {}) {
  const token = await getAccessToken();
  const res = await axios({
    method,
    url,
    data,
    ...config,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(config.headers || {})
    }
  });
  return res.data;
}

async function sfAuthedRawRequest(method, url, data, config = {}) {
  const token = await getAccessToken();
  return axios({
    method,
    url,
    data,
    ...config,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(config.headers || {})
    }
  });
}

// ─── Token Cache ──────────────────────────────────────────────
let _cachedToken = null;
let _tokenExpires = 0;
const oauthStates = new Map();
const describeFieldCache = new Map();

function base64Url(buffer) {
  return buffer
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function createPkcePair() {
  const verifier = base64Url(crypto.randomBytes(32));
  const challenge = base64Url(crypto.createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

async function getAccessToken() {
  if (_cachedToken && Date.now() < _tokenExpires) return _cachedToken;
  validateConfig();

  const params = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: SF.clientId,
    client_secret: SF.clientSecret,
    refresh_token: SF.refreshToken
  });

  try {
    const res = await axios.post(
      `${SF.loginUrl}/services/oauth2/token`,
      params.toString(),
      {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        timeout: 30000
      }
    );
    _cachedToken = res.data.access_token;
    SF.instanceUrl = normalizeUrl(res.data.instance_url || SF.instanceUrl);
    _tokenExpires = Date.now() + 55 * 60 * 1000; // 55 min cache
    return _cachedToken;
  } catch (err) {
    const detail = err.response?.data;
    console.error('❌ Token error:', detail || err.message);
    const code = detail?.error ? `${detail.error}: ` : '';
    throw new Error(`${code}${detail?.error_description || err.message || 'OAuth token refresh failed'}`);
  }
}

// ─── Axios Helpers ────────────────────────────────────────────
const baseUrl = () => `${SF.instanceUrl}/services/data/${SF.version}`;

async function sfGet(endpoint, params = {}, config = {}) {
  const token = await getAccessToken();
  const maxAttempts = config.retry === false ? 1 : 3;
  let lastErr;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const res = await axios.get(`${baseUrl()}${endpoint}`, {
        timeout: config.timeout || 30000,
        headers: { Authorization: `Bearer ${token}` },
        params,
        ...config,
        headers: {
          Authorization: `Bearer ${token}`,
          ...(config.headers || {})
        }
      });
      return res.data;
    } catch (err) {
      lastErr = err;
      if (!isTransientSalesforceNetworkError(err) || attempt === maxAttempts) break;
      await sleep(250 * attempt);
    }
  }
  throw lastErr;
}

function isTransientSalesforceNetworkError(err) {
  return ['ECONNRESET', 'ETIMEDOUT', 'ECONNABORTED', 'EAI_AGAIN'].includes(err?.code) ||
    /socket hang up|network socket disconnected|read ECONNRESET/i.test(err?.message || '');
}

async function sfPost(endpoint, body) {
  const token = await getAccessToken();
  const res = await axios.post(`${baseUrl()}${endpoint}`, body, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
  });
  return res.data;
}

async function sfPatch(endpoint, body, config = {}) {
  const token = await getAccessToken();
  const res = await axios.patch(`${baseUrl()}${endpoint}`, body, {
    ...config,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(config.headers || {})
    }
  });
  return res.data;
}

async function sfDelete(endpoint) {
  const token = await getAccessToken();
  await axios.delete(`${baseUrl()}${endpoint}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function bulkUrl(endpoint) {
  return `${baseUrl()}${endpoint}`;
}

function flattenRecord(record = {}) {
  const flat = {};
  for (const [key, value] of Object.entries(record)) {
    if (key === 'attributes') continue;
    flat[key] = value;
  }
  return flat;
}

function csvEscape(value) {
  if (value === null || value === undefined) return '';
  const text = value instanceof Date ? value.toISOString() : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function recordsToCsv(records = []) {
  const rows = records.map(flattenRecord);
  const fieldSet = new Set();
  rows.forEach((row) => Object.keys(row).forEach((key) => fieldSet.add(key)));
  const fields = [...fieldSet];
  if (!fields.length) throw new Error('Bulk jobs require at least one field');

  return [
    fields.map(csvEscape).join(','),
    ...rows.map((row) => fields.map((field) => csvEscape(row[field])).join(','))
  ].join('\n');
}

function parseCsv(text = '') {
  const rows = [];
  let row = [];
  let value = '';
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];

    if (quoted) {
      if (char === '"' && next === '"') {
        value += '"';
        i += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        value += char;
      }
      continue;
    }

    if (char === '"') quoted = true;
    else if (char === ',') {
      row.push(value);
      value = '';
    } else if (char === '\n') {
      row.push(value);
      rows.push(row);
      row = [];
      value = '';
    } else if (char !== '\r') {
      value += char;
    }
  }

  if (value || row.length) {
    row.push(value);
    rows.push(row);
  }

  if (!rows.length) return [];
  const headers = rows.shift();
  return rows
    .filter((item) => item.some((cell) => cell !== ''))
    .map((item) => headers.reduce((record, header, index) => {
      record[header] = item[index] ?? '';
      return record;
    }, {}));
}

function normalizeBulkSoql(soql) {
  const compact = String(soql || '').replace(/\s+/g, ' ').trim();
  if (!/^SELECT\s+/i.test(compact)) throw new Error('Bulk query requires a SELECT SOQL statement');
  if (/\bCOUNT\s*\(/i.test(compact) || /\b(GROUP\s+BY|OFFSET|TYPEOF)\b/i.test(compact)) {
    throw new Error('Bulk API 2.0 query does not support COUNT(), GROUP BY, OFFSET, or TYPEOF');
  }
  if (/\(\s*SELECT\s+/i.test(compact)) {
    throw new Error('Bulk API 2.0 query does not support parent-to-child subqueries');
  }
  return compact;
}

async function buildBulkSOQL(objectName, search, extraWhere) {
  const cfg = OBJECTS[objectName];
  const availableFields = await getObjectFieldSet(objectName);
  let soql = `SELECT ${await fieldsCsvForObject(objectName)} FROM ${objectName}`;
  soql += buildWhereClause(objectName, search, extraWhere, availableFields);
  return normalizeBulkSoql(soql);
}

async function createBulkQueryJob(soql) {
  return sfAuthedRequest('post', bulkUrl('/jobs/query'), {
    operation: 'query',
    query: normalizeBulkSoql(soql),
    contentType: 'CSV',
    columnDelimiter: 'COMMA',
    lineEnding: 'LF'
  }, {
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    timeout: 30000
  });
}

async function getBulkQueryJob(jobId) {
  return sfAuthedRequest('get', bulkUrl(`/jobs/query/${encodeURIComponent(jobId)}`), null, {
    headers: { Accept: 'application/json' },
    timeout: 30000
  });
}

async function pollBulkQueryJob(jobId, maxWaitMs = BULK_MAX_POLL_MS) {
  const started = Date.now();
  let job = await getBulkQueryJob(jobId);
  while (['UploadComplete', 'InProgress'].includes(job.state) && Date.now() - started < maxWaitMs) {
    await sleep(BULK_POLL_INTERVAL_MS);
    job = await getBulkQueryJob(jobId);
  }
  return job;
}

async function getBulkQueryResults(jobId, { locator, maxRecords = BULK_QUERY_PAGE_SIZE } = {}) {
  const params = { maxRecords };
  if (locator) params.locator = locator;
  const res = await sfAuthedRawRequest(
    'get',
    bulkUrl(`/jobs/query/${encodeURIComponent(jobId)}/results`),
    null,
    {
      params,
      responseType: 'text',
      headers: { Accept: 'text/csv', 'Accept-Encoding': 'gzip' },
      timeout: 120000
    }
  );
  const nextLocator = res.headers['sforce-locator'];
  return {
    csv: res.data || '',
    records: parseCsv(res.data || ''),
    locator: nextLocator && nextLocator !== 'null' ? nextLocator : null,
    numberOfRecords: Number(res.headers['sforce-numberofrecords'] || 0)
  };
}

async function createBulkIngestJob(object, operation, options = {}) {
  const body = {
    object,
    operation,
    contentType: 'CSV',
    lineEnding: 'LF',
    columnDelimiter: 'COMMA'
  };
  if (operation === 'upsert') {
    if (!options.externalIdFieldName) throw new Error('Upsert requires externalIdFieldName');
    body.externalIdFieldName = options.externalIdFieldName;
  }
  return sfAuthedRequest('post', bulkUrl('/jobs/ingest'), body, {
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    timeout: 30000
  });
}

async function uploadBulkIngestData(jobId, csv) {
  await sfAuthedRequest(
    'put',
    bulkUrl(`/jobs/ingest/${encodeURIComponent(jobId)}/batches`),
    csv,
    {
      headers: { 'Content-Type': 'text/csv', Accept: 'application/json' },
      maxBodyLength: Infinity,
      timeout: 120000
    }
  );
}

async function closeBulkIngestJob(jobId) {
  return sfAuthedRequest('patch', bulkUrl(`/jobs/ingest/${encodeURIComponent(jobId)}`), {
    state: 'UploadComplete'
  }, {
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    timeout: 30000
  });
}

async function getBulkIngestJob(jobId) {
  return sfAuthedRequest('get', bulkUrl(`/jobs/ingest/${encodeURIComponent(jobId)}`), null, {
    headers: { Accept: 'application/json' },
    timeout: 30000
  });
}

async function pollBulkIngestJob(jobId, maxWaitMs = BULK_MAX_POLL_MS) {
  const started = Date.now();
  let job = await getBulkIngestJob(jobId);
  while (['Open', 'UploadComplete', 'InProgress'].includes(job.state) && Date.now() - started < maxWaitMs) {
    await sleep(BULK_POLL_INTERVAL_MS);
    job = await getBulkIngestJob(jobId);
  }
  return job;
}

async function getBulkIngestResultCsv(jobId, resultType) {
  const res = await sfAuthedRawRequest(
    'get',
    bulkUrl(`/jobs/ingest/${encodeURIComponent(jobId)}/${resultType}`),
    null,
    {
      responseType: 'text',
      headers: { Accept: 'text/csv' },
      timeout: 120000
    }
  );
  return res.data || '';
}

async function runBulkIngest(object, operation, records, options = {}) {
  const cleanRecords = (records || []).map(flattenRecord);
  if (!cleanRecords.length) throw new Error('Bulk ingest requires at least one record');
  if (['update', 'delete'].includes(operation) && cleanRecords.some((record) => !record.Id)) {
    throw new Error(`${operation} jobs require Id on every record`);
  }

  const csv = operation === 'delete'
    ? recordsToCsv(cleanRecords.map((record) => ({ Id: record.Id })))
    : recordsToCsv(cleanRecords);
  const job = await createBulkIngestJob(object, operation, options);
  await uploadBulkIngestData(job.id, csv);
  await closeBulkIngestJob(job.id);

  const finalJob = options.wait === false ? await getBulkIngestJob(job.id) : await pollBulkIngestJob(job.id, options.maxWaitMs);
  const response = { success: finalJob.state === 'JobComplete', job: finalJob };

  if (['JobComplete', 'Failed', 'Aborted'].includes(finalJob.state) && options.includeResults !== false) {
    const [successfulCsv, failedCsv, unprocessedCsv] = await Promise.all([
      getBulkIngestResultCsv(job.id, 'successfulResults').catch(() => ''),
      getBulkIngestResultCsv(job.id, 'failedResults').catch(() => ''),
      getBulkIngestResultCsv(job.id, 'unprocessedrecords').catch(() => '')
    ]);
    response.results = {
      successful: parseCsv(successfulCsv),
      failed: parseCsv(failedCsv),
      unprocessed: parseCsv(unprocessedCsv)
    };
  }

  return response;
}

// ─── Object Definitions ───────────────────────────────────────
const OBJECTS = {
  Account: {
    fields: 'Id, Name, Type, Industry, Phone, Website, BillingCity, BillingState, AnnualRevenue, NumberOfEmployees',
    orderBy: 'Name',
    searchFields: ['Name', 'Type', 'Industry', 'Phone', 'BillingCity']
  },
  Contact: {
    fields: 'Id, FirstName, LastName, Name, Email, Phone, Title, Account.Name, AccountId',
    orderBy: 'LastName',
    searchFields: ['LastName', 'FirstName', 'Email', 'Phone', 'Title']
  },
  Opportunity: {
    fields: 'Id, Name, StageName, Amount, CloseDate, Account.Name, AccountId, Probability, LeadSource',
    orderBy: 'CloseDate DESC',
    searchFields: ['Name', 'StageName', 'LeadSource']
  },
  Case: {
    fields: 'Id, CaseNumber, Subject, Status, Priority, Type, Account.Name, AccountId, Description, CreatedDate',
    orderBy: 'CreatedDate DESC',
    searchFields: ['Subject', 'CaseNumber', 'Status', 'Priority']
  },
  Lead: {
    fields: 'Id, FirstName, LastName, Name, Email, Phone, Company, Status, Title, LeadSource',
    orderBy: 'LastName',
    searchFields: ['LastName', 'FirstName', 'Email', 'Phone', 'Company']
  },
  Campaign: {
    fields: 'Id, Name, Type, Status, StartDate, EndDate, IsActive, Description, NumberOfContacts, NumberOfLeads, NumberOfResponses',
    orderBy: 'CreatedDate DESC',
    searchFields: ['Name', 'Type', 'Status']
  },
  Task: {
    fields: 'Id, Subject, Status, Priority, ActivityDate, TaskSubtype, WhoId, Who.Name, WhatId, What.Name, OwnerId, Owner.Name, Description, CreatedDate',
    orderBy: 'CreatedDate DESC',
    searchFields: ['Subject', 'Status', 'Priority', 'Description']
  },
  Event: {
    fields: 'Id, Subject, StartDateTime, EndDateTime, IsAllDayEvent, Location, WhoId, Who.Name, WhatId, What.Name, OwnerId, Owner.Name, Description, CreatedDate',
    orderBy: 'StartDateTime DESC',
    searchFields: ['Subject', 'Location', 'Description']
  },
  EmailMessage: {
    fields: 'Id, Subject, FromName, FromAddress, ToAddress, CcAddress, BccAddress, MessageDate, Status, RelatedToId, RelatedTo.Name, CreatedById, CreatedBy.Name, CreatedDate, TextBody',
    orderBy: 'MessageDate DESC',
    searchFields: ['Subject', 'FromAddress', 'ToAddress']
  },
  Pricebook2: {
    fields: 'Id, Name, IsActive, Description',
    orderBy: 'Name',
    searchFields: ['Name', 'Description']
  },
  User: {
    fields: 'Id, Name, Email, Username, Title, IsActive',
    orderBy: 'Name',
    searchFields: ['Name', 'Email', 'Username']
  }
};

const BULK_AUTO_THRESHOLD = Math.max(parseInt(process.env.BULK_AUTO_THRESHOLD, 10) || 200, 1);
const BULK_MAX_POLL_MS = Math.max(parseInt(process.env.BULK_MAX_POLL_MS, 10) || 120000, 5000);
const BULK_POLL_INTERVAL_MS = Math.max(parseInt(process.env.BULK_POLL_INTERVAL_MS, 10) || 2000, 500);
const BULK_QUERY_PAGE_SIZE = Math.min(
  Math.max(parseInt(process.env.BULK_QUERY_PAGE_SIZE, 10) || 50000, 1000),
  250000
);

function escapeSOQL(value) {
  return String(value || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

async function getObjectFieldSet(objectName) {
  const cacheKey = `${orgStore.activeOrgKey}:${objectName}`;
  if (describeFieldCache.has(cacheKey)) return describeFieldCache.get(cacheKey);
  const meta = await sfGet(`/sobjects/${objectName}/describe`);
  const fieldSet = new Set((meta.fields || [])
    .filter(field => !field.deprecatedAndHidden)
    .map(field => field.name));
  describeFieldCache.set(cacheKey, fieldSet);
  return fieldSet;
}

function splitConfiguredFields(fields) {
  return String(fields || '')
    .split(',')
    .map(field => field.trim())
    .filter(Boolean);
}

function isSelectableField(field, availableFields) {
  if (!availableFields || availableFields.has(field)) return true;
  if (!field.includes('.')) return false;
  const root = field.split('.')[0];
  return availableFields.has(`${root}Id`);
}

async function fieldsCsvForObject(objectName, overrideFields = '') {
  const cfg = OBJECTS[objectName];
  const availableFields = await getObjectFieldSet(objectName);
  const fields = splitConfiguredFields(overrideFields || cfg.fields)
    .filter(field => field === 'Id' || isSelectableField(field, availableFields));
  PORTAL_AUDIT_FIELDS.forEach((field) => {
    if (availableFields.has(field)) fields.push(field);
  });
  return fields.length ? [...new Set(['Id', ...fields])].join(', ') : 'Id';
}

async function hydrateRecordOwners(records = [], objectName) {
  if (!records.length) return records;
  const availableFields = await getObjectFieldSet(objectName);
  if (!availableFields.has(PORTAL_OWNER_FIELD)) return records;

  const missingOwnerIds = [...new Set(
    records
      .filter(record => record?.Id && record[PORTAL_OWNER_FIELD] === undefined)
      .map(record => record.Id)
  )];
  if (!missingOwnerIds.length) return records;

  const ownerById = new Map();
  for (let i = 0; i < missingOwnerIds.length; i += 100) {
    const chunk = missingOwnerIds.slice(i, i + 100);
    const ids = chunk.map(id => `'${escapeSOQL(id)}'`).join(', ');
    const data = await sfGet('/query', {
      q: `SELECT Id, ${PORTAL_OWNER_FIELD} FROM ${objectName} WHERE Id IN (${ids})`
    });
    (data.records || []).forEach(record => {
      ownerById.set(record.Id, record[PORTAL_OWNER_FIELD] || null);
    });
  }

  return records.map(record => (
    record?.Id && ownerById.has(record.Id)
      ? { ...record, [PORTAL_OWNER_FIELD]: ownerById.get(record.Id) }
      : record
  ));
}

function buildWhereClause(objectName, search, extraWhere, availableFields = null) {
  const cfg = OBJECTS[objectName];
  const conditions = [];

  if (search && search.trim()) {
    // Escape single quotes to prevent SOQL injection
    const safe = escapeSOQL(search);
    const parts = cfg.searchFields
      .filter(field => !availableFields || availableFields.has(field))
      .map(f => `${f} LIKE '%${safe}%'`);
    if (parts.length) conditions.push(`(${parts.join(' OR ')})`);
  }

  if (extraWhere) conditions.push(extraWhere);
  return conditions.length ? ` WHERE ${conditions.join(' AND ')}` : '';
}

function appendExtraWhereToSOQL(soql, extraWhere) {
  if (!extraWhere) return soql;
  const compact = String(soql || '').replace(/\s+/g, ' ').trim();
  const orderMatch = compact.match(/\sORDER\s+BY\s/i);
  const limitMatch = compact.match(/\sLIMIT\s/i);
  const cutIndex = [orderMatch?.index, limitMatch?.index]
    .filter(index => Number.isInteger(index))
    .sort((a, b) => a - b)[0];
  const head = cutIndex === undefined ? compact : compact.slice(0, cutIndex);
  const tail = cutIndex === undefined ? '' : compact.slice(cutIndex);
  const joiner = /\sWHERE\s/i.test(head) ? ' AND ' : ' WHERE ';
  return `${head}${joiner}${extraWhere}${tail}`;
}

async function buildSOQL(objectName, search, extraWhere, limit = null, offset = 0) {
  const cfg = OBJECTS[objectName];
  const availableFields = await getObjectFieldSet(objectName);
  let soql = `SELECT ${await fieldsCsvForObject(objectName)} FROM ${objectName}`;
  soql += buildWhereClause(objectName, search, extraWhere, availableFields);
  soql += ` ORDER BY ${cfg.orderBy}`;
  if (limit !== null && limit !== undefined) {
    const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 25, 1), 2000);
    const safeOffset = Math.max(parseInt(offset, 10) || 0, 0);
    soql += ` LIMIT ${safeLimit}`;
    if (safeOffset) soql += ` OFFSET ${safeOffset}`;
  }

  return soql;
}

async function relatedQuery(objectName, fields, where, limit = 5) {
  const selectFields = await fieldsCsvForObject(objectName, fields);
  const soql = `SELECT ${selectFields} FROM ${objectName} WHERE ${where} ORDER BY ${OBJECTS[objectName].orderBy} LIMIT ${limit}`;
  const data = await sfGet('/query', { q: soql });
  return {
    records: data.records || [],
    totalSize: data.totalSize || 0
  };
}

async function emptyRelatedList(key, objectName, title, message = '') {
  return { key, objectName, title, records: [], totalSize: 0, message };
}

async function buildRelatedList(key, objectName, title, fields, where, limit = 5) {
  const data = await relatedQuery(objectName, fields, where, limit);
  return { key, objectName, title, ...data };
}

async function getOpportunityContactRoleRelated(contactId) {
  const data = await sfGet('/query', {
    q: `
      SELECT Id, OpportunityId, Opportunity.Name, Opportunity.StageName, Opportunity.Amount, Opportunity.CloseDate, Opportunity.AccountId, Opportunity.Account.Name
      FROM OpportunityContactRole
      WHERE ContactId = '${escapeSOQL(contactId)}'
      ORDER BY Opportunity.CloseDate DESC
      LIMIT 5
    `.replace(/\s+/g, ' ').trim()
  });
  return {
    key: 'opportunities',
    objectName: 'Opportunity',
    title: 'Opportunities',
    totalSize: data.totalSize || 0,
    records: (data.records || []).map((role) => ({
      Id: role.OpportunityId,
      ...(role.Opportunity || {})
    })).filter((record) => record.Id)
  };
}

async function getOpportunityCaseRelated(opportunityId) {
  const caseFields = await getObjectFieldSet('Case');
  const lookupField = ['OpportunityId', 'Opportunity__c', 'RelatedOpportunity__c', 'Related_Opportunity__c']
    .find((field) => caseFields.has(field));
  if (!lookupField) {
    return emptyRelatedList('cases', 'Case', 'Cases', 'No Case lookup to Opportunity was found in this Salesforce org.');
  }
  return buildRelatedList(
    'cases',
    'Case',
    'Cases',
    'Id, CaseNumber, Subject, Status, Priority, Type, AccountId, Account.Name, CreatedDate',
    `${lookupField} = '${escapeSOQL(opportunityId)}'`
  );
}

async function safeRelatedList(factory, fallback) {
  try {
    return await factory();
  } catch (err) {
    console.warn(`Related list warning (${fallback.title}):`, err.response?.data?.[0]?.message || err.response?.data?.message || err.message);
    return {
      ...fallback,
      records: [],
      totalSize: 0,
      message: fallback.message || 'This related list could not be loaded for the connected Salesforce org.'
    };
  }
}

async function getRelatedListsForRecord(objectName, id) {
  const safeId = escapeSOQL(id);
  if (objectName === 'Account') {
    return Promise.all([
      safeRelatedList(
        () => buildRelatedList('contacts', 'Contact', 'Contacts', 'Id, Name, Title, Email, Phone, AccountId, Account.Name', `AccountId = '${safeId}'`),
        { key: 'contacts', objectName: 'Contact', title: 'Contacts' }
      ),
      safeRelatedList(
        () => buildRelatedList('opportunities', 'Opportunity', 'Opportunities', 'Id, Name, StageName, Amount, CloseDate, AccountId, Account.Name', `AccountId = '${safeId}'`),
        { key: 'opportunities', objectName: 'Opportunity', title: 'Opportunities' }
      ),
      safeRelatedList(
        () => buildRelatedList('cases', 'Case', 'Cases', 'Id, CaseNumber, Subject, Status, Priority, Type, AccountId, Account.Name, CreatedDate', `AccountId = '${safeId}'`),
        { key: 'cases', objectName: 'Case', title: 'Cases' }
      )
    ]);
  }
  if (objectName === 'Contact') {
    return Promise.all([
      safeRelatedList(
        () => getOpportunityContactRoleRelated(id),
        { key: 'opportunities', objectName: 'Opportunity', title: 'Opportunities' }
      ),
      safeRelatedList(
        () => buildRelatedList('cases', 'Case', 'Cases', 'Id, CaseNumber, Subject, Status, Priority, Type, ContactId, AccountId, Account.Name, CreatedDate', `ContactId = '${safeId}'`),
        { key: 'cases', objectName: 'Case', title: 'Cases' }
      )
    ]);
  }
  if (objectName === 'Opportunity') {
    return [await safeRelatedList(
      () => getOpportunityCaseRelated(id),
      { key: 'cases', objectName: 'Case', title: 'Cases' }
    )];
  }
  if (objectName === 'Campaign') {
    return [
      await safeRelatedList(
        () => buildRelatedList('opportunities', 'Opportunity', 'Opportunities', 'Id, Name, StageName, Amount, CloseDate, CampaignId, AccountId, Account.Name', `CampaignId = '${safeId}'`),
        { key: 'opportunities', objectName: 'Opportunity', title: 'Opportunities' }
      )
    ];
  }
  return [];
}

function queryMoreEndpoint(nextRecordsUrl = '') {
  const raw = String(nextRecordsUrl || '').trim();
  if (!raw) throw new Error('Missing Salesforce query cursor');
  const pathName = /^https?:\/\//i.test(raw) ? new URL(raw).pathname : raw;
  const endpoint = pathName.replace(new RegExp(`^/services/data/${SF.version.replace('.', '\\.')}`), '');
  if (!/^\/query\//.test(endpoint)) throw new Error('Invalid Salesforce query cursor');
  return endpoint;
}

const QUERY_BATCH_HEADERS = { 'Sforce-Query-Options': 'batchSize=2000' };

async function buildCountSOQL(objectName, search, extraWhere) {
  const availableFields = await getObjectFieldSet(objectName);
  return `SELECT COUNT() FROM ${objectName}${buildWhereClause(objectName, search, extraWhere, availableFields)}`;
}

function stripHtml(value = '') {
  return String(value)
    .replace(/<!\[CDATA\[/g, '')
    .replace(/\]\]>/g, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .trim();
}

function chatterSegmentFromClient(segment = {}) {
  if (segment.type === 'Mention' && segment.id) {
    return { type: 'Mention', id: segment.id };
  }
  if (segment.type === 'Link' && segment.url) {
    return [
      { type: 'MarkupBegin', markupType: 'Hyperlink', url: segment.url },
      { type: 'Text', text: segment.text || segment.url },
      { type: 'MarkupEnd', markupType: 'Hyperlink' }
    ];
  }
  return { type: 'Text', text: String(segment.text || '') };
}

function chatterBodyFromSegments(segments = []) {
  const messageSegments = (segments || [])
    .map(chatterSegmentFromClient)
    .flat()
    .filter((segment) => segment.type === 'Mention' || segment.type === 'MarkupBegin' || segment.type === 'MarkupEnd' || segment.text);
  return {
    messageSegments: messageSegments.length ? messageSegments : [{ type: 'Text', text: ' ' }]
  };
}

function normalizeChatterSegments(segments = []) {
  const normalized = [];
  for (let i = 0; i < (segments || []).length; i += 1) {
    const segment = segments[i] || {};
    if (segment.type === 'MarkupBegin' && segment.markupType === 'Hyperlink') {
      const textSegment = (segments || [])[i + 1] || {};
      normalized.push({
        type: 'Link',
        text: textSegment.text || segment.url || '',
        url: segment.url || ''
      });
      while ((segments || [])[i + 1]?.type !== 'MarkupEnd' && i + 1 < (segments || []).length) i += 1;
      if ((segments || [])[i + 1]?.type === 'MarkupEnd') i += 1;
      continue;
    }
    if (segment.type === 'MarkupBegin' || segment.type === 'MarkupEnd') continue;
    if (segment.htmlTag && !segment.text && !segment.name && !segment.url) continue;
    normalized.push({
      type: segment.type || 'Text',
      text: segment.text || segment.name || '',
      name: segment.name || segment.user?.displayName || segment.record?.name || '',
      url: segment.url || segment.record?.url || '',
      id: segment.id || segment.user?.id || segment.record?.id || ''
    });
  }
  return normalized;
}

function normalizeChatterComments(capabilities = {}) {
  const comments = capabilities.comments?.page?.items || capabilities.comments?.items || [];
  return comments.map((comment) => ({
    id: comment.id,
    actor: {
      id: comment.user?.id || comment.actor?.id || '',
      name: comment.user?.displayName || comment.actor?.displayName || comment.actor?.name || 'User'
    },
    createdDate: comment.createdDate,
    segments: normalizeChatterSegments(comment.body?.messageSegments)
  }));
}

function salesforceIdFromValue(value = '') {
  const match = String(value || '').match(/[a-zA-Z0-9]{15}(?:[a-zA-Z0-9]{3})?/);
  return match ? match[0] : '';
}

function chatterPollChoiceId(choice = {}) {
  const candidates = [
    choice.id,
    choice.choiceId,
    choice.value,
    choice.choice?.id,
    choice.pollChoice?.id,
    choice.url,
    choice.selfUrl,
    choice.resourceUrl
  ];
  for (const candidate of candidates) {
    const id = salesforceIdFromValue(candidate);
    if (id) return id;
  }
  return '';
}

function normalizeChatterPoll(capabilities = {}) {
  const poll = capabilities.poll;
  if (!poll) return null;
  const choices = poll.choices || poll.pollChoices || poll.options || [];
  return {
    id: poll.id || '',
    myChoiceId: poll.myChoiceId || poll.myChoice?.id || '',
    choices: choices.map((choice) => ({
      id: chatterPollChoiceId(choice),
      text: choice.text || choice.label || choice.name || choice.choice?.text || choice.pollChoice?.text || '',
      voteCount: choice.voteCount || choice.votes || 0
    }))
  };
}

async function resolveChatterPollChoiceId(feedElementId, submittedChoiceId) {
  const submitted = String(submittedChoiceId || '').trim();
  if (salesforceIdFromValue(submitted) === submitted) return submitted;

  const poll = await sfGet(`/chatter/feed-elements/${encodeURIComponent(feedElementId)}/capabilities/poll`);
  const normalized = normalizeChatterPoll({ poll });
  const choice = (normalized?.choices || []).find((item) => (
    item.id === submitted || item.text === submitted
  ));
  return choice?.id || submitted;
}

function normalizeChatterItem(item = {}) {
  const capabilities = item.capabilities || {};
  return {
    id: item.id,
    type: item.type || item.feedElementType || '',
    actor: {
      id: item.actor?.id || '',
      name: item.actor?.displayName || item.actor?.name || 'Salesforce User'
    },
    createdDate: item.createdDate,
    relativeCreatedDate: item.relativeCreatedDate || '',
    segments: normalizeChatterSegments(item.body?.messageSegments),
    text: stripHtml(item.body?.text || (item.body?.messageSegments || []).map((segment) => segment.text || segment.name || '').join(' ')),
    likeCount: capabilities.chatterLikes?.page?.total || capabilities.chatterLikes?.total || 0,
    commentCount: capabilities.comments?.page?.total || capabilities.comments?.total || 0,
    comments: normalizeChatterComments(capabilities),
    poll: normalizeChatterPoll(capabilities)
  };
}

function cleanTemplateBody(value = '') {
  return String(value)
    .replace(/<!\[CDATA\[/g, '')
    .replace(/\]\]>/g, '');
}

function emailTemplateBody(template = {}) {
  return cleanTemplateBody(template.HtmlValue || template.Markup || template.Body || '');
}

function emailTemplateSubject(template = {}) {
  return template.Subject || template.Name || '';
}

function buildTemplateContext(recipient = {}, campaign = {}, sender = {}, organization = {}) {
  const replacements = {
    'Contact.Name': recipient.type === 'Contact' ? recipient.name : '',
    'Contact.FirstName': recipient.type === 'Contact' ? recipient.firstName || '' : '',
    'Contact.LastName': recipient.type === 'Contact' ? recipient.lastName || '' : '',
    'Contact.Email': recipient.type === 'Contact' ? recipient.email || '' : '',
    'Contact.Title': recipient.type === 'Contact' ? recipient.title || '' : '',
    'Lead.Name': recipient.type === 'Lead' ? recipient.name : '',
    'Lead.FirstName': recipient.type === 'Lead' ? recipient.firstName || '' : '',
    'Lead.LastName': recipient.type === 'Lead' ? recipient.lastName || '' : '',
    'Lead.Email': recipient.type === 'Lead' ? recipient.email || '' : '',
    'Lead.Title': recipient.type === 'Lead' ? recipient.title || '' : '',
    'Lead.Company': recipient.type === 'Lead' ? recipient.company || '' : '',
    'Recipient.Name': recipient.name || '',
    'Recipient.FirstName': recipient.firstName || '',
    'Recipient.LastName': recipient.lastName || '',
    'Recipient.Email': recipient.email || '',
    'Recipient.Title': recipient.title || '',
    'Campaign.Name': campaign.Name || '',
    'Campaign.Type': campaign.Type || '',
    'Campaign.Status': campaign.Status || '',
    'Campaign.StartDate': campaign.StartDate || '',
    'Campaign.EndDate': campaign.EndDate || '',
    'Account.Name': campaign.Name || '',
    'Account.Phone': campaign.Phone || '',
    'Account.Website': campaign.Website || '',
    'Opportunity.Name': campaign.Name || '',
    'Opportunity.StageName': campaign.StageName || '',
    'Case.Subject': campaign.Subject || '',
    'Case.CaseNumber': campaign.CaseNumber || '',
    'Sender.Name': sender.Name || sender.name || '',
    'Sender.FirstName': sender.FirstName || '',
    'Sender.LastName': sender.LastName || '',
    'Sender.Email': sender.Email || sender.email || '',
    'Sender.Title': sender.Title || sender.title || '',
    'User.Name': sender.Name || sender.name || '',
    'User.FirstName': sender.FirstName || '',
    'User.LastName': sender.LastName || '',
    'User.Email': sender.Email || sender.email || '',
    'Organization.Name': organization.Name || ''
  };

  return replacements;
}

function mergeTemplate(value = '', recipient = {}, campaign = {}, sender = {}, organization = {}) {
  const replacements = buildTemplateContext(recipient, campaign, sender, organization);
  return String(value || '')
    .replace(/\{\{\{([\w.]+)\}\}\}/g, (match, key) =>
      Object.prototype.hasOwnProperty.call(replacements, key) ? replacements[key] : match)
    .replace(/\{\{([\w.]+)\}\}/g, (match, key) =>
      Object.prototype.hasOwnProperty.call(replacements, key) ? replacements[key] : match)
    .replace(/\{!([\w.]+)\}/g, (match, key) =>
      Object.prototype.hasOwnProperty.call(replacements, key) ? replacements[key] : match);
}

function normalizeCampaignMember(record) {
  const isContact = Boolean(record.ContactId);
  const person = isContact ? record.Contact : record.Lead;
  return {
    id: record.Id,
    status: record.Status,
    type: isContact ? 'Contact' : 'Lead',
    personId: record.ContactId || record.LeadId,
    name: person?.Name || '',
    firstName: person?.FirstName || '',
    lastName: person?.LastName || '',
    email: person?.Email || '',
    phone: person?.Phone || '',
    title: person?.Title || '',
    company: isContact ? person?.Account?.Name || '' : person?.Company || '',
    accountId: isContact ? person?.AccountId || '' : ''
  };
}

function objectFromId(id) {
  const prefix = String(id || '').slice(0, 3);
  return {
    '001': 'Account',
    '003': 'Contact',
    '006': 'Opportunity',
    '500': 'Case',
    '00Q': 'Lead',
    '701': 'Campaign',
    '00T': 'Task',
    '00U': 'Event',
    '02s': 'EmailMessage',
    '005': 'User'
  }[prefix] || '';
}

function normalizePicklistValues(field) {
  return (field.picklistValues || [])
    .filter(item => item.active)
    .map(item => ({
      value: item.value,
      label: item.label || item.value,
      validFor: item.validFor || ''
    }));
}

async function buildLookupLabels(record, fields) {
  const lookups = fields
    .filter((field) => field.type === 'reference' && record[field.name])
    .map((field) => ({
      field: field.name,
      id: record[field.name],
      object: objectFromId(record[field.name]) || field.referenceTo?.[0]
    }))
    .filter((item) => item.object);

  const labels = {};
  await Promise.all(lookups.map(async (lookup) => {
    try {
      const data = await sfGet('/query', {
        q: `SELECT Id, Name FROM ${lookup.object} WHERE Id = '${escapeSOQL(lookup.id)}' LIMIT 1`
      });
      labels[lookup.field] = {
        id: lookup.id,
        object: lookup.object,
        name: data.records?.[0]?.Name || lookup.id
      };
    } catch {
      labels[lookup.field] = {
        id: lookup.id,
        object: lookup.object,
        name: lookup.id
      };
    }
  }));

  return labels;
}

function normalizeActivity(record, source) {
  if (source === 'EmailMessage') {
    return {
      id: record.Id,
      objectName: 'EmailMessage',
      type: 'Email',
      subject: record.Subject || 'Email',
      actor: record.FromName || record.FromAddress || '',
      target: record.ToAddress || '',
      when: record.MessageDate || record.CreatedDate,
      status: record.Status || '',
      isClosed: true,
      body: stripHtml(record.TextBody || '')
    };
  }

  if (source === 'Event') {
    return {
      id: record.Id,
      objectName: 'Event',
      type: 'Event',
      subject: record.Subject || 'Event',
      actor: record.Owner?.Name || '',
      target: record.Who?.Name || '',
      targetId: record.WhoId || '',
      targetObject: objectFromId(record.WhoId),
      when: record.StartDateTime || record.CreatedDate,
      end: record.EndDateTime || '',
      status: record.Location || '',
      isClosed: record.StartDateTime ? new Date(record.StartDateTime).getTime() < Date.now() : false,
      body: record.Description || ''
    };
  }

  const type = record.TaskSubtype || 'Task';
  const isEmailTask = String(type).toLowerCase().includes('email');
  return {
    id: record.Id,
    objectName: 'Task',
    type,
    subject: record.Subject || 'Task',
    actor: record.Owner?.Name || '',
    target: record.Who?.Name || '',
    targetId: record.WhoId || '',
    targetObject: objectFromId(record.WhoId),
    when: isEmailTask ? record.CreatedDate || record.ActivityDate : record.ActivityDate || record.CreatedDate,
    dueDate: record.ActivityDate || '',
    status: record.Status || '',
    isClosed: Boolean(record.IsClosed),
    body: record.Description || ''
  };
}

function normalizeEmailSubject(value = '') {
  return String(value || '')
    .replace(/^(Email|List Email):\s*/i, '')
    .trim()
    .toLowerCase();
}

function extractEmailRecipient(value = '') {
  const match = String(value || '').match(/^To:\s*([^\s\r\n]+)/im);
  return match ? match[1].trim().toLowerCase() : '';
}

function emailAddressIdentity(value = '') {
  const text = String(value || '').toLowerCase();
  const match = text.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i);
  return match ? match[0] : text.trim();
}

function dedupeEmailActivities(records) {
  const emailKeys = new Set(records
    .filter((record) => record.id?.startsWith('02s'))
    .map((record) => `${normalizeEmailSubject(record.subject)}|${emailAddressIdentity(record.target)}`));

  if (!emailKeys.size) return records;

  return records.filter((record) => {
    if (!record.id?.startsWith('00T') || !String(record.type || '').toLowerCase().includes('email')) return true;
    const key = `${normalizeEmailSubject(record.subject)}|${emailAddressIdentity(extractEmailRecipient(record.body))}`;
    return !emailKeys.has(key);
  });
}

// ─── Error Handler ────────────────────────────────────────────
function handleSFError(err, res, context) {
  const sfErr = err.response?.data;
  const msg = formatSalesforceError(sfErr) || err.message;

  console.error(`❌ ${context}:`, sfErr || err.message);
  if (!err.response && isTransientSalesforceNetworkError(err)) {
    return res.status(502).json({ error: 'Salesforce connection was interrupted. Please try again.' });
  }
  res.status(err.response?.status || 500).json({ error: msg || 'Salesforce API error' });
}

function formatSalesforceError(value) {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(formatSalesforceError).filter(Boolean).join('; ');
  if (value.message) return value.message;
  if (value.error_description) return value.error_description;
  if (value.errors) return formatSalesforceError(value.errors);
  if (value.outputValues?.errors) return formatSalesforceError(value.outputValues.errors);
  try {
    return JSON.stringify(value);
  } catch {
    return '';
  }
}

function extractActionFailures(result) {
  const items = Array.isArray(result) ? result : result?.outputs || result?.results || [];
  return items
    .filter((item) => item && item.isSuccess === false)
    .map((item) => formatSalesforceError(item.errors || item.outputValues?.errors || item))
    .filter(Boolean);
}

function activityRelationFor(object, id) {
  return ['Contact', 'Lead'].includes(object)
    ? { WhoId: id }
    : { WhatId: id };
}

function activityRelationFromBody(object, id, body = {}) {
  const relation = {};
  if (body.whoId) relation.WhoId = body.whoId;
  if (body.whatId) relation.WhatId = body.whatId;
  if (!relation.WhoId && !relation.WhatId) return activityRelationFor(object, id);
  return relation;
}

async function createTaskActivity(fields, subtype = '') {
  const body = { ...fields };
  if (subtype) body.TaskSubtype = subtype;

  try {
    return await sfPost('/sobjects/Task', body);
  } catch (err) {
    if (!subtype) throw err;
    const { TaskSubtype, ...fallback } = body;
    return sfPost('/sobjects/Task', fallback);
  }
}

function toSalesforceDateTime(dateValue, timeValue) {
  if (!dateValue) return '';
  if (!timeValue) return new Date(dateValue).toISOString();
  return new Date(`${dateValue}T${timeValue}`).toISOString();
}

async function getEmailMergeContext() {
  const me = await sfGet('/chatter/users/me');
  const [userData, orgData] = await Promise.all([
    sfGet('/query', {
      q: `SELECT Id, Name, FirstName, LastName, Email, Title FROM User WHERE Id = '${escapeSOQL(me.id)}' LIMIT 1`
    }),
    sfGet('/query', {
      q: 'SELECT Id, Name FROM Organization LIMIT 1'
    })
  ]);
  return {
    sender: userData.records?.[0] || { Name: me.name, Email: me.email, Title: me.title },
    organization: orgData.records?.[0] || {}
  };
}

// ─── Routes ───────────────────────────────────────────────────

async function getEmailRecipientContext(objectName, id) {
  if (!id || !['Contact', 'Lead', 'User'].includes(objectName)) return {};
  const fields = objectName === 'User'
    ? 'Id, Name, FirstName, LastName, Email, Title'
    : objectName === 'Contact'
      ? 'Id, Name, FirstName, LastName, Email, Title'
      : 'Id, Name, FirstName, LastName, Email, Title, Company';
  const record = await sfGet(`/sobjects/${objectName}/${id}?fields=${encodeURIComponent(fields)}`);
  return {
    type: objectName,
    personId: record.Id,
    name: record.Name || '',
    firstName: record.FirstName || '',
    lastName: record.LastName || '',
    email: record.Email || '',
    title: record.Title || '',
    company: record.Company || ''
  };
}

async function getRelatedMergeRecord(objectName, id) {
  if (!id || !OBJECTS[objectName]) return {};
  try {
    return await sfGet(`/sobjects/${objectName}/${id}`);
  } catch {
    return {};
  }
}

async function queryClassicEmailTemplates(limit = 500) {
  const safeLimit = Math.min(Math.max(Number(limit) || 500, 1), 1000);
  const data = await sfGet('/query', {
    q: `
    SELECT Id, Name, DeveloperName, Subject, Description, TemplateType, IsActive
    FROM EmailTemplate
    WHERE IsActive = true
    ORDER BY Name
    LIMIT ${safeLimit}
    `.replace(/\s+/g, ' ').trim()
  });
  return data.records || [];
}

function parseEmailAddressList(value = '') {
  return String(value || '')
    .split(/[;,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function fileTitle(filename = 'attachment') {
  return path.basename(String(filename || 'attachment')).replace(/\.[^.]+$/, '') || 'attachment';
}

async function uploadEmailAttachments(files = [], parentId = '') {
  const pdfs = files
    .filter((file) => file?.name && file?.data)
    .filter((file) => file.type === 'application/pdf' || /\.pdf$/i.test(file.name))
    .slice(0, 10);

  const uploaded = [];
  for (const file of pdfs) {
    const cleanName = path.basename(file.name);
    const result = await sfPost('/sobjects/ContentVersion', {
      Title: fileTitle(cleanName),
      PathOnClient: cleanName,
      VersionData: String(file.data).replace(/^data:.*?;base64,/, ''),
      ...(parentId ? { FirstPublishLocationId: parentId } : {})
    });
    uploaded.push({ id: result.id, name: cleanName });
  }
  return uploaded;
}


// POST /api/auth/login
// Body: { email, password }
// Returns: { token, user: { id, email, name, role }, permissions: {...} }
async function issuePortalSession(user, req, authMethod = 'password') {
  const userData = await getUserWithPermissions(user.id);
  if (!userData) {
    const error = new Error('Could not load user permissions');
    error.statusCode = 403;
    throw error;
  }

  const isSystemAdmin = userData.profile?.is_system_admin || false;
  const tokenPayload = {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    isSystemAdmin
  };
  const token = jwt.sign(tokenPayload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });

  await supabase
    .from('users')
    .update({ last_login_at: new Date().toISOString() })
    .eq('id', user.id);

  await writeAuditLog({
    userId: user.id,
    userEmail: user.email,
    userRole: user.role,
    action: 'login',
    payload: { authMethod },
    ipAddress: req.ip
  });

  return {
    token,
    mustChangePw: user.must_change_pw,
    user: {
      id: userData.id,
      email: userData.email,
      name: userData.name,
      role: userData.role,
      isSystemAdmin,
      profileImage: userData.profile_image || null,
      profile: userData.profile
    },
    permissions: userData.permissions
  };
}

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body || {};

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  try {
    // 1. Look up the user by email
    const { data: user, error } = await supabase
      .from('users')
      .select('id, email, name, role, profile_image, password_hash, is_active, must_change_pw')
      .eq('email', email.toLowerCase().trim())
      .single();

    if (error || !user) {
      // Generic message — don't reveal whether email exists
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    if (!user.is_active) {
      return res.status(403).json({ error: 'Account is deactivated. Contact your administrator.' });
    }

    // 2. Compare password with bcrypt hash
    const passwordOk = await bcrypt.compare(password, user.password_hash);
    if (!passwordOk) {
      // Log failed attempt
      await writeAuditLog({
        userId: user.id,
        userEmail: user.email,
        userRole: user.role,
        action: 'failed_login',
        ipAddress: req.ip
      });
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    // 3. Load full permissions
    const userData = await getUserWithPermissions(user.id);
    if (!userData) {
      return res.status(403).json({ error: 'Could not load user permissions' });
    }

    // 4. Sign JWT — embed role so middleware doesn't need DB on every request
    const isSystemAdmin = userData.profile?.is_system_admin || false;

    const tokenPayload = {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,          // keep for backward compat
      isSystemAdmin: isSystemAdmin       // NEW — profile-based
    };
    const token = jwt.sign(tokenPayload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });

    // 5. Update last_login_at
    await supabase
      .from('users')
      .update({ last_login_at: new Date().toISOString() })
      .eq('id', user.id);

    // 6. Log successful login
    await writeAuditLog({
      userId: user.id,
      userEmail: user.email,
      userRole: user.role,
      action: 'login',
      ipAddress: req.ip
    });

    res.json({
      token,
      mustChangePw: user.must_change_pw,
      user: {
        id: userData.id,
        email: userData.email,
      name: userData.name,
      role: userData.role,
      profileImage: user.profile_image || null,
      profile: userData.profile
    },
      permissions: userData.permissions   // { Account: {can_read, can_create, can_edit, can_delete}, ... }
    });

  } catch (err) {
    console.error('Login error:', err.message);
    res.status(500).json({ error: 'Login failed. Please try again.' });
  }
});

// GET /api/auth/supabase-config
// Public browser config for Supabase OAuth. Never expose SUPABASE_SERVICE_ROLE_KEY here.
app.get('/api/auth/supabase-config', (req, res) => {
  const anonKey = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!process.env.SUPABASE_URL || !anonKey) {
    return res.status(500).json({ error: 'Supabase OAuth is not configured on the server.' });
  }

  res.json({
    url: process.env.SUPABASE_URL,
    anonKey
  });
});

// POST /api/auth/social-login
// Verifies the Supabase OAuth user, maps their email to an existing portal user,
// then returns the same portal JWT/permissions shape as email-password login.
app.post('/api/auth/social-login', async (req, res) => {
  const { provider, accessToken } = req.body || {};

  if (provider !== 'google') {
    return res.status(400).json({ error: 'Unsupported social login provider.' });
  }

  if (!accessToken) {
    return res.status(400).json({ error: 'Missing Supabase access token.' });
  }

  try {
    const { data: authData, error: authError } = await supabase.auth.getUser(accessToken);
    if (authError || !authData?.user?.email) {
      return res.status(401).json({ error: 'Google sign-in could not be verified.' });
    }

    const supabaseUser = authData.user;
    const identities = supabaseUser.identities || [];
    const usedGoogle = identities.some(identity => identity.provider === 'google');
    if (!usedGoogle && supabaseUser.app_metadata?.provider !== 'google') {
      return res.status(401).json({ error: 'Please sign in with Google.' });
    }

    const email = supabaseUser.email.toLowerCase().trim();
    const { data: user, error } = await supabase
      .from('users')
      .select('id, email, name, role, is_active, must_change_pw')
      .eq('email', email)
      .single();

    if (error || !user) {
      return res.status(403).json({
        error: 'Your Google account is not linked to a portal user. Ask an administrator to create a user with this email.'
      });
    }

    if (!user.is_active) {
      return res.status(403).json({ error: 'Account is deactivated. Contact your administrator.' });
    }

    res.json(await issuePortalSession(user, req, 'google'));
  } catch (err) {
    console.error('Social login error:', err.message);
    res.status(err.statusCode || 500).json({ error: err.message || 'Social login failed. Please try again.' });
  }
});



// =============================================================================
// POST /api/auth/forgot-password
// User submits their email → we generate a reset token → send email
// =============================================================================
app.post('/api/auth/forgot-password', async (req, res) => {
  const { email } = req.body || {};
  if (!email) return res.status(400).json({ error: 'Email is required' });

  // Always return success — never reveal whether email exists (security)
  const genericResponse = { success: true, message: 'If that email exists, a reset link has been sent.' };

  try {
    // 1. Find user
    const { data: user } = await supabase
      .from('users')
      .select('id, name, email, is_active')
      .eq('email', email.toLowerCase().trim())
      .single();

    // If no user or inactive — return generic success anyway (don't leak info)
    if (!user || !user.is_active) return res.json(genericResponse);

    // 2. Generate a secure random token
    const resetToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(resetToken).digest('hex');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour from now

    // 3. Store token hash in DB (we store hash, not raw token — same as JWT pattern)
    // First delete any existing reset tokens for this user
    await supabase
      .from('password_reset_tokens')
      .delete()
      .eq('user_id', user.id);

    await supabase
      .from('password_reset_tokens')
      .insert({
        user_id: user.id,
        token_hash: tokenHash,
        expires_at: expiresAt.toISOString(),
        used: false
      });

    // 4. Send email via Resend
    const appUrl = process.env.APP_URL || `http://localhost:${PORT}`;
    const resetUrl = `${appUrl}/reset-password.html?token=${resetToken}`;

    await resend.emails.send({
      from: process.env.FROM_EMAIL || 'noreply@yourdomain.com',
      to: user.email,
      subject: 'SaaSRAY CRM — Reset Your Password',
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
        </head>
        <body style="margin:0;padding:0;background:#0f1117;font-family:'Segoe UI',Arial,sans-serif">
          <table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 20px">
            <tr>
              <td align="center">
                <table width="480" cellpadding="0" cellspacing="0"
                  style="background:#1a1d27;border:1px solid #2a2d3e;border-radius:16px;overflow:hidden">
 
                  <!-- Header -->
                  <tr>
                    <td style="padding:32px 40px 24px;border-bottom:1px solid #2a2d3e;text-align:center">
                      <div style="font-size:22px;font-weight:800;color:#f0f1ff;letter-spacing:-0.5px">
                        SaaSRAY <span style="color:#6366f1">CRM</span>
                      </div>
                      <div style="font-size:12px;color:#5c5f7a;margin-top:4px;letter-spacing:0.05em">
                        THINK DIGITAL. BUILD SMART.
                      </div>
                    </td>
                  </tr>
 
                  <!-- Body -->
                  <tr>
                    <td style="padding:32px 40px">
                      <p style="font-size:15px;color:#a0a3c0;margin:0 0 8px">Hi ${user.name},</p>
                      <h1 style="font-size:20px;font-weight:700;color:#f0f1ff;margin:0 0 16px">
                        Password Reset Request
                      </h1>
                      <p style="font-size:14px;color:#a0a3c0;line-height:1.6;margin:0 0 28px">
                        We received a request to reset your SaaSRAY CRM password.
                        Click the button below to set a new password. This link expires in
                        <strong style="color:#f0f1ff">1 hour</strong>.
                      </p>
 
                      <!-- CTA Button -->
                      <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px">
                        <tr>
                          <td align="center">
                            <a href="${resetUrl}"
                              style="display:inline-block;background:#6366f1;color:#ffffff;
                                     font-size:15px;font-weight:700;text-decoration:none;
                                     padding:14px 36px;border-radius:10px;letter-spacing:0.02em">
                              Reset My Password
                            </a>
                          </td>
                        </tr>
                      </table>
 
                      <!-- Fallback URL -->
                      <p style="font-size:12px;color:#5c5f7a;line-height:1.6;margin:0 0 8px">
                        If the button doesn't work, copy and paste this link:
                      </p>
                      <p style="font-size:12px;color:#6366f1;word-break:break-all;margin:0 0 28px">
                        ${resetUrl}
                      </p>
 
                      <!-- Security Note -->
                      <div style="background:#141620;border:1px solid #2a2d3e;border-radius:8px;padding:16px">
                        <p style="font-size:12px;color:#5c5f7a;margin:0;line-height:1.6">
                          🔒 If you didn't request a password reset, you can safely ignore this email.
                          Your password will not change unless you click the link above.
                        </p>
                      </div>
                    </td>
                  </tr>
 
                  <!-- Footer -->
                  <tr>
                    <td style="padding:20px 40px;border-top:1px solid #2a2d3e;text-align:center">
                      <p style="font-size:11px;color:#5c5f7a;margin:0">
                        SaaSRAY CRM &bull; This email was sent to ${user.email}
                      </p>
                    </td>
                  </tr>
 
                </table>
              </td>
            </tr>
          </table>
        </body>
        </html>
      `
    });

    // 5. Audit log
    await writeAuditLog({
      userId: user.id,
      userEmail: user.email,
      userRole: 'system',
      action: 'password_reset',
      ipAddress: req.ip
    });

    res.json(genericResponse);

  } catch (err) {
    console.error('Forgot password error:', err.message);
    // Still return generic success — don't leak errors to attacker
    res.json(genericResponse);
  }
});


// =============================================================================
// POST /api/auth/reset-password
// User submits new password with the token from the email link
// =============================================================================
app.post('/api/auth/reset-password', async (req, res) => {
  const { token, password } = req.body || {};

  if (!token || !password) {
    return res.status(400).json({ error: 'Token and new password are required' });
  }

  if (password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }

  try {
    // 1. Hash the incoming token to compare with stored hash
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    // 2. Find the token in DB
    const { data: resetRecord } = await supabase
      .from('password_reset_tokens')
      .select('user_id, expires_at, used')
      .eq('token_hash', tokenHash)
      .single();

    if (!resetRecord) {
      return res.status(400).json({ error: 'Invalid or expired reset link. Please request a new one.' });
    }

    if (resetRecord.used) {
      return res.status(400).json({ error: 'This reset link has already been used. Please request a new one.' });
    }

    if (new Date(resetRecord.expires_at) < new Date()) {
      return res.status(400).json({ error: 'This reset link has expired. Please request a new one.' });
    }

    // 3. Hash new password
    const passwordHash = await bcrypt.hash(password, 12);

    // 4. Update user password
    await supabase
      .from('users')
      .update({
        password_hash: passwordHash,
        must_change_pw: false,
        updated_at: new Date().toISOString()
      })
      .eq('id', resetRecord.user_id);

    // 5. Mark token as used (so it can't be reused)
    await supabase
      .from('password_reset_tokens')
      .update({ used: true })
      .eq('token_hash', tokenHash);

    // 6. Audit log
    await writeAuditLog({
      userId: resetRecord.user_id,
      userRole: 'system',
      action: 'password_reset',
      ipAddress: req.ip
    });

    res.json({ success: true, message: 'Password updated successfully. You can now log in.' });

  } catch (err) {
    console.error('Reset password error:', err.message);
    res.status(500).json({ error: 'Could not reset password. Please try again.' });
  }
});


// =============================================================================
// GET /api/auth/verify-reset-token
// Called by the reset page on load to validate the token before showing the form
// =============================================================================
app.get('/api/auth/verify-reset-token', async (req, res) => {
  const { token } = req.query;
  if (!token) return res.status(400).json({ valid: false, error: 'Token is required' });

  try {
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const { data } = await supabase
      .from('password_reset_tokens')
      .select('user_id, expires_at, used, users(name, email)')
      .eq('token_hash', tokenHash)
      .single();

    if (!data || data.used || new Date(data.expires_at) < new Date()) {
      return res.json({ valid: false, error: 'Invalid or expired reset link' });
    }

    res.json({ valid: true, name: data.users?.name || '' });

  } catch (err) {
    res.json({ valid: false, error: 'Invalid reset link' });
  }
});


// POST /api/auth/logout
// Replaces your existing logout route — adds audit log
// If you already have app.post('/api/auth/logout', ...) — REPLACE IT with this one.
// Note: we keep the Salesforce token revocation logic that's already in your file.
// Only the Supabase audit log line is new — add it to your existing logout handler:
//   await writeAuditLog({ userId: req.user?.id, userEmail: req.user?.email, userRole: req.user?.role, action: 'logout', ipAddress: req.ip });


// GET /api/portal/me
// Returns current user + full permissions. Called after login and on page load.
// Protected by JWT middleware.
app.get('/api/portal/me', checkAuth, async (req, res) => {
  try {
    const userData = await getUserWithPermissions(req.user.id);

    if (!userData) {
      return res.status(404).json({
        error: 'User not found or deactivated'
      });
    }

    const { data: imageRow } = await supabase
      .from('users')
      .select('profile_image')
      .eq('id', req.user.id)
      .single();

    // Check if assigned profile is System Administrator
    const { data: profileData } = await supabase
      .from('user_profile_assignments')
      .select('profiles(id, name, is_system_admin)')
      .eq('user_id', req.user.id)
      .single();

    const isSystemAdmin =
      profileData?.profiles?.is_system_admin || false;

    res.json({
      id: userData.id,
      email: userData.email,
      name: userData.name,
      role: userData.role,

      // NEW
      isSystemAdmin: isSystemAdmin,

      profileImage: imageRow?.profile_image || null,
      profile: userData.profile,
      permissions: userData.permissions,
      lastLoginAt: userData.last_login_at
    });

  } catch (err) {
    console.error('GET /api/portal/me error:', err.message);

    res.status(500).json({
      error: 'Could not load user profile'
    });
  }
});

// GET own profile — any logged in user
app.get('/api/portal/profile', checkAuth, async (req, res) => {
  try {
    const { data: user } = await supabase
      .from('users')
      .select('id, email, name, role, profile_image, must_change_pw, created_at, last_login_at')
      .eq('id', req.user.id)
      .single();

    const { data: assignment } = await supabase
      .from('user_profile_assignments')
      .select('profile_id, profiles(id, name, description, is_system_admin)')
      .eq('user_id', req.user.id)
      .single();

    const { data: permSets } = await supabase
      .from('user_permission_set_assignments')
      .select('perm_set_id, permission_sets(id, name, description)')
      .eq('user_id', req.user.id);

    const permissions = await supabase
      .rpc('get_portal_users')
      .then(({ data }) => data?.find(u => u.id === req.user.id));

    res.json({
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      profileImage: user.profile_image || null,
      mustChangePw: user.must_change_pw,
      createdAt: user.created_at,
      lastLoginAt: user.last_login_at,
      profile: assignment?.profiles || null,
      isSystemAdmin: Boolean(assignment?.profiles?.is_system_admin),
      permissionSets: (permSets || []).map(p => p.permission_sets).filter(Boolean)
    });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

// PATCH own profile — name and password only
app.patch('/api/portal/profile', checkAuth, async (req, res) => {
  const { name, profileImage, currentPassword, newPassword } = req.body || {};

  try {
    const updates = {};

    // Name change
    if (name?.trim()) {
      updates.name = name.trim();
    }

    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'profileImage')) {
      updates.profile_image = normalizeProfileImage(profileImage);
    }

    // Password change
    if (newPassword) {
      if (!currentPassword) {
        return res.status(400).json({ error: 'Current password is required to set a new password' });
      }
      if (newPassword.length < 8) {
        return res.status(400).json({ error: 'New password must be at least 8 characters' });
      }

      // Verify current password
      const { data: user } = await supabase
        .from('users')
        .select('password_hash')
        .eq('id', req.user.id)
        .single();

      const valid = await bcrypt.compare(currentPassword, user.password_hash);
      if (!valid) {
        return res.status(400).json({ error: 'Current password is incorrect' });
      }

      updates.password_hash = await bcrypt.hash(newPassword, 12);
      updates.must_change_pw = false;
    }

    if (!Object.keys(updates).length) {
      return res.status(400).json({ error: 'Nothing to update' });
    }

    updates.updated_at = new Date().toISOString();

    await supabase.from('users').update(updates).eq('id', req.user.id);

    await writeAuditLog({
      userId: req.user.id,
      userEmail: req.user.email,
      userRole: req.user.role,
      action: 'update_user',
      payload: { self: true, changedFields: Object.keys(updates) },
      ipAddress: req.ip
    });

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// POST /api/portal/users — create new portal user (admin+ only)
app.post('/api/portal/users', checkAuth, checkRole('admin'), async (req, res) => {
  const {
    email,
    name,
    password,
    role,
    profileId,
    orgRoleId,
    profileImage,
    permissionSetIds,
    permissionSetGroupIds
  } = req.body || {};

  if (!email || !name || !password) {
    return res.status(400).json({ error: 'Email, name, and password are required' });
  }

  const validRoles = ['system_administrator', 'admin', 'manager', 'employee', 'readonly'];
  if (role && !validRoles.includes(role)) {
    return res.status(400).json({ error: 'Invalid role' });
  }

  // Admins cannot create system_administrator users
  if (role === 'system_administrator' && req.user.role !== 'system_administrator') {
    return res.status(403).json({ error: 'Only System Administrators can create System Administrator accounts' });
  }

  try {
    const passwordHash = await bcrypt.hash(password, 12);

    const { data: newUser, error } = await supabase
      .from('users')
      .insert({
        email: email.toLowerCase().trim(),
        name: name.trim(),
        password_hash: passwordHash,
        role: role || 'employee',
        org_role_id: orgRoleId || null,
        profile_image: normalizeProfileImage(profileImage),
        is_active: true,
        must_change_pw: true,
        created_by: req.user.id
      })
      .select('id, email, name, role, org_role_id, profile_image')
      .single();

    if (error) {
      if (error.code === '23505') {
        return res.status(409).json({ error: 'A user with this email already exists' });
      }
      throw error;
    }

    // Assign profile if provided
    if (profileId) {
      await supabase
        .from('user_profile_assignments')
        .insert({ user_id: newUser.id, profile_id: profileId, assigned_by: req.user.id });
    }

    if (Array.isArray(permissionSetIds) && permissionSetIds.length) {
      await supabase.from('user_permission_set_assignments').insert(
        permissionSetIds.map(psId => ({
          user_id: newUser.id,
          perm_set_id: psId,
          assigned_by: req.user.id
        }))
      );
    }

    if (Array.isArray(permissionSetGroupIds) && permissionSetGroupIds.length) {
      await supabase.from('user_permission_set_group_assignments').insert(
        permissionSetGroupIds.map(groupId => ({
          user_id: newUser.id,
          group_id: groupId,
          assigned_by: req.user.id
        }))
      );
    }

    roleVisibilityCache.clear();

    await writeAuditLog({
      userId: req.user.id,
      userEmail: req.user.email,
      userRole: req.user.role,
      action: 'create_user',
      payload: { createdUserId: newUser.id, email: newUser.email, role: newUser.role },
      ipAddress: req.ip
    });

    res.status(201).json({ success: true, user: newUser });
  } catch (err) {
    console.error('POST /api/portal/users error:', err.message);
    res.status(err.statusCode || 500).json({ error: err.statusCode ? err.message : 'Could not create user' });
  }
});


// PATCH /api/portal/users/:id — update user (admin+ only)
app.patch('/api/portal/users/:id', checkAuth, checkRole('admin'), async (req, res) => {
  const { id } = req.params;
  const { role, isActive, profileId, mustChangePw, email, name, password, permissionSetIds, profileImage } = req.body || {};

  // Admins cannot modify system_administrator users (only system_administrator can)
  if (req.user.role !== 'system_administrator') {
    const { data: target } = await supabase
      .from('users')
      .select('role')
      .eq('id', id)
      .single();
    if (target?.role === 'system_administrator') {
      return res.status(403).json({ error: 'Only system administrators can modify system administrator accounts' });
    }
  }

  try {
    const updates = { updated_at: new Date().toISOString() };

    if (name     !== undefined && name.trim())     updates.name     = name.trim();
    if (role     !== undefined)                    updates.role     = role;
    if (isActive !== undefined)                    updates.is_active = isActive;
    if (mustChangePw !== undefined)                updates.must_change_pw = mustChangePw;
    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'profileImage')) {
      updates.profile_image = normalizeProfileImage(profileImage);
    }

    // Email update — check not already taken by another user
    if (email !== undefined && email.trim()) {
      const newEmail = email.toLowerCase().trim();
      const { data: existing, error: existingError } = await supabase
        .from('users')
        .select('id')
        .eq('email', newEmail)
        .neq('id', id)
        .maybeSingle();
      if (existingError) throw existingError;
      if (existing) {
        return res.status(409).json({ error: 'This email is already used by another user' });
      }
      updates.email = newEmail;
    }

    // Password change
    if (password) {
      if (password.length < 8) {
        return res.status(400).json({ error: 'Password must be at least 8 characters' });
      }
      updates.password_hash  = await bcrypt.hash(password, 12);
      updates.must_change_pw = false;
    }

    // Apply user field updates
    if (Object.keys(updates).length > 1) {
      const { error } = await supabase
        .from('users')
        .update(updates)
        .eq('id', id);
      if (error) throw error;
    }

    // Update profile assignment
    if (profileId) {
      await supabase
        .from('user_profile_assignments')
        .upsert(
          { user_id: id, profile_id: profileId, assigned_by: req.user.id, assigned_at: new Date().toISOString() },
          { onConflict: 'user_id' }
        );
    }

    // Sync permission sets
    if (Array.isArray(permissionSetIds)) {
      await supabase.from('user_permission_set_assignments').delete().eq('user_id', id);
      if (permissionSetIds.length) {
        await supabase.from('user_permission_set_assignments').insert(
          permissionSetIds.map(psId => ({
            user_id:     id,
            perm_set_id: psId,
            assigned_by: req.user.id
          }))
        );
      }
    }

    // Clear field perm cache
    clearFieldPermCache(id);

    await writeAuditLog({
      userId:    req.user.id,
      userEmail: req.user.email,
      userRole:  req.user.role,
      action:    'update_user',
      payload:   { targetUserId: id, changes: Object.keys(updates) },
      ipAddress: req.ip
    });

    const { data: updatedUser } = await supabase
      .from('users')
      .select('id, email, name, role, profile_image, is_active, must_change_pw, updated_at')
      .eq('id', id)
      .single();

    res.json({ success: true, user: updatedUser || null });
  } catch (err) {
    console.error('PATCH /api/portal/users error:', err.message);
    res.status(500).json({ error: err.message });
  }
});


// ── GET user's permission sets
// DELETE /api/portal/users/:id - permanently delete a portal user (admin+ only)
app.delete('/api/portal/users/:id', checkAuth, checkRole('admin'), async (req, res) => {
  const { id } = req.params;

  if (id === req.user.id) {
    return res.status(400).json({ error: 'You cannot delete your own account while logged in' });
  }

  try {
    const { data: target, error: targetError } = await supabase
      .from('users')
      .select('id, email, name, role')
      .eq('id', id)
      .single();

    if (targetError || !target) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (target.role === 'system_administrator' && req.user.role !== 'system_administrator') {
      return res.status(403).json({ error: 'Only System Administrators can delete System Administrator accounts' });
    }

    if (target.role === 'system_administrator') {
      const { count } = await supabase
        .from('users')
        .select('*', { count: 'exact', head: true })
        .eq('role', 'system_administrator')
        .neq('id', id);
      if (!count) {
        return res.status(409).json({ error: 'Cannot delete the last System Administrator account' });
      }
    }

    await supabase.from('user_permission_set_assignments').delete().eq('user_id', id);
    await supabase.from('user_permission_set_group_assignments').delete().eq('user_id', id);
    await supabase.from('user_profile_assignments').delete().eq('user_id', id);
    await supabase.from('password_reset_tokens').delete().eq('user_id', id);
    await supabase.from('public_group_members').delete().eq('user_id', id);

    await supabase.from('profiles').update({ created_by: req.user.id }).eq('created_by', id);
    await supabase.from('permission_sets').update({ created_by: req.user.id }).eq('created_by', id);
    await supabase.from('permission_set_groups').update({ created_by: req.user.id }).eq('created_by', id);
    await supabase.from('org_roles').update({ created_by: req.user.id }).eq('created_by', id);
    await supabase.from('public_groups').update({ created_by: req.user.id }).eq('created_by', id);
    await supabase.from('sharing_rules').update({ created_by: req.user.id }).eq('created_by', id);
    await supabase.from('user_permission_set_assignments').update({ assigned_by: req.user.id }).eq('assigned_by', id);
    await supabase.from('user_permission_set_group_assignments').update({ assigned_by: req.user.id }).eq('assigned_by', id);
    await supabase.from('user_profile_assignments').update({ assigned_by: req.user.id }).eq('assigned_by', id);

    const { error: auditUpdateError } = await supabase
      .from('audit_log')
      .update({ user_id: null })
      .eq('user_id', id);
    if (auditUpdateError) {
      await supabase.from('audit_log').delete().eq('user_id', id);
    }

    const { error: deleteError } = await supabase
      .from('users')
      .delete()
      .eq('id', id);
    if (deleteError) throw deleteError;

    await writeAuditLog({
      userId: req.user.id,
      userEmail: req.user.email,
      userRole: req.user.role,
      action: 'delete_user',
      payload: { deletedUserId: id, email: target.email, role: target.role },
      ipAddress: req.ip
    });

    clearFieldPermCache(id);
    res.json({ success: true });
  } catch (err) {
    console.error('DELETE /api/portal/users error:', err.message);
    res.status(500).json({ error: 'Could not delete user' });
  }
});

app.get('/api/portal/users/:id/permission-sets', checkAuth, checkRole('admin'), async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('user_permission_set_assignments')
      .select('perm_set_id, permission_sets(id, name, description)')
      .eq('user_id', req.params.id);
    if (error) throw error;
    res.json({ permissionSets: (data || []).map(r => r.permission_sets).filter(Boolean) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});


// ── POST /api/portal/profiles
app.post('/api/portal/profiles', checkAuth, checkRole('admin'), async (req, res) => {
  const { name, description, permissions = [] } = req.body || {};
  if (!name) return res.status(400).json({ error: 'Profile name is required' });
  try {
    const { data: profile, error } = await supabase
      .from('profiles')
      .insert({ name: name.trim(), description: description?.trim() || null, created_by: req.user.id })
      .select('id').single();
    if (error) throw error;
    if (permissions.length) {
      await supabase.from('profile_object_permissions').insert(
        permissions.map(p => ({ profile_id: profile.id, ...p }))
      );
    }
    await writeAuditLog({ userId: req.user.id, userEmail: req.user.email, userRole: req.user.role, action: 'create_profile', payload: { name }, ipAddress: req.ip });
    res.status(201).json({ success: true, id: profile.id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── PATCH /api/portal/profiles/:id
app.patch('/api/portal/profiles/:id', checkAuth, checkRole('admin'), async (req, res) => {
  const { name, description, permissions = [] } = req.body || {};
  try {
    if (name) await supabase.from('profiles').update({ name, description: description || null }).eq('id', req.params.id);
    if (permissions.length) {
      await supabase.from('profile_object_permissions').delete().eq('profile_id', req.params.id);
      await supabase.from('profile_object_permissions').insert(
        permissions.map(p => ({ profile_id: req.params.id, ...p }))
      );
    }
    await writeAuditLog({ userId: req.user.id, userEmail: req.user.email, userRole: req.user.role, action: 'update_profile', payload: { id: req.params.id, name }, ipAddress: req.ip });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── DELETE /api/portal/profiles/:id
app.delete('/api/portal/profiles/:id', checkAuth, checkRole('admin'), async (req, res) => {
  try {
    const { count } = await supabase.from('user_profile_assignments').select('*', { count: 'exact', head: true }).eq('profile_id', req.params.id);
    if (count > 0) return res.status(409).json({ error: 'Cannot delete a profile that is assigned to users' });
    await supabase.from('profile_object_permissions').delete().eq('profile_id', req.params.id);
    await supabase.from('profiles').delete().eq('id', req.params.id);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── POST /api/portal/permission-sets
app.post('/api/portal/permission-sets', checkAuth, checkRole('admin'), async (req, res) => {
  const { name, description, permissions = [] } = req.body || {};
  if (!name) return res.status(400).json({ error: 'Name is required' });
  try {
    const { data: ps, error } = await supabase
      .from('permission_sets')
      .insert({ name: name.trim(), description: description?.trim() || null, created_by: req.user.id })
      .select('id').single();
    if (error) throw error;
    if (permissions.length) {
      await supabase.from('permission_set_object_perms').insert(
        permissions.map(p => ({ perm_set_id: ps.id, ...p }))
      );
    }
    await writeAuditLog({ userId: req.user.id, userEmail: req.user.email, userRole: req.user.role, action: 'create_perm_set', payload: { name }, ipAddress: req.ip });
    res.status(201).json({ success: true, id: ps.id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── PATCH /api/portal/permission-sets/:id
app.patch('/api/portal/permission-sets/:id', checkAuth, checkRole('admin'), async (req, res) => {
  const { name, description, permissions = [] } = req.body || {};
  try {
    if (name) await supabase.from('permission_sets').update({ name, description: description || null }).eq('id', req.params.id);
    if (Array.isArray(permissions)) {
      await supabase.from('permission_set_object_perms').delete().eq('perm_set_id', req.params.id);
      if (permissions.length) {
        await supabase.from('permission_set_object_perms').insert(
          permissions.map(p => ({ perm_set_id: req.params.id, ...p }))
        );
      }
    }
    await writeAuditLog({ userId: req.user.id, userEmail: req.user.email, userRole: req.user.role, action: 'update_perm_set', payload: { id: req.params.id }, ipAddress: req.ip });
    clearAllFieldPermCache();
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── DELETE /api/portal/permission-sets/:id
app.delete('/api/portal/permission-sets/:id', checkAuth, checkRole('admin'), async (req, res) => {
  try {
    await supabase.from('user_permission_set_assignments').delete().eq('perm_set_id', req.params.id);
    await supabase.from('permission_set_group_members').delete().eq('perm_set_id', req.params.id);
    await supabase.from('permission_set_object_perms').delete().eq('perm_set_id', req.params.id);
    await supabase.from('permission_sets').delete().eq('id', req.params.id);
    clearAllFieldPermCache();
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

function auditFilterValues(query = {}) {
  const filters = {};
  const search = String(query.search || '').trim();
  const action = String(query.action || '').trim();
  const range = String(query.range || '').trim();
  const from = String(query.from || '').trim();
  const to = String(query.to || '').trim();

  if (search) filters.search = search;
  if (action) filters.action = action;

  if (range && range !== 'all' && range !== 'custom') {
    const days = Math.min(Math.max(parseInt(range, 10) || 30, 1), 3650);
    filters.fromIso = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  }

  if (range === 'custom') {
    if (from) filters.fromIso = new Date(`${from}T00:00:00.000Z`).toISOString();
    if (to) filters.toIso = new Date(`${to}T23:59:59.999Z`).toISOString();
  }

  return filters;
}

function applyAuditFilters(query, filters = {}) {
  let q = query;
  if (filters.action) q = q.eq('action', filters.action);
  if (filters.fromIso) q = q.gte('created_at', filters.fromIso);
  if (filters.toIso) q = q.lte('created_at', filters.toIso);
  if (filters.search) {
    const safe = filters.search.replace(/[%_,]/g, char => `\\${char}`);
    q = q.or(`user_email.ilike.%${safe}%,action.ilike.%${safe}%`);
  }
  return q;
}

// ── GET /api/portal/audit-log
app.get('/api/portal/audit-log', checkAuth, checkRole('admin'), async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 50, 50);
    const offset = Math.max(parseInt(req.query.offset) || 0, 0);
    const filters = auditFilterValues(req.query);
    const base = supabase
      .from('audit_log')
      .select('id, created_at, user_email, user_role, action', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);
    const { data, error, count } = await applyAuditFilters(base, filters);
    if (error) throw error;
    res.json({ logs: data || [], total: count || 0, limit, offset });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/portal/audit-log', checkAuth, checkRole('system_administrator'), async (req, res) => {
  try {
    const rawIds = Array.isArray(req.body?.ids) ? req.body.ids : [];
    const ids = rawIds.map(id => Number(id)).filter(Number.isFinite).slice(0, 50);

    if (ids.length) {
      const { error, count } = await supabase
        .from('audit_log')
        .delete({ count: 'exact' })
        .in('id', ids);
      if (error) throw error;
      return res.json({ success: true, deleted: count || ids.length });
    }

    const filters = auditFilterValues(req.query);
    if (!Object.keys(filters).length) {
      return res.status(400).json({ error: 'Select rows or apply a filter before deleting audit logs.' });
    }

    const base = supabase
      .from('audit_log')
      .delete({ count: 'exact' });
    const { error, count } = await applyAuditFilters(base, filters);
    if (error) throw error;
    res.json({ success: true, deleted: count || 0 });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET sensitive fields for an object
app.get('/api/portal/field-security/sensitive', checkAuth, checkRole('admin'), async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('sensitive_fields')
      .select('id, field_name, label, reason')
      .eq('sf_object', req.query.object)
      .order('field_name');
    if (error) throw error;
    res.json({ fields: data || [] });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/portal/field-security/available-fields', checkAuth, checkRole('admin'), async (req, res) => {
  const sfObject = req.query.object;
  if (!OBJECTS[sfObject]) return res.status(400).json({ error: 'Unknown object' });
  try {
    const data = await sfGet(`/sobjects/${sfObject}/describe`);
    const fields = (data.fields || [])
      .filter(field => !field.deprecatedAndHidden)
      .filter(field => !['address', 'location'].includes(field.type))
      .map(field => ({
        name: field.name,
        label: field.label,
        type: field.type,
        createable: field.createable,
        updateable: field.updateable
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
    res.json({ fields });
  } catch (e) {
    handleSFError(e, res, `Describe fields ${sfObject}`);
  }
});

app.post('/api/portal/field-security/sensitive', checkAuth, checkRole('admin'), async (req, res) => {
  const { sfObject, fieldName, label, reason } = req.body || {};
  if (!OBJECTS[sfObject] || !fieldName || !label) {
    return res.status(400).json({ error: 'sfObject, fieldName, and label are required' });
  }
  try {
    const { data, error } = await supabase
      .from('sensitive_fields')
      .upsert(
        {
          sf_object: sfObject,
          field_name: fieldName,
          label: label.trim(),
          reason: reason?.trim() || null
        },
        { onConflict: 'sf_object,field_name' }
      )
      .select('id, field_name, label, reason')
      .single();
    if (error) throw error;
    clearAllFieldPermCache();
    res.status(201).json({ success: true, field: data });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.patch('/api/portal/field-security/sensitive/:id', checkAuth, checkRole('admin'), async (req, res) => {
  const { label, reason } = req.body || {};
  if (!label?.trim()) return res.status(400).json({ error: 'Label is required' });
  try {
    const { data, error } = await supabase
      .from('sensitive_fields')
      .update({ label: label.trim(), reason: reason?.trim() || null })
      .eq('id', req.params.id)
      .select('id, field_name, label, reason')
      .single();
    if (error) throw error;
    clearAllFieldPermCache();
    res.json({ success: true, field: data });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/portal/field-security/sensitive/:id', checkAuth, checkRole('admin'), async (req, res) => {
  try {
    const { data: field, error: fieldError } = await supabase
      .from('sensitive_fields')
      .select('sf_object, field_name')
      .eq('id', req.params.id)
      .single();
    if (fieldError) throw fieldError;

    await supabase
      .from('field_permissions')
      .delete()
      .eq('sf_object', field.sf_object)
      .eq('field_name', field.field_name);

    const { error } = await supabase
      .from('sensitive_fields')
      .delete()
      .eq('id', req.params.id);
    if (error) throw error;
    clearAllFieldPermCache();
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET field permissions for a profile on an object
app.get('/api/portal/field-security/permissions', checkAuth, checkRole('admin'), async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('field_permissions')
      .select('field_name, can_view, can_edit')
      .eq('profile_id', req.query.profileId)
      .eq('sf_object', req.query.object);
    if (error) throw error;
    res.json({ permissions: data || [] });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST save field permissions for a profile on an object
app.post('/api/portal/field-security/permissions', checkAuth, checkRole('admin'), async (req, res) => {
  const { profileId, sfObject, permissions = [] } = req.body || {};
  if (!profileId || !sfObject) {
    return res.status(400).json({ error: 'profileId and sfObject are required' });
  }
  try {
    // Delete existing then reinsert
    await supabase
      .from('field_permissions')
      .delete()
      .eq('profile_id', profileId)
      .eq('sf_object', sfObject);

    const toInsert = permissions
      .filter(p => p.can_view || p.can_edit)
      .map(p => ({
        profile_id: profileId,
        sf_object: sfObject,
        field_name: p.field_name,
        can_view: p.can_view,
        can_edit: p.can_edit && p.can_view // can_edit requires can_view
      }));

    if (toInsert.length) {
      const { error } = await supabase.from('field_permissions').insert(toInsert);
      if (error) throw error;
    }
    clearAllFieldPermCache();

    await writeAuditLog({
      userId: req.user.id, userEmail: req.user.email,
      userRole: req.user.role, action: 'update_profile',
      payload: { type: 'field_security', profileId, sfObject },
      ipAddress: req.ip
    });

    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});


// GET /api/portal/profiles — list all profiles (admin+ only)
app.get('/api/portal/profiles', checkAuth, checkRole('admin'), async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('profiles')
      .select(`
        id, name, description, is_active, created_at,
        profile_object_permissions ( sf_object, can_read, can_create, can_edit, can_delete )
      `)
      .order('name');

    if (error) throw error;
    res.json({ profiles: data || [] });
  } catch (err) {
    console.error('GET /api/portal/profiles error:', err.message);
    res.status(500).json({ error: 'Could not load profiles' });
  }
});


// GET /api/portal/users — list all portal users (admin+ only)
app.get('/api/portal/users', checkAuth, checkRole('admin'), async (req, res) => {
  try {
    const { data, error } = await supabase.rpc('get_portal_users');
    if (error) throw error;

    const users = data || [];
    const userIds = users.map((u) => u.id);
    let permissionSetsByUserId = {};
    let profileImagesByUserId = {};

    if (userIds.length) {
      const { data: imageRows, error: imageError } = await supabase
        .from('users')
        .select('id, profile_image')
        .in('id', userIds);
      if (imageError) throw imageError;
      profileImagesByUserId = Object.fromEntries((imageRows || []).map((row) => [row.id, row.profile_image || null]));

      const { data: assignments, error: assignmentsError } = await supabase
        .from('user_permission_set_assignments')
        .select('user_id, perm_set_id')
        .in('user_id', userIds);

      if (assignmentsError) throw assignmentsError;

      const permissionSetIds = [...new Set((assignments || []).map((row) => row.perm_set_id))];
      let permissionSetById = {};

      if (permissionSetIds.length) {
        const { data: permissionSets, error: permissionSetsError } = await supabase
          .from('permission_sets')
          .select('id, name, description')
          .in('id', permissionSetIds);

        if (permissionSetsError) throw permissionSetsError;
        permissionSetById = Object.fromEntries((permissionSets || []).map((ps) => [ps.id, ps]));
      }

      permissionSetsByUserId = (assignments || []).reduce((acc, row) => {
        const permissionSet = permissionSetById[row.perm_set_id];
        if (!permissionSet) return acc;
        if (!acc[row.user_id]) acc[row.user_id] = [];
        acc[row.user_id].push(permissionSet);
        return acc;
      }, {});
    }
    res.json({
      users: users.map(u => ({
        id: u.id,
        email: u.email,
        name: u.name,
        role: u.role,
        isSystemAdmin: u.is_system_admin || false,
        profileImage: profileImagesByUserId[u.id] || u.profile_image || null,
        isActive: u.is_active,
        mustChangePw: u.must_change_pw,
        createdAt: u.created_at,
        lastLoginAt: u.last_login_at,
        org_role_id: u.org_role_id || null,
        orgRoleId: u.org_role_id || null,
        org_role_name: u.org_role_name || null,
        orgRoleName: u.org_role_name || null,
        orgRoleLevel: u.org_role_level || null,
        profile: u.profile_id ? {
          id: u.profile_id,
          name: u.profile_name,
          isSystemAdmin: u.is_system_admin || false
        } : null,
        permissionSets: permissionSetsByUserId[u.id] || []
      }))
    });
  } catch (err) {
    console.error('GET /api/portal/users error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/portal/permission-sets — list all permission sets (admin+ only)
// THIS WAS MISSING — it was accidentally replaced by a duplicate users route
app.get('/api/portal/permission-sets', checkAuth, checkRole('admin'), async (req, res) => {
  try {
    const { data: permissionSets, error } = await supabase
      .from('permission_sets')
      .select('id, name, description, is_active, created_at')
      .order('name');

    if (error) throw error;

    const ids = (permissionSets || []).map((ps) => ps.id);
    let permissionsBySetId = {};
    let assignedUserCountBySetId = {};

    if (ids.length) {
      const [
        { data: permissions, error: permissionsError },
        { data: assignments, error: assignmentsError }
      ] = await Promise.all([
        supabase
          .from('permission_set_object_perms')
          .select('perm_set_id, sf_object, can_read, can_create, can_edit, can_delete')
          .in('perm_set_id', ids),
        supabase
          .from('user_permission_set_assignments')
          .select('perm_set_id, user_id')
          .in('perm_set_id', ids)
      ]);

      if (permissionsError) throw permissionsError;
      if (assignmentsError) throw assignmentsError;

      permissionsBySetId = (permissions || []).reduce((acc, permission) => {
        const { perm_set_id, ...rest } = permission;
        if (!acc[perm_set_id]) acc[perm_set_id] = [];
        acc[perm_set_id].push(rest);
        return acc;
      }, {});

      assignedUserCountBySetId = (assignments || []).reduce((acc, assignment) => {
        acc[assignment.perm_set_id] = (acc[assignment.perm_set_id] || 0) + 1;
        return acc;
      }, {});
    }

    res.json({
      permissionSets: (permissionSets || []).map((ps) => ({
        ...ps,
        assignedUserCount: assignedUserCountBySetId[ps.id] || 0,
        permission_set_object_perms: permissionsBySetId[ps.id] || []
      }))
    });
  } catch (err) {
    console.error('GET /api/portal/permission-sets error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Auth test
app.get('/api/auth/test', checkAuth, async (req, res) => {
  try {
    await getAccessToken();
    res.json({ success: true, instance: SF.instanceUrl, connectUrl: '/auth/salesforce', org: publicOrg(activeOrg()) });
  } catch (err) {
    res.status(401).json({ success: false, error: err.message, connectUrl: '/auth/salesforce', org: publicOrg(activeOrg()) });
  }
});

app.get('/api/auth/config', (req, res) => {
  res.json({
    loginUrl: SF.loginUrl,
    instanceUrl: SF.instanceUrl,
    redirectUri: requestRedirectUri(req),
    hasClientId: Boolean(SF.clientId),
    hasClientSecret: Boolean(SF.clientSecret),
    hasRefreshToken: Boolean(SF.refreshToken)
  });
});

app.get('/api/auth/orgs', (req, res) => {
  res.json({
    activeOrgKey: orgStore.activeOrgKey,
    orgs: Object.values(orgStore.orgs).map(publicOrg)
  });
});

app.post('/api/auth/orgs', (req, res) => {
  const body = req.body || {};
  const key = sanitizeOrgKey(body.key || body.label);
  if (!key) return res.status(400).json({ error: 'Org key or label is required' });

  const existing = orgStore.orgs[key] || {};
  const loginUrl = normalizeUrl(body.loginUrl || (
    body.environment === 'sandbox' ? 'https://test.salesforce.com' : 'https://login.salesforce.com'
  ));
  const org = {
    ...existing,
    key,
    label: String(body.label || existing.label || key).trim(),
    environment: body.environment === 'sandbox' ? 'sandbox' : 'production',
    clientId: String(body.clientId || existing.clientId || '').trim(),
    clientSecret: body.clientSecret ? String(body.clientSecret).trim() : (existing.clientSecret || ''),
    refreshToken: existing.refreshToken || '',
    instanceUrl: normalizeUrl(body.instanceUrl || existing.instanceUrl || ''),
    loginUrl,
    redirectUri: body.redirectUri || requestRedirectUri(req, existing)
  };

  if (!org.clientId) return res.status(400).json({ error: 'Client ID is required' });
  if (!org.clientSecret) return res.status(400).json({ error: 'Client secret is required' });

  orgStore.orgs[key] = org;
  switchActiveOrg(key);
  res.json({ success: true, activeOrgKey: orgStore.activeOrgKey, org: publicOrg(org) });
});

app.post('/api/auth/orgs/active', (req, res) => {
  try {
    const org = switchActiveOrg(req.body?.key);
    res.json({ success: true, activeOrgKey: orgStore.activeOrgKey, org: publicOrg(org) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/email/from-addresses', async (req, res) => {
  try {
    const context = await getEmailMergeContext();
    const records = [{
      type: 'user',
      id: context.sender.Id || '',
      label: context.sender.Name || 'Current User',
      email: context.sender.Email || ''
    }];
    try {
      const orgWide = await sfGet('/query', {
        q: 'SELECT Id, Address, DisplayName FROM OrgWideEmailAddress ORDER BY DisplayName LIMIT 100'
      });
      records.push(...(orgWide.records || []).map((item) => ({
        type: 'orgwide',
        id: item.Id,
        label: item.DisplayName || item.Address,
        email: item.Address
      })));
    } catch {
      // Some orgs do not expose OrgWideEmailAddress to the connected user.
    }
    res.json({ records });
  } catch (err) {
    handleSFError(err, res, 'Email from addresses');
  }
});

app.get('/api/email/templates', async (req, res) => {
  try {
    const records = await queryClassicEmailTemplates(req.query.limit || 500);
    res.json({ records });
  } catch (err) {
    handleSFError(err, res, 'Email templates');
  }
});

app.post('/api/email/template-preview', async (req, res) => {
  const { templateId, recipientId, recipientObject, relatedRecordId, relatedObject } = req.body || {};
  if (!templateId) return res.status(400).json({ error: 'Select an email template' });

  try {
    const [template, context, recipient, related] = await Promise.all([
      sfGet(`/sobjects/EmailTemplate/${templateId}`),
      getEmailMergeContext(),
      getEmailRecipientContext(recipientObject, recipientId),
      getRelatedMergeRecord(relatedObject, relatedRecordId)
    ]);
    const body = emailTemplateBody(template);
    const subject = mergeTemplate(emailTemplateSubject(template), recipient, related, context.sender, context.organization);
    const html = mergeTemplate(body, recipient, related, context.sender, context.organization);
    res.json({ subject, html, text: stripHtml(html) || html });
  } catch (err) {
    handleSFError(err, res, 'Email template preview');
  }
});

app.get('/api/activity-email-templates', async (req, res) => {
  try {
    const records = await queryClassicEmailTemplates(req.query.limit || 500);
    res.json({ records });
  } catch (err) {
    handleSFError(err, res, 'Activity email templates');
  }
});

app.post('/api/activity-email-preview', async (req, res) => {
  const { templateId, recipientId, recipientObject, relatedRecordId, relatedObject } = req.body || {};
  if (!templateId) return res.status(400).json({ error: 'Select an email template' });

  try {
    const [template, context, recipient, related] = await Promise.all([
      sfGet(`/sobjects/EmailTemplate/${templateId}`),
      getEmailMergeContext(),
      getEmailRecipientContext(recipientObject, recipientId),
      getRelatedMergeRecord(relatedObject, relatedRecordId)
    ]);
    const body = emailTemplateBody(template);
    const subject = mergeTemplate(emailTemplateSubject(template), recipient, related, context.sender, context.organization);
    const html = mergeTemplate(body, recipient, related, context.sender, context.organization);
    res.json({ subject, html, text: stripHtml(html) || html });
  } catch (err) {
    handleSFError(err, res, 'Activity email preview');
  }
});

// Portal logout — only clears JWT session, does NOT touch Salesforce
app.post('/api/auth/logout', async (req, res) => {
  // Just clear the portal session — Salesforce stays connected
  // The JWT is stateless so "logout" = client deletes the token
  // Optionally log the action if user is authenticated
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (token) {
      const decoded = jwt.verify(token, JWT_SECRET);
      await writeAuditLog({
        userId: decoded.id,
        userEmail: decoded.email,
        userRole: decoded.role,
        action: 'logout',
        ipAddress: req.ip
      });
    }
  } catch { /* token already expired, that's fine */ }

  res.json({ success: true, message: 'Portal session ended' });
});

// Salesforce logout — SEPARATE route, system_administrator only
app.post('/api/auth/salesforce-logout', checkAuth, checkRole('system_administrator'), async (req, res) => {
  const tokenToRevoke = SF.refreshToken || _cachedToken;
  try {
    if (tokenToRevoke) {
      const params = new URLSearchParams({ token: tokenToRevoke });
      await axios.post(`${SF.loginUrl}/services/oauth2/revoke`, params.toString(), {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        timeout: 30000
      });
    }
  } catch (err) {
    console.error('SF logout warning:', err.response?.data || err.message);
  }
  SF.refreshToken = '';
  _cachedToken = null;
  _tokenExpires = 0;
  activeOrg().refreshToken = '';
  persistActiveOrgTokens();
  res.json({ success: true });
});

app.get('/api/me', checkAuth, async (req, res) => {
  try {
    const data = await sfGet('/chatter/users/me');
    res.json({
      id: data.id,
      name: data.name,
      email: data.email,
      username: data.username,
      title: data.title,
      photo: data.photo?.smallPhotoUrl || null
    });
  } catch (err) {
    handleSFError(err, res, 'GET current user');
  }
});

// Start OAuth login to generate a fresh refresh token
app.get('/auth/salesforce', (req, res) => {
  if (req.query.org) {
    try {
      switchActiveOrg(req.query.org);
    } catch (err) {
      return res.status(400).send(err.message);
    }
  }

  if (!SF.clientId || !SF.loginUrl) {
    return res.status(500).send('Missing SF_CLIENT_ID or SF_LOGIN_URL in .env');
  }

  const state = crypto.randomBytes(16).toString('hex');
  const pkce = createPkcePair();
  const redirectUri = requestRedirectUri(req);
  SF.redirectUri = redirectUri;
  oauthStates.set(state, {
    orgKey: orgStore.activeOrgKey,
    redirectUri,
    codeVerifier: pkce.verifier,
    createdAt: Date.now()
  });

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: SF.clientId,
    redirect_uri: redirectUri,
    scope: 'api refresh_token offline_access',
    state,
    code_challenge: pkce.challenge,
    code_challenge_method: 'S256'
  });

  res.redirect(`${SF.loginUrl}/services/oauth2/authorize?${params.toString()}`);
});

app.use('/api/reports', createReportsRouter({
  checkAuth,
  deps: {
    objects: OBJECTS,
    sfGet,
    escapeSOQL,
    getObjectFieldSet,
    getEffectivePermissions,
    getEffectiveFieldPerms,
    buildReadableRecordScopeFilter,
    hydrateRecordOwners,
    applyRecordVisibility,
    applyFieldSecurity,
    permissionDeniedMessage,
    queryBatchHeaders: QUERY_BATCH_HEADERS
  }
}));

app.use('/api/dashboards', createDashboardsRouter({
  checkAuth,
  deps: {
    objects: OBJECTS,
    sfGet,
    escapeSOQL,
    getObjectFieldSet,
    getEffectivePermissions,
    getEffectiveFieldPerms,
    buildReadableRecordScopeFilter,
    hydrateRecordOwners,
    applyRecordVisibility,
    applyFieldSecurity,
    permissionDeniedMessage,
    queryBatchHeaders: QUERY_BATCH_HEADERS
  }
}));

// Salesforce redirects here after login
app.get('/oauth/callback', async (req, res) => {
  const { code, error, error_description, state } = req.query;
  if (error) {
    return res.status(400).send(`<h1>Salesforce connection failed</h1><p>${error}: ${error_description || ''}</p>`);
  }

  if (!code) {
    return res.status(400).send('<h1>Salesforce connection failed</h1><p>No authorization code received.</p>');
  }

  try {
    const oauthState = oauthStates.get(state);
    oauthStates.delete(state);

    if (!oauthState) {
      throw new Error('OAuth state was not found. Start again from /auth/salesforce.');
    }
    switchActiveOrg(oauthState.orgKey);
    SF.redirectUri = oauthState.redirectUri || requestRedirectUri(req);

    const params = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: SF.clientId,
      client_secret: SF.clientSecret,
      redirect_uri: SF.redirectUri,
      code,
      code_verifier: oauthState.codeVerifier
    });

    const tokenRes = await axios.post(
      `${SF.loginUrl}/services/oauth2/token`,
      params.toString(),
      {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        timeout: 30000
      }
    );

    if (!tokenRes.data.refresh_token) {
      throw new Error('Salesforce did not return a refresh token. Check the Connected App OAuth scopes include refresh_token/offline_access.');
    }

    SF.refreshToken = tokenRes.data.refresh_token;
    SF.instanceUrl = normalizeUrl(tokenRes.data.instance_url || SF.instanceUrl);
    _cachedToken = tokenRes.data.access_token || null;
    _tokenExpires = _cachedToken ? Date.now() + 55 * 60 * 1000 : 0;

    persistActiveOrgTokens();

    res.send(`
      <h1>Salesforce connected</h1>
      <p>Your refresh token was saved locally. You can close this tab and return to the app.</p>
      <script>
        setTimeout(() => { window.location.href = '/'; }, 1200);
      </script>
    `);
  } catch (err) {
    const detail = err.response?.data;
    const msg = detail?.error_description || err.message || 'OAuth callback failed';
    console.error('OAuth callback error:', detail || err.message);
    res.status(500).send(`<h1>Salesforce connection failed</h1><p>${msg}</p>`);
  }
});

app.get('/api/lookup/:object', checkAuth, async (req, res) => {
  const { object } = req.params;
  const search = String(req.query.search || '').trim().replace(/'/g, "\\'");
  const requestId = `lookup-${++securityPerfSeq}`;
  const requestStartedAt = performance.now();

  if (!OBJECTS[object]) return res.status(400).json({ error: `Unknown object: ${object}` });

  try {
    if (!isFullAccessUser(req.user)) {
      const perms = await getEffectivePermissions(req.user.id, object);
      if (!perms?.can_read) {
        return res.status(403).json({
          error: permissionDeniedMessage(),
          code: 'PERMISSION_DENIED'
        });
      }
    }

    const availableFields = await getObjectFieldSet(object);
    const searchFields = OBJECTS[object].searchFields || ['Name'];
    const where = search
      ? `WHERE ${searchFields.filter((field) => availableFields.has(field)).map((field) => `${field} LIKE '%${search}%'`).join(' OR ')}`
      : '';
    const fields = {
      Case: 'Id, CaseNumber, Subject, AccountId, Account.Name',
      Contact: 'Id, Name, Email, AccountId, Account.Name',
      Lead: 'Id, Name, Email, Company',
      User: 'Id, Name, Email, Username',
      Opportunity: 'Id, Name, AccountId, Account.Name'
    }[object] || OBJECTS[object].fields;
    const selectFields = await fieldsCsvForObject(object, fields);
    const sfStartedAt = performance.now();
    const data = await sfGet('/query', {
      q: `SELECT ${selectFields} FROM ${object} ${where === 'WHERE ' ? '' : where} ORDER BY ${OBJECTS[object].orderBy} LIMIT 25`
    });
    const sfMs = msSince(sfStartedAt);
    const visibleRecords = await applyRecordVisibility(
      data.records || [],
      req.user.id,
      req.user.role,
      object,
      req.user.isSystemAdmin,
      requestId
    );
    res.json({
      records: visibleRecords.map((record) => ({
        ...record,
        Name: record.Name || record.Subject || record.CaseNumber || record.Id
      }))
    });
    securityPerfLog(requestId, 'GET lookup', {
      object,
      sfRecords: data.records?.length || 0,
      evaluated: data.records?.length || 0,
      visible: visibleRecords.length,
      sfMs,
      totalMs: msSince(requestStartedAt)
    });
  } catch (err) {
    handleSFError(err, res, `Lookup ${object}`);
  }
});

app.get('/api/:object/listviews', checkAuth, async (req, res) => {
  const { object } = req.params;
  if (!OBJECTS[object]) return res.status(400).json({ error: `Unknown object: ${object}` });

  try {
    const data = await sfGet(`/sobjects/${object}/listviews`);
    res.json(data);
  } catch (err) {
    handleSFError(err, res, `List views ${object}`);
  }
});

app.get('/api/:object/count', checkAuth, async (req, res, next) => {
  const { object } = req.params;
  if (OBJECTS[object]) return checkPermission(object, 'can_read')(req, res, next);
  next();
}, async (req, res) => {
  const { object } = req.params;
  if (!OBJECTS[object]) return res.status(400).json({ error: `Unknown object: ${object}` });

  try {
    const owdAccess = await getOrgWideDefaultAccess(object);
    if (!isFullAccessUser(req.user) && !['public_read', 'public_read_write'].includes(owdAccess)) {
      return res.json({
        object,
        totalSize: null,
        filtered: true,
        message: 'Counts are hidden when role hierarchy filtering is active.'
      });
    }

    const soql = await buildCountSOQL(object, req.query.search, req.query.where);
    const data = await sfGet(req.query.all === 'true' ? '/queryAll' : '/query', { q: soql });
    const countValue = Number(data.records?.[0]?.expr0 ?? data.totalSize ?? 0);
    res.json({
      object,
      totalSize: countValue,
      org: publicOrg(activeOrg()),
      queryAll: req.query.all === 'true'
    });
  } catch (err) {
    handleSFError(err, res, `Count ${object}`);
  }
});

app.get('/api/debug/data-source', checkAuth, requireAdminPanel, async (req, res) => {
  try {
    const results = {};
    for (const objectName of ['Account', 'Contact', 'Opportunity', 'Case', 'Lead', 'Campaign']) {
      const soql = await buildCountSOQL(objectName);
      const data = await sfGet('/query', { q: soql });
      results[objectName] = Number(data.records?.[0]?.expr0 ?? data.totalSize ?? 0);
    }
    res.json({
      org: publicOrg(activeOrg()),
      instance: SF.instanceUrl,
      counts: results
    });
  } catch (err) {
    handleSFError(err, res, 'Data source debug');
  }
});

app.get('/api/:object/listviews/:id/results', checkAuth, async (req, res, next) => {
  const obj = req.params.object;
  if (OBJECTS[obj]) return attachFieldPerms(obj)(req, res, next);
  next();
}, async (req, res) => {
  const { object, id } = req.params;
  if (!OBJECTS[object]) return res.status(400).json({ error: `Unknown object: ${object}` });
  const requestId = `listview-${++securityPerfSeq}`;
  const requestStartedAt = performance.now();

  try {
    if (req.query.cursor) {
      const sfStartedAt = performance.now();
      const data = await sfGet(queryMoreEndpoint(req.query.cursor), {}, { headers: QUERY_BATCH_HEADERS });
      const sfMs = msSince(sfStartedAt);
      const ownerStartedAt = performance.now();
      const ownedRecords = await hydrateRecordOwners(data.records || [], object);
      const ownerMs = msSince(ownerStartedAt);
      const visibleRecords = await applyRecordVisibility(
        ownedRecords,
        req.user.id,
        req.user.role,
        object,
        req.user.isSystemAdmin,
        requestId
      );
      const records = visibleRecords.map(record => applyFieldSecurity(record, req.fieldPerms));
      const owdAccess = await getOrgWideDefaultAccess(object);
      const canUseSalesforceTotal = req.user.isSystemAdmin || ['public_read', 'public_read_write'].includes(owdAccess);
      securityPerfLog(requestId, 'GET listview cursor', {
        object,
        sfRecords: data.records?.length || 0,
        evaluated: ownedRecords.length,
        visible: records.length,
        sfMs,
        ownerMs,
        totalMs: msSince(requestStartedAt)
      });
      return res.json({
        records,
        totalSize: canUseSalesforceTotal ? (data.totalSize || 0) : records.length,
        done: Boolean(data.done),
        nextRecordsUrl: data.nextRecordsUrl || null,
        hiddenFields: [...(req.fieldPerms?.hiddenFields || [])]
      });
    }

    const describeStartedAt = performance.now();
    const detail = await sfGet(`/sobjects/${object}/listviews/${id}/describe`);
    const scope = await buildReadableRecordScopeFilter(object, req.user, requestId);
    const scopedQuery = appendExtraWhereToSOQL(detail.query, scope.clause);
    const sfStartedAt = performance.now();
    const data = await sfGet('/query', { q: scopedQuery }, { headers: QUERY_BATCH_HEADERS });
    const sfMs = msSince(sfStartedAt);
    const ownerStartedAt = performance.now();
    const ownedRecords = await hydrateRecordOwners(data.records || [], object);
    const ownerMs = msSince(ownerStartedAt);
    const visibleRecords = await applyRecordVisibility(
      ownedRecords,
      req.user.id,
      req.user.role,
      object,
      req.user.isSystemAdmin,
      requestId
    );
    const records = visibleRecords.map(record => applyFieldSecurity(record, req.fieldPerms));
    const hiddenFields = new Set(req.fieldPerms?.hiddenFields || []);
    const owdAccess = await getOrgWideDefaultAccess(object);
    const canUseSalesforceTotal = req.user.isSystemAdmin || ['public_read', 'public_read_write'].includes(owdAccess);
    res.json({
      label: detail.label,
      columns: (detail.columns || []).filter(column => !hiddenFields.has(column.fieldNameOrPath)),
      query: detail.query,
      records,
      totalSize: canUseSalesforceTotal ? (data.totalSize || 0) : records.length,
      done: Boolean(data.done),
      nextRecordsUrl: data.nextRecordsUrl || null,
      hiddenFields: [...hiddenFields]
    });
    securityPerfLog(requestId, 'GET listview', {
      object,
      scope: scope.reason,
      sfRecords: data.records?.length || 0,
      evaluated: ownedRecords.length,
      visible: records.length,
      describeMs: msSince(describeStartedAt),
      sfMs,
      ownerMs,
      totalMs: msSince(requestStartedAt)
    });
  } catch (err) {
    handleSFError(err, res, `List view results ${object}/${id}`);
  }
});

app.get('/api/:object/fields', checkAuth, async (req, res, next) => {
  const obj = req.params.object;
  if (OBJECTS[obj]) return attachFieldPerms(obj)(req, res, next);
  next();
}, async (req, res) => {
  const { object } = req.params;
  if (!OBJECTS[object]) return res.status(400).json({ error: `Unknown object: ${object}` });

  try {
    const data = await sfGet(`/sobjects/${object}/describe`);
    const fields = data.fields
      .filter(field => !field.deprecatedAndHidden)
      .map(field => ({
        name: field.name,
        label: field.label,
        type: field.type,
        updateable: field.updateable,
        createable: field.createable,
        nillable: field.nillable,
        referenceTo: field.referenceTo || [],
        controllerName: field.controllerName || '',
        controllerValues: field.controllerValues || {},
        picklistValues: normalizePicklistValues(field)
      }));
    res.json({
      fields: fields.filter(field => !req.fieldPerms?.hiddenFields?.has(field.name)),
      hiddenFields: [...(req.fieldPerms?.hiddenFields || [])]
    });
  } catch (err) {
    handleSFError(err, res, `Fields ${object}`);
  }
});

// Global SOSL search
app.get('/api/search/global', checkAuth, async (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q) return res.json({ searchRecords: [] });
  const requestId = `search-${++securityPerfSeq}`;
  const requestStartedAt = performance.now();

  const safe = q.replace(/['"\\{}[\]()^~*:!?&|+]/g, ' ').trim().replace(/\s+/g, ' ');
  if (!safe) return res.json({ searchRecords: [] });

  const sosl = [
    `FIND {${safe}*} IN ALL FIELDS`,
    `RETURNING`,
    `Account(Id, Name, Type),`,
    `Contact(Id, Name, Email, Title),`,
    `Opportunity(Id, Name, StageName, Amount),`,
    `Case(Id, CaseNumber, Subject, Status),`,
    `Lead(Id, Name, Email, Company),`,
    `Campaign(Id, Name, Status, Type)`,
    `LIMIT 40`
  ].join(' ');

  try {
    const sfStartedAt = performance.now();
    const data = await sfGet('/search', { q: sosl });
    const sfMs = msSince(sfStartedAt);
    const securityStartedAt = performance.now();
    const searchRecords = await filterSearchRecordsByVisibility(data.searchRecords || [], req);
    const securityMs = msSince(securityStartedAt);
    res.json({ ...data, searchRecords });
    securityPerfLog(requestId, 'GET global-search', {
      sfRecords: data.searchRecords?.length || 0,
      evaluated: data.searchRecords?.length || 0,
      visible: searchRecords.length,
      sfMs,
      securityMs,
      totalMs: msSince(requestStartedAt)
    });
  } catch (err) {
    handleSFError(err, res, 'Global search');
  }
});

// Get picklist values for a field (helper for dropdowns)
app.get('/api/meta/:object/picklist/:field', checkAuth, async (req, res) => {
  const { object, field } = req.params;
  try {
    const data = await sfGet(`/sobjects/${object}/describe`);
    const fieldMeta = data.fields.find(f => f.name === field);
    const values = fieldMeta?.picklistValues?.filter(p => p.active).map(p => p.value) || [];
    res.json({ values });
  } catch (err) {
    res.json({ values: [] });
  }
});

app.get('/api/campaigns/:id/members', checkAuth, async (req, res) => {
  const campaignId = escapeSOQL(req.params.id);
  try {
    const soql = `
      SELECT Id, Status, ContactId, LeadId,
        Contact.Id, Contact.FirstName, Contact.LastName, Contact.Name, Contact.Email, Contact.Phone, Contact.Title, Contact.AccountId, Contact.Account.Name,
        Lead.Id, Lead.FirstName, Lead.LastName, Lead.Name, Lead.Email, Lead.Phone, Lead.Title, Lead.Company
      FROM CampaignMember
      WHERE CampaignId = '${campaignId}'
      ORDER BY CreatedDate DESC
      LIMIT 500
    `;
    const data = await sfGet('/query', { q: soql.replace(/\s+/g, ' ').trim() });
    res.json({ records: (data.records || []).map(normalizeCampaignMember), totalSize: data.totalSize || 0 });
  } catch (err) {
    handleSFError(err, res, `Campaign members ${req.params.id}`);
  }
});

app.delete('/api/campaigns/:id/members/:memberId', async (req, res) => {
  const { id, memberId } = req.params;
  try {
    const data = await sfGet('/query', {
      q: `SELECT Id FROM CampaignMember WHERE Id = '${escapeSOQL(memberId)}' AND CampaignId = '${escapeSOQL(id)}' LIMIT 1`
    });
    if (!data.records?.length) return res.status(404).json({ error: 'Campaign member not found' });

    await sfDelete(`/sobjects/CampaignMember/${memberId}`);
    res.json({ success: true });
  } catch (err) {
    handleSFError(err, res, `Delete campaign member ${memberId}`);
  }
});

app.get('/api/:object/:id/activity', checkAuth, async (req, res, next) => {
  return checkPermission(req.params.object, 'can_read')(req, res, next);
}, async (req, res) => {
  const { object, id } = req.params;
  if (!OBJECTS[object]) return res.status(400).json({ error: `Unknown object: ${object}` });

  const recordId = escapeSOQL(id);
  const isPersonRecord = ['Contact', 'Lead'].includes(object);
  const taskEventWhere = isPersonRecord ? `WhoId = '${recordId}'` : `WhatId = '${recordId}'`;
  const emailWhere = `RelatedToId = '${recordId}'`;

  try {
    const queries = [
      {
        source: 'EmailMessage',
        q: `
          SELECT Id, Subject, FromName, FromAddress, ToAddress, MessageDate, CreatedDate, Status, TextBody
          FROM EmailMessage
          WHERE ${emailWhere}
          ORDER BY MessageDate DESC, CreatedDate DESC
          LIMIT 50
        `
      },
      {
        source: 'Task',
        q: `
          SELECT Id, Subject, Status, IsClosed, Priority, ActivityDate, CreatedDate, TaskSubtype, Description,
            WhoId, Who.Name, WhatId, Owner.Name
          FROM Task
          WHERE ${taskEventWhere}
          ORDER BY CreatedDate DESC
          LIMIT 50
        `
      },
      {
        source: 'Event',
        q: `
          SELECT Id, Subject, StartDateTime, EndDateTime, CreatedDate, Location, Description,
            WhoId, Who.Name, WhatId, Owner.Name
          FROM Event
          WHERE ${taskEventWhere}
          ORDER BY StartDateTime DESC
          LIMIT 50
        `
      }
    ];
    const results = await Promise.allSettled(
      queries.map((item) => sfGet('/query', { q: item.q.replace(/\s+/g, ' ').trim() }))
    );
    let records = results.flatMap((result, index) => {
      if (result.status !== 'fulfilled') return [];
      return (result.value.records || []).map((record) => normalizeActivity(record, queries[index].source));
    });
    records = dedupeEmailActivities(records);

    records.sort((a, b) => new Date(b.when || 0) - new Date(a.when || 0));
    res.json({
      records: records.slice(0, 50),
      warnings: results
        .filter((result) => result.status === 'rejected')
        .map((result) => formatSalesforceError(result.reason?.response?.data) || result.reason?.message)
        .filter(Boolean)
    });
  } catch (err) {
    handleSFError(err, res, `${object} activity ${id}`);
  }
});

app.get('/api/:object/:id/related', checkAuth, async (req, res, next) => {
  return checkPermission(req.params.object, 'can_read')(req, res, next);
}, async (req, res) => {

  const { object, id } = req.params;
  const requestId = `related-${++securityPerfSeq}`;
  const requestStartedAt = performance.now();
  if (!OBJECTS[object]) return res.status(400).json({ error: `Unknown object: ${object}` });

  try {
    const sfStartedAt = performance.now();
    const record = await sfGet(`/sobjects/${object}/${id}?fields=${PORTAL_OWNER_FIELD}`);
    const parentSfMs = msSince(sfStartedAt);
    if (!(await canSeeRecord(record, req.user.id, req.user.role, object, req.user.isSystemAdmin))) {
      return res.status(403).json({
        error: 'You do not have access to this record.',
        code: 'RECORD_ACCESS_DENIED'
      });
    }

    const lists = await filterRelatedListsByVisibility(
      await getRelatedListsForRecord(object, id),
      req,
      requestId
    );
    res.json({ object, id, lists });
    securityPerfLog(requestId, 'GET related', {
      object,
      lists: lists.length,
      parentSfMs,
      totalMs: msSince(requestStartedAt)
    });
  } catch (err) {
    handleSFError(err, res, `Related lists ${object}/${id}`);
  }
});

app.get('/api/:object/:id/chatter', checkAuth, async (req, res) => {
  const { object, id } = req.params;
  if (!OBJECTS[object]) return res.status(400).json({ error: `Unknown object: ${object}` });

  try {
    const data = await sfGet(`/chatter/feeds/record/${encodeURIComponent(id)}/feed-elements`, {
      pageSize: 20
    });
    res.json({
      items: (data.elements || data.items || []).map(normalizeChatterItem),
      nextPageUrl: data.nextPageUrl || data.nextPageToken || null
    });
  } catch (err) {
    handleSFError(err, res, `Chatter feed ${object}/${id}`);
  }
});

app.post('/api/:object/:id/chatter', checkAuth, async (req, res) => {
  const { object, id } = req.params;
  if (!OBJECTS[object]) return res.status(400).json({ error: `Unknown object: ${object}` });

  const type = String(req.body?.type || 'post').toLowerCase();
  const body = chatterBodyFromSegments(req.body?.segments);
  const payload = {
    subjectId: id,
    feedElementType: 'FeedItem',
    body
  };

  if (type === 'poll') {
    const choices = (req.body?.choices || []).map((choice) => String(choice || '').trim()).filter(Boolean).slice(0, 10);
    if (choices.length < 2) return res.status(400).json({ error: 'Poll requires at least two choices' });
    payload.capabilities = {
      poll: {
        choices
      }
    };
  }

  try {
    const item = await sfPost('/chatter/feed-elements', payload);
    res.json({ item: normalizeChatterItem(item) });
  } catch (err) {
    handleSFError(err, res, `Create Chatter ${object}/${id}`);
  }
});

app.post('/api/chatter/feed-elements/:feedElementId/comments', async (req, res) => {
  const text = String(req.body?.text || '').trim();
  if (!text) return res.status(400).json({ error: 'Comment is required' });

  try {
    const comment = await sfPost(
      `/chatter/feed-elements/${encodeURIComponent(req.params.feedElementId)}/capabilities/comments/items`,
      { body: { messageSegments: [{ type: 'Text', text }] } }
    );
    res.json({ comment });
  } catch (err) {
    handleSFError(err, res, `Chatter comment ${req.params.feedElementId}`);
  }
});

app.post('/api/chatter/feed-elements/:feedElementId/likes', async (req, res) => {
  try {
    const like = await sfPost(
      `/chatter/feed-elements/${encodeURIComponent(req.params.feedElementId)}/capabilities/chatter-likes/items`,
      {}
    );
    res.json({ like });
  } catch (err) {
    handleSFError(err, res, `Chatter like ${req.params.feedElementId}`);
  }
});

app.post('/api/chatter/feed-elements/:feedElementId/poll-vote', async (req, res) => {
  const submittedChoiceId = String(req.body?.choiceId || '').trim();
  if (!submittedChoiceId) return res.status(400).json({ error: 'Poll choice is required' });

  try {
    const choiceId = await resolveChatterPollChoiceId(req.params.feedElementId, submittedChoiceId);
    if (!salesforceIdFromValue(choiceId)) return res.status(400).json({ error: 'Poll choice id is missing. Refresh Chatter and try again.' });
    const vote = await sfPatch(
      `/chatter/feed-elements/${encodeURIComponent(req.params.feedElementId)}/capabilities/poll`,
      { myChoiceId: choiceId },
      { params: { myChoiceId: choiceId } }
    );
    res.json({ vote });
  } catch (err) {
    handleSFError(err, res, `Chatter poll vote ${req.params.feedElementId}`);
  }
});

app.post('/api/:object/:id/activity', checkAuth, async (req, res, next) => {
  return checkPermission(req.params.object, 'can_create')(req, res, next);
}, async (req, res) => {
  const { object, id } = req.params;
  if (!OBJECTS[object]) return res.status(400).json({ error: `Unknown object: ${object}` });

  const type = String(req.body?.type || '').toLowerCase();
  const relation = activityRelationFromBody(object, id, req.body);
  const owner = req.body?.ownerId ? { OwnerId: req.body.ownerId } : {};

  try {
    if (type === 'task') {
      const subject = String(req.body.subject || '').trim();
      if (!subject) return res.status(400).json({ error: 'Subject is required' });
      const result = await createTaskActivity({
        Subject: subject,
        ActivityDate: req.body.dueDate || null,
        Status: req.body.status || 'Not Started',
        Priority: req.body.priority || 'Normal',
        Description: req.body.comments || '',
        ...owner,
        ...relation
      });
      return res.json({ success: true, result });
    }

    if (type === 'call') {
      const result = await createTaskActivity({
        Subject: String(req.body.subject || 'Call').trim() || 'Call',
        Status: 'Completed',
        Priority: req.body.priority || 'Normal',
        ActivityDate: req.body.date || new Date().toISOString().slice(0, 10),
        Description: req.body.comments || '',
        ...owner,
        ...relation
      }, 'Call');
      return res.json({ success: true, result });
    }

    if (type === 'event') {
      const subject = String(req.body.subject || '').trim();
      if (!subject) return res.status(400).json({ error: 'Subject is required' });
      const isAllDay = Boolean(req.body.isAllDay);
      const startDate = req.body.startDate || new Date().toISOString().slice(0, 10);
      const endDate = req.body.endDate || startDate;
      const eventBody = {
        Subject: subject,
        IsAllDayEvent: isAllDay,
        StartDateTime: toSalesforceDateTime(startDate, isAllDay ? '00:00' : req.body.startTime || '09:00'),
        EndDateTime: toSalesforceDateTime(endDate, isAllDay ? '23:59' : req.body.endTime || '10:00'),
        Location: req.body.location || '',
        Description: req.body.comments || '',
        ...owner,
        ...relation
      };
      const result = await sfPost('/sobjects/Event', eventBody);
      return res.json({ success: true, result });
    }

    if (type === 'email') {
      const subject = String(req.body.subject || '').trim();
      const body = String(req.body.body || '').trim();
      if (!subject) return res.status(400).json({ error: 'Subject is required' });
      if (!body) return res.status(400).json({ error: 'Email body is required' });

      let to = String(req.body.to || '').trim();
      const toRecipients = Array.isArray(req.body.toRecipients) ? req.body.toRecipients : [];
      const primaryRecipient = toRecipients.find((item) => item?.id);
      let recipientId = primaryRecipient?.id || req.body.whoId || (['Contact', 'Lead'].includes(object) ? id : '');
      if (!to && recipientId) {
        const personObject = objectFromId(recipientId);
        const person = ['Contact', 'Lead', 'User'].includes(personObject)
          ? await sfGet(`/sobjects/${personObject}/${recipientId}`)
          : {};
        to = person.Email || '';
      }
      if (!to) return res.status(400).json({ error: 'Recipient email is required' });

      const from = req.body.from || {};
      const toAddresses = parseEmailAddressList(to);
      const ccAddresses = parseEmailAddressList(req.body.cc);
      const bccAddresses = parseEmailAddressList(req.body.bcc);
      const attachmentParentId = req.body.whatId || id;
      const uploadedAttachments = await uploadEmailAttachments(
        Array.isArray(req.body.attachments) ? req.body.attachments : [],
        attachmentParentId
      );
      const relatedRecordId = req.body.whatId || (!recipientId || recipientId !== id ? id : '');
      const emailInput = {
        emailAddressesArray: toAddresses,
        emailSubject: subject,
        emailBody: body,
        sendRichBody: true,
        useLineBreaks: false,
        senderType: from.type === 'orgwide' ? 'OrgWideEmailAddress' : 'CurrentUser',
        ...(from.type === 'orgwide' && from.email ? { senderAddress: from.email } : {}),
        ...(ccAddresses.length ? { ccRecipientAddressCollection: ccAddresses } : {}),
        ...(bccAddresses.length ? { bccRecipientAddressCollection: bccAddresses } : {}),
        ...(uploadedAttachments.length ? { attachmentIdCollection: uploadedAttachments.map((file) => file.id) } : {}),
        ...(recipientId ? { recipientId } : {}),
        ...(relatedRecordId ? { relatedRecordId } : {}),
        logEmailOnSend: true
      };
      const emailResult = await sfPost('/actions/standard/emailSimple', {
        inputs: [emailInput]
      });
      const failures = extractActionFailures(emailResult);
      if (failures.length) return res.status(400).json({ error: failures.join('; '), result: emailResult });

      return res.json({ success: true, result: emailResult });
    }

    res.status(400).json({ error: 'Activity type must be task, call, event, or email' });
  } catch (err) {
    handleSFError(err, res, `Create ${type || 'activity'} for ${object}/${id}`);
  }
});

app.get('/api/campaigns/:id/candidates/:object', async (req, res) => {
  const { id, object } = req.params;
  if (!['Contact', 'Lead'].includes(object)) return res.status(400).json({ error: 'Object must be Contact or Lead' });

  try {
    const search = String(req.query.search || '').trim();
    const cfg = OBJECTS[object];
    const availableFields = await getObjectFieldSet(object);
    const where = buildWhereClause(object, search, object === 'Lead' && availableFields.has('IsConverted') ? "IsConverted = false" : '', availableFields);
    const soql = `SELECT ${await fieldsCsvForObject(object)} FROM ${object}${where} ORDER BY ${cfg.orderBy} LIMIT 100`;
    const [people, members] = await Promise.all([
      sfGet('/query', { q: soql }),
      sfGet('/query', {
        q: `SELECT ContactId, LeadId FROM CampaignMember WHERE CampaignId = '${escapeSOQL(id)}' LIMIT 2000`
      })
    ]);
    const existing = new Set((members.records || []).map((record) => record.ContactId || record.LeadId).filter(Boolean));
    res.json({
      records: (people.records || []).map((record) => ({
        ...record,
        alreadyMember: existing.has(record.Id)
      }))
    });
  } catch (err) {
    handleSFError(err, res, `Campaign ${req.params.id} candidates ${object}`);
  }
});

app.post('/api/campaigns/:id/members', async (req, res) => {
  const { id } = req.params;
  const { object, ids = [], status } = req.body || {};
  if (!['Contact', 'Lead'].includes(object)) return res.status(400).json({ error: 'Object must be Contact or Lead' });

  const uniqueIds = [...new Set(ids.map(String).filter(Boolean))].slice(0, 200);
  if (!uniqueIds.length) return res.status(400).json({ error: 'Select at least one record' });

  try {
    const idList = uniqueIds.map((recordId) => `'${escapeSOQL(recordId)}'`).join(',');
    const idField = object === 'Contact' ? 'ContactId' : 'LeadId';
    const existingData = await sfGet('/query', {
      q: `SELECT ${idField} FROM CampaignMember WHERE CampaignId = '${escapeSOQL(id)}' AND ${idField} IN (${idList})`
    });
    const existing = new Set((existingData.records || []).map((record) => record[idField]).filter(Boolean));
    const records = uniqueIds
      .filter((recordId) => !existing.has(recordId))
      .map((recordId) => ({
        attributes: { type: 'CampaignMember' },
        CampaignId: id,
        [idField]: recordId,
        ...(status ? { Status: status } : {})
      }));

    if (!records.length) {
      return res.json({ success: true, created: 0, skipped: uniqueIds.length, results: [] });
    }

    const result = await sfPost('/composite/sobjects', { allOrNone: false, records });
    const results = Array.isArray(result) ? result : result.results || [];
    res.json({
      success: true,
      created: results.filter((item) => item.success).length,
      skipped: existing.size,
      results
    });
  } catch (err) {
    handleSFError(err, res, `Add campaign members ${id}`);
  }
});

app.get('/api/campaigns/:id/email-templates', async (req, res) => {
  try {
    const records = await queryClassicEmailTemplates(req.query.limit || 500);
    res.json({ records });
  } catch (err) {
    handleSFError(err, res, `Email templates for campaign ${req.params.id}`);
  }
});

app.post('/api/campaigns/:id/email-preview', async (req, res) => {
  const { templateId, memberIds = [] } = req.body || {};
  if (!templateId) return res.status(400).json({ error: 'Select an email template' });

  try {
    const [campaign, template, context] = await Promise.all([
      sfGet(`/sobjects/Campaign/${req.params.id}`),
      sfGet(`/sobjects/EmailTemplate/${templateId}`),
      getEmailMergeContext()
    ]);
    let recipient = {};
    if (memberIds.length) {
      const memberData = await sfGet('/query', {
        q: `
          SELECT Id, Status, ContactId, LeadId,
            Contact.FirstName, Contact.LastName, Contact.Name, Contact.Email,
            Lead.FirstName, Lead.LastName, Lead.Name, Lead.Email
          FROM CampaignMember
          WHERE Id = '${escapeSOQL(memberIds[0])}'
          LIMIT 1
        `.replace(/\s+/g, ' ').trim()
      });
      recipient = normalizeCampaignMember(memberData.records?.[0] || {});
    }

    const html = emailTemplateBody(template);
    const mergedHtml = mergeTemplate(html, recipient, campaign, context.sender, context.organization);
    const subject = mergeTemplate(emailTemplateSubject(template), recipient, campaign, context.sender, context.organization);
    res.json({
      subject,
      html: mergedHtml,
      text: stripHtml(mergedHtml),
      recipient
    });
  } catch (err) {
    handleSFError(err, res, `Email preview ${req.params.id}`);
  }
});

app.post('/api/campaigns/:id/send-email', async (req, res) => {
  const { templateId, memberIds = [] } = req.body || {};
  const selectedIds = [...new Set(memberIds.map(String).filter(Boolean))].slice(0, 100);
  if (!templateId) return res.status(400).json({ error: 'Select an email template' });
  if (!selectedIds.length) return res.status(400).json({ error: 'Select at least one campaign member' });

  try {
    const [campaign, template, context] = await Promise.all([
      sfGet(`/sobjects/Campaign/${req.params.id}`),
      sfGet(`/sobjects/EmailTemplate/${templateId}`),
      getEmailMergeContext()
    ]);
    const memberIdList = selectedIds.map((id) => `'${escapeSOQL(id)}'`).join(',');
    const memberData = await sfGet('/query', {
      q: `
        SELECT Id, Status, ContactId, LeadId,
          Contact.FirstName, Contact.LastName, Contact.Name, Contact.Email,
          Lead.FirstName, Lead.LastName, Lead.Name, Lead.Email
        FROM CampaignMember
        WHERE Id IN (${memberIdList})
      `.replace(/\s+/g, ' ').trim()
    });
    const members = (memberData.records || []).map(normalizeCampaignMember).filter((member) => member.email);
    if (!members.length) return res.status(400).json({ error: 'Selected members do not have email addresses' });

    const templateBody = emailTemplateBody(template);
    const isHtmlTemplate = Boolean(template.HtmlValue);
    const mergedMessages = members.map((member) => {
      const mergedBody = mergeTemplate(templateBody, member, campaign, context.sender, context.organization);
      const subject = mergeTemplate(emailTemplateSubject(template) || campaign.Name || 'Campaign email', member, campaign, context.sender, context.organization);
      return {
        member,
        subject,
        body: mergedBody,
        textBody: stripHtml(mergedBody),
        input: {
          emailAddresses: member.email,
          emailSubject: subject,
          emailBody: isHtmlTemplate ? mergedBody : stripHtml(mergedBody),
          sendRichBody: isHtmlTemplate,
          useLineBreaks: !isHtmlTemplate,
          senderType: 'CurrentUser',
          recipientId: member.personId,
          relatedRecordId: campaign.Id,
          logEmailOnSend: true
        }
      };
    });
    const inputs = mergedMessages.map((message) => message.input);

    const result = await sfPost('/actions/standard/emailSimple', { inputs });
    const failures = extractActionFailures(result);
    if (failures.length) {
      return res.status(400).json({ error: failures.join('; '), result });
    }

    res.json({
      success: true,
      sent: inputs.length,
      logged: inputs.length,
      logWarning: '',
      result
    });
  } catch (err) {
    handleSFError(err, res, `Send campaign email ${req.params.id}`);
  }
});

// Bulk API 2.0 query for export-scale reads
app.post('/api/bulk/query', checkAuth, requireAdminPanel, async (req, res) => {
  const { soql, wait = true, includeRecords = true, maxRecords, maxWaitMs } = req.body || {};

  try {
    const job = await createBulkQueryJob(soql);
    const finalJob = wait ? await pollBulkQueryJob(job.id, maxWaitMs) : job;
    const response = { success: finalJob.state === 'JobComplete', job: finalJob };

    if (includeRecords && finalJob.state === 'JobComplete') {
      const page = await getBulkQueryResults(job.id, { maxRecords: maxRecords || BULK_QUERY_PAGE_SIZE });
      response.records = page.records;
      response.locator = page.locator;
      response.numberOfRecords = page.numberOfRecords;
      response.done = !page.locator;
    }

    res.json(response);
  } catch (err) {
    handleSFError(err, res, 'Bulk query');
  }
});

app.get('/api/bulk/query/:jobId', checkAuth, requireAdminPanel, async (req, res) => {
  try {
    res.json({ job: await getBulkQueryJob(req.params.jobId) });
  } catch (err) {
    handleSFError(err, res, `Bulk query job ${req.params.jobId}`);
  }
});

app.get('/api/bulk/query/:jobId/results', checkAuth, requireAdminPanel, async (req, res) => {
  try {
    const page = await getBulkQueryResults(req.params.jobId, {
      locator: req.query.locator,
      maxRecords: req.query.maxRecords || BULK_QUERY_PAGE_SIZE
    });

    if (req.query.format === 'csv') {
      res.type('text/csv');
      res.set('Sforce-Locator', page.locator || 'null');
      return res.send(page.csv);
    }

    res.json({
      records: page.records,
      locator: page.locator,
      numberOfRecords: page.numberOfRecords,
      done: !page.locator
    });
  } catch (err) {
    handleSFError(err, res, `Bulk query results ${req.params.jobId}`);
  }
});

app.post('/api/bulk/:object/query', checkAuth, async (req, res, next) => {
  const { object } = req.params;
  if (OBJECTS[object]) return checkPermission(object, 'can_read')(req, res, next);
  next();
}, async (req, res) => {
  const { object } = req.params;
  if (!OBJECTS[object]) return res.status(400).json({ error: `Unknown object: ${object}` });

  try {
    const soql = req.body?.soql || await buildBulkSOQL(object, req.body?.search, req.body?.where);
    const job = await createBulkQueryJob(soql);
    const finalJob = req.body?.wait === false ? job : await pollBulkQueryJob(job.id, req.body?.maxWaitMs);
    const response = { success: finalJob.state === 'JobComplete', job: finalJob, soql };

    if (req.body?.includeRecords !== false && finalJob.state === 'JobComplete') {
      const page = await getBulkQueryResults(job.id, { maxRecords: req.body?.maxRecords || BULK_QUERY_PAGE_SIZE });
      response.records = page.records;
      response.locator = page.locator;
      response.numberOfRecords = page.numberOfRecords;
      response.done = !page.locator;
    }

    res.json(response);
  } catch (err) {
    handleSFError(err, res, `Bulk ${object} query`);
  }
});

// Bulk API 2.0 ingest for large create/update/upsert/delete jobs
app.post('/api/bulk/:object/:operation', checkAuth, async (req, res, next) => {
  const { object, operation } = req.params;
  if (!OBJECTS[object]) return next();
  const action = bulkOperationAction(operation);
  if (action) return checkPermission(object, action)(req, res, next);
  next();
}, async (req, res, next) => {
  const { object, operation } = req.params;
  if (OBJECTS[object] && ['insert', 'update', 'upsert'].includes(operation)) {
    return attachFieldPerms(object)(req, res, next);
  }
  next();
}, async (req, res) => {
  const { object, operation } = req.params;
  if (!OBJECTS[object]) return res.status(400).json({ error: `Unknown object: ${object}` });
  if (!['insert', 'update', 'upsert', 'delete'].includes(operation)) {
    return res.status(400).json({ error: 'Bulk operation must be insert, update, upsert, or delete' });
  }

  try {
    let records = Array.isArray(req.body) ? req.body : req.body?.records;
    if (Array.isArray(records) && ['insert', 'update', 'upsert'].includes(operation)) {
      records = records.map(record => {
        const clean = flattenRecord(record);
        if (operation === 'insert') return applyFieldWriteSecurity(clean, req.fieldPerms);
        const { Id, ...fields } = clean;
        return { Id, ...applyFieldWriteSecurity(fields, req.fieldPerms) };
      });
    }

    if (!isFullAccessUser(req.user) && ['update', 'upsert', 'delete'].includes(operation)) {
      const rows = Array.isArray(records) ? records : [];
      const ids = rows.map(record => record?.Id).filter(Boolean);
      if (!rows.length || ids.length !== rows.length) {
        return res.status(403).json({
          error: 'Bulk update, upsert, and delete require record Id values for record-level security checks.',
          code: 'RECORD_ACCESS_CHECK_REQUIRED'
        });
      }

      const ownedRecords = await hydrateRecordOwners(ids.map(Id => ({ Id })), object);
      const denied = [];
      for (const record of ownedRecords) {
        if (!(await canEditRecord(record, req.user.id, req.user.role, object, req.user.isSystemAdmin))) {
          denied.push(record.Id);
        }
      }
      if (denied.length) {
        return res.status(403).json({
          error: permissionDeniedMessage(),
          code: operation === 'delete' ? 'RECORD_DELETE_DENIED' : 'RECORD_EDIT_DENIED',
          deniedIds: denied
        });
      }
    }

    const result = await runBulkIngest(object, operation, records, {
      externalIdFieldName: req.body?.externalIdFieldName,
      wait: req.body?.wait,
      maxWaitMs: req.body?.maxWaitMs,
      includeResults: req.body?.includeResults
    });
    res.json(result);
  } catch (err) {
    handleSFError(err, res, `Bulk ${operation} ${object}`);
  }
});

// List records
app.get('/api/:object', checkAuth,

  async (req, res, next) => {
    const obj = req.params.object;
    if (OBJECTS[obj]) {
      return checkPermission(obj, 'can_read')(req, res, next);
    }
    next();
  },

  async (req, res, next) => {
    const obj = req.params.object;
    if (OBJECTS[obj]) {
      return attachFieldPerms(obj)(req, res, next);
    }
    next();
  },

  async (req, res) => {
    const { object } = req.params;
    const requestId = `list-${++securityPerfSeq}`;
    const requestStartedAt = performance.now();

    if (!OBJECTS[object]) {
      return res.status(400).json({
        error: `Unknown object: ${object}`
      });
    }

    try {

      // Pagination (queryMore)
      if (req.query.cursor) {
        const sfStartedAt = performance.now();
        const data = await sfGet(
          queryMoreEndpoint(req.query.cursor),
          {},
          { headers: QUERY_BATCH_HEADERS }
        );
        const sfMs = msSince(sfStartedAt);

        const ownerStartedAt = performance.now();
        const ownedRecords = await hydrateRecordOwners(data.records || [], object);
        const ownerMs = msSince(ownerStartedAt);
        const visibleRecords = await applyRecordVisibility(
          ownedRecords,
          req.user.id,
          req.user.role,
          object,
          req.user.isSystemAdmin,
          requestId
        );
        const records = visibleRecords.map(record =>
          applyFieldSecurity(record, req.fieldPerms)
        );
        const owdAccess = await getOrgWideDefaultAccess(object);
        const canUseSalesforceTotal = req.user.isSystemAdmin || ['public_read', 'public_read_write'].includes(owdAccess);

        securityPerfLog(requestId, 'GET list cursor', {
          object,
          sfRecords: data.records?.length || 0,
          evaluated: ownedRecords.length,
          visible: records.length,
          sfMs,
          ownerMs,
          totalMs: msSince(requestStartedAt)
        });
        return res.json({
          records,
          totalSize: canUseSalesforceTotal ? (data.totalSize || 0) : records.length,
          done: Boolean(data.done),
          nextRecordsUrl: data.nextRecordsUrl || null,
          hiddenFields: [...(req.fieldPerms?.hiddenFields || [])]
        });
      }

      // Initial query
      const scope = await buildReadableRecordScopeFilter(object, req.user, requestId);
      const soql = await buildSOQL(
        object,
        req.query.search,
        [req.query.where, scope.clause].filter(Boolean).join(' AND ')
      );

      const sfStartedAt = performance.now();
      const data = await sfGet(
        '/query',
        { q: soql },
        { headers: QUERY_BATCH_HEADERS }
      );
      const sfMs = msSince(sfStartedAt);

      const ownerStartedAt = performance.now();
      const ownedRecords = await hydrateRecordOwners(data.records || [], object);
      const ownerMs = msSince(ownerStartedAt);

      // Apply record visibility
      const visibleRecords = await applyRecordVisibility(
        ownedRecords,
        req.user.id,
        req.user.role,
        object,
        req.user.isSystemAdmin,
        requestId
      );
      const records = visibleRecords.map(record =>
        applyFieldSecurity(record, req.fieldPerms)
      );
      const owdAccess = await getOrgWideDefaultAccess(object);
      const canUseSalesforceTotal = req.user.isSystemAdmin || ['public_read', 'public_read_write'].includes(owdAccess);

      res.json({
        ...data,
        records,
        totalSize: canUseSalesforceTotal ? (data.totalSize || 0) : records.length,
        done: Boolean(data.done),
        nextRecordsUrl: data.nextRecordsUrl || null,
        hiddenFields: [...(req.fieldPerms?.hiddenFields || [])]
      });
      securityPerfLog(requestId, 'GET list', {
        object,
        scope: scope.reason,
        sfRecords: data.records?.length || 0,
        evaluated: ownedRecords.length,
        visible: records.length,
        sfMs,
        ownerMs,
        totalMs: msSince(requestStartedAt)
      });

    } catch (err) {
      handleSFError(err, res, `GET ${object}`);
    }
  }
);

app.get('/api/:object/:id', checkAuth,

  async (req, res, next) => {
    const obj = req.params.object;
    if (OBJECTS[obj]) {
      return checkPermission(obj, 'can_read')(req, res, next);
    }
    next();
  },

  async (req, res, next) => {
    const obj = req.params.object;
    if (OBJECTS[obj]) {
      return attachFieldPerms(obj)(req, res, next);
    }
    next();
  },

  async (req, res) => {
    const { object, id } = req.params;
    const requestId = `detail-${++securityPerfSeq}`;
    const requestStartedAt = performance.now();

    if (!OBJECTS[object]) {
      return res.status(400).json({
        error: `Unknown object: ${object}`
      });
    }

    try {
      const sfStartedAt = performance.now();
      const record = await sfGet(`/sobjects/${object}/${id}`);
      const meta = await sfGet(`/sobjects/${object}/describe`);
      const sfMs = msSince(sfStartedAt);

      const fields = meta.fields
        .filter(field => !field.deprecatedAndHidden)
        .map(field => ({
          name: field.name,
          label: field.label,
          type: field.type,
          updateable: field.updateable,
          createable: field.createable,
          nillable: field.nillable,
          referenceTo: field.referenceTo || [],
          relationshipName: field.relationshipName || '',
          controllerName: field.controllerName || '',
          controllerValues: field.controllerValues || {},
          picklistValues: normalizePicklistValues(field),

          // Field-level security
          fieldSecurityReadOnly:
            req.fieldPerms?.readonlyFields?.has(field.name) || false
        }))
        .filter(field =>
          !req.fieldPerms?.hiddenFields?.has(field.name)
        );

      const cleanRecord = applyFieldSecurity(record, req.fieldPerms);
      // Check if user can see this specific record and return record-level access to the UI.
      const securityStartedAt = performance.now();
      const recordAccess = await evaluateRecordAccess(
        record,
        req.user.id,
        req.user.role,
        object,
        req.user.isSystemAdmin
      );
      const securityMs = msSince(securityStartedAt);
      if (!recordAccess.allowed) {
        return res.status(403).json({
          error: 'You do not have access to this record.',
          code: 'RECORD_ACCESS_DENIED'
        });
      }

      const lookupLabels = await buildLookupLabels(
        cleanRecord,
        fields
      );

      res.json({
        record: cleanRecord,
        fields,
        lookupLabels,
        recordAccess
      });
      securityPerfLog(requestId, 'GET detail', {
        object,
        sfRecords: 1,
        evaluated: 1,
        visible: 1,
        access: recordAccess.accessLevel,
        via: recordAccess.via,
        sfMs,
        securityMs,
        totalMs: msSince(requestStartedAt)
      });

    } catch (err) {
      handleSFError(err, res, `GET ${object}/${id}`);
    }
  }
);

// Create record
app.post('/api/:object', checkAuth, async (req, res, next) => {
  const obj = req.params.object;
  if (OBJECTS[obj]) return checkPermission(obj, 'can_create')(req, res, next);
  next();
}, async (req, res, next) => {
  const obj = req.params.object;
  if (OBJECTS[obj]) return attachFieldPerms(obj)(req, res, next);
  next();
}, async (req, res) => {
  const { object } = req.params;
  if (!OBJECTS[object]) return res.status(400).json({ error: `Unknown object: ${object}` });

  try {
    const records = Array.isArray(req.body) ? req.body : req.body?.records;
    if (Array.isArray(records)) {
      if (!records.length) return res.status(400).json({ error: 'Create requires at least one record' });
      const securedRecords = records.map(record => applyFieldWriteSecurity(flattenRecord(record), req.fieldPerms));
      if (records.length >= BULK_AUTO_THRESHOLD || req.query.bulk === 'true' || req.body?.bulk === true) {
        const result = await runBulkIngest(object, 'insert', securedRecords, {
          wait: req.body?.wait,
          includeResults: req.body?.includeResults
        });
        return res.json({ ...result, bulk: true });
      }

      const result = await sfPost('/composite/sobjects', {
        allOrNone: false,
        // Bulk create - stamp ownership
        records: securedRecords.map(record => ({
          attributes: { type: object },
          ...record,
          Portal_Owner__c: req.user.id,
          Portal_Created_By__c: req.user.id,
          Portal_Last_Modified_By__c: req.user.id
        }))
      });
      return res.json({ bulk: false, result });
    }

    // Stamp portal ownership fields on create
    const bodyWithOwner = {
      ...applyFieldWriteSecurity(req.body, req.fieldPerms),
      Portal_Owner__c: req.user.id,
      Portal_Created_By__c: req.user.id,
      Portal_Last_Modified_By__c: req.user.id,
    };
    const result = await sfPost(`/sobjects/${object}`, bodyWithOwner);
    res.json(result);
  } catch (err) {
    handleSFError(err, res, `POST ${object}`);
  }
});

// Bulk-aware update route for array payloads: { records: [{ Id, ...fields }] }
app.patch('/api/:object', checkAuth, async (req, res, next) => {
  const { object } = req.params;
  if (OBJECTS[object]) return checkPermission(object, 'can_edit')(req, res, next);
  next();
}, async (req, res, next) => {
  const { object } = req.params;
  if (OBJECTS[object]) return attachFieldPerms(object)(req, res, next);
  next();
}, async (req, res) => {
  const { object } = req.params;
  if (!OBJECTS[object]) return res.status(400).json({ error: `Unknown object: ${object}` });

  try {
    const records = Array.isArray(req.body) ? req.body : req.body?.records;
    if (!Array.isArray(records) || !records.length) {
      return res.status(400).json({ error: 'Update requires records with Id values' });
    }

    if (!isFullAccessUser(req.user)) {
      const ids = records.map(record => record?.Id).filter(Boolean);
      if (ids.length !== records.length) {
        return res.status(400).json({ error: 'Update requires Id on every record' });
      }

      const ownedRecords = await hydrateRecordOwners(ids.map(Id => ({ Id })), object);
      const denied = [];
      for (const record of ownedRecords) {
        if (!(await canEditRecord(record, req.user.id, req.user.role, object, req.user.isSystemAdmin))) {
          denied.push(record.Id);
        }
      }
      if (denied.length) {
        return res.status(403).json({
          error: permissionDeniedMessage(),
          code: 'RECORD_EDIT_DENIED',
          deniedIds: denied
        });
      }
    }

    if (records.length >= BULK_AUTO_THRESHOLD || req.query.bulk === 'true' || req.body?.bulk === true) {
      const securedRecords = records.map(record => {
        const clean = flattenRecord(record);
        const { Id, ...fields } = clean;
        return { Id, ...applyFieldWriteSecurity(fields, req.fieldPerms) };
      });
      const result = await runBulkIngest(object, 'update', securedRecords, {
        wait: req.body?.wait,
        includeResults: req.body?.includeResults
      });
      return res.json({ ...result, bulk: true });
    }

    const results = await Promise.allSettled(records.map((record) => {
      const clean = flattenRecord(record);
      const { Id, ...fields } = clean;
      if (!Id) throw new Error('Update requires Id on every record');
      return sfPatch(`/sobjects/${object}/${Id}`, applyFieldWriteSecurity(fields, req.fieldPerms));
    }));
    res.json({
      bulk: false,
      success: results.every((item) => item.status === 'fulfilled'),
      results: results.map((item, index) => ({
        id: records[index].Id,
        success: item.status === 'fulfilled',
        error: item.status === 'rejected' ? formatSalesforceError(item.reason?.response?.data) || item.reason?.message : ''
      }))
    });
  } catch (err) {
    handleSFError(err, res, `PATCH ${object}`);
  }
});

// Update record
app.patch('/api/:object/:id', checkAuth,

  async (req, res, next) => {
    const obj = req.params.object;

    if (OBJECTS[obj]) {
      return checkPermission(obj, 'can_edit')(req, res, next);
    }

    next();
  },

  // Record-level edit security
  async (req, res, next) => {
    const { object, id } = req.params;
    req.securityPerfId = `patch-${++securityPerfSeq}`;
    req.securityPerfStartedAt = performance.now();

    if (!OBJECTS[object]) return next();
    if (isFullAccessUser(req.user)) return next();

    try {
      const sfStartedAt = performance.now();
      const record = await sfGet(
        `/sobjects/${object}/${id}?fields=Portal_Owner__c`
      );
      record.Id = record.Id || id;
      const sfMs = msSince(sfStartedAt);

      const securityStartedAt = performance.now();
      const allowed = await canEditRecord(
        record,
        req.user.id,
        req.user.role,
        object,
        req.user.isSystemAdmin
      );
      const securityMs = msSince(securityStartedAt);

      if (!allowed) {
        return res.status(403).json({
          error: permissionDeniedMessage(),
          code: 'RECORD_EDIT_DENIED'
        });
      }

      securityPerfLog(req.securityPerfId, 'PATCH edit-check', {
        object,
        sfRecords: 1,
        evaluated: 1,
        visible: 1,
        sfMs,
        securityMs,
        totalMs: msSince(req.securityPerfStartedAt)
      });
      next();

    } catch (err) {
      console.error(`[record-visibility] edit check failed for ${object}/${id}:`, err.message);
      return res.status(403).json({
        error: permissionDeniedMessage(),
        code: 'RECORD_EDIT_CHECK_FAILED'
      });
    }
  },

  async (req, res, next) => {
    const { object } = req.params;
    if (OBJECTS[object]) return attachFieldPerms(object)(req, res, next);
    next();
  },

  async (req, res) => {
    const { object, id } = req.params;

    if (!OBJECTS[object]) {
      return res.status(400).json({
        error: `Unknown object: ${object}`
      });
    }

    try {
      const bodyWithModifier = {
        ...applyFieldWriteSecurity(req.body, req.fieldPerms),
        Portal_Last_Modified_By__c: req.user.id
      };

      const sfStartedAt = performance.now();
      await sfPatch(
        `/sobjects/${object}/${id}`,
        bodyWithModifier
      );
      const sfMs = msSince(sfStartedAt);

      res.json({
        success: true
      });
      securityPerfLog(req.securityPerfId || `patch-${++securityPerfSeq}`, 'PATCH sf-update', {
        object,
        sfRecords: 1,
        evaluated: 1,
        visible: 1,
        sfMs,
        totalMs: req.securityPerfStartedAt ? msSince(req.securityPerfStartedAt) : sfMs
      });

    } catch (err) {
      handleSFError(
        err,
        res,
        `PATCH ${object}/${id}`
      );
    }
  }
);

// Bulk-aware delete route for array payloads: { ids: [] } or { records: [{ Id }] }
app.delete('/api/:object', checkAuth, async (req, res, next) => {
  const { object } = req.params;
  if (OBJECTS[object]) return checkPermission(object, 'can_delete')(req, res, next);
  next();
}, async (req, res) => {
  const { object } = req.params;
  if (!OBJECTS[object]) return res.status(400).json({ error: `Unknown object: ${object}` });

  try {
    const ids = Array.isArray(req.body?.ids)
      ? req.body.ids
      : (Array.isArray(req.body?.records) ? req.body.records.map((record) => record.Id) : []);
    const records = [...new Set(ids.map(String).filter(Boolean))].map((Id) => ({ Id }));
    if (!records.length) return res.status(400).json({ error: 'Delete requires ids or records with Id values' });

    if (!isFullAccessUser(req.user)) {
      const ownedRecords = await hydrateRecordOwners(records, object);
      const denied = [];
      for (const record of ownedRecords) {
        if (!(await canEditRecord(record, req.user.id, req.user.role, object, req.user.isSystemAdmin))) {
          denied.push(record.Id);
        }
      }
      if (denied.length) {
        return res.status(403).json({
          error: permissionDeniedMessage(),
          code: 'RECORD_DELETE_DENIED',
          deniedIds: denied
        });
      }
    }

    if (records.length >= BULK_AUTO_THRESHOLD || req.query.bulk === 'true' || req.body?.bulk === true) {
      const result = await runBulkIngest(object, 'delete', records, {
        wait: req.body?.wait,
        includeResults: req.body?.includeResults
      });
      return res.json({ ...result, bulk: true });
    }

    const results = await Promise.allSettled(records.map((record) => sfDelete(`/sobjects/${object}/${record.Id}`)));
    res.json({
      bulk: false,
      success: results.every((item) => item.status === 'fulfilled'),
      results: results.map((item, index) => ({
        id: records[index].Id,
        success: item.status === 'fulfilled',
        error: item.status === 'rejected' ? formatSalesforceError(item.reason?.response?.data) || item.reason?.message : ''
      }))
    });
  } catch (err) {
    handleSFError(err, res, `DELETE ${object}`);
  }
});

// Delete record
app.delete('/api/:object/:id', checkAuth, async (req, res, next) => {
  const obj = req.params.object;
  if (OBJECTS[obj]) return checkPermission(obj, 'can_delete')(req, res, next);
  next();
}, async (req, res) => {
  const { object, id } = req.params;
  if (!OBJECTS[object]) return res.status(400).json({ error: `Unknown object: ${object}` });

  try {
    if (!isFullAccessUser(req.user)) {
      const [record] = await hydrateRecordOwners([{ Id: id }], object);
      const allowed = await canEditRecord(record, req.user.id, req.user.role, object, req.user.isSystemAdmin);
      if (!allowed) {
        return res.status(403).json({
          error: permissionDeniedMessage(),
          code: 'RECORD_DELETE_DENIED'
        });
      }
    }

    await sfDelete(`/sobjects/${object}/${id}`);
    res.json({ success: true });
  } catch (err) {
    handleSFError(err, res, `DELETE ${object}/${id}`);
  }
});

// Global SOSL search
app.get('/api/search/global', checkAuth, async (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q) return res.json({ searchRecords: [] });

  // Sanitize for SOSL — remove reserved chars
  const safe = q.replace(/['"\\{}[\]()^~*:!?&|+]/g, ' ').trim().replace(/\s+/g, ' ');
  if (!safe) return res.json({ searchRecords: [] });

  const sosl = [
    `FIND {${safe}*} IN ALL FIELDS`,
    `RETURNING`,
    `Account(Id, Name, Type),`,
    `Contact(Id, Name, Email, Title),`,
    `Opportunity(Id, Name, StageName, Amount),`,
    `Case(Id, CaseNumber, Subject, Status),`,
    `Lead(Id, Name, Email, Company),`,
    `Campaign(Id, Name, Status, Type)`,
    `LIMIT 40`
  ].join(' ');

  try {
    const data = await sfGet('/search', { q: sosl });
    const searchRecords = await filterSearchRecordsByVisibility(data.searchRecords || [], req);
    res.json({ ...data, searchRecords });
  } catch (err) {
    handleSFError(err, res, 'Global search');
  }
});

// Get picklist values for a field (helper for dropdowns)
app.get('/api/meta/:object/picklist/:field', checkAuth, async (req, res) => {
  const { object, field } = req.params;
  try {
    const data = await sfGet(`/sobjects/${object}/describe`);
    const fieldMeta = data.fields.find(f => f.name === field);
    const values = fieldMeta?.picklistValues?.filter(p => p.active).map(p => p.value) || [];
    res.json({ values });
  } catch (err) {
    res.json({ values: [] });
  }
});


app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});
app.get('/admin.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});
// Serve frontend for all unmatched routes
app.use((req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ─── Start ────────────────────────────────────────────────────
app.listen(PORT, async () => {
  console.log(`SaaSRAY CRM server running at http://localhost:${PORT}`);
  try {
    await getAccessToken();
  } catch (e) {
    console.error(`❌ Auth failed: ${e.message}\n`);
  }
});
