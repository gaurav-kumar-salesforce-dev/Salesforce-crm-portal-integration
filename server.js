require('dotenv').config();
const express = require('express');
const axios   = require('axios');
const path    = require('path');
const fs      = require('fs');
const crypto  = require('crypto');

const bcrypt = require('bcrypt');
const jwt    = require('jsonwebtoken');
const { supabase, getUserWithPermissions, writeAuditLog } = require('./db');

const JWT_SECRET     = process.env.JWT_SECRET;
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '8h';

const { Resend } = require('resend');
const resend = new Resend(process.env.RESEND_API_KEY);

const app = express();
app.set('trust proxy', true);
app.use(express.json({ limit: process.env.JSON_BODY_LIMIT || '25mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Verifies JWT on every request. Attaches req.user = { id, email, role, name }
function checkAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token  = header.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: 'Login required', code: 'NO_TOKEN' });
  }

  if (!JWT_SECRET) {
    console.error('JWT_SECRET is not set in .env');
    return res.status(500).json({ error: 'Server misconfiguration' });
  }

  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch (err) {
    const code = err.name === 'TokenExpiredError' ? 'TOKEN_EXPIRED' : 'TOKEN_INVALID';
    return res.status(401).json({ error: 'Session expired. Please log in again.', code });
  }
}

// Role gate — use AFTER checkAuth. Roles in order: super_admin > admin > manager > employee > readonly
const ROLE_LEVELS = { super_admin: 5, admin: 4, manager: 3, employee: 2, readonly: 1 };
const RESERVED_API_OBJECT_NAMES = new Set([
  'portal',
  'auth',
  'email',
  'activity-email-templates',
  'bulk',
  'lookup',
  'debug',
  'search',
  'meta',
  'campaigns',
  'chatter'
]);

function checkRole(minimumRole) {
  return (req, res, next) => {
    const userLevel = ROLE_LEVELS[req.user?.role] || 0;
    const minLevel  = ROLE_LEVELS[minimumRole] || 0;
    if (userLevel >= minLevel) return next();
    return res.status(403).json({
      error: `This action requires ${minimumRole} role or higher.`,
      code: 'INSUFFICIENT_ROLE'
    });
  };
}

