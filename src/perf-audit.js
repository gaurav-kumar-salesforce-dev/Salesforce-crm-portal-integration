const { AsyncLocalStorage } = require('async_hooks');
const { performance } = require('perf_hooks');
const crypto = require('crypto');

const store = new AsyncLocalStorage();
const completedRequests = [];
const MAX_COMPLETED = Number(process.env.PERF_AUDIT_MAX_REQUESTS || 300);

function now() {
  return performance.now();
}

function round(value) {
  return Number((value || 0).toFixed(2));
}

function current() {
  return store.getStore() || null;
}

function summarizePath(path = '') {
  const value = String(path || '');
  if (/\/api\/[^/]+\/[^/]+\/related(?:\?|$)/.test(value)) return 'related-list';
  if (/\/api\/[^/]+\/[^/]+\/activity(?:\?|$)/.test(value)) return 'activity';
  if (/\/api\/[^/]+\/[^/]+\/chatter(?:\?|$)/.test(value)) return 'chatter';
  if (/\/api\/portal\/record-pages\//.test(value)) return 'layout-json';
  if (/\/api\/portal\/layouts\//.test(value)) return 'layout-json';
  if (/\/api\/portal\/compact-layouts\//.test(value)) return 'layout-json';
  if (/\/api\/[^/]+\/fields(?:\?|$)/.test(value)) return 'metadata';
  if (/\/api\/[^/]+\/[^/?]+(?:\?|$)/.test(value)) return 'record';
  if (/\/api\/[^/?]+(?:\?|$)/.test(value)) return 'object-list';
  return 'other';
}

function makeContext(req) {
  return {
    id: crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex'),
    method: req.method,
    path: req.originalUrl || req.url,
    routeType: summarizePath(req.originalUrl || req.url),
    start: now(),
    status: 0,
    totalMs: 0,
    counts: {
      supabase: 0,
      salesforce: 0,
      permission: 0,
      sharing: 0,
      layout: 0,
      metadata: 0,
      related: 0,
      activity: 0,
      chatter: 0,
    },
    totals: {
      node: 0,
      supabase: 0,
      salesforce: 0,
      permission: 0,
      sharing: 0,
      layout: 0,
      metadata: 0,
      related: 0,
      activity: 0,
      chatter: 0,
    },
    events: [],
  };
}

function pushCompleted(ctx) {
  completedRequests.push(ctx);
  while (completedRequests.length > MAX_COMPLETED) completedRequests.shift();
}

function middleware(req, res, next) {
  const ctx = makeContext(req);
  res.setHeader('x-perf-request-id', ctx.id);
  store.run(ctx, () => {
    res.on('finish', () => {
      ctx.status = res.statusCode;
      ctx.totalMs = round(now() - ctx.start);
      ctx.totals.node = ctx.totalMs;
      pushCompleted({ ...ctx, events: ctx.events.slice(0, 120) });
    });
    next();
  });
}

function recordEvent(category, label, ms, meta = {}) {
  const ctx = current();
  const duration = round(ms);
  if (!ctx) return;
  const key = ctx.totals[category] === undefined ? 'node' : category;
  ctx.counts[key] = (ctx.counts[key] || 0) + 1;
  ctx.totals[key] = round((ctx.totals[key] || 0) + duration);
  ctx.events.push({
    category: key,
    label: String(label || key).slice(0, 220),
    ms: duration,
    at: round(now() - ctx.start),
    ...meta,
  });
}

async function timeAsync(category, label, fn, meta = {}) {
  const startedAt = now();
  try {
    return await fn();
  } finally {
    recordEvent(category, label, now() - startedAt, meta);
  }
}

function classifySalesforce(endpoint = '') {
  const value = String(endpoint || '');
  if (value.includes('/describe') || value.includes('/ui-api/list-info')) return 'metadata';
  if (value.includes('/related')) return 'related';
  if (value.includes('/chatter')) return 'chatter';
  if (value.includes('/query') && /Task|Event|EmailMessage/i.test(value)) return 'activity';
  return 'salesforce';
}

function instrumentSupabase(supabase) {
  if (!supabase || supabase.__perfAuditWrapped) return supabase;

  function proxyBuilder(builder, label) {
    if (!builder || typeof builder !== 'object') return builder;
    return new Proxy(builder, {
      get(target, prop, receiver) {
        if (prop === 'then') {
          return (onFulfilled, onRejected) => {
            const startedAt = now();
            return target.then(
              (value) => {
                recordEvent('supabase', label, now() - startedAt);
                return onFulfilled ? onFulfilled(value) : value;
              },
              (err) => {
                recordEvent('supabase', label, now() - startedAt, { error: err?.message || 'supabase_error' });
                return onRejected ? onRejected(err) : Promise.reject(err);
              }
            );
          };
        }
        if (prop === 'catch' || prop === 'finally') {
          return target[prop].bind(target);
        }
        const value = Reflect.get(target, prop, receiver);
        if (typeof value !== 'function') return value;
        return (...args) => {
          const result = value.apply(target, args);
          if (result && typeof result === 'object') {
            const argLabel = args.length ? `(${args.map((arg) => String(arg).slice(0, 40)).join(',')})` : '';
            return proxyBuilder(result, `${label}.${String(prop)}${argLabel}`);
          }
          return result;
        };
      },
    });
  }

  const originalFrom = supabase.from.bind(supabase);
  supabase.from = (table) => proxyBuilder(originalFrom(table), `from:${table}`);

  const originalRpc = supabase.rpc?.bind(supabase);
  if (originalRpc) {
    supabase.rpc = (fn, args, options) => proxyBuilder(originalRpc(fn, args, options), `rpc:${fn}`);
  }

  Object.defineProperty(supabase, '__perfAuditWrapped', { value: true });
  return supabase;
}

function report() {
  const requests = completedRequests.slice();
  const slowestRequests = requests
    .slice()
    .sort((a, b) => b.totalMs - a.totalMs)
    .slice(0, 20);
  const slowestEvents = requests
    .flatMap((req) => req.events.map((event) => ({ requestId: req.id, path: req.path, routeType: req.routeType, ...event })))
    .sort((a, b) => b.ms - a.ms)
    .slice(0, 40);
  const routeSummary = {};
  requests.forEach((req) => {
    const item = routeSummary[req.routeType] || {
      count: 0,
      totalMs: 0,
      supabase: 0,
      salesforce: 0,
      permission: 0,
      sharing: 0,
      layout: 0,
      metadata: 0,
      related: 0,
      activity: 0,
      chatter: 0,
    };
    item.count += 1;
    item.totalMs += req.totalMs;
    Object.keys(item).forEach((key) => {
      if (key !== 'count' && key !== 'totalMs') item[key] += req.totals[key] || 0;
    });
    routeSummary[req.routeType] = item;
  });
  Object.values(routeSummary).forEach((item) => {
    item.avgMs = round(item.totalMs / Math.max(item.count, 1));
    Object.keys(item).forEach((key) => {
      if (!['count', 'avgMs'].includes(key)) item[key] = round(item[key]);
    });
  });
  return {
    generatedAt: new Date().toISOString(),
    requestCount: requests.length,
    routeSummary,
    slowestRequests,
    slowestEvents,
    requests,
  };
}

function reset() {
  completedRequests.length = 0;
}

module.exports = {
  middleware,
  recordEvent,
  timeAsync,
  classifySalesforce,
  instrumentSupabase,
  report,
  reset,
};
