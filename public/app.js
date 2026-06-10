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
let currentViewId = "all";
let sfListViews = [];
let searchTimer = null;
let globalTimer = null;
let lookupTimer = null;
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
let currentViewMode = "table";
let draggedKanbanId = null;
const kanbanPicklistCache = {};
let listContentHtml = "";
let viewingDetail = false;
let detailRecordState = null;
let activeCampaign = null;
let campaignMembers = [];
let recordActivities = [];
let campaignMemberSelection = new Set();
let memberCandidateObject = "Contact";
let memberCandidateSelection = new Set();
let currentCampaignCandidates = [];
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
  return field
    .replace(/\./g, " ")
    .replace(/Id$/, "")
    .replace(/([a-z])([A-Z])/g, "$1 $2");
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
    throw new Error(msg);
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

  hideLoginPage();

  if (data.mustChangePw) {
    toast(
      "Please change your password - you are using a temporary password.",
      "info",
    );
  }

  applyAllPermissionGuards();
  await checkConnection();
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

function applyAllPermissionGuards() {
  applyPermissionGuards(currentObject);
}

function applyPermissionGuards(sfObject) {
  const canRead = canDo(sfObject, "can_read");
  const canCreate = canDo(sfObject, "can_create");
  const canEdit = canDo(sfObject, "can_edit");
  const canDelete = canDo(sfObject, "can_delete");

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
      btn.style.display = canEdit ? "" : "none";
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
    btn.style.display = canCreate ? "" : "none";
  });
}

function formatValue(field, value, record = null) {
  if (value === null || value === undefined || value === "")
    return '<span class="cell-empty">-</span>';
  if (field === "Amount" || field === "AnnualRevenue") {
    return `<span class="cell-amount">${Number(value).toLocaleString(
      undefined,
      {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 0,
      },
    )}</span>`;
  }
  if (field.includes("Date")) return new Date(value).toLocaleDateString();
  if (field === "Email")
    return `<a class="cell-email" href="mailto:${escapeHtml(value)}">${escapeHtml(value)}</a>`;
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
  return escapeHtml(String(value));
}

