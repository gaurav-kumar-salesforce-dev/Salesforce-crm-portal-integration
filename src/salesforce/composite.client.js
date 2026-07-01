function createCompositeClient({
  axios,
  getAccessToken,
  instanceUrl,
  apiVersion,
  perfAudit,
  isEnabled = () => true
}) {
  const stats = {
    compositeRequests: 0,
    graphRequests: 0,
    batchRequests: 0,
    fallbacks: 0,
    requestsSaved: 0,
    totalLatencyMs: 0,
    failures: 0
  };

  function apiPath(endpoint, params = {}) {
    const search = new URLSearchParams(params || {});
    const query = search.toString();
    return `/services/data/${apiVersion()}${endpoint}${query ? `?${query}` : ''}`;
  }

  async function authHeaders(extra = {}) {
    const token = await getAccessToken();
    return {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...extra
    };
  }

  function averageLatencyMs() {
    return stats.compositeRequests
      ? Number((stats.totalLatencyMs / stats.compositeRequests).toFixed(1))
      : 0;
  }

  async function fallbackItems(items) {
    stats.fallbacks += 1;
    return Promise.all(items.map((item) => item.fallback()));
  }

  async function compositeGet(items = [], options = {}) {
    const eligible = items.filter((item) => item && item.endpoint && typeof item.fallback === 'function');
    if (!eligible.length) return [];
    if (eligible.length <= 1 || !isEnabled()) {
      return Promise.all(eligible.map((item) => item.fallback()));
    }

    const startedAt = performance.now();
    const run = async () => {
      const res = await axios.post(`${instanceUrl()}/services/data/${apiVersion()}/composite`, {
        allOrNone: false,
        compositeRequest: eligible.map((item, index) => ({
          method: 'GET',
          url: apiPath(item.endpoint, item.params),
          referenceId: item.referenceId || `ref${index + 1}`
        }))
      }, {
        timeout: options.timeout || 30000,
        headers: await authHeaders(options.headers)
      });

      const responses = res.data?.compositeResponse || [];
      if (responses.length !== eligible.length) {
        throw new Error('Composite response count mismatch');
      }

      const failed = responses.find((item) => item.httpStatusCode < 200 || item.httpStatusCode >= 300);
      if (failed) {
        const message = Array.isArray(failed.body)
          ? failed.body.map((item) => item.message).filter(Boolean).join('; ')
          : failed.body?.message || 'Composite subrequest failed';
        throw new Error(message);
      }

      return responses.map((item) => item.body);
    };

    try {
      const result = perfAudit?.timeAsync
        ? await perfAudit.timeAsync('salesforce', `COMPOSITE GET ${eligible.length}`, run, { composite: true })
        : await run();
      stats.compositeRequests += 1;
      stats.requestsSaved += Math.max(eligible.length - 1, 0);
      stats.totalLatencyMs += performance.now() - startedAt;
      return result;
    } catch (err) {
      stats.failures += 1;
      if (options.fallback === false) throw err;
      return fallbackItems(eligible);
    }
  }

  async function compositeGraph() {
    stats.graphRequests += 1;
    throw new Error('Composite Graph is not enabled for this read-only sprint.');
  }

  async function batch() {
    stats.batchRequests += 1;
    throw new Error('Composite Batch is not enabled for this read-only sprint.');
  }

  function getStats() {
    return {
      ...stats,
      averageLatencyMs: averageLatencyMs()
    };
  }

  function resetStats() {
    Object.keys(stats).forEach((key) => {
      stats[key] = 0;
    });
  }

  return {
    compositeGet,
    compositeGraph,
    batch,
    getStats,
    resetStats
  };
}

module.exports = {
  createCompositeClient
};
