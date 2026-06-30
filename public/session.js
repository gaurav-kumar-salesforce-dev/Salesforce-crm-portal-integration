(function () {
  const TOKEN_KEY = "saasray_token";
  const PERMS_KEY = "saasray_perms";
  const LAST_ACTIVITY_KEY = "saasray_last_activity";
  const LAST_REFRESH_KEY = "saasray_session_last_refresh";
  const INACTIVITY_MS = 2 * 60 * 60 * 1000;
  const ACTIVITY_WRITE_THROTTLE_MS = 30000;
  const REFRESH_WINDOW_MS = 10 * 60 * 1000;
  const REFRESH_THROTTLE_MS = 5 * 60 * 1000;

  let lastActivityWrite = 0;
  let refreshPromise = null;

  function now() {
    return Date.now();
  }

  function getToken() {
    return localStorage.getItem(TOKEN_KEY);
  }

  function decodeJwt(token) {
    try {
      return JSON.parse(atob(String(token).split(".")[1] || ""));
    } catch {
      return {};
    }
  }

  function tokenExpiresAt(token) {
    const exp = decodeJwt(token).exp;
    return exp ? exp * 1000 : 0;
  }

  function markActivity(force = false) {
    const timestamp = now();
    if (!force && timestamp - lastActivityWrite < ACTIVITY_WRITE_THROTTLE_MS) return;
    lastActivityWrite = timestamp;
    localStorage.setItem(LAST_ACTIVITY_KEY, String(timestamp));
  }

  function lastActivityAt() {
    const stored = Number(localStorage.getItem(LAST_ACTIVITY_KEY) || 0);
    if (stored) return stored;
    markActivity(true);
    return now();
  }

  function isInactive() {
    return Boolean(getToken()) && now() - lastActivityAt() > INACTIVITY_MS;
  }

  function clearLocalAuth() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(PERMS_KEY);
    localStorage.removeItem(LAST_REFRESH_KEY);
    if (window.userPerms) window.userPerms = {};
    if (window.portalUser) window.portalUser = null;
  }

  function redirectToLogin(message) {
    clearLocalAuth();
    if (typeof window.showLoginPage === "function") {
      window.showLoginPage(message || "Your session expired. Please log in again.");
      return;
    }
    if (window.location.pathname !== "/") {
      window.location.href = "/";
    }
  }

  function shouldRefresh(token, force = false) {
    if (!token || isInactive()) return false;
    if (force) return true;
    const expiresAt = tokenExpiresAt(token);
    if (!expiresAt) return true;
    if (expiresAt - now() < REFRESH_WINDOW_MS) return true;
    const lastRefresh = Number(localStorage.getItem(LAST_REFRESH_KEY) || 0);
    return now() - lastRefresh > REFRESH_THROTTLE_MS && expiresAt - now() < REFRESH_WINDOW_MS * 3;
  }

  async function refreshSession(options = {}) {
    const token = getToken();
    if (!token) return null;
    if (isInactive()) {
      redirectToLogin("You were logged out after 2 hours of inactivity.");
      return null;
    }
    if (!shouldRefresh(token, Boolean(options.force))) return token;
    if (refreshPromise) return refreshPromise;

    refreshPromise = fetch("/api/auth/session/refresh", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`
      }
    })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          const err = new Error(data.error || `Session refresh failed (${res.status})`);
          err.status = res.status;
          err.code = data.code;
          throw err;
        }
        if (data.token) localStorage.setItem(TOKEN_KEY, data.token);
        if (data.permissions) {
          localStorage.setItem(PERMS_KEY, JSON.stringify(data.permissions));
          window.userPerms = data.permissions;
        }
        if (data.user) window.portalUser = data.user;
        localStorage.setItem(LAST_REFRESH_KEY, String(now()));
        markActivity(true);
        return data.token || getToken();
      })
      .catch((err) => {
        if (err.status === 401 || ["TOKEN_EXPIRED", "TOKEN_INVALID", "NO_TOKEN", "USER_INACTIVE"].includes(err.code)) {
          redirectToLogin(err.code === "USER_INACTIVE" ? "Your account is inactive." : "Your session expired. Please log in again.");
        }
        throw err;
      })
      .finally(() => {
        refreshPromise = null;
      });

    return refreshPromise;
  }

  async function authorizedFetch(path, options = {}) {
    markActivity();
    if (isInactive()) {
      redirectToLogin("You were logged out after 2 hours of inactivity.");
      throw new Error("Session expired");
    }

    await refreshSession().catch(() => null);

    const doFetch = () => {
      const token = getToken();
      const headers = {
        "Content-Type": "application/json",
        ...(options.headers || {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      };
      return fetch(path, { ...options, headers });
    };

    let res = await doFetch();
    if (res.status !== 401) return res;

    const clone = res.clone();
    const data = await clone.json().catch(() => ({}));
    if (["TOKEN_EXPIRED", "TOKEN_INVALID"].includes(data.code)) {
      await refreshSession({ force: true });
      res = await doFetch();
    } else if (["NO_TOKEN", "USER_INACTIVE"].includes(data.code)) {
      redirectToLogin(data.code === "USER_INACTIVE" ? "Your account is inactive." : "Your session expired. Please log in again.");
    }
    return res;
  }

  function init() {
    if (getToken()) markActivity(true);
    ["mousemove", "mousedown", "keydown", "scroll", "touchstart"].forEach((eventName) => {
      window.addEventListener(eventName, () => markActivity(), { passive: true });
    });
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) markActivity(true);
    });
    setInterval(() => {
      if (isInactive()) {
        redirectToLogin("You were logged out after 2 hours of inactivity.");
      } else {
        refreshSession().catch(() => null);
      }
    }, 60000);
  }

  window.SaaSRAYSession = {
    authorizedFetch,
    clearLocalAuth,
    getToken,
    init,
    isInactive,
    markActivity,
    refreshSession,
    tokenExpiresAt
  };

  init();
})();