async function checkConnection() {
  const status = $("connStatus");
  const dot = status.querySelector(".conn-dot");
  const text = status.querySelector(".conn-text");
  const authBtn = $("authBtn");

  try {
    const data = await api("/api/auth/test");
    if (data.org) {
      orgSettings.activeOrgKey = data.org.key || orgSettings.activeOrgKey;
      updateActiveOrgLabel(data.org);
    }
    dot.className = "conn-dot connected";
    text.textContent = "Connected";
    if (authBtn) authBtn.style.display = "none";
    await loadProfile();
    return data;
  } catch (err) {
    dot.className = "conn-dot error";
    text.textContent = "Auth failed";
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
    const roleLabels = {
      system_administrator: 'System Administrator', admin: 'Admin',
      manager: 'Manager', employee: 'Employee', readonly: 'Read-Only'
    };

    $('content').innerHTML = `
      <div style="max-width:680px;margin:0 auto;padding:8px 0">

        <!-- Header -->
        <div style="display:flex;align-items:center;gap:16px;margin-bottom:28px">
          <button class="btn btn-ghost btn-sm" onclick="restoreListContent()">
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
                ${roleLabels[user.role] || user.role}
              </span>
            </div>
          </div>

          <!-- Info Grid -->
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
            ${[
              ['Email',        user.email],
              ['Role',         roleLabels[user.role] || user.role],
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
  try {
    const data = await api(`/api/${currentObject}/listviews`);
    sfListViews = data.listviews || [];
  } catch (err) {
    sfListViews = [];
  }
  renderListViewSelect();
}

function renderListViewSelect() {
  const select = $("listViewSelect");
  const locals = objectLocalViews();
  select.innerHTML = `
    <option value="all">All ${OBJECT_META[currentObject].title}</option>
    ${sfListViews.map((view) => `<option value="sf:${view.id}">Salesforce: ${escapeHtml(view.label)}</option>`).join("")}
    ${locals.map((view) => `<option value="local:${view.id}">Portal: ${escapeHtml(view.name)}</option>`).join("")}
  `;
  select.value = currentViewId;
  if (select.value !== currentViewId) {
    currentViewId = "all";
    select.value = "all";
  }
}

async function handleListViewChange(value) {
  currentViewId = value;
  visibleRecordCount = RENDER_CHUNK_SIZE;
  nextRecordsUrl = null;
  sortState = { field: null, direction: "asc" };
  await loadData();
}

async function loadData() {
  const search = $("objSearch")?.value || "";
  const meta = OBJECT_META[currentObject];
  currentColumns = meta.columns.slice();

  $("pageIcon").innerHTML = objectIcon(currentObject);
  $("pageTitle").textContent = getCurrentViewName();
  $("pageSub").textContent =
    `Loading ${meta.title.toLowerCase()} from Salesforce...`;
  $("stateLoading").style.display = "flex";
  $("stateError").style.display = "none";
  $("tableCard").style.display = "none";
  if ($("kanbanCard")) $("kanbanCard").style.display = "none";
  updateViewToggle();

  try {
    if (currentViewId.startsWith("sf:")) {
      const viewId = currentViewId.slice(3);
      const data = await api(
        `/api/${currentObject}/listviews/${viewId}/results`,
      );
      currentRecords = data.records || [];
      nextRecordsUrl = data.nextRecordsUrl || null;
      totalRecords = data.totalSize || currentRecords.length;
      currentColumns = normalizeListViewColumns(data.columns);
    } else {
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      const query = `?${params.toString()}`;
      const data = await api(`/api/${currentObject}${query}`);
      currentRecords = data.records || [];
      nextRecordsUrl = data.nextRecordsUrl || null;
      totalRecords = data.totalSize || currentRecords.length;
      applyLocalView();
    }

    visibleRecordCount = RENDER_CHUNK_SIZE;
    applySort();
    await renderCurrentView();
    updatePagination();
    updateBadge(currentObject, totalRecords || currentRecords.length);
    updateRecordCounts();
    await verifyListCountWhenSmall();
    $("stateLoading").style.display = "none";
    applyPermissionGuards(currentObject);
    showActiveView();
    queueLazyLoadIfNeeded();
 } catch (err) {
    $('stateLoading').style.display = 'none';
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
  }
}

function normalizeListViewColumns(columns) {
  const fields = (columns || [])
    .map((column) => column.fieldNameOrPath || column.fieldName)
    .filter(
      (field) => field && field !== "Id" && !field.includes("attributes"),
    );
  return fields.length
    ? [...new Set(fields)].slice(0, 8)
    : OBJECT_META[currentObject].columns.slice();
}

function getCurrentViewName() {
  if (currentViewId.startsWith("sf:")) {
    const view = sfListViews.find((item) => item.id === currentViewId.slice(3));
    return view?.label || OBJECT_META[currentObject].title;
  }
  if (currentViewId.startsWith("local:")) {
    const view = objectLocalViews().find(
      (item) => item.id === currentViewId.slice(6),
    );
    return view?.name || OBJECT_META[currentObject].title;
  }
  return OBJECT_META[currentObject].title;
}

function applyLocalView() {
  if (!currentViewId.startsWith("local:")) return;
  const view = objectLocalViews().find(
    (item) => item.id === currentViewId.slice(6),
  );
  if (!view) return;
  currentColumns = view.columns?.length ? view.columns : currentColumns;
  if (view.search) {
    const q = view.search.toLowerCase();
    currentRecords = currentRecords.filter((record) =>
      currentColumns.some((field) =>
        String(getValue(record, field) || "")
          .toLowerCase()
          .includes(q),
      ),
    );
  }
}

function renderTable() {
  const recordsToRender = getRecordsToRender();
  const table = $("dataTable");
  const tableCard = $("tableCard");
  const objectClass = `object-table-${currentObject.toLowerCase()}`;
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
      <th class="actions-col">Actions</th>
    </tr>
  `;

  if (!recordsToRender.length) {
    $("tbody").innerHTML = `
      <tr>
        <td class="table-empty" colspan="${currentColumns.length + 1}">
          <div class="table-empty-icon">${objectIcon(currentObject)}</div>
          <h3>No records found</h3>
          <p>Try a different search, list view, or create a new record.</p>
        </td>
      </tr>
    `;
    return;
  }

  const rowHtml = recordsToRender
    .map(
      (record) => `
    <tr onclick="openRecordDetail('${currentObject}', '${record.Id}')">
      ${currentColumns.map((field) => `<td class="${fieldColumnClass(field)}">${formatValue(field, getValue(record, field), record)}</td>`).join("")}
      <td class="actions-col">
        <div class="row-acts">
          <button class="row-action edit" title="Edit" aria-label="Edit" onclick="event.stopPropagation(); openEdit('${record.Id}')">
            <svg viewBox="0 0 20 20" width="15" height="15" fill="currentColor">
              <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793z"/>
              <path d="M11.379 5.793L3 14.172V17h2.828l8.379-8.379-2.828-2.828z"/>
            </svg>
          </button>
          <button class="row-action del" title="Delete" aria-label="Delete" onclick="event.stopPropagation(); openDelete('${record.Id}')">
            <svg viewBox="0 0 20 20" width="15" height="15" fill="currentColor">
              <path fill-rule="evenodd" d="M8 2a1 1 0 00-.894.553L6.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-2.382l-.724-1.447A1 1 0 0012 2H8zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clip-rule="evenodd"/>
            </svg>
          </button>
        </div>
      </td>
    </tr>
  `,
    )
    .join("");
  const canLoadMore =
    nextRecordsUrl || visibleRecordCount < currentRecords.length;
  $("tbody").innerHTML = `
    ${rowHtml}
    <tr id="lazyLoadSentinel" class="lazy-load-row">
      <td colspan="${currentColumns.length + 1}">
        ${loadingMoreRecords ? "Loading more records..." : canLoadMore ? "Scroll to load more records" : "All loaded"}
      </td>
    </tr>
  `;
  observeLazySentinel();
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
    <article class="kanban-item" draggable="true" data-id="${escapeHtml(record.Id)}"
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
  loadingMoreRecords = true;
  updatePagination();
  try {
    const data = await api(lazyEndpoint(nextRecordsUrl));
    appendUniqueRecords(data.records || []);
    nextRecordsUrl = data.nextRecordsUrl || null;
    totalRecords = data.totalSize || totalRecords || currentRecords.length;
    applyLocalView();
    applySort();
    await renderCurrentView();
    updatePagination();
    updateBadge(currentObject, totalRecords || currentRecords.length);
    updateRecordCounts();
    return true;
  } catch (err) {
    toast(err.message, "err");
    return false;
  } finally {
    loadingMoreRecords = false;
    updatePagination();
    queueLazyLoadIfNeeded();
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
  const tableCard = $("tableCard");
  if (!tableCard) return false;
  const rect = tableCard.getBoundingClientRect();
  return rect.bottom < window.innerHeight + 360;
}

async function handleLazyScroll() {
  if (loadingMoreRecords || !shouldLazyLoadMore()) return;
  if (visibleRecordCount < currentRecords.length) {
    await showMoreVisibleRecords();
    return;
  }
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
  const sentinel = $("lazyLoadSentinel");
  if (!sentinel) return;
  if (!lazyObserver) {
    lazyObserver = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) handleLazyScroll();
      },
      { root: null, rootMargin: "700px 0px", threshold: 0 },
    );
  }
  lazyObserver.disconnect();
  lazyObserver.observe(sentinel);
}

