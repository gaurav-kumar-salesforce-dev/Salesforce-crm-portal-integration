const memoryCache = new Map();
const DEFAULT_TTL_MS = 60 * 1000;
const stats = {
  hits: 0,
  misses: 0,
  writes: 0
};

function cacheKey(parts = {}) {
  return JSON.stringify(parts);
}

function get(key) {
  const item = memoryCache.get(key);
  if (!item) {
    stats.misses += 1;
    return null;
  }
  if (Date.now() > item.expiresAt) {
    memoryCache.delete(key);
    stats.misses += 1;
    return null;
  }
  stats.hits += 1;
  return item.value;
}

function set(key, value, ttlMs = DEFAULT_TTL_MS) {
  memoryCache.set(key, {
    value,
    expiresAt: Date.now() + ttlMs
  });
  stats.writes += 1;
}

function clearReport(reportId) {
  for (const key of memoryCache.keys()) {
    if (key.includes(`"reportId":"${reportId}"`)) memoryCache.delete(key);
  }
}

function snapshotStats() {
  const total = stats.hits + stats.misses;
  return {
    ...stats,
    size: memoryCache.size,
    hitRatio: total ? Math.round((stats.hits / total) * 10000) / 100 : 0
  };
}

module.exports = {
  cacheKey,
  get,
  set,
  clearReport,
  snapshotStats
};
