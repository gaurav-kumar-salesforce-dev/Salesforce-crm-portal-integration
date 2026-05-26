require('dotenv').config();
const express = require('express');
const axios   = require('axios');
const path    = require('path');
const fs      = require('fs');
const crypto  = require('crypto');

const app = express();
app.use(express.json());
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
    const where = search ? `WHERE Name LIKE '%${search}%'` : '';
    const data = await sfGet('/query', {
      q: `SELECT Id, Name FROM ${object} ${where} ORDER BY Name LIMIT 25`
    });
    res.json({ records: data.records || [] });
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
        picklistValues: field.picklistValues?.filter(item => item.active).map(item => item.value) || []
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
  if (!['Campaign', 'Contact', 'Lead'].includes(object)) return res.json({ records: [], warnings: [] });

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
    const data = await sfGet('/query', {
      q: "SELECT Id, Name, DeveloperName, Subject, TemplateType, IsActive, FolderName FROM EmailTemplate WHERE IsActive = true ORDER BY Name LIMIT 200"
    });
    res.json({ records: data.records || [] });
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

    const html = cleanTemplateBody(template.HtmlValue || template.Body || '');
    const mergedHtml = mergeTemplate(html, recipient, campaign, context.sender, context.organization);
    const subject = mergeTemplate(template.Subject || '', recipient, campaign, context.sender, context.organization);
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

    const templateBody = cleanTemplateBody(template.HtmlValue || template.Body || '');
    const isHtmlTemplate = Boolean(template.HtmlValue);
    const mergedMessages = members.map((member) => {
      const mergedBody = mergeTemplate(templateBody, member, campaign, context.sender, context.organization);
      const subject = mergeTemplate(template.Subject || campaign.Name || 'Campaign email', member, campaign, context.sender, context.organization);
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
        picklistValues: field.picklistValues?.filter(item => item.active).map(item => item.value) || []
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
    const result = await sfPost(`/sobjects/${object}`, req.body);
    res.json(result);
  } catch (err) {
    handleSFError(err, res, `POST ${object}`);
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