function loadedRangeText() {
  const shown = Math.min(visibleRecordCount, currentRecords.length);
  if (!totalRecords) return `${shown} shown`;
  return `${shown} of ${totalRecords}`;
}

function updateRecordCounts() {
  const shown = Math.min(visibleRecordCount, currentRecords.length);
  const totalLabel = totalRecords || currentRecords.length;
  $("pageSub").textContent = `${totalLabel} records available`;
  $("recCount").textContent =
    currentViewMode === "kanban"
      ? `${currentRecords.length} loaded`
      : `${shown} shown`;
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
      updateRecordCounts();
      updateBadge(currentObject, totalRecords || currentRecords.length);
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
  applySort();
  renderCurrentView();
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
  if (viewingDetail) restoreListContent(false);
  currentObject = objectName;
  currentRecords = [];
  totalRecords = 0;
  nextRecordsUrl = null;
  visibleRecordCount = RENDER_CHUNK_SIZE;
  loadingMoreRecords = false;
  currentViewId = "all";
  currentViewMode = "table";
  sortState = { field: null, direction: "asc" };
  $("objSearch").value = "";
  document.querySelectorAll(".nav-item").forEach((item) => {
    item.classList.toggle("active", item.dataset.obj === objectName);
  });
  closeSidebar();
  await loadListViews();
  await loadData();
}

