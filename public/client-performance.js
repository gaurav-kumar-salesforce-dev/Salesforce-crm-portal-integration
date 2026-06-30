(() => {
  const DEFAULT_RESOURCE_TTL_MS = 30 * 1000;
  const DEFAULT_METADATA_TTL_MS = 10 * 60 * 1000;
  const MAX_CACHE_ENTRIES = 250;

  const resourceCache = new Map();
  const metadataCache = new Map();
  const inFlight = new Map();
  const initializedModules = new Set();
  const prefetched = new Set();
  const requestTokens = new Map();
  const metrics = {
    cacheHits: 0,
    cacheMisses: 0,
    dedupedRequests: 0,
    networkRequests: 0,
    staleResponses: 0,
  };

  const isDev =
    location.hostname === "localhost" ||
    location.hostname === "127.0.0.1" ||
    location.search.includes("perf=1");
  const debugEnabled = isDev && sessionStorage.getItem("saasrayPerfDebug") === "1";

  function log(...args) {
    if (debugEnabled) console.debug("[client-perf]", ...args);
  }

  function idle(callback, options = {}) {
    if ("requestIdleCallback" in window) {
      return window.requestIdleCallback(callback, options);
    }
    return window.setTimeout(() => callback({ didTimeout: false, timeRemaining: () => 0 }), options.timeout || 1);
  }

  function normalizeKey(path) {
    try {
      const url = new URL(path, location.origin);
      return `${url.pathname}${url.search}`;
    } catch {
      return String(path || "");
    }
  }

  function cacheFor(type) {
    return type === "metadata" ? metadataCache : resourceCache;
  }

  function ttlFor(type, ttlMs) {
    if (Number.isFinite(ttlMs)) return ttlMs;
    return type === "metadata" ? DEFAULT_METADATA_TTL_MS : DEFAULT_RESOURCE_TTL_MS;
  }

  function prune(cache) {
    if (cache.size <= MAX_CACHE_ENTRIES) return;
    const now = Date.now();
    for (const [key, entry] of cache.entries()) {
      if (!entry || entry.expiresAt <= now) cache.delete(key);
    }
    while (cache.size > MAX_CACHE_ENTRIES) {
      cache.delete(cache.keys().next().value);
    }
  }

  function getCacheValue(key, type = "resource") {
    const cache = cacheFor(type);
    const entry = cache.get(key);
    if (!entry) {
      metrics.cacheMisses += 1;
      return null;
    }
    if (entry.expiresAt <= Date.now()) {
      cache.delete(key);
      metrics.cacheMisses += 1;
      return null;
    }
    metrics.cacheHits += 1;
    return entry.value;
  }

  function setCacheValue(key, value, options = {}) {
    const type = options.type || "resource";
    const cache = cacheFor(type);
    cache.set(key, {
      value,
      expiresAt: Date.now() + ttlFor(type, options.ttlMs),
      metadata: options.metadata || {},
    });
    prune(cache);
    return value;
  }

  function isMetadataPath(path) {
    return /\/(fields|metadata|describe|layout|listviews|related-lists|picklists|record-types|permissions)(\/|\?|$)/i.test(
      String(path || "")
    );
  }

  function shouldCache(path, options = {}) {
    if (options.skipCache || options.skipBrowserCache) return false;
    const method = String(options.method || "GET").toUpperCase();
    if (method !== "GET") return false;
    if (String(path || "").includes("/run") || String(path || "").includes("/preview") || String(path || "").includes("/export")) {
      return Boolean(options.forceCache);
    }
    return Boolean(options.forceCache || options.cacheKey || options.cacheType || isMetadataPath(path));
  }

  function buildFetchOptions(options) {
    const { cacheKey, cacheType, ttlMs, forceCache, skipCache, skipBrowserCache, latestKey, ...fetchOptions } = options;
    return fetchOptions;
  }

  async function fetchJson(path, options = {}) {
    const cacheType = options.cacheType || (isMetadataPath(path) ? "metadata" : "resource");
    const cacheKey = options.cacheKey || normalizeKey(path);
    const cacheable = shouldCache(path, options);
    const inFlightKey = `${String(options.method || "GET").toUpperCase()}:${cacheType}:${cacheKey}`;

    if (cacheable) {
      const cached = getCacheValue(cacheKey, cacheType);
      if (cached) {
        log("cache hit", cacheType, cacheKey);
        return cached;
      }
      if (inFlight.has(inFlightKey)) {
        metrics.dedupedRequests += 1;
        return inFlight.get(inFlightKey);
      }
    }

    const latestKey = options.latestKey || "";
    let token = null;
    if (latestKey) {
      token = Symbol(latestKey);
      requestTokens.set(latestKey, token);
    }

    metrics.networkRequests += 1;
    const startedAt = performance.now();
    const request = fetch(path, buildFetchOptions(options)).then(async (response) => {
      const text = await response.text();
      let data = {};
      if (text) {
        try {
          data = JSON.parse(text);
        } catch {
          data = { raw: text };
        }
      }
      if (!response.ok) {
        const err = new Error(data.error || data.message || `Request failed (${response.status})`);
        err.status = response.status;
        err.payload = data;
        throw err;
      }
      if (latestKey && requestTokens.get(latestKey) !== token) {
        metrics.staleResponses += 1;
        const staleErr = new Error("Stale response ignored");
        staleErr.stale = true;
        throw staleErr;
      }
      if (cacheable) {
        setCacheValue(cacheKey, data, { type: cacheType, ttlMs: options.ttlMs });
      }
      log("network", cacheType, cacheKey, Math.round(performance.now() - startedAt), "ms");
      return data;
    });

    if (cacheable) {
      inFlight.set(inFlightKey, request);
      request.finally(() => inFlight.delete(inFlightKey)).catch(() => {});
    }
    return request;
  }

  function invalidate(scopeOrPredicate) {
    const matches =
      typeof scopeOrPredicate === "function"
        ? scopeOrPredicate
        : (key) => key.startsWith(String(scopeOrPredicate || ""));
    for (const cache of [resourceCache, metadataCache]) {
      for (const key of cache.keys()) {
        if (matches(key)) cache.delete(key);
      }
    }
    for (const key of inFlight.keys()) {
      if (matches(key)) inFlight.delete(key);
    }
  }

  function invalidateObjectMetadata(objectName) {
    const objectKey = String(objectName || "").toLowerCase();
    invalidate((key) => key.toLowerCase().includes(`/api/${objectKey}/`) && isMetadataPath(key));
  }

  function prefetch(path, options = {}) {
    const key = options.cacheKey || normalizeKey(path);
    const type = options.cacheType || (isMetadataPath(path) ? "metadata" : "resource");
    if (prefetched.has(`${type}:${key}`) || getCacheValue(key, type)) return;
    prefetched.add(`${type}:${key}`);
    idle(() => {
      fetchJson(path, { ...options, cacheType: type }).catch((err) => {
        if (!err?.stale) log("prefetch skipped", key, err.message);
      });
    }, { timeout: 1500 });
  }

  function lazyImages(root = document) {
    root.querySelectorAll("img:not([loading])").forEach((img) => {
      img.loading = "lazy";
      img.decoding = "async";
    });
  }

  function markModuleInitialized(name) {
    initializedModules.add(name);
  }

  function isModuleInitialized(name) {
    return initializedModules.has(name);
  }

  window.SaaSRAYPerformance = {
    fetchJson,
    getCacheValue,
    setCacheValue,
    invalidate,
    invalidateObjectMetadata,
    prefetch,
    idle,
    lazyImages,
    markModuleInitialized,
    isModuleInitialized,
    stats: () => ({
      ...metrics,
      resourceEntries: resourceCache.size,
      metadataEntries: metadataCache.size,
      inFlightEntries: inFlight.size,
    }),
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => idle(() => lazyImages(document), { timeout: 1000 }), { once: true });
  } else {
    idle(() => lazyImages(document), { timeout: 1000 });
  }
})();
