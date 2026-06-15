const memoryCache = new Map();
const DEFAULT_TTL_MS = 60 * 1000;

function cacheKey(parts = {}) {
  return JSON.stringify(parts);
}

function get(key) {
  const item = memoryCache.get(key);
  if (!item) return null;
  if (Date.now() > item.expiresAt) {
    memoryCache.delete(key);
    return null;
  }
  return item.value;
}

function set(key, value, ttlMs = DEFAULT_TTL_MS) {
  memoryCache.set(key, {
    value,
    expiresAt: Date.now() + ttlMs
  });
}

function clearReport(reportId) {
  for (const key of memoryCache.keys()) {
    if (key.includes(`"reportId":"${reportId}"`)) memoryCache.delete(key);
  }
}

module.exports = {
  cacheKey,
  get,
  set,
  clearReport
};