function restoreListContent(shouldLoad = true) {
  if (!listContentHtml) return;
  $("content").innerHTML = listContentHtml;
  viewingDetail = false;
  detailRecordState = null;
  document.querySelectorAll(".nav-item").forEach((item) => {
    item.classList.toggle("active", item.dataset.obj === currentObject);
  });
  if (shouldLoad) {
    renderListViewSelect();
    loadData();
  }
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
  return Math.min(visibleRecordCount, currentRecords.length);
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
    lazyHint.textContent =
      nextRecordsUrl || visibleRecordCount < currentRecords.length
        ? "Scroll to load more"
        : "All loaded";
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
  const grouped = records.reduce((acc, record) => {
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

function openEdit(id) {
  editingRecord = currentRecords.find((record) => record.Id === id);
  openRecordModal(
    `Edit ${currentObject}`,
    editingRecord || {},
    null,
    currentObject,
  );
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
    const data = await api(`/api/${objectName}/fields`);
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

function getLayoutSections(objectName, fields = []) {
  const layout = OBJECT_FIELD_LAYOUTS[objectName];
  if (!layout) return [];
  const fieldList = (fields || []).map((field) =>
    typeof field === "string" ? { name: field, label: labelFor(field) } : field,
  );
  const resolved = layout
    .map((section) => ({
      title: section.title,
      fields: section.fields
        .map((entry) => resolveLayoutField(entry, fieldList))
        .filter(Boolean),
    }))
    .filter((section) => section.fields.length);
  return resolved;
}

function resolveLayoutField(entry, fields) {
  const config = typeof entry === "string" ? { name: entry } : entry;
  const field = findLayoutField(config.name, fields);
  if (!field) return null;
  return {
    ...field,
    readOnly: Boolean(config.readOnly),
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
    <section class="form-section">
      <div class="form-section-title">${utilityIconSvg("chevronDown")}<span>${escapeHtml(section.title)}</span></div>
      <div class="form-grid">
        ${section.fields.map((field) => renderFieldControl(field.name, record, field, objectName)).join("")}
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
  const required =
    fieldMeta.nillable === false ? '<span class="form-req">*</span>' : "";
  const spanClass = shouldSpanField(field, type) ? "span-2" : "";
  const readOnly =
    Boolean(fieldMeta.readOnly) ||
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

async function openRecordDetail(objectName, id) {
  if (!id || !OBJECT_META[objectName]) return;

  try {
    $("content").innerHTML = `
      <div class="state-box">
        <div class="spinner-ring"><div></div><div></div><div></div><div></div></div>
        <p>Loading record detail...</p>
      </div>
    `;
    viewingDetail = true;

    const data = await api(`/api/${objectName}/${id}`);
    const record = data.record || {};
    const fields = data.fields || [];
    detailLookupLabels = data.lookupLabels || {};
    const title =
      record.Name || record.Subject || record.CaseNumber || record.Email || id;
    const displayFields = fields
      .filter(
        (field) =>
          record[field.name] !== null &&
          record[field.name] !== undefined &&
          field.name !== "attributes",
      )
      .slice(0, 80);

    currentObject = objectName;
    detailRecordState = { objectName, id, record, fields };
    document.querySelectorAll(".nav-item").forEach((item) => {
      item.classList.toggle("active", item.dataset.obj === objectName);
    });
    renderRecordDetailPage(
      objectName,
      record,
      fields,
      displayFields,
      title,
      id,
    );
    if (objectName === "Campaign") {
      activeCampaign = record;
      await Promise.all([
        loadRelatedRecords(objectName, id),
        loadCampaignMembers(id),
        loadRecordActivity(objectName, id),
      ]);
    } else {
      await Promise.all([
        loadRelatedRecords(objectName, id),
        loadRecordActivity(objectName, id),
      ]);
    }
  } catch (err) {
    $("content").innerHTML = `
      <div class="state-box error-state">
        <h3>Could not load record</h3>
        <p>${escapeHtml(err.message)}</p>
        <button class="btn btn-ghost" onclick="restoreListContent()">Back to List</button>
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
  const summaryFields = getSummaryFields(objectName)
    .filter((field) => getValue(record, field) !== undefined)
    .slice(0, 4);
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
          <div class="page-actions">
            <button class="btn btn-ghost" onclick="restoreListContent()">Back</button>
            <button class="btn btn-primary" onclick="editCurrentDetailRecord()">Edit</button>
          </div>
        </div>
        <div class="record-summary">
          ${summaryFields
            .map(
              (field) => `
            <div>
              <span>${escapeHtml(labelFor(field))}</span>
              <strong>${formatValue(field, getValue(record, field), record)}</strong>
            </div>
          `,
            )
            .join("")}
        </div>
      </div>

      <div class="record-layout">
        <section class="record-main">
          <div class="record-tabs">
            <button class="record-tab active" id="tabRelatedBtn" onclick="showRecordTab('related')">Related</button>
            <button class="record-tab" id="tabDetailsBtn" onclick="showRecordTab('details')">Details</button>
          </div>
          <div id="recordRelatedPanel" class="record-tab-panel">
            ${renderRelatedPanel(objectName)}
          </div>
          <div id="recordDetailsPanel" class="record-tab-panel" style="display:none">
            ${renderConfiguredDetailSections(objectName, record, fields, displayFields)}
          </div>
        </section>
        <aside class="record-side">
          <div class="activity-card">
            <div class="side-tabs">
              <button class="side-tab active" id="sideActivityBtn" onclick="showSideTab('activity')">Activity</button>
              <button class="side-tab" id="sideChatterBtn" onclick="showSideTab('chatter')">Chatter</button>
            </div>
            <div id="sideActivityPanel">
              <div class="activity-head">
                <h3>Activity</h3>
                <button class="cell-button-link" onclick="loadRecordActivity('${objectName}', '${id}')">Refresh</button>
              </div>
              <div id="activityTimeline">
                <div class="activity-empty"><p>Loading activities...</p></div>
              </div>
            </div>
            <div id="sideChatterPanel" style="display:none">
              ${renderChatterPanel(objectName)}
            </div>
          </div>
        </aside>
      </div>
    </div>
  `;
  applyPermissionGuards(objectName);
}

function showSideTab(name) {
  $("sideActivityPanel").style.display = name === "activity" ? "block" : "none";
  $("sideChatterPanel").style.display = name === "chatter" ? "block" : "none";
  $("sideActivityBtn").classList.toggle("active", name === "activity");
  $("sideChatterBtn").classList.toggle("active", name === "chatter");
  if (
    name === "chatter" &&
    detailRecordState?.id &&
    chatterState.loadedFor !== detailRecordState.id
  ) {
    loadChatterFeed();
  }
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
      <div class="detail-section-title">${utilityIconSvg("chevronDown")}<span>${escapeHtml(section.title)}</span></div>
      <div class="detail-grid">
        ${section.fields.map((field) => renderDetailField(objectName, record, field)).join("")}
      </div>
    </section>
  `,
    )
    .join("");
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

function renderRelatedPanel(objectName) {
  const configs = getRelatedListConfigs(objectName);
  if (!configs.length && objectName !== "Campaign") {
    return `
      <div class="related-panel no-margin">
        <div class="related-head">
          <div>
            <h3>Related Records</h3>
            <p>Open related records from lookup links in Details.</p>
          </div>
        </div>
        <div class="table-empty">
          <h3>No portal related list configured</h3>
          <p>Use the Details tab or Salesforce Activity Timeline for this record.</p>
        </div>
      </div>
    `;
  }

  return `
    ${configs.map((config, index) => renderRelatedListShell(config, index === 0)).join("")}
    ${objectName === "Campaign" ? renderCampaignMembersShell(!configs.length) : ""}
  `;
}

function getRelatedListConfigs(objectName) {
  return (
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
    }[objectName] || []
  );
}

function renderRelatedListShell(config, noMargin = false) {
  return `
    <div class="related-panel ${noMargin ? "no-margin" : ""}" id="relatedPanel-${escapeHtml(config.key)}">
      <div class="related-head">
        <div>
          <h3>${objectIcon(config.objectName)}<span id="relatedTitle-${escapeHtml(config.key)}">${escapeHtml(config.title)}</span></h3>
          <p>${escapeHtml(relatedListSubtitle(config.objectName))}</p>
        </div>
        <div class="related-actions">
          <button class="btn btn-primary btn-related-new" onclick="openRelatedCreate('${escapeJs(config.key)}')">
            <span aria-hidden="true">+</span>
            New
          </button>
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

async function loadRelatedRecords(objectName, id) {
  const configs = getRelatedListConfigs(objectName);
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
    body.innerHTML = `<div class="table-empty related-empty"><h3>No ${escapeHtml(config.title.toLowerCase())} found</h3></div>`;
    return;
  }

  body.innerHTML = `
    <div class="mini-table-wrap related-table-wrap">
      <table class="mini-table related-table">
        <thead>
          <tr>${config.fields.map((field) => `<th>${escapeHtml(labelFor(field))}</th>`).join("")}</tr>
        </thead>
        <tbody>
          ${records
            .map(
              (record) => `
            <tr onclick="openRecordDetail('${config.objectName}', '${escapeJs(record.Id)}')">
              ${config.fields.map((field) => `<td>${renderRelatedCell(config.objectName, record, field)}</td>`).join("")}
            </tr>
          `,
            )
            .join("")}
        </tbody>
      </table>
    </div>
    ${Number(list.totalSize || records.length) > records.length ? '<div class="related-view-all">Showing first 5 records</div>' : ""}
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
  $("recordRelatedPanel").style.display = name === "related" ? "block" : "none";
  $("recordDetailsPanel").style.display = name === "details" ? "block" : "none";
  $("tabRelatedBtn").classList.toggle("active", name === "related");
  $("tabDetailsBtn").classList.toggle("active", name === "details");
}

function editCurrentDetailRecord() {
  if (!detailRecordState) return;
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
  const state = activityLookupState[kind] || {
    object: objects[0],
    id: "",
    label: "",
  };
  const options = objects
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
  const config = getRelatedListConfigs(detailRecordState.objectName).find(
    (item) => item.key === configKey,
  );
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
  loadEmailTemplates();
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
  if (overlay) return overlay;

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
  const overlay = ensureActivityModal();
  overlay.dataset.type = type;
  initializeActivityLookups();
  if (type === "email") initializeEmailComposer();
  $("activityModalTitle").textContent = activityModalTitle(type);
  $("activityModalIcon").className =
    `activity-modal-icon ${activityIconClass(type)}`;
  $("activityModalIcon").innerHTML = activityIconImage(type);
  $("activitySaveBtn").textContent = type === "email" ? "Send" : "Save";
  $("activityModalBody").innerHTML = renderActivityForm(type);
  if (type === "email") {
    renderEmailFromOptions();
    renderActivityFiles();
  }
  overlay.classList.add("open");
  setTimeout(
    () =>
      $("activityModalBody").querySelector("input, textarea, select")?.focus(),
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
  return `
    <div class="activity-actions">
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
  memberCandidateObject = objectName;
  memberCandidateSelection = new Set();
  $("campaignMemberTitle").textContent = `Add ${objectName}s to Campaign`;
  $("campaignMemberSearch").value = "";
  $("campaignMemberOverlay").classList.add("open");
  await loadCampaignCandidates("");
}

function closeCampaignMemberModal() {
  $("campaignMemberOverlay").classList.remove("open");
}

function searchCampaignCandidates(value) {
  clearTimeout(lookupTimer);
  lookupTimer = setTimeout(() => loadCampaignCandidates(value), 300);
}

async function loadCampaignCandidates(search) {
  const box = $("campaignMemberCandidates");
  box.innerHTML = '<div class="state-box compact">Loading records...</div>';
  try {
    const data = await api(
      `/api/campaigns/${activeCampaign.Id}/candidates/${memberCandidateObject}?search=${encodeURIComponent(search || "")}`,
    );
    const records = data.records || [];
    currentCampaignCandidates = records;
    $("campaignMemberSelectedCount").textContent =
      `${memberCandidateSelection.size} selected`;
    box.innerHTML = renderCampaignCandidateTable(records);
  } catch (err) {
    box.innerHTML = `<div class="error-state compact"><p>${escapeHtml(err.message)}</p></div>`;
  }
}

function renderCampaignCandidateTable(records) {
  if (!records.length)
    return '<div class="table-empty"><h3>No records found</h3><p>Try another search.</p></div>';
  const isContact = memberCandidateObject === "Contact";
  const selectable = records.filter((record) => !record.alreadyMember);
  const allVisibleSelected =
    selectable.length > 0 &&
    selectable.every((record) => memberCandidateSelection.has(record.Id));
  return `
    <table class="mini-table">
      <thead>
        <tr>
          <th><input type="checkbox" aria-label="Select all visible records" ${allVisibleSelected ? "checked" : ""} onchange="toggleAllCandidateSelection(this.checked)"></th>
          <th>Name</th>
          <th>${isContact ? "Account" : "Company"}</th>
          <th>Phone</th>
          <th>Email</th>
          <th>${isContact ? "Title" : "Status"}</th>
        </tr>
      </thead>
      <tbody>
        ${records
          .map(
            (record) => `
          <tr class="${record.alreadyMember ? "muted-row" : ""}">
            <td><input type="checkbox" value="${record.Id}" ${memberCandidateSelection.has(record.Id) ? "checked" : ""} ${record.alreadyMember ? "disabled" : ""} onchange="toggleCandidateSelection('${record.Id}', this.checked)"></td>
            <td>${escapeHtml(record.Name || "-")}</td>
            <td>${escapeHtml(isContact ? record.Account?.Name || "-" : record.Company || "-")}</td>
            <td>${escapeHtml(record.Phone || "-")}</td>
            <td>${record.Email ? `<a class="cell-email" href="mailto:${escapeHtml(record.Email)}">${escapeHtml(record.Email)}</a>` : '<span class="cell-empty">-</span>'}</td>
            <td>${escapeHtml((isContact ? record.Title : record.Status) || (record.alreadyMember ? "Already member" : "-"))}</td>
          </tr>
        `,
          )
          .join("")}
      </tbody>
    </table>
  `;
}

function toggleCandidateSelection(id, checked) {
  if (checked) memberCandidateSelection.add(id);
  else memberCandidateSelection.delete(id);
  $("campaignMemberSelectedCount").textContent =
    `${memberCandidateSelection.size} selected`;
}

function toggleAllCandidateSelection(checked) {
  currentCampaignCandidates
    .filter((record) => !record.alreadyMember)
    .forEach((record) => {
      if (checked) memberCandidateSelection.add(record.Id);
      else memberCandidateSelection.delete(record.Id);
    });
  $("campaignMemberSelectedCount").textContent =
    `${memberCandidateSelection.size} selected`;
  $("campaignMemberCandidates").innerHTML = renderCampaignCandidateTable(
    currentCampaignCandidates,
  );
}

async function addSelectedCampaignMembers() {
  const ids = [...memberCandidateSelection];
  if (!ids.length) {
    toast("Select at least one record", "err");
    return;
  }
  try {
    $("addCampaignMembersBtn").disabled = true;
    const result = await api(`/api/campaigns/${activeCampaign.Id}/members`, {
      method: "POST",
      body: JSON.stringify({ object: memberCandidateObject, ids }),
    });
    toast(`${result.created || 0} members added`, "ok");
    closeCampaignMemberModal();
    await loadCampaignMembers(activeCampaign.Id);
  } catch (err) {
    toast(err.message, "err");
  } finally {
    $("addCampaignMembersBtn").disabled = false;
  }
}

async function openCampaignEmailModal() {
  if (!activeCampaign?.Id) return;
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
    loadData().catch((err) => console.warn("Background refresh failed:", err.message));
  } else {
    loadData().catch((err) => console.warn("Background refresh failed:", err.message));
  }
  if (window.localStorage?.getItem("saasray_debug_timing") === "true") {
    console.log(`[timing] frontend-save-refresh ${objectName}: ${Math.round(performance.now() - startedAt)}ms`);
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
      Object.assign(savedRecord, body);
      toast("Record updated", "ok");
    } else {
      const result = await api(`/api/${objectName}`, {
        method: "POST",
        body: JSON.stringify(body),
      });
      if (result?.id) Object.assign(body, { Id: result.id });
      toast("Record created", "ok");
    }
    setRecordSaveState(false, objectName);
    closeModal();
    refreshAfterSave(objectName, wasEditing ? savedRecord : body, wasEditing)
      .catch((err) => toast(err.message || "Saved, but refresh failed", "err", 8000));
  } catch (err) {
    toast(err.message || 'Could not save record. Please try again.', 'err', 10000);
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
    toast("Record deleted", "ok");
    closeDeleteModal();
    await loadData();
  } catch (err) {
    toast(err.message || 'Could not delete record. Please try again.', 'err', 10000);
  } finally {
    $("confirmDelBtn").disabled = false;
  }
}

function openListViewModal() {
  const meta = OBJECT_META[currentObject];
  $("listViewBody").innerHTML = `
    <div class="form-grid">
      <div class="form-group span-2">
        <label class="form-label" for="viewName">List View Name</label>
        <input class="form-ctrl" id="viewName" placeholder="Example: Key Accounts">
      </div>
      <div class="form-group span-2">
        <label class="form-label" for="viewSearch">Contains Text</label>
        <input class="form-ctrl" id="viewSearch" placeholder="Optional filter text">
      </div>
      <div class="form-group span-2">
        <label class="form-label">Columns</label>
        <div class="check-grid">
          ${meta.columns
            .concat(meta.editable)
            .filter((v, i, arr) => arr.indexOf(v) === i)
            .map(
              (field) => `
            <label class="check-item">
              <input type="checkbox" value="${field}" ${meta.columns.includes(field) ? "checked" : ""}>
              <span>${labelFor(field)}</span>
            </label>
          `,
            )
            .join("")}
        </div>
      </div>
    </div>
  `;
  $("listViewOverlay").classList.add("open");
}

function closeListViewModal() {
  $("listViewOverlay").classList.remove("open");
}

function saveLocalListView() {
  const name = $("viewName").value.trim();
  if (!name) {
    toast("List view name is required", "err");
    return;
  }
  const columns = [
    ...$("listViewBody").querySelectorAll('input[type="checkbox"]:checked'),
  ].map((input) => input.value);
  const views = getLocalViews();
  views[currentObject] = views[currentObject] || [];
  const view = {
    id: `${Date.now()}`,
    name,
    search: $("viewSearch").value.trim(),
    columns: columns.length ? columns : OBJECT_META[currentObject].columns,
  };
  views[currentObject].push(view);
  setLocalViews(views);
  currentViewId = `local:${view.id}`;
  closeListViewModal();
  renderListViewSelect();
  loadData();
}

function overlayClick(event, overlayId, closeFn) {
  if (event.target.id === overlayId) closeFn();
}

function toast(message, type = 'info', duration = 6000) {
  const stack = $('toastStack');
  if (!stack) return;

  // Map raw error messages to human-friendly ones
  const friendlyMessage = friendlyError(message);

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
  queueLazyLoadIfNeeded();
});
window.addEventListener("scroll", handleLazyScroll, { passive: true });

document.addEventListener("DOMContentLoaded", async () => {
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

  // Then boot the app normally
  loadOrgSettings()
    .then(() => checkConnection())
    .then(async (connection) => {
      if (connection?.success) {
        // Refresh permissions from server (in case they changed)
        try {
          const me = await api("/api/portal/me");
          if (me) {
            setStoredPerms(me.permissions || {});
            window.portalUser = me;
            applyAllPermissionGuards();
          }
        } catch {
          // If /portal/me fails, cached perms are still used
        }
        await loadListViews();
        await loadData();
      }
    });
});