// Checks user's effective permissions for a SF object before allowing the action
 function checkPermission(sfObject, action) {
  return async (req, res, next) => {
    try {
      const role = req.user.role;

      // super_admin and admin bypass all object permission checks
      if (role === 'super_admin' || role === 'admin') return next();

      // readonly role can NEVER write
      if (role === 'readonly' && action !== 'can_read') {
        return res.status(403).json({
          error: `You do not have permission to ${action.replace('can_','')} ${sfObject} records.`,
          code:  'PERMISSION_DENIED'
        });
      }

      // Call the SQL function we created in Phase 1
      const { data, error } = await supabase.rpc('get_effective_permissions', {
        p_user_id:   req.user.id,
        p_sf_object: sfObject
      });

      if (error) throw error;

      const perms = data?.[0];
      if (!perms || !perms[action]) {
        return res.status(403).json({
          error: `You do not have permission to ${action.replace('can_','')} ${sfObject} records. Contact your administrator.`,
          code:  'PERMISSION_DENIED'
        });
      }

      next();
    } catch (err) {
      console.error('Permission check error:', err.message);
      res.status(500).json({ error: 'Could not verify permissions' });
    }
  };
}

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
  clientId     : process.env.SF_CLIENT_ID,
  clientSecret : process.env.SF_CLIENT_SECRET,
  refreshToken : process.env.SF_REFRESH_TOKEN,
  instanceUrl  : normalizeUrl(process.env.SF_INSTANCE_URL),
  loginUrl     : normalizeUrl(process.env.SF_LOGIN_URL || 'https://login.salesforce.com'),
  redirectUri  : process.env.SF_REDIRECT_URI || `http://localhost:${PORT}/oauth/callback`,
  version      : 'v59.0'
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
let _cachedToken  = null;
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
    grant_type    : 'refresh_token',
    client_id     : SF.clientId,
    client_secret : SF.clientSecret,
    refresh_token : SF.refreshToken
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
    _cachedToken  = res.data.access_token;
    SF.instanceUrl = normalizeUrl(res.data.instance_url || SF.instanceUrl);
    _tokenExpires = Date.now() + 55 * 60 * 1000; // 55 min cache
    console.log('✅ New access token obtained');
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
  const res = await axios.get(`${baseUrl()}${endpoint}`, {
    headers: { Authorization: `Bearer ${token}` },
    params,
    ...config,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(config.headers || {})
    }
  });
  return res.data;
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
    fields      : 'Id, Name, Type, Industry, Phone, Website, BillingCity, BillingState, AnnualRevenue, NumberOfEmployees',
    orderBy     : 'Name',
    searchFields: ['Name', 'Type', 'Industry', 'Phone', 'BillingCity']
  },
  Contact: {
    fields      : 'Id, FirstName, LastName, Name, Email, Phone, Title, Account.Name, AccountId',
    orderBy     : 'LastName',
    searchFields: ['LastName', 'FirstName', 'Email', 'Phone', 'Title']
  },
  Opportunity: {
    fields      : 'Id, Name, StageName, Amount, CloseDate, Account.Name, AccountId, Probability, LeadSource',
    orderBy     : 'CloseDate DESC',
    searchFields: ['Name', 'StageName', 'LeadSource']
  },
  Case: {
    fields      : 'Id, CaseNumber, Subject, Status, Priority, Type, Account.Name, AccountId, Description, CreatedDate',
    orderBy     : 'CreatedDate DESC',
    searchFields: ['Subject', 'CaseNumber', 'Status', 'Priority']
  },
  Lead: {
    fields      : 'Id, FirstName, LastName, Name, Email, Phone, Company, Status, Title, LeadSource',
    orderBy     : 'LastName',
    searchFields: ['LastName', 'FirstName', 'Email', 'Phone', 'Company']
  },
  Campaign: {
    fields      : 'Id, Name, Type, Status, StartDate, EndDate, IsActive, Description, NumberOfContacts, NumberOfLeads, NumberOfResponses',
    orderBy     : 'CreatedDate DESC',
    searchFields: ['Name', 'Type', 'Status']
  },
  Task: {
    fields      : 'Id, Subject, Status, Priority, ActivityDate, TaskSubtype, WhoId, Who.Name, WhatId, What.Name, OwnerId, Owner.Name, Description, CreatedDate',
    orderBy     : 'CreatedDate DESC',
    searchFields: ['Subject', 'Status', 'Priority', 'Description']
  },
  Event: {
    fields      : 'Id, Subject, StartDateTime, EndDateTime, IsAllDayEvent, Location, WhoId, Who.Name, WhatId, What.Name, OwnerId, Owner.Name, Description, CreatedDate',
    orderBy     : 'StartDateTime DESC',
    searchFields: ['Subject', 'Location', 'Description']
  },
  EmailMessage: {
    fields      : 'Id, Subject, FromName, FromAddress, ToAddress, CcAddress, BccAddress, MessageDate, Status, RelatedToId, RelatedTo.Name, CreatedById, CreatedBy.Name, CreatedDate, TextBody',
    orderBy     : 'MessageDate DESC',
    searchFields: ['Subject', 'FromAddress', 'ToAddress']
  },
  Pricebook2: {
    fields      : 'Id, Name, IsActive, Description',
    orderBy     : 'Name',
    searchFields: ['Name', 'Description']
  },
  User: {
    fields      : 'Id, Name, Email, Username, Title, IsActive',
    orderBy     : 'Name',
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
  return fields.length ? [...new Set(['Id', ...fields])].join(', ') : 'Id';
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
app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body || {};

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  try {
    // 1. Look up the user by email
    const { data: user, error } = await supabase
      .from('users')
      .select('id, email, name, role, password_hash, is_active, must_change_pw')
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
    const tokenPayload = {
      id:    user.id,
      email: user.email,
      name:  user.name,
      role:  user.role
    };
    const token = jwt.sign(tokenPayload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });

    // 5. Update last_login_at
    await supabase
      .from('users')
      .update({ last_login_at: new Date().toISOString() })
      .eq('id', user.id);

    // 6. Log successful login
    await writeAuditLog({
      userId:    user.id,
      userEmail: user.email,
      userRole:  user.role,
      action:    'login',
      ipAddress: req.ip
    });

    res.json({
      token,
      mustChangePw: user.must_change_pw,
      user: {
        id:      userData.id,
        email:   userData.email,
        name:    userData.name,
        role:    userData.role,
        profile: userData.profile
      },
      permissions: userData.permissions   // { Account: {can_read, can_create, can_edit, can_delete}, ... }
    });

  } catch (err) {
    console.error('Login error:', err.message);
    res.status(500).json({ error: 'Login failed. Please try again.' });
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
    const resetToken  = crypto.randomBytes(32).toString('hex');
    const tokenHash   = crypto.createHash('sha256').update(resetToken).digest('hex');
    const expiresAt   = new Date(Date.now() + 60 * 60 * 1000); // 1 hour from now
 
    // 3. Store token hash in DB (we store hash, not raw token — same as JWT pattern)
    // First delete any existing reset tokens for this user
    await supabase
      .from('password_reset_tokens')
      .delete()
      .eq('user_id', user.id);
 
    await supabase
      .from('password_reset_tokens')
      .insert({
        user_id:     user.id,
        token_hash:  tokenHash,
        expires_at:  expiresAt.toISOString(),
        used:        false
      });
 
    // 4. Send email via Resend
    const appUrl   = process.env.APP_URL || `http://localhost:${PORT}`;
    const resetUrl = `${appUrl}/reset-password.html?token=${resetToken}`;
 
    await resend.emails.send({
      from:    process.env.FROM_EMAIL || 'noreply@yourdomain.com',
      to:      user.email,
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
      userId:    user.id,
      userEmail: user.email,
      userRole:  'system',
      action:    'password_reset',
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
        password_hash:  passwordHash,
        must_change_pw: false,
        updated_at:     new Date().toISOString()
      })
      .eq('id', resetRecord.user_id);
 
    // 5. Mark token as used (so it can't be reused)
    await supabase
      .from('password_reset_tokens')
      .update({ used: true })
      .eq('token_hash', tokenHash);
 
    // 6. Audit log
    await writeAuditLog({
      userId:    resetRecord.user_id,
      userRole:  'system',
      action:    'password_reset',
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
    const { data }  = await supabase
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
      return res.status(404).json({ error: 'User not found or deactivated' });
    }
    res.json({
      id:          userData.id,
      email:       userData.email,
      name:        userData.name,
      role:        userData.role,
      profile:     userData.profile,
      permissions: userData.permissions,
      lastLoginAt: userData.last_login_at
    });
  } catch (err) {
    console.error('GET /api/portal/me error:', err.message);
    res.status(500).json({ error: 'Could not load user profile' });
  }
});

