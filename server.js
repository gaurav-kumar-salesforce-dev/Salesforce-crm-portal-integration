require('dotenv').config();
const express = require('express');
const axios   = require('axios');
const path    = require('path');
const fs      = require('fs');
const crypto  = require('crypto');

const app = express();
app.use(express.json({ limit: process.env.JSON_BODY_LIMIT || '25mb' }));
app.use(express.static(path.join(__dirname, 'public')));

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

function normalizeUrl(url) {
  return url ? url.replace(/\/+$/, '') : url;
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

async function sfGet(endpoint, params = {}) {
  const token = await getAccessToken();
  const res = await axios.get(`${baseUrl()}${endpoint}`, {
    headers: { Authorization: `Bearer ${token}` },
    params
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

async function sfPatch(endpoint, body) {
  const token = await getAccessToken();
  await axios.patch(`${baseUrl()}${endpoint}`, body, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
  });
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

function buildBulkSOQL(objectName, search, extraWhere) {
  const cfg = OBJECTS[objectName];
  let soql = `SELECT ${cfg.fields} FROM ${objectName}`;
  soql += buildWhereClause(objectName, search, extraWhere);
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

function buildWhereClause(objectName, search, extraWhere) {
  const cfg = OBJECTS[objectName];
  const conditions = [];

  if (search && search.trim()) {
    // Escape single quotes to prevent SOQL injection
    const safe = escapeSOQL(search);
    const parts = cfg.searchFields.map(f => `${f} LIKE '%${safe}%'`);
    conditions.push(`(${parts.join(' OR ')})`);
  }

  if (extraWhere) conditions.push(extraWhere);
  return conditions.length ? ` WHERE ${conditions.join(' AND ')}` : '';
}

function buildSOQL(objectName, search, extraWhere, limit = 25, offset = 0) {
  const cfg = OBJECTS[objectName];
  const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 25, 1), 100);
  const safeOffset = Math.max(parseInt(offset, 10) || 0, 0);
  let soql = `SELECT ${cfg.fields} FROM ${objectName}`;
  soql += buildWhereClause(objectName, search, extraWhere);
  soql += ` ORDER BY ${cfg.orderBy} LIMIT ${safeLimit} OFFSET ${safeOffset}`;

  return soql;
}

function buildCountSOQL(objectName, search, extraWhere) {
  return `SELECT COUNT() FROM ${objectName}${buildWhereClause(objectName, search, extraWhere)}`;
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

  return {
    id: record.Id,
    type: record.TaskSubtype || 'Task',
    subject: record.Subject || 'Task',
    actor: record.Owner?.Name || '',
    target: record.Who?.Name || '',
    targetId: record.WhoId || '',
    targetObject: objectFromId(record.WhoId),
    when: record.ActivityDate || record.CreatedDate,
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

function dedupeCampaignEmailActivities(records) {
  const emailKeys = new Set(records
    .filter((record) => record.id?.startsWith('02s'))
    .map((record) => `${normalizeEmailSubject(record.subject)}|${String(record.target || '').toLowerCase()}`));

  if (!emailKeys.size) return records;

  return records.filter((record) => {
    if (!record.id?.startsWith('00T') || !String(record.type || '').toLowerCase().includes('email')) return true;
    const key = `${normalizeEmailSubject(record.subject)}|${extractEmailRecipient(record.body)}`;
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

// Auth test
app.get('/api/auth/test', async (req, res) => {
  try {
    await getAccessToken();
    res.json({ success: true, instance: SF.instanceUrl, connectUrl: '/auth/salesforce' });
  } catch (err) {
    res.status(401).json({ success: false, error: err.message, connectUrl: '/auth/salesforce' });
  }
});

app.get('/api/auth/config', (req, res) => {
  res.json({
    loginUrl: SF.loginUrl,
    instanceUrl: SF.instanceUrl,
    redirectUri: SF.redirectUri,
    hasClientId: Boolean(SF.clientId),
    hasClientSecret: Boolean(SF.clientSecret),
    hasRefreshToken: Boolean(SF.refreshToken)
  });
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

app.post('/api/auth/logout', async (req, res) => {
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
    console.error('Logout revoke warning:', err.response?.data || err.message);
  }

  SF.refreshToken = '';
  _cachedToken = null;
  _tokenExpires = 0;
  upsertEnv({ SF_REFRESH_TOKEN: '' });
  res.json({ success: true });
});

app.get('/api/me', async (req, res) => {
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
  if (!SF.clientId || !SF.loginUrl) {
    return res.status(500).send('Missing SF_CLIENT_ID or SF_LOGIN_URL in .env');
  }

  const state = crypto.randomBytes(16).toString('hex');
  const pkce = createPkcePair();
  oauthStates.set(state, {
    codeVerifier: pkce.verifier,
    createdAt: Date.now()
  });

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: SF.clientId,
    redirect_uri: SF.redirectUri,
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

    upsertEnv({
      SF_REFRESH_TOKEN: SF.refreshToken,
      SF_INSTANCE_URL: SF.instanceUrl,
      SF_REDIRECT_URI: SF.redirectUri
    });

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

app.get('/api/lookup/:object', async (req, res) => {
  const { object } = req.params;
  const search = String(req.query.search || '').trim().replace(/'/g, "\\'");

  if (!OBJECTS[object]) return res.status(400).json({ error: `Unknown object: ${object}` });

  try {
    const searchFields = OBJECTS[object].searchFields || ['Name'];
    const where = search
      ? `WHERE ${searchFields.map((field) => `${field} LIKE '%${search}%'`).join(' OR ')}`
      : '';
    const fields = {
      Case: 'Id, CaseNumber, Subject, AccountId, Account.Name',
      Contact: 'Id, Name, Email, AccountId, Account.Name',
      Lead: 'Id, Name, Email, Company',
      User: 'Id, Name, Email, Username',
      Opportunity: 'Id, Name, AccountId, Account.Name'
    }[object] || OBJECTS[object].fields;
    const data = await sfGet('/query', {
      q: `SELECT ${fields} FROM ${object} ${where} ORDER BY ${OBJECTS[object].orderBy} LIMIT 25`
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

app.get('/api/:object/listviews', async (req, res) => {
  const { object } = req.params;
  if (!OBJECTS[object]) return res.status(400).json({ error: `Unknown object: ${object}` });

  try {
    const data = await sfGet(`/sobjects/${object}/listviews`);
    res.json(data);
  } catch (err) {
    handleSFError(err, res, `List views ${object}`);
  }
});

app.get('/api/:object/listviews/:id/results', async (req, res) => {
  const { object, id } = req.params;
  if (!OBJECTS[object]) return res.status(400).json({ error: `Unknown object: ${object}` });

  try {
    const detail = await sfGet(`/sobjects/${object}/listviews/${id}/describe`);
    const data = await sfGet('/query', { q: detail.query });
    res.json({
      label: detail.label,
      columns: detail.columns || [],
      query: detail.query,
      records: data.records || [],
      totalSize: data.totalSize || 0
    });
  } catch (err) {
    handleSFError(err, res, `List view results ${object}/${id}`);
  }
});

app.get('/api/:object/fields', async (req, res) => {
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
app.get('/api/search/global', async (req, res) => {
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
app.get('/api/meta/:object/picklist/:field', async (req, res) => {
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

app.get('/api/campaigns/:id/members', async (req, res) => {
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

app.get('/api/:object/:id/activity', async (req, res) => {
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
    if (object === 'Campaign') records = dedupeCampaignEmailActivities(records);

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

app.post('/api/:object/:id/activity', async (req, res) => {
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
      const attachmentNames = uploadedAttachments.map((file) => file.name);
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

      const taskResult = await createTaskActivity({
        Subject: `Email: ${subject}`,
        Status: 'Completed',
        Priority: 'Normal',
        ActivityDate: new Date().toISOString().slice(0, 10),
        Description: [
          `From: ${from.email || from.label || 'Current User'}`,
          `To: ${toAddresses.join(', ')}`,
          ccAddresses.length ? `Cc: ${ccAddresses.join(', ')}` : '',
          bccAddresses.length ? `Bcc: ${bccAddresses.join(', ')}` : '',
          attachmentNames.length ? `Attachments: ${attachmentNames.join(', ')}` : '',
          '',
          stripHtml(body)
        ].filter((line) => line !== '').join('\n'),
        ...owner,
        ...relation
      }, 'Email');
      return res.json({ success: true, result: emailResult, taskResult });
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
    const where = buildWhereClause(object, search, object === 'Lead' ? "IsConverted = false" : '');
    const soql = `SELECT ${cfg.fields} FROM ${object}${where} ORDER BY ${cfg.orderBy} LIMIT 100`;
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
    const soql = req.body?.soql || buildBulkSOQL(object, req.body?.search, req.body?.where);
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
app.get('/api/:object', async (req, res) => {
  const { object } = req.params;
  if (!OBJECTS[object]) return res.status(400).json({ error: `Unknown object: ${object}` });

  try {
    const pageSize = Math.min(Math.max(parseInt(req.query.pageSize, 10) || 25, 1), 100);
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const offset = (page - 1) * pageSize;
    const soql = buildSOQL(object, req.query.search, req.query.where, pageSize, offset);
    const countSOQL = buildCountSOQL(object, req.query.search, req.query.where);
    const [data, countData] = await Promise.all([
      sfGet('/query', { q: soql }),
      sfGet('/query', { q: countSOQL })
    ]);
    const countValue = Number(countData.records?.[0]?.expr0);
    res.json({
      ...data,
      totalSize: countValue > 0 ? countValue : data.totalSize || 0,
      page,
      pageSize
    });
  } catch (err) {
    handleSFError(err, res, `GET ${object}`);
  }
});

app.get('/api/:object/:id', async (req, res) => {
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
app.post('/api/:object', async (req, res) => {
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
app.patch('/api/:object/:id', async (req, res) => {
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
app.delete('/api/:object/:id', async (req, res) => {
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
app.get('/api/search/global', async (req, res) => {
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
app.get('/api/meta/:object/picklist/:field', async (req, res) => {
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
