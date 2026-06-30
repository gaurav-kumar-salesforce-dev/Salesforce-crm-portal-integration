// ── Theme Toggle ──────────────────────────────────────────
function initTheme() {
  const saved = localStorage.getItem('saasray_theme');
  if (saved === 'dark') {
    document.documentElement.setAttribute('data-theme', 'dark');
  } else {
    document.documentElement.removeAttribute('data-theme');
  }
}
function toggleTheme() {
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  if (isDark) {
    document.documentElement.removeAttribute('data-theme');
    localStorage.setItem('saasray_theme', 'light');
  } else {
    document.documentElement.setAttribute('data-theme', 'dark');
    localStorage.setItem('saasray_theme', 'dark');
  }
}
initTheme();

function userInitials(name, fallback = "U") {
  return (name || fallback)
    .split(/\s+/)
    .filter(Boolean)
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase() || fallback;
}

function avatarButtonContent(user, fallback = "U") {
  return user?.profileImage
    ? `<img src="${escapeHtml(user.profileImage)}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`
    : escapeHtml(userInitials(user?.name, fallback));
}

function setTopbarAvatar(user, fallback = "U") {
  const button = $("profileButton");
  if (!button) return;
  button.innerHTML = avatarButtonContent(user, fallback);
}

function readProfileImageFile(file) {
  return new Promise((resolve, reject) => {
    if (!file) return resolve(null);
    if (!/^image\/(png|jpe?g|webp|gif)$/i.test(file.type)) {
      reject(new Error("Use a PNG, JPG, WEBP, or GIF image"));
      return;
    }
    if (file.size > 750 * 1024) {
      reject(new Error("Image must be smaller than 750 KB"));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Could not read image"));
    reader.readAsDataURL(file);
  });
}

const OBJECT_META = {
  Account: {
    title: "Accounts",
    icon: "account",
    columns: [
      "Name",
      "Type",
      "Industry",
      "Phone",
      "BillingCity",
      "BillingState",
    ],
    editable: [
      "Name",
      "Type",
      "Industry",
      "Phone",
      "Website",
      "BillingCity",
      "BillingState",
    ],
  },
  Contact: {
    title: "Contacts",
    icon: "contact",
    columns: ["Name", "Account.Name", "Email", "Phone", "Title"],
    editable: ["FirstName", "LastName", "Email", "Phone", "Title", "AccountId"],
    lookups: { AccountId: { object: "Account", label: "Account" } },
  },
  Opportunity: {
    title: "Opportunities",
    icon: "opportunity",
    columns: [
      "Name",
      "StageName",
      "Amount",
      "CloseDate",
      "Account.Name",
      "Probability",
    ],
    editable: [
      "Name",
      "StageName",
      "Amount",
      "CloseDate",
      "AccountId",
      "Probability",
      "LeadSource",
    ],
    lookups: { AccountId: { object: "Account", label: "Account" } },
  },
  Case: {
    title: "Cases",
    icon: "case",
    columns: [
      "CaseNumber",
      "Subject",
      "Status",
      "Priority",
      "Type",
      "Account.Name",
      "CreatedDate",
    ],
    editable: [
      "Subject",
      "Status",
      "Priority",
      "Type",
      "AccountId",
      "Description",
    ],
    lookups: { AccountId: { object: "Account", label: "Account" } },
  },
  Lead: {
    title: "Leads",
    icon: "lead",
    columns: [
      "Name",
      "Email",
      "Phone",
      "Company",
      "Status",
      "Title",
      "LeadSource",
    ],
    editable: [
      "FirstName",
      "LastName",
      "Email",
      "Phone",
      "Company",
      "Status",
      "Title",
      "LeadSource",
    ],
  },
  Campaign: {
    title: "Campaigns",
    icon: "campaign",
    columns: [
      "Name",
      "Type",
      "Status",
      "StartDate",
      "EndDate",
      "IsActive",
      "NumberOfContacts",
      "NumberOfLeads",
    ],
    editable: [
      "Name",
      "Type",
      "Status",
      "StartDate",
      "EndDate",
      "IsActive",
      "Description",
    ],
  },
  Task: {
    title: "Tasks",
    icon: "task",
    columns: [
      "Subject",
      "Status",
      "Priority",
      "ActivityDate",
      "Who.Name",
      "What.Name",
    ],
    editable: [
      "Subject",
      "Status",
      "Priority",
      "ActivityDate",
      "WhoId",
      "WhatId",
      "Description",
    ],
    lookups: {
      WhoId: { object: "Contact", label: "Name" },
      WhatId: { object: "Account", label: "Related To" },
      OwnerId: { object: "User", label: "Assigned To" },
    },
  },
  Event: {
    title: "Events",
    icon: "event",
    columns: [
      "Subject",
      "StartDateTime",
      "EndDateTime",
      "Location",
      "Who.Name",
      "What.Name",
    ],
    editable: [
      "Subject",
      "StartDateTime",
      "EndDateTime",
      "IsAllDayEvent",
      "Location",
      "WhoId",
      "WhatId",
      "Description",
    ],
    lookups: {
      WhoId: { object: "Contact", label: "Name" },
      WhatId: { object: "Account", label: "Related To" },
      OwnerId: { object: "User", label: "Assigned To" },
    },
  },
  EmailMessage: {
    title: "Email Messages",
    icon: "email",
    columns: [
      "Subject",
      "FromAddress",
      "ToAddress",
      "MessageDate",
      "Status",
      "RelatedTo.Name",
    ],
    editable: ["Subject", "Status", "RelatedToId"],
    lookups: {
      RelatedToId: { object: "Account", label: "Related To" },
      CreatedById: { object: "User", label: "Created By" },
    },
  },
  User: {
    title: "Users",
    icon: "user",
    columns: ["Name", "Email", "Username", "Title"],
    editable: [],
  },
};

const OBJECT_FIELD_LAYOUTS = {
  Account: [
    {
      title: "Account Information",
      fields: [
        "Name",
        { name: "OwnerId", readOnly: true },
        "Type",
        "ParentId",
        "Customer #",
        "Phone",
        "Payment Terms",
        "Website",
        "Sage ID",
        "Compliance Status",
        "Riggio Vendor Account Number",
        "Tax-Exempt",
        "Tax-Exempt Expiration",
        "Industry",
        "Industry (Custom)",
        "Customer Status",
        "Territory",
        "Division",
        "Relationship Status",
      ],
    },
    { title: "Description Information", fields: ["Description"] },
    {
      title: "Address Information",
      fields: [
        "BillingCountry",
        "ShippingCountry",
        "BillingStreet",
        "ShippingStreet",
        "BillingCity",
        "BillingState",
        "BillingPostalCode",
        "ShippingCity",
        "ShippingState",
        "ShippingPostalCode",
      ],
    },
  ],
  Contact: [
    {
      title: "Contact Information",
      fields: [
        "Salutation",
        { name: "OwnerId", readOnly: true },
        "FirstName",
        "LastName",
        "AccountId",
        "Email",
        "Title",
        "Phone",
        "Customer #",
        "Mobile",
        "Primary",
        "LinkedIn Profile",
      ],
    },
    {
      title: "Address Information",
      fields: [
        "MailingCountry",
        "MailingStreet",
        "MailingCity",
        "MailingState",
        "MailingPostalCode",
      ],
    },
    {
      title: "System Information",
      fields: [{ name: "CreatedById", readOnly: true }],
    },
  ],
  Lead: [
    {
      title: "Lead Information",
      fields: [
        { name: "OwnerId", readOnly: true },
        "Phone",
        "Salutation",
        "Mobile",
        "FirstName",
        "LastName",
        "Company",
        "Fax",
        "Title",
        "Email",
        "LeadSource",
        "Website",
        "Industry",
        "Status",
        "AnnualRevenue",
        "Rating",
        "NumberOfEmployees",
      ],
    },
    {
      title: "Address",
      fields: ["Country", "Street", "City", "State", "PostalCode"],
    },
    {
      title: "Additional Information",
      fields: [
        "Product Interest",
        "SIC Code",
        "Current Generator(s)",
        "Primary",
        "Number of Locations",
        { name: "CreatedById", readOnly: true },
        { name: "LastModifiedById", readOnly: true },
        "Description",
      ],
    },
  ],
  Case: [
    {
      title: "Case Information",
      fields: [
        { name: "OwnerId", readOnly: true },
        "Status",
        { name: "CaseNumber", readOnly: true },
        "Priority",
        "ContactId",
        { name: "Contact Phone", readOnly: true },
        "AccountId",
        { name: "Contact Email", readOnly: true },
        "Type",
        "Origin",
        "Reason",
        "WebEmail",
        "SuppliedEmail",
        "WebCompany",
        "SuppliedCompany",
        "WebName",
        "SuppliedName",
        "WebPhone",
        "SuppliedPhone",
        { name: "CreatedDate", readOnly: true },
        { name: "ClosedDate", readOnly: true },
        "Product",
        "Engineering Req Number",
        "Potential Liability",
        "SLA Violation",
        { name: "CreatedById", readOnly: true },
        { name: "LastModifiedById", readOnly: true },
        "Subject",
        "Description",
        "Internal Comments",
      ],
    },
  ],
  Opportunity: [
    {
      title: "Opportunity Information",
      fields: [
        "Name",
        { name: "OwnerId", readOnly: true },
        "AccountId",
        "CloseDate",
        "Amount",
        "StageName",
        "Invoice Number",
        "Pricebook2Id",
        "Date Invoice Sent",
        "Customer PO",
        "Total Hours (Job)",
        { name: "Vendor Total Cost", readOnly: true },
        { name: "Riggio Total Cost for Parts (Actual)", readOnly: true },
      ],
    },
    { title: "Additional Information", fields: ["NextStep", "LeadSource"] },
    {
      title: "Description Information",
      fields: [
        "SOW",
        "Description",
        { name: "CreatedById", readOnly: true },
        { name: "LastModifiedById", readOnly: true },
        "Probability",
      ],
    },
  ],
  Campaign: [
    {
      title: "Campaign Information",
      fields: [
        { name: "OwnerId", readOnly: true },
        { name: "NumberOfLeads", readOnly: true },
        "Name",
        { name: "NumberOfConvertedLeads", readOnly: true },
        "IsActive",
        { name: "NumberOfContacts", readOnly: true },
        "Type",
        { name: "NumberOfResponses", readOnly: true },
        "Status",
        { name: "NumberOfOpportunities", readOnly: true },
        "StartDate",
        { name: "NumberOfWonOpportunities", readOnly: true },
        "EndDate",
        { name: "AmountWonOpportunities", readOnly: true },
        "ExpectedRevenue",
        { name: "AmountAllOpportunities", readOnly: true },
        "BudgetedCost",
        "ActualCost",
        "ExpectedResponse",
        "NumberSent",
        "ParentId",
        "Event",
        { name: "CreatedById", readOnly: true },
        { name: "LastModifiedById", readOnly: true },
        "Description",
      ],
    },
  ],
  Task: [
    {
      title: "Task Information",
      fields: [
        { name: "OwnerId", readOnly: true },
        "Subject",
        "ActivityDate",
        "Status",
        "Priority",
        "WhoId",
        "WhatId",
        "Description",
      ],
    },
    {
      title: "Additional Information",
      fields: [
        "TaskSubtype",
        { name: "CreatedDate", readOnly: true },
        { name: "CreatedById", readOnly: true },
        { name: "LastModifiedDate", readOnly: true },
        { name: "LastModifiedById", readOnly: true },
      ],
    },
  ],
  Event: [
    {
      title: "Calendar Details",
      fields: [
        { name: "OwnerId", readOnly: true },
        "Subject",
        "IsAllDayEvent",
        "StartDateTime",
        "EndDateTime",
        "WhoId",
        "WhatId",
        "Location",
        "Description",
      ],
    },
    {
      title: "System Information",
      fields: [
        { name: "CreatedDate", readOnly: true },
        { name: "CreatedById", readOnly: true },
        { name: "LastModifiedDate", readOnly: true },
        { name: "LastModifiedById", readOnly: true },
      ],
    },
  ],
  EmailMessage: [
    {
      title: "Information",
      fields: [
        "RelatedToId",
        "Status",
        "MessageDate",
        { name: "CreatedById", readOnly: true },
        { name: "CreatedDate", readOnly: true },
      ],
    },
    {
      title: "Address Information",
      fields: [
        "FromAddress",
        "FromName",
        "ToAddress",
        "CcAddress",
        "BccAddress",
      ],
    },
    { title: "Message Content", fields: ["Subject", "TextBody", "HtmlBody"] },
  ],
};

let currentObject = "Account";
let currentRecords = [];
let currentColumns = [];
let currentHiddenFields = new Set();
let currentViewId = "all";
let sfListViews = [];
let searchTimer = null;
let globalTimer = null;
let lookupTimer = null;
const CLIENT_CACHE_TTL_MS = 10 * 60 * 1000;
const RECENT_RECORD_CACHE_TTL_MS = 10 * 60 * 1000;
const RECENT_RECORD_CACHE_MAX = 100;
const SPA_STATE_STORAGE_KEY = "saasrayCrmSpaState:v1";
const LIST_VIEW_CACHE_TTL_MS = 10 * 60 * 1000;
const crmListCache = new Map();
const recentRecordCache = new Map();
const recordDetailInflight = new Map();
const apiInFlightRequests = new Map();
const crmBackgroundRefreshes = new Map();
const crmPageStates = new Map();
const listViewCache = new Map();
const objectTotalCountCache = new Map();
const spaCacheStats = {
  listHits: 0,
  listMisses: 0,
  pageRestores: 0,
  recordHits: 0,
  recordMisses: 0,
  automaticRefreshesRemoved: 0,
};
const objectFieldMetadataCache = new Map();
const sharedPerformanceCache = window.SaaSRAYPerformance || null;
let restoringCrmHistory = false;
let editingRecord = null;
let deletingRecord = null;
let currentUser = null;
let sortState = { field: null, direction: "asc" };
let totalRecords = 0;
let nextRecordsUrl = null;
const RENDER_CHUNK_SIZE = 50;
let visibleRecordCount = RENDER_CHUNK_SIZE;
let loadingMoreRecords = false;
let lazyObserver = null;
let lazyLoadQueued = false;
let listStateVersion = 0;
let listRestoreInProgress = false;
const VIRTUAL_ROW_ESTIMATE_PX = 57;
const VIRTUAL_MIN_BUFFER_ROWS = 8;
const VIRTUAL_MAX_BUFFER_ROWS = 40;
let virtualTableState = {
  signature: "",
  rowHeight: VIRTUAL_ROW_ESTIMATE_PX,
  rowHeightMeasured: false,
  start: -1,
  end: -1,
  pool: [],
  raf: 0,
};
let currentViewMode = "table";
let draggedKanbanId = null;
const kanbanPicklistCache = {};
let listContentHtml = "";
let viewingDetail = false;
let detailRecordState = null;
let selectedListRecordId = null;
let lastToastKey = "";
let lastToastAt = 0;
let activeCampaign = null;
let campaignMembers = [];
let recordActivities = [];
let campaignMemberSelection = new Set();
let memberCandidateObject = "Contact";
let memberCandidateSelection = new Set();
let currentCampaignCandidates = [];
let memberCandidateFilters = [];
let memberCandidatePage = 0;
let memberCandidateLimit = 50;
let memberCandidateTotal = 0;
let memberCandidateFields = [];
let emailTemplates = [];
let detailLookupLabels = {};
let expandedActivityIds = new Set();
let activityLookupState = {};
let emailComposerState = {};
let orgSettings = { activeOrgKey: "default", orgs: [] };
let chatterState = { activeTab: "post", loadedFor: "", mentions: [] };
let modalObject = null;
let modalPresetValues = {};
let savingRecord = false;
let supabaseAuthClient = null;
let supabaseAuthClientPromise = null;
let listViewDraft = null;

// Token storage helpers
function getAuthToken() {
  return localStorage.getItem("saasray_token");
}

function setAuthToken(token) {
  localStorage.setItem("saasray_token", token);
}

function clearAuthToken() {
  localStorage.removeItem("saasray_token");
  localStorage.removeItem("saasray_perms");
  window.userPerms = {};
  window.portalUser = null;
}

function getStoredPerms() {
  try {
    return JSON.parse(localStorage.getItem("saasray_perms") || "{}");
  } catch {
    return {};
  }
}

function setStoredPerms(perms) {
  localStorage.setItem("saasray_perms", JSON.stringify(perms));
  window.userPerms = perms;
}

function isTokenExpired(token) {
  try {
    const payload = JSON.parse(atob(token.split(".")[1]));
    return payload.exp && payload.exp * 1000 < Date.now();
  } catch {
    return true;
  }
}

const $ = (id) => document.getElementById(id);

function getLocalViews() {
  return JSON.parse(localStorage.getItem("sfmListViews") || "{}");
}

function setLocalViews(views) {
  localStorage.setItem("sfmListViews", JSON.stringify(views));
}

function isKanbanObject(objectName = currentObject) {
  return ["Opportunity", "Lead"].includes(objectName);
}

function kanbanFieldFor(objectName = currentObject) {
  return objectName === "Opportunity" ? "StageName" : "Status";
}

function kanbanFallbackValues(objectName = currentObject) {
  return objectName === "Opportunity"
    ? [
        "Prospecting",
        "Qualification",
        "Needs Analysis",
        "Value Proposition",
        "Id. Decision Makers",
        "Perception Analysis",
        "Proposal/Price Quote",
        "Negotiation/Review",
        "Closed Won",
        "Closed Lost",
      ]
    : [
        "Open - Not Contacted",
        "Working - Contacted",
        "Closed - Converted",
        "Closed - Not Converted",
      ];
}

function uniqueKanbanValues(values, objectName = currentObject) {
  const seen = new Set();
  return [...values, ...kanbanFallbackValues(objectName)]
    .map((value) => String(value || "").trim())
    .filter((value) => {
      if (!value || seen.has(value)) return false;
      seen.add(value);
      return true;
    });
}

function objectLocalViews() {
  return getLocalViews()[currentObject] || [];
}

function cleanListViewLabel(label) {
  return String(label || "")
    .replace(/^\s*(Salesforce|Portal)\s*[-:]\s*/i, "")
    .trim();
}

function humanizeFieldLabel(field) {
  return String(field || "")
    .replace(/\./g, " ")
    .replace(/__c$/i, "")
    .replace(/Id$/, "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim();
}

async function loadObjectFields(objectName = currentObject) {
  if (objectFieldMetadataCache.has(objectName)) {
    return objectFieldMetadataCache.get(objectName);
  }
  const metadataPath = `/api/${objectName}/fields`;
  const sharedCacheKey = `saasray:v1:${metadataPath}`;
  const sharedFields = sharedPerformanceCache?.getCacheValue?.(sharedCacheKey, "metadata");
  if (sharedFields?.fields?.length) {
    const fields = sharedFields.fields
      .filter((field) => field?.name && field.name !== "Id" && !String(field.name).includes("attributes"))
      .map((field) => ({
        ...field,
        label: cleanListViewLabel(field.label || humanizeFieldLabel(field.name)),
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
    if (fields.length) {
      objectFieldMetadataCache.set(objectName, fields);
      scheduleObjectMetadataPrefetch(objectName);
      return fields;
    }
  }
  const fallback = [...new Set([...(OBJECT_META[objectName]?.columns || []), ...(OBJECT_META[objectName]?.editable || [])])]
    .map((name) => ({ name, label: humanizeFieldLabel(name), type: "string" }));
  try {
    const token = getAuthToken();
    const data = sharedPerformanceCache?.fetchJson
      ? await sharedPerformanceCache.fetchJson(metadataPath, {
          cacheKey: sharedCacheKey,
          cacheType: "metadata",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
        })
      : await api(metadataPath);
    const fields = (data.fields || fallback)
      .filter((field) => field?.name && field.name !== "Id" && !String(field.name).includes("attributes"))
      .map((field) => ({
        ...field,
        label: cleanListViewLabel(field.label || humanizeFieldLabel(field.name)),
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
    objectFieldMetadataCache.set(objectName, fields.length ? fields : fallback);
    scheduleObjectMetadataPrefetch(objectName);
  } catch {
    objectFieldMetadataCache.set(objectName, fallback);
  }
  return objectFieldMetadataCache.get(objectName);
}

function scheduleObjectMetadataPrefetch(objectName = currentObject) {
  if (!sharedPerformanceCache?.prefetch) return;
  const token = getAuthToken();
  if (!token) return;
  const relatedObjectsByObject = {
    Account: ["Contact", "Opportunity", "Case"],
    Contact: ["Account", "Opportunity", "Task", "Event"],
    Opportunity: ["Account", "Contact"],
    Case: ["Account", "Contact"],
    Lead: ["Campaign"],
    Campaign: ["Lead"],
  };
  const targets = relatedObjectsByObject[objectName] || [];
  targets.forEach((target) => {
    const path = `/api/${target}/fields`;
    sharedPerformanceCache.prefetch(path, {
      cacheKey: `saasray:v1:${path}`,
      cacheType: "metadata",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
    });
  });
}

function getCachedObjectFields(objectName = currentObject) {
  return objectFieldMetadataCache.get(objectName) || [
    ...new Set([...(OBJECT_META[objectName]?.columns || []), ...(OBJECT_META[objectName]?.editable || [])]),
  ].map((name) => ({ name, label: humanizeFieldLabel(name), type: "string" }));
}

function fieldMetaFor(field, objectName = currentObject) {
  const fields = getCachedObjectFields(objectName);
  return fields.find((item) => item.name === field) || null;
}

function getCurrentLocalView() {
  if (!currentViewId.startsWith("local:")) return null;
  return objectLocalViews().find((item) => item.id === currentViewId.slice(6)) || null;
}

function normalizePortalColumns(columns, objectName = currentObject) {
  const hidden = currentHiddenFields || new Set();
  const valid = new Set(getCachedObjectFields(objectName).map((field) => field.name));
  const fallback = OBJECT_META[objectName]?.columns || [];
  const source = columns?.length ? columns : fallback;
  const seen = new Set();
  return source.filter((field) => {
    if (!field || field === "Id" || String(field).includes("attributes")) return false;
    if (hidden.has(field) || seen.has(field)) return false;
    if (valid.size && !valid.has(field) && !String(field).includes(".")) return false;
    seen.add(field);
    return true;
  });
}

function fieldTypeFor(field) {
  const type = String(fieldMetaFor(field)?.type || "").toLowerCase();
  if (type) return type;
  if (/date|time/i.test(field)) return "date";
  if (/amount|revenue|count|number|employees|probability|percent/i.test(field)) return "number";
  if (/email/i.test(field)) return "email";
  if (/phone|mobile/i.test(field)) return "phone";
  if (/url|website/i.test(field)) return "url";
  return "string";
}

function operatorOptionsForField(field) {
  const type = fieldTypeFor(field);
  if (["currency", "double", "int", "integer", "percent", "number"].includes(type)) {
    return ["equals", "not_equals", "gt", "gte", "lt", "lte", "between", "blank", "not_blank"];
  }
  if (["date", "datetime", "time"].includes(type)) {
    return ["equals", "before", "after", "today", "yesterday", "last_7_days", "last_30_days", "this_month", "last_month", "blank", "not_blank"];
  }
  if (type === "boolean") return ["true", "false", "blank", "not_blank"];
  return ["equals", "not_equals", "contains", "not_contains", "starts_with", "ends_with", "blank", "not_blank"];
}

function operatorLabel(operator) {
  return ({
    equals: "equals",
    not_equals: "not equal to",
    contains: "contains",
    not_contains: "does not contain",
    starts_with: "starts with",
    ends_with: "ends with",
    gt: "greater than",
    gte: "greater or equal",
    lt: "less than",
    lte: "less or equal",
    between: "between",
    before: "before",
    after: "after",
    today: "today",
    yesterday: "yesterday",
    last_7_days: "last 7 days",
    last_30_days: "last 30 days",
    this_month: "this month",
    last_month: "last month",
    blank: "is blank",
    not_blank: "is not blank",
    true: "is true",
    false: "is false",
  })[operator] || operator;
}

function viewSignatureForCache(view) {
  if (!view) return "";
  return JSON.stringify({
    columns: view.columns || [],
    filters: view.filters || [],
    filterLogic: view.filterLogic || "AND",
    pageSize: view.pageSize || RENDER_CHUNK_SIZE,
    sort: view.sort || null,
    version: view.version || 1,
  });
}

function persistCurrentLocalViewPatch(patch) {
  const view = getCurrentLocalView();
  if (!view) return;
  const views = getLocalViews();
  const list = views[currentObject] || [];
  const index = list.findIndex((item) => item.id === view.id);
  if (index < 0) return;
  list[index] = { ...list[index], ...patch, updatedAt: new Date().toISOString() };
  views[currentObject] = list;
  setLocalViews(views);
}

function objectIcon(objectName, record = null) {
  const key = objectIconKey(objectName, record);
  return `<span class="object-icon object-icon-${key}" aria-hidden="true">${standardIconImage(key)}</span>`;
}

function objectIconKey(objectName, record = null) {
  if (objectName === "Task") {
    const subtype = String(
      record?.TaskSubtype || record?.Subject || "",
    ).toLowerCase();
    if (subtype.includes("call")) return "call";
    if (subtype.includes("email")) return "email";
  }
  return OBJECT_META[objectName]?.icon || String(objectName).toLowerCase();
}

function standardIconImage(key) {
  const images = {
    account: "account_120.png",
    contact: "contact_120.png",
    opportunity: "new_opportunity_120.png",
    case: "case_120.png",
    lead: "lead_120.png",
    campaign: "campaign_120.png",
    task: "task_120.png",
    event: "event_120.png",
    email: "email_120.png",
    call: "log_a_call_120.png",
  };
  const file = images[key];
  if (!file) return standardIconSvg(key);
  return `<img src="/images/${file}" alt="" class="object-icon-img" loading="lazy">`;
}

function standardIconSvg(key) {
  const icons = {
    account:
      '<svg viewBox="0 0 24 24"><path d="M5 20V8.2L12 5l7 3.2V20h-5v-5h-4v5H5zm2-2h2v-3H7v3zm0-5h2v-2H7v2zm4 0h2v-2h-2v2zm4 0h2v-2h-2v2zm0 5h2v-3h-2v3zM8.3 9h7.4L12 7.3 8.3 9z"/></svg>',
    contact:
      '<svg viewBox="0 0 24 24"><path d="M12 12.2a3.9 3.9 0 100-7.8 3.9 3.9 0 000 7.8zM5 20a7 7 0 0114 0H5zm3.4-6.8a6.7 6.7 0 007.2 0 8.9 8.9 0 00-7.2 0z"/></svg>',
    opportunity:
      '<svg viewBox="0 0 24 24"><path d="M5 8.3l3.3 2.2L12 5l3.7 5.5L19 8.3V16a3 3 0 01-3 3H8a3 3 0 01-3-3V8.3zm3 5.4V16a1 1 0 001 1h6a1 1 0 001-1v-2.3l-1.4.9-2.6-3.9-2.6 3.9L8 13.7zM7 7a2 2 0 110-4 2 2 0 010 4zm10 0a2 2 0 110-4 2 2 0 010 4zm-5-2a2 2 0 110-4 2 2 0 010 4z"/></svg>',
    case: '<svg viewBox="0 0 24 24"><path d="M9 5V3h6v2h4a2 2 0 012 2v11a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h4zm2 0h2V4h-2v1zM5 10h14V7H5v3zm0 2v6h14v-6h-5v2h-4v-2H5z"/></svg>',
    lead: '<svg viewBox="0 0 24 24"><path d="M12 3a3 3 0 110 6 3 3 0 010-6zM5 12a4 4 0 014-4h6a4 4 0 014 4v1h-4l-3 7-3-7H5v-1zm6.2 1l.8 2 .8-2h-1.6z"/></svg>',
    campaign:
      '<svg viewBox="0 0 24 24"><path d="M12 3a9 9 0 109 9 9 9 0 00-9-9zm0 3a6 6 0 11-6 6 6 6 0 016-6zm0 2.5a3.5 3.5 0 103.5 3.5A3.5 3.5 0 0012 8.5z"/></svg>',
    user: '<svg viewBox="0 0 24 24"><path d="M12 12a4 4 0 100-8 4 4 0 000 8zm-6 8a6 6 0 0112 0H6z"/></svg>',
  };
  return (
    icons[key] || '<svg viewBox="0 0 24 24"><path d="M4 4h16v16H4z"/></svg>'
  );
}

function utilityIconSvg(key) {
  const icons = {
    chevronDown:
      '<svg viewBox="0 0 20 20"><path d="M5.2 7.6L10 12.4l4.8-4.8 1.2 1.2-6 6-6-6 1.2-1.2z"/></svg>',
    chevronRight:
      '<svg viewBox="0 0 20 20"><path d="M7.6 4l6 6-6 6-1.2-1.2 4.8-4.8-4.8-4.8L7.6 4z"/></svg>',
    task: '<svg viewBox="0 0 24 24"><path d="M5 4h14a2 2 0 012 2v12a2 2 0 01-2 2H5a2 2 0 01-2-2V6a2 2 0 012-2zm3 5l-1.4 1.4L10 13.8l7-7L15.6 5.4 10 11 8 9z"/></svg>',
    call: '<svg viewBox="0 0 24 24"><path d="M7 4l3 3-2 2c1.2 2.4 3.1 4.3 5.5 5.5l2-2 3 3-1.7 3c-.4.7-1.2 1-2 .8C9.9 18.6 5.4 14.1 4.2 9.2c-.2-.8.1-1.6.8-2L7 4z"/></svg>',
    event:
      '<svg viewBox="0 0 24 24"><path d="M7 2h2v3h6V2h2v3h2a2 2 0 012 2v12a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2V2zm12 8H5v9h14v-9z"/></svg>',
    email:
      '<svg viewBox="0 0 24 24"><path d="M4 5h16a2 2 0 012 2v10a2 2 0 01-2 2H4a2 2 0 01-2-2V7a2 2 0 012-2zm8 8l8-5.2V7l-8 5-8-5v.8L12 13z"/></svg>',
    like: '<svg viewBox="0 0 24 24"><path d="M8 21H4V9h4v12zm2 0V9l5-6 1.4 1.4L14.6 9H20a2 2 0 012 2l-1.2 7a3 3 0 01-3 3H10z"/></svg>',
    comment:
      '<svg viewBox="0 0 24 24"><path d="M4 5h16a2 2 0 012 2v8a2 2 0 01-2 2H9l-5 4v-4a2 2 0 01-2-2V7a2 2 0 012-2z"/></svg>',
    search:
      '<svg viewBox="0 0 24 24"><path d="M10 4a6 6 0 014.7 9.7l4.6 4.6-1.4 1.4-4.6-4.6A6 6 0 1110 4zm0 2a4 4 0 100 8 4 4 0 000-8z"/></svg>',
    refresh:
      '<svg viewBox="0 0 24 24"><path d="M17.7 6.3A8 8 0 104 12h2a6 6 0 111.8 4.2L10 14H4v6l2.4-2.4A8 8 0 0019.9 12h-2a6 6 0 00-1.8-4.2L14 10h6V4l-2.3 2.3z"/></svg>',
    sort: '<svg viewBox="0 0 24 24"><path d="M7 4l4 4H8v12H6V8H3l4-4zm10 16l-4-4h3V4h2v12h3l-4 4z"/></svg>',
    user: '<svg viewBox="0 0 24 24"><path d="M12 12a4 4 0 100-8 4 4 0 000 8zm-7 8a7 7 0 0114 0H5zm14-9v3h3v2h-3v3h-2v-3h-3v-2h3v-3h2z"/></svg>',
    attach:
      '<svg viewBox="0 0 24 24"><path d="M8 17.5l8.7-8.7a2.5 2.5 0 00-3.5-3.5l-9.1 9.1a4.5 4.5 0 006.4 6.4l8.2-8.2 1.4 1.4-8.2 8.2a6.5 6.5 0 11-9.2-9.2l9.1-9.1a4.5 4.5 0 016.4 6.4l-8.7 8.7a2.5 2.5 0 01-3.5-3.5l7.8-7.8 1.4 1.4-7.8 7.8a.5.5 0 10.7.7z"/></svg>',
    merge:
      '<svg viewBox="0 0 24 24"><path d="M4 5h7v2H6v10h5v2H4V5zm9 0h7v14h-7v-2h5V7h-5V5zm-2.2 5.4L8.2 13l2.6 2.6-1.4 1.4L5.4 13l4-4 1.4 1.4zm2.4 5.2l2.6-2.6-2.6-2.6 1.4-1.4 4 4-4 4-1.4-1.4z"/></svg>',
    template:
      '<svg viewBox="0 0 24 24"><path d="M5 3h11l3 3v15H5V3zm10 2H7v14h10V7h-2V5zM9 10h6v2H9v-2zm0 4h6v2H9v-2z"/></svg>',
    preview:
      '<svg viewBox="0 0 24 24"><path d="M12 5c5 0 8.5 4.5 9.5 7-1 2.5-4.5 7-9.5 7s-8.5-4.5-9.5-7C3.5 9.5 7 5 12 5zm0 2c-3.4 0-6 2.8-7.2 5 1.2 2.2 3.8 5 7.2 5s6-2.8 7.2-5C18 9.8 15.4 7 12 7zm0 2.5a2.5 2.5 0 110 5 2.5 2.5 0 010-5z"/></svg>',
    link: '<svg viewBox="0 0 24 24"><path d="M10.6 13.4a1 1 0 010-1.4l3.4-3.4a3 3 0 114.2 4.2l-3.1 3.1-1.4-1.4 3.1-3.1a1 1 0 10-1.4-1.4L12 13.4a1 1 0 01-1.4 0zm2.8-2.8a1 1 0 010 1.4L10 15.4a3 3 0 11-4.2-4.2l3.1-3.1 1.4 1.4-3.1 3.1a1 1 0 101.4 1.4l3.4-3.4a1 1 0 011.4 0z"/></svg>',
    settings:
      '<svg viewBox="0 0 24 24"><path d="M19.4 13.5a7.7 7.7 0 000-3l2-1.5-2-3.4-2.4 1a7.8 7.8 0 00-2.6-1.5L14 2h-4l-.4 3.1A7.8 7.8 0 007 6.6l-2.4-1-2 3.4 2 1.5a7.7 7.7 0 000 3l-2 1.5 2 3.4 2.4-1a7.8 7.8 0 002.6 1.5L10 22h4l.4-3.1a7.8 7.8 0 002.6-1.5l2.4 1 2-3.4-2-1.5zM12 15.5A3.5 3.5 0 1112 8a3.5 3.5 0 010 7.5z"/></svg>',
    trash:
      '<svg viewBox="0 0 20 20"><path d="M8 2a1 1 0 00-.9.6L6.4 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 000-2h-2.4l-.7-1.4A1 1 0 0012 2H8zm-1 6h2v7H7V8zm4 0h2v7h-2V8z"/></svg>',
  };
  return icons[key] || "";
}

function activityIconKey(type) {
  const text = String(type || "").toLowerCase();
  if (text.includes("event")) return "event";
  if (text.includes("call")) return "call";
  if (text.includes("email")) return "email";
  return "task";
}

function activityIconImage(type) {
  const key = activityIconKey(type);
  const images = {
    task: "task_120.png",
    call: "log_a_call_120.png",
    event: "event_120.png",
    email: "email_120.png",
  };
  return `<img src="/images/${images[key]}" alt="" class="activity-icon-img" loading="lazy">`;
}

function refreshSidebarIcons() {
  document.querySelectorAll(".nav-item[data-obj]").forEach((item) => {
    const icon = item.querySelector(".nav-icon");
    const objectName = item.dataset.obj;
    if (icon && OBJECT_META[objectName])
      icon.innerHTML = objectIcon(objectName);
  });
}

function objectFromId(id) {
  const prefix = String(id || "").slice(0, 3);
  return (
    {
      "001": "Account",
      "003": "Contact",
      "006": "Opportunity",
      500: "Case",
      "00Q": "Lead",
      701: "Campaign",
      "00T": "Task",
      "00U": "Event",
      "02s": "EmailMessage",
      "005": "User",
    }[prefix] || currentObject
  );
}

function relatedObjectForField(field, record) {
  if (field.startsWith("Account.")) return "Account";
  if (field.startsWith("Contact.")) return "Contact";
  if (field.startsWith("Owner.")) return "User";
  const idField = `${field.split(".")[0]}Id`;
  return objectFromId(record?.[idField]);
}

function getValue(record, path) {
  return path.split(".").reduce((value, key) => value && value[key], record);
}

function setValue(body, field, value) {
  if (value !== undefined && value !== null && String(value).trim() !== "") {
    body[field] = String(value).trim();
  }
}

function labelFor(field) {
  return fieldMetaFor(field)?.label || humanizeFieldLabel(field);
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

async function api(path, options = {}) {
  const token = getAuthToken();
  const headers = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;

   let response;
  try {
    response = await fetch(path, {
      headers,
      ...options,
      headers: { ...headers, ...(options.headers || {}) }
    });
  } catch (networkErr) {
    // Pure network failure — no response at all
    toast('Network error — check your connection and try again.', 'err', 8000);
    throw new Error('Network error');
  }

  // Handle 401
  if (response.status === 401) {
    const data = await response.json().catch(() => ({}));
    if (['TOKEN_EXPIRED','TOKEN_INVALID','NO_TOKEN'].includes(data.code)) {
      clearAuthToken();
      showLoginPage('Your session expired. Please log in again.');
      return;
    }
  }

  // Handle 403
  if (response.status === 403) {
    const data = await response.json().catch(() => ({}));
    const msg  = data.error || 'You do not have permission to perform this action.';
    toast(msg, 'err', 8000);
    const err = new Error(msg);
    err.alreadyToasted = true;
    throw err;
  }

  // Handle 429 rate limit
  if (response.status === 429) {
    toast('Too many requests — please wait a moment and try again.', 'err', 8000);
    throw new Error('Rate limited');
  }

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const msg = data.error || `Request failed (${response.status})`;
    throw new Error(msg);
  }

  return data;
}

function cloneCacheValue(value) {
  try {
    return structuredClone(value);
  } catch {
    return JSON.parse(JSON.stringify(value));
  }
}

function recentRecordCacheKey(objectName, id) {
  return `${orgSettings.activeOrgKey || "default"}:${objectName}:${id}`;
}

function getRecentRecordCache(objectName, id) {
  const key = recentRecordCacheKey(objectName, id);
  const entry = recentRecordCache.get(key);
  if (!entry || Date.now() - entry.timestamp > RECENT_RECORD_CACHE_TTL_MS) {
    if (entry) recentRecordCache.delete(key);
    spaCacheStats.recordMisses += 1;
    return null;
  }
  recentRecordCache.delete(key);
  recentRecordCache.set(key, entry);
  spaCacheStats.recordHits += 1;
  return cloneCacheValue(entry.value);
}

function setRecentRecordCache(objectName, id, value) {
  const key = recentRecordCacheKey(objectName, id);
  if (recentRecordCache.has(key)) recentRecordCache.delete(key);
  recentRecordCache.set(key, {
    timestamp: Date.now(),
    value: cloneCacheValue(value)
  });
  while (recentRecordCache.size > RECENT_RECORD_CACHE_MAX) {
    recentRecordCache.delete(recentRecordCache.keys().next().value);
  }
}

function invalidateRecentRecordCache(objectName, id = '') {
  if (!id) {
    const prefix = `${orgSettings.activeOrgKey || "default"}:${objectName}:`;
    for (const key of [...recentRecordCache.keys()]) {
      if (key.startsWith(prefix)) recentRecordCache.delete(key);
    }
    return;
  }
  recentRecordCache.delete(recentRecordCacheKey(objectName, id));
}

function applyCachedRecordLayouts(cached) {
  if (!cached?.layouts) return;
  const { objectName, layout, compactLayout, recordPage } = cached.layouts;
  if (!objectName) return;
  if (layout) DB_LAYOUT_CACHE[objectName] = layout;
  if (compactLayout) COMPACT_LAYOUT_CACHE[objectName] = compactLayout;
  if (recordPage) RECORD_PAGE_CACHE[objectName] = recordPage;
}

function currentScrollPosition() {
  return window.scrollY || document.documentElement.scrollTop || document.body.scrollTop || 0;
}

function crmListCachePrefix(objectName) {
  return `crm:list:${objectName}:`;
}

function crmListCacheKey({ objectName, path, search, viewId, sort, viewSignature = "", page = 1, pageSize = RENDER_CHUNK_SIZE }) {
  return [
    crmListCachePrefix(objectName),
    `path=${path}`,
    `view=${viewId || "all"}`,
    `signature=${viewSignature || ""}`,
    `search=${search || ""}`,
    `sort=${sort?.field || ""}:${sort?.direction || "asc"}`,
    `page=${page}`,
    `size=${pageSize}`,
  ].join("|");
}

function getCrmListCache(key) {
  const entry = crmListCache.get(key);
  if (!entry || Date.now() - entry.timestamp > CLIENT_CACHE_TTL_MS) {
    if (entry) crmListCache.delete(key);
    spaCacheStats.listMisses += 1;
    return null;
  }
  spaCacheStats.listHits += 1;
  return cloneCacheValue(entry);
}

function setCrmListCache(key, entry) {
  crmListCache.set(key, cloneCacheValue({ ...entry, timestamp: Date.now() }));
  syncSidebarBadgeFromListCache(entry);
}

function peekCrmListCache(key) {
  const entry = crmListCache.get(key);
  return entry ? cloneCacheValue(entry) : null;
}

function cachedListCount(entry) {
  const total = Number(entry?.payload?.totalSize ?? entry?.totalRecords);
  const records = entry?.payload?.records || entry?.currentRecords;
  const loaded = Array.isArray(records) ? records.length : 0;
  if (Number.isFinite(total) && total > 0 && !(entry?.payload?.nextRecordsUrl && total <= loaded)) {
    return total;
  }
  const objectName = entry?.objectName;
  const cachedTotal = objectName ? objectTotalCountCache.get(objectName) : null;
  if (Number.isFinite(cachedTotal) && cachedTotal > 0) return cachedTotal;
  return loaded || null;
}

function rememberObjectTotalCount(objectName, count) {
  const numeric = Number(count);
  if (!objectName || !OBJECT_META[objectName] || !Number.isFinite(numeric) || numeric <= 0) return;
  const previous = Number(objectTotalCountCache.get(objectName) || 0);
  if (numeric >= previous) {
    objectTotalCountCache.set(objectName, numeric);
    updateBadge(objectName, numeric);
  }
}

function knownObjectTotalCount(objectName, fallback = 0) {
  const known = Number(objectTotalCountCache.get(objectName) || 0);
  const fb = Number(fallback || 0);
  return known > fb ? known : fb;
}

function syncSidebarBadgeFromListCache(entry) {
  const objectName = entry?.objectName;
  if (!objectName || !OBJECT_META[objectName]) return;
  const count = cachedListCount(entry);
  if (count !== null) updateBadge(objectName, count);
}

function syncSidebarBadgesFromCache() {
  for (const entry of crmListCache.values()) syncSidebarBadgeFromListCache(entry);
  for (const state of crmPageStates.values()) syncSidebarBadgeFromListCache(state);
  for (const [objectName, count] of objectTotalCountCache.entries()) {
    updateBadge(objectName, count);
  }
}

function pruneCrmSpaCaches(now = Date.now()) {
  for (const [key, entry] of crmListCache.entries()) {
    if (!entry?.timestamp || now - entry.timestamp > CLIENT_CACHE_TTL_MS) {
      crmListCache.delete(key);
    }
  }
  for (const [key, state] of crmPageStates.entries()) {
    if (!state?.timestamp || now - state.timestamp > CLIENT_CACHE_TTL_MS) {
      crmPageStates.delete(key);
    }
  }
  for (const [key, entry] of listViewCache.entries()) {
    if (!entry?.timestamp || now - entry.timestamp > LIST_VIEW_CACHE_TTL_MS) {
      listViewCache.delete(key);
    }
  }
  for (const [key, entry] of recentRecordCache.entries()) {
    if (!entry?.timestamp || now - entry.timestamp > RECENT_RECORD_CACHE_TTL_MS) {
      recentRecordCache.delete(key);
    }
  }
}

function serializeMapForStorage(map) {
  return Array.from(map.entries()).map(([key, value]) => [key, value]);
}

function restoreMapFromStorage(map, entries = []) {
  map.clear();
  entries.forEach(([key, value]) => {
    if (key) map.set(key, value);
  });
}

function restoreCrmListCacheFromStorage(entries = []) {
  crmListCache.clear();
  entries.forEach(([key, value]) => {
    const objectName = value?.objectName;
    if (!key || !objectName || !OBJECT_META[objectName]) return;
    if (!key.startsWith(crmListCachePrefix(objectName))) return;
    if (!hasUsableCrmListCacheEntry(value, objectName)) return;
    crmListCache.set(key, value);
  });
}

function restoreObjectTotalCountsFromStorage(entries = []) {
  objectTotalCountCache.clear();
  entries.forEach(([objectName, count]) => rememberObjectTotalCount(objectName, count));
}

function persistCrmSpaState() {
  if (!$("content")) return;
  try {
    captureCrmPageState(currentObject);
    pruneCrmSpaCaches();
    sessionStorage.setItem(
      SPA_STATE_STORAGE_KEY,
      JSON.stringify({
        timestamp: Date.now(),
        orgKey: orgSettings.activeOrgKey || "default",
        currentObject,
        currentViewId,
        currentViewMode,
        sortState,
        selectedListRecordId,
        crmListCache: serializeMapForStorage(crmListCache),
        crmPageStates: serializeMapForStorage(crmPageStates),
        listViewCache: serializeMapForStorage(listViewCache),
        recentRecordCache: serializeMapForStorage(recentRecordCache),
        objectTotalCountCache: serializeMapForStorage(objectTotalCountCache),
      }),
    );
  } catch (err) {
    console.warn("CRM state persistence skipped:", err.message || err);
  }
}

function persistCrmStateBeforeExternalNavigation(event) {
  const target = event.target?.closest?.('a[href], button');
  if (!target) return;
  const href = target.getAttribute?.("href") || "";
  const isCrmModuleExit =
    href === "/reports.html" ||
    href === "/dashboards.html" ||
    target.id === "adminPanelBtn";
  if (isCrmModuleExit) persistCrmSpaState();
}

function restoreCrmSpaStateFromStorage() {
  try {
    const raw = sessionStorage.getItem(SPA_STATE_STORAGE_KEY);
    if (!raw) return false;
    const state = JSON.parse(raw);
    if (!state || Date.now() - state.timestamp > CLIENT_CACHE_TTL_MS) return false;
    const activeOrgKey = orgSettings.activeOrgKey || "default";
    if (state.orgKey && state.orgKey !== activeOrgKey) return false;
    restoreCrmListCacheFromStorage(state.crmListCache || []);
    restoreMapFromStorage(crmPageStates, state.crmPageStates || []);
    restoreMapFromStorage(listViewCache, state.listViewCache || []);
    restoreMapFromStorage(recentRecordCache, state.recentRecordCache || []);
    restoreObjectTotalCountsFromStorage(state.objectTotalCountCache || []);
    pruneCrmSpaCaches();
    return true;
  } catch (err) {
    console.warn("CRM state restore skipped:", err.message || err);
    return false;
  }
}

function getSpaCacheStats() {
  const listTotal = spaCacheStats.listHits + spaCacheStats.listMisses;
  const recordTotal = spaCacheStats.recordHits + spaCacheStats.recordMisses;
  return {
    ...spaCacheStats,
    listCacheSize: crmListCache.size,
    pageStateSize: crmPageStates.size,
    listViewCacheSize: listViewCache.size,
    recordCacheSize: recentRecordCache.size,
    listHitRatio: listTotal ? spaCacheStats.listHits / listTotal : 0,
    recordHitRatio: recordTotal ? spaCacheStats.recordHits / recordTotal : 0,
  };
}

window.getCrmSpaCacheStats = getSpaCacheStats;

function normalizeCrmPayloadForCompare(payload = {}) {
  return {
    records: payload.records || [],
    nextRecordsUrl: payload.nextRecordsUrl || null,
    totalSize: payload.totalSize || (payload.records || []).length,
    hiddenFields: payload.hiddenFields || [],
    columns: payload.columns || null,
  };
}

function sameCrmPayload(left, right) {
  return JSON.stringify(normalizeCrmPayloadForCompare(left)) ===
    JSON.stringify(normalizeCrmPayloadForCompare(right));
}

function showBackgroundRefreshIndicator(show) {
  const pageSub = $("pageSub");
  if (!pageSub) return;
  pageSub.classList.toggle("is-refreshing", Boolean(show));
  const existing = pageSub.querySelector(".mini-refresh-indicator");
  if (!show) {
    existing?.remove();
    return;
  }
  if (!existing) {
    pageSub.insertAdjacentHTML(
      "beforeend",
      ' <span class="mini-refresh-indicator">Refreshing...</span>',
    );
  }
}

function refreshCrmCachePayload(entry) {
  if (!entry?.payload) return;
  const nextRecords = Array.isArray(currentRecords) ? currentRecords : [];
  const existingRecords = Array.isArray(entry.payload.records) ? entry.payload.records : [];
  if (nextRecords.length || !existingRecords.length) {
    entry.payload.records = cloneCacheValue(nextRecords);
  }
  entry.payload.nextRecordsUrl = nextRecordsUrl || null;
  const preservedTotal = Math.max(
    Number(entry.payload.totalSize || 0),
    Number(totalRecords || 0),
    Number(objectTotalCountCache.get(entry.objectName) || 0),
  );
  entry.payload.totalSize = preservedTotal || entry.payload.records.length;
  rememberObjectTotalCount(entry.objectName, entry.payload.totalSize);
  entry.payload.hiddenFields = Array.from(currentHiddenFields || []);
  entry.payload.columns = cloneCacheValue(currentColumns || []);
}

function rememberCurrentListCacheState() {
  if (!loadData.activeCacheKey || !crmListCache.has(loadData.activeCacheKey)) return;
  const entry = crmListCache.get(loadData.activeCacheKey);
  refreshCrmCachePayload(entry);
  entry.scrollPosition = currentScrollPosition();
  entry.selectedRecord = selectedListRecordId || detailRecordState?.id || null;
  entry.visibleRecordCount = visibleRecordCount;
}

function markCachedSelectedRecord(recordId) {
  selectedListRecordId = recordId || null;
  if (!loadData.activeCacheKey || !crmListCache.has(loadData.activeCacheKey)) return;
  const entry = crmListCache.get(loadData.activeCacheKey);
  refreshCrmCachePayload(entry);
  entry.scrollPosition = currentScrollPosition();
  entry.selectedRecord = recordId || null;
  entry.visibleRecordCount = visibleRecordCount;
}

function nextListStateVersion() {
  listStateVersion += 1;
  return listStateVersion;
}

function activeListCacheEntry() {
  return loadData.activeCacheKey ? peekCrmListCache(loadData.activeCacheKey) : null;
}

function bestCrmListCacheForObject(objectName) {
  const prefix = crmListCachePrefix(objectName);
  let best = null;
  for (const [key, entry] of crmListCache.entries()) {
    if (!key.startsWith(prefix)) continue;
    if (!hasUsableCrmListCacheEntry(entry, objectName)) continue;
    if (!best || (entry.timestamp || 0) > (best.entry.timestamp || 0)) {
      best = { key, entry };
    }
  }
  return best ? { key: best.key, entry: cloneCacheValue(best.entry) } : null;
}

function isCrmListCacheEntryForObject(entry, objectName) {
  return Boolean(
    entry?.objectName === objectName &&
      entry?.payload &&
      Array.isArray(entry.payload.records),
  );
}

function hasUsableCrmListCacheEntry(entry, objectName) {
  if (!isCrmListCacheEntryForObject(entry, objectName)) return false;
  const records = entry.payload.records || [];
  const total = Number(entry.payload.totalSize || 0);
  if (entry.payload.nextRecordsUrl && total <= records.length) return false;
  if (!records.length && total === 0) return false;
  return true;
}

function isCrmPageStateForObject(state, objectName) {
  if (!state || state.objectName !== objectName) return false;
  const html = String(state.contentHtml || "");
  if (html && html.includes('data-object=') && !html.includes(`data-object="${objectName}"`)) {
    return false;
  }
  if (state.activeCacheKey && !state.activeCacheKey.startsWith(crmListCachePrefix(objectName))) {
    return false;
  }
  return true;
}

function applyListCacheEntry(entry, objectName = currentObject) {
  if (!isCrmListCacheEntryForObject(entry, objectName)) return false;
  applyCrmListPayload(entry.payload);
  visibleRecordCount = entry.visibleRecordCount || visibleRecordCount || RENDER_CHUNK_SIZE;
  selectedListRecordId = entry.selectedRecord || selectedListRecordId || null;
  return true;
}

function hasRenderableListRows() {
  return Array.isArray(currentRecords) && currentRecords.length > 0;
}

function isCurrentListRequest(version, objectName, cacheKey = "") {
  if (version !== listStateVersion) return false;
  if (objectName !== currentObject) return false;
  if (cacheKey && loadData.activeCacheKey && cacheKey !== loadData.activeCacheKey) return false;
  return true;
}

function cloneSetValues(setValue) {
  return Array.from(setValue || []);
}

function currentCrmSearch() {
  return $("objSearch")?.value || "";
}

function setActiveNavObject(objectName) {
  document.querySelectorAll(".nav-item[data-obj]").forEach((item) => {
    item.classList.toggle("active", item.dataset.obj === objectName);
  });
}

function crmObjectFromLocation() {
  const hash = decodeURIComponent(window.location.hash || "");
  const match = hash.match(/^#(?:object=)?([A-Za-z]+)$/);
  const objectName = match?.[1];
  return objectName && OBJECT_META[objectName] ? objectName : null;
}

function crmRouteFromLocation() {
  const hash = decodeURIComponent(window.location.hash || "");
  const recordMatch = hash.match(/^#record=([A-Za-z]+)\/([^/]+)$/);
  if (recordMatch && OBJECT_META[recordMatch[1]]) {
    return {
      view: "record",
      objectName: recordMatch[1],
      recordId: recordMatch[2],
    };
  }
  const objectName = crmObjectFromLocation();
  if (objectName) return { view: "object", objectName };
  return null;
}

function initialReadableObject() {
  const requested = crmRouteFromLocation()?.objectName || crmObjectFromLocation();
  if (requested && canReadObject(requested)) return requested;
  return firstReadableNavObject() || currentObject;
}

function writeCrmHistory(objectName, replace = false) {
  if (!objectName || !OBJECT_META[objectName]) return;
  const hash = `#object=${encodeURIComponent(objectName)}`;
  if (window.location.hash === hash && history.state?.crmObject === objectName) return;
  const method = replace ? "replaceState" : "pushState";
  history[method]({ ...(history.state || {}), crmObject: objectName, crmView: "object" }, "", hash);
}

function writeRecordHistory(objectName, recordId, replace = false) {
  if (!objectName || !recordId || !OBJECT_META[objectName]) return;
  const hash = `#record=${encodeURIComponent(objectName)}/${encodeURIComponent(recordId)}`;
  if (
    window.location.hash === hash &&
    history.state?.crmObject === objectName &&
    history.state?.crmRecordId === recordId
  ) return;
  const method = replace ? "replaceState" : "pushState";
  history[method](
    {
      ...(history.state || {}),
      crmObject: objectName,
      crmView: "record",
      crmRecordId: recordId,
    },
    "",
    hash,
  );
}

function captureCrmPageState(objectName = currentObject) {
  if (!objectName || !OBJECT_META[objectName] || !$("content")) return;
  if (viewingDetail) return;
  const tableObject = $("tableCard")?.dataset?.object;
  if (tableObject && tableObject !== objectName) return;
  rememberCurrentListCacheState();
  crmPageStates.set(objectName, {
    timestamp: Date.now(),
    objectName,
    contentHtml: $("content").innerHTML,
    search: currentCrmSearch(),
    currentRecords: cloneCacheValue(currentRecords || []),
    currentColumns: cloneCacheValue(currentColumns || []),
    currentHiddenFields: cloneSetValues(currentHiddenFields),
    currentViewId,
    sfListViews: cloneCacheValue(sfListViews || []),
    sortState: cloneCacheValue(sortState || { field: null, direction: "asc" }),
    totalRecords: knownObjectTotalCount(objectName, totalRecords || currentRecords.length),
    nextRecordsUrl,
    visibleRecordCount,
    currentViewMode,
    loadingMoreRecords: false,
    scrollPosition: currentScrollPosition(),
    selectedRecord: selectedListRecordId || detailRecordState?.id || null,
    activeCacheKey: loadData.activeCacheKey || "",
    listContentHtml,
    viewingDetail,
    detailRecordState: cloneCacheValue(detailRecordState || null),
  });
  syncSidebarBadgesFromCache();
}

function restoreCrmPageState(objectName) {
  const state = crmPageStates.get(objectName);
  if (state && !isCrmPageStateForObject(state, objectName)) {
    crmPageStates.delete(objectName);
  }
  const stateIsFresh =
    isCrmPageStateForObject(state, objectName) &&
    Date.now() - state.timestamp <= CLIENT_CACHE_TTL_MS;
  const fallbackCache = bestCrmListCacheForObject(objectName);
  const activeKey = (stateIsFresh && state.activeCacheKey) || fallbackCache?.key || "";
  const activeEntry = activeKey ? getCrmListCache(activeKey) : null;
  const cachedEntry = hasUsableCrmListCacheEntry(activeEntry, objectName)
    ? activeEntry
    : fallbackCache?.entry || null;
  if (!stateIsFresh && !cachedEntry) return false;
  if (stateIsFresh && state.activeCacheKey && !cachedEntry && !fallbackCache) return false;
  const entryMeta = cachedEntry || {};

  listRestoreInProgress = true;
  nextListStateVersion();
  currentObject = objectName;
  currentRecords = cloneCacheValue(stateIsFresh ? state.currentRecords || [] : []);
  currentColumns = cloneCacheValue(stateIsFresh ? state.currentColumns || [] : []);
  currentHiddenFields = new Set(stateIsFresh ? state.currentHiddenFields || [] : []);
  currentViewId = (stateIsFresh ? state.currentViewId : entryMeta.filters?.viewId) || "all";
  sfListViews = cloneCacheValue(stateIsFresh ? state.sfListViews || [] : sfListViews || []);
  sortState = cloneCacheValue((stateIsFresh ? state.sortState : entryMeta.sort) || { field: null, direction: "asc" });
  totalRecords = knownObjectTotalCount(
    objectName,
    stateIsFresh ? state.totalRecords || entryMeta.payload?.totalSize || 0 : entryMeta.payload?.totalSize || 0,
  );
  nextRecordsUrl = stateIsFresh ? state.nextRecordsUrl || null : entryMeta.payload?.nextRecordsUrl || null;
  visibleRecordCount = (stateIsFresh ? state.visibleRecordCount : entryMeta.visibleRecordCount) || RENDER_CHUNK_SIZE;
  currentViewMode = (stateIsFresh ? state.currentViewMode : "table") || "table";
  loadingMoreRecords = false;
  listContentHtml = (stateIsFresh ? state.listContentHtml : listContentHtml) || listContentHtml;
  viewingDetail = false;
  detailRecordState = null;
  selectedListRecordId = (stateIsFresh ? state.selectedRecord : entryMeta.selectedRecord) || null;
  loadData.activeCacheKey = activeKey || "";
  if (cachedEntry) applyListCacheEntry(cachedEntry);

  const cachedListHtml = String(stateIsFresh ? state.contentHtml || "" : "");
  $("content").innerHTML = cachedListHtml.includes('id="tableCard"')
    ? cachedListHtml
    : listContentHtml;
  const searchInput = $("objSearch");
  if (searchInput) searchInput.value = (stateIsFresh ? state.search : entryMeta.search) || "";
  const select = $("listViewSelect");
  if (select) select.value = currentViewId;
  $("pageIcon").innerHTML = objectIcon(objectName);
  $("pageTitle").textContent = getCurrentViewName();
  setActiveNavObject(objectName);
  syncSidebarBadgesFromCache();
  applyObjectNavGuards();
  updateViewToggle();
  clearObjectListLoadingState();
  applyPermissionGuards(objectName);
  if (!viewingDetail && currentViewMode === "table") {
    renderTable();
  }
  finalizeCachedObjectListRestore((stateIsFresh ? state.scrollPosition : entryMeta.scrollPosition) || 0);
  spaCacheStats.pageRestores += 1;
  listRestoreInProgress = false;
  return true;
}

async function restoreCrmObjectFromHistory(objectName) {
  if (!objectName || !OBJECT_META[objectName] || !canReadObject(objectName)) return;
  restoringCrmHistory = true;
  try {
    await switchObject(objectName);
  } finally {
    restoringCrmHistory = false;
  }
}

async function restoreCrmRecordFromHistory(objectName, recordId) {
  if (!objectName || !recordId || !OBJECT_META[objectName] || !canReadObject(objectName)) return;
  restoringCrmHistory = true;
  try {
    if (objectName !== currentObject) {
      captureCrmPageState(currentObject);
      currentObject = objectName;
      setActiveNavObject(objectName);
    }
    await openRecordDetail(objectName, recordId, { preserveHistory: true });
  } finally {
    restoringCrmHistory = false;
  }
}

function invalidateCrmObjectCache(objectName) {
  const prefix = crmListCachePrefix(objectName);
  for (const key of crmListCache.keys()) {
    if (key.startsWith(prefix)) crmListCache.delete(key);
  }
  listViewCache.delete(`${orgSettings.activeOrgKey || "default"}:${objectName}`);
  crmPageStates.delete(objectName);
  for (const key of apiInFlightRequests.keys()) {
    if (key.includes(`/api/${objectName}`)) apiInFlightRequests.delete(key);
  }
  for (const key of crmBackgroundRefreshes.keys()) {
    if (key.startsWith(prefix)) crmBackgroundRefreshes.delete(key);
  }
}

function applyCrmListPayload(payload) {
  if (!payload || !Array.isArray(payload.records)) return false;
  currentRecords = payload.records;
  nextRecordsUrl = payload.nextRecordsUrl || null;
  totalRecords = knownObjectTotalCount(currentObject, payload.totalSize || currentRecords.length);
  rememberObjectTotalCount(currentObject, totalRecords);
  currentHiddenFields = new Set(payload.hiddenFields || []);
  if (payload.columns) {
    currentColumns = normalizeListViewColumns(payload.columns);
  } else {
    applyLocalView();
  }
  currentColumns = currentColumns.filter((field) => !currentHiddenFields.has(field));
  return true;
}

async function fetchCrmListPayload(path, cacheKey, cacheMeta, forceRefresh = false) {
  if (!forceRefresh) {
    const cached = getCrmListCache(cacheKey);
    if (cached) return { payload: cached.payload, fromCache: true, meta: cached };
  }
  if (!forceRefresh && apiInFlightRequests.has(cacheKey)) {
    return apiInFlightRequests.get(cacheKey);
  }
  const request = api(path).then((payload) => {
    if (payload && !payload.error) {
      setCrmListCache(cacheKey, {
        ...cacheMeta,
        payload,
        scrollPosition: 0,
        selectedRecord: null,
      });
    }
    return { payload, fromCache: false, meta: null };
  });
  apiInFlightRequests.set(cacheKey, request);
  request.finally(() => apiInFlightRequests.delete(cacheKey));
  return request;
}

async function refreshCrmListInBackground(path, cacheKey, cacheMeta) {
  if (crmBackgroundRefreshes.has(cacheKey)) return crmBackgroundRefreshes.get(cacheKey);
  const previousEntry = peekCrmListCache(cacheKey);
  const refreshObject = cacheMeta?.objectName || currentObject;
  const refreshVersion = listStateVersion;
  const request = api(path)
    .then(async (payload) => {
      if (!payload || payload.error || !Array.isArray(payload.records)) return;
      const previousPayload = previousEntry?.payload || null;
      const activeView =
        loadData.activeCacheKey === cacheKey &&
        !viewingDetail &&
        currentObject === refreshObject &&
        listStateVersion === refreshVersion;
      const previousColumns = cloneCacheValue(currentColumns || []);
      const scrollPosition = activeView ? currentScrollPosition() : previousEntry?.scrollPosition || 0;
      const visibleCount = activeView ? visibleRecordCount : previousEntry?.visibleRecordCount || RENDER_CHUNK_SIZE;
      const selectedRecord = activeView
        ? selectedListRecordId || detailRecordState?.id || null
        : previousEntry?.selectedRecord || null;

      setCrmListCache(cacheKey, {
        ...cacheMeta,
        payload,
        scrollPosition,
        selectedRecord,
        visibleRecordCount: visibleCount,
      });

      if (!activeView || sameCrmPayload(previousPayload, payload)) return;

      if (!applyCrmListPayload(payload)) return;
      visibleRecordCount = visibleCount;
      applySort();
      if (currentViewMode === "kanban") {
        await renderKanban();
      } else {
        patchRenderedTableRows(previousColumns);
      }
      updatePagination();
      updateBadge(currentObject, knownObjectTotalCount(currentObject, totalRecords || currentRecords.length));
      updateRecordCounts();
      applyPermissionGuards(currentObject);
      captureCrmPageState(currentObject);
    })
    .catch((err) => {
      console.warn("Background refresh failed:", err.message || err);
    })
    .finally(() => {
      crmBackgroundRefreshes.delete(cacheKey);
    });
  crmBackgroundRefreshes.set(cacheKey, request);
  return request;
}

// ─────────────────────────────────────────────────────────────────────────────
// BLOCK C — LOGIN PAGE
// Add these functions. They show/hide the login overlay.
// ─────────────────────────────────────────────────────────────────────────────

function showLoginPage(message = "") {
  // Create login overlay if it doesn't exist
  if (!document.getElementById("loginOverlay")) {
    const overlay = document.createElement("div");
    overlay.id = "loginOverlay";
    overlay.style.cssText = `
      position: fixed; inset: 0; background: var(--bg);
      display: flex; align-items: center; justify-content: center; z-index: 9999;
    `;
    overlay.innerHTML = `
      <div style="background: var(--surface); border: 1px solid var(--border);
                  border-radius: 16px; padding: 40px; width: 100%; max-width: 400px; box-shadow: var(--shadow-lg);">
        <div style="text-align:center; margin-bottom: 32px;">
          <img src="/images/logo.png" alt="SaaSRAY CRM" style="height: 40px; margin-bottom: 16px;">
        
        </div>
        <div id="loginError" style="display:none; background: var(--danger-bg); border: 1px solid rgba(207,34,46,0.2);
             color: var(--danger); padding: 12px 16px; border-radius: 8px; margin-bottom: 20px; font-size: 14px;"></div>
        <div style="margin-bottom: 16px;">
          <label style="display:block; font-size: 13px; font-weight: 500; color: var(--text-2); margin-bottom: 6px;">Email</label>
          <input id="loginEmail" type="email" placeholder="you@company.com" autocomplete="email"
            style="width: 100%; padding: 10px 14px; border-radius: 8px; border: 1.5px solid var(--border);
                   background: var(--surface-2); color: var(--text-1); font-size: 15px;
                   box-sizing: border-box; outline: none; font-family: inherit;"
            onkeydown="if(event.key==='Enter') submitLogin()">
        </div>
        <div style="margin-bottom: 24px;">
          <label style="display:block; font-size: 13px; font-weight: 500; color: var(--text-2); margin-bottom: 6px;">Password</label>
          <input id="loginPassword" type="password" placeholder="••••••••" autocomplete="current-password"
            style="width: 100%; padding: 10px 14px; border-radius: 8px; border: 1.5px solid var(--border);
                   background: var(--surface-2); color: var(--text-1); font-size: 15px;
                   box-sizing: border-box; outline: none; font-family: inherit;"
            onkeydown="if(event.key==='Enter') submitLogin()">
        </div>
        <button onclick="submitLogin()" id="loginBtn"
          style="width: 100%; padding: 12px; border-radius: 8px; border: none; background: var(--accent);
                 color: #fff; font-size: 15px; font-weight: 600; cursor: pointer; font-family: inherit;">
          Sign In
        </button>

        <div style="display:flex; align-items:center; gap:12px; margin: 18px 0; color: var(--text-3); font-size: 12px;">
          <span style="height:1px; background: var(--border); flex:1;"></span>
          <span>or</span>
          <span style="height:1px; background: var(--border); flex:1;"></span>
        </div>

        <button onclick="submitGoogleLogin()" id="googleLoginBtn"
          style="width: 100%; padding: 12px; border-radius: 8px; border: 1.5px solid var(--border);
                 background: var(--surface); color: var(--text-1); font-size: 15px; font-weight: 600;
                 cursor: pointer; font-family: inherit; display:flex; align-items:center; justify-content:center; gap:10px;">
          <span style="width:18px;height:18px;display:inline-flex;align-items:center;justify-content:center;font-weight:800;color:#4285F4;">G</span>
          Continue with Google
        </button>

        <div style="text-align:center;margin-top:14px">
        <a href="/reset-password.html" style="font-size:13px;color:var(--accent);text-decoration:none;font-weight:600">
        Forgot your password?
        </a>
        </div>
        
      </div>
    `;
    document.body.appendChild(overlay);
  }

  const errorEl = document.getElementById("loginError");
  if (message && errorEl) {
    errorEl.textContent = message;
    errorEl.style.display = "block";
  } else if (errorEl) {
    errorEl.style.display = "none";
  }

  document.getElementById("loginOverlay").style.display = "flex";
  setTimeout(() => document.getElementById("loginEmail")?.focus(), 100);
}

function hideLoginPage() {
  const overlay = document.getElementById("loginOverlay");
  if (overlay) overlay.style.display = "none";
}

async function getSupabaseAuthClient() {
  if (supabaseAuthClient) return supabaseAuthClient;
  if (supabaseAuthClientPromise) return supabaseAuthClientPromise;

  supabaseAuthClientPromise = (async () => {
    if (!window.supabase?.createClient) {
      throw new Error("Supabase auth library did not load. Check your internet connection.");
    }

    const response = await fetch("/api/auth/supabase-config");
    const config = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(config.error || "Supabase OAuth is not configured.");
    }

    supabaseAuthClient = window.supabase.createClient(config.url, config.anonKey, {
      auth: {
        detectSessionInUrl: true,
        persistSession: true,
        autoRefreshToken: true
      }
    });
    return supabaseAuthClient;
  })();

  return supabaseAuthClientPromise;
}

async function submitGoogleLogin() {
  const btn = document.getElementById("googleLoginBtn");
  const errorEl = document.getElementById("loginError");

  if (btn) {
    btn.disabled = true;
    btn.textContent = "Redirecting to Google...";
  }
  if (errorEl) errorEl.style.display = "none";

  try {
    const client = await getSupabaseAuthClient();
    const { error } = await client.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: window.location.origin + window.location.pathname
      }
    });
    if (error) throw error;
  } catch (err) {
    if (errorEl) {
      errorEl.textContent = err.message || "Could not start Google login.";
      errorEl.style.display = "block";
    } else {
      toast(err.message || "Could not start Google login.", "err");
    }
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<span style="width:18px;height:18px;display:inline-flex;align-items:center;justify-content:center;font-weight:800;color:#4285F4;">G</span> Continue with Google';
    }
  }
}

async function completePortalLogin(data) {
  setAuthToken(data.token);
  setStoredPerms(data.permissions || {});
  window.portalUser = data.user;
  applyAllPermissionGuards();
  const route = crmRouteFromLocation();
  currentObject = initialReadableObject();
  if (route?.view !== "record") writeCrmHistory(currentObject, true);

  hideLoginPage();

  if (data.mustChangePw) {
    toast(
      "Please change your password - you are using a temporary password.",
      "info",
    );
  }

  applyAllPermissionGuards();
  await checkConnection();
  if (route?.view === "record" && route.recordId) {
    loadListViews().catch((err) => console.warn("List views warmup failed:", err.message || err));
    await openRecordDetail(route.objectName, route.recordId, { preserveHistory: true });
    return;
  }
  await loadListViews();
  await loadData();
}

async function finishGoogleLoginFromRedirect() {
  const hasSupabaseCallback =
    /[?#&](code|access_token|error|error_description)=/.test(window.location.href);
  if (!hasSupabaseCallback) return false;

  try {
    
    const client = await getSupabaseAuthClient();
    const callbackUrl = new URL(window.location.href);
    const authCode = callbackUrl.searchParams.get("code");
    if (authCode) {
      const { error: exchangeError } = await client.auth.exchangeCodeForSession(authCode);
      if (exchangeError) throw exchangeError;
    }

    const { data: sessionData, error: sessionError } = await client.auth.getSession();
    if (sessionError) throw sessionError;

    const accessToken = sessionData?.session?.access_token;
    if (!accessToken) {
      throw new Error("Google sign-in did not return a valid session.");
    }

    const response = await fetch("/api/auth/social-login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider: "google", accessToken }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.error || "Google login failed.");
    }

    window.history.replaceState({}, document.title, window.location.pathname);
    await completePortalLogin(data);
    return true;
  } catch (err) {
    clearAuthToken();
    window.history.replaceState({}, document.title, window.location.pathname);
    showLoginPage(err.message || "Google login failed.");
    return true;
  }
}

async function submitLogin() {
  const email = document.getElementById("loginEmail")?.value.trim();
  const password = document.getElementById("loginPassword")?.value;
  const btn = document.getElementById("loginBtn");
  const errorEl = document.getElementById("loginError");

  if (!email || !password) {
    if (errorEl) {
      errorEl.textContent = "Enter your email and password.";
      errorEl.style.display = "block";
    }
    return;
  }

  btn.disabled = true;
  btn.textContent = "Signing in...";
  if (errorEl) errorEl.style.display = "none";

  try {
    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const data = await response.json();

    if (!response.ok) {
      if (errorEl) {
        errorEl.textContent = data.error || "Login failed";
        errorEl.style.display = "block";
      }
      return;
    }

    await completePortalLogin(data);
    return;

    // If user must change password, show a toast for now
    if (data.mustChangePw) {
      toast(
        "Please change your password — you are using a temporary password.",
        "info",
      );
    }

    // Apply permission guards to the UI
    applyAllPermissionGuards();

    // Now load the app normally
    await checkConnection();
    await loadListViews();
    await loadData();
  } catch (err) {
    if (errorEl) {
      errorEl.textContent = err.message || "Login failed";
      errorEl.style.display = "block";
    }
  } finally {
    btn.disabled = false;
    btn.textContent = "Sign In";
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// BLOCK D — PERMISSION-GATED UI
// Call applyAllPermissionGuards() after login and after every object switch.
// ─────────────────────────────────────────────────────────────────────────────

function canDo(sfObject, action) {
  const perms        = window.userPerms || getStoredPerms();
  const isSystemAdmin = window.portalUser?.isSystemAdmin;

  // System Administrator profile bypasses all checks
  if (isSystemAdmin) return true;

  return Boolean(perms[sfObject]?.[action]);
}

function canReadObject(sfObject) {
  return canDo(sfObject, "can_read");
}

function readableObjectNames(objectNames) {
  return (objectNames || []).filter((objectName) => {
    if (objectName === "User") return true;
    return OBJECT_META[objectName] && canReadObject(objectName);
  });
}

function firstReadableNavObject() {
  return ["Account", "Contact", "Opportunity", "Case", "Lead", "Campaign"].find(
    (objectName) => canReadObject(objectName),
  );
}

function showNoObjectAccess() {
  $("pageIcon").innerHTML = "";
  $("pageTitle").textContent = "No CRM Access";
  $("pageSub").textContent = "Your profile does not have read access to any CRM object.";
  $("stateLoading").style.display = "none";
  $("tableCard").style.display = "none";
  if ($("kanbanCard")) $("kanbanCard").style.display = "none";
  $("stateError").style.display = "flex";
  $("errMsg").textContent = "Access denied";
  $("errDetail").textContent =
    "Ask your administrator to grant object read permission to your profile or permission set.";
}

function applyObjectNavGuards() {
  document.querySelectorAll(".nav-item[data-obj]").forEach((item) => {
    const objectName = item.dataset.obj;
    const canRead = canReadObject(objectName);
    item.style.display = canRead ? "" : "none";
    item.setAttribute("aria-hidden", canRead ? "false" : "true");
    item.classList.toggle("active", canRead && objectName === currentObject);
    const badge = item.querySelector(".nav-badge");
    if (badge && !canRead) badge.textContent = "-";
  });
}

function applyAllPermissionGuards() {
  applyObjectNavGuards();
  applyPermissionGuards(currentObject);
}

function applyPermissionGuards(sfObject) {
  const canRead = canDo(sfObject, "can_read");
  const canCreate = canDo(sfObject, "can_create");
  const canEdit = canDo(sfObject, "can_edit");
  const canDelete = canDo(sfObject, "can_delete");
  const detailRecordCanEdit =
    detailRecordState?.objectName === sfObject
      ? detailRecordState?.recordAccess?.accessLevel === "edit"
      : true;

  // New button in page header
  document.querySelectorAll('[onclick="openCreate()"]').forEach((btn) => {
    btn.style.display = canCreate ? "" : "none";
  });

  // Edit buttons in table rows
  document.querySelectorAll(".row-action.edit").forEach((btn) => {
    btn.style.display = canEdit ? "" : "none";
  });

  // Delete buttons in table rows
  document.querySelectorAll(".row-action.del").forEach((btn) => {
    btn.style.display = canDelete ? "" : "none";
  });

  // Edit button on record detail page
  document
    .querySelectorAll('[onclick="editCurrentDetailRecord()"]')
    .forEach((btn) => {
      btn.style.display = canEdit && detailRecordCanEdit ? "" : "none";
    });

  // Kanban edit buttons
  document.querySelectorAll(".kanban-card-action").forEach((btn) => {
    btn.style.display = canEdit ? "" : "none";
  });

  // Hide New List View button for readonly
  const listViewBtn = document.querySelector('[onclick="openListViewModal()"]');
  if (listViewBtn) listViewBtn.style.display = canRead ? "" : "none";

  // Activity action buttons (New Task, Log Call, New Event, Email)
  document.querySelectorAll(".activity-action").forEach((btn) => {
    btn.style.display = canCreate && detailRecordCanEdit ? "" : "none";
  });
}

function currentDetailCanEdit() {
  return detailRecordState?.recordAccess?.accessLevel === "edit";
}

function formatValue(field, value, record = null) {
  if (value === null || value === undefined || value === "")
    return '<span class="cell-empty">-</span>';
  const type = fieldTypeFor(field);
  if (["currency", "double", "int", "integer", "percent", "number"].includes(type) || field === "Amount" || field === "AnnualRevenue") {
    if (Number.isNaN(Number(value))) return escapeHtml(String(value));
    if (type === "percent" || /probability|percent/i.test(field)) {
      return `<span class="cell-number">${Number(value).toLocaleString()}%</span>`;
    }
    return `<span class="cell-amount">${Number(value).toLocaleString(
      undefined,
      {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 0,
      },
    )}</span>`;
  }
  if (["date", "datetime", "time"].includes(type) || field.includes("Date")) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? escapeHtml(String(value)) : date.toLocaleDateString();
  }
  if (field === "Email")
    return `<a class="cell-email" href="mailto:${escapeHtml(value)}">${escapeHtml(value)}</a>`;
  if (type === "phone") {
    return `<a class="cell-email" href="tel:${escapeHtml(value)}">${escapeHtml(value)}</a>`;
  }
  if (type === "url") {
    const url = /^https?:\/\//i.test(String(value)) ? String(value) : `https://${value}`;
    return `<a class="cell-email" href="${escapeHtml(url)}" target="_blank" rel="noopener">${escapeHtml(value)}</a>`;
  }
  if (type === "boolean") {
    return `<span class="badge ${value ? "badge-success" : "badge-neutral"}">${value ? "Yes" : "No"}</span>`;
  }
  if (["Status", "StageName", "Priority", "Type"].includes(field)) {
    return `<span class="badge badge-neutral">${escapeHtml(value)}</span>`;
  }
  if (field.endsWith(".Name")) {
    const relatedObject = relatedObjectForField(field, record);
    const idField = `${field.split(".")[0]}Id`;
    const relatedId = record?.[idField];
    if (relatedId && OBJECT_META[relatedObject]) {
      return `<button class="cell-button-link" onclick="event.stopPropagation(); openRecordDetail('${relatedObject}', '${relatedId}')">${escapeHtml(value)}</button>`;
    }
    return `<span class="cell-link">${escapeHtml(value)}</span>`;
  }
  if (field === "Name" || field === "CaseNumber") {
    return `<button class="cell-button-link" onclick="event.stopPropagation(); openRecordDetail('${currentObject}', '${record?.Id || ""}')">${escapeHtml(value)}</button>`;
  }
  if (typeof value === "object") {
    if (value.Name) return escapeHtml(value.Name);
    return escapeHtml(JSON.stringify(value));
  }
  return escapeHtml(String(value));
}

async function checkConnection() {
  const status = $("connStatus");
  const dot = status?.querySelector(".conn-dot");
  const text = status?.querySelector(".conn-text");
  const authBtn = $("authBtn");

  try {
    const data = await api("/api/auth/test");
    if (data.org) {
      orgSettings.activeOrgKey = data.org.key || orgSettings.activeOrgKey;
      updateActiveOrgLabel(data.org);
    }
    if (dot) dot.className = "conn-dot connected";
    if (text) text.textContent = "Connected";
    if (authBtn) authBtn.style.display = "none";
    await loadProfile();
    return data;
  } catch (err) {
    if (dot) dot.className = "conn-dot error";
    if (text) text.textContent = "Auth failed";
    if (authBtn) authBtn.style.display = "inline-flex";
    showAuthRequired(err.message);
    return null;
  }
}

async function loadProfile() {
  try {
  currentUser = await api("/api/me");

  // Salesforce user info (fallback)
  setTopbarAvatar(currentUser, "SF");
  $("profileName").textContent = currentUser.name || "Salesforce User";
  $("profileEmail").textContent =
    currentUser.email || currentUser.username || "Connected";

  // Update portal user info
  try {
    const portalMe = await api("/api/portal/me");
    window.portalUser = portalMe;

    // Overwrite name/avatar with portal user
    setTopbarAvatar(portalMe, "U");
    $("profileName").textContent = portalMe.name || "Portal User";
    $("profileEmail").textContent = portalMe.email || "";

   const adminBtn = $('adminPanelBtn');
if (adminBtn) {
  adminBtn.style.display = window.portalUser?.isSystemAdmin ? '' : 'none';
}

    // Hide org config from non-admins
    const orgBtn = document.querySelector(
      '[onclick="openOrgModal()"]'
    );
    if (orgBtn) {
      const isAdmin = ["system_administrator", "admin"].includes(
        portalMe?.role
      );
      orgBtn.style.display = isAdmin ? "" : "none";
    }

    // Hide Connect Salesforce button from non-admins
    const authBtn = $("authBtn");
    if (
      authBtn &&
      !["system_administrator", "admin"].includes(portalMe?.role)
    ) {
      authBtn.style.display = "none";
    }
  } catch {
    // Keep Salesforce user info if portal user fetch fails
  }
} catch (err) {
  setTopbarAvatar({ name: "SF" }, "SF");
}
}

// ── USER PROFILE PAGE ────────────────────────────────
async function openUserProfile() {
  closeProfileMenu();
  try {
    const user = await api('/api/portal/profile');
    const initials = userInitials(user.name, 'U');
    const profileAvatar = user.profileImage
      ? `<img id="profileImagePreview" src="${escapeHtml(user.profileImage)}" alt="" style="width:56px;height:56px;border-radius:50%;object-fit:cover">`
      : `<div id="profileImagePreview" style="width:56px;height:56px;border-radius:50%;background:var(--accent);
                 color:#fff;display:flex;align-items:center;justify-content:center;
                 font-size:20px;font-weight:800;flex-shrink:0">${initials}</div>`;
    const profileBadgeLabel = user.isSystemAdmin
      ? 'System Administrator'
      : (user.profile?.name || 'No Profile');

    $('content').innerHTML = `
      <div style="max-width:680px;margin:0 auto;padding:8px 0">

        <!-- Header -->
        <div style="display:flex;align-items:center;gap:16px;margin-bottom:28px">
          <button class="btn btn-ghost btn-sm" onclick="backToCurrentList()">
            ← Back
          </button>
          <h1 style="font-size:20px;font-weight:800">My Profile</h1>
        </div>

        <!-- Must change password banner -->
        ${user.mustChangePw ? `
        <div style="background:rgba(245,158,11,.1);border:1px solid rgba(245,158,11,.3);
             border-radius:10px;padding:14px 18px;margin-bottom:20px;
             color:#f59e0b;font-size:13px;font-weight:600">
          ⚠️ You are using a temporary password. Please change it below.
        </div>` : ''}

        <!-- Profile Card -->
        <div style="background:var(--surface);border:1px solid var(--border);
             border-radius:14px;padding:28px;margin-bottom:20px">
          <div style="display:flex;align-items:center;gap:18px;margin-bottom:24px">
            ${profileAvatar}
            <div>
              <div style="font-size:18px;font-weight:800">${escapeHtml(user.name)}</div>
              <div style="font-size:13px;color:var(--text-muted)">${escapeHtml(user.email)}</div>
            </div>
            <div style="margin-left:auto">
              <span style="background:var(--accent-soft);color:var(--accent);
                   border-radius:20px;padding:4px 12px;font-size:12px;font-weight:700">
                ${escapeHtml(profileBadgeLabel)}
              </span>
            </div>
          </div>

          <!-- Info Grid -->
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
            ${[
              ['Email',        user.email],
              ['Profile',      user.profile?.name || '—'],
              ['Member Since', user.createdAt ? new Date(user.createdAt).toLocaleDateString() : '—'],
              ['Last Login',   user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleString() : 'Never']
            ].map(([label, value]) => `
              <div style="background:var(--bg-secondary);border-radius:8px;padding:12px">
                <div style="font-size:11px;font-weight:600;color:var(--text-muted);
                     text-transform:uppercase;letter-spacing:.04em;margin-bottom:4px">${label}</div>
                <div style="font-size:13px;font-weight:600">${escapeHtml(String(value || '—'))}</div>
              </div>
            `).join('')}
          </div>

          <!-- Permission Sets -->
          ${user.permissionSets?.length ? `
          <div style="margin-top:16px">
            <div style="font-size:11px;font-weight:600;color:var(--text-muted);
                 text-transform:uppercase;letter-spacing:.04em;margin-bottom:8px">
              Permission Sets
            </div>
            <div style="display:flex;flex-wrap:wrap;gap:6px">
              ${user.permissionSets.map(ps => `
                <span style="background:var(--accent-soft);color:var(--accent);
                     border:1px solid rgba(99,102,241,.25);border-radius:20px;
                     padding:3px 10px;font-size:11px;font-weight:600">
                  ${escapeHtml(ps.name)}
                </span>
              `).join('')}
            </div>
          </div>` : ''}
        </div>

        <!-- Profile Image -->
        <div style="background:var(--surface);border:1px solid var(--border);
             border-radius:14px;padding:24px;margin-bottom:16px">
          <h2 style="font-size:15px;font-weight:700;margin-bottom:16px">Profile Image</h2>
          <div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap">
            <div id="profileImageEditorPreview" style="width:64px;height:64px;border-radius:50%;
                 background:var(--accent-soft);color:var(--accent);display:flex;align-items:center;
                 justify-content:center;font-size:20px;font-weight:800;overflow:hidden;flex-shrink:0">
              ${user.profileImage
                ? `<img src="${escapeHtml(user.profileImage)}" alt="" style="width:100%;height:100%;object-fit:cover">`
                : initials}
            </div>
            <div style="display:flex;gap:8px;flex-wrap:wrap">
              <input id="profileImageInput" type="file" accept="image/png,image/jpeg,image/webp,image/gif" style="display:none"
                onchange="saveProfileImageFromInput(this)">
              <button class="btn btn-ghost" onclick="$('profileImageInput').click()">
                ${user.profileImage ? 'Change Image' : 'Upload Image'}
              </button>
              ${user.profileImage ? `<button class="btn btn-danger" onclick="removeProfileImage()">Remove Image</button>` : ''}
            </div>
          </div>
          <div id="imageMsg" style="margin-top:8px;font-size:12px;display:none"></div>
        </div>

        <!-- Edit Name -->
        <div style="background:var(--surface);border:1px solid var(--border);
             border-radius:14px;padding:24px;margin-bottom:16px">
          <h2 style="font-size:15px;font-weight:700;margin-bottom:16px">Update Display Name</h2>
          <div style="display:flex;gap:10px;align-items:flex-end">
            <div style="flex:1">
              <label style="display:block;font-size:12px;font-weight:600;
                     color:var(--text-secondary);margin-bottom:6px">Full Name</label>
              <input class="form-ctrl" id="displayNameInput" value="${escapeHtml(user.name)}"
                placeholder="Your full name"
                onkeydown="if(event.key==='Enter') saveName()">
            </div>
            <button class="btn btn-primary" onclick="saveName()">Save Name</button>
          </div>
          <div id="nameMsg" style="margin-top:8px;font-size:12px;display:none"></div>
        </div>

        <!-- Change Password -->
        <div style="background:var(--surface);border:1px solid var(--border);
             border-radius:14px;padding:24px">
          <h2 style="font-size:15px;font-weight:700;margin-bottom:16px">Change Password</h2>
          <div style="display:grid;gap:12px">
            <div>
              <label style="display:block;font-size:12px;font-weight:600;
                     color:var(--text-secondary);margin-bottom:6px">Current Password</label>
              <input class="form-ctrl" id="currentPw" type="password"
                placeholder="Your current password">
            </div>
            <div>
              <label style="display:block;font-size:12px;font-weight:600;
                     color:var(--text-secondary);margin-bottom:6px">New Password</label>
              <input class="form-ctrl" id="newPw" type="password"
                placeholder="Min. 8 characters">
            </div>
            <div>
              <label style="display:block;font-size:12px;font-weight:600;
                     color:var(--text-secondary);margin-bottom:6px">Confirm New Password</label>
              <input class="form-ctrl" id="confirmPw" type="password"
                placeholder="Repeat new password"
                onkeydown="if(event.key==='Enter') savePassword()">
            </div>
          </div>
          <div id="pwMsg" style="margin-top:12px;font-size:12px;display:none"></div>
          <button class="btn btn-primary" style="margin-top:16px" onclick="savePassword()">
            Update Password
          </button>
        </div>

      </div>
    `;
  } catch(err) {
    toast('Could not load your profile: ' + err.message, 'err');
  }
}

async function saveName() {
  const name  = $('displayNameInput')?.value.trim();
  const msg   = $('nameMsg');
  if (!name) { showProfileMsg('nameMsg', 'Name cannot be empty', false); return; }
  try {
    await api('/api/portal/profile', { method: 'PATCH', body: JSON.stringify({ name }) });
    showProfileMsg('nameMsg', 'Name updated successfully', true);
    // Update avatar initials in topbar
    setTopbarAvatar({ name, profileImage: window.portalUser?.profileImage }, "U");
    $('displayNameInput').textContent   = name;
    if (window.portalUser) window.portalUser.name = name;
  } catch(err) {
    showProfileMsg('nameMsg', err.message, false);
  }
}

async function saveProfileImageFromInput(input) {
  const file = input?.files?.[0];
  if (!file) return;
  try {
    const profileImage = await readProfileImageFile(file);
    await api('/api/portal/profile', {
      method: 'PATCH',
      body: JSON.stringify({ profileImage })
    });
    if (!window.portalUser) window.portalUser = {};
    window.portalUser.profileImage = profileImage;
    setTopbarAvatar({ name: window.portalUser.name || $('displayNameInput')?.value, profileImage }, "U");
    showProfileMsg('imageMsg', 'Profile image updated', true);
    openUserProfile();
  } catch(err) {
    showProfileMsg('imageMsg', err.message, false);
  } finally {
    if (input) input.value = '';
  }
}

async function removeProfileImage() {
  try {
    await api('/api/portal/profile', {
      method: 'PATCH',
      body: JSON.stringify({ profileImage: null })
    });
    if (!window.portalUser) window.portalUser = {};
    window.portalUser.profileImage = null;
    setTopbarAvatar({ name: window.portalUser.name || $('displayNameInput')?.value, profileImage: null }, "U");
    showProfileMsg('imageMsg', 'Profile image removed', true);
    openUserProfile();
  } catch(err) {
    showProfileMsg('imageMsg', err.message, false);
  }
}

async function savePassword() {
  const currentPw = $('currentPw')?.value;
  const newPw     = $('newPw')?.value;
  const confirmPw = $('confirmPw')?.value;

  if (!currentPw || !newPw || !confirmPw) {
    showProfileMsg('pwMsg', 'All password fields are required', false); return;
  }
  if (newPw.length < 8) {
    showProfileMsg('pwMsg', 'New password must be at least 8 characters', false); return;
  }
  if (newPw !== confirmPw) {
    showProfileMsg('pwMsg', 'New passwords do not match', false); return;
  }
  try {
    await api('/api/portal/profile', {
      method: 'PATCH',
      body: JSON.stringify({ currentPassword: currentPw, newPassword: newPw })
    });
    showProfileMsg('pwMsg', 'Password updated successfully', true);
    $('currentPw').value = $('newPw').value = $('confirmPw').value = '';
  } catch(err) {
    showProfileMsg('pwMsg', err.message, false);
  }
}

function showProfileMsg(elementId, message, success) {
  const el = $(elementId);
  if (!el) return;
  el.textContent  = message;
  el.style.color  = success ? 'var(--success, #22c55e)' : 'var(--danger, #ef4444)';
  el.style.display = 'block';
  setTimeout(() => { el.style.display = 'none'; }, 4000);
}

async function loadOrgSettings() {
  try {
    orgSettings = await api("/api/auth/orgs");
    const active = getActiveOrg();
    if (active) updateActiveOrgLabel(active);
    renderOrgSelect();
    return orgSettings;
  } catch (err) {
    orgSettings = { activeOrgKey: "default", orgs: [] };
    return orgSettings;
  }
}

function getActiveOrg() {
  return (
    (orgSettings.orgs || []).find(
      (org) => org.key === orgSettings.activeOrgKey,
    ) || (orgSettings.orgs || []).find((org) => org.isActive)
  );
}

function updateActiveOrgLabel(org = getActiveOrg()) {
  const label = $("activeOrgLabel");
  if (!label || !org) return;
  label.textContent = org.label || org.key || "Salesforce Org";
  label.title = org.instanceUrl || org.loginUrl || "";
}

function renderOrgSelect() {
  const select = $("orgSelect");
  if (!select) return;
  const orgs = orgSettings.orgs || [];
  select.innerHTML = [
    ...orgs.map(
      (org) =>
        `<option value="${escapeHtml(org.key)}" ${org.key === orgSettings.activeOrgKey ? "selected" : ""}>${escapeHtml(org.label || org.key)}${org.hasRefreshToken ? " - connected" : ""}</option>`,
    ),
    '<option value="__new__">Add new org...</option>',
  ].join("");
}

function openOrgModal() {
  closeProfileMenu();
  loadOrgSettings().then(() => {
    fillOrgForm(getActiveOrg());
    $("orgOverlay").classList.add("open");
  });
}

function closeOrgModal() {
  $("orgOverlay").classList.remove("open");
}

function fillOrgForm(org = {}) {
  $("orgLabel").value = org?.label || "";
  $("orgKey").value = org?.key || "";
  $("orgKey").disabled = Boolean(org?.key && org.key !== "__new__");
  $("orgEnvironment").value =
    org?.environment === "sandbox" ? "sandbox" : "production";
  $("orgLoginUrl").value =
    org?.loginUrl ||
    ($("orgEnvironment").value === "sandbox"
      ? "https://test.salesforce.com"
      : "https://login.salesforce.com");
  $("orgClientId").value = org?.hasClientId ? "" : org?.clientId || "";
  $("orgClientSecret").value = "";
  $("orgInstanceUrl").value = org?.instanceUrl || "";
  $("orgNote").textContent = org?.key
    ? "Secrets stay on the server. Enter Client Secret only when adding an org or replacing the saved secret."
    : "Add a Connected App client id and secret, then approve OAuth in Salesforce.";
}

function switchOrgFromSelect(key) {
  if (key === "__new__") {
    fillOrgForm({
      key: "",
      environment: "production",
      loginUrl: "https://login.salesforce.com",
    });
    return;
  }
  const org = (orgSettings.orgs || []).find((item) => item.key === key);
  fillOrgForm(org);
}

async function switchOrg(key, reload = true) {
  const data = await api("/api/auth/orgs/active", {
    method: "POST",
    body: JSON.stringify({ key }),
  });
  orgSettings.activeOrgKey = data.activeOrgKey;
  updateActiveOrgLabel(data.org);
  if (reload) window.location.reload();
}

function setOrgEnvDefaults() {
  const env = $("orgEnvironment").value;
  const current = $("orgLoginUrl").value.trim();
  if (
    !current ||
    current === "https://login.salesforce.com" ||
    current === "https://test.salesforce.com"
  ) {
    $("orgLoginUrl").value =
      env === "sandbox"
        ? "https://test.salesforce.com"
        : "https://login.salesforce.com";
  }
}

function toggleOrgSecret(event) {
  const input = $("orgClientSecret");
  input.type = input.type === "password" ? "text" : "password";
  event.currentTarget.textContent = input.type === "password" ? "Show" : "Hide";
}

async function saveOrgAndConnect() {
  const payload = {
    label: $("orgLabel").value.trim(),
    key: $("orgKey").value.trim() || $("orgLabel").value.trim(),
    environment: $("orgEnvironment").value,
    loginUrl: $("orgLoginUrl").value.trim(),
    clientId: $("orgClientId").value.trim(),
    clientSecret: $("orgClientSecret").value.trim(),
    instanceUrl: $("orgInstanceUrl").value.trim(),
  };
  try {
    const data = await api("/api/auth/orgs", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    orgSettings.activeOrgKey = data.activeOrgKey;
    updateActiveOrgLabel(data.org);
    connectSalesforce();
  } catch (err) {
    $("orgNote").textContent = err.message;
  }
}

function connectSalesforce() {
  const activeKey = orgSettings.activeOrgKey || getActiveOrg()?.key;
  window.location.href = activeKey
    ? `/auth/salesforce?org=${encodeURIComponent(activeKey)}`
    : "/auth/salesforce";
}

async function logoutSalesforce() {
  // This is now PORTAL logout only
  await fetch("/api/auth/logout", {
    method: "POST",
    headers: { Authorization: `Bearer ${getAuthToken()}` },
  }).catch(() => null);

  clearAuthToken();
  closeProfileMenu();
  currentRecords = [];
  currentUser = null;
  showLoginPage("You have been logged out.");
}

function toggleProfileMenu() {
  $("profilePopover").classList.toggle("open");
}

function closeProfileMenu() {
  $("profilePopover").classList.remove("open");
}

function openUserInfo() {
  closeProfileMenu();
  if (!currentUser) {
    toast("User profile is still loading", "info");
    return;
  }
  $("detailObjIcon").innerHTML = objectIcon("User");
  $("detailTitle").textContent = currentUser.name || "Salesforce User";
  $("detailSub").textContent = currentUser.username || currentUser.email || "";
  $("detailBody").innerHTML = `
    <div class="detail-grid">
      ${[
        ["Name", currentUser.name],
        ["Email", currentUser.email],
        ["Username", currentUser.username],
        ["Title", currentUser.title],
        ["User Id", currentUser.id],
      ]
        .map(
          ([label, value]) => `
        <div class="detail-field">
          <div class="detail-label">${label}</div>
          <div class="detail-value">${escapeHtml(value || "-")}</div>
        </div>
      `,
        )
        .join("")}
    </div>
  `;
  $("detailEditBtn").onclick = () => openRecordDetail("User", currentUser.id);
  $("detailEditBtn").style.display = "none";
  $("detailOverlay").classList.add("open");
}

function showAuthRequired(message) {
  const meta = OBJECT_META[currentObject];
  $("pageIcon").innerHTML = objectIcon(currentObject);
  $("pageTitle").textContent = "Connect Salesforce";
  $("pageSub").textContent =
    "Authenticate first, then CRM records will load here.";
  $("stateLoading").style.display = "none";
  $("tableCard").style.display = "none";
  $("stateError").style.display = "flex";
  $("errMsg").textContent = "Salesforce authentication required";
  $("errDetail").textContent =
    message || "Click Connect Salesforce and approve the Connected App.";
  const retryBtn = $("stateError").querySelector("button");
  retryBtn.textContent = "Connect Salesforce";
  retryBtn.onclick = connectSalesforce;
}

async function loadListViews() {
  if (!canReadObject(currentObject)) {
    sfListViews = [];
    renderListViewSelect();
    return;
  }
  const cacheKey = `${orgSettings.activeOrgKey || "default"}:${currentObject}`;
  const cached = listViewCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp <= LIST_VIEW_CACHE_TTL_MS) {
    sfListViews = cloneCacheValue(cached.listviews || []);
    renderListViewSelect();
    return;
  }
  try {
    const data = await api(`/api/${currentObject}/listviews`);
    sfListViews = data.listviews || [];
    listViewCache.set(cacheKey, {
      timestamp: Date.now(),
      listviews: cloneCacheValue(sfListViews),
    });
  } catch (err) {
    sfListViews = [];
  }
  renderListViewSelect();
}

function isEditableListView(viewId) {
  if (!viewId || viewId === "all") return false;
  if (viewId.startsWith("local:")) return true;
  if (viewId.startsWith("sf:")) {
    const id = viewId.slice(3);
    const view = sfListViews.find((v) => v.id === id);
    if (!view) return false;
    const devName = view.developerName || "";
    const lower = devName.toLowerCase();
    if (lower === "all" || lower === "recentlyviewed" || lower.startsWith("all_") || lower.startsWith("my_") || lower.startsWith("recently_")) {
      return false;
    }
    const standardNames = [
      "allaccounts", "allcontacts", "allopportunities", "allcases", "allleads", "allcampaigns",
      "recentlyviewedaccounts", "recentlyviewedcontacts", "recentlyviewedopportunities", "recentlyviewedcases", "recentlyviewedleads", "recentlyviewedcampaigns",
      "myaccounts", "mycontacts", "myopportunities", "mycases", "myleads", "mycampaigns"
    ];
    if (standardNames.includes(lower)) return false;
    return true;
  }
  return false;
}

function updateListViewButtonsVisibility() {
  const isEditable = isEditableListView(currentViewId);
  const editBtn = $("editListViewBtn");
  const deleteBtn = $("deleteListViewBtn");
  if (editBtn) editBtn.style.display = isEditable ? "inline-flex" : "none";
  if (deleteBtn) deleteBtn.style.display = isEditable ? "inline-flex" : "none";
}

function renderListViewSelect() {
  const select = $("listViewSelect");
  const locals = objectLocalViews();
  select.innerHTML = `
    <option value="all">All ${OBJECT_META[currentObject].title}</option>
    ${sfListViews.map((view) => `<option value="sf:${view.id}">${escapeHtml(cleanListViewLabel(view.label))}</option>`).join("")}
    ${locals.map((view) => `<option value="local:${view.id}">${escapeHtml(cleanListViewLabel(view.name))}</option>`).join("")}
  `;
  select.value = currentViewId;
  if (select.value !== currentViewId) {
    currentViewId = "all";
    select.value = "all";
  }
  updateListViewButtonsVisibility();
}

async function handleListViewChange(value) {
  currentViewId = value;
  visibleRecordCount = RENDER_CHUNK_SIZE;
  nextRecordsUrl = null;
  const localView = getCurrentLocalView();
  sortState = localView?.sort || { field: null, direction: "asc" };
  updateListViewButtonsVisibility();
  await loadData();
}

async function loadData(options = {}) {
  const loadToken = Symbol("loadData");
  loadData.latestToken = loadToken;
  const requestObject = currentObject;
  const requestVersion = nextListStateVersion();
  rememberCurrentListCacheState();
  const forceRefresh = Boolean(options.forceRefresh);
  let showedFullPageLoading = false;
  let restoredOrRendered = false;
  let loadFailed = false;
  const search = $("objSearch")?.value || "";
  const meta = OBJECT_META[currentObject];
  if (!meta || !canReadObject(currentObject)) {
    currentRecords = [];
    totalRecords = 0;
    nextRecordsUrl = null;
    currentColumns = [];
    currentHiddenFields = new Set();
    applyObjectNavGuards();
    showNoObjectAccess();
    return;
  }
  currentColumns = meta.columns.slice();
  currentHiddenFields = new Set();
  await loadObjectFields(currentObject);
  if (!isCurrentListRequest(requestVersion, requestObject)) return;

  $("pageIcon").innerHTML = objectIcon(currentObject);
  $("pageTitle").textContent = getCurrentViewName();
  try {
    let path = "";
    let cacheMeta = {
      objectName: currentObject,
      filters: { viewId: currentViewId },
      page: 1,
      pageSize: RENDER_CHUNK_SIZE,
      sort: { ...sortState },
      search,
    };
    if (currentViewId.startsWith("sf:")) {
      const viewId = currentViewId.slice(3);
      path = `/api/${currentObject}/listviews/${viewId}/results`;
    } else {
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      const query = `?${params.toString()}`;
      path = `/api/${currentObject}${query}`;
    }
    const localView = getCurrentLocalView();
    const viewSignature = currentViewId.startsWith("local:") ? viewSignatureForCache(localView) : "";
    if (localView?.pageSize) visibleRecordCount = Number(localView.pageSize) || RENDER_CHUNK_SIZE;
    cacheMeta.filters.viewSignature = viewSignature;
    const cacheKey = crmListCacheKey({
      objectName: currentObject,
      path,
      search,
      viewId: currentViewId,
      sort: sortState,
      viewSignature,
      pageSize: localView?.pageSize || RENDER_CHUNK_SIZE,
    });
    const cacheCandidate = forceRefresh
      ? null
      : getCrmListCache(cacheKey);
    const cachedEntry = hasUsableCrmListCacheEntry(cacheCandidate, currentObject)
      ? cacheCandidate
      : null;
    if (!cachedEntry) {
      $("pageSub").textContent =
        `Loading ${meta.title.toLowerCase()} from Salesforce...`;
      $("stateLoading").style.display = "flex";
      showedFullPageLoading = true;
      $("stateError").style.display = "none";
      $("tableCard").style.display = "none";
      if ($("kanbanCard")) $("kanbanCard").style.display = "none";
      updateViewToggle();
    } else {
      clearObjectListLoadingState({ showList: false });
    }
    const result = cachedEntry
      ? { payload: cachedEntry.payload, fromCache: true, meta: cachedEntry }
      : await fetchCrmListPayload(path, cacheKey, cacheMeta, forceRefresh);
    if (!isCurrentListRequest(requestVersion, requestObject)) return;
    loadData.activeCacheKey = cacheKey;
    if (!applyCrmListPayload(result.payload || {})) return;

    if (viewingDetail || loadData.latestToken !== loadToken || !isCurrentListRequest(requestVersion, requestObject, cacheKey)) return;

    visibleRecordCount = result.fromCache && result.meta?.visibleRecordCount
      ? result.meta.visibleRecordCount
      : RENDER_CHUNK_SIZE;
    selectedListRecordId = result.fromCache && result.meta?.selectedRecord
      ? result.meta.selectedRecord
      : selectedListRecordId;
    applySort();
    await renderCurrentView();
    if (viewingDetail || loadData.latestToken !== loadToken || !isCurrentListRequest(requestVersion, requestObject, cacheKey)) return;
    restoredOrRendered = true;
    updatePagination();
    updateBadge(currentObject, knownObjectTotalCount(currentObject, totalRecords || currentRecords.length));
    updateRecordCounts();
    if (!result.fromCache) await verifyListCountWhenSmall();
    clearObjectListLoadingState({ showList: false });
    applyPermissionGuards(currentObject);
    showActiveView();
    if (result.fromCache && result.meta?.scrollPosition) {
      requestAnimationFrame(() => window.scrollTo(0, result.meta.scrollPosition || 0));
    }
    queueLazyLoadIfNeeded();
    captureCrmPageState(currentObject);
 } catch (err) {
    loadFailed = true;
    clearObjectListLoadingState({ showList: false, hideError: false });
    $('stateError').style.display   = 'flex';

    const isAuth  = /auth|oauth|token|unknown_error/i.test(err.message);
    const isPerm  = /permission|403|forbidden/i.test(err.message);
    const isNet   = /network|fetch/i.test(err.message);

    let title  = 'Could not load records';
    let detail = err.message;
    let btnText = 'Retry';
    let btnFn   = 'loadData()';

    if (isAuth) {
      title   = 'Salesforce authentication required';
      detail  = 'Your Salesforce session has expired. Reconnect to continue.';
      btnText = 'Connect Salesforce';
      btnFn   = 'connectSalesforce()';
    } else if (isPerm) {
      title  = 'Access denied';
      detail = err.message;
      btnText = 'Go Back';
      btnFn   = 'restoreListContent()';
    } else if (isNet) {
      title  = 'Connection error';
      detail = 'Check your internet connection and try again.';
    }

    $('errMsg').textContent    = title;
    $('errDetail').textContent = detail;
    $('pageSub').textContent   = 'Could not load data';

    const retryBtn = $('stateError').querySelector('button');
    if (retryBtn) {
      retryBtn.textContent = btnText;
      retryBtn.onclick = new Function(btnFn);
    }

    // Also show toast for quick visibility
    toast(detail, 'err', 10000);
  } finally {
    if (loadData.latestToken === loadToken && !viewingDetail && isCurrentListRequest(requestVersion, requestObject) && (showedFullPageLoading || restoredOrRendered)) {
      clearObjectListLoadingState({ showList: restoredOrRendered, hideError: !loadFailed });
    }
  }
}

function normalizeListViewColumns(columns) {
  const fields = (columns || [])
    .map((column) => column.fieldNameOrPath || column.fieldName)
    .filter(
      (field) => field && field !== "Id" && !field.includes("attributes"),
    );
  return fields.length
    ? normalizePortalColumns([...new Set(fields)])
    : OBJECT_META[currentObject].columns.slice();
}

function getCurrentViewName() {
  if (currentViewId.startsWith("sf:")) {
    const view = sfListViews.find((item) => item.id === currentViewId.slice(3));
    return cleanListViewLabel(view?.label || OBJECT_META[currentObject].title);
  }
  if (currentViewId.startsWith("local:")) {
    const view = objectLocalViews().find(
      (item) => item.id === currentViewId.slice(6),
    );
    return cleanListViewLabel(view?.name || OBJECT_META[currentObject].title);
  }
  return OBJECT_META[currentObject].title;
}

function normalizeComparableValue(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return value.Name || value.label || JSON.stringify(value);
  return String(value);
}

function toComparableNumber(value) {
  const number = Number(String(value ?? "").replace(/[$,%\s,]/g, ""));
  return Number.isFinite(number) ? number : null;
}

function toComparableDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function dateRangeForOperator(operator) {
  const now = new Date();
  const startOfDay = (date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const today = startOfDay(now);
  if (operator === "today") return [today, new Date(today.getTime() + 86400000)];
  if (operator === "yesterday") return [new Date(today.getTime() - 86400000), today];
  if (operator === "last_7_days") return [new Date(today.getTime() - 6 * 86400000), new Date(today.getTime() + 86400000)];
  if (operator === "last_30_days") return [new Date(today.getTime() - 29 * 86400000), new Date(today.getTime() + 86400000)];
  if (operator === "this_month") return [new Date(now.getFullYear(), now.getMonth(), 1), new Date(now.getFullYear(), now.getMonth() + 1, 1)];
  if (operator === "last_month") return [new Date(now.getFullYear(), now.getMonth() - 1, 1), new Date(now.getFullYear(), now.getMonth(), 1)];
  return null;
}

function recordMatchesFilter(record, filter) {
  if (!filter?.field || !filter.operator) return true;
  const rawValue = getValue(record, filter.field);
  const value = normalizeComparableValue(rawValue);
  const expected = normalizeComparableValue(filter.value).trim();
  const lowerValue = value.toLowerCase();
  const lowerExpected = expected.toLowerCase();
  switch (filter.operator) {
    case "blank":
      return value.trim() === "";
    case "not_blank":
      return value.trim() !== "";
    case "true":
      return rawValue === true || lowerValue === "true";
    case "false":
      return rawValue === false || lowerValue === "false";
    case "equals":
      return lowerValue === lowerExpected;
    case "not_equals":
      return lowerValue !== lowerExpected;
    case "contains":
      return lowerValue.includes(lowerExpected);
    case "not_contains":
      return !lowerValue.includes(lowerExpected);
    case "starts_with":
      return lowerValue.startsWith(lowerExpected);
    case "ends_with":
      return lowerValue.endsWith(lowerExpected);
    case "gt":
    case "gte":
    case "lt":
    case "lte": {
      const actualNumber = toComparableNumber(rawValue);
      const expectedNumber = toComparableNumber(expected);
      if (actualNumber === null || expectedNumber === null) return false;
      if (filter.operator === "gt") return actualNumber > expectedNumber;
      if (filter.operator === "gte") return actualNumber >= expectedNumber;
      if (filter.operator === "lt") return actualNumber < expectedNumber;
      return actualNumber <= expectedNumber;
    }
    case "between": {
      const actualNumber = toComparableNumber(rawValue);
      const [min, max] = expected.split(/[,|]/).map(toComparableNumber);
      return actualNumber !== null && min !== null && max !== null && actualNumber >= min && actualNumber <= max;
    }
    case "before":
    case "after": {
      const actualDate = toComparableDate(rawValue);
      const expectedDate = toComparableDate(expected);
      if (!actualDate || !expectedDate) return false;
      return filter.operator === "before" ? actualDate < expectedDate : actualDate > expectedDate;
    }
    default: {
      const range = dateRangeForOperator(filter.operator);
      if (!range) return true;
      const actualDate = toComparableDate(rawValue);
      return actualDate ? actualDate >= range[0] && actualDate < range[1] : false;
    }
  }
}

function recordMatchesFilters(record, filters = [], logic = "AND") {
  const activeFilters = (filters || []).filter((filter) => filter?.field && filter?.operator);
  if (!activeFilters.length) return true;
  if (String(logic).toUpperCase() === "OR") {
    return activeFilters.some((filter) => recordMatchesFilter(record, filter));
  }
  return activeFilters.every((filter) => recordMatchesFilter(record, filter));
}

function applyLocalView() {
  if (!currentViewId.startsWith("local:")) return;
  const view = getCurrentLocalView();
  if (!view) return;
  currentColumns = normalizePortalColumns(view.columns?.length ? view.columns : currentColumns);
  if (view.pageSize) visibleRecordCount = Number(view.pageSize) || visibleRecordCount;
  if (view.filters?.length) {
    currentRecords = currentRecords.filter((record) =>
      recordMatchesFilters(record, view.filters, view.filterLogic || "AND"),
    );
    totalRecords = currentRecords.length;
  }
  if (view.search) {
    const q = view.search.toLowerCase();
    currentRecords = currentRecords.filter((record) =>
      currentColumns.some((field) =>
        String(getValue(record, field) || "")
          .toLowerCase()
          .includes(q),
      ),
    );
    totalRecords = currentRecords.length;
  }
}

function renderTable() {
  if (viewingDetail) return;
  renderFilterPills();
  const table = $("dataTable");
  const tableCard = $("tableCard");
  if (!table || !tableCard) return;
  const objectClass = `object-table-${currentObject.toLowerCase()}`;
  const showActions = canDo(currentObject, "can_edit") || canDo(currentObject, "can_delete");
  const columnCount = currentColumns.length + (showActions ? 1 : 0);
  table.className = `data-table object-table ${objectClass}`;
  tableCard.dataset.object = currentObject;

  $("thead").innerHTML = `
    <tr>
      ${currentColumns
        .map(
          (field) => `
        <th class="${sortState.field === field ? "sorted" : ""} ${fieldColumnClass(field)}" onclick="sortBy('${field}')">
          ${labelFor(field)}
          <span class="sort-arrow">${sortState.field === field ? (sortState.direction === "asc" ? "^" : "v") : "-"}</span>
        </th>
      `,
        )
        .join("")}
      ${showActions ? '<th class="actions-col">Actions</th>' : ''}
    </tr>
  `;

  if (!currentRecords.length) {
    resetVirtualTableState();
    $("tbody").innerHTML = `
      <tr>
        <td class="table-empty" colspan="${columnCount}">
          <div class="table-empty-icon">${objectIcon(currentObject)}</div>
          <h3>No records found</h3>
          <p>Try a different search, list view, or create a new record.</p>
        </td>
      </tr>
    `;
    return;
  }

  setupVirtualTableBody($("tbody"), columnCount, showActions);
  renderVirtualTableWindow(true);
}

function renderFilterPills() {
  const holder = $("filterPills");
  if (!holder) return;
  const pills = [];
  const search = $("objSearch")?.value || "";
  if (search) {
    pills.push(`<span class="filter-pill">Search: ${escapeHtml(search)} <button onclick="clearObjectSearch()" aria-label="Clear search">x</button></span>`);
  }
  const localView = getCurrentLocalView();
  (localView?.filters || []).forEach((filter, index) => {
    const needsValue = !["blank", "not_blank", "true", "false", "today", "yesterday", "last_7_days", "last_30_days", "this_month", "last_month"].includes(filter.operator);
    const valueText = needsValue ? ` ${escapeHtml(filter.value || "")}` : "";
    pills.push(`
      <span class="filter-pill">
        ${escapeHtml(labelFor(filter.field))} ${escapeHtml(operatorLabel(filter.operator))}${valueText}
        <button onclick="removeLocalViewFilter(${index})" aria-label="Remove filter">x</button>
      </span>
    `);
  });
  holder.innerHTML = pills.join("");
}

function clearObjectSearch() {
  const input = $("objSearch");
  if (input) input.value = "";
  handleObjSearch("");
}

async function removeLocalViewFilter(index) {
  const view = getCurrentLocalView();
  if (!view) return;
  const filters = [...(view.filters || [])];
  filters.splice(index, 1);
  persistCurrentLocalViewPatch({ filters });
  await loadData({ forceRefresh: true });
}

function renderTableCellsHtml(record, showActions) {
  return `
      ${currentColumns.map((field) => `<td class="${fieldColumnClass(field)}">${formatValue(field, getValue(record, field), record)}</td>`).join("")}
      ${showActions ? `<td class="actions-col">
        <div class="row-acts">
          ${canDo(currentObject, "can_edit") ? `<button class="row-action edit" title="Edit" aria-label="Edit" onclick="event.stopPropagation(); openEdit('${escapeJs(record.Id)}')">
            <svg viewBox="0 0 20 20" width="15" height="15" fill="currentColor">
              <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793z"/>
              <path d="M11.379 5.793L3 14.172V17h2.828l8.379-8.379-2.828-2.828z"/>
            </svg>
          </button>` : ''}
          ${canDo(currentObject, "can_delete") ? `<button class="row-action del" title="Delete" aria-label="Delete" onclick="event.stopPropagation(); openDelete('${escapeJs(record.Id)}')">
            <svg viewBox="0 0 20 20" width="15" height="15" fill="currentColor">
              <path fill-rule="evenodd" d="M8 2a1 1 0 00-.894.553L6.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-2.382l-.724-1.447A1 1 0 0012 2H8zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clip-rule="evenodd"/>
            </svg>
          </button>` : ''}
        </div>
      </td>` : ''}
  `;
}

function renderTableRowHtml(record, showActions) {
  return `
    <tr class="${selectedListRecordId === record.Id ? "selected-row" : ""}" data-record-id="${escapeHtml(record.Id)}" onclick="openRecordDetail('${currentObject}', '${escapeJs(record.Id)}')">
      ${renderTableCellsHtml(record, showActions)}
    </tr>
  `;
}

function patchRenderedTableRows(previousColumns = currentColumns) {
  const table = $("dataTable");
  const tbody = $("tbody");
  if (
    viewingDetail ||
    currentViewMode !== "table" ||
    !table ||
    !tbody ||
    JSON.stringify(previousColumns || []) !== JSON.stringify(currentColumns || [])
  ) {
    renderTable();
    return;
  }

  const showActions = canDo(currentObject, "can_edit") || canDo(currentObject, "can_delete");
  const columnCount = currentColumns.length + (showActions ? 1 : 0);

  if (!currentRecords.length) {
    renderTable();
    return;
  }

  setupVirtualTableBody(tbody, columnCount, showActions);
  renderVirtualTableWindow(true);
}

function resetVirtualTableState() {
  if (virtualTableState.raf) cancelAnimationFrame(virtualTableState.raf);
  virtualTableState = {
    signature: "",
    rowHeight: VIRTUAL_ROW_ESTIMATE_PX,
    rowHeightMeasured: false,
    start: -1,
    end: -1,
    pool: [],
    raf: 0,
  };
}

function virtualTableSignature(columnCount, showActions) {
  return JSON.stringify({
    object: currentObject,
    columns: currentColumns,
    columnCount,
    showActions,
  });
}

function setupVirtualTableBody(tbody, columnCount, showActions) {
  if (!tbody) return;
  const signature = virtualTableSignature(columnCount, showActions);
  if (virtualTableState.signature === signature && $("virtualTopSpacer") && $("virtualBottomSpacer")) {
    updateVirtualSentinel(columnCount);
    return;
  }

  if (lazyObserver) lazyObserver.disconnect();
  resetVirtualTableState();
  virtualTableState.signature = signature;

  tbody.innerHTML = `
    <tr id="virtualTopSpacer" class="virtual-spacer-row" aria-hidden="true">
      <td colspan="${columnCount}"><div class="virtual-spacer-block"></div></td>
    </tr>
    <tr id="virtualBottomSpacer" class="virtual-spacer-row" aria-hidden="true">
      <td colspan="${columnCount}"><div class="virtual-spacer-block"></div></td>
    </tr>
    <tr id="lazyLoadSentinel" class="lazy-load-row">
      <td colspan="${columnCount}">All loaded</td>
    </tr>
  `;
  updateVirtualSentinel(columnCount);
}

function updateVirtualSentinel(columnCount) {
  const sentinel = $("lazyLoadSentinel");
  if (!sentinel) return;
  sentinel.innerHTML = `
    <td colspan="${columnCount}">
      ${loadingMoreRecords ? "Loading more records..." : nextRecordsUrl ? "Scroll to load more records" : "All loaded"}
    </td>
  `;
}

function virtualBufferRows() {
  const rowHeight = Math.max(virtualTableState.rowHeight || VIRTUAL_ROW_ESTIMATE_PX, 32);
  const viewportRows = Math.ceil(window.innerHeight / rowHeight);
  return Math.max(VIRTUAL_MIN_BUFFER_ROWS, Math.min(VIRTUAL_MAX_BUFFER_ROWS, viewportRows));
}

function measureVirtualRowHeight(row) {
  if (!row || virtualTableState.rowHeightMeasured) return;
  const measured = row.getBoundingClientRect().height;
  if (measured > 20) {
    virtualTableState.rowHeight = measured;
    virtualTableState.rowHeightMeasured = true;
  }
}

function computeVirtualRange() {
  const table = $("dataTable");
  if (!table || !currentRecords.length) return { start: 0, end: 0 };

  const tableTop = table.getBoundingClientRect().top + window.scrollY;
  const headerHeight = table.tHead?.getBoundingClientRect().height || 44;
  const bodyTop = tableTop + headerHeight;
  const rowHeight = Math.max(virtualTableState.rowHeight || VIRTUAL_ROW_ESTIMATE_PX, 32);
  const buffer = virtualBufferRows();
  const viewportTop = window.scrollY;
  const viewportBottom = viewportTop + window.innerHeight;

  const rawStart = Math.floor((viewportTop - bodyTop) / rowHeight) - buffer;
  const rawEnd = Math.ceil((viewportBottom - bodyTop) / rowHeight) + buffer;
  const maxStart = Math.max(0, currentRecords.length - 1);
  const start = Math.min(maxStart, Math.max(0, rawStart));
  const end = Math.min(currentRecords.length, Math.max(start + 1, rawEnd));
  return { start, end };
}

function setVirtualSpacerHeight(id, height) {
  const spacer = $(id)?.querySelector(".virtual-spacer-block");
  if (!spacer) return;
  const nextHeight = `${Math.max(0, Math.round(height))}px`;
  if (spacer.style.height !== nextHeight) spacer.style.height = nextHeight;
}

function ensureVirtualRowPool(size) {
  const tbody = $("tbody");
  const bottomSpacer = $("virtualBottomSpacer");
  if (!tbody || !bottomSpacer) return [];

  while (virtualTableState.pool.length < size) {
    const row = document.createElement("tr");
    row.className = "virtual-record-row";
    row.style.display = "none";
    tbody.insertBefore(row, bottomSpacer);
    virtualTableState.pool.push(row);
  }
  return virtualTableState.pool;
}

function updateVirtualRow(row, record, showActions) {
  if (!row || !record) return;
  row.style.display = "";
  const nextClass = `${selectedListRecordId === record.Id ? "selected-row " : ""}virtual-record-row`;
  if (row.className !== nextClass) row.className = nextClass;
  if (row.dataset.recordId !== record.Id) {
    row.dataset.recordId = record.Id;
    row.onclick = () => openRecordDetail(currentObject, record.Id);
    row.innerHTML = renderTableCellsHtml(record, showActions);
  }
}

function renderVirtualTableWindow(force = false) {
  if (viewingDetail || currentViewMode !== "table") return;
  const tbody = $("tbody");
  if (!tbody || !$("virtualTopSpacer") || !$("virtualBottomSpacer")) return;

  const showActions = canDo(currentObject, "can_edit") || canDo(currentObject, "can_delete");
  const columnCount = currentColumns.length + (showActions ? 1 : 0);
  const { start, end } = computeVirtualRange();
  const visibleCount = Math.max(0, end - start);

  if (!force && start === virtualTableState.start && end === virtualTableState.end) {
    updateVirtualSentinel(columnCount);
    return;
  }

  const rows = ensureVirtualRowPool(visibleCount);
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    const record = index < visibleCount ? currentRecords[start + index] : null;
    if (record) {
      updateVirtualRow(row, record, showActions);
      if (index === 0) measureVirtualRowHeight(row);
    } else {
      row.style.display = "none";
      row.removeAttribute("data-record-id");
      row.onclick = null;
    }
  }

  const rowHeight = Math.max(virtualTableState.rowHeight || VIRTUAL_ROW_ESTIMATE_PX, 32);
  setVirtualSpacerHeight("virtualTopSpacer", start * rowHeight);
  setVirtualSpacerHeight("virtualBottomSpacer", Math.max(0, currentRecords.length - end) * rowHeight);
  virtualTableState.start = start;
  virtualTableState.end = end;
  updateVirtualSentinel(columnCount);
}

function scheduleVirtualTableRender(force = false) {
  if (currentViewMode !== "table" || viewingDetail) return;
  if (virtualTableState.raf) cancelAnimationFrame(virtualTableState.raf);
  virtualTableState.raf = requestAnimationFrame(() => {
    virtualTableState.raf = 0;
    renderVirtualTableWindow(force);
  });
}

function updateViewToggle() {
  const toggle = $("viewToggle");
  if (!toggle) return;
  if (!isKanbanObject()) {
    currentViewMode = "table";
    toggle.style.display = "none";
  } else {
    toggle.style.display = "inline-flex";
  }
  $("tableViewBtn")?.classList.toggle("active", currentViewMode === "table");
  $("kanbanViewBtn")?.classList.toggle("active", currentViewMode === "kanban");
}

async function setViewMode(mode) {
  currentViewMode = isKanbanObject() && mode === "kanban" ? "kanban" : "table";
  updateViewToggle();
  await renderCurrentView();
  updatePagination();
  showActiveView();
  captureCrmPageState(currentObject);
}

function showActiveView() {
  const tableCard = $("tableCard");
  const kanbanCard = $("kanbanCard");
  if (tableCard)
    tableCard.style.display = currentViewMode === "table" ? "block" : "none";
  if (kanbanCard)
    kanbanCard.style.display = currentViewMode === "kanban" ? "block" : "none";
}

async function renderCurrentView() {
  if (viewingDetail) return;
  updateViewToggle();
  if (currentViewMode === "kanban") {
    await renderKanban();
    return;
  }
  renderTable();
}

function fieldColumnClass(field) {
  return `col-${String(field)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")}`;
}

async function getKanbanValues() {
  const field = kanbanFieldFor();
  const key = `${currentObject}.${field}`;
  if (kanbanPicklistCache[key]) return kanbanPicklistCache[key];

  try {
    const data = await api(`/api/meta/${currentObject}/picklist/${field}`);
    const values = (data.values || []).filter(Boolean);
    kanbanPicklistCache[key] = uniqueKanbanValues(values);
  } catch {
    kanbanPicklistCache[key] = uniqueKanbanValues([]);
  }
  return kanbanPicklistCache[key];
}

async function renderKanban() {
  const board = $("kanbanBoard");
  if (!board) return;

  const field = kanbanFieldFor();
  const values = await getKanbanValues();
  const records = getRecordsToRender();
  const grouped = uniqueKanbanValues([
    ...values,
    ...records.map((record) => record[field] || "Unspecified"),
  ]).reduce((acc, value) => ({ ...acc, [value]: [] }), {});
  records.forEach((record) => {
    const value = record[field] || "Unspecified";
    if (!grouped[value]) grouped[value] = [];
    grouped[value].push(record);
  });

  const columns = Object.keys(grouped);
  board.innerHTML = columns
    .map((value) => {
      const items = grouped[value] || [];
      const amount =
        currentObject === "Opportunity"
          ? items.reduce((sum, record) => sum + (Number(record.Amount) || 0), 0)
          : 0;
      return `
      <section class="kanban-column" data-value="${escapeHtml(value)}" ondragover="handleKanbanDragOver(event)" ondragleave="handleKanbanDragLeave(event)" ondrop="handleKanbanDrop(event, '${escapeJs(value)}')">
        <div class="kanban-column-head">
          <div class="kanban-stage-name" title="${escapeHtml(value)}">${escapeHtml(value)}</div>
          <span class="kanban-count">${items.length}</span>
        </div>
        ${currentObject === "Opportunity" ? `<div class="kanban-stage-total">${formatKanbanAmount(amount)}</div>` : ""}
        <div class="kanban-list">
          ${items.length ? items.map(renderKanbanCard).join("") : '<div class="kanban-empty">No records</div>'}
        </div>
      </section>
    `;
    })
    .join("");
}

function renderKanbanCard(record) {
  const title =
    record.Name ||
    `${record.FirstName || ""} ${record.LastName || ""}`.trim() ||
    record.Id;
  const accountName = getValue(record, "Account.Name");
  const subtitle =
    currentObject === "Opportunity"
      ? accountName || record.AccountSite || ""
      : record.Company || record.Title || "";
  const detail =
    currentObject === "Opportunity"
      ? [formatKanbanAmount(record.Amount), record.CloseDate]
          .filter(Boolean)
          .join(" - ")
      : [record.State, record.Email].filter(Boolean).join(" - ");
  const subtitleHtml =
    currentObject === "Opportunity" && accountName && record.AccountId
      ? `<button class="kanban-link-line" onclick="event.stopPropagation(); openRecordDetail('Account', '${escapeJs(record.AccountId)}')">${escapeHtml(accountName)}</button>`
      : subtitle
        ? `<div class="kanban-subtitle">${escapeHtml(subtitle)}</div>`
        : "";
  const field = kanbanFieldFor();
  const value = record[field] || "Unspecified";

  return `
    <article class="kanban-item ${selectedListRecordId === record.Id ? "selected-row" : ""}" draggable="true" data-id="${escapeHtml(record.Id)}"
      ondragstart="handleKanbanDragStart(event, '${escapeJs(record.Id)}')"
      onclick="openRecordDetail('${currentObject}', '${escapeJs(record.Id)}')">
      <div class="kanban-item-top">
        <button class="kanban-title" onclick="event.stopPropagation(); openRecordDetail('${currentObject}', '${escapeJs(record.Id)}')">${escapeHtml(title)}</button>
        <button class="kanban-card-action" title="Edit" aria-label="Edit" onclick="event.stopPropagation(); openEdit('${escapeJs(record.Id)}')">
          <svg viewBox="0 0 20 20" width="14" height="14" fill="currentColor">
            <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793z"/>
            <path d="M11.379 5.793L3 14.172V17h2.828l8.379-8.379-2.828-2.828z"/>
          </svg>
        </button>
      </div>
      ${subtitleHtml}
      ${detail ? `<div class="kanban-detail">${escapeHtml(detail)}</div>` : ""}
      <div class="kanban-foot">
        <button class="kanban-grip" title="Change ${escapeHtml(labelFor(field))}" onclick="event.stopPropagation(); toggleKanbanMenu(event, '${escapeJs(record.Id)}')" aria-label="Change ${escapeHtml(labelFor(field))}" aria-haspopup="menu" aria-expanded="false">::::</button>
        <span class="kanban-stage-text" title="${escapeHtml(value)}">
          ${escapeHtml(value)}
        </span>
      </div>
    </article>
  `;
}

function formatKanbanAmount(value) {
  const amount = Number(value) || 0;
  return amount.toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

async function toggleKanbanMenu(event, id) {
  event.stopPropagation();
  const openMenu = Array.from(
    document.querySelectorAll(".kanban-stage-menu"),
  ).find((menu) => menu.dataset.recordId === id);
  closeKanbanMenus();

  const button = event.currentTarget;
  if (openMenu) {
    button.setAttribute("aria-expanded", "false");
    return;
  }

  const item = button.closest(".kanban-item");
  const record = currentRecords.find((row) => row.Id === id);
  if (!item || !record) return;

  const values = await getKanbanValues();
  const currentValue = record[kanbanFieldFor()] || "Unspecified";
  const menu = document.createElement("div");
  menu.className = "kanban-stage-menu";
  menu.dataset.recordId = id;
  menu.setAttribute("role", "menu");
  menu.innerHTML = values
    .map(
      (value) => `
    <button class="kanban-stage-option${value === currentValue ? " active" : ""}" role="menuitem" onclick="event.stopPropagation(); selectKanbanValue('${escapeJs(id)}', '${escapeJs(value)}')">
      ${escapeHtml(value)}
    </button>
  `,
    )
    .join("");
  document.body.appendChild(menu);
  positionKanbanMenu(menu, button);
  button.setAttribute("aria-expanded", "true");
}

async function selectKanbanValue(id, value) {
  closeKanbanMenus();
  await moveKanbanRecord(id, value);
}

function closeKanbanMenus(exceptId = "") {
  document.querySelectorAll(".kanban-stage-menu").forEach((menu) => {
    if (exceptId && menu.dataset.recordId === exceptId) return;
    menu.remove();
  });
  document
    .querySelectorAll('.kanban-grip[aria-expanded="true"]')
    .forEach((button) => {
      button.setAttribute("aria-expanded", "false");
    });
}

function positionKanbanMenu(menu, anchor) {
  const margin = 8;
  const width = Math.min(232, window.innerWidth - margin * 2);
  menu.style.width = `${width}px`;

  const anchorRect = anchor.getBoundingClientRect();
  const menuRect = menu.getBoundingClientRect();
  const maxLeft = window.innerWidth - width - margin;
  const left = Math.min(
    Math.max(anchorRect.left + anchorRect.width / 2 - width / 2, margin),
    maxLeft,
  );

  let top = anchorRect.bottom + 6;
  const roomBelow = window.innerHeight - anchorRect.bottom - margin;
  const roomAbove = anchorRect.top - margin;
  if (roomBelow < menuRect.height && roomAbove > roomBelow) {
    top = anchorRect.top - menuRect.height - 6;
  }
  if (top < margin || top + menuRect.height > window.innerHeight - margin) {
    top = Math.max(margin, (window.innerHeight - menuRect.height) / 2);
  }

  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
}

function escapeJs(value) {
  return String(value || "")
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'");
}

function handleKanbanDragStart(event, id) {
  draggedKanbanId = id;
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData("text/plain", id);
}

function handleKanbanDragOver(event) {
  event.preventDefault();
  event.currentTarget.classList.add("drag-over");
}

function handleKanbanDragLeave(event) {
  event.currentTarget.classList.remove("drag-over");
}

async function handleKanbanDrop(event, nextValue) {
  event.preventDefault();
  event.currentTarget.classList.remove("drag-over");
  const id = event.dataTransfer.getData("text/plain") || draggedKanbanId;
  draggedKanbanId = null;
  if (!id) return;
  await moveKanbanRecord(id, nextValue);
}

async function moveKanbanRecord(id, nextValue) {
  const record = currentRecords.find((item) => item.Id === id);
  const field = kanbanFieldFor();
  if (!record || record[field] === nextValue) return;

  const previousValue = record[field];
  record[field] = nextValue;
  await renderKanban();

  try {
    await api(`/api/${currentObject}/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ [field]: nextValue }),
    });
    toast(`${labelFor(field)} updated`, "ok");
  } catch (err) {
    record[field] = previousValue;
    await renderKanban();
    toast(err.message, "err");
  }
}

function getRecordsToRender() {
  return currentRecords.slice(0, visibleRecordCount);
}

function appendUniqueRecords(records = []) {
  const seen = new Set(currentRecords.map((record) => record.Id));
  records.forEach((record) => {
    if (!record?.Id || seen.has(record.Id)) return;
    seen.add(record.Id);
    currentRecords.push(record);
  });
}

function lazyEndpoint(cursor) {
  const params = new URLSearchParams({ cursor });
  if (currentViewId.startsWith("sf:")) {
    return `/api/${currentObject}/listviews/${currentViewId.slice(3)}/results?${params.toString()}`;
  }
  return `/api/${currentObject}?${params.toString()}`;
}

async function loadMoreRecords() {
  if (loadingMoreRecords || !nextRecordsUrl) return false;
  const requestObject = currentObject;
  const requestVersion = listStateVersion;
  loadingMoreRecords = true;
  updatePagination();
  try {
    const data = await api(lazyEndpoint(nextRecordsUrl));
    if (!isCurrentListRequest(requestVersion, requestObject)) return false;
    appendUniqueRecords(data.records || []);
    nextRecordsUrl = data.nextRecordsUrl || null;
    totalRecords = knownObjectTotalCount(currentObject, data.totalSize || totalRecords || currentRecords.length);
    rememberObjectTotalCount(currentObject, totalRecords);
    applyLocalView();
    applySort();
    await renderCurrentView();
    updatePagination();
    updateBadge(currentObject, knownObjectTotalCount(currentObject, totalRecords || currentRecords.length));
    updateRecordCounts();
    rememberCurrentListCacheState();
    return true;
  } catch (err) {
    toast(err.message, "err");
    return false;
  } finally {
    loadingMoreRecords = false;
    updatePagination();
  }
}

async function showMoreVisibleRecords() {
  visibleRecordCount = Math.min(
    visibleRecordCount + RENDER_CHUNK_SIZE,
    currentRecords.length,
  );
  await renderCurrentView();
  updatePagination();
  updateRecordCounts();
  rememberCurrentListCacheState();
  if (visibleRecordCount >= currentRecords.length && nextRecordsUrl) {
    await loadMoreRecords();
  } else {
    queueLazyLoadIfNeeded();
  }
}

function shouldLazyLoadMore() {
  if (
    viewingDetail ||
    currentViewMode !== "table" ||
    $("tableCard")?.style.display === "none"
  )
    return false;
  if ($("virtualTopSpacer") && $("virtualBottomSpacer")) {
    const prefetchRows = Math.max(virtualBufferRows() * 2, RENDER_CHUNK_SIZE);
    const { end } = computeVirtualRange();
    return currentRecords.length - end <= prefetchRows;
  }
  const tableCard = $("tableCard");
  if (!tableCard) return false;
  const rect = tableCard.getBoundingClientRect();
  return rect.bottom < window.innerHeight + 360;
}

async function handleLazyScroll() {
  scheduleVirtualTableRender();
  if (loadingMoreRecords || !shouldLazyLoadMore()) return;
  if (nextRecordsUrl) await loadMoreRecords();
}

function queueLazyLoadIfNeeded() {
  if (lazyLoadQueued) return;
  lazyLoadQueued = true;
  setTimeout(() => {
    lazyLoadQueued = false;
    handleLazyScroll();
  }, 0);
}

function observeLazySentinel() {
  if (lazyObserver) lazyObserver.disconnect();
}

function loadedRangeText() {
  const shown =
    currentViewMode === "table"
      ? currentRecords.length
      : Math.min(visibleRecordCount, currentRecords.length);
  if (!totalRecords) return `${shown} shown`;
  return `${shown} of ${totalRecords}`;
}

function updateRecordCounts() {
  if (viewingDetail) return;
  const shown =
    currentViewMode === "table"
      ? currentRecords.length
      : Math.min(visibleRecordCount, currentRecords.length);
  const totalLabel = knownObjectTotalCount(currentObject, totalRecords || currentRecords.length);
  const pageSub = $("pageSub");
  const recCount = $("recCount");
  if (!pageSub || !recCount) return;
  pageSub.textContent = `${totalLabel} records available`;
  recCount.textContent =
    currentViewMode === "kanban"
      ? `${currentRecords.length} loaded`
      : `${shown} shown`;
}

function clearObjectListLoadingState({ showList = true, hideError = true } = {}) {
  const loading = $("stateLoading");
  const error = $("stateError");
  if (loading) loading.style.display = "none";
  if (hideError && error) error.style.display = "none";
  if (showList && !viewingDetail) showActiveView();
}

function restoreWindowScrollPosition(targetY = 0, attempts = 8) {
  const desired = Math.max(0, Number(targetY) || 0);
  let lastApplied = -1;
  const tryScroll = (remaining) => {
    const maxScroll = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
    const nextScroll = Math.min(desired, maxScroll);
    window.scrollTo(0, nextScroll);
    scheduleVirtualTableRender(true);
    renderVirtualTableWindow(true);
    lastApplied = nextScroll;
    if (remaining <= 0) return;
    const current = currentScrollPosition();
    if (Math.abs(current - desired) <= 2 || maxScroll >= desired) {
      requestAnimationFrame(() => {
        const finalScroll = Math.min(desired, Math.max(0, document.documentElement.scrollHeight - window.innerHeight));
        window.scrollTo(0, finalScroll);
        scheduleVirtualTableRender(true);
        renderVirtualTableWindow(true);
        if (Math.abs(finalScroll - lastApplied) > 2) {
          requestAnimationFrame(() => renderVirtualTableWindow(true));
        }
      });
      return;
    }
    requestAnimationFrame(() => tryScroll(remaining - 1));
  };
  requestAnimationFrame(() => tryScroll(attempts));
}

function finalizeCachedObjectListRestore(scrollPosition = 0) {
  showActiveView();
  clearObjectListLoadingState();
  updatePagination();
  updateRecordCounts();
  observeLazySentinel();
  if (currentViewMode === "table") {
    renderVirtualTableWindow(true);
  }
  restoreWindowScrollPosition(scrollPosition || 0);
  queueLazyLoadIfNeeded();
  captureCrmPageState(currentObject);
}

async function verifyListCountWhenSmall() {
  if (totalRecords > 100 || nextRecordsUrl) return;
  try {
    const search = $("objSearch")?.value || "";
    const params = new URLSearchParams();
    if (search) params.set("search", search);
    const data = await api(
      `/api/${currentObject}/count${params.toString() ? `?${params.toString()}` : ""}`,
    );
    const count = Number(data.totalSize || 0);
    if (count !== totalRecords) {
      totalRecords = count;
      rememberObjectTotalCount(currentObject, count);
      updateRecordCounts();
      updateBadge(currentObject, knownObjectTotalCount(currentObject, totalRecords || currentRecords.length));
    }
    if (count <= currentRecords.length && count <= 100) {
      const orgLabel = data.org?.label ? ` in ${data.org.label}` : "";
      $("lazyHint").textContent =
        `Salesforce returned ${count} ${currentObject} records${orgLabel}`;
    }
  } catch {
    // Count is only diagnostic; the list itself already loaded successfully.
  }
}

function sortBy(field) {
  sortState = {
    field,
    direction:
      sortState.field === field && sortState.direction === "asc"
        ? "desc"
        : "asc",
  };
  persistCurrentLocalViewPatch({ sort: { ...sortState } });
  applySort();
  renderCurrentView();
  captureCrmPageState(currentObject);
}

function applySort() {
  if (!sortState.field) return;
  const dir = sortState.direction === "asc" ? 1 : -1;
  currentRecords.sort((a, b) => {
    const av = getValue(a, sortState.field);
    const bv = getValue(b, sortState.field);
    if (av === bv) return 0;
    if (av === null || av === undefined) return 1;
    if (bv === null || bv === undefined) return -1;
    if (!Number.isNaN(Number(av)) && !Number.isNaN(Number(bv)))
      return (Number(av) - Number(bv)) * dir;
    return String(av).localeCompare(String(bv)) * dir;
  });
}

async function switchObject(objectName) {
  if (!canReadObject(objectName)) {
    toast(`You do not have access to ${OBJECT_META[objectName]?.title || objectName}.`, "err");
    return;
  }
  captureCrmPageState(currentObject);
  if (!restoringCrmHistory) writeCrmHistory(objectName);
  if (viewingDetail) restoreListContent(false);
  if (restoreCrmPageState(objectName)) {
    closeSidebar();
    return;
  }
  nextListStateVersion();
  currentObject = objectName;
  currentRecords = [];
  totalRecords = 0;
  nextRecordsUrl = null;
  visibleRecordCount = RENDER_CHUNK_SIZE;
  loadingMoreRecords = false;
  currentViewId = "all";
  currentViewMode = "table";
  sortState = { field: null, direction: "asc" };
  selectedListRecordId = null;
  $("objSearch").value = "";
  setActiveNavObject(objectName);
  closeSidebar();
  await loadListViews();
  await loadData();
}

function restoreListContent(shouldLoad = false, options = {}) {
  if (!listContentHtml) return;
  listRestoreInProgress = true;
  nextListStateVersion();
  $("content").innerHTML = listContentHtml;
  viewingDetail = false;
  detailRecordState = null;
  setActiveNavObject(currentObject);
  clearObjectListLoadingState();
  applyListCacheEntry(activeListCacheEntry());
  if (!options.preserveHistory && !restoringCrmHistory) {
    writeCrmHistory(currentObject, true);
  }
  if (shouldLoad) {
    renderListViewSelect();
    listRestoreInProgress = false;
    loadData();
  } else {
    renderCurrentView()
      .catch((err) => console.warn("List restore render failed:", err.message || err))
      .finally(() => {
        const entry = activeListCacheEntry();
        finalizeCachedObjectListRestore(entry?.scrollPosition || 0);
        listRestoreInProgress = false;
      });
  }
}

function backToCurrentList() {
  restoreListContent(false);
}

function updateBadge(objectName, count) {
  const badge = $(`badge-${objectName}`);
  if (badge) badge.textContent = count;
}

function handleObjSearch(value) {
  clearTimeout(searchTimer);
  visibleRecordCount = RENDER_CHUNK_SIZE;
  nextRecordsUrl = null;
  currentViewId = currentViewId.startsWith("sf:") ? "all" : currentViewId;
  $("listViewSelect").value = currentViewId;
  searchTimer = setTimeout(loadData, value ? 350 : 0);
}

function pageRangeStart() {
  return currentRecords.length ? 1 : 0;
}

function pageRangeEnd() {
  return currentViewMode === "table"
    ? currentRecords.length
    : Math.min(visibleRecordCount, currentRecords.length);
}

function updatePagination() {
  const bar = $("paginationBar");
  if (!bar) return;
  if (currentViewMode === "kanban") {
    bar.style.display = "none";
    return;
  }

  bar.style.display = "flex";
  $("pageStatus").textContent = loadingMoreRecords
    ? "Loading more..."
    : `Showing ${loadedRangeText()}`;
  const lazyHint = $("lazyHint");
  if (lazyHint) {
    const hasMoreLocalRows =
      currentViewMode === "kanban" && visibleRecordCount < currentRecords.length;
    lazyHint.textContent =
      nextRecordsUrl || hasMoreLocalRows ? "Scroll to load more" : "All loaded";
  }
}

function toggleSidebar() {
  $("sidebar").classList.toggle("open");
}

function toggleSidebarCompact() {
  const collapsed = document.body.classList.toggle("sidebar-collapsed");
  localStorage.setItem("sfmSidebarCollapsed", collapsed ? "true" : "false");
  const button = $("sidebarCollapseBtn");
  if (button) {
    button.title = collapsed ? "Expand sidebar" : "Collapse sidebar";
    button.setAttribute("aria-label", button.title);
  }
}

function closeSidebar() {
  $("sidebar").classList.remove("open");
}

async function handleGlobalSearch(value) {
  clearTimeout(globalTimer);
  globalTimer = setTimeout(async () => {
    const results = $("globalResults");
    const q = value.trim();
    if (!q) {
      results.classList.remove("open");
      results.innerHTML = "";
      return;
    }
    try {
      const data = await api(`/api/search/global?q=${encodeURIComponent(q)}`);
      renderGlobalResults(data.searchRecords || []);
    } catch (err) {
      results.innerHTML = `<div class="res-empty">${escapeHtml(err.message)}</div>`;
      results.classList.add("open");
    }
  }, 300);
}

function renderGlobalResults(records) {
  const results = $("globalResults");
  const allowedRecords = (records || []).filter((record) => {
    const type = record.attributes?.type || objectFromId(record.Id);
    return type === "User" || canReadObject(type);
  });
  const grouped = allowedRecords.reduce((acc, record) => {
    const type = record.attributes?.type || "Record";
    acc[type] = acc[type] || [];
    acc[type].push(record);
    return acc;
  }, {});
  const html = Object.entries(grouped)
    .map(
      ([name, groupRecords]) => `
    <div class="res-group">
      <div class="res-group-label">${escapeHtml(name)}</div>
      ${groupRecords
        .map(
          (record) => `
        <div class="res-item" onclick="openRecordDetail('${name}', '${record.Id}'); $('globalResults').classList.remove('open');">
          <div class="res-obj-icon">${objectIcon(name)}</div>
          <div>
            <button class="res-main result-link" onclick="event.stopPropagation(); openRecordDetail('${name}', '${record.Id}'); $('globalResults').classList.remove('open');">${escapeHtml(record.Name || record.Subject || record.CaseNumber || record.Id)}</button>
            <div class="res-sub">${escapeHtml(record.Email || record.Company || record.StageName || record.Status || "")}</div>
          </div>
        </div>
      `,
        )
        .join("")}
    </div>
  `,
    )
    .join("");
  results.innerHTML = html || '<div class="res-empty">No matches found</div>';
  results.classList.add("open");
}

function handleSearchKeydown(event) {
  if (event.key === "Escape") {
    $("globalResults").classList.remove("open");
    event.currentTarget.blur();
  }
}

function openCreate() {
  editingRecord = null;
  openRecordModal(`New ${currentObject}`, {}, null, currentObject);
}

async function openEdit(id) {
  const objectName = currentObject;
  const listRecord = currentRecords.find((record) => record.Id === id);
  editingRecord = listRecord || { Id: id };

  $("modalObjIcon").innerHTML = objectIcon(objectName);
  $("modalTitle").textContent = `Edit ${objectName}`;
  $("modalBody").innerHTML = `
    <div class="state-box compact">
      <div class="spinner-ring"><div></div><div></div><div></div><div></div></div>
      <p>Loading ${escapeHtml(objectName)}...</p>
    </div>
  `;
  $("modalOverlay").classList.add("open");

  try {
    const data = await api(`/api/${objectName}/${id}`);
    if (data.recordAccess?.accessLevel !== "edit") {
      closeModal();
      toast("You do not have the level of access necessary to perform the operation you requested.", "err");
      return;
    }
    editingRecord = data.record || editingRecord;
    await openRecordModal(
      `Edit ${objectName}`,
      editingRecord,
      data.fields || null,
      objectName,
    );
  } catch (err) {
    $("modalBody").innerHTML = `
      <div class="state-box compact error-state">
        <h3>Could not load record</h3>
        <p>${escapeHtml(err.message)}</p>
      </div>
    `;
  }
}

async function openRecordModal(
  title,
  record,
  fields = null,
  objectName = currentObject,
  options = {},
) {
  modalObject = objectName;
  modalPresetValues = options.presetValues || {};
  await loadLayoutForObject(objectName);
  const meta = OBJECT_META[objectName];
  $("modalObjIcon").innerHTML = objectIcon(objectName);
  $("modalTitle").textContent = title;
  const fullFields = fields || (await getEditableFields(record, objectName));
  const sections = getLayoutSections(objectName, fullFields);
  $("modalBody").innerHTML = sections.length
    ? renderFormSections(sections, record, objectName)
    : `<div class="form-grid">${fullFields.map((field) => renderFieldControl(field.name || field, record, field, objectName)).join("")}</div>`;
  appendPresetHiddenFields();
  $("modalOverlay").classList.add("open");
  setupDependentPicklists(fullFields);
}

async function getEditableFields(record, objectName = currentObject) {
  try {
    const [data] = await Promise.all([
      api(`/api/${objectName}/fields`),
      loadLayoutForObject(objectName)
    ]);
    const layoutSections = getLayoutSections(objectName, data.fields || []);
    if (layoutSections.length)
      return layoutSections.flatMap((section) => section.fields);

    const fields = data.fields
      .filter((field) => (editingRecord ? field.updateable : field.createable))
      .filter(
        (field) =>
          ![
            "Id",
            "IsDeleted",
            "CreatedDate",
            "CreatedById",
            "LastModifiedDate",
            "LastModifiedById",
            "SystemModstamp",
            "LastViewedDate",
            "LastReferencedDate",
          ].includes(field.name),
      )
      .filter((field) => field.type !== "address")
      .slice(0, 80);
    return fields.length
      ? fields
      : OBJECT_META[objectName].editable.map((name) => ({
          name,
          label: labelFor(name),
        }));
  } catch (err) {
    return OBJECT_META[objectName].editable.map((name) => ({
      name,
      label: labelFor(name),
    }));
  }
}

const COMPACT_LAYOUT_CACHE = {};

function getCustomCompactFields(objectName) {
  if (COMPACT_LAYOUT_CACHE[objectName]) {
    return COMPACT_LAYOUT_CACHE[objectName];
  }
  return (
    {
      Account: ["Type", "Industry", "Phone", "BillingCity"],
      Contact: ["Title", "Email", "Phone", "Account.Name"],
      Lead: ["Company", "Status", "Email", "Phone"],
      Opportunity: ["StageName", "Amount", "CloseDate", "Probability"],
      Case: ["Status", "Priority", "Type", "CreatedDate"],
      Campaign: ["Type", "Status", "StartDate", "EndDate"],
      User: ["Email", "Username", "Title"],
    }[objectName] ||
    OBJECT_META[objectName]?.columns ||
    []
  );
}

function getResolvedCompactFields(objectName, fields) {
  const allFields = fields || [];
  return getCustomCompactFields(objectName)
    .filter((field) => {
      const baseName = field.split(".")[0];
      return allFields.some(f => 
        f.name.toLowerCase() === baseName.toLowerCase() || 
        f.relationshipName?.toLowerCase() === baseName.toLowerCase() ||
        (f.name.toLowerCase().endsWith("id") && f.name.toLowerCase().slice(0, -2) === baseName.toLowerCase())
      );
    });
}

async function loadCompactLayoutForObject(objectName) {
  if (COMPACT_LAYOUT_CACHE[objectName]) {
    return COMPACT_LAYOUT_CACHE[objectName];
  }
  try {
    const res = await api(`/api/portal/compact-layouts/${objectName}`);
    if (res && res.fields) {
      COMPACT_LAYOUT_CACHE[objectName] = res.fields;
      return res.fields;
    }
  } catch (err) {
    console.warn(`Failed to fetch Supabase compact layout for ${objectName}:`, err);
  }
  return getCustomCompactFields(objectName);
}

const LAYOUT_CACHE = {};
const DB_LAYOUT_CACHE = {};

const RECORD_PAGE_CACHE = {};

function getDefaultRecordPageLayout() {
  return {
    layout: 'header-two-column',
    regions: {
      header: ['compact-layout'],
      left: ['related-lists', 'details'],
      right: ['activity', 'chatter'],
      bottom: []
    }
  };
}

async function loadRecordPageForObject(objectName) {
  if (RECORD_PAGE_CACHE[objectName]) {
    return RECORD_PAGE_CACHE[objectName];
  }
  try {
    const res = await api(`/api/portal/record-pages/${objectName}`);
    if (res && res.layout) {
      RECORD_PAGE_CACHE[objectName] = res.layout;
      return res.layout;
    }
  } catch (err) {
    console.warn(`Failed to fetch record page layout for ${objectName}:`, err);
  }

  const defaultPage = getDefaultRecordPageLayout();
  RECORD_PAGE_CACHE[objectName] = defaultPage;
  return defaultPage;
}

function normalizeLayoutData(layout) {
  if (!Array.isArray(layout)) return [];
  return layout.map(section => {
    const normalized = {
      title: section.title || "Information",
      columns: typeof section.columns === "number" ? section.columns : 2,
    };
    if (section.leftFields) {
      normalized.leftFields = [...section.leftFields];
      normalized.rightFields = section.rightFields ? [...section.rightFields] : [];
    } else if (section.fields) {
      normalized.leftFields = [];
      normalized.rightFields = [];
      if (normalized.columns === 2) {
        section.fields.forEach((f, idx) => {
          if (idx % 2 === 0) {
            normalized.leftFields.push(f);
          } else {
            normalized.rightFields.push(f);
          }
        });
      } else {
        normalized.leftFields = [...section.fields];
      }
    } else {
      normalized.leftFields = [];
      normalized.rightFields = [];
    }
    return normalized;
  });
}

async function loadLayoutForObject(objectName) {
  // Check memory cache of Supabase custom layout first
  if (DB_LAYOUT_CACHE[objectName]) {
    return DB_LAYOUT_CACHE[objectName];
  }

  try {
    // 1. Fetch user custom layout from Supabase
    const dbRes = await api(`/api/portal/layouts/${objectName}`);
    if (dbRes && dbRes.layout) {
      DB_LAYOUT_CACHE[objectName] = normalizeLayoutData(dbRes.layout);
      return DB_LAYOUT_CACHE[objectName];
    }
  } catch (err) {
    console.warn(`Failed to fetch Supabase custom layout for ${objectName}:`, err);
  }

  // 2. Fall back to Salesforce describe layout cache
  if (LAYOUT_CACHE[objectName]) {
    return LAYOUT_CACHE[objectName];
  }

  try {
    // 3. Fetch layout from Salesforce
    const res = await api(`/api/${objectName}/layouts`);
    if (res && res.layouts) {
      LAYOUT_CACHE[objectName] = normalizeLayoutData(res.layouts);
      return LAYOUT_CACHE[objectName];
    }
  } catch (err) {
    console.warn(`Failed to fetch Salesforce layout for ${objectName}, falling back to default.`, err);
  }

  LAYOUT_CACHE[objectName] = normalizeLayoutData(OBJECT_FIELD_LAYOUTS[objectName] || []);
  return LAYOUT_CACHE[objectName];
}

function getLayoutSections(objectName, fields = []) {
  // 1. Try Supabase custom layout from memory cache
  let layout = DB_LAYOUT_CACHE[objectName];
  // 2. Try Salesforce describe layout cache
  if (!layout) {
    layout = LAYOUT_CACHE[objectName];
  }
  // 3. Try hardcoded default layout
  if (!layout) {
    layout = OBJECT_FIELD_LAYOUTS[objectName];
  }
  if (!layout) return [];

  // Normalize layout to have columns, leftFields, rightFields
  layout = normalizeLayoutData(layout);

  const fieldList = (fields || []).map((field) =>
    typeof field === "string" ? { name: field, label: labelFor(field) } : field,
  );
  
  const resolved = layout
    .map((section) => {
      const leftResolved = (section.leftFields || [])
        .map((entry) => resolveLayoutField(entry, fieldList))
        .filter(Boolean);
      const rightResolved = (section.rightFields || [])
        .map((entry) => resolveLayoutField(entry, fieldList))
        .filter(Boolean);
      return {
        title: section.title,
        columns: section.columns || 2,
        leftFields: leftResolved,
        rightFields: rightResolved,
        fields: [...leftResolved, ...rightResolved],
      };
    })
    .filter((section) => section.leftFields.length || section.rightFields.length);
  return resolved;
}

function resolveLayoutField(entry, fields) {
  const config = typeof entry === "string" ? { name: entry } : entry;
  const field = findLayoutField(config.name, fields);
  if (!field) return null;
  return {
    ...field,
    readOnly: Boolean(config.readOnly),
    required: Boolean(config.required),
    layoutLabel: config.label || getAddressFieldLabel(config.name, field),
  };
}

function findLayoutField(name, fields) {
  const addressCodeName = getAddressCodeFieldName(name, fields);
  if (addressCodeName)
    return fields.find((item) => item.name === addressCodeName);

  const wanted = normalizeFieldKey(name);
  return fields.find((item) => {
    const aliases = [
      item.name,
      item.label,
      item.name?.replace(/Id$/, ""),
      labelFor(item.name || ""),
    ].map(normalizeFieldKey);
    return aliases.includes(wanted);
  });
}

function getAddressCodeFieldName(name, fields) {
  const text = String(name || "");
  const match = text.match(/^(.*?)(Country|State)$/);
  if (!match || text.endsWith("Code")) return "";
  const codeName = `${match[1]}${match[2]}Code`;
  const codeField = fields.find((field) => field.name === codeName);
  return codeField && codeField.type === "picklist" ? codeName : "";
}

function getAddressFieldLabel(layoutName, field) {
  const text = String(layoutName || "");
  if (field?.name?.endsWith("CountryCode"))
    return labelFor(text.replace(/Country$/, "Country"));
  if (field?.name?.endsWith("StateCode"))
    return labelFor(text.replace(/State$/, "State/Province"));
  return "";
}

function normalizeFieldKey(value = "") {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function renderFormSections(sections, record, objectName = currentObject) {
  return sections
    .map(
      (section) => `
    <section class="form-section" style="margin-bottom: 24px;">
      <div class="form-section-title" style="margin-bottom: 12px; font-weight: 700; font-size: 14px; color: var(--text-1, #1e293b); display: flex; align-items: center; gap: 8px;">
        ${utilityIconSvg("chevronDown")}<span>${escapeHtml(section.title)}</span>
      </div>
      <div class="form-grid-container">
        ${section.columns === 1 
          ? `<div class="form-grid-col-1" style="display: flex; flex-direction: column; gap: 14px;">
               ${(section.leftFields || []).map((field) => renderFieldControl(field.name, record, field, objectName)).join("")}
             </div>`
          : `<div class="form-grid-col-2" style="display: grid; grid-template-columns: 1fr 1fr; gap: 14px 20px;">
               <div style="display: flex; flex-direction: column; gap: 14px;">
                 ${(section.leftFields || []).map((field) => renderFieldControl(field.name, record, field, objectName)).join("")}
               </div>
               <div style="display: flex; flex-direction: column; gap: 14px;">
                 ${(section.rightFields || []).map((field) => renderFieldControl(field.name, record, field, objectName)).join("")}
               </div>
             </div>`
        }
      </div>
    </section>
  `,
    )
    .join("");
}

function renderFieldControl(
  field,
  record,
  fieldMeta = {},
  objectName = currentObject,
) {
  fieldMeta =
    typeof fieldMeta === "string"
      ? { name: field, label: labelFor(field) }
      : fieldMeta;
  const lookup =
    OBJECT_META[objectName].lookups?.[field] ||
    (fieldMeta.referenceTo?.length
      ? {
          object: fieldMeta.referenceTo[0],
          label: fieldMeta.label || labelFor(field),
        }
      : null);
  const label =
    fieldMeta.layoutLabel ||
    fieldMeta.label ||
    lookup?.label ||
    labelFor(field);
  const type = fieldMeta.type || "string";
  const value = record[field] ?? getDefaultFieldValue(field, fieldMeta, type);
  const isRequired = fieldMeta.required || fieldMeta.nillable === false;
  const required = isRequired ? '<span class="form-req">*</span>' : "";
  const spanClass = shouldSpanField(field, type) ? "span-2" : "";
  const readOnly =
    Boolean(fieldMeta.readOnly) ||
    Boolean(fieldMeta.fieldSecurityReadOnly) ||
    (editingRecord && fieldMeta.updateable === false) ||
    (!editingRecord && fieldMeta.createable === false);
  const disabled = readOnly ? 'disabled data-readonly="true"' : "";
  const readonlyClass = readOnly ? " readonly-field" : "";

  if (lookup) {
    const displayValue = getLookupDisplayValue(field, record, fieldMeta);
    return `
      <div class="form-group${readonlyClass}">
        <label class="form-label" for="field-${field}-search">${escapeHtml(label)}${required}</label>
        <div class="lookup-wrap">
          <input class="form-ctrl" id="field-${field}-search" value="${escapeHtml(displayValue)}"
                 placeholder="Search ${escapeHtml(lookup.object)}..." autocomplete="off"
                 oninput="lookupSearch('${field}', '${lookup.object}', this.value)" ${disabled}>
          <input type="hidden" id="field-${field}" name="${field}" value="${escapeHtml(record[field] || "")}" ${disabled}>
          <div class="lookup-results" id="lookup-${field}"></div>
        </div>
      </div>
    `;
  }

  if (type === "picklist") {
    return `
      <div class="form-group ${spanClass}${readonlyClass}">
        <label class="form-label" for="field-${field}">${escapeHtml(label)}${required}</label>
        <select class="form-ctrl" id="field-${field}" name="${field}" ${dependentPicklistAttrs(fieldMeta)} ${disabled}>
          <option value=""></option>
          ${renderPicklistOptions(fieldMeta.picklistValues, value)}
        </select>
      </div>
    `;
  }

  if (type === "multipicklist") {
    const selectedValues = String(value || "")
      .split(";")
      .filter(Boolean);
    return `
      <div class="form-group ${spanClass}${readonlyClass}">
        <label class="form-label" for="field-${field}">${escapeHtml(label)}${required}</label>
        <select class="form-ctrl multi-select" id="field-${field}" name="${field}" multiple ${disabled}>
          ${renderPicklistOptions(fieldMeta.picklistValues, selectedValues)}
        </select>
      </div>
    `;
  }

  if (
    type === "textarea" ||
    type === "encryptedtextarea" ||
    type === "address"
  ) {
    return `
      <div class="form-group span-2${readonlyClass}">
        <label class="form-label" for="field-${field}">${escapeHtml(label)}${required}</label>
        <textarea class="form-ctrl" id="field-${field}" name="${field}" ${disabled}>${escapeHtml(formatEditableValue(value, type))}</textarea>
      </div>
    `;
  }

  if (type === "boolean") {
    return `
      <div class="form-group ${spanClass}${readonlyClass}">
        <label class="check-item form-check">
          <input type="checkbox" id="field-${field}" name="${field}" ${value ? "checked" : ""} ${disabled}>
          <span>${escapeHtml(label)}${required}</span>
        </label>
      </div>
    `;
  }

  const inputType =
    {
      date: "date",
      datetime: "datetime-local",
      time: "time",
      int: "number",
      double: "number",
      currency: "number",
      percent: "number",
      email: "email",
      phone: "tel",
      url: "url",
    }[type] || "text";

  return `
    <div class="form-group ${spanClass}${readonlyClass}">
      <label class="form-label" for="field-${field}">${escapeHtml(label)}${required}</label>
      <input class="form-ctrl" id="field-${field}" name="${field}" type="${inputType}" value="${escapeHtml(formatEditableValue(value, type))}" ${disabled}>
    </div>
  `;
}

function appendPresetHiddenFields() {
  const entries = Object.entries(modalPresetValues || {}).filter(
    ([, value]) => {
      if (value === null || value === undefined || value === "") return false;
      return ["string", "number", "boolean"].includes(typeof value);
    },
  );
  if (!entries.length) return;
  const wrapper = document.createElement("div");
  wrapper.hidden = true;
  const existingNames = new Set(
    [...$("modalBody").querySelectorAll("[name]")].map((input) => input.name),
  );
  entries.forEach(([field, value]) => {
    if (existingNames.has(field)) return;
    const input = document.createElement("input");
    input.type = "hidden";
    input.name = field;
    input.value = value;
    wrapper.appendChild(input);
  });
  if (wrapper.children.length) $("modalBody").appendChild(wrapper);
}

function renderPicklistOptions(values = [], selected) {
  const selectedSet = Array.isArray(selected)
    ? new Set(selected.map(String))
    : new Set([String(selected || "")]);
  return (values || [])
    .map((item) => {
      const value = typeof item === "object" ? item.value : item;
      const label = typeof item === "object" ? item.label || item.value : item;
      const validFor = typeof item === "object" ? item.validFor || "" : "";
      return `
    <option value="${escapeHtml(value)}" data-valid-for="${escapeHtml(validFor)}" ${selectedSet.has(String(value)) ? "selected" : ""}>${escapeHtml(label)}</option>
  `;
    })
    .join("");
}

function dependentPicklistAttrs(fieldMeta = {}) {
  const controllerName = getPicklistControllerName(fieldMeta);
  if (!controllerName) return "";
  return `data-controller="${escapeHtml(controllerName)}" data-controller-values="${escapeHtml(JSON.stringify(fieldMeta.controllerValues || {}))}"`;
}

function getPicklistControllerName(fieldMeta = {}) {
  if (fieldMeta.controllerName) return fieldMeta.controllerName;
  if (fieldMeta.name?.endsWith("StateCode"))
    return fieldMeta.name.replace(/StateCode$/, "CountryCode");
  return "";
}

function setupDependentPicklists(fields = []) {
  const fieldList = flattenFormFields(fields);
  const dependents = fieldList.filter((field) =>
    getPicklistControllerName(field),
  );
  dependents.forEach((field) => {
    const controllerName = getPicklistControllerName(field);
    const controller = $(`field-${controllerName}`);
    const dependent = $(`field-${field.name}`);
    if (!controller || !dependent) return;
    controller.addEventListener("change", () =>
      filterDependentPicklist(dependent, controller.value),
    );
    filterDependentPicklist(dependent, controller.value);
  });
}

function flattenFormFields(fields = []) {
  return (fields || []).flatMap((item) =>
    item?.fields ? item.fields : [item],
  );
}

function filterDependentPicklist(select, controllerValue) {
  const controllerValues = JSON.parse(select.dataset.controllerValues || "{}");
  const controllerIndex = controllerValues[controllerValue];
  let selectedStillVisible = !select.value;

  [...select.options].forEach((option) => {
    if (!option.value) {
      option.hidden = false;
      return;
    }
    const validFor = option.dataset.validFor || "";
    const visible =
      controllerIndex === undefined ||
      !validFor ||
      isValidForController(validFor, controllerIndex);
    option.hidden = !visible;
    if (visible && option.value === select.value) selectedStillVisible = true;
  });

  if (!selectedStillVisible) select.value = "";
}

function isValidForController(validFor, index) {
  const bytes = atob(validFor);
  const byte = bytes.charCodeAt(Math.floor(index / 8));
  return Boolean(byte & (0x80 >> (index % 8)));
}

function getDefaultFieldValue(field, fieldMeta, type) {
  if (editingRecord || type !== "picklist" || !field.endsWith("CountryCode"))
    return "";
  const country = (fieldMeta.picklistValues || []).find((item) => {
    const value = typeof item === "object" ? item.value : item;
    const label = typeof item === "object" ? item.label : item;
    return value === "US" || String(label).toLowerCase() === "united states";
  });
  return typeof country === "object" ? country.value : country || "";
}

function shouldSpanField(field, type) {
  return (
    ["Description", "Website"].includes(field) ||
    ["textarea", "encryptedtextarea", "multipicklist", "address"].includes(type)
  );
}

function getLookupDisplayValue(field, record = {}, fieldMeta = {}) {
  const lookup = detailLookupLabels[field];
  if (lookup?.name && (!lookup.id || lookup.id === record[field]))
    return lookup.name;

  const relationshipName =
    fieldMeta.relationshipName || field.replace(/Id$/, "");
  return (
    getValue(record, `${relationshipName}.Name`) ||
    getValue(record, field.replace(/Id$/, ".Name")) ||
    ""
  );
}

function formatEditableValue(value, type) {
  if (value === null || value === undefined) return "";
  if (type === "date") return String(value).slice(0, 10);
  if (type === "datetime") return String(value).slice(0, 16);
  if (type === "address") return formatAddress(value).replace(/<br>/g, "\n");
  return String(value);
}

function lookupSearch(field, objectName, value) {
  clearTimeout(lookupTimer);
  lookupTimer = setTimeout(async () => {
    const box = $(`lookup-${field}`);
    if (!value.trim()) {
      box.classList.remove("open");
      box.innerHTML = "";
      $(`field-${field}`).value = "";
      return;
    }
    try {
      const data = await api(
        `/api/lookup/${objectName}?search=${encodeURIComponent(value)}`,
      );
      box.innerHTML =
        (data.records || [])
          .map(
            (record) => `
        <button type="button" class="lookup-item" onclick="selectLookup('${field}', '${record.Id}', '${encodeURIComponent(record.Name)}')">
          <span>${escapeHtml(record.Name)}</span>
          <small>${record.Id}</small>
        </button>
      `,
          )
          .join("") || '<div class="lookup-empty">No matches</div>';
      box.classList.add("open");
    } catch (err) {
      box.innerHTML = `<div class="lookup-empty">${escapeHtml(err.message)}</div>`;
      box.classList.add("open");
    }
  }, 250);
}

function selectLookup(field, id, name) {
  $(`field-${field}`).value = id;
  $(`field-${field}-search`).value = decodeURIComponent(name);
  $(`lookup-${field}`).classList.remove("open");
}

function closeModal() {
  if (savingRecord) return;
  $("modalOverlay").classList.remove("open");
  modalObject = null;
  modalPresetValues = {};
}

const CRM_COMPONENT_CACHE = new Map();

async function preloadCrmComponent(name) {
  if (CRM_COMPONENT_CACHE.has(name)) return CRM_COMPONENT_CACHE.get(name);
  try {
    const mod = await import(`/components/${name}/component.js`);
    const comp = mod.default || mod;
    CRM_COMPONENT_CACHE.set(name, comp);
    return comp;
  } catch (err) {
    console.error(`Failed to load component ${name}:`, err);
    const fallback = {
      render(config, context) {
        return `<div class="error-state compact"><p>Component "${name}" failed to load.</p></div>`;
      }
    };
    CRM_COMPONENT_CACHE.set(name, fallback);
    return fallback;
  }
}

function componentNamesForRecordPage(pageConfig) {
  const names = new Set(['compact-layout', 'details']);
  const regions = pageConfig?.regions || {};
  Object.keys(regions).forEach((region) => {
    (regions[region] || []).forEach((component) => {
      if (typeof component === 'string') names.add(component);
      else if (component?.name) names.add(component.name);
    });
  });
  return names;
}

async function loadRecordDetailData(objectName, id) {
  const cached = getRecentRecordCache(objectName, id);
  if (cached?.data) {
    applyCachedRecordLayouts(cached);
    return cached.data;
  }

  const key = recentRecordCacheKey(objectName, id);
  if (recordDetailInflight.has(key)) {
    return cloneCacheValue(await recordDetailInflight.get(key));
  }

  const promise = api(`/api/${objectName}/${id}`)
    .finally(() => recordDetailInflight.delete(key));
  recordDetailInflight.set(key, promise);
  return cloneCacheValue(await promise);
}

async function loadRecordLayoutBundle(objectName) {
  const [layout, compactLayout, recordPage] = await Promise.all([
    loadLayoutForObject(objectName),
    loadCompactLayoutForObject(objectName),
    loadRecordPageForObject(objectName)
  ]);
  return { objectName, layout, compactLayout, recordPage };
}

function buildRecordDetailViewModel(objectName, id, data) {
  const record = data.record || {};
  const fields = data.fields || [];
  detailLookupLabels = data.lookupLabels || {};
  const title = record.Name || record.Subject || record.CaseNumber || record.Email || id;
  const displayFields = fields
    .filter(
      (field) =>
        record[field.name] !== null &&
        record[field.name] !== undefined &&
        field.name !== "attributes",
    )
    .slice(0, 80);

  return { record, fields, title, displayFields };
}

async function renderRecordDetailFromData(objectName, id, data) {
  const { record, fields, title, displayFields } = buildRecordDetailViewModel(objectName, id, data);
  const pageConfig = RECORD_PAGE_CACHE[objectName] || getDefaultRecordPageLayout();
  await Promise.all(Array.from(componentNamesForRecordPage(pageConfig)).map(name => preloadCrmComponent(name)));

  currentObject = objectName;
  detailRecordState = {
    objectName,
    id,
    record,
    fields,
    recordAccess: data.recordAccess || { allowed: true, accessLevel: "read" },
  };
  setActiveNavObject(objectName);
  renderRecordDetailPage(objectName, record, fields, displayFields, title, id);
  captureCrmPageState(objectName);
  return { record, fields };
}

function loadRecordSecondaryComponents(objectName, id, record) {
  if (detailRecordState?.objectName !== objectName || detailRecordState?.id !== id) return;
  const hasRelated = document.querySelector('.record-related-card') ||
    document.querySelector('.record-related-card-container') ||
    document.querySelector('[id^="relatedList-"]');
  const hasActivity = document.getElementById('activityTimeline');
  const hasChatter = document.getElementById('chatterFeed');

  if (hasRelated) {
    loadRelatedRecords(objectName, id).catch((err) => console.warn("Related records load failed:", err.message || err));
    if (objectName === "Campaign") {
      activeCampaign = record;
      loadCampaignMembers(id).catch((err) => console.warn("Campaign members load failed:", err.message || err));
    }
  }
  if (hasActivity) {
    loadRecordActivity(objectName, id).catch((err) => console.warn("Activity load failed:", err.message || err));
  }
  if (hasChatter) {
    setTimeout(() => {
      if (detailRecordState?.objectName === objectName && detailRecordState?.id === id) {
        loadChatterFeed().catch((err) => console.warn("Chatter load failed:", err.message || err));
      }
    }, 0);
  }
}

async function openRecordDetail(objectName, id, options = {}) {
  if (!id || !OBJECT_META[objectName]) return;
  markCachedSelectedRecord(id);
  if (!canReadObject(objectName)) {
    toast(`You do not have access to ${OBJECT_META[objectName]?.title || objectName}.`, "err");
    return;
  }

  try {
    captureCrmPageState(currentObject);
    if (!options.preserveHistory && !restoringCrmHistory) {
      writeRecordHistory(objectName, id);
    }
    viewingDetail = true;

    const cached = getRecentRecordCache(objectName, id);
    if (!cached?.data) {
      $("content").innerHTML = `
        <div class="state-box">
          <div class="spinner-ring"><div></div><div></div><div></div><div></div></div>
          <p>Loading record detail...</p>
        </div>
      `;
    }
    if (cached) applyCachedRecordLayouts(cached);
    const recordPromise = cached?.data
      ? Promise.resolve(cached.data)
      : loadRecordDetailData(objectName, id);
    const layoutPromise = loadRecordLayoutBundle(objectName);

    const data = await recordPromise;
    const rendered = await renderRecordDetailFromData(objectName, id, data);
    setRecentRecordCache(objectName, id, {
      data,
      layouts: {
        objectName,
        layout: DB_LAYOUT_CACHE[objectName] || LAYOUT_CACHE[objectName] || null,
        compactLayout: COMPACT_LAYOUT_CACHE[objectName] || null,
        recordPage: RECORD_PAGE_CACHE[objectName] || null
      }
    });

    layoutPromise
      .then(async (layouts) => {
        if (detailRecordState?.objectName !== objectName || detailRecordState?.id !== id) return;
        applyCachedRecordLayouts({ layouts });
        setRecentRecordCache(objectName, id, { data, layouts });
        await renderRecordDetailFromData(objectName, id, data);
        loadRecordSecondaryComponents(objectName, id, rendered.record);
      })
      .catch((err) => {
        console.warn("Record layout load failed:", err.message || err);
        setRecentRecordCache(objectName, id, { data });
        loadRecordSecondaryComponents(objectName, id, rendered.record);
      });
  } catch (err) {
    $("content").innerHTML = `
      <div class="state-box error-state">
        <h3>Could not load record</h3>
        <p>${escapeHtml(err.message)}</p>
        <button class="btn btn-ghost" onclick="backToCurrentList()">Back to List</button>
      </div>
    `;
  }
}

function renderRecordDetailPage(
  objectName,
  record,
  fields,
  displayFields,
  title,
  id,
) {
  const summaryFields = getResolvedCompactFields(objectName, fields);
  const canEditThisRecord = currentDetailCanEdit();

  const pageConfig = RECORD_PAGE_CACHE[objectName] || {
    layout: 'header-two-column',
    regions: {
      header: ['compact-layout'],
      left: ['related-lists', 'details'],
      right: ['activity', 'chatter'],
      bottom: []
    }
  };

  const resolveComponent = (c) => {
    if (typeof c === 'string') {
      return { name: c, title: '', collapsed: false, visible: true };
    }
    return {
      name: c.name,
      title: c.title || '',
      collapsed: !!c.collapsed,
      visible: c.visible !== false,
      config: c.config || null
    };
  };

  const renderSingleComponent = (comp, isTabbedChild = false) => {
    const compInstance = CRM_COMPONENT_CACHE.get(comp.name);
    if (compInstance) {
      const renderContext = {
        escapeHtml,
        labelFor,
        getValue,
        formatValue,
        record,
        fields,
        displayFields,
        summaryFields,
        objectName,
        id,
        isTabbedChild,
        utilityIconSvg,
        objectIcon,
        canDo,
        currentDetailCanEdit,
        getRelatedListConfigs,
        renderRelatedListShell,
        renderConfiguredDetailSections,
        renderChatterPanel,
        renderRelatedPanel
      };

      const contentHtml = compInstance.render(comp, renderContext);

      if (isTabbedChild) {
        return contentHtml;
      }

      const compLabel = {
        'compact-layout': 'Compact Layout',
        'details': 'Details',
        'related-lists': 'Related Lists',
        'activity': 'Activity',
        'chatter': 'Chatter',
        'related-list-single': 'Related List'
      }[comp.name] || comp.name;

      const compTitle = comp.title || (comp.config && comp.config.title) || compLabel;

      if (comp.name === 'compact-layout') {
        return `
          <div class="record-hero card" style="margin-bottom: 16px; border: 1px solid var(--border); border-radius: var(--r-md); background: var(--surface); box-shadow: var(--shadow-sm); overflow: hidden;">
            ${contentHtml}
          </div>
        `;
      }

      return `
        <div class="card record-${comp.name}-card" style="background: var(--surface); border: 1px solid var(--border); border-radius: var(--r-md); box-shadow: var(--shadow-sm); overflow: hidden; margin-bottom: 16px;">
          ${contentHtml}
        </div>
      `;
    }

    return `<div class="error-state"><p>Component ${comp.name} not found.</p></div>`;
  };

  const renderRegionComponents = (regionName) => {
    const components = pageConfig.regions[regionName] || [];
    const resolved = components.map(c => resolveComponent(c)).filter(c => c.visible);

    if (resolved.length === 0) return '';

    const hasRelatedLists = resolved.some(c => c.name === 'related-lists');
    const hasDetails = resolved.some(c => c.name === 'details');
    const groupLeftTabs = hasRelatedLists && hasDetails;

    const hasActivity = resolved.some(c => c.name === 'activity');
    const hasChatter = resolved.some(c => c.name === 'chatter');
    const groupRightTabs = hasActivity && hasChatter;

    const itemsToRender = [];
    let i = 0;
    while (i < resolved.length) {
      const comp = resolved[i];
      if (groupLeftTabs && (comp.name === 'related-lists' || comp.name === 'details')) {
        const otherName = comp.name === 'related-lists' ? 'details' : 'related-lists';
        const otherIdx = resolved.findIndex((c, idx) => idx > i && c.name === otherName);
        if (otherIdx !== -1) {
          const otherComp = resolved[otherIdx];
          itemsToRender.push({
            type: 'tab-container',
            components: [comp, otherComp],
            originalIndices: [i, otherIdx]
          });
          resolved.splice(otherIdx, 1);
          i++;
          continue;
        }
      }
      
      if (groupRightTabs && (comp.name === 'activity' || comp.name === 'chatter')) {
        const otherName = comp.name === 'activity' ? 'chatter' : 'activity';
        const otherIdx = resolved.findIndex((c, idx) => idx > i && c.name === otherName);
        if (otherIdx !== -1) {
          const otherComp = resolved[otherIdx];
          itemsToRender.push({
            type: 'tab-container',
            components: [comp, otherComp],
            originalIndices: [i, otherIdx]
          });
          resolved.splice(otherIdx, 1);
          i++;
          continue;
        }
      }

      itemsToRender.push({
        type: 'single',
        component: comp,
        index: i
      });
      i++;
    }

    return itemsToRender.map((item, itemIdx) => {
      if (item.type === 'tab-container') {
        const headersHtml = item.components.map((comp, idx) => {
          const compLabel = {
            'related-lists': 'Related',
            'details': 'Details',
            'activity': 'Activity',
            'chatter': 'Chatter'
          }[comp.name] || comp.name;

          const activeClass = idx === 0 ? 'active' : '';
          const borderStyle = idx === 0 
            ? 'border-bottom: 3px solid var(--accent); color: var(--accent); font-weight: 700;' 
            : 'border-bottom: 3px solid transparent; color: var(--text-2);';

          return `
            <li class="custom-tab-header ${activeClass}" 
                data-region="${regionName}" 
                data-index="${itemIdx}-${idx}" 
                onclick="switchCustomTab('${regionName}', '${itemIdx}-${idx}')" 
                style="padding: 10px 4px; font-size: 13.5px; font-weight: 600; cursor: pointer; transition: all 0.2s; ${borderStyle}">
              ${escapeHtml(compLabel)}
            </li>
          `;
        }).join('');

        const contentsHtml = item.components.map((comp, idx) => {
          const displayStyle = idx === 0 ? 'display: block;' : 'display: none;';
          const componentHtml = renderSingleComponent(comp, true);

          return `
            <div class="custom-tab-content-${regionName}-${itemIdx}" id="tab-content-${regionName}-${itemIdx}-${idx}" data-mount-id="comp-mount-${regionName}-${item.originalIndices[idx]}" style="${displayStyle}">
              ${componentHtml}
            </div>
          `;
        }).join('');

        return `
          <div class="card custom-tab-container" style="background: var(--surface); border: 1px solid var(--border); border-radius: var(--r-md); box-shadow: var(--shadow-sm); overflow: hidden; margin-bottom: 16px;">
            <ul class="custom-tab-nav" style="display: flex; gap: 24px; border-bottom: 1px solid var(--border); margin: 0; padding: 0 20px; list-style: none; background: transparent;">
              ${headersHtml}
            </ul>
            <div class="custom-tab-contents" style="padding: 20px;">
              ${contentsHtml}
            </div>
          </div>
        `;
      } else {
        return `
          <div id="comp-container-${regionName}-${item.index}" data-mount-id="comp-mount-${regionName}-${item.index}">
            ${renderSingleComponent(item.component, false)}
          </div>
        `;
      }
    }).join('');
  };

  let layoutHtml = '';
  if (pageConfig.layout === 'one-column') {
    layoutHtml = `
      <div class="record-layout-one-column" style="display: flex; flex-direction: column; gap: 16px;">
        ${renderRegionComponents('main')}
      </div>
    `;
  } else if (pageConfig.layout === 'two-column') {
    layoutHtml = `
      <div class="record-layout-two-column" style="display: grid; grid-template-columns: minmax(0, 2fr) minmax(280px, 1fr); gap: 16px;">
        <div class="record-layout-left" style="display: flex; flex-direction: column; gap: 16px;">
          ${renderRegionComponents('left')}
        </div>
        <div class="record-layout-right" style="display: flex; flex-direction: column; gap: 16px;">
          ${renderRegionComponents('right')}
        </div>
      </div>
    `;
  } else if (pageConfig.layout === 'header-two-column') {
    layoutHtml = `
      <div class="record-layout-header-two-column" style="display: flex; flex-direction: column; gap: 16px;">
        <div class="record-layout-header" style="display: flex; flex-direction: column; gap: 16px;">
          ${renderRegionComponents('header')}
        </div>
        <div class="record-layout-two-column-grid" style="display: grid; grid-template-columns: minmax(0, 2fr) minmax(280px, 1fr); gap: 16px;">
          <div class="record-layout-left" style="display: flex; flex-direction: column; gap: 16px;">
            ${renderRegionComponents('left')}
          </div>
          <div class="record-layout-right" style="display: flex; flex-direction: column; gap: 16px;">
            ${renderRegionComponents('right')}
          </div>
        </div>
      </div>
    `;
  } else {
    // header-two-column-bottom
    layoutHtml = `
      <div class="record-layout-header-two-column-bottom" style="display: flex; flex-direction: column; gap: 16px;">
        <div class="record-layout-header" style="display: flex; flex-direction: column; gap: 16px;">
          ${renderRegionComponents('header')}
        </div>
        <div class="record-layout-two-column-grid" style="display: grid; grid-template-columns: minmax(0, 2fr) minmax(280px, 1fr); gap: 16px;">
          <div class="record-layout-left" style="display: flex; flex-direction: column; gap: 16px;">
            ${renderRegionComponents('left')}
          </div>
          <div class="record-layout-right" style="display: flex; flex-direction: column; gap: 16px;">
            ${renderRegionComponents('right')}
          </div>
        </div>
        <div class="record-layout-bottom" style="display: flex; flex-direction: column; gap: 16px;">
          ${renderRegionComponents('bottom')}
        </div>
      </div>
    `;
  }

  $("content").innerHTML = `
    <div class="record-page">
      <div class="record-hero">
        <div class="record-title-row">
          <div class="page-title-group">
            <div class="page-icon">${objectIcon(objectName, record)}</div>
            <div>
              <div class="record-kicker">${escapeHtml(objectName)}</div>
              <h1 class="page-title">${escapeHtml(title)}</h1>
            </div>
          </div>
          <div class="page-actions" style="display: flex; gap: 8px; align-items: center;">
            <button class="btn btn-ghost" onclick="backToCurrentList()">Back</button>
            <button class="btn btn-primary" onclick="editCurrentDetailRecord()">Edit</button>
          </div>
        </div>
      </div>

      <div class="record-layout-container">
        ${layoutHtml}
      </div>
    </div>
  `;
  applyPermissionGuards(objectName);

  // Trigger mount lifecycle on all preloaded components
  if (pageConfig && pageConfig.regions) {
    Object.keys(pageConfig.regions).forEach(r => {
      const comps = pageConfig.regions[r] || [];
      const resolvedCount = comps.map(c => typeof c === 'string' ? { name: c, visible: true } : c).filter(c => c.visible !== false).length;
      const isTabbed = (r === 'left' || r === 'right' || r === 'main' || r === 'bottom') && resolvedCount > 1;
      
      comps.forEach((c, idx) => {
        const comp = typeof c === 'string' ? { name: c } : c;
        const compInstance = CRM_COMPONENT_CACHE.get(comp.name);
        if (compInstance && typeof compInstance.mount === 'function') {
          const container = document.querySelector(`[data-mount-id="comp-mount-${r}-${idx}"]`) || document.getElementById(isTabbed ? `tab-content-${r}-${idx}` : `comp-container-${r}-${idx}`);
          if (container) {
            compInstance.mount(container, comp, { objectName, id });
          }
        }
      });
    });
  }
}

function toggleCardCollapse(btnEl) {
  const card = btnEl.closest('.card');
  if (!card) return;
  const body = card.querySelector('.card-body') || card.querySelector('.record-summary');
  if (!body) return;
  const isHidden = body.style.display === 'none';
  body.style.display = isHidden ? '' : 'none';
  btnEl.style.transform = isHidden ? 'none' : 'rotate(-90deg)';
}

function showSideTab(name) {
  if ($("sideActivityPanel")) $("sideActivityPanel").style.display = name === "activity" ? "block" : "none";
  if ($("sideChatterPanel")) $("sideChatterPanel").style.display = name === "chatter" ? "block" : "none";
  if ($("sideActivityBtn")) $("sideActivityBtn").classList.toggle("active", name === "activity");
  if ($("sideChatterBtn")) $("sideChatterBtn").classList.toggle("active", name === "chatter");
  if (
    name === "chatter" &&
    detailRecordState?.id &&
    chatterState.loadedFor !== detailRecordState.id
  ) {
    loadChatterFeed();
  }
  captureCrmPageState(currentObject);
}

function renderConfiguredDetailSections(
  objectName,
  record,
  fields,
  fallbackFields,
) {
  const sections = getLayoutSections(objectName, fields);
  if (!sections.length) {
    return `<div class="detail-grid">${fallbackFields.map((field) => renderDetailField(objectName, record, field)).join("")}</div>`;
  }

  return sections
    .map(
      (section) => `
    <section class="detail-section">
      <div class="detail-section-title" style="cursor: pointer; user-select: none;" onclick="toggleDetailSection(this)">
        ${utilityIconSvg("chevronDown")}<span>${escapeHtml(section.title)}</span>
      </div>
      <div class="detail-grid-container">
        ${section.columns === 1 
          ? `<div class="detail-grid cols-1">
               ${(section.leftFields || []).map((field) => renderDetailField(objectName, record, field)).join("")}
             </div>`
          : `<div class="detail-grid cols-2">
               <div class="detail-column-side">
                 ${(section.leftFields || []).map((field) => renderDetailField(objectName, record, field)).join("")}
               </div>
               <div class="detail-column-side">
                 ${(section.rightFields || []).map((field) => renderDetailField(objectName, record, field)).join("")}
               </div>
             </div>`
        }
      </div>
    </section>
  `,
    )
    .join("");
}

function toggleDetailSection(titleEl) {
  const section = titleEl.closest(".detail-section");
  if (!section) return;
  const container = section.querySelector(".detail-grid-container");
  const svg = titleEl.querySelector("svg");
  const isCollapsed = section.classList.toggle("collapsed");
  if (isCollapsed) {
    if (container) container.style.display = "none";
    if (svg) svg.style.transform = "rotate(-90deg)";
  } else {
    if (container) container.style.display = "";
    if (svg) svg.style.transform = "";
  }
}

function getSummaryFields(objectName) {
  return (
    {
      Account: ["Type", "Industry", "Phone", "BillingCity"],
      Contact: ["Title", "Email", "Phone", "Account.Name"],
      Lead: ["Company", "Status", "Email", "Phone"],
      Opportunity: ["StageName", "Amount", "CloseDate", "Probability"],
      Case: ["Status", "Priority", "Type", "CreatedDate"],
      Campaign: ["Type", "Status", "StartDate", "EndDate"],
      User: ["Email", "Username", "Title"],
    }[objectName] ||
    OBJECT_META[objectName]?.columns ||
    []
  );
}

function renderRelatedPanel(objectName, comp = null) {
  let configs = [];
  if (comp && comp.relatedLists && comp.relatedLists.length > 0) {
    configs = comp.relatedLists.filter(c => c && c.enabled);
  } else {
    configs = getRelatedListConfigs(objectName);
  }

  const canShowCampaignMembers = objectName === "Campaign" && canReadObject("Campaign");
  if (!configs.length && !canShowCampaignMembers) {
    return `
      <div class="related-panel no-margin">
        <div class="related-head">
          <div>
            <h3>Related Records</h3>
            <p>Open related records from lookup links in Details.</p>
          </div>
        </div>
        <div class="table-empty">
          <h3>No related records.</h3>
        </div>
      </div>
    `;
  }

  return `
    ${configs.map((config, index) => renderRelatedListShell(config, index === 0)).join("")}
    ${canShowCampaignMembers ? renderCampaignMembersShell(!configs.length) : ""}
  `;
}

function getRelatedListConfigs(objectName) {
  const configs =
    {
      Account: [
        {
          key: "contacts",
          objectName: "Contact",
          title: "Contacts",
          fields: ["Name", "Title", "Email", "Phone"],
          parentLookup: "AccountId",
        },
        {
          key: "opportunities",
          objectName: "Opportunity",
          title: "Opportunities",
          fields: ["Name", "StageName", "Amount", "CloseDate"],
          parentLookup: "AccountId",
        },
        {
          key: "cases",
          objectName: "Case",
          title: "Cases",
          fields: ["CaseNumber", "Subject", "Status", "Priority"],
          parentLookup: "AccountId",
        },
      ],
      Contact: [
        {
          key: "opportunities",
          objectName: "Opportunity",
          title: "Opportunities",
          fields: ["Name", "StageName", "Amount", "CloseDate"],
          parentLookup: "AccountId",
          sourceField: "AccountId",
          sourceNameField: "Account.Name",
        },
        {
          key: "cases",
          objectName: "Case",
          title: "Cases",
          fields: ["CaseNumber", "Subject", "Status", "Priority"],
          parentLookup: "ContactId",
        },
      ],
      Opportunity: [
        {
          key: "cases",
          objectName: "Case",
          title: "Cases",
          fields: ["CaseNumber", "Subject", "Status", "Priority"],
          parentLookup: "AccountId",
          sourceField: "AccountId",
          sourceNameField: "Account.Name",
        },
      ],
      Campaign: [
        {
          key: "opportunities",
          objectName: "Opportunity",
          title: "Opportunities",
          fields: ["Name", "StageName", "Amount", "CloseDate"],
          parentLookup: "CampaignId",
        },
      ],
    }[objectName] || [];
  return configs.filter((config) => canReadObject(config.objectName));
}

function renderRelatedListShell(config, noMargin = false) {
  const showNew = config.showNew !== false;
  const canCreateRelated = showNew && canDo(config.objectName, "can_create") && currentDetailCanEdit();
  const isSingle = isSingleRelatedList(config);
  return `
    <div class="related-panel ${isSingle ? "related-panel-single" : ""} ${noMargin ? "no-margin" : ""}" id="relatedPanel-${escapeHtml(config.key)}">
      <div class="related-head">
        <div>
          <h3>${objectIcon(config.objectName)}<span id="relatedTitle-${escapeHtml(config.key)}">${escapeHtml(config.title)}</span></h3>
          <p>${escapeHtml(relatedListSubtitle(config.objectName))}</p>
        </div>
        <div class="related-actions">
          <button class="btn btn-primary btn-related-new" style="${canCreateRelated ? "" : "display:none"}" onclick="openRelatedCreate('${escapeJs(config.key)}')">
            <span aria-hidden="true">+</span>
            New
          </button>
          ${isSingle ? `<button class="related-menu-btn" type="button" title="Show related actions" aria-label="Show related actions" onclick="viewAllRelatedRecords('${escapeJs(config.key)}')">
            ${utilityIconSvg("chevronDown")}
          </button>` : ""}
        </div>
      </div>
      <div class="related-list-body" id="relatedList-${escapeHtml(config.key)}">
        <div class="state-box compact">Loading ${escapeHtml(config.title.toLowerCase())}...</div>
      </div>
    </div>
  `;
}

function relatedListSubtitle(objectName) {
  return (
    {
      Contact: "Contacts associated with this account.",
      Opportunity: "Opportunities associated with this record.",
      Case: "Cases associated with this record.",
    }[objectName] || "Related records associated with this record."
  );
}

function isSingleRelatedList(config) {
  const key = String(config?.key || "");
  return Boolean(config?.isSingle || key.startsWith("rel_single_") || key.includes("_single_"));
}

async function loadRelatedRecords(objectName, id) {
  const pageConfig = RECORD_PAGE_CACHE[objectName];
  let configs = [];
  let hasRelatedListsComp = false;
  
  if (pageConfig && pageConfig.regions) {
    for (const r of Object.keys(pageConfig.regions)) {
      const list = pageConfig.regions[r] || [];
      list.forEach(c => {
        if (c && typeof c === 'object') {
          if (c.name === 'related-lists') {
            hasRelatedListsComp = true;
            if (c.relatedLists && c.relatedLists.length > 0) {
              configs.push(...c.relatedLists.filter(rl => rl && rl.enabled));
            }
          } else if (c.name === 'related-list-single' && c.config) {
            const key = c.config.key || `${c.config.relationshipName.toLowerCase()}_single_${r}`;
            configs.push({
              key: key,
              objectName: c.config.childObject,
              relationshipName: c.config.relationshipName,
              field: c.config.field,
              title: c.config.title || c.title || c.config.relationshipName,
              fields: c.config.fields || [],
              limit: c.config.limit || 5,
              sortBy: c.config.sortBy,
              sortDir: c.config.sortDir || 'ASC',
              showNew: c.config.showNew !== false,
              showViewAll: c.config.showViewAll !== false,
              showEdit: c.config.showEdit !== false,
              showDelete: c.config.showDelete !== false,
              isSingle: true
            });
          }
        }
      });
    }
  }

  if (configs.length === 0 && !hasRelatedListsComp) {
    configs = getRelatedListConfigs(objectName);
  }

  if (!configs.length) return;

  try {
    const data = await api(`/api/${objectName}/${id}/related`);
    const listsByKey = Object.fromEntries(
      (data.lists || []).map((list) => [list.key, list]),
    );
    configs.forEach((config) =>
      renderRelatedList(
        config,
        listsByKey[config.key] || { records: [], totalSize: 0 },
      ),
    );
  } catch (err) {
    configs.forEach((config) => {
      const body = $(`relatedList-${config.key}`);
      if (body)
        body.innerHTML = `<div class="error-state compact"><p>${escapeHtml(err.message)}</p></div>`;
    });
  }
}

function renderRelatedList(config, list) {
  const body = $(`relatedList-${config.key}`);
  const title = $(`relatedTitle-${config.key}`);
  if (!body) return;

  const records = list.records || [];
  if (title)
    title.textContent = `${config.title} (${Number(list.totalSize || records.length)})`;
  if (list.message && !records.length) {
    body.innerHTML = `<div class="table-empty related-empty"><h3>No ${escapeHtml(config.title.toLowerCase())} found</h3><p>${escapeHtml(list.message)}</p></div>`;
    return;
  }
  if (!records.length) {
    body.innerHTML = `<div class="table-empty related-empty"><h3>No related records.</h3></div>`;
    return;
  }

  const showViewAll = config.showViewAll !== false;
  const isSingleCard = isSingleRelatedList(config);

  if (isSingleCard) {
    const maxDisplay = Math.max(1, Number(config.limit || 3));
    const displayRecords = records.slice(0, maxDisplay);

    body.innerHTML = `
      <div class="related-cards-list-wrap">
        ${displayRecords.map((record) => renderRelatedCardItem(config, record)).join("")}
      </div>
      ${showViewAll ? `<div class="related-view-all"><button class="cell-button-link" onclick="viewAllRelatedRecords('${escapeJs(config.key)}')">View All</button></div>` : ""}
    `;
    return;
  }

  const totalCount = Number(list.totalSize || records.length);
  const hasMore = totalCount > records.length;
  body.innerHTML = `
    <div class="mini-table-wrap related-table-wrap">
      <table class="mini-table related-table">
        <thead>
          <tr>
            ${(config.fields || ['Name']).map((field) => `<th>${escapeHtml(labelFor(field))}</th>`).join("")}
          </tr>
        </thead>
        <tbody>
          ${records
            .map(
              (record) => `
            <tr onclick="openRecordDetail('${config.objectName}', '${escapeJs(record.Id)}')">
              ${(config.fields || ['Name']).map((field) => `<td>${renderRelatedCell(config.objectName, record, field)}</td>`).join("")}
            </tr>
          `,
            )
            .join("")}
        </tbody>
      </table>
    </div>
    ${(showViewAll && hasMore) ? `<div class="related-view-all"><button class="cell-button-link" onclick="viewAllRelatedRecords('${escapeJs(config.key)}')">View All</button></div>` : ""}
  `;
}

function renderRelatedCardItem(config, record) {
  const primaryVal = getValue(record, "Name") || getValue(record, "CaseNumber") || "-";
  const primaryFields = new Set(["Name", "CaseNumber", "Id"]);
  const detailFields = (config.fields || ["Name"]).filter((field) => !primaryFields.has(field));

  return `
    <article class="related-card-item" onclick="openRecordDetail('${config.objectName}', '${escapeJs(record.Id)}')">
      <div class="related-card-topline">
        <div class="related-card-title">
          <span class="related-card-icon">${objectIcon(config.objectName, record)}</span>
          <button class="cell-button-link" onclick="event.stopPropagation(); openRecordDetail('${config.objectName}', '${escapeJs(record.Id)}')">
            ${escapeHtml(primaryVal)}
          </button>
        </div>
        <button class="related-menu-btn related-card-menu" type="button" title="Open related record" aria-label="Open related record" onclick="event.stopPropagation(); openRecordDetail('${config.objectName}', '${escapeJs(record.Id)}')">
          ${utilityIconSvg("chevronDown")}
        </button>
      </div>
      ${detailFields.length ? `
        <div class="related-card-fields">
          ${detailFields.map((field) => `
            <div class="related-card-field">
              <span>${escapeHtml(labelFor(field))}:</span>
              <strong>${renderRelatedCell(config.objectName, record, field)}</strong>
            </div>
          `).join("")}
        </div>
      ` : ""}
    </article>
  `;
}

function renderRelatedCell(objectName, record, field) {
  const value = getValue(record, field);
  if (value === null || value === undefined || value === "")
    return '<span class="cell-empty">-</span>';
  if (field === "Name" || field === "CaseNumber") {
    return `<button class="cell-button-link" onclick="event.stopPropagation(); openRecordDetail('${objectName}', '${escapeJs(record.Id)}')">${escapeHtml(value)}</button>`;
  }
  return formatValue(field, value, record);
}

function renderChatterPanel(objectName) {
  return `
    <div class="chatter-wrap">
      ${renderChatterComposer(objectName)}
      <div class="chatter-tools">
        <button class="chatter-sort" title="Sort feed">${utilityIconSvg("sort")}</button>
        <div class="chatter-search">
          ${utilityIconSvg("search")}
          <input id="chatterSearch" placeholder="Search this feed..." oninput="renderChatterFeedItems()">
        </div>
        <button class="chatter-refresh" title="Refresh feed" onclick="loadChatterFeed(true)">${utilityIconSvg("refresh")}</button>
      </div>
      <div id="chatterFeed" class="chatter-feed">
        <div class="activity-empty"><p>Open Chatter to load this feed.</p></div>
      </div>
    </div>
  `;
}

function renderChatterComposer(objectName) {
  return `
    <div class="chatter-composer">
      <div class="chatter-publisher-tabs">
        <button class="chatter-publisher-tab active" id="chatterPostTab" onclick="setChatterComposerTab('post')">Post</button>
        <button class="chatter-publisher-tab" id="chatterPollTab" onclick="setChatterComposerTab('poll')">Poll</button>
      </div>
      <div id="chatterPostComposer">
        <div class="chatter-editor-wrap">
          <div class="chatter-editor" id="chatterEditor" contenteditable="true" data-placeholder="Share an update..."
            oninput="handleChatterEditorInput(event)" onkeyup="handleChatterEditorInput(event)"></div>
          <div class="chatter-mention-menu" id="chatterMentionMenu"></div>
        </div>
        <div class="chatter-format-row">
          <button title="Bold" onclick="formatChatterEditor('bold')"><strong>B</strong></button>
          <button title="Italic" onclick="formatChatterEditor('italic')"><em>I</em></button>
          <button title="Underline" onclick="formatChatterEditor('underline')"><u>U</u></button>
          <button title="Link" onclick="createChatterLink()">${utilityIconSvg("link")}</button>
          <button title="Mention User" onclick="openChatterMentionSearch()">${utilityIconSvg("user")}</button>
        </div>
        <div class="chatter-publisher-foot">
          <span>To this ${escapeHtml(objectName.toLowerCase())}</span>
          <button class="btn btn-primary" id="chatterShareBtn" onclick="submitChatterPost()">Share</button>
        </div>
      </div>
      <div id="chatterPollComposer" style="display:none">
        <label class="form-label" for="chatterPollQuestion">Question</label>
        <textarea class="form-ctrl chatter-poll-question" id="chatterPollQuestion" placeholder="What would you like to ask?"></textarea>
        <label class="form-label" for="chatterPollChoice1">Choice 1</label>
        <input class="form-ctrl" id="chatterPollChoice1">
        <label class="form-label" for="chatterPollChoice2">Choice 2</label>
        <input class="form-ctrl" id="chatterPollChoice2">
        <div id="chatterExtraChoices"></div>
        <div class="chatter-publisher-foot">
          <button class="btn btn-primary" onclick="addChatterPollChoice()">Add new choice</button>
          <button class="btn btn-primary" id="chatterAskBtn" onclick="submitChatterPoll()">Ask</button>
        </div>
      </div>
    </div>
  `;
}

function setChatterComposerTab(tab) {
  chatterState.activeTab = tab;
  $("chatterPostTab")?.classList.toggle("active", tab === "post");
  $("chatterPollTab")?.classList.toggle("active", tab === "poll");
  if ($("chatterPostComposer"))
    $("chatterPostComposer").style.display = tab === "post" ? "block" : "none";
  if ($("chatterPollComposer"))
    $("chatterPollComposer").style.display = tab === "poll" ? "block" : "none";
}

async function loadChatterFeed(force = false) {
  if (!detailRecordState?.id) return;
  const feed = $("chatterFeed");
  if (!feed) return;
  chatterState.loadedFor = detailRecordState.id;
  feed.innerHTML =
    '<div class="activity-empty"><p>Loading Chatter...</p></div>';
  try {
    const data = await api(
      `/api/${detailRecordState.objectName}/${detailRecordState.id}/chatter`,
    );
    chatterState.items = data.items || [];
    renderChatterFeedItems();
  } catch (err) {
    feed.innerHTML = `<div class="error-state compact"><p>${escapeHtml(err.message)}</p></div>`;
  }
}

function renderChatterFeedItems() {
  const feed = $("chatterFeed");
  if (!feed) return;
  const search = String($("chatterSearch")?.value || "").toLowerCase();
  const items = (chatterState.items || []).filter(
    (item) =>
      !search ||
      `${item.text} ${item.actor?.name}`.toLowerCase().includes(search),
  );
  feed.innerHTML =
    items.map(renderChatterItem).join("") ||
    '<div class="activity-empty"><p>No Chatter posts to show.</p></div>';
}

function renderChatterItem(item) {
  return `
    <article class="chatter-item">
      <div class="chatter-item-main">
        <div class="chatter-avatar">${escapeHtml((item.actor?.name || "U").slice(0, 1).toUpperCase())}</div>
        <div class="chatter-body">
          <div class="chatter-meta">
            <button class="cell-button-link">${escapeHtml(item.actor?.name || "Salesforce User")}</button>
            <span>${escapeHtml(item.relativeCreatedDate || formatActivityTime(item.createdDate))}</span>
          </div>
          <div class="chatter-text">${renderChatterSegments(item.segments)}</div>
          ${item.poll ? renderChatterPoll(item) : ""}
        </div>
      </div>
      <div class="chatter-actions">
        <button onclick="likeChatterItem('${escapeJs(item.id)}')">${utilityIconSvg("like")} Like${item.likeCount ? ` (${item.likeCount})` : ""}</button>
        <button onclick="$('chatterComment-${escapeJs(item.id)}')?.focus()">${utilityIconSvg("comment")} Comment${item.commentCount ? ` (${item.commentCount})` : ""}</button>
      </div>
      <div class="chatter-comments">
        ${(item.comments || [])
          .slice(0, 3)
          .map(
            (comment) => `
          <div class="chatter-comment">
            <strong>${escapeHtml(comment.actor?.name || "User")}</strong>
            <span>${renderChatterSegments(comment.segments)}</span>
          </div>
        `,
          )
          .join("")}
        <div class="chatter-comment-box">
          <div class="chatter-avatar small">${escapeHtml((currentUser?.name || "U").slice(0, 1).toUpperCase())}</div>
          <input id="chatterComment-${escapeHtml(item.id)}" placeholder="Write a comment..." onkeydown="submitChatterComment(event, '${escapeJs(item.id)}')">
        </div>
      </div>
    </article>
  `;
}

function renderChatterSegments(segments = []) {
  return (segments.length ? segments : [{ type: "Text", text: "" }])
    .map((segment) => {
      if (segment.type === "Mention")
        return `<button class="cell-button-link">@${escapeHtml(segment.name || segment.text || "User")}</button>`;
      if (segment.url)
        return `<a class="cell-email" href="${escapeHtml(segment.url)}" target="_blank" rel="noreferrer">${escapeHtml(segment.text || segment.url)}</a>`;
      return escapeHtml(segment.text || "");
    })
    .join("");
}

function renderChatterPoll(item) {
  const choices = item.poll?.choices || [];
  const myChoiceId = item.poll?.myChoiceId || "";
  const showResults =
    item.poll?.showResults || (myChoiceId && !item.poll?.changingVote);
  if (showResults) return renderChatterPollResults(item, choices, myChoiceId);
  return `
    <div class="chatter-poll">
      ${choices
        .map(
          (choice) => `
        <label>
          <input type="radio" name="poll-${escapeHtml(item.id)}" value="${escapeHtml(choice.id || choice.text)}" data-choice-id="${escapeHtml(choice.id || "")}" ${choice.id && choice.id === myChoiceId ? "checked" : ""}>
          <span>${escapeHtml(choice.text || choice.label || "")}</span>
        </label>
      `,
        )
        .join("")}
      <div class="chatter-poll-actions">
        <button class="btn btn-primary" onclick="voteChatterPoll('${escapeJs(item.id)}')">Vote</button>
        <button class="cell-button-link" type="button" onclick="viewChatterPollResults('${escapeJs(item.id)}')">View results</button>
      </div>
    </div>
  `;
}

function renderChatterPollResults(item, choices = [], myChoiceId = "") {
  const totalVotes = choices.reduce(
    (sum, choice) => sum + Number(choice.voteCount || 0),
    0,
  );
  return `
    <div class="chatter-poll chatter-poll-results">
      ${choices
        .map((choice) => {
          const votes = Number(choice.voteCount || 0);
          const percent = totalVotes
            ? Math.round((votes / totalVotes) * 100)
            : 0;
          const selected = choice.id && choice.id === myChoiceId;
          return `
          <div class="chatter-poll-result${selected ? " selected" : ""}">
            <div class="chatter-poll-result-head">
              <span>${escapeHtml(choice.text || choice.label || "")} (${votes})</span>
              <span>${percent}%</span>
            </div>
            <div class="chatter-poll-bar" aria-hidden="true">
              <span style="width:${percent}%"></span>
            </div>
          </div>
        `;
        })
        .join("")}
      <div class="chatter-poll-actions">
        <button class="btn btn-primary" onclick="changeChatterPollVote('${escapeJs(item.id)}')">Change vote</button>
        <button class="cell-button-link" type="button" onclick="loadChatterFeed(true)">Refresh</button>
      </div>
    </div>
  `;
}

function viewChatterPollResults(feedElementId) {
  const item = (chatterState.items || []).find(
    (entry) => entry.id === feedElementId,
  );
  if (item?.poll) {
    item.poll.showResults = true;
    item.poll.changingVote = false;
  }
  renderChatterFeedItems();
}

function changeChatterPollVote(feedElementId) {
  const item = (chatterState.items || []).find(
    (entry) => entry.id === feedElementId,
  );
  if (item?.poll) {
    item.poll.showResults = false;
    item.poll.changingVote = true;
  }
  renderChatterFeedItems();
}

function formatChatterEditor(command) {
  $("chatterEditor")?.focus();
  document.execCommand(command);
}

function createChatterLink() {
  const url = prompt("Enter link URL");
  if (!url) return;
  const editor = $("chatterEditor");
  editor?.focus();
  const selection = window.getSelection();
  if (selection && !selection.isCollapsed) {
    document.execCommand("createLink", false, url);
    return;
  }
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.textContent = url;
  anchor.target = "_blank";
  anchor.rel = "noreferrer";
  const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
  if (range) {
    range.insertNode(document.createTextNode(" "));
    range.insertNode(anchor);
    range.collapse(false);
  } else {
    editor?.append(anchor, document.createTextNode(" "));
  }
}

function collectChatterSegments(root = $("chatterEditor")) {
  const segments = [];
  function walk(node) {
    if (node.nodeType === Node.TEXT_NODE) {
      if (node.textContent)
        segments.push({ type: "Text", text: node.textContent });
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    if (node.dataset?.mentionId) {
      segments.push({
        type: "Mention",
        id: node.dataset.mentionId,
        name: node.textContent.replace(/^@/, ""),
      });
      return;
    }
    if (node.tagName === "BR") {
      segments.push({ type: "Text", text: "\n" });
      return;
    }
    if (node.tagName === "A") {
      segments.push({ type: "Link", text: node.textContent, url: node.href });
      return;
    }
    node.childNodes.forEach(walk);
  }
  root?.childNodes.forEach(walk);
  return mergeTextSegments(segments).filter(
    (segment) => segment.type !== "Text" || segment.text.trim(),
  );
}

function mergeTextSegments(segments) {
  return segments.reduce((acc, segment) => {
    const last = acc[acc.length - 1];
    if (last?.type === "Text" && segment.type === "Text")
      last.text += segment.text;
    else acc.push(segment);
    return acc;
  }, []);
}

async function submitChatterPost() {
  const segments = collectChatterSegments();
  if (!segments.length) return toast("Write a post first", "info");
  await saveChatter({ type: "post", segments }, "chatterShareBtn");
  $("chatterEditor").innerHTML = "";
}

function addChatterPollChoice() {
  const wrap = $("chatterExtraChoices");
  const count = wrap.querySelectorAll("input").length + 3;
  wrap.insertAdjacentHTML(
    "beforeend",
    `
    <label class="form-label" for="chatterPollChoice${count}">Choice ${count}</label>
    <input class="form-ctrl" id="chatterPollChoice${count}">
  `,
  );
}

async function submitChatterPoll() {
  const question = $("chatterPollQuestion")?.value.trim();
  const choices = [...document.querySelectorAll('[id^="chatterPollChoice"]')]
    .map((input) => input.value.trim())
    .filter(Boolean);
  if (!question || choices.length < 2)
    return toast("Add a question and at least two choices", "info");
  await saveChatter(
    { type: "poll", segments: [{ type: "Text", text: question }], choices },
    "chatterAskBtn",
  );
  $("chatterPollQuestion").value = "";
  document.querySelectorAll('[id^="chatterPollChoice"]').forEach((input) => {
    input.value = "";
  });
  $("chatterExtraChoices").innerHTML = "";
}

async function saveChatter(payload, buttonId) {
  if (!detailRecordState?.id) return;
  const btn = $(buttonId);
  try {
    if (btn) btn.disabled = true;
    await api(
      `/api/${detailRecordState.objectName}/${detailRecordState.id}/chatter`,
      {
        method: "POST",
        body: JSON.stringify(payload),
      },
    );
    await loadChatterFeed(true);
    toast("Chatter updated", "ok");
  } catch (err) {
    toast(err.message, "err");
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function submitChatterComment(event, feedElementId) {
  if (event.key !== "Enter" || !event.target.value.trim()) return;
  event.preventDefault();
  try {
    await api(`/api/chatter/feed-elements/${feedElementId}/comments`, {
      method: "POST",
      body: JSON.stringify({ text: event.target.value.trim() }),
    });
    event.target.value = "";
    await loadChatterFeed(true);
  } catch (err) {
    toast(err.message, "err");
  }
}

async function likeChatterItem(feedElementId) {
  try {
    await api(`/api/chatter/feed-elements/${feedElementId}/likes`, {
      method: "POST",
      body: JSON.stringify({}),
    });
    await loadChatterFeed(true);
  } catch (err) {
    toast(err.message, "err");
  }
}

async function voteChatterPoll(feedElementId) {
  const selected = document.querySelector(
    `input[name="poll-${CSS.escape(feedElementId)}"]:checked`,
  );
  if (!selected) return toast("Select a poll choice first", "info");
  const choiceId = selected.dataset.choiceId || selected.value;
  try {
    await api(`/api/chatter/feed-elements/${feedElementId}/poll-vote`, {
      method: "POST",
      body: JSON.stringify({ choiceId }),
    });
    await loadChatterFeed(true);
  } catch (err) {
    toast(err.message, "err");
  }
}

function handleChatterEditorInput() {
  const selection = window.getSelection();
  const text = selection?.anchorNode?.textContent || "";
  const beforeCaret = text.slice(0, selection?.anchorOffset || 0);
  const match = beforeCaret.match(/@([\w .-]{1,40})$/);
  if (!match) return closeChatterMentionMenu();
  searchChatterMentions(match[1]);
}

function openChatterMentionSearch() {
  $("chatterEditor")?.focus();
  searchChatterMentions("");
}

async function searchChatterMentions(term) {
  const menu = $("chatterMentionMenu");
  if (!menu) return;
  try {
    const data = await api(
      `/api/lookup/User?search=${encodeURIComponent(term || "")}`,
    );
    menu.innerHTML =
      (data.records || [])
        .slice(0, 6)
        .map(
          (user) => `
      <button type="button" onclick="insertChatterMention('${escapeJs(user.Id)}', '${escapeJs(user.Name || user.Username || "User")}')">
        <span>${escapeHtml(user.Name || user.Username || "User")}</span>
        <small>${escapeHtml(user.Email || user.Username || "")}</small>
      </button>
    `,
        )
        .join("") || '<div class="lookup-empty">No users found</div>';
    menu.classList.add("open");
  } catch {
    closeChatterMentionMenu();
  }
}

function insertChatterMention(id, name) {
  const editor = $("chatterEditor");
  if (!editor) return;
  editor.focus();
  const selection = window.getSelection();
  if (selection?.anchorNode?.nodeType === Node.TEXT_NODE) {
    const node = selection.anchorNode;
    const offset = selection.anchorOffset || 0;
    const before = node.textContent.slice(0, offset);
    const after = node.textContent.slice(offset);
    const match = before.match(/@([\w .-]{0,40})$/);
    if (match) {
      node.textContent = `${before.slice(0, match.index)}${after}`;
      const range = document.createRange();
      range.setStart(node, before.slice(0, match.index).length);
      range.collapse(true);
      selection.removeAllRanges();
      selection.addRange(range);
    }
  }
  const mention = document.createElement("span");
  mention.className = "chatter-mention";
  mention.dataset.mentionId = id;
  mention.contentEditable = "false";
  mention.textContent = `@${name}`;
  const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
  if (range) {
    range.deleteContents();
    range.insertNode(document.createTextNode(" "));
    range.insertNode(mention);
    range.collapse(false);
  } else {
    editor.append(mention, document.createTextNode(" "));
  }
  closeChatterMentionMenu();
}

function closeChatterMentionMenu() {
  $("chatterMentionMenu")?.classList.remove("open");
}

function showRecordTab(name) {
  if ($("recordRelatedPanel")) $("recordRelatedPanel").style.display = name === "related" ? "block" : "none";
  if ($("recordDetailsPanel")) $("recordDetailsPanel").style.display = name === "details" ? "block" : "none";
  if ($("tabRelatedBtn")) $("tabRelatedBtn").classList.toggle("active", name === "related");
  if ($("tabDetailsBtn")) $("tabDetailsBtn").classList.toggle("active", name === "details");
  
  const actions = $("recordTabActions");
  if (actions) {
    actions.style.display = "none";
  }
  captureCrmPageState(currentObject);
}

function editCurrentDetailRecord() {
  if (!detailRecordState) return;
  if (detailRecordState.recordAccess?.accessLevel !== "edit") {
    toast("You do not have the level of access necessary to perform the operation you requested.", "err");
    return;
  }
  currentObject = detailRecordState.objectName;
  editingRecord = detailRecordState.record;
  openRecordModal(
    `Edit ${detailRecordState.objectName}`,
    detailRecordState.record,
    detailRecordState.fields,
    detailRecordState.objectName,
  );
}

function renderDetailField(objectName, record, field) {
  const value = record[field.name];
  const label = field.label || labelFor(field.name);
  let display = formatDetailValue(value, field.type);
  if (field.type === "picklist" && value) {
    display = escapeHtml(getPicklistLabel(field.picklistValues, value));
  }

  if (field.type === "reference" && value) {
    const lookup = detailLookupLabels[field.name] || {};
    const targetObject = lookup.object || field.referenceTo[0];
    const labelValue =
      lookup.name ||
      getValue(record, `${field.relationshipName}.Name`) ||
      value;
    display = OBJECT_META[targetObject]
      ? `<button class="cell-button-link" onclick="openRecordDetail('${targetObject}', '${value}')">${escapeHtml(labelValue)}</button>`
      : escapeHtml(labelValue);
  }

  return `
    <div class="detail-field">
      <div class="detail-label">${escapeHtml(label)}</div>
      <div class="detail-value">${display}</div>
    </div>
  `;
}

function getPicklistLabel(values = [], selected) {
  if (selected === null || selected === undefined || selected === "") return "";
  const match = (values || []).find(
    (item) =>
      String(typeof item === "object" ? item.value : item) === String(selected),
  );
  if (!match) return String(selected);
  return String(typeof match === "object" ? match.label || match.value : match);
}

function formatDetailValue(value, type = "") {
  if (value === null || value === undefined || value === "")
    return '<span class="cell-empty">-</span>';
  if (type === "multipicklist")
    return escapeHtml(String(value).split(";").filter(Boolean).join(", "));
  if (type === "date") return new Date(value).toLocaleDateString();
  if (type === "datetime") return new Date(value).toLocaleString();
  if (type === "address" || isAddressObject(value)) return formatAddress(value);
  if (typeof value === "object")
    return escapeHtml(
      value.Name ||
        Object.entries(value)
          .filter(
            ([, item]) => item !== null && item !== undefined && item !== "",
          )
          .map(([key, item]) => `${labelFor(key)}: ${item}`)
          .join("\n"),
    );
  return escapeHtml(String(value));
}

function isAddressObject(value) {
  return (
    value &&
    typeof value === "object" &&
    ["street", "city", "state", "postalCode", "country"].some(
      (key) => key in value,
    )
  );
}

function formatAddress(value) {
  if (!isAddressObject(value)) return escapeHtml(String(value || ""));
  const lines = [
    value.street,
    [value.city, value.state, value.postalCode].filter(Boolean).join(", "),
    value.country,
  ].filter(Boolean);

  return lines.length
    ? lines.map((line) => escapeHtml(line)).join("<br>")
    : '<span class="cell-empty">-</span>';
}

function closeDetailModal() {
  $("detailOverlay").classList.remove("open");
  $("detailEditBtn").style.display = "inline-flex";
}

function renderCampaignMembersShell(noMargin = false) {
  return `
    <div class="related-panel ${noMargin ? "no-margin" : ""}">
      <div class="related-head">
        <div>
          <h3>Campaign Members</h3>
          <p id="campaignMemberSummary">Loading members...</p>
        </div>
        <div class="related-actions">
          <button class="btn btn-ghost" onclick="openCampaignMemberModal('Lead')">Add Leads</button>
          <button class="btn btn-ghost" onclick="openCampaignMemberModal('Contact')">Add Contacts</button>
          <button class="btn btn-primary" onclick="openCampaignEmailModal()">Send Mass Email</button>
        </div>
      </div>
      <div class="mini-table-wrap" id="campaignMembersTable"></div>
    </div>
  `;
}

async function loadCampaignMembers(campaignId) {
  if (!canReadObject("Campaign")) return;
  const table = $("campaignMembersTable");
  if (!table) return;
  table.innerHTML =
    '<div class="state-box compact">Loading campaign members...</div>';
  try {
    const data = await api(`/api/campaigns/${campaignId}/members`);
    campaignMembers = data.records || [];
    campaignMemberSelection = new Set(
      campaignMembers
        .filter((member) => member.email)
        .map((member) => member.id),
    );
    renderCampaignMembers();
  } catch (err) {
    table.innerHTML = `<div class="error-state compact"><p>${escapeHtml(err.message)}</p></div>`;
  }
}

function renderCampaignMembers() {
  const table = $("campaignMembersTable");
  if (!table) return;
  $("campaignMemberSummary").textContent =
    `${campaignMembers.length} members, ${campaignMembers.filter((member) => member.email).length} with email`;
  if (!campaignMembers.length) {
    table.innerHTML =
      '<div class="table-empty"><h3>No campaign members yet</h3><p>Add contacts or leads to this campaign.</p></div>';
    return;
  }
  table.innerHTML = `
    <table class="mini-table">
      <thead>
        <tr>
          <th><input type="checkbox" aria-label="Select all email recipients" ${campaignMemberSelection.size ? "checked" : ""} onchange="toggleAllCampaignMembers(this.checked)"></th>
          <th>Type</th>
          <th>Status</th>
          <th>Name</th>
          <th>Company</th>
          <th>Email</th>
          <th>Action</th>
        </tr>
      </thead>
      <tbody>
        ${campaignMembers
          .map(
            (member) => `
          <tr>
            <td><input type="checkbox" value="${member.id}" ${campaignMemberSelection.has(member.id) ? "checked" : ""} ${member.email ? "" : "disabled"} onchange="toggleCampaignMemberSelection('${member.id}', this.checked)"></td>
            <td><span class="badge badge-neutral">${escapeHtml(member.type)}</span></td>
            <td>${escapeHtml(member.status || "-")}</td>
            <td><button class="cell-button-link" onclick="openRecordDetail('${member.type}', '${member.personId}')">${escapeHtml(member.name || "-")}</button></td>
            <td>${renderCampaignMemberCompany(member)}</td>
            <td>${member.email ? `<a class="cell-email" href="mailto:${escapeHtml(member.email)}">${escapeHtml(member.email)}</a>` : '<span class="cell-empty">-</span>'}</td>
            <td>
              <button class="row-action del" title="Remove campaign member" aria-label="Remove campaign member" onclick="removeCampaignMember('${member.id}')">
                ${utilityIconSvg("trash")}
              </button>
            </td>
          </tr>
        `,
          )
          .join("")}
      </tbody>
    </table>
  `;
}

function renderCampaignMemberCompany(member) {
  if (!member.company) return '<span class="cell-empty">-</span>';
  if (member.accountId) {
    return `<button class="cell-button-link" onclick="openRecordDetail('Account', '${member.accountId}')">${escapeHtml(member.company)}</button>`;
  }
  return escapeHtml(member.company);
}

async function removeCampaignMember(memberId) {
  const member = campaignMembers.find((item) => item.id === memberId);
  if (!member || !activeCampaign?.Id) return;
  if (!confirm(`Remove ${member.name || "this member"} from this campaign?`))
    return;

  try {
    await api(`/api/campaigns/${activeCampaign.Id}/members/${memberId}`, {
      method: "DELETE",
    });
    campaignMembers = campaignMembers.filter((item) => item.id !== memberId);
    campaignMemberSelection.delete(memberId);
    renderCampaignMembers();
    toast("Campaign member removed", "ok");
  } catch (err) {
    toast(err.message, "err");
  }
}

function activityModalTitle(type) {
  return (
    {
      task: "New Task",
      call: "Log a Call",
      event: "New Event",
      email: "Email",
    }[type] || "New Activity"
  );
}

function todayInputValue() {
  return new Date().toISOString().slice(0, 10);
}

function addHoursTimeValue(hours = 1) {
  const date = new Date();
  date.setMinutes(0, 0, 0);
  date.setHours(date.getHours() + hours);
  return date.toTimeString().slice(0, 5);
}

function currentActivityTargetLabel() {
  const record = detailRecordState?.record || {};
  return (
    record.Name ||
    record.Subject ||
    record.CaseNumber ||
    record.Email ||
    detailRecordState?.id ||
    ""
  );
}

function currentActivityRecipientEmail() {
  const record = detailRecordState?.record || {};
  return ["Contact", "Lead"].includes(detailRecordState?.objectName)
    ? record.Email || ""
    : "";
}

function initializeActivityLookups() {
  const objectName = detailRecordState?.objectName || currentObject;
  const record = detailRecordState?.record || {};
  const title = currentActivityTargetLabel();

  activityLookupState = {
    who: ["Contact", "Lead"].includes(objectName)
      ? { object: objectName, id: detailRecordState.id, label: title }
      : { object: "Contact", id: "", label: "" },
    what: { object: "Account", id: "", label: "" },
    owner: currentUser?.id
      ? {
          object: "User",
          id: currentUser.id,
          label: currentUser.name || currentUser.username || "Current User",
        }
      : { object: "User", id: "", label: "" },
  };

  if (objectName === "Contact" && record.AccountId) {
    activityLookupState.what = {
      object: "Account",
      id: record.AccountId,
      label:
        getValue(record, "Account.Name") ||
        detailLookupLabels.AccountId?.name ||
        "Account",
    };
  } else if (!["Contact", "Lead", "User"].includes(objectName)) {
    activityLookupState.what = {
      object: objectName,
      id: detailRecordState.id,
      label: title,
    };
  }
}

function activityLookupControl(
  kind,
  label,
  objects,
  placeholder = "Search...",
) {
  const allowedObjects = readableObjectNames(objects);
  if (!allowedObjects.length) return "";
  const state = activityLookupState[kind] || {
    object: allowedObjects[0],
    id: "",
    label: "",
  };
  if (!allowedObjects.includes(state.object)) {
    state.object = allowedObjects[0];
    state.id = "";
    state.label = "";
    activityLookupState[kind] = state;
  }
  const options = allowedObjects
    .map(
      (objectName) => `
    <option value="${escapeHtml(objectName)}" ${state.object === objectName ? "selected" : ""}>${escapeHtml(OBJECT_META[objectName]?.title || objectName)}</option>
  `,
    )
    .join("");

  return `
    <div class="activity-lookup" data-kind="${escapeHtml(kind)}">
      <label class="form-label">${escapeHtml(label)}</label>
      ${
        state.id
          ? `
        <div class="activity-pill">
          ${objectIcon(state.object)}
          <span>${escapeHtml(state.label || state.id)}</span>
          <button type="button" aria-label="Clear ${escapeHtml(label)}" onclick="clearActivityLookup('${escapeJs(kind)}')">&times;</button>
        </div>
      `
          : `
        <div class="activity-lookup-search">
          <select class="activity-lookup-type" onchange="setActivityLookupObject('${escapeJs(kind)}', this.value)">
            ${options}
          </select>
          <input class="form-ctrl" id="activityLookupInput-${escapeHtml(kind)}" placeholder="${escapeHtml(placeholder)}"
            oninput="searchActivityLookup('${escapeJs(kind)}', this.value)" autocomplete="off">
          <button type="button" class="activity-lookup-search-btn" aria-label="Search">${utilityIconSvg("settings")}</button>
        </div>
        <div class="activity-lookup-results" id="activityLookupResults-${escapeHtml(kind)}"></div>
      `
      }
    </div>
  `;
}

function setActivityLookupObject(kind, objectName) {
  if (objectName !== "User" && !canReadObject(objectName)) return;
  activityLookupState[kind] = { object: objectName, id: "", label: "" };
  const results = $(`activityLookupResults-${kind}`);
  if (results) results.classList.remove("open");
}

function clearActivityLookup(kind) {
  const current = activityLookupState[kind] || {};
  activityLookupState[kind] = {
    object: current.object || (kind === "owner" ? "User" : "Contact"),
    id: "",
    label: "",
  };
  rerenderActivityFormPreservingFields();
}

async function searchActivityLookup(kind, value) {
  const results = $(`activityLookupResults-${kind}`);
  const state = activityLookupState[kind];
  if (!results || !state?.object) return;
  if (state.object !== "User" && !canReadObject(state.object)) return;
  if (!String(value || "").trim()) {
    results.classList.remove("open");
    results.innerHTML = "";
    return;
  }

  try {
    const data = await api(
      `/api/lookup/${state.object}?search=${encodeURIComponent(value)}`,
    );
    results.innerHTML =
      (data.records || [])
        .map((record) => {
          const label =
            record.Name || record.Subject || record.CaseNumber || record.Id;
          const sub =
            record.Email ||
            record.Company ||
            getValue(record, "Account.Name") ||
            record.Status ||
            "";
          return `
        <button type="button" class="activity-lookup-item" onclick="selectActivityLookup('${escapeJs(kind)}', '${escapeJs(state.object)}', '${escapeJs(record.Id)}', '${escapeJs(label)}')">
          ${objectIcon(state.object)}
          <span><strong>${escapeHtml(label)}</strong>${sub ? `<small>${escapeHtml(sub)}</small>` : ""}</span>
        </button>
      `;
        })
        .join("") || '<div class="lookup-empty">No matches</div>';
    results.classList.add("open");
  } catch (err) {
    results.innerHTML = `<div class="lookup-empty">${escapeHtml(err.message)}</div>`;
    results.classList.add("open");
  }
}

function selectActivityLookup(kind, objectName, id, label) {
  if (objectName !== "User" && !canReadObject(objectName)) return;
  activityLookupState[kind] = { object: objectName, id, label };
  rerenderActivityFormPreservingFields();
}

function defaultEmailRecipient() {
  const record = detailRecordState?.record || {};
  if (
    !["Contact", "Lead"].includes(detailRecordState?.objectName) ||
    !record.Email
  )
    return null;
  return {
    object: detailRecordState.objectName,
    id: detailRecordState.id,
    label: currentActivityTargetLabel(),
    email: record.Email,
  };
}

function openRelatedCreate(configKey) {
  if (!detailRecordState) return;
  if (!currentDetailCanEdit()) {
    toast("You do not have the level of access necessary to perform the operation you requested.", "err");
    return;
  }
  
  const pageConfig = RECORD_PAGE_CACHE[detailRecordState.objectName];
  let config = null;
  if (pageConfig && pageConfig.regions) {
    for (const r of Object.keys(pageConfig.regions)) {
      const list = pageConfig.regions[r] || [];
      const found = list.find(c => c && typeof c === 'object' && c.name === 'related-lists');
      if (found && found.relatedLists) {
        config = found.relatedLists.find(item => item.key === configKey);
        if (config) break;
      }
      
      const foundSingle = list.find(c => c && typeof c === 'object' && c.name === 'related-list-single' && c.config && (c.config.key === configKey || `${c.config.relationshipName.toLowerCase()}_single_${r}` === configKey));
      if (foundSingle) {
        config = {
          key: foundSingle.config.key || `${foundSingle.config.relationshipName.toLowerCase()}_single_${r}`,
          objectName: foundSingle.config.childObject,
          relationshipName: foundSingle.config.relationshipName,
          parentLookup: foundSingle.config.field,
          field: foundSingle.config.field,
          title: foundSingle.config.title || foundSingle.title || foundSingle.config.relationshipName,
          fields: foundSingle.config.fields || [],
          limit: foundSingle.config.limit || 5,
          sortBy: foundSingle.config.sortBy,
          sortDir: foundSingle.config.sortDir || 'ASC',
          showNew: foundSingle.config.showNew !== false,
          showViewAll: foundSingle.config.showViewAll !== false,
          showEdit: foundSingle.config.showEdit !== false,
          showDelete: foundSingle.config.showDelete !== false
        };
        break;
      }
    }
  }
  
  if (!config) {
    config = getRelatedListConfigs(detailRecordState.objectName).find(
      (item) => item.key === configKey,
    );
  }
  if (!config) return;

  editingRecord = null;
  detailLookupLabels = {};
  const record = buildRelatedCreateRecord(config);
  openRecordModal(`New ${config.objectName}`, record, null, config.objectName, {
    presetValues: record,
  });
}

function buildRelatedCreateRecord(config) {
  const parent = detailRecordState?.record || {};
  const record = {};
  const sourceField = config.sourceField || "Id";
  const sourceValue =
    sourceField === "Id" ? detailRecordState.id : getValue(parent, sourceField);
  if (!config.parentLookup || !sourceValue) return record;

  record[config.parentLookup] = sourceValue;
  const relationshipName = config.parentLookup.replace(/Id$/, "");
  const sourceName = config.sourceNameField
    ? getValue(parent, config.sourceNameField)
    : parent.Name || parent.Subject || parent.CaseNumber || "";
  if (sourceName) record[relationshipName] = { Name: sourceName };
  return record;
}

async function editRelatedRecord(childObjectName, childId) {
  try {
    const fieldsRes = await fetchMetadata(`/api/${childObjectName}/fields`);
    const fields = fieldsRes.fields || [];
    const record = await api(`/api/${childObjectName}/${childId}`);
    
    editingRecord = record;
    openRecordModal(`Edit ${childObjectName}`, record, fields, childObjectName);
  } catch (err) {
    console.error('Error opening related edit modal:', err);
    toast('Error opening related edit modal', 'err');
  }
}

let relatedDeletingRecord = null;
function deleteRelatedRecord(childObjectName, childId, configKey) {
  relatedDeletingRecord = { childObjectName, childId, configKey };
  if (confirm(`Are you sure you want to delete this related record?`)) {
    confirmDeleteRelated();
  } else {
    relatedDeletingRecord = null;
  }
}

async function confirmDeleteRelated() {
  if (!relatedDeletingRecord) return;
  const { childObjectName, childId } = relatedDeletingRecord;
  try {
    await api(`/api/${childObjectName}/${childId}`, {
      method: "DELETE",
    });
    invalidateCrmObjectCache(childObjectName);
    toast("Record deleted", "ok");
    if (detailRecordState) {
      loadRelatedRecords(detailRecordState.objectName, detailRecordState.id);
    }
  } catch (err) {
    toast(err.message || 'Could not delete record. Please try again.', 'err');
  } finally {
    relatedDeletingRecord = null;
  }
}

async function viewAllRelatedRecords(configKey) {
  if (!detailRecordState) return;
  const pageConfig = RECORD_PAGE_CACHE[detailRecordState.objectName];
  let config = null;
  if (pageConfig && pageConfig.regions) {
    for (const r of Object.keys(pageConfig.regions)) {
      const list = pageConfig.regions[r] || [];
      const found = list.find(c => c && typeof c === 'object' && c.name === 'related-lists');
      if (found && found.relatedLists) {
        config = found.relatedLists.find(item => item.key === configKey);
        if (config) break;
      }
    }
  }
  if (!config) {
    config = getRelatedListConfigs(detailRecordState.objectName).find(c => c.key === configKey);
  }
  if (!config) return;

  try {
    const data = await api(`/api/${detailRecordState.objectName}/${detailRecordState.id}/related`);
    const list = (data.lists || []).find(l => l.key === configKey) || { records: [], totalSize: 0 };
    
    const modalHtml = `
      <div class="modal-overlay open" id="viewAllRelatedModal" onclick="closeViewAllRelatedModal()">
        <div class="modal-card" style="width: 800px; max-width: 90%; max-height: 80vh; overflow-y: auto;" onclick="event.stopPropagation()">
          <div class="modal-header">
            <h3>${escapeHtml(config.title)} (${list.totalSize || list.records.length})</h3>
            <button class="modal-close" onclick="closeViewAllRelatedModal()">×</button>
          </div>
          <div class="modal-body" style="padding: 20px;">
            <div class="mini-table-wrap">
              <table class="mini-table">
                <thead>
                  <tr>
                    ${(config.fields || ['Name']).map(f => `<th>${escapeHtml(labelFor(f))}</th>`).join('')}
                  </tr>
                </thead>
                <tbody>
                  ${(list.records || []).map(record => `
                    <tr onclick="closeViewAllRelatedModal(); openRecordDetail('${config.objectName}', '${escapeJs(record.Id)}')">
                      ${(config.fields || ['Name']).map(f => `<td>${renderRelatedCell(config.objectName, record, f)}</td>`).join('')}
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    `;
    
    document.body.insertAdjacentHTML('beforeend', modalHtml);
  } catch (err) {
    toast('Error loading related records', 'err');
  }
}

function closeViewAllRelatedModal() {
  const el = document.getElementById('viewAllRelatedModal');
  if (el) el.remove();
}

function initializeEmailComposer() {
  const recipient = defaultEmailRecipient();
  emailComposerState = {
    fromOptions: [],
    fromValue: "user:",
    to: recipient ? [recipient] : [],
    cc: [],
    bcc: [],
    showCc: false,
    showBcc: true,
    files: [],
    templates: [],
    templatePromise: null,
    templateMenuOpen: false,
    mergeMenuOpen: false,
  };
  loadEmailFromOptions();
  if (canReadObject("Campaign")) loadEmailTemplates();
}

async function loadEmailFromOptions() {
  try {
    const data = await api("/api/email/from-addresses");
    emailComposerState.fromOptions = data.records || [];
    const selected =
      emailComposerState.fromOptions.find((item) => item.type === "user") ||
      emailComposerState.fromOptions[0];
    emailComposerState.fromValue = selected
      ? `${selected.type}:${selected.id || selected.email}`
      : "user:";
    renderEmailFromOptions();
  } catch (err) {
    emailComposerState.fromOptions = [
      {
        type: "user",
        id: currentUser?.id || "",
        label: currentUser?.name || currentUser?.username || "Current User",
        email: currentUser?.email || currentUser?.username || "",
      },
    ];
    renderEmailFromOptions();
  }
}

async function loadEmailTemplates() {
  if (emailComposerState.templatePromise)
    return emailComposerState.templatePromise;
  emailComposerState.templatePromise = (async () => {
    try {
      emailComposerState.templateError = "";
      emailComposerState.templateLoading = true;
      const data = await api("/api/campaigns/activity/email-templates");
      emailComposerState.templates = data.records || [];
    } catch (err) {
      emailComposerState.templates = [];
      emailComposerState.templateError =
        err.message || "Could not load templates";
    } finally {
      emailComposerState.templateLoading = false;
      emailComposerState.templatePromise = null;
    }
  })();
  return emailComposerState.templatePromise;
}

function renderEmailFromOptions() {
  const select = $("activityEmailFrom");
  if (!select) return;
  select.innerHTML = emailComposerState.fromOptions
    .map(
      (item) => `
    <option value="${escapeHtml(`${item.type}:${item.id || item.email}`)}" ${emailComposerState.fromValue === `${item.type}:${item.id || item.email}` ? "selected" : ""}>
      ${escapeHtml(item.label || item.email)}${item.email ? ` &lt;${escapeHtml(item.email)}&gt;` : ""}
    </option>
  `,
    )
    .join("");
}

function emailRecipientRow(kind, label, required = false) {
  const recipients = emailComposerState[kind] || [];
  return `
    <div class="activity-email-row email-recipient-row" id="activityEmailRow-${escapeHtml(kind)}">
      <label class="form-label ${required ? "required" : ""}" for="activityEmailSearch-${escapeHtml(kind)}">${escapeHtml(label)}</label>
      <div class="email-token-box" onclick="$('activityEmailSearch-${escapeJs(kind)}')?.focus()">
        ${recipients
          .map(
            (item, index) => `
          <span class="email-token">
            ${objectIcon(item.object)}
            <span>${escapeHtml(item.label || item.email)}</span>
            <button type="button" aria-label="Remove ${escapeHtml(item.label || item.email)}" onclick="removeEmailRecipient('${escapeJs(kind)}', ${index})">&times;</button>
          </span>
        `,
          )
          .join("")}
        <input id="activityEmailSearch-${escapeHtml(kind)}" placeholder="${recipients.length ? "" : "Search people..."}"
          oninput="searchEmailRecipients('${escapeJs(kind)}', this.value)" autocomplete="off">
      </div>
      <div class="email-recipient-results" id="activityEmailResults-${escapeHtml(kind)}"></div>
      ${
        kind === "to"
          ? `
        <div class="email-row-actions">
          <button type="button" onclick="toggleEmailRow('cc')">Cc</button>
          <button type="button" onclick="toggleEmailRow('bcc')">Bcc</button>
        </div>
      `
          : ""
      }
    </div>
  `;
}

function renderEmailComposer() {
  const relatedLookup = activityLookupControl(
    "what",
    "Related To",
    ["Account", "Opportunity", "Case", "Campaign"],
    "Search Accounts...",
  );
  return `
    <div class="activity-email-form activity-email-composer">
      <div class="activity-email-row">
        <label class="form-label required" for="activityEmailFrom">From</label>
        <select class="form-ctrl" id="activityEmailFrom" onchange="emailComposerState.fromValue = this.value"></select>
      </div>
      ${emailRecipientRow("to", "To", true)}
      <div id="activityEmailCcWrap" style="${emailComposerState.showCc ? "" : "display:none"}">${emailRecipientRow("cc", "Cc")}</div>
      <div id="activityEmailBccWrap" style="${emailComposerState.showBcc ? "" : "display:none"}">${emailRecipientRow("bcc", "Bcc")}</div>
      <div class="activity-email-row">
        <label class="form-label required" for="activitySubject">Subject</label>
        <input class="form-ctrl" id="activitySubject" placeholder="Enter Subject..." required>
      </div>
      <div class="activity-template-lock" id="activityTemplateNotice" style="display:none">
        <strong>i</strong>
        <span>Some sections of this template are locked to prevent changes.</span>
        <button type="button" onclick="clearActivityTemplate()">Clear Template</button>
      </div>
      <div class="activity-email-toolbar">
        <select title="Font" onchange="formatEmailBody('fontName', this.value)">
          <option value="">Font</option>
          <option value="Arial">Arial</option>
          <option value="Georgia">Georgia</option>
          <option value="Tahoma">Tahoma</option>
          <option value="Times New Roman">Times</option>
        </select>
        <select title="Size" onchange="formatEmailBody('fontSize', this.value)">
          <option value="">Size</option>
          <option value="2">Small</option>
          <option value="3">Normal</option>
          <option value="4">Large</option>
          <option value="5">X-Large</option>
        </select>
        <button type="button" title="Bold" onclick="formatEmailBody('bold')"><strong>B</strong></button>
        <button type="button" title="Italic" onclick="formatEmailBody('italic')"><em>I</em></button>
        <button type="button" title="Underline" onclick="formatEmailBody('underline')"><u>U</u></button>
        <button type="button" title="Link" onclick="createEmailLink()">${utilityIconSvg("link")}</button>
        <button type="button" title="Preview" onclick="previewEmailBody()">${utilityIconSvg("preview")}</button>
      </div>
      <div class="activity-email-body rich-email-body" id="activityBody" contenteditable="true" data-placeholder="Write your email..."></div>
      <div class="activity-email-footer-tools">
        <button type="button" title="Attach File" onclick="$('activityAttachmentInput').click()">${utilityIconSvg("attach")}</button>
        <button type="button" title="Insert, create, or update template" onclick="toggleTemplateMenu()">${utilityIconSvg("template")}</button>
        <input id="activityAttachmentInput" type="file" accept=".pdf,application/pdf" multiple onchange="handleActivityAttachments(this.files)" hidden>
        <div class="activity-popover" id="activityMergeMenu"></div>
        <div class="activity-file-list" id="activityFileList"></div>
      </div>
      <div class="activity-email-related">
        ${relatedLookup}
      </div>
    </div>
  `;
}

function rerenderEmailComposerPreservingFields() {
  const draft = collectActivityDraft();
  $("activityModalBody").innerHTML = renderEmailComposer();
  restoreActivityDraft(draft);
  renderEmailFromOptions();
  renderActivityFiles();
}

function toggleEmailRow(kind) {
  emailComposerState[kind === "cc" ? "showCc" : "showBcc"] = true;
  rerenderEmailComposerPreservingFields();
}

function removeEmailRecipient(kind, index) {
  emailComposerState[kind].splice(index, 1);
  rerenderEmailComposerPreservingFields();
}

async function searchEmailRecipients(kind, value) {
  const results = $(`activityEmailResults-${kind}`);
  const q = String(value || "").trim();
  if (!results) return;
  if (!q) {
    results.classList.remove("open");
    results.innerHTML = "";
    return;
  }

  try {
    const groups = await Promise.all(
      ["Lead", "Contact", "User"].map(async (objectName) => {
        const data = await api(
          `/api/lookup/${objectName}?search=${encodeURIComponent(q)}`,
        );
        return {
          objectName,
          records: (data.records || [])
            .filter((record) => record.Email)
            .slice(0, 5),
        };
      }),
    );
    results.innerHTML =
      groups
        .flatMap(({ objectName, records }) =>
          records.map((record) => {
            const label = record.Name || record.Email;
            const sub = record.Email || record.Username || record.Company || "";
            return `
        <button type="button" class="activity-lookup-item" onclick="selectEmailRecipient('${escapeJs(kind)}', '${escapeJs(objectName)}', '${escapeJs(record.Id)}', '${escapeJs(label)}', '${escapeJs(record.Email)}')">
          ${objectIcon(objectName)}
          <span><strong>${escapeHtml(label)}</strong>${sub ? `<small>${escapeHtml(sub)}</small>` : ""}</span>
        </button>
      `;
          }),
        )
        .join("") || '<div class="lookup-empty">No matches</div>';
    results.classList.add("open");
  } catch (err) {
    results.innerHTML = `<div class="lookup-empty">${escapeHtml(err.message)}</div>`;
    results.classList.add("open");
  }
}

function selectEmailRecipient(kind, objectName, id, label, email) {
  const existing = new Set(
    (emailComposerState[kind] || []).map((item) => item.id || item.email),
  );
  if (!existing.has(id || email))
    emailComposerState[kind].push({ object: objectName, id, label, email });
  rerenderEmailComposerPreservingFields();
}

function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || "");
      resolve(result.includes(",") ? result.split(",").pop() : result);
    };
    reader.onerror = () =>
      reject(reader.error || new Error(`Could not read ${file.name}`));
    reader.readAsDataURL(file);
  });
}

async function handleActivityAttachments(files) {
  const selected = Array.from(files || []);
  const pdfs = selected.filter(
    (file) => file.type === "application/pdf" || /\.pdf$/i.test(file.name),
  );
  if (selected.length !== pdfs.length)
    toast("Only PDF attachments are allowed", "info");
  if (!pdfs.length) return;

  try {
    const prepared = await Promise.all(
      pdfs.map(async (file) => ({
        name: file.name,
        size: file.size,
        type: file.type || "application/pdf",
        data: await readFileAsBase64(file),
      })),
    );
    emailComposerState.files = [
      ...(emailComposerState.files || []),
      ...prepared,
    ];
    renderActivityFiles();
  } catch (err) {
    toast(err.message || "Could not read attachment", "err");
  } finally {
    if ($("activityAttachmentInput")) $("activityAttachmentInput").value = "";
  }
}

function renderActivityFiles() {
  const list = $("activityFileList");
  if (!list) return;
  list.innerHTML = (emailComposerState.files || [])
    .map(
      (file, index) => `
    <span class="activity-file-pill">${escapeHtml(file.name)}<button type="button" onclick="removeActivityFile(${index})">&times;</button></span>
  `,
    )
    .join("");
}

function removeActivityFile(index) {
  emailComposerState.files.splice(index, 1);
  renderActivityFiles();
}

function focusEmailBody() {
  const body = $("activityBody");
  if (!body) return null;
  body.focus();
  return body;
}

function formatEmailBody(command, value = null) {
  const body = focusEmailBody();
  if (!body) return;
  document.execCommand(command, false, value);
}

function createEmailLink() {
  const body = focusEmailBody();
  if (!body) return;
  const url = window.prompt("Enter URL");
  if (!url) return;
  document.execCommand("createLink", false, url);
}

function previewEmailBody() {
  const text = activityFieldValue("activityBody");
  if (!text.trim()) {
    toast("Email body is empty", "info");
    return;
  }
  const preview = window.open("", "_blank", "width=720,height=640");
  if (!preview) return;
  preview.document.write(
    `<!doctype html><title>Email Preview</title><body style="font-family:Arial,sans-serif;padding:24px">${text}</body>`,
  );
  preview.document.close();
}

function toggleMergeMenu() {
  const menu = $("activityMergeMenu");
  if (!menu) return;
  const fields = [
    "Recipient.FirstName",
    "Recipient.LastName",
    "Recipient.Email",
    "Sender.Name",
    "Sender.Title",
    "Sender.Email",
    "Organization.Name",
  ];
  menu.innerHTML = fields
    .map(
      (field) =>
        `<button type="button" onclick="insertMergeField('${escapeJs(field)}')">{{{${escapeHtml(field)}}}}</button>`,
    )
    .join("");
  menu.classList.toggle("open");
  $("activityTemplateMenu")?.classList.remove("open");
}

function insertMergeField(field) {
  const body = $("activityBody");
  if (!body) return;
  const token = `{{{${field}}}}`;
  const start = body.selectionStart || body.value.length;
  const end = body.selectionEnd || start;
  body.value = `${body.value.slice(0, start)}${token}${body.value.slice(end)}`;
  body.focus();
  body.setSelectionRange(start + token.length, start + token.length);
  $("activityMergeMenu")?.classList.remove("open");
}

async function toggleTemplateMenu() {
  ensureActivityTemplatePicker();
  $("activityTemplateOverlay").classList.add("open");
  await refreshActivityTemplatePicker();
}

function ensureActivityTemplatePicker() {
  if ($("activityTemplateOverlay")) return;
  const overlay = document.createElement("div");
  overlay.className = "activity-suboverlay";
  overlay.id = "activityTemplateOverlay";
  overlay.innerHTML = `
    <div class="activity-template-picker">
      <button type="button" class="activity-template-close" onclick="closeActivityTemplatePicker()">&times;</button>
      <div class="activity-template-picker-head">
        <h3>Insert Email Template</h3>
        <span>Select a template for Contacts or Leads</span>
      </div>
      <div class="activity-template-filters">
        <label>
          <span>Search</span>
          <input id="activityTemplateSearch" placeholder="Search templates..." oninput="renderActivityTemplateRows()">
        </label>
      </div>
      <div class="activity-template-table-wrap">
        <table class="activity-template-table">
          <thead>
            <tr><th>Name</th><th>Template Type</th><th>Description</th></tr>
          </thead>
          <tbody id="activityTemplateRows"></tbody>
        </table>
      </div>
      <div class="activity-template-picker-foot">
        <button type="button" class="btn btn-ghost" onclick="closeActivityTemplatePicker()">Cancel</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
}

function closeActivityTemplatePicker() {
  $("activityTemplateOverlay")?.classList.remove("open");
}

async function refreshActivityTemplatePicker() {
  const rows = $("activityTemplateRows");
  if (rows)
    rows.innerHTML = '<tr><td colspan="3">Loading templates...</td></tr>';
  if (!emailComposerState.templates?.length) {
    await loadEmailTemplates();
  }
  renderActivityTemplateRows();
}

function renderActivityTemplateRows() {
  const rows = $("activityTemplateRows");
  if (!rows) return;
  const search = String($("activityTemplateSearch")?.value || "").toLowerCase();
  let templates = emailComposerState.templates || [];
  if (search) {
    templates = templates.filter((template) =>
      [
        template.Name,
        template.Subject,
        template.Description,
        template.TemplateType,
      ].some((value) =>
        String(value || "")
          .toLowerCase()
          .includes(search),
      ),
    );
  }
  if (emailComposerState.templateError) {
    rows.innerHTML = `<tr><td colspan="3">${escapeHtml(emailComposerState.templateError)}</td></tr>`;
    return;
  }
  rows.innerHTML =
    templates
      .map(
        (template) => `
    <tr onclick="selectActivityTemplate('${escapeJs(template.Id)}')">
      <td><button type="button" onclick="event.stopPropagation(); selectActivityTemplate('${escapeJs(template.Id)}')">${escapeHtml(template.Name || "(No name)")}</button></td>
      <td>${escapeHtml(template.TemplateType || "")}</td>
      <td>${escapeHtml(template.Description || template.Subject || "")}</td>
    </tr>
  `,
      )
      .join("") ||
    '<tr><td colspan="3">No templates found. Check EmailTemplate access or create an active email template in Salesforce.</td></tr>';
}

async function selectActivityTemplate(templateId) {
  try {
    const primary = emailComposerState.to[0] || {};
    const template =
      (emailComposerState.templates || []).find(
        (item) => item.Id === templateId,
      ) || {};
    if ($("activitySubject"))
      $("activitySubject").value = template.Subject || template.Name || "";
    const data = await api("/api/activity-email-preview", {
      method: "POST",
      body: JSON.stringify({
        templateId,
        recipientId: primary.id || "",
        recipientObject: primary.object || "",
        relatedRecordId:
          activityLookupState.what?.id || detailRecordState?.id || "",
        relatedObject:
          activityLookupState.what?.object ||
          detailRecordState?.objectName ||
          "",
      }),
    });
    if ($("activitySubject"))
      $("activitySubject").value =
        data.subject || template.Subject || template.Name || "";
    if ($("activityBody"))
      $("activityBody").innerHTML =
        data.html || escapeHtml(data.text || "").replace(/\n/g, "<br>");
    if ($("activityTemplateNotice"))
      $("activityTemplateNotice").style.display = "flex";
    closeActivityTemplatePicker();
  } catch (err) {
    toast(err.message, "err");
  }
}

function clearActivityTemplate() {
  if ($("activitySubject")) $("activitySubject").value = "";
  if ($("activityBody")) $("activityBody").innerHTML = "";
  if ($("activityTemplateNotice"))
    $("activityTemplateNotice").style.display = "none";
}

function emailAddressList(kind) {
  return (emailComposerState[kind] || [])
    .map((item) => item.email)
    .filter(Boolean)
    .join(", ");
}

function collectActivityDraft() {
  return {
    subject: activityFieldValue("activitySubject"),
    dueDate: activityFieldValue("activityDueDate"),
    status: activityFieldValue("activityStatus"),
    comments: activityFieldValue("activityComments"),
    startDate: activityFieldValue("activityStartDate"),
    startTime: activityFieldValue("activityStartTime"),
    endDate: activityFieldValue("activityEndDate"),
    endTime: activityFieldValue("activityEndTime"),
    allDay: Boolean($("activityAllDay")?.checked),
    location: activityFieldValue("activityLocation"),
    to: activityFieldValue("activityTo"),
    body: activityFieldValue("activityBody"),
  };
}

function restoreActivityDraft(draft = {}) {
  Object.entries({
    activitySubject: draft.subject,
    activityDueDate: draft.dueDate,
    activityStatus: draft.status,
    activityComments: draft.comments,
    activityStartDate: draft.startDate,
    activityStartTime: draft.startTime,
    activityEndDate: draft.endDate,
    activityEndTime: draft.endTime,
    activityLocation: draft.location,
    activityTo: draft.to,
    activityBody: draft.body,
  }).forEach(([id, value]) => {
    if ($(id) && value !== undefined) {
      if ($(id).isContentEditable) $(id).innerHTML = value;
      else $(id).value = value;
    }
  });
  if ($("activityAllDay")) $("activityAllDay").checked = Boolean(draft.allDay);
}

function rerenderActivityFormPreservingFields() {
  const overlay = $("activityOverlay");
  const type = overlay?.dataset.type || "task";
  const draft = collectActivityDraft();
  $("activityModalBody").innerHTML = renderActivityForm(type);
  restoreActivityDraft(draft);
}

function ensureActivityModal() {
  let overlay = $("activityOverlay");
  const hasCompleteModal =
    overlay?.querySelector("#activityModalIcon") &&
    overlay?.querySelector("#activityModalTitle") &&
    overlay?.querySelector("#activityModalBody") &&
    overlay?.querySelector("#activitySaveBtn");
  if (overlay && hasCompleteModal) return overlay;
  if (overlay) overlay.remove();

  overlay = document.createElement("div");
  overlay.className = "overlay activity-overlay";
  overlay.id = "activityOverlay";
  overlay.setAttribute(
    "onclick",
    "overlayClick(event, 'activityOverlay', closeActivityModal)",
  );
  overlay.innerHTML = `
    <div class="modal activity-modal" onclick="event.stopPropagation()">
      <div class="modal-head activity-modal-head">
        <div class="modal-title-group">
          <span class="activity-modal-icon activity-icon-task" id="activityModalIcon">${activityIconImage("task")}</span>
          <h2 id="activityModalTitle">New Activity</h2>
        </div>
        <button class="close-btn" onclick="closeActivityModal()">
          <svg viewBox="0 0 20 20" width="18" height="18" fill="currentColor">
            <path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd"/>
          </svg>
        </button>
      </div>
      <form id="activityForm" onsubmit="event.preventDefault(); saveActivity();">
        <div class="modal-body activity-modal-body" id="activityModalBody"></div>
        <div class="modal-foot">
          <button type="button" class="btn btn-ghost" onclick="closeActivityModal()">Cancel</button>
          <button type="submit" class="btn btn-primary" id="activitySaveBtn">Save</button>
        </div>
      </form>
    </div>
  `;
  document.body.appendChild(overlay);
  return overlay;
}

function openActivityModal(type) {
  if (!detailRecordState?.id) return;
  if (detailRecordState.recordAccess?.accessLevel !== "edit") {
    toast("You do not have the level of access necessary to perform the operation you requested.", "err");
    return;
  }
  const overlay = ensureActivityModal();
  const titleEl = overlay.querySelector("#activityModalTitle");
  const iconEl = overlay.querySelector("#activityModalIcon");
  const saveBtn = overlay.querySelector("#activitySaveBtn");
  const bodyEl = overlay.querySelector("#activityModalBody");
  if (!titleEl || !iconEl || !saveBtn || !bodyEl) {
    toast("Activity panel is still loading. Please try again.", "err");
    return;
  }
  overlay.dataset.type = type;
  initializeActivityLookups();
  if (type === "email") initializeEmailComposer();
  titleEl.textContent = activityModalTitle(type);
  iconEl.className = `activity-modal-icon ${activityIconClass(type)}`;
  iconEl.innerHTML = activityIconImage(type);
  saveBtn.textContent = type === "email" ? "Send" : "Save";
  bodyEl.innerHTML = renderActivityForm(type);
  if (type === "email") {
    renderEmailFromOptions();
    renderActivityFiles();
  }
  overlay.classList.add("open");
  setTimeout(
    () =>
      bodyEl.querySelector("input, textarea, select")?.focus(),
    0,
  );
}

function renderActivityForm(type) {
  const today = todayInputValue();
  const recipient = currentActivityRecipientEmail();
  const nameLookup = activityLookupControl(
    "who",
    "Name",
    ["Contact", "Lead"],
    "Search Contacts...",
  );
  const relatedLookup = activityLookupControl(
    "what",
    "Related To",
    ["Account", "Opportunity", "Case", "Campaign"],
    "Search Accounts...",
  );
  const ownerLookup = activityLookupControl(
    "owner",
    "Assigned To",
    ["User"],
    "Search Users...",
  );

  if (type === "call") {
    return `
      <div class="activity-form-grid two">
        <div class="form-group">
          <label class="form-label" for="activitySubject">Subject</label>
          <input class="form-ctrl" id="activitySubject" value="Call" required>
        </div>
        <div class="form-group">
          <label class="form-label" for="activityComments">Comments</label>
          <textarea class="form-ctrl" id="activityComments" rows="4"></textarea>
        </div>
        <div class="form-group">
          ${nameLookup}
        </div>
        <div class="form-group">
          ${relatedLookup}
        </div>
      </div>
    `;
  }

  if (type === "event") {
    return `
      <div class="activity-form-grid two">
        <div class="form-section-label span-2">Start</div>
        <div class="form-group">
          <label class="form-label required" for="activityStartDate">Date</label>
          <input type="date" class="form-ctrl" id="activityStartDate" value="${today}" required>
        </div>
        <div class="form-group">
          <label class="form-label required" for="activityStartTime">Time</label>
          <input type="time" class="form-ctrl" id="activityStartTime" value="${addHoursTimeValue(1)}" required>
        </div>
        <div class="form-section-label span-2">End</div>
        <div class="form-group">
          <label class="form-label required" for="activityEndDate">Date</label>
          <input type="date" class="form-ctrl" id="activityEndDate" value="${today}" required>
        </div>
        <div class="form-group">
          <label class="form-label required" for="activityEndTime">Time</label>
          <input type="time" class="form-ctrl" id="activityEndTime" value="${addHoursTimeValue(2)}" required>
        </div>
        <label class="activity-checkbox span-2"><input type="checkbox" id="activityAllDay"> <span>All-Day Event</span></label>
        <div class="form-group span-2">
          <label class="form-label required" for="activitySubject">Subject</label>
          <input class="form-ctrl" id="activitySubject" required>
        </div>
        <div class="form-group span-2">
          ${nameLookup}
        </div>
        <div class="form-group span-2">
          ${relatedLookup}
        </div>
        <div class="form-group span-2">
          ${ownerLookup}
        </div>
        <div class="form-group span-2">
          <label class="form-label" for="activityLocation">Location</label>
          <input class="form-ctrl" id="activityLocation">
        </div>
        <div class="form-group span-2">
          <label class="form-label" for="activityComments">Description</label>
          <textarea class="form-ctrl" id="activityComments" rows="4"></textarea>
        </div>
      </div>
    `;
  }

  if (type === "email") {
    return renderEmailComposer();
  }

  return `
    <div class="activity-form-grid">
      <div class="form-group span-2">
        <label class="form-label required" for="activitySubject">Subject</label>
        <input class="form-ctrl" id="activitySubject" required>
      </div>
      <div class="form-group span-2">
        <label class="form-label" for="activityDueDate">Due Date</label>
        <input type="date" class="form-ctrl" id="activityDueDate" value="${today}">
      </div>
      <div class="form-group span-2">
        ${nameLookup}
      </div>
      <div class="form-group span-2">
        ${relatedLookup}
      </div>
      <div class="form-group span-2">
        ${ownerLookup}
      </div>
      <div class="form-group span-2">
        <label class="form-label required" for="activityStatus">Status</label>
        <select class="form-ctrl" id="activityStatus" required>
          <option>Not Started</option>
          <option>In Progress</option>
          <option>Completed</option>
          <option>Waiting on someone else</option>
          <option>Deferred</option>
        </select>
      </div>
      <div class="form-group span-2">
        <label class="form-label" for="activityComments">Comments</label>
        <textarea class="form-ctrl" id="activityComments" rows="4"></textarea>
      </div>
    </div>
  `;
}

function closeActivityModal() {
  $("activityOverlay")?.classList.remove("open");
}

function activityFieldValue(id) {
  const field = $(id);
  if (!field) return "";
  return field.isContentEditable ? field.innerHTML || "" : field.value || "";
}

async function saveActivity() {
  const overlay = $("activityOverlay");
  const type = overlay?.dataset.type || "task";
  if (!detailRecordState?.id) return;

  const payload = {
    type,
    whoId: activityLookupState.who?.id || "",
    whoObject: activityLookupState.who?.object || "",
    whatId: activityLookupState.what?.id || "",
    whatObject: activityLookupState.what?.object || "",
    ownerId: activityLookupState.owner?.id || "",
  };
  if (type === "task") {
    payload.subject = activityFieldValue("activitySubject");
    payload.dueDate = activityFieldValue("activityDueDate");
    payload.status = activityFieldValue("activityStatus");
    payload.comments = activityFieldValue("activityComments");
  } else if (type === "call") {
    payload.subject = activityFieldValue("activitySubject") || "Call";
    payload.comments = activityFieldValue("activityComments");
    payload.date = todayInputValue();
  } else if (type === "event") {
    payload.subject = activityFieldValue("activitySubject");
    payload.startDate = activityFieldValue("activityStartDate");
    payload.startTime = activityFieldValue("activityStartTime");
    payload.endDate = activityFieldValue("activityEndDate");
    payload.endTime = activityFieldValue("activityEndTime");
    payload.isAllDay = Boolean($("activityAllDay")?.checked);
    payload.location = activityFieldValue("activityLocation");
    payload.comments = activityFieldValue("activityComments");
  } else if (type === "email") {
    const fromOption = emailComposerState.fromOptions.find(
      (item) =>
        `${item.type}:${item.id || item.email}` ===
        emailComposerState.fromValue,
    );
    payload.from = fromOption || null;
    payload.to = emailAddressList("to");
    payload.cc = emailAddressList("cc");
    payload.bcc = emailAddressList("bcc");
    payload.toRecipients = emailComposerState.to || [];
    payload.ccRecipients = emailComposerState.cc || [];
    payload.bccRecipients = emailComposerState.bcc || [];
    payload.attachments = emailComposerState.files || [];
    payload.subject = activityFieldValue("activitySubject");
    payload.body = activityFieldValue("activityBody");
  }

  try {
    $("activitySaveBtn").disabled = true;
    await api(
      `/api/${detailRecordState.objectName}/${detailRecordState.id}/activity`,
      {
        method: "POST",
        body: JSON.stringify(payload),
      },
    );
    toast(
      type === "email"
        ? "Email sent and logged"
        : `${activityModalTitle(type)} saved`,
      "ok",
    );
    closeActivityModal();
    await loadRecordActivity(
      detailRecordState.objectName,
      detailRecordState.id,
    );
  } catch (err) {
    toast(err.message, "err");
  } finally {
    if ($("activitySaveBtn")) $("activitySaveBtn").disabled = false;
  }
}

async function loadRecordActivity(objectName, recordId) {
  const timeline = $("activityTimeline");
  if (!timeline) return;
  timeline.innerHTML =
    '<div class="activity-empty"><p>Loading activities...</p></div>';
  try {
    const data = await api(`/api/${objectName}/${recordId}/activity`);
    recordActivities = data.records || [];
    expandedActivityIds = new Set();
    renderRecordActivity(data.warnings || []);
  } catch (err) {
    timeline.innerHTML = `<div class="error-state compact"><p>${escapeHtml(err.message)}</p></div>`;
  }
}

function renderRecordActivity(warnings = []) {
  const timeline = $("activityTimeline");
  if (!timeline) return;

  const upcoming = recordActivities.filter(isUpcomingActivity);
  const past = recordActivities.filter((item) => !isUpcomingActivity(item));
  const firstPast = past[0] || recordActivities[0];

  if (!recordActivities.length) {
    timeline.innerHTML = `
      ${renderActivityToolbar()}
      ${renderUpcomingSection([])}
      <div class="activity-no-past">No past activity. Past meetings and tasks marked as done show up here.</div>
      ${warnings.length ? `<div class="activity-empty"><p>${escapeHtml(warnings[0])}</p></div>` : ""}
    `;
    return;
  }

  timeline.innerHTML = `
    ${renderActivityToolbar()}
    ${renderUpcomingSection(upcoming)}
    ${
      past.length
        ? `
      <div class="activity-month">
        <span class="activity-month-label">${utilityIconSvg("chevronDown")}${escapeHtml(formatActivityMonth(firstPast.when))}</span>
        <span>This Month</span>
      </div>
      <div class="activity-list">${past.map(renderActivityItem).join("")}</div>
      <div class="activity-end">No more past activities to load.</div>
    `
        : '<div class="activity-no-past">No past activity. Past meetings and tasks marked as done show up here.</div>'
    }
  `;
}

function renderActivityToolbar() {
  const canCreateActivity =
    currentDetailCanEdit() && canDo(detailRecordState?.objectName || currentObject, "can_create");
  return `
    <div class="activity-actions" style="${canCreateActivity ? "" : "display:none"}">
      <div class="activity-action-group activity-action-task" title="New Task">
        <button class="activity-action" aria-label="New Task" onclick="openActivityModal('task')">${activityIconImage("task")}</button>
      </div>
      <div class="activity-action-group activity-action-call" title="Log a Call">
        <button class="activity-action" aria-label="Log a Call" onclick="openActivityModal('call')">${activityIconImage("call")}</button>
      </div>
      <div class="activity-action-group activity-action-event" title="New Event">
        <button class="activity-action" aria-label="New Event" onclick="openActivityModal('event')">${activityIconImage("event")}</button>
      </div>
      <div class="activity-action-group activity-action-email" title="Email">
        <button class="activity-action" aria-label="Email" onclick="openActivityModal('email')">${activityIconImage("email")}</button>
      </div>
    </div>
    <div class="activity-filter">
      <span>Filters: All time &bull; All activities &bull; All types</span>
      <button class="activity-settings" title="Activity Settings">${utilityIconSvg("settings")}</button>
    </div>
    <div class="activity-links">
      <button class="cell-button-link" onclick="loadRecordActivity('${detailRecordState?.objectName || ""}', '${detailRecordState?.id || ""}')">Refresh</button>
      <span>&bull;</span>
      <button class="cell-button-link" onclick="toggleAllActivities(true)">Expand All</button>
      <span>&bull;</span>
      <button class="cell-button-link" onclick="toggleAllActivities(false)">Collapse All</button>
    </div>
  `;
}

function renderUpcomingSection(items) {
  return `
    <button class="activity-section-title" onclick="toggleActivitySection(this)" aria-expanded="true">
      <span class="activity-section-chevron">${utilityIconSvg("chevronDown")}</span>
      <span>Upcoming &amp; Overdue</span>
    </button>
    ${
      items.length
        ? `<div class="activity-list">${items.map(renderActivityItem).join("")}</div>`
        : `<div class="activity-empty standard-empty">
          <p>No activities to show.</p>
          <p>Get started by sending an email, scheduling a task, and more.</p>
        </div>`
    }
  `;
}

function renderActivityItem(item) {
  const expanded = expandedActivityIds.has(item.id);
  const activityObject = activityRecordObject(item);
  const target =
    item.targetId && item.targetObject && OBJECT_META[item.targetObject]
      ? `<button class="cell-button-link" onclick="openRecordDetail('${item.targetObject}', '${item.targetId}')">${escapeHtml(item.target)}</button>`
      : escapeHtml(item.target || "");
  const meta = [formatActivityTime(item.when), item.status]
    .filter(Boolean)
    .join(" | ");
  const actionText = target
    ? `${escapeHtml(item.actor || "Salesforce")} logged activity for ${target}`
    : `${escapeHtml(item.actor || "Salesforce")} logged activity`;
  const details = renderActivityDetails(item);

  return `
    <div class="activity-item ${expanded ? "expanded" : ""}" data-activity-id="${escapeHtml(item.id)}">
      <button class="activity-row-toggle" aria-label="${expanded ? "Collapse" : "Expand"} activity" onclick="toggleActivity('${item.id}')">
        ${utilityIconSvg(expanded ? "chevronDown" : "chevronRight")}
      </button>
      <div class="activity-icon ${activityIconClass(item.type)}">${activityIconLabel(item.type)}</div>
      <div class="activity-content">
        <div class="activity-title-row">
          <button class="cell-button-link activity-title" onclick="openActivityRecordDetail('${escapeJs(activityObject)}', '${escapeJs(item.id)}')">${escapeHtml(item.subject || item.type)}</button>
          <span>${escapeHtml(meta)}</span>
        </div>
        <div class="activity-meta">
          ${actionText}
        </div>
        ${expanded ? details : ""}
      </div>
      <button class="activity-menu" aria-label="Activity actions">${utilityIconSvg("chevronDown")}</button>
    </div>
  `;
}

function activityRecordObject(item) {
  if (item.objectName && OBJECT_META[item.objectName]) return item.objectName;
  const fromId = objectFromId(item.id);
  if (fromId && OBJECT_META[fromId]) return fromId;
  const type = String(item.type || "").toLowerCase();
  if (type.includes("email")) return "EmailMessage";
  if (type.includes("event")) return "Event";
  return "Task";
}

function openActivityRecordDetail(objectName, id) {
  if (!id || !OBJECT_META[objectName]) return;
  openRecordDetail(objectName, id);
}

function renderActivityDetails(item) {
  const body = String(item.body || "").trim();
  const rows = [
    ["Scheduled Date", formatActivityTime(item.when)],
    ["Status", item.status || (item.isClosed ? "Completed" : "")],
    ["Assigned To", item.actor || ""],
  ].filter(([, value]) => value);

  return `
    <div class="activity-detail-box">
      <div class="activity-detail-grid">
        ${rows
          .map(
            ([label, value]) => `
          <div>
            <div class="activity-detail-label">${escapeHtml(label)}</div>
            <div>${escapeHtml(value)}</div>
          </div>
        `,
          )
          .join("")}
      </div>
      ${
        body
          ? `
        <div class="activity-detail-label">Text Body</div>
        <div class="activity-detail-body">${escapeHtml(body)}</div>
      `
          : ""
      }
    </div>
  `;
}

function toggleActivity(id) {
  if (expandedActivityIds.has(id)) expandedActivityIds.delete(id);
  else expandedActivityIds.add(id);
  renderRecordActivity();
}

function toggleAllActivities(expand) {
  expandedActivityIds = new Set(
    expand ? recordActivities.map((item) => item.id) : [],
  );
  renderRecordActivity();
}

function toggleActivitySection(button) {
  const expanded = button.getAttribute("aria-expanded") !== "false";
  button.setAttribute("aria-expanded", String(!expanded));
  const section = button.nextElementSibling;
  if (section) section.style.display = expanded ? "none" : "";
  const chevron = button.querySelector(".activity-section-chevron");
  if (chevron)
    chevron.innerHTML = utilityIconSvg(
      expanded ? "chevronRight" : "chevronDown",
    );
}

function activityIconLabel(type) {
  return activityIconImage(type);
}

function activityIconClass(type) {
  return `activity-icon-${activityIconKey(type)}`;
}

function formatActivityTime(value) {
  if (!value) return "";
  if (isDateOnlyValue(value)) return formatActivityDateOnly(value);
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatActivityMonth(value) {
  const date = isDateOnlyValue(value)
    ? dateFromDateOnly(value)
    : value
      ? new Date(value)
      : new Date();
  return date.toLocaleString(undefined, { month: "long", year: "numeric" });
}

function isDateOnlyValue(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ""));
}

function dateFromDateOnly(value) {
  const [year, month, day] = String(value || "")
    .split("-")
    .map(Number);
  return new Date(year, month - 1, day);
}

function formatActivityDateOnly(value) {
  const date = dateFromDateOnly(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString(undefined, { month: "short", day: "numeric" });
}

function isUpcomingActivity(item) {
  if (item.isClosed) return false;
  const type = String(item.type || "").toLowerCase();
  if (type.includes("task") || type.includes("call") || type.includes("event"))
    return true;
  const when = isDateOnlyValue(item.when)
    ? dateFromDateOnly(item.when)
    : item.when
      ? new Date(item.when)
      : null;
  if (!when || Number.isNaN(when.getTime())) return false;
  return when.getTime() >= new Date().setHours(0, 0, 0, 0);
}

function toggleCampaignMemberSelection(id, checked) {
  if (checked) campaignMemberSelection.add(id);
  else campaignMemberSelection.delete(id);
}

function toggleAllCampaignMembers(checked) {
  campaignMemberSelection = new Set(
    checked
      ? campaignMembers
          .filter((member) => member.email)
          .map((member) => member.id)
      : [],
  );
  renderCampaignMembers();
}

async function openCampaignMemberModal(objectName) {
  if (!activeCampaign?.Id) return;
  if (!canReadObject("Campaign") || !canReadObject(objectName)) return;
  memberCandidateObject = objectName;
  memberCandidateSelection = new Set();
  memberCandidateFilters = [];
  memberCandidatePage = 0;
  memberCandidateTotal = 0;
  $("campaignMemberTitle").textContent = `Add ${objectName}s to Campaign`;
  $("campaignMemberSearch").value = "";
  $("campaignMemberOverlay").classList.add("open");
  const fSel = $("filterFieldSelect");
  if (fSel) fSel.innerHTML = "<option>Loading fields...</option>";
  try {
    const d = await api(`/api/metadata/filterable-fields/${objectName}`);
    memberCandidateFields = d.fields || [];
    if (objectName === "Contact") {
      memberCandidateFields.unshift(
        { name: "Account.Name", label: "Account Name", type: "string", picklistValues: [] },
        { name: "Account.Industry", label: "Account Industry", type: "string", picklistValues: [] }
      );
    }
    if (fSel) fSel.innerHTML = memberCandidateFields.map(f => `<option value="${f.name}">${escapeHtml(f.label)}</option>`).join("");
    if (memberCandidateFields.length) onFilterFieldChange(memberCandidateFields[0].name);
    renderActiveFilters();
    await loadCampaignCandidates();
  } catch (err) {
    toast(`Failed to load fields: ${err.message}`, "err");
    await loadCampaignCandidates();
  }
}

function closeCampaignMemberModal() {
  $("campaignMemberOverlay").classList.remove("open");
}

function onFilterFieldChange(fieldName) {
  const fm = memberCandidateFields.find(f => f.name === fieldName);
  if (!fm) return;
  const opSel = $("filterOperatorSelect");
  const t = fm.type;
  let ops;
  if (t === "boolean") {
    ops = [
      {v:"equals",l:"equals"},
      {v:"not_equal",l:"not equal"},
      {v:"is_null",l:"is empty/blank"},
      {v:"is_not_null",l:"has value"}
    ];
  } else if (["double","integer","currency","percent","date","datetime"].includes(t)) {
    ops = [
      {v:"equals",l:"equals"},
      {v:"not_equal",l:"not equal"},
      {v:"greater_than",l:"greater than"},
      {v:"less_than",l:"less than"},
      {v:"is_null",l:"is empty/blank"},
      {v:"is_not_null",l:"has value"}
    ];
  } else if (t === "picklist") {
    ops = [
      {v:"equals",l:"equals"},
      {v:"not_equal",l:"not equal"},
      {v:"is_null",l:"is empty/blank"},
      {v:"is_not_null",l:"has value"}
    ];
  } else {
    ops = [
      {v:"contains",l:"contains"},
      {v:"equals",l:"equals"},
      {v:"starts_with",l:"starts with"},
      {v:"not_equal",l:"not equal"},
      {v:"is_null",l:"is empty/blank"},
      {v:"is_not_null",l:"has value"}
    ];
  }
  if (opSel) opSel.innerHTML = ops.map(o => `<option value="${o.v}">${o.l}</option>`).join("");
  onFilterOperatorChange();
}

function onFilterOperatorChange() {
  const opSel = $("filterOperatorSelect");
  const valC = $("filterValueContainer");
  if (!opSel || !valC) return;
  const op = opSel.value;
  if (op === "is_null" || op === "is_not_null") {
    valC.innerHTML = `<input type="text" id="filterValueInput" class="form-ctrl" value="" disabled placeholder="No value needed">`;
  } else {
    const fSel = $("filterFieldSelect");
    if (!fSel) return;
    const fm = memberCandidateFields.find(f => f.name === fSel.value);
    if (!fm) return;
    const t = fm.type;
    if (t === "boolean") {
      valC.innerHTML = `<select id="filterValueInput" class="form-ctrl"><option value="true">True</option><option value="false">False</option></select>`;
    } else if (t === "picklist" && fm.picklistValues?.length) {
      valC.innerHTML = `<select id="filterValueInput" class="form-ctrl">${fm.picklistValues.map(p => `<option value="${escapeHtml(p.value)}">${escapeHtml(p.label)}</option>`).join("")}</select>`;
    } else if (t === "date" || t === "datetime") {
      valC.innerHTML = `<input type="date" id="filterValueInput" class="form-ctrl">`;
    } else {
      valC.innerHTML = `<input type="text" id="filterValueInput" class="form-ctrl" placeholder="Value...">`;
    }
  }
}

function addFilterCondition() {
  const fSel = $("filterFieldSelect"), opSel = $("filterOperatorSelect"), valEl = $("filterValueInput");
  if (!fSel?.value || !opSel?.value) return;
  const fm = memberCandidateFields.find(f => f.name === fSel.value);
  if (!fm) return;
  const op = opSel.value;
  const isNullOp = (op === "is_null" || op === "is_not_null");
  const val = isNullOp ? "" : (valEl?.value || "").trim();
  if (!isNullOp && !val) { toast("Enter a filter value", "err"); return; }
  
  let displayVal = val;
  if (isNullOp) {
    displayVal = "";
  } else if (valEl.tagName === "SELECT") {
    displayVal = valEl.options[valEl.selectedIndex]?.text || val;
  }
  
  memberCandidateFilters.push({
    field: fSel.value, fieldLabel: fm.label,
    operator: op, operatorLabel: opSel.options[opSel.selectedIndex]?.text || op,
    value: val, displayValue: displayVal
  });
  if (valEl.tagName === "INPUT" && !valEl.disabled) valEl.value = "";
  renderActiveFilters();
  memberCandidatePage = 0;
  loadCampaignCandidates();
}

function removeFilter(i) {
  memberCandidateFilters.splice(i, 1);
  renderActiveFilters();
  memberCandidatePage = 0;
  loadCampaignCandidates();
}

function clearAllFilters() {
  memberCandidateFilters = [];
  renderActiveFilters();
  memberCandidatePage = 0;
  loadCampaignCandidates();
}

function renderActiveFilters() {
  const c = $("activeFiltersList");
  if (!c) return;
  if (!memberCandidateFilters.length) {
    c.innerHTML = `<div class="filter-empty-state">No active filters</div>`;
    return;
  }
  c.innerHTML = memberCandidateFilters.map((f, i) => {
    const detail = (f.operator === "is_null" || f.operator === "is_not_null")
      ? escapeHtml(f.operatorLabel)
      : `${escapeHtml(f.operatorLabel)} "${escapeHtml(f.displayValue)}"`;
    return `
      <div class="active-filter-pill">
        <div class="filter-pill-body">
          <span class="filter-pill-field">${escapeHtml(f.fieldLabel)}</span>
          <span class="filter-pill-detail">${detail}</span>
        </div>
        <button class="filter-pill-remove" onclick="removeFilter(${i})" title="Remove">&times;</button>
      </div>
    `;
  }).join("");
}

function searchCampaignCandidates(value) {
  clearTimeout(lookupTimer);
  lookupTimer = setTimeout(() => { memberCandidatePage = 0; loadCampaignCandidates(); }, 400);
}

async function loadCampaignCandidates() {
  const box = $("campaignMemberCandidates");
  box.innerHTML = '<div class="state-box compact">Loading records...</div>';
  try {
    const sv = $("campaignMemberSearch")?.value?.trim() || "";
    const off = memberCandidatePage * memberCandidateLimit;
    const url = `/api/campaigns/${activeCampaign.Id}/candidates/${memberCandidateObject}?search=${encodeURIComponent(sv)}&limit=${memberCandidateLimit}&offset=${off}&filters=${encodeURIComponent(JSON.stringify(memberCandidateFilters))}`;
    const data = await api(url);
    const records = data.records || [];
    currentCampaignCandidates = records;
    memberCandidateTotal = data.totalSize || 0;
    box.innerHTML = renderCampaignCandidateTable(records);
    const s = memberCandidateTotal === 0 ? 0 : off + 1;
    const e = Math.min(off + memberCandidateLimit, memberCandidateTotal);
    const pgInfo = $("candidatePaginationInfo");
    if (pgInfo) pgInfo.textContent = `Showing ${s}\u2013${e} of ${memberCandidateTotal.toLocaleString()}`;
    const prev = $("prevCandidatePageBtn"), next = $("nextCandidatePageBtn");
    if (prev) prev.disabled = memberCandidatePage === 0;
    if (next) next.disabled = e >= memberCandidateTotal;
    updateCandidateSelectionUI();
  } catch (err) {
    box.innerHTML = `<div class="error-state compact"><p>${escapeHtml(err.message)}</p></div>`;
  }
}

function updateCandidateSelectionUI() {
  const sz = memberCandidateSelection.size;
  const el = $("campaignMemberSelectedCount");
  if (el) el.textContent = `${sz} selected`;
  const cb = $("clearCandidateSelectionBtn");
  if (cb) cb.style.display = sz > 0 ? "inline-flex" : "none";
}

function changeCandidatePage(delta) {
  const np = memberCandidatePage + delta;
  if (np < 0) return;
  if (delta > 0 && (memberCandidatePage + 1) * memberCandidateLimit >= memberCandidateTotal) return;
  memberCandidatePage = np;
  loadCampaignCandidates();
}

function clearCandidateSelection() {
  memberCandidateSelection = new Set();
  updateCandidateSelectionUI();
  $("campaignMemberCandidates").innerHTML = renderCampaignCandidateTable(currentCampaignCandidates);
}

function renderCampaignCandidateTable(records) {
  if (!records.length)
    return '<div class="table-empty"><h3>No records found</h3><p>Try a different search or filter.</p></div>';
  const isContact = memberCandidateObject === "Contact";
  const selectable = records.filter(r => !r.alreadyMember);
  const allSel = selectable.length > 0 && selectable.every(r => memberCandidateSelection.has(r.Id));
  return `
    <table class="mini-table">
      <thead><tr>
        <th><input type="checkbox" aria-label="Select all" ${allSel ? "checked" : ""} onchange="toggleAllCandidateSelection(this.checked)"></th>
        <th>Name</th><th>${isContact ? "Account" : "Company"}</th><th>Phone</th><th>Email</th><th>${isContact ? "Title" : "Status"}</th>
      </tr></thead>
      <tbody>
        ${records.map(r => `
          <tr class="${r.alreadyMember ? "muted-row" : ""}">
            <td><input type="checkbox" value="${r.Id}" ${memberCandidateSelection.has(r.Id) ? "checked" : ""} ${r.alreadyMember ? "disabled" : ""} onchange="toggleCandidateSelection('${r.Id}', this.checked)"></td>
            <td>${escapeHtml(r.Name || "-")}</td>
            <td>${escapeHtml(isContact ? r.Account?.Name || "-" : r.Company || "-")}</td>
            <td>${escapeHtml(r.Phone || "-")}</td>
            <td>${r.Email ? `<a class="cell-email" href="mailto:${escapeHtml(r.Email)}">${escapeHtml(r.Email)}</a>` : '<span class="cell-empty">-</span>'}</td>
            <td>${escapeHtml((isContact ? r.Title : r.Status) || (r.alreadyMember ? "Already member" : "-"))}</td>
          </tr>
        `).join("")}
      </tbody>
    </table>`;
}

function toggleCandidateSelection(id, checked) {
  if (checked) memberCandidateSelection.add(id);
  else memberCandidateSelection.delete(id);
  updateCandidateSelectionUI();
}

function toggleAllCandidateSelection(checked) {
  currentCampaignCandidates.filter(r => !r.alreadyMember).forEach(r => {
    if (checked) memberCandidateSelection.add(r.Id);
    else memberCandidateSelection.delete(r.Id);
  });
  updateCandidateSelectionUI();
  $("campaignMemberCandidates").innerHTML = renderCampaignCandidateTable(currentCampaignCandidates);
}

async function addSelectedCampaignMembers() {
  const ids = [...memberCandidateSelection];
  if (!ids.length) { toast("Select at least one record", "err"); return; }
  try {
    $("addCampaignMembersBtn").disabled = true;
    const result = await api(`/api/campaigns/${activeCampaign.Id}/members`, {
      method: "POST", body: JSON.stringify({ object: memberCandidateObject, ids }),
    });
    toast(`${result.created || 0} members added`, "ok");
    closeCampaignMemberModal();
    await loadCampaignMembers(activeCampaign.Id);
  } catch (err) { toast(err.message, "err"); }
  finally { $("addCampaignMembersBtn").disabled = false; }
}

async function openCampaignEmailModal() {
  if (!activeCampaign?.Id) return;
  if (!canReadObject("Campaign")) return;
  if (!campaignMemberSelection.size) {
    toast("Select campaign members with email first", "err");
    return;
  }
  $("campaignEmailOverlay").classList.add("open");
  $("emailTemplateSelect").innerHTML =
    '<option value="">Loading templates...</option>';
  $("emailRecipientCount").textContent =
    `${campaignMemberSelection.size} recipients`;
  $("emailPreviewSubject").textContent = "Select a template to preview.";
  $("emailPreviewBody").innerHTML = "";
  try {
    const data = await api(
      `/api/campaigns/${activeCampaign.Id}/email-templates`,
    );
    emailTemplates = data.records || [];
    $("emailTemplateSelect").innerHTML = `
      <option value="">Select template...</option>
      ${emailTemplates.map((template) => `<option value="${template.Id}">${escapeHtml(template.Name)}${template.Subject ? ` - ${escapeHtml(template.Subject)}` : ""}</option>`).join("")}
    `;
  } catch (err) {
    $("emailTemplateSelect").innerHTML =
      '<option value="">Could not load templates</option>';
    $("emailPreviewBody").innerHTML =
      `<div class="error-state compact"><p>${escapeHtml(err.message)}</p></div>`;
  }
}

function closeCampaignEmailModal() {
  $("campaignEmailOverlay").classList.remove("open");
}

async function loadCampaignEmailPreview() {
  const templateId = $("emailTemplateSelect").value;
  if (!templateId) {
    $("emailPreviewSubject").textContent = "Select a template to preview.";
    $("emailPreviewBody").innerHTML = "";
    return;
  }
  $("emailPreviewSubject").textContent = "Loading preview...";
  $("emailPreviewBody").innerHTML = "";
  try {
    const data = await api(
      `/api/campaigns/${activeCampaign.Id}/email-preview`,
      {
        method: "POST",
        body: JSON.stringify({
          templateId,
          memberIds: [...campaignMemberSelection],
        }),
      },
    );
    $("emailPreviewSubject").textContent = data.subject || "(No subject)";
    $("emailPreviewBody").innerHTML =
      data.html || `<pre>${escapeHtml(data.text || "")}</pre>`;
  } catch (err) {
    $("emailPreviewSubject").textContent = "Preview failed";
    $("emailPreviewBody").innerHTML =
      `<div class="error-state compact"><p>${escapeHtml(err.message)}</p></div>`;
  }
}

async function sendCampaignEmail() {
  const templateId = $("emailTemplateSelect").value;
  if (!templateId) {
    toast("Select an email template", "err");
    return;
  }
  try {
    $("sendCampaignEmailBtn").disabled = true;
    const result = await api(`/api/campaigns/${activeCampaign.Id}/send-email`, {
      method: "POST",
      body: JSON.stringify({
        templateId,
        memberIds: [...campaignMemberSelection],
      }),
    });
    const logText = result.logWarning
      ? ` Activity log warning: ${result.logWarning}`
      : ` ${result.logged || 0} activities logged.`;
    toast(
      `${result.sent || 0} emails sent.${logText}`,
      result.logWarning ? "info" : "ok",
    );
    closeCampaignEmailModal();
  } catch (err) {
    toast(err.message, "err");
  } finally {
    $("sendCampaignEmailBtn").disabled = false;
  }
}

function setRecordSaveState(isSaving, objectName = currentObject) {
  savingRecord = isSaving;
  const saveBtn = $("saveBtn");
  const saveText = $("saveBtnText");
  const modal = $("modal");
  const modalBody = $("modalBody");
  if (saveBtn) {
    saveBtn.disabled = isSaving;
    saveBtn.style.minWidth = isSaving ? "132px" : "";
  }
  if (saveText) {
    saveText.innerHTML = isSaving
      ? `<span style="width:14px;height:14px;border:2px solid currentColor;border-right-color:transparent;border-radius:50%;display:inline-block;animation:spin .75s linear infinite;margin-right:8px;vertical-align:-2px"></span>Saving ${escapeHtml(objectName)}...`
      : "Save";
  }
  if (modalBody) {
    modalBody.querySelectorAll("input,select,textarea,button").forEach((el) => {
      if (isSaving) {
        el.dataset.saveWasDisabled = el.disabled ? "true" : "false";
        el.disabled = true;
      } else if (el.dataset.saveWasDisabled) {
        el.disabled = el.dataset.saveWasDisabled === "true";
        delete el.dataset.saveWasDisabled;
      }
    });
  }
  if (modal) {
    const closeBtn = modal.querySelector(".close-btn");
    const cancelBtn = modal.querySelector(".modal-foot .btn-ghost");
    if (closeBtn) closeBtn.disabled = isSaving;
    if (cancelBtn) cancelBtn.disabled = isSaving;
  }
}

async function refreshAfterSave(objectName, savedRecord, wasEditing) {
  const startedAt = performance.now();
  if (savedRecord?.Id) invalidateRecentRecordCache(objectName, savedRecord.Id);
  if (viewingDetail && detailRecordState && wasEditing) {
    const mergedRecord = { ...detailRecordState.record, ...savedRecord };
    const fields = detailRecordState.fields || [];
    const title =
      mergedRecord.Name ||
      mergedRecord.Subject ||
      mergedRecord.CaseNumber ||
      mergedRecord.Email ||
      detailRecordState.id;
    const displayFields = fields
      .filter(
        (field) =>
          mergedRecord[field.name] !== null &&
          mergedRecord[field.name] !== undefined &&
          field.name !== "attributes",
      )
      .slice(0, 80);
    detailRecordState = {
      ...detailRecordState,
      record: mergedRecord,
      fields,
    };
    renderRecordDetailPage(
      detailRecordState.objectName,
      mergedRecord,
      fields,
      displayFields,
      title,
      detailRecordState.id,
    );
    const refreshTasks =
      detailRecordState.objectName === "Campaign"
        ? [
            loadRelatedRecords(detailRecordState.objectName, detailRecordState.id),
            loadCampaignMembers(detailRecordState.id),
            loadRecordActivity(detailRecordState.objectName, detailRecordState.id),
          ]
        : [
            loadRelatedRecords(detailRecordState.objectName, detailRecordState.id),
            loadRecordActivity(detailRecordState.objectName, detailRecordState.id),
          ];
    Promise.allSettled(refreshTasks).then((results) => {
      const failed = results.find((result) => result.status === "rejected");
      if (failed) console.warn("Detail background refresh failed:", failed.reason?.message || failed.reason);
    });
  } else if (viewingDetail && detailRecordState) {
    openRecordDetail(detailRecordState.objectName, detailRecordState.id)
      .catch((err) => toast(err.message || "Saved, but detail refresh failed", "err", 8000));
  } else if (wasEditing && savedRecord?.Id && objectName === currentObject && !currentViewId.startsWith("sf:")) {
    currentRecords = currentRecords.map((record) =>
      record.Id === savedRecord.Id ? { ...record, ...savedRecord } : record,
    );
    applySort();
    await renderCurrentView();
    updateRecordCounts();
    invalidateCrmObjectCache(objectName);
    loadData({ forceRefresh: true }).catch((err) => console.warn("Background refresh failed:", err.message));
  } else {
    invalidateCrmObjectCache(objectName);
    loadData({ forceRefresh: true }).catch((err) => console.warn("Background refresh failed:", err.message));
  }
}

async function saveRecord() {
  if (savingRecord) return;
  const objectName = modalObject || currentObject;
  const wasEditing = Boolean(editingRecord);
  const savedRecord = wasEditing ? { ...editingRecord } : null;
  const body = {};
  $("modalBody")
    .querySelectorAll("[name]")
    .forEach((input) => {
      if (input.disabled || input.dataset.readonly === "true") return;
      if (input.type === "checkbox") {
        body[input.name] = input.checked;
        return;
      }
      if (input.multiple) {
        const values = [...input.selectedOptions]
          .map((option) => option.value)
          .filter(Boolean);
        if (values.length) body[input.name] = values.join(";");
        return;
      }
      setValue(body, input.name, input.value);
    });
  try {
    setRecordSaveState(true, objectName);
    if (wasEditing) {
      await api(`/api/${objectName}/${editingRecord.Id}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      });
      invalidateCrmObjectCache(objectName);
      Object.assign(savedRecord, body);
      toast("Record updated", "ok");
    } else {
      const result = await api(`/api/${objectName}`, {
        method: "POST",
        body: JSON.stringify(body),
      });
      invalidateCrmObjectCache(objectName);
      if (result?.id) Object.assign(body, { Id: result.id });
      toast("Record created", "ok");
    }
    setRecordSaveState(false, objectName);
    closeModal();
    refreshAfterSave(objectName, wasEditing ? savedRecord : body, wasEditing)
      .catch((err) => toast(err.message || "Saved, but refresh failed", "err", 8000));
  } catch (err) {
    if (!err.alreadyToasted) {
      toast(err.message || 'Could not save record. Please try again.', 'err', 10000);
    }
  } finally {
    setRecordSaveState(false, objectName);
  }
}

function openDelete(id) {
  deletingRecord = currentRecords.find((record) => record.Id === id);
  $("delRecordName").textContent =
    deletingRecord?.Name || deletingRecord?.Subject || deletingRecord?.Id || "";
  $("delOverlay").classList.add("open");
}

function closeDeleteModal() {
  $("delOverlay").classList.remove("open");
  deletingRecord = null;
}

async function confirmDelete() {
  if (!deletingRecord) return;
  try {
    $("confirmDelBtn").disabled = true;
    await api(`/api/${currentObject}/${deletingRecord.Id}`, {
      method: "DELETE",
    });
    invalidateCrmObjectCache(currentObject);
    toast("Record deleted", "ok");
    closeDeleteModal();
    await loadData({ forceRefresh: true });
  } catch (err) {
    if (!err.alreadyToasted) {
      toast(err.message || 'Could not delete record. Please try again.', 'err', 10000);
    }
  } finally {
    $("confirmDelBtn").disabled = false;
  }
}

async function openListViewModal() {
  const meta = OBJECT_META[currentObject];
  await loadObjectFields(currentObject);
  const editingView = getCurrentLocalView();
  const defaultColumns = normalizePortalColumns(editingView?.columns || meta.columns);
  const logicVal = editingView?.filterLogic || "AND";
  const isStandardLogic = ["AND", "OR"].includes(logicVal.toUpperCase());
  listViewDraft = {
    id: editingView?.id || `${Date.now()}`,
    isEditing: Boolean(editingView),
    name: editingView?.name || "",
    visibility: editingView?.visibility || "private",
    pageSize: editingView?.pageSize || RENDER_CHUNK_SIZE,
    columns: defaultColumns,
    filters: [...(editingView?.filters || [])],
    filterLogicType: isStandardLogic ? logicVal.toUpperCase() : "CUSTOM",
    customFilterLogic: isStandardLogic ? "" : logicVal,
    sort: editingView?.sort || sortState || null,
    createdAt: editingView?.createdAt,
    selectedField: null,
    selectedSide: null,
  };
  const fieldOptions = getCachedObjectFields(currentObject)
    .map((field) => `<option value="${escapeHtml(field.name)}">${escapeHtml(field.label)}</option>`)
    .join("");
  const title = $("listViewModalTitle");
  if (title) title.textContent = editingView ? "Edit List View" : "Create List View";
  $("listViewBody").innerHTML = `
    <div class="lv-builder">
      <div class="lv-top-grid">
        <div class="form-group">
        <label class="form-label" for="viewName">List View Name</label>
          <input class="form-ctrl" id="viewName" value="${escapeHtml(listViewDraft.name)}" placeholder="Example: Key Accounts">
        </div>
        <div class="form-group">
          <label class="form-label" for="viewVisibility">Visibility</label>
          <select class="form-ctrl" id="viewVisibility">
            <option value="private" ${listViewDraft.visibility === "private" ? "selected" : ""}>Private</option>
            <option value="public" ${listViewDraft.visibility === "public" ? "selected" : ""}>Public</option>
          </select>
        </div>
        <div class="form-group">
          <label class="form-label" for="viewPageSize">Page Size</label>
          <select class="form-ctrl" id="viewPageSize">
            ${[25, 50, 100, 200].map((size) => `<option value="${size}" ${Number(listViewDraft.pageSize) === size ? "selected" : ""}>${size} rows</option>`).join("")}
          </select>
        </div>
      </div>

      <div class="lv-section-title">Select Fields to Display</div>
      <div class="lv-dual-list">
        <div class="lv-list-panel">
          <div class="lv-list-heading">
            <label class="form-label" for="lvAvailableSearch">Available Fields</label>
            <span id="lvAvailableCount"></span>
          </div>
          <input class="form-ctrl lv-search" id="lvAvailableSearch" placeholder="Search fields..." oninput="renderListViewFieldLists()">
          <div class="lv-field-list" id="lvAvailableFields"></div>
        </div>
        <div class="lv-transfer">
          <button class="icon-btn" type="button" title="Add field" onclick="moveListViewDraftField('add')">›</button>
          <button class="icon-btn" type="button" title="Remove field" onclick="moveListViewDraftField('remove')">‹</button>
          <button class="icon-btn" type="button" title="Move up" onclick="moveListViewDraftField('up')">▲</button>
          <button class="icon-btn" type="button" title="Move down" onclick="moveListViewDraftField('down')">▼</button>
        </div>
        <div class="lv-list-panel">
          <div class="lv-list-heading">
            <label class="form-label">Visible Fields</label>
            <span id="lvVisibleCount"></span>
          </div>
          <div class="lv-field-list" id="lvVisibleFields"></div>
        </div>
      </div>

      <div class="lv-filter-builder">
        <div class="lv-section-title">Filters</div>
        <div class="lv-filter-row">
          <select class="form-ctrl" id="lvFilterField" onchange="syncListViewFilterOperators()">${fieldOptions}</select>
          <select class="form-ctrl" id="lvFilterOperator"></select>
          <input class="form-ctrl" id="lvFilterValue" placeholder="Value">
          <button class="btn btn-ghost" type="button" onclick="addListViewDraftFilter()">Add Filter</button>
          <select class="form-ctrl compact" id="lvFilterLogicType" onchange="handleFilterLogicTypeChange(this.value)">
            <option value="AND" ${listViewDraft.filterLogicType === "AND" ? "selected" : ""}>AND</option>
            <option value="OR" ${listViewDraft.filterLogicType === "OR" ? "selected" : ""}>OR</option>
            <option value="CUSTOM" ${listViewDraft.filterLogicType === "CUSTOM" ? "selected" : ""}>Custom</option>
          </select>
        </div>
        <div class="form-group" id="lvCustomLogicContainer" style="display: ${listViewDraft.filterLogicType === 'CUSTOM' ? 'flex' : 'none'}; margin-top: 12px; gap: 5px;">
          <label class="form-label" for="lvCustomFilterLogic">Filter Logic</label>
          <input class="form-ctrl" id="lvCustomFilterLogic" value="${escapeHtml(listViewDraft.customFilterLogic || '')}" placeholder="Example: 1 AND (2 OR 3)">
        </div>
        <div class="lv-filter-list" id="lvFilterList"></div>
      </div>
    </div>
  `;
  renderListViewFieldLists();
  syncListViewFilterOperators();
  renderListViewFilterBuilder();
  $("listViewOverlay").classList.add("open");
}

function closeListViewModal() {
  $("listViewOverlay").classList.remove("open");
  listViewDraft = null;
}

function handleFilterLogicTypeChange(value) {
  if (!listViewDraft) return;
  listViewDraft.filterLogicType = value;
  const container = $("lvCustomLogicContainer");
  if (container) {
    container.style.display = value === "CUSTOM" ? "flex" : "none";
  }
}

function persistPortalListView(view) {
  const views = getLocalViews();
  views[currentObject] = views[currentObject] || [];
  const index = views[currentObject].findIndex((item) => item.id === view.id);
  if (index >= 0) views[currentObject][index] = view;
  else views[currentObject].push(view);
  setLocalViews(views);
}

function removePortalListView(viewId) {
  const views = getLocalViews();
  if (!Array.isArray(views[currentObject])) return;
  views[currentObject] = views[currentObject].filter((item) => item.id !== viewId);
  setLocalViews(views);
}

function buildListViewSaveDraft() {
  if (!listViewDraft) return;
  const name = $("viewName").value.trim();
  if (!name) {
    toast("List view name is required", "err");
    return null;
  }
  const columns = normalizePortalColumns(listViewDraft.columns);
  if (!columns.length) {
    toast("Select at least one visible field", "err");
    return null;
  }
  const existing = listViewDraft.isEditing && !listViewDraft.sfDeveloperName
    ? objectLocalViews().find((item) => item.id === listViewDraft.id)
    : {};
  const logicType = $("lvFilterLogicType")?.value || listViewDraft.filterLogicType || "AND";
  const customLogic = $("lvCustomFilterLogic")?.value || listViewDraft.customFilterLogic || "";
  const filterLogic = logicType === "CUSTOM" ? customLogic.trim() : logicType;

  return {
    ...existing,
    id: listViewDraft.id,
    version: 2,
    name,
    visibility: $("viewVisibility")?.value || "private",
    objectName: currentObject,
    columns,
    filters: listViewDraft.filters || [],
    filterLogic,
    pageSize: Number($("viewPageSize")?.value || RENDER_CHUNK_SIZE),
    sort: listViewDraft.sort || sortState || null,
    createdAt: listViewDraft.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    sfDeveloperName: listViewDraft.sfDeveloperName || null,
  };
}

function setListViewSaveBusy(isBusy) {
  const button = $("listViewSaveBtn");
  if (!button) return;
  if (isBusy) {
    button.dataset.originalText = button.textContent;
    button.disabled = true;
    button.innerHTML = '<span class="btn-spinner"></span> Saving...';
  } else {
    button.disabled = false;
    button.textContent = button.dataset.originalText || "Save View";
  }
}

async function syncPortalListViewToSalesforce(view) {
  const method = view.sfDeveloperName ? "PATCH" : "POST";
  const url = view.sfDeveloperName
    ? `/api/${currentObject}/listviews/${view.sfDeveloperName}`
    : `/api/${currentObject}/listviews`;

  return api(url, {
    method,
    body: JSON.stringify({
      name: view.name,
      visibility: view.visibility,
      columns: view.columns,
      filters: view.filters,
      filterLogic: view.filterLogic,
      sort: view.sort,
    }),
  });
}

async function saveLocalListView() {
  const view = buildListViewSaveDraft();
  if (!view) return;

  setListViewSaveBusy(true);
  try {
    const result = await syncPortalListViewToSalesforce(view);
    if (!result?.synced) throw new Error("Salesforce did not confirm list view sync");

    if (!view.sfDeveloperName) {
      removePortalListView(view.id);
    }
    invalidateCrmObjectCache(currentObject);
    await loadListViews();
    const salesforceId = result.listView?.id || (view.sfDeveloperName ? view.id : null);
    const matchedView = salesforceId
      ? sfListViews.find((item) => item.id === salesforceId)
      : sfListViews.find((item) => cleanListViewLabel(item.label) === cleanListViewLabel(view.name));
    currentViewId = matchedView?.id ? `sf:${matchedView.id}` : "all";
    sortState = view.sort || { field: null, direction: "asc" };
    closeListViewModal();
    renderListViewSelect();
    toast("List view saved in Salesforce", "ok");
    loadData({ forceRefresh: true });
  } catch (err) {
    if (view.sfDeveloperName) {
      const message = err?.message || "Salesforce rejected this list view update";
      toast(`Update failed: ${message}`, "err", 9000);
    } else {
      persistPortalListView(view);
      currentViewId = `local:${view.id}`;
      sortState = view.sort || { field: null, direction: "asc" };
      closeListViewModal();
      renderListViewSelect();
      const message = err?.message || "Salesforce rejected this list view";
      toast(`Saved in portal only. Salesforce sync failed: ${message}`, "err", 9000);
      loadData({ forceRefresh: true });
    }
  } finally {
    setListViewSaveBusy(false);
  }
}

function mapSalesforceFilterToPortal(sfFilter) {
  const field = sfFilter.fieldApiName;
  const sfOperator = sfFilter.operator;
  const operandLabels = sfFilter.operandLabels || [];
  const val = operandLabels[0] || "";

  let operator = "equals";
  let value = val;

  const sfOperatorLower = String(sfOperator).toLowerCase();

  if (sfOperatorLower === "equals" || sfOperatorLower === "equal") {
    if (val === "") {
      operator = "blank";
      value = "";
    } else if (val.toLowerCase() === "true") {
      operator = "true";
      value = "";
    } else if (val.toLowerCase() === "false") {
      operator = "false";
      value = "";
    } else if (val.toUpperCase() === "TODAY") {
      operator = "today";
      value = "";
    } else if (val.toUpperCase() === "YESTERDAY") {
      operator = "yesterday";
      value = "";
    } else if (val.toUpperCase() === "LAST_N_DAYS:7") {
      operator = "last_7_days";
      value = "";
    } else if (val.toUpperCase() === "LAST_N_DAYS:30") {
      operator = "last_30_days";
      value = "";
    } else if (val.toUpperCase() === "THIS_MONTH") {
      operator = "this_month";
      value = "";
    } else if (val.toUpperCase() === "LAST_MONTH") {
      operator = "last_month";
      value = "";
    } else {
      operator = "equals";
    }
  } else if (sfOperatorLower === "notequal") {
    if (val === "") {
      operator = "not_blank";
      value = "";
    } else {
      operator = "not_equals";
    }
  } else if (sfOperatorLower === "contains") {
    operator = "contains";
  } else if (sfOperatorLower === "notcontains") {
    operator = "not_contains";
  } else if (sfOperatorLower === "startswith") {
    operator = "starts_with";
  } else if (sfOperatorLower === "endswith") {
    operator = "ends_with";
  } else if (sfOperatorLower === "greaterthan") {
    operator = "gt";
  } else if (sfOperatorLower === "greaterorequal") {
    operator = "gte";
  } else if (sfOperatorLower === "lessthan") {
    operator = "lt";
  } else if (sfOperatorLower === "lessorequal") {
    operator = "lte";
  }

  return { field, operator, value };
}

async function editCurrentListView() {
  if (!currentViewId || currentViewId === "all") return;

  if (currentViewId.startsWith("local:")) {
    openListViewModal();
    return;
  }

  if (currentViewId.startsWith("sf:")) {
    const sfId = currentViewId.slice(3);
    const view = sfListViews.find(v => v.id === sfId);
    if (!view) return;

    try {
      const describe = await api(`/api/${currentObject}/listviews/${sfId}/describe`);
      
      await loadObjectFields(currentObject);
      
      const columns = (describe.displayColumns || []).map(col => col.fieldApiName);
      const filters = (describe.filteredByInfo || []).map(mapSalesforceFilterToPortal);
      
      const logicVal = describe.filterLogicString || "AND";
      const isStandardLogic = ["AND", "OR"].includes(logicVal.toUpperCase());

      listViewDraft = {
        id: sfId,
        isEditing: true,
        sfDeveloperName: describe.listViewApiName || view.developerName,
        name: describe.label || view.label,
        visibility: String(describe.visibility || "private").toLowerCase(),
        pageSize: RENDER_CHUNK_SIZE,
        columns: normalizePortalColumns(columns),
        filters: filters,
        filterLogicType: isStandardLogic ? logicVal.toUpperCase() : "CUSTOM",
        customFilterLogic: isStandardLogic ? "" : logicVal,
        sort: sortState || null,
        selectedField: null,
        selectedSide: null
      };

      const fieldOptions = getCachedObjectFields(currentObject)
        .map((field) => `<option value="${escapeHtml(field.name)}">${escapeHtml(field.label)}</option>`)
        .join("");

      const title = $("listViewModalTitle");
      if (title) title.textContent = "Edit List View";
      
      $("listViewBody").innerHTML = `
        <div class="lv-builder">
          <div class="lv-top-grid">
            <div class="form-group">
              <label class="form-label" for="viewName">List View Name</label>
              <input class="form-ctrl" id="viewName" value="${escapeHtml(listViewDraft.name)}" placeholder="Example: Key Accounts">
            </div>
            <div class="form-group">
              <label class="form-label" for="viewVisibility">Visibility</label>
              <select class="form-ctrl" id="viewVisibility">
                <option value="private" ${listViewDraft.visibility === "private" ? "selected" : ""}>Private</option>
                <option value="public" ${listViewDraft.visibility === "public" ? "selected" : ""}>Public</option>
              </select>
            </div>
          </div>

          <div class="lv-section-title">Select Fields to Display</div>
          <div class="lv-dual-list">
            <div class="lv-list-panel">
              <div class="lv-list-heading">
                <label class="form-label" for="lvAvailableSearch">Available Fields</label>
                <span id="lvAvailableCount"></span>
              </div>
              <input class="form-ctrl lv-search" id="lvAvailableSearch" placeholder="Search fields..." oninput="renderListViewFieldLists()">
              <div class="lv-field-list" id="lvAvailableFields"></div>
            </div>
            <div class="lv-transfer">
              <button class="icon-btn" type="button" title="Add field" onclick="moveListViewDraftField('add')">›</button>
              <button class="icon-btn" type="button" title="Remove field" onclick="moveListViewDraftField('remove')">‹</button>
              <button class="icon-btn" type="button" title="Move up" onclick="moveListViewDraftField('up')">▲</button>
              <button class="icon-btn" type="button" title="Move down" onclick="moveListViewDraftField('down')">▼</button>
            </div>
            <div class="lv-list-panel">
              <div class="lv-list-heading">
                <label class="form-label">Visible Fields</label>
                <span id="lvVisibleCount"></span>
              </div>
              <div class="lv-field-list" id="lvVisibleFields"></div>
            </div>
          </div>

          <div class="lv-filter-builder">
            <div class="lv-section-title">Filters</div>
            <div class="lv-filter-row">
              <select class="form-ctrl" id="lvFilterField" onchange="syncListViewFilterOperators()">${fieldOptions}</select>
              <select class="form-ctrl" id="lvFilterOperator"></select>
              <input class="form-ctrl" id="lvFilterValue" placeholder="Value">
              <button class="btn btn-ghost" type="button" onclick="addListViewDraftFilter()">Add Filter</button>
              <select class="form-ctrl compact" id="lvFilterLogicType" onchange="handleFilterLogicTypeChange(this.value)">
                <option value="AND" ${listViewDraft.filterLogicType === "AND" ? "selected" : ""}>AND</option>
                <option value="OR" ${listViewDraft.filterLogicType === "OR" ? "selected" : ""}>OR</option>
                <option value="CUSTOM" ${listViewDraft.filterLogicType === "CUSTOM" ? "selected" : ""}>Custom</option>
              </select>
            </div>
            <div class="form-group" id="lvCustomLogicContainer" style="display: ${listViewDraft.filterLogicType === 'CUSTOM' ? 'flex' : 'none'}; margin-top: 12px; gap: 5px;">
              <label class="form-label" for="lvCustomFilterLogic">Filter Logic</label>
              <input class="form-ctrl" id="lvCustomFilterLogic" value="${escapeHtml(listViewDraft.customFilterLogic || '')}" placeholder="Example: 1 AND (2 OR 3)">
            </div>
            <div class="lv-filter-list" id="lvFilterList"></div>
          </div>
        </div>
      `;
      renderListViewFieldLists();
      syncListViewFilterOperators();
      renderListViewFilterBuilder();
      $("listViewOverlay").classList.add("open");
    } catch (err) {
      toast(`Failed to load list view details: ${err.message || err}`, "err");
    }
  }
}

let listViewToDelete = null;

function openDeleteListViewModal() {
  if (!currentViewId || currentViewId === "all") return;
  
  let name = "";
  if (currentViewId.startsWith("local:")) {
    const view = getCurrentLocalView();
    name = view ? view.name : "";
    listViewToDelete = { type: "local", id: currentViewId.slice(6), name };
  } else if (currentViewId.startsWith("sf:")) {
    const sfId = currentViewId.slice(3);
    const view = sfListViews.find(v => v.id === sfId);
    name = view ? view.label : "";
    listViewToDelete = { type: "sf", id: sfId, developerName: view?.developerName, name };
  }
  
  if (!listViewToDelete) return;
  
  const nameEl = $("deleteListViewName");
  if (nameEl) nameEl.textContent = listViewToDelete.name;
  
  $("deleteListViewOverlay").classList.add("open");
}

function closeDeleteListViewModal() {
  $("deleteListViewOverlay").classList.remove("open");
  listViewToDelete = null;
}

async function confirmDeleteListView() {
  if (!listViewToDelete) return;
  
  const btn = $("confirmDeleteListViewBtn");
  if (btn) {
    btn.disabled = true;
    btn.textContent = "Deleting...";
  }
  
  try {
    if (listViewToDelete.type === "local") {
      removePortalListView(listViewToDelete.id);
      toast("Local list view deleted", "ok");
    } else {
      await api(`/api/${currentObject}/listviews/${listViewToDelete.developerName}`, {
        method: "DELETE"
      });
      toast("List view deleted from Salesforce", "ok");
    }
    
    invalidateCrmObjectCache(currentObject);
    currentViewId = "all";
    await loadListViews();
    closeDeleteListViewModal();
    await loadData();
  } catch (err) {
    toast(`Failed to delete list view: ${err.message || err}`, "err");
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = "Delete List View";
    }
  }
}


function renderListViewFieldLists() {
  if (!listViewDraft) return;
  const availableEl = $("lvAvailableFields");
  const visibleEl = $("lvVisibleFields");
  if (!availableEl || !visibleEl) return;
  const query = ($("lvAvailableSearch")?.value || "").toLowerCase();
  const selected = new Set(listViewDraft.columns);
  const fields = getCachedObjectFields(currentObject);
  const availableFields = fields
    .filter((field) => !selected.has(field.name))
    .filter((field) => !query || field.label.toLowerCase().includes(query) || field.name.toLowerCase().includes(query));
  const availableCount = $("lvAvailableCount");
  const visibleCount = $("lvVisibleCount");
  if (availableCount) availableCount.textContent = `${availableFields.length} fields`;
  if (visibleCount) visibleCount.textContent = `${listViewDraft.columns.length} selected`;
  const optionHtml = (field, side) => `
    <button type="button"
      class="lv-field-option ${listViewDraft.selectedField === field.name && listViewDraft.selectedSide === side ? "active" : ""}"
      onclick="selectListViewDraftField('${escapeJs(field.name)}', '${side}')"
      ondblclick="moveListViewDraftFieldDirect('${escapeJs(field.name)}', '${side === "available" ? "visible" : "available"}')">
      ${escapeHtml(field.label)}
      <span>${escapeHtml(field.name)}</span>
    </button>`;
  availableEl.innerHTML = availableFields
    .map((field) => optionHtml(field, "available"))
    .join("") || '<div class="lv-empty">No available fields</div>';
  visibleEl.innerHTML = listViewDraft.columns
    .map((name) => fieldMetaFor(name) || { name, label: labelFor(name) })
    .map((field) => optionHtml(field, "visible"))
    .join("") || '<div class="lv-empty">No visible fields</div>';
}

function selectListViewDraftField(field, side) {
  if (!listViewDraft) return;
  listViewDraft.selectedField = field;
  listViewDraft.selectedSide = side;
  renderListViewFieldLists();
}

function moveListViewDraftField(action) {
  if (!listViewDraft?.selectedField) return;
  const field = listViewDraft.selectedField;
  const columns = [...listViewDraft.columns];
  const index = columns.indexOf(field);
  if (action === "add" && listViewDraft.selectedSide === "available") {
    columns.push(field);
    listViewDraft.selectedSide = "visible";
  } else if (action === "remove" && index >= 0) {
    columns.splice(index, 1);
    listViewDraft.selectedSide = "available";
  } else if (action === "up" && index > 0) {
    [columns[index - 1], columns[index]] = [columns[index], columns[index - 1]];
  } else if (action === "down" && index >= 0 && index < columns.length - 1) {
    [columns[index + 1], columns[index]] = [columns[index], columns[index + 1]];
  }
  listViewDraft.columns = columns;
  renderListViewFieldLists();
}

function moveListViewDraftFieldDirect(field, target) {
  if (!listViewDraft) return;
  listViewDraft.selectedField = field;
  listViewDraft.selectedSide = target === "visible" ? "available" : "visible";
  moveListViewDraftField(target === "visible" ? "add" : "remove");
}

function syncListViewFilterOperators() {
  const field = $("lvFilterField")?.value;
  const operatorSelect = $("lvFilterOperator");
  const valueInput = $("lvFilterValue");
  if (!field || !operatorSelect) return;
  operatorSelect.innerHTML = operatorOptionsForField(field)
    .map((operator) => `<option value="${operator}">${escapeHtml(operatorLabel(operator))}</option>`)
    .join("");
  if (valueInput) valueInput.placeholder = operatorSelect.value === "between" ? "Min, Max" : "Value";
}

function addListViewDraftFilter() {
  if (!listViewDraft) return;
  const field = $("lvFilterField")?.value;
  const operator = $("lvFilterOperator")?.value;
  const value = $("lvFilterValue")?.value || "";
  const valueNotNeeded = ["blank", "not_blank", "true", "false", "today", "yesterday", "last_7_days", "last_30_days", "this_month", "last_month"].includes(operator);
  if (!field || !operator) return;
  if (!valueNotNeeded && !value.trim()) {
    toast("Filter value is required", "err");
    return;
  }
  listViewDraft.filters.push({ field, operator, value: value.trim() });
  if ($("lvFilterValue")) $("lvFilterValue").value = "";
  renderListViewFilterBuilder();
}

function removeListViewDraftFilter(index) {
  if (!listViewDraft) return;
  listViewDraft.filters.splice(index, 1);
  renderListViewFilterBuilder();
}

function renderListViewFilterBuilder() {
  const list = $("lvFilterList");
  if (!list || !listViewDraft) return;
  list.innerHTML = (listViewDraft.filters || []).map((filter, index) => {
    const valueNotNeeded = ["blank", "not_blank", "true", "false", "today", "yesterday", "last_7_days", "last_30_days", "this_month", "last_month"].includes(filter.operator);
    return `
      <span class="lv-filter-chip">
        ${escapeHtml(labelFor(filter.field))} ${escapeHtml(operatorLabel(filter.operator))}${valueNotNeeded ? "" : ` ${escapeHtml(filter.value)}`}
        <button type="button" onclick="removeListViewDraftFilter(${index})">x</button>
      </span>
    `;
  }).join("") || '<div class="lv-empty">No filters. All records allowed by security are included.</div>';
}

function overlayClick(event, overlayId, closeFn) {
  if (event.target.id === overlayId) closeFn();
}

function toast(message, type = 'info', duration = 6000) {
  const stack = $('toastStack');
  if (!stack) return;

  // Map raw error messages to human-friendly ones
  const friendlyMessage = type === 'err' ? friendlyError(message) : message;
  const toastKey = `${type}:${friendlyMessage}`;
  const now = Date.now();
  if (toastKey === lastToastKey && now - lastToastAt < 1200) return;
  lastToastKey = toastKey;
  lastToastAt = now;

  const item = document.createElement('div');
  item.className = `toast toast-${type}`;

  const icons = { ok: '✓', err: '✕', info: 'ℹ' };
  const labels = { ok: 'Success', err: 'Error', info: 'Info' };

  item.innerHTML = `
    <div class="toast-inner">
      <span class="toast-icon toast-icon-${type}">${icons[type] || 'ℹ'}</span>
      <div class="toast-content">
        <div class="toast-label">${labels[type] || 'Info'}</div>
        <div class="toast-msg">${escapeHtml(friendlyMessage)}</div>
      </div>
      <button class="toast-close" onclick="this.closest('.toast').remove()">✕</button>
    </div>
    <div class="toast-progress toast-progress-${type}"></div>
  `;

  stack.appendChild(item);
  requestAnimationFrame(() => item.classList.add('in'));

  // Progress bar animation
  const progress = item.querySelector('.toast-progress');
  if (progress) {
    progress.style.transition = `width ${duration}ms linear`;
    requestAnimationFrame(() => { progress.style.width = '0%'; });
  }

  const timer = setTimeout(() => {
    item.classList.add('out');
    setTimeout(() => item.remove(), 400);
  }, duration);

  // Pause on hover
  item.addEventListener('mouseenter', () => clearTimeout(timer));
  item.addEventListener('mouseleave', () => {
    setTimeout(() => {
      item.classList.add('out');
      setTimeout(() => item.remove(), 400);
    }, 2000);
  });
}

function friendlyError(message = '') {
  const m = String(message).toLowerCase();

  if (m.includes('permission') || m.includes('403'))
    return message; // already friendly from our server

  if (m.includes('401') || m.includes('unauthorized') || m.includes('token'))
    return 'Your session has expired. Please log in again.';

  if (m.includes('network') || m.includes('failed to fetch') || m.includes('load'))
    return 'Network error — check your connection and try again.';

  if (m.includes('timeout'))
    return 'Request timed out — Salesforce may be slow. Try again.';

  if (m.includes('duplicate') || m.includes('already exists'))
    return 'A record with this information already exists in Salesforce.';

  if (m.includes('required field') || m.includes('missing required'))
    return 'A required field is missing. Please fill in all required fields.';

  if (m.includes('invalid cross reference') || m.includes('invalid id'))
    return 'One of the related record IDs is invalid. Please check your selections.';

  if (m.includes('entity is deleted'))
    return 'This record was deleted in Salesforce. Refresh to update the list.';

  if (m.includes('unable to lock row'))
    return 'This record is being edited by someone else. Try again in a moment.';

  if (m.includes('500') || m.includes('internal server'))
    return 'Server error — something went wrong on our end. Try again.';

  if (m.includes('salesforce') && m.includes('auth'))
    return 'Salesforce authentication failed. Contact your administrator.';

  return message || 'Something went wrong. Please try again.';
}

document.addEventListener("click", (event) => {
  if (!event.target.closest(".profile-menu")) closeProfileMenu();
  if (!event.target.closest(".kanban-item")) closeKanbanMenus();
});
document.addEventListener("click", persistCrmStateBeforeExternalNavigation, true);

document.addEventListener(
  "scroll",
  (event) => {
    if (event.target?.closest?.(".kanban-stage-menu")) return;
    closeKanbanMenus();
  },
  true,
);
window.addEventListener("resize", () => {
  closeKanbanMenus();
  virtualTableState.rowHeightMeasured = false;
  scheduleVirtualTableRender(true);
  queueLazyLoadIfNeeded();
});
window.addEventListener("scroll", handleLazyScroll, { passive: true });
window.addEventListener("pagehide", persistCrmSpaState);
window.addEventListener("beforeunload", persistCrmSpaState);
window.addEventListener("pageshow", (event) => {
  if (!event.persisted) return;
  restoreCrmSpaStateFromStorage();
  const route = crmRouteFromLocation();
  const objectName = route?.objectName || crmObjectFromLocation() || currentObject;
  if (route?.view === "object" && objectName) {
    restoreCrmPageState(objectName);
  }
});
window.addEventListener("popstate", () => {
  const route = history.state?.crmView
    ? {
        view: history.state.crmView,
        objectName: history.state.crmObject,
        recordId: history.state.crmRecordId,
      }
    : crmRouteFromLocation();
  if (route?.view === "record" && route.objectName && route.recordId) {
    restoreCrmRecordFromHistory(route.objectName, route.recordId);
    return;
  }
  const objectName = route?.objectName || crmObjectFromLocation();
  if (objectName) {
    if (viewingDetail && objectName === currentObject) {
      restoringCrmHistory = true;
      restoreListContent(false, { preserveHistory: true });
      restoringCrmHistory = false;
      return;
    }
    if (objectName !== currentObject) {
      restoreCrmObjectFromHistory(objectName);
    } else if (!viewingDetail && !hasRenderableListRows()) {
      restoreCrmPageState(objectName);
    }
  }
});
spaCacheStats.automaticRefreshesRemoved += 1;

document.addEventListener("DOMContentLoaded", async () => {
  sharedPerformanceCache?.markModuleInitialized?.("crm");
  listContentHtml = $("content").innerHTML;

  // Sidebar collapsed state
  if (localStorage.getItem("sfmSidebarCollapsed") === "true") {
    document.body.classList.add("sidebar-collapsed");
    const button = $("sidebarCollapseBtn");
    if (button) {
      button.title = "Expand sidebar";
      button.setAttribute("aria-label", "Expand sidebar");
    }
  }

  refreshSidebarIcons();
  sharedPerformanceCache?.idle?.(() => sharedPerformanceCache.lazyImages?.(document), { timeout: 1000 });

  // ── AUTH GATE ────────────────────────────────────
  const handledGoogleRedirect = await finishGoogleLoginFromRedirect();
  if (handledGoogleRedirect) return;

  const token = getAuthToken();

  if (!token || isTokenExpired(token)) {
    // No valid token — show login page
    clearAuthToken();
    showLoginPage();
    return; // Don't load any data until logged in
  }
  // Token exists — load cached perms immediately (so UI guards work instantly)
  window.userPerms = getStoredPerms();
  let route = crmRouteFromLocation();
  currentObject = initialReadableObject();
  if (route?.view !== "record") writeCrmHistory(currentObject, true);
  applyAllPermissionGuards();

  // Then boot the app normally
  loadOrgSettings()
    .then(() => checkConnection())
    .then(async (connection) => {
      if (connection?.success) {
        restoreCrmSpaStateFromStorage();
        syncSidebarBadgesFromCache();
        // Refresh permissions from server (in case they changed)
        try {
          const me = await api("/api/portal/me");
          if (me) {
            setStoredPerms(me.permissions || {});
            window.portalUser = me;
            route = crmRouteFromLocation();
            currentObject = initialReadableObject();
            if (route?.view !== "record") writeCrmHistory(currentObject, true);
            applyAllPermissionGuards();
          }
        } catch {
          // If /portal/me fails, cached perms are still used
        }
        if (route?.view === "record" && route.recordId) {
          loadListViews().catch((err) => console.warn("List views warmup failed:", err.message || err));
          await openRecordDetail(route.objectName, route.recordId, { preserveHistory: true });
          return;
        }
        const restoredPage = route?.view === "object" && restoreCrmPageState(currentObject);
        if (!restoredPage) {
          await loadListViews();
          await loadData();
        }
      }
    });
});

function switchCustomTab(regionName, activeIdx) {
  if (typeof activeIdx === 'string' && activeIdx.includes('-')) {
    switchCustomTabNew(regionName, activeIdx);
    return;
  }
  const contents = document.querySelectorAll(`.custom-tab-content-${regionName}`);
  contents.forEach((el, idx) => {
    el.style.display = idx === activeIdx ? 'block' : 'none';
  });
  
  const headers = document.querySelectorAll(`.custom-tab-header[data-region="${regionName}"]`);
  headers.forEach((el, idx) => {
    if (idx === activeIdx) {
      el.classList.add('active');
      el.style.borderBottom = '3px solid var(--accent)';
      el.style.color = 'var(--accent)';
      el.style.fontWeight = '700';
    } else {
      el.classList.remove('active');
      el.style.borderBottom = '3px solid transparent';
      el.style.color = 'var(--text-2)';
      el.style.fontWeight = '600';
    }
  });
}

function switchCustomTabNew(regionName, tabPath) {
  const parts = tabPath.split('-');
  const itemIdx = parts[0];
  const activeSubIdx = parseInt(parts[1]);

  const headers = document.querySelectorAll(`.custom-tab-header[data-region="${regionName}"][data-index^="${itemIdx}-"]`);
  headers.forEach(h => {
    const idx = parseInt(h.getAttribute('data-index').split('-')[1]);
    if (idx === activeSubIdx) {
      h.classList.add('active');
      h.style.borderBottom = '3px solid var(--accent)';
      h.style.color = 'var(--accent)';
      h.style.fontWeight = '700';
    } else {
      h.classList.remove('active');
      h.style.borderBottom = '3px solid transparent';
      h.style.color = 'var(--text-2)';
      h.style.fontWeight = '600';
    }
  });

  const contents = document.querySelectorAll(`.custom-tab-content-${regionName}-${itemIdx}`);
  contents.forEach(c => {
    const subIdx = parseInt(c.id.split('-').pop());
    c.style.display = subIdx === activeSubIdx ? 'block' : 'none';
  });
}
