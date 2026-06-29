(() => {
  const startedAt = performance.now();
  const state = {
    sessions: [],
    active: null,
    requests: [],
    duplicateRequests: new Map(),
    dom: { added: 0, removed: 0, mutationBatches: 0 },
    listeners: { added: 0, byType: {} },
    renders: {},
    components: {},
    marks: [],
    longTasks: [],
    paints: {},
    lcp: null,
    layoutShifts: [],
    resources: [],
    memory: [],
  };

  function round(value) {
    return Number((value || 0).toFixed(2));
  }

  function pathOf(input) {
    try {
      const url = new URL(typeof input === "string" ? input : input?.url || "", location.origin);
      return `${url.pathname}${url.search}`;
    } catch {
      return String(input || "");
    }
  }

  function classify(path) {
    const value = String(path || "");
    if (/\/api\/[^/]+\/[^/]+\/related(?:\?|$)/.test(value)) return "related-list";
    if (/\/api\/[^/]+\/[^/]+\/activity(?:\?|$)/.test(value)) return "activity";
    if (/\/api\/[^/]+\/[^/]+\/chatter(?:\?|$)/.test(value)) return "chatter";
    if (/\/api\/portal\/(?:record-pages|layouts|compact-layouts)\//.test(value)) return "layout-json";
    if (/\/api\/[^/]+\/fields(?:\?|$)/.test(value)) return "metadata";
    if (/\/api\/[^/]+\/listviews/.test(value)) return "metadata";
    if (/\/api\/[^/]+\/[^/?]+(?:\?|$)/.test(value)) return "record";
    if (/\/api\/[^/?]+(?:\?|$)/.test(value)) return "object-list";
    return "other";
  }

  function currentSession() {
    if (!state.active) {
      state.active = beginSession("ambient", { source: "auto" });
    }
    return state.active;
  }

  function beginSession(type, meta = {}) {
    const session = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      type,
      meta,
      start: performance.now(),
      end: 0,
      totalMs: 0,
      apiRequests: [],
      domStart: { ...state.dom },
      listenersStart: state.listeners.added,
      renderStart: { ...state.renders },
      componentStart: { ...state.components },
      events: [],
      memoryStart: memorySnapshot(),
      memoryEnd: null,
    };
    state.sessions.push(session);
    state.active = session;
    return session;
  }

  function endSession(session = state.active) {
    if (!session || session.end) return session;
    session.end = performance.now();
    session.totalMs = round(session.end - session.start);
    session.domCreated = state.dom.added - session.domStart.added;
    session.domRemoved = state.dom.removed - session.domStart.removed;
    session.listenersAdded = state.listeners.added - session.listenersStart;
    session.renderDelta = diffCounts(state.renders, session.renderStart);
    session.componentDelta = diffCounts(state.components, session.componentStart);
    session.memoryEnd = memorySnapshot();
    if (state.active === session) state.active = null;
    return session;
  }

  function diffCounts(current, baseline) {
    const result = {};
    Object.keys(current).forEach((key) => {
      const delta = (current[key] || 0) - (baseline[key] || 0);
      if (delta) result[key] = delta;
    });
    return result;
  }

  function memorySnapshot() {
    const mem = performance.memory;
    if (!mem) return null;
    return {
      usedJSHeapSize: mem.usedJSHeapSize,
      totalJSHeapSize: mem.totalJSHeapSize,
      jsHeapSizeLimit: mem.jsHeapSizeLimit,
      at: round(performance.now() - startedAt),
    };
  }

  function mark(label, meta = {}) {
    const session = currentSession();
    const item = { label, at: round(performance.now() - session.start), ...meta };
    session.events.push(item);
    state.marks.push({ sessionId: session.id, ...item });
  }

  const originalFetch = window.fetch.bind(window);
  window.fetch = async function auditedFetch(input, options = {}) {
    const url = pathOf(input);
    const method = String(options.method || "GET").toUpperCase();
    const key = `${method} ${url}`;
    const started = performance.now();
    const session = currentSession();
    const request = {
      sessionId: session.id,
      method,
      url,
      type: classify(url),
      startAt: round(started - session.start),
      responseAt: 0,
      durationMs: 0,
      status: 0,
      ok: false,
      perfRequestId: "",
      blockingRender: /\/api\/[^/]+(?:\?|$)|\/api\/[^/]+\/[^/?]+(?:\?|$)|\/api\/portal\/(?:record-pages|layouts|compact-layouts)\//.test(url),
    };
    state.duplicateRequests.set(key, (state.duplicateRequests.get(key) || 0) + 1);
    state.requests.push(request);
    session.apiRequests.push(request);
    mark("api-request-start", { url, method, type: request.type });
    try {
      const response = await originalFetch(input, options);
      request.status = response.status;
      request.ok = response.ok;
      request.perfRequestId = response.headers.get("x-perf-request-id") || "";
      request.responseAt = round(performance.now() - session.start);
      request.durationMs = round(performance.now() - started);
      mark("api-response", { url, method, status: response.status, ms: request.durationMs });
      return response;
    } catch (err) {
      request.error = err?.message || "fetch_error";
      request.responseAt = round(performance.now() - session.start);
      request.durationMs = round(performance.now() - started);
      mark("api-error", { url, method, error: request.error, ms: request.durationMs });
      throw err;
    }
  };

  const originalAddEventListener = EventTarget.prototype.addEventListener;
  EventTarget.prototype.addEventListener = function auditedAddEventListener(type, listener, options) {
    state.listeners.added += 1;
    state.listeners.byType[type] = (state.listeners.byType[type] || 0) + 1;
    return originalAddEventListener.call(this, type, listener, options);
  };

  const mutationObserver = new MutationObserver((mutations) => {
    state.dom.mutationBatches += 1;
    mutations.forEach((mutation) => {
      state.dom.added += mutation.addedNodes?.length || 0;
      state.dom.removed += mutation.removedNodes?.length || 0;
    });
  });

  if (document.documentElement) {
    mutationObserver.observe(document.documentElement, { childList: true, subtree: true });
  }

  function observePerformance(type, handler) {
    try {
      const observer = new PerformanceObserver((list) => list.getEntries().forEach(handler));
      observer.observe({ type, buffered: true });
    } catch {
      // Browser does not support this entry type.
    }
  }

  observePerformance("paint", (entry) => {
    state.paints[entry.name] = round(entry.startTime);
  });

  observePerformance("largest-contentful-paint", (entry) => {
    state.lcp = {
      startTime: round(entry.startTime),
      renderTime: round(entry.renderTime),
      loadTime: round(entry.loadTime),
      size: entry.size,
      element: entry.element?.tagName || "",
    };
  });

  observePerformance("longtask", (entry) => {
    state.longTasks.push({
      name: entry.name,
      startTime: round(entry.startTime),
      duration: round(entry.duration),
      attribution: (entry.attribution || []).map((item) => item.name || item.containerType || "").filter(Boolean),
    });
  });

  observePerformance("layout-shift", (entry) => {
    if (!entry.hadRecentInput) {
      state.layoutShifts.push({ startTime: round(entry.startTime), value: round(entry.value) });
    }
  });

  setInterval(() => {
    const snapshot = memorySnapshot();
    if (snapshot) state.memory.push(snapshot);
  }, 5000);

  function increment(map, key) {
    map[key] = (map[key] || 0) + 1;
  }

  function wrapAsync(name, type, beforeMeta = () => ({})) {
    const original = window[name];
    if (typeof original !== "function" || original.__perfAuditWrapped) return false;
    window[name] = async function auditedFunction(...args) {
      const session = beginSession(type, { function: name, args: args.map((arg) => String(arg).slice(0, 80)), ...beforeMeta(args) });
      mark(`${name}:start`);
      try {
        return await original.apply(this, args);
      } finally {
        mark(`${name}:end`);
        requestAnimationFrame(() => {
          requestAnimationFrame(() => endSession(session));
        });
      }
    };
    window[name].__perfAuditWrapped = true;
    return true;
  }

  function wrapSyncCounter(name, bucket) {
    const original = window[name];
    if (typeof original !== "function" || original.__perfAuditWrapped) return false;
    window[name] = function auditedCounter(...args) {
      const started = performance.now();
      try {
        return original.apply(this, args);
      } finally {
        const ms = round(performance.now() - started);
        increment(bucket, name);
        mark(`${name}:render`, { ms });
      }
    };
    window[name].__perfAuditWrapped = true;
    return true;
  }

  function wrapKnownGlobals() {
    wrapAsync("switchObject", "switch-object", (args) => ({ objectName: args[0] }));
    wrapAsync("loadData", "load-list", (args) => ({ forceRefresh: Boolean(args[0]?.forceRefresh) }));
    wrapAsync("openRecordDetail", "open-record", (args) => ({ objectName: args[0], id: args[1] }));
    wrapAsync("loadRelatedRecords", "related-list", (args) => ({ objectName: args[0], id: args[1] }));
    wrapAsync("loadRecordActivity", "activity", (args) => ({ objectName: args[0], id: args[1] }));
    wrapAsync("loadChatterFeed", "chatter", (args) => ({ force: Boolean(args[0]) }));
    wrapAsync("loadLayoutForObject", "layout-json", (args) => ({ objectName: args[0] }));
    wrapAsync("loadCompactLayoutForObject", "layout-json", (args) => ({ objectName: args[0] }));
    wrapAsync("loadRecordPageForObject", "layout-json", (args) => ({ objectName: args[0] }));
    wrapSyncCounter("renderRecordDetailPage", state.renders);
    wrapSyncCounter("renderCurrentView", state.renders);
    wrapSyncCounter("renderTable", state.renders);
    wrapSyncCounter("renderRelatedList", state.renders);
    wrapSyncCounter("renderRecordActivity", state.renders);
    wrapSyncCounter("renderChatterFeedItems", state.renders);
    wrapAsync("preloadCrmComponent", "component-init", (args) => {
      increment(state.components, args[0] || "unknown");
      return { component: args[0] };
    });
  }

  const wrapTimer = setInterval(wrapKnownGlobals, 300);
  window.addEventListener("load", () => {
    wrapKnownGlobals();
    setTimeout(() => clearInterval(wrapTimer), 10000);
    state.resources = performance.getEntriesByType("resource")
      .filter((entry) => /\/(?:app|client-performance|perf-audit|components\/).*\.js|\.css/i.test(entry.name))
      .map((entry) => ({
        name: entry.name.replace(location.origin, ""),
        initiatorType: entry.initiatorType,
        startTime: round(entry.startTime),
        duration: round(entry.duration),
        transferSize: entry.transferSize || 0,
        decodedBodySize: entry.decodedBodySize || 0,
      }));
  });

  function duplicates() {
    return [...state.duplicateRequests.entries()]
      .filter(([, count]) => count > 1)
      .map(([request, count]) => ({ request, count }))
      .sort((a, b) => b.count - a.count);
  }

  function report() {
    const openSessions = state.sessions.map((session) => (session.end ? session : endSession(session)));
    return {
      generatedAt: new Date().toISOString(),
      paints: state.paints,
      lcp: state.lcp,
      longTasks: state.longTasks,
      layoutShifts: state.layoutShifts,
      requests: state.requests,
      duplicates: duplicates(),
      sessions: openSessions,
      frontend: {
        domNodesCreated: state.dom.added,
        domNodesRemoved: state.dom.removed,
        mutationBatches: state.dom.mutationBatches,
        eventListenersAdded: state.listeners.added,
        eventListenersByType: state.listeners.byType,
        renderCount: state.renders,
        componentsInitialized: state.components,
      },
      modules: state.resources,
      memory: state.memory,
      currentMemory: memorySnapshot(),
    };
  }

  function reset() {
    state.sessions.length = 0;
    state.active = null;
    state.requests.length = 0;
    state.duplicateRequests.clear();
    state.dom = { added: 0, removed: 0, mutationBatches: 0 };
    state.listeners = { added: 0, byType: {} };
    state.renders = {};
    state.components = {};
    state.marks.length = 0;
    state.longTasks.length = 0;
    state.layoutShifts.length = 0;
    state.memory.length = 0;
  }

  window.SaaSRAYPerfAudit = { report, reset, mark, beginSession, endSession };
})();
