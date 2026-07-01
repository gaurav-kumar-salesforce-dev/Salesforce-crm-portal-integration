const OBJECT_REGISTRY = {
  Account: {
    apiName: 'Account',
    label: 'Account',
    pluralLabel: 'Accounts',
    icon: 'account',
    color: '#5867e8',
    fields: 'Id, Name, Type, Industry, Phone, Website, BillingCity, BillingState, AnnualRevenue, NumberOfEmployees',
    defaultSort: 'Name',
    defaultListView: 'all',
    searchFields: ['Name', 'Type', 'Industry', 'Phone', 'BillingCity'],
    listColumns: ['Name', 'Type', 'Industry', 'Phone', 'BillingCity', 'BillingState'],
    editableFields: ['Name', 'Type', 'Industry', 'Phone', 'Website', 'BillingCity', 'BillingState'],
    lookupFields: {},
    relatedLists: [
      { key: 'contacts', objectName: 'Contact', title: 'Contacts', fields: 'Id, Name, Title, Email, Phone, AccountId, Account.Name', whereField: 'AccountId' },
      { key: 'opportunities', objectName: 'Opportunity', title: 'Opportunities', fields: 'Id, Name, StageName, Amount, CloseDate, AccountId, Account.Name', whereField: 'AccountId' },
      { key: 'cases', objectName: 'Case', title: 'Cases', fields: 'Id, CaseNumber, Subject, Status, Priority, Type, AccountId, Account.Name, CreatedDate', whereField: 'AccountId' },
      { key: 'quotes', objectName: 'Quote', title: 'Quotes', fields: 'Id, Name, QuoteNumber, Status, ExpirationDate, GrandTotal, OpportunityId, Opportunity.Name, AccountId, Account.Name', whereField: 'AccountId' }
    ],
    reportRelationships: [
      { childObject: 'Contact', parentField: 'AccountId' },
      { childObject: 'Opportunity', parentField: 'AccountId' },
      { childObject: 'Case', parentField: 'AccountId' }
    ],
    compactLayout: ['Name', 'Type', 'Industry', 'Phone', 'BillingCity'],
    supportsReports: true,
    supportsDashboard: true,
    supportsGlobalSearch: true,
    supportsActivities: true,
    supportsChatter: true,
    supportsInlineEdit: true,
    supportsKanban: false,
    supportsImport: true,
    supportsExport: true,
    primary: true
  },
  Contact: {
    apiName: 'Contact',
    label: 'Contact',
    pluralLabel: 'Contacts',
    icon: 'contact',
    color: '#8d7ae6',
    fields: 'Id, FirstName, LastName, Name, Email, Phone, Title, Account.Name, AccountId',
    defaultSort: 'LastName',
    defaultListView: 'all',
    searchFields: ['LastName', 'FirstName', 'Email', 'Phone', 'Title'],
    listColumns: ['Name', 'Account.Name', 'Email', 'Phone', 'Title'],
    editableFields: ['FirstName', 'LastName', 'Email', 'Phone', 'Title', 'AccountId'],
    lookupFields: { AccountId: { object: 'Account', label: 'Account' } },
    relatedLists: [
      { key: 'cases', objectName: 'Case', title: 'Cases', fields: 'Id, CaseNumber, Subject, Status, Priority, Type, ContactId, AccountId, Account.Name, CreatedDate', whereField: 'ContactId' }
    ],
    compactLayout: ['Name', 'Title', 'Email', 'Phone', 'Account.Name'],
    supportsReports: true,
    supportsDashboard: true,
    supportsGlobalSearch: true,
    supportsActivities: true,
    supportsChatter: true,
    supportsInlineEdit: true,
    supportsKanban: false,
    supportsImport: true,
    supportsExport: true,
    primary: true
  },
  Opportunity: {
    apiName: 'Opportunity',
    label: 'Opportunity',
    pluralLabel: 'Opportunities',
    icon: 'opportunity',
    color: '#f26334',
    fields: 'Id, Name, StageName, Amount, CloseDate, Account.Name, AccountId, Probability, LeadSource',
    defaultSort: 'CloseDate DESC',
    defaultListView: 'all',
    searchFields: ['Name', 'StageName', 'LeadSource'],
    listColumns: ['Name', 'StageName', 'Amount', 'CloseDate', 'Account.Name', 'Probability'],
    editableFields: ['Name', 'StageName', 'Amount', 'CloseDate', 'AccountId', 'Probability', 'LeadSource'],
    lookupFields: { AccountId: { object: 'Account', label: 'Account' } },
    relatedLists: [
      { key: 'quotes', objectName: 'Quote', title: 'Quotes', fields: 'Id, Name, QuoteNumber, Status, ExpirationDate, GrandTotal, OpportunityId, Opportunity.Name, AccountId, Account.Name', whereField: 'OpportunityId' },
      { key: 'opportunityProducts', objectName: 'OpportunityLineItem', title: 'Products', fields: 'Id, OpportunityId, Product2Id, Product2.Name, Quantity, UnitPrice, TotalPrice, ServiceDate, SortOrder', whereField: 'OpportunityId', limit: 10, sortBy: 'SortOrder', sortDir: 'ASC' }
    ],
    compactLayout: ['Name', 'StageName', 'Amount', 'CloseDate', 'Probability'],
    supportsReports: true,
    supportsDashboard: true,
    supportsGlobalSearch: true,
    supportsActivities: true,
    supportsChatter: true,
    supportsInlineEdit: true,
    supportsKanban: true,
    supportsImport: true,
    supportsExport: true,
    primary: true
  },
  Case: {
    apiName: 'Case',
    label: 'Case',
    pluralLabel: 'Cases',
    icon: 'case',
    color: '#f0cf4e',
    fields: 'Id, CaseNumber, Subject, Status, Priority, Type, Account.Name, AccountId, Description, CreatedDate',
    defaultSort: 'CreatedDate DESC',
    defaultListView: 'all',
    searchFields: ['Subject', 'CaseNumber', 'Status', 'Priority'],
    listColumns: ['CaseNumber', 'Subject', 'Status', 'Priority', 'Type', 'Account.Name', 'CreatedDate'],
    editableFields: ['Subject', 'Status', 'Priority', 'Type', 'AccountId', 'Description'],
    lookupFields: { AccountId: { object: 'Account', label: 'Account' } },
    relatedLists: [],
    compactLayout: ['CaseNumber', 'Subject', 'Status', 'Priority', 'Account.Name'],
    supportsReports: true,
    supportsDashboard: true,
    supportsGlobalSearch: true,
    supportsActivities: true,
    supportsChatter: true,
    supportsInlineEdit: true,
    supportsKanban: false,
    supportsImport: true,
    supportsExport: true,
    primary: true
  },
  Lead: {
    apiName: 'Lead',
    label: 'Lead',
    pluralLabel: 'Leads',
    icon: 'lead',
    color: '#00aaa6',
    fields: 'Id, FirstName, LastName, Name, Email, Phone, Company, Status, Title, LeadSource',
    defaultSort: 'LastName',
    defaultListView: 'all',
    searchFields: ['LastName', 'FirstName', 'Email', 'Phone', 'Company'],
    listColumns: ['Name', 'Email', 'Phone', 'Company', 'Status', 'Title', 'LeadSource'],
    editableFields: ['FirstName', 'LastName', 'Email', 'Phone', 'Company', 'Status', 'Title', 'LeadSource'],
    lookupFields: {},
    relatedLists: [],
    reportRelationships: [],
    compactLayout: ['Name', 'Company', 'Status', 'Phone', 'Email'],
    supportsReports: true,
    supportsDashboard: true,
    supportsGlobalSearch: true,
    supportsActivities: true,
    supportsChatter: true,
    supportsInlineEdit: true,
    supportsKanban: true,
    supportsImport: true,
    supportsExport: true,
    primary: true
  },
  Campaign: {
    apiName: 'Campaign',
    label: 'Campaign',
    pluralLabel: 'Campaigns',
    icon: 'campaign',
    color: '#8d7ae6',
    fields: 'Id, Name, Type, Status, StartDate, EndDate, IsActive, Description, NumberOfContacts, NumberOfLeads, NumberOfResponses',
    defaultSort: 'CreatedDate DESC',
    defaultListView: 'all',
    searchFields: ['Name', 'Type', 'Status'],
    listColumns: ['Name', 'Type', 'Status', 'StartDate', 'EndDate', 'IsActive', 'NumberOfContacts', 'NumberOfLeads'],
    editableFields: ['Name', 'Type', 'Status', 'StartDate', 'EndDate', 'IsActive', 'Description'],
    lookupFields: {},
    relatedLists: [
      { key: 'opportunities', objectName: 'Opportunity', title: 'Opportunities', fields: 'Id, Name, StageName, Amount, CloseDate, CampaignId, AccountId, Account.Name', whereField: 'CampaignId' }
    ],
    reportRelationships: [{ childObject: 'Lead', parentField: 'CampaignId' }],
    compactLayout: ['Name', 'Type', 'Status', 'StartDate', 'EndDate'],
    supportsReports: true,
    supportsDashboard: true,
    supportsGlobalSearch: true,
    supportsActivities: true,
    supportsChatter: true,
    supportsInlineEdit: true,
    supportsKanban: false,
    supportsImport: true,
    supportsExport: true,
    primary: true
  },
  Quote: {
    apiName: 'Quote',
    label: 'Quote',
    pluralLabel: 'Quotes',
    icon: 'quote',
    color: '#31a960',
    fields: 'Id, Name, QuoteNumber, Status, ExpirationDate, GrandTotal, Subtotal, OpportunityId, Opportunity.Name, AccountId, Account.Name',
    defaultSort: 'CreatedDate DESC',
    defaultListView: 'all',
    searchFields: ['Name', 'QuoteNumber', 'Status'],
    listColumns: ['Name', 'QuoteNumber', 'Status', 'ExpirationDate', 'GrandTotal', 'Opportunity.Name', 'Account.Name'],
    editableFields: ['Name', 'Status', 'ExpirationDate', 'OpportunityId', 'AccountId', 'Description'],
    lookupFields: {
      OpportunityId: { object: 'Opportunity', label: 'Opportunity' },
      AccountId: { object: 'Account', label: 'Account' }
    },
    relatedLists: [
      { key: 'quoteLineItems', objectName: 'QuoteLineItem', title: 'Quote Line Items', fields: 'Id, LineNumber, QuoteId, Product2Id, Product2.Name, Quantity, UnitPrice, TotalPrice, Discount, Description, SortOrder', whereField: 'QuoteId', limit: 10, sortBy: 'SortOrder', sortDir: 'ASC' }
    ],
    compactLayout: ['Name', 'QuoteNumber', 'Status', 'ExpirationDate', 'GrandTotal'],
    supportsReports: true,
    supportsDashboard: true,
    supportsGlobalSearch: true,
    supportsActivities: true,
    supportsChatter: true,
    supportsInlineEdit: true,
    supportsKanban: false,
    supportsImport: true,
    supportsExport: true,
    primary: true
  },
  Product2: {
    apiName: 'Product2',
    label: 'Product',
    pluralLabel: 'Products',
    icon: 'product',
    color: '#6f30d8',
    fields: 'Id, Name, ProductCode, Family, IsActive, Description, CreatedDate',
    defaultSort: 'Name',
    defaultListView: 'all',
    searchFields: ['Name', 'ProductCode', 'Family', 'Description'],
    listColumns: ['Name', 'ProductCode', 'Family', 'IsActive', 'Description'],
    editableFields: ['Name', 'ProductCode', 'Family', 'IsActive', 'Description'],
    lookupFields: {},
    relatedLists: [],
    compactLayout: ['Name', 'ProductCode', 'Family', 'IsActive'],
    supportsReports: true,
    supportsDashboard: true,
    supportsGlobalSearch: true,
    supportsActivities: false,
    supportsChatter: true,
    supportsInlineEdit: true,
    supportsKanban: false,
    supportsImport: true,
    supportsExport: true,
    primary: true
  },
  OpportunityLineItem: {
    apiName: 'OpportunityLineItem',
    label: 'Opportunity Product',
    pluralLabel: 'Opportunity Products',
    icon: 'opportunityProduct',
    color: '#f35f3c',
    fields: 'Id, OpportunityId, Opportunity.Name, Product2Id, Product2.Name, PricebookEntryId, Quantity, UnitPrice, TotalPrice, ListPrice, ServiceDate, Description, SortOrder',
    defaultSort: 'SortOrder, ServiceDate',
    defaultListView: 'all',
    searchFields: ['Description'],
    listColumns: ['Product2.Name', 'Quantity', 'UnitPrice', 'TotalPrice', 'ServiceDate'],
    editableFields: ['OpportunityId', 'PricebookEntryId', 'Quantity', 'UnitPrice', 'ServiceDate', 'Description'],
    lookupFields: {
      OpportunityId: { object: 'Opportunity', label: 'Opportunity' },
      Product2Id: { object: 'Product2', label: 'Product' }
    },
    relatedLists: [],
    compactLayout: ['Product2.Name', 'Quantity', 'UnitPrice', 'TotalPrice'],
    supportsReports: true,
    supportsDashboard: true,
    supportsGlobalSearch: true,
    supportsActivities: false,
    supportsChatter: false,
    supportsInlineEdit: true,
    supportsKanban: false,
    supportsImport: true,
    supportsExport: true,
    primary: true
  },
  QuoteLineItem: {
    apiName: 'QuoteLineItem',
    label: 'Quote Line Item',
    pluralLabel: 'Quote Line Items',
    icon: 'quoteLineItem',
    color: '#31a960',
    fields: 'Id, LineNumber, QuoteId, Quote.Name, Product2Id, Product2.Name, PricebookEntryId, Quantity, UnitPrice, TotalPrice, ListPrice, Discount, Description, SortOrder',
    defaultSort: 'SortOrder, LineNumber',
    defaultListView: 'all',
    searchFields: ['Description'],
    listColumns: ['LineNumber', 'Quote.Name', 'Product2.Name', 'Quantity', 'UnitPrice', 'TotalPrice', 'Discount'],
    editableFields: ['QuoteId', 'PricebookEntryId', 'Quantity', 'UnitPrice', 'Discount', 'Description'],
    lookupFields: {
      QuoteId: { object: 'Quote', label: 'Quote' },
      Product2Id: { object: 'Product2', label: 'Product' }
    },
    relatedLists: [],
    compactLayout: ['LineNumber', 'Quote.Name', 'Product2.Name', 'Quantity', 'TotalPrice'],
    supportsReports: true,
    supportsDashboard: true,
    supportsGlobalSearch: false,
    supportsActivities: false,
    supportsChatter: false,
    supportsInlineEdit: true,
    supportsKanban: false,
    supportsImport: true,
    supportsExport: true,
    primary: true
  },
  Task: {
    apiName: 'Task',
    label: 'Task',
    pluralLabel: 'Tasks',
    icon: 'task',
    color: '#2fbf7b',
    fields: 'Id, Subject, Status, Priority, ActivityDate, TaskSubtype, WhoId, Who.Name, WhatId, What.Name, OwnerId, Owner.Name, Description, CreatedDate',
    defaultSort: 'CreatedDate DESC',
    defaultListView: 'all',
    searchFields: ['Subject', 'Status', 'Priority', 'Description'],
    listColumns: ['Subject', 'Status', 'Priority', 'ActivityDate', 'Who.Name', 'What.Name'],
    editableFields: ['Subject', 'Status', 'Priority', 'ActivityDate', 'WhoId', 'WhatId', 'Description'],
    lookupFields: {
      WhoId: { object: 'Contact', label: 'Name' },
      WhatId: { object: 'Account', label: 'Related To' },
      OwnerId: { object: 'User', label: 'Assigned To' }
    },
    relatedLists: [],
    compactLayout: ['Subject', 'Status', 'Priority', 'ActivityDate'],
    supportsReports: false,
    supportsDashboard: false,
    supportsGlobalSearch: false,
    supportsActivities: false,
    supportsChatter: false,
    supportsInlineEdit: true,
    supportsKanban: false,
    supportsImport: false,
    supportsExport: true,
    internal: true
  },
  Event: {
    apiName: 'Event',
    label: 'Event',
    pluralLabel: 'Events',
    icon: 'event',
    color: '#b54bf2',
    fields: 'Id, Subject, StartDateTime, EndDateTime, IsAllDayEvent, Location, WhoId, Who.Name, WhatId, What.Name, OwnerId, Owner.Name, Description, CreatedDate',
    defaultSort: 'StartDateTime DESC',
    defaultListView: 'all',
    searchFields: ['Subject', 'Location', 'Description'],
    listColumns: ['Subject', 'StartDateTime', 'EndDateTime', 'Location', 'Who.Name', 'What.Name'],
    editableFields: ['Subject', 'StartDateTime', 'EndDateTime', 'IsAllDayEvent', 'Location', 'WhoId', 'WhatId', 'Description'],
    lookupFields: {
      WhoId: { object: 'Contact', label: 'Name' },
      WhatId: { object: 'Account', label: 'Related To' },
      OwnerId: { object: 'User', label: 'Assigned To' }
    },
    relatedLists: [],
    compactLayout: ['Subject', 'StartDateTime', 'EndDateTime', 'Location'],
    supportsReports: false,
    supportsDashboard: false,
    supportsGlobalSearch: false,
    supportsActivities: false,
    supportsChatter: false,
    supportsInlineEdit: true,
    supportsKanban: false,
    supportsImport: false,
    supportsExport: true,
    internal: true
  },
  EmailMessage: {
    apiName: 'EmailMessage',
    label: 'Email Message',
    pluralLabel: 'Email Messages',
    icon: 'email',
    color: '#888888',
    fields: 'Id, Subject, FromName, FromAddress, ToAddress, CcAddress, BccAddress, MessageDate, Status, RelatedToId, RelatedTo.Name, CreatedById, CreatedBy.Name, CreatedDate, TextBody',
    defaultSort: 'MessageDate DESC',
    defaultListView: 'all',
    searchFields: ['Subject', 'FromAddress', 'ToAddress'],
    listColumns: ['Subject', 'FromAddress', 'ToAddress', 'MessageDate', 'Status', 'RelatedTo.Name'],
    editableFields: ['Subject', 'Status', 'RelatedToId'],
    lookupFields: {
      RelatedToId: { object: 'Account', label: 'Related To' },
      CreatedById: { object: 'User', label: 'Created By' }
    },
    relatedLists: [],
    compactLayout: ['Subject', 'FromAddress', 'ToAddress', 'MessageDate'],
    supportsReports: false,
    supportsDashboard: false,
    supportsGlobalSearch: false,
    supportsActivities: false,
    supportsChatter: false,
    supportsInlineEdit: false,
    supportsKanban: false,
    supportsImport: false,
    supportsExport: true,
    internal: true
  },
  Pricebook2: {
    apiName: 'Pricebook2',
    label: 'Pricebook',
    pluralLabel: 'Pricebooks',
    icon: 'product',
    color: '#6f30d8',
    fields: 'Id, Name, IsActive, Description',
    defaultSort: 'Name',
    defaultListView: 'all',
    searchFields: ['Name', 'Description'],
    listColumns: ['Name', 'IsActive', 'Description'],
    editableFields: ['Name', 'IsActive', 'Description'],
    lookupFields: {},
    relatedLists: [],
    compactLayout: ['Name', 'IsActive'],
    supportsReports: false,
    supportsDashboard: false,
    supportsGlobalSearch: false,
    supportsActivities: false,
    supportsChatter: false,
    supportsInlineEdit: true,
    supportsKanban: false,
    supportsImport: false,
    supportsExport: true,
    internal: true
  },
  User: {
    apiName: 'User',
    label: 'User',
    pluralLabel: 'Users',
    icon: 'user',
    color: '#607d8b',
    fields: 'Id, Name, Email, Username, Title, IsActive',
    defaultSort: 'Name',
    defaultListView: 'all',
    searchFields: ['Name', 'Email', 'Username'],
    listColumns: ['Name', 'Email', 'Username', 'Title'],
    editableFields: [],
    lookupFields: {},
    relatedLists: [],
    compactLayout: ['Name', 'Email', 'Username', 'Title'],
    supportsReports: false,
    supportsDashboard: false,
    supportsGlobalSearch: false,
    supportsActivities: false,
    supportsChatter: false,
    supportsInlineEdit: false,
    supportsKanban: false,
    supportsImport: false,
    supportsExport: false,
    internal: true
  }
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function getObjectConfig(apiName) {
  return OBJECT_REGISTRY[apiName] || null;
}

function getPrimaryObjectNames() {
  return Object.values(OBJECT_REGISTRY).filter((item) => item.primary).map((item) => item.apiName);
}

function getInternalObjectNames() {
  return Object.values(OBJECT_REGISTRY).filter((item) => item.internal).map((item) => item.apiName);
}

function getObjectDefinitions() {
  return Object.fromEntries(Object.entries(OBJECT_REGISTRY).map(([apiName, cfg]) => [
    apiName,
    {
      fields: cfg.fields,
      orderBy: cfg.defaultSort,
      searchFields: cfg.searchFields || []
    }
  ]));
}

function getReportableObjectNames() {
  return Object.values(OBJECT_REGISTRY)
    .filter((item) => item.supportsReports)
    .map((item) => item.apiName);
}

function getReportRelationshipMap() {
  return Object.fromEntries(Object.values(OBJECT_REGISTRY)
    .filter((item) => item.reportRelationships?.length)
    .map((item) => [
      item.apiName,
      Object.fromEntries(item.reportRelationships.map((rel) => [rel.childObject, rel.parentField]))
    ]));
}

function getFrontendRegistry() {
  return Object.fromEntries(Object.entries(OBJECT_REGISTRY).map(([apiName, cfg]) => [
    apiName,
    {
      apiName: cfg.apiName,
      label: cfg.label,
      title: cfg.pluralLabel,
      pluralLabel: cfg.pluralLabel,
      icon: cfg.icon,
      color: cfg.color,
      columns: cfg.listColumns || [],
      editable: cfg.editableFields || [],
      lookups: cfg.lookupFields || {},
      defaultListView: cfg.defaultListView,
      defaultSort: cfg.defaultSort,
      searchFields: cfg.searchFields || [],
      relatedLists: cfg.relatedLists || [],
      reportRelationships: cfg.reportRelationships || [],
      compactLayout: cfg.compactLayout || [],
      supportsReports: Boolean(cfg.supportsReports),
      supportsDashboard: Boolean(cfg.supportsDashboard),
      supportsGlobalSearch: Boolean(cfg.supportsGlobalSearch),
      supportsActivities: Boolean(cfg.supportsActivities),
      supportsChatter: Boolean(cfg.supportsChatter),
      supportsInlineEdit: Boolean(cfg.supportsInlineEdit),
      supportsKanban: Boolean(cfg.supportsKanban),
      supportsImport: Boolean(cfg.supportsImport),
      supportsExport: Boolean(cfg.supportsExport)
    }
  ]));
}

module.exports = {
  OBJECT_REGISTRY,
  getObjectConfig,
  getObjectDefinitions,
  getPrimaryObjectNames,
  getInternalObjectNames,
  getReportableObjectNames,
  getReportRelationshipMap,
  getFrontendRegistry,
  cloneObjectRegistry: () => clone(OBJECT_REGISTRY)
};