// GET own profile — any logged in user
app.get('/api/portal/profile', checkAuth, async (req, res) => {
  try {
    const { data: user } = await supabase
      .from('users')
      .select('id, email, name, role, must_change_pw, created_at, last_login_at')
      .eq('id', req.user.id)
      .single();

    const { data: assignment } = await supabase
      .from('user_profile_assignments')
      .select('profile_id, profiles(id, name, description)')
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
      id:           user.id,
      email:        user.email,
      name:         user.name,
      role:         user.role,
      mustChangePw: user.must_change_pw,
      createdAt:    user.created_at,
      lastLoginAt:  user.last_login_at,
      profile:      assignment?.profiles || null,
      permissionSets: (permSets || []).map(p => p.permission_sets).filter(Boolean)
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH own profile — name and password only
app.patch('/api/portal/profile', checkAuth, async (req, res) => {
  const { name, currentPassword, newPassword } = req.body || {};

  try {
    const updates = {};

    // Name change
    if (name?.trim()) {
      updates.name = name.trim();
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

      updates.password_hash  = await bcrypt.hash(newPassword, 12);
      updates.must_change_pw = false;
    }

    if (!Object.keys(updates).length) {
      return res.status(400).json({ error: 'Nothing to update' });
    }

    updates.updated_at = new Date().toISOString();

    await supabase.from('users').update(updates).eq('id', req.user.id);

    await writeAuditLog({
      userId:    req.user.id,
      userEmail: req.user.email,
      userRole:  req.user.role,
      action:    'update_user',
      payload:   { self: true, changedFields: Object.keys(updates) },
      ipAddress: req.ip
    });

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// POST /api/portal/users — create new portal user (admin+ only)
app.post('/api/portal/users', checkAuth, checkRole('admin'), async (req, res) => {
  const { email, name, password, role, profileId } = req.body || {};

  if (!email || !name || !password) {
    return res.status(400).json({ error: 'Email, name, and password are required' });
  }

  const validRoles = ['super_admin', 'admin', 'manager', 'employee', 'readonly'];
  if (role && !validRoles.includes(role)) {
    return res.status(400).json({ error: 'Invalid role' });
  }

  // Admins cannot create super_admin users
  if (role === 'super_admin' && req.user.role !== 'super_admin') {
    return res.status(403).json({ error: 'Only super admins can create super admin accounts' });
  }

  try {
    const passwordHash = await bcrypt.hash(password, 12);

    const { data: newUser, error } = await supabase
      .from('users')
      .insert({
        email:         email.toLowerCase().trim(),
        name:          name.trim(),
        password_hash: passwordHash,
        role:          role || 'employee',
        is_active:     true,
        must_change_pw: true,
        created_by:    req.user.id
      })
      .select('id, email, name, role')
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

    await writeAuditLog({
      userId:    req.user.id,
      userEmail: req.user.email,
      userRole:  req.user.role,
      action:    'create_user',
      payload:   { createdUserId: newUser.id, email: newUser.email, role: newUser.role },
      ipAddress: req.ip
    });

    res.status(201).json({ success: true, user: newUser });
  } catch (err) {
    console.error('POST /api/portal/users error:', err.message);
    res.status(500).json({ error: 'Could not create user' });
  }
});


// PATCH /api/portal/users/:id — update user (admin+ only)
app.patch('/api/portal/users/:id', checkAuth, checkRole('admin'), async (req, res) => {
  const { id } = req.params;
  const { role, isActive, profileId, mustChangePw } = req.body || {};

  // Admins cannot modify super_admin users (only super_admin can)
  if (req.user.role !== 'super_admin') {
    const { data: target } = await supabase
      .from('users')
      .select('role')
      .eq('id', id)
      .single();
    if (target?.role === 'super_admin') {
      return res.status(403).json({ error: 'Only super admins can modify super admin accounts' });
    }
  }

  try {
    const updates = {};
    if (role !== undefined) updates.role = role;
    if (isActive !== undefined) updates.is_active = isActive;
    if (mustChangePw !== undefined) updates.must_change_pw = mustChangePw;
    updates.updated_at = new Date().toISOString();

    // Handle optional password change on edit
    if (req.body?.password) {
      updates.password_hash = await bcrypt.hash(req.body.password, 12);
      updates.must_change_pw = false;
    }

    if (Object.keys(updates).length > 1) {
      // more than just updated_at
      const { error } = await supabase
        .from("users")
        .update(updates)
        .eq("id", id);
      if (error) throw error;
    }

    // Update profile assignment if provided
    if (profileId) {
      await supabase
        .from("user_profile_assignments")
        .upsert(
          {
            user_id: id,
            profile_id: profileId,
            assigned_by: req.user.id,
            assigned_at: new Date().toISOString(),
          },
          { onConflict: "user_id" },
        );
    }

    // Sync permission sets if provided
    if (Array.isArray(req.body?.permissionSetIds)) {
      await supabase
        .from("user_permission_set_assignments")
        .delete()
        .eq("user_id", id);
      if (req.body.permissionSetIds.length) {
        await supabase.from("user_permission_set_assignments").insert(
          req.body.permissionSetIds.map((psId) => ({
            user_id: id,
            perm_set_id: psId,
            assigned_by: req.user.id,
          })),
        );
      }
    }

    await writeAuditLog({
      userId: req.user.id,
      userEmail: req.user.email,
      userRole: req.user.role,
      action: "update_user",
      payload: { targetUserId: id, changes: updates },
      ipAddress: req.ip,
    });

    res.json({ success: true });
  } catch (err) {
    console.error('PATCH /api/portal/users error:', err.message);
    res.status(500).json({ error: 'Could not update user' });
  }
});


// ── GET user's permission sets
app.get('/api/portal/users/:id/permission-sets', checkAuth, checkRole('admin'), async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('user_permission_set_assignments')
      .select('perm_set_id, permission_sets(id, name, description)')
      .eq('user_id', req.params.id);
    if (error) throw error;
    res.json({ permissionSets: (data||[]).map(r => r.permission_sets).filter(Boolean) });
  } catch(e) { res.status(500).json({ error: e.message }); }
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
  } catch(e) { res.status(500).json({ error: e.message }); }
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
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── DELETE /api/portal/profiles/:id
app.delete('/api/portal/profiles/:id', checkAuth, checkRole('admin'), async (req, res) => {
  try {
    const { count } = await supabase.from('user_profile_assignments').select('*', { count: 'exact', head: true }).eq('profile_id', req.params.id);
    if (count > 0) return res.status(409).json({ error: 'Cannot delete a profile that is assigned to users' });
    await supabase.from('profile_object_permissions').delete().eq('profile_id', req.params.id);
    await supabase.from('profiles').delete().eq('id', req.params.id);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
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
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── PATCH /api/portal/permission-sets/:id
app.patch('/api/portal/permission-sets/:id', checkAuth, checkRole('admin'), async (req, res) => {
  const { name, description, permissions = [] } = req.body || {};
  try {
    if (name) await supabase.from('permission_sets').update({ name, description: description || null }).eq('id', req.params.id);
    if (permissions.length) {
      await supabase.from('permission_set_object_perms').delete().eq('perm_set_id', req.params.id);
      await supabase.from('permission_set_object_perms').insert(
        permissions.map(p => ({ perm_set_id: req.params.id, ...p }))
      );
    }
    await writeAuditLog({ userId: req.user.id, userEmail: req.user.email, userRole: req.user.role, action: 'update_perm_set', payload: { id: req.params.id }, ipAddress: req.ip });
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── DELETE /api/portal/permission-sets/:id
app.delete('/api/portal/permission-sets/:id', checkAuth, checkRole('admin'), async (req, res) => {
  try {
    await supabase.from('user_permission_set_assignments').delete().eq('perm_set_id', req.params.id);
    await supabase.from('permission_set_object_perms').delete().eq('perm_set_id', req.params.id);
    await supabase.from('permission_sets').delete().eq('id', req.params.id);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── GET /api/portal/audit-log
app.get('/api/portal/audit-log', checkAuth, checkRole('admin'), async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 100, 500);
    const { data, error } = await supabase
      .from('audit_log')
      .select('id, created_at, user_email, user_role, action, sf_object, record_id, ip_address')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw error;
    res.json({ logs: data || [] });
  } catch(e) { res.status(500).json({ error: e.message }); }
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

    if (userIds.length) {
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
        id:           u.id,
        email:        u.email,
        name:         u.name,
        role:         u.role,
        isActive:     u.is_active,
        mustChangePw: u.must_change_pw,
        createdAt:    u.created_at,
        lastLoginAt:  u.last_login_at,
        profile:      u.profile_id ? { id: u.profile_id, name: u.profile_name } : null,
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
    const token  = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (token) {
      const decoded = jwt.verify(token, JWT_SECRET);
      await writeAuditLog({
        userId:    decoded.id,
        userEmail: decoded.email,
        userRole:  decoded.role,
        action:    'logout',
        ipAddress: req.ip
      });
    }
  } catch { /* token already expired, that's fine */ }

  res.json({ success: true, message: 'Portal session ended' });
});

// Salesforce logout — SEPARATE route, super_admin only
app.post('/api/auth/salesforce-logout', checkAuth, checkRole('super_admin'), async (req, res) => {
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
  _cachedToken    = null;
  _tokenExpires   = 0;
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

  if (!OBJECTS[object]) return res.status(400).json({ error: `Unknown object: ${object}` });

  try {
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
    const data = await sfGet('/query', {
      q: `SELECT ${selectFields} FROM ${object} ${where === 'WHERE ' ? '' : where} ORDER BY ${OBJECTS[object].orderBy} LIMIT 25`
    });
    res.json({
      records: (data.records || []).map((record) => ({
        ...record,
        Name: record.Name || record.Subject || record.CaseNumber || record.Id
      }))
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

app.get('/api/:object/count', async (req, res) => {
  const { object } = req.params;
  if (!OBJECTS[object]) return res.status(400).json({ error: `Unknown object: ${object}` });

  try {
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

app.get('/api/debug/data-source', async (req, res) => {
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

app.get('/api/:object/listviews/:id/results', checkAuth, async (req, res) => {
  const { object, id } = req.params;
  if (!OBJECTS[object]) return res.status(400).json({ error: `Unknown object: ${object}` });

  try {
    if (req.query.cursor) {
      const data = await sfGet(queryMoreEndpoint(req.query.cursor), {}, { headers: QUERY_BATCH_HEADERS });
      return res.json({
        records: data.records || [],
        totalSize: data.totalSize || 0,
        done: Boolean(data.done),
        nextRecordsUrl: data.nextRecordsUrl || null
      });
    }

    const detail = await sfGet(`/sobjects/${object}/listviews/${id}/describe`);
    const data = await sfGet('/query', { q: detail.query }, { headers: QUERY_BATCH_HEADERS });
    res.json({
      label: detail.label,
      columns: detail.columns || [],
      query: detail.query,
      records: data.records || [],
      totalSize: data.totalSize || 0,
      done: Boolean(data.done),
      nextRecordsUrl: data.nextRecordsUrl || null
    });
  } catch (err) {
    handleSFError(err, res, `List view results ${object}/${id}`);
  }
});

app.get('/api/:object/fields', checkAuth, async (req, res) => {
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
    res.json({ fields });
  } catch (err) {
    handleSFError(err, res, `Fields ${object}`);
  }
});

// Global SOSL search
app.get('/api/search/global', checkAuth, async (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q) return res.json({ searchRecords: [] });

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
    res.json(data);
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
  if (!OBJECTS[object]) return res.status(400).json({ error: `Unknown object: ${object}` });

  try {
    const lists = await getRelatedListsForRecord(object, id);
    res.json({ object, id, lists });
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
app.post('/api/bulk/query', async (req, res) => {
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

app.get('/api/bulk/query/:jobId', async (req, res) => {
  try {
    res.json({ job: await getBulkQueryJob(req.params.jobId) });
  } catch (err) {
    handleSFError(err, res, `Bulk query job ${req.params.jobId}`);
  }
});

app.get('/api/bulk/query/:jobId/results', async (req, res) => {
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

app.post('/api/bulk/:object/query', async (req, res) => {
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
app.post('/api/bulk/:object/:operation', async (req, res) => {
  const { object, operation } = req.params;
  if (!OBJECTS[object]) return res.status(400).json({ error: `Unknown object: ${object}` });
  if (!['insert', 'update', 'upsert', 'delete'].includes(operation)) {
    return res.status(400).json({ error: 'Bulk operation must be insert, update, upsert, or delete' });
  }

  try {
    const records = Array.isArray(req.body) ? req.body : req.body?.records;
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
app.get('/api/:object', checkAuth, async (req, res, next) => {
  const obj = req.params.object;
  if (OBJECTS[obj]) return checkPermission(obj, 'can_read')(req, res, next);
  next();
}, async (req, res) => {
  const { object } = req.params;
  
  if (!OBJECTS[object]) return res.status(400).json({ error: `Unknown object: ${object}` });

  try {
    if (req.query.cursor) {
      const data = await sfGet(queryMoreEndpoint(req.query.cursor), {}, { headers: QUERY_BATCH_HEADERS });
      return res.json({
        records: data.records || [],
        totalSize: data.totalSize || 0,
        done: Boolean(data.done),
        nextRecordsUrl: data.nextRecordsUrl || null
      });
    }

    const soql = await buildSOQL(object, req.query.search, req.query.where);
    const data = await sfGet('/query', { q: soql }, { headers: QUERY_BATCH_HEADERS });
    res.json({
      ...data,
      records: data.records || [],
      totalSize: data.totalSize || 0,
      done: Boolean(data.done),
      nextRecordsUrl: data.nextRecordsUrl || null
    });
  } catch (err) {
    handleSFError(err, res, `GET ${object}`);
  }
});

app.get('/api/:object/:id', checkAuth, async (req, res, next) => {
  const obj = req.params.object;
  if (OBJECTS[obj]) return checkPermission(obj, 'can_read')(req, res, next);
  next();
}, async (req, res) => {
  const { object, id } = req.params;
  if (!OBJECTS[object]) return res.status(400).json({ error: `Unknown object: ${object}` });

  try {
    const record = await sfGet(`/sobjects/${object}/${id}`);
    const meta = await sfGet(`/sobjects/${object}/describe`);
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
        picklistValues: normalizePicklistValues(field)
      }));
    const lookupLabels = await buildLookupLabels(record, fields);
    res.json({ record, fields, lookupLabels });
  } catch (err) {
    handleSFError(err, res, `GET ${object}/${id}`);
  }
});

// Create record
app.post('/api/:object', checkAuth, async (req, res, next) => {
  const obj = req.params.object;
  if (OBJECTS[obj]) return checkPermission(obj, 'can_create')(req, res, next);
  next();
}, async (req, res) => {
  const { object } = req.params;
  if (!OBJECTS[object]) return res.status(400).json({ error: `Unknown object: ${object}` });

  try {
    const records = Array.isArray(req.body) ? req.body : req.body?.records;
    if (Array.isArray(records)) {
      if (!records.length) return res.status(400).json({ error: 'Create requires at least one record' });
      if (records.length >= BULK_AUTO_THRESHOLD || req.query.bulk === 'true' || req.body?.bulk === true) {
        const result = await runBulkIngest(object, 'insert', records, {
          wait: req.body?.wait,
          includeResults: req.body?.includeResults
        });
        return res.json({ ...result, bulk: true });
      }

      const result = await sfPost('/composite/sobjects', {
        allOrNone: false,
        records: records.map((record) => ({
          attributes: { type: object },
          ...flattenRecord(record)
        }))
      });
      return res.json({ bulk: false, result });
    }

    const result = await sfPost(`/sobjects/${object}`, req.body);
    res.json(result);
  } catch (err) {
    handleSFError(err, res, `POST ${object}`);
  }
});

// Bulk-aware update route for array payloads: { records: [{ Id, ...fields }] }
app.patch('/api/:object', async (req, res) => {
  const { object } = req.params;
  if (!OBJECTS[object]) return res.status(400).json({ error: `Unknown object: ${object}` });

  try {
    const records = Array.isArray(req.body) ? req.body : req.body?.records;
    if (!Array.isArray(records) || !records.length) {
      return res.status(400).json({ error: 'Update requires records with Id values' });
    }

    if (records.length >= BULK_AUTO_THRESHOLD || req.query.bulk === 'true' || req.body?.bulk === true) {
      const result = await runBulkIngest(object, 'update', records, {
        wait: req.body?.wait,
        includeResults: req.body?.includeResults
      });
      return res.json({ ...result, bulk: true });
    }

    const results = await Promise.allSettled(records.map((record) => {
      const clean = flattenRecord(record);
      const { Id, ...fields } = clean;
      if (!Id) throw new Error('Update requires Id on every record');
      return sfPatch(`/sobjects/${object}/${Id}`, fields);
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
app.patch('/api/:object/:id', checkAuth, async (req, res, next) => {
  const obj = req.params.object;
  if (OBJECTS[obj]) return checkPermission(obj, 'can_edit')(req, res, next);
  next();
}, async (req, res) => {
  const { object, id } = req.params;
  if (!OBJECTS[object]) return res.status(400).json({ error: `Unknown object: ${object}` });

  try {
    await sfPatch(`/sobjects/${object}/${id}`, req.body);
    res.json({ success: true });
  } catch (err) {
    handleSFError(err, res, `PATCH ${object}/${id}`);
  }
});

// Bulk-aware delete route for array payloads: { ids: [] } or { records: [{ Id }] }
app.delete('/api/:object', async (req, res) => {
  const { object } = req.params;
  if (!OBJECTS[object]) return res.status(400).json({ error: `Unknown object: ${object}` });

  try {
    const ids = Array.isArray(req.body?.ids)
      ? req.body.ids
      : (Array.isArray(req.body?.records) ? req.body.records.map((record) => record.Id) : []);
    const records = [...new Set(ids.map(String).filter(Boolean))].map((Id) => ({ Id }));
    if (!records.length) return res.status(400).json({ error: 'Delete requires ids or records with Id values' });

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
    await sfDelete(`/sobjects/${object}/${id}`);
    res.json({ success: true });
  } catch (err) {
    handleSFError(err, res, `DELETE ${object}/${id}`);
  }
});

// Global SOSL search
app.get('/api/search/global',checkAuth, async (req, res) => {
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
    res.json(data);
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
  console.log(`\n╔══════════════════════════════════════════╗`);
  console.log(`║   SF Manager  →  http://localhost:${PORT}   ║`);
  console.log(`╚══════════════════════════════════════════╝`);
  console.log(`\n📡 Instance : ${SF.instanceUrl}`);
  console.log(`🔑 Testing auth...`);
  try {
    await getAccessToken();
    console.log(`✅ Salesforce connection established!\n`);
  } catch (e) {
    console.error(`❌ Auth failed: ${e.message}\n`);
  }
});
