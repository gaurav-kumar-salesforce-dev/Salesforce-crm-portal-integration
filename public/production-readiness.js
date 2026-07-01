(function () {
  "use strict";

  const TOAST_LIMIT = 4;
  const REQUEST_DELAY_MS = 300;
  const state = {
    toastQueue: [],
    activeToasts: 0,
    requestCount: 0,
    loadingTimer: null,
    dirtyForms: new WeakMap(),
    lastNetworkError: null,
    trustedNavigationUntil: 0,
  };

  function $(id) {
    return document.getElementById(id);
  }

  function esc(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function friendlyError(message = "") {
    const text = String(message || "").trim();
    const lower = text.toLowerCase();
    if (!text) return "Something went wrong. Please try again.";
    if (lower.includes("failed to fetch") || lower.includes("network")) return "Network unavailable. Check your connection and try again.";
    if (lower.includes("unauthorized") || lower.includes("401") || lower.includes("session")) return "Your session expired. Please sign in again.";
    if (lower.includes("permission") || lower.includes("403") || lower.includes("access")) return "You do not have permission to perform this action.";
    if (lower.includes("timeout")) return "The request took too long. Please try again.";
    if (lower.includes("500") || lower.includes("server")) return "Server unavailable. Please try again in a moment.";
    if (lower.includes("stack") || lower.includes(" at ")) return "Something went wrong. Please try again.";
    return text;
  }

  function ensureToastStack() {
    let stack = $("toastStack");
    if (!stack) {
      stack = document.createElement("div");
      stack.id = "toastStack";
      stack.className = "toast-stack";
      document.body.appendChild(stack);
    }
    stack.classList.add("production-toast-stack");
    stack.setAttribute("aria-live", "polite");
    stack.setAttribute("aria-relevant", "additions");
    return stack;
  }

  function normalizeToastType(type) {
    if (type === "ok" || type === "success") return "success";
    if (type === "err" || type === "error") return "error";
    if (type === "warn") return "warning";
    return "info";
  }

  function showNextToast() {
    if (state.activeToasts >= TOAST_LIMIT || !state.toastQueue.length) return;
    const item = state.toastQueue.shift();
    const stack = ensureToastStack();
    const type = normalizeToastType(item.type);
    const labels = { success: "Success", error: "Error", warning: "Warning", info: "Info" };
    const icons = { success: "✓", error: "!", warning: "!", info: "i" };
    const el = document.createElement("div");
    el.className = `production-toast production-toast-${type}`;
    el.setAttribute("role", type === "error" ? "alert" : "status");
    el.innerHTML = `
      <div class="production-toast-icon">${icons[type]}</div>
      <div class="production-toast-body">
        <strong>${labels[type]}</strong>
        <span>${esc(type === "error" ? friendlyError(item.message) : item.message)}</span>
      </div>
      <button type="button" class="production-toast-close" aria-label="Dismiss notification">×</button>
    `;
    state.activeToasts += 1;
    stack.appendChild(el);
    requestAnimationFrame(() => el.classList.add("in"));
    const remove = () => {
      el.classList.remove("in");
      setTimeout(() => {
        el.remove();
        state.activeToasts = Math.max(0, state.activeToasts - 1);
        showNextToast();
      }, 180);
    };
    el.querySelector(".production-toast-close").addEventListener("click", remove);
    const timer = setTimeout(remove, item.duration || (type === "error" ? 8000 : 4800));
    el.addEventListener("mouseenter", () => clearTimeout(timer), { once: true });
    showNextToast();
  }

  function notify(message, type = "info", duration) {
    const last = state.toastQueue[state.toastQueue.length - 1];
    if (last && last.message === message && normalizeToastType(last.type) === normalizeToastType(type)) return;
    state.toastQueue.push({ message: String(message || ""), type, duration });
    showNextToast();
  }

  window.SaaSRAYToast = { notify, success: (m) => notify(m, "success"), error: (m) => notify(m, "error"), warning: (m) => notify(m, "warning"), info: (m) => notify(m, "info") };
  window.SaaSRAYProduction = {
    notify,
    resetDirtyState,
    allowTrustedNavigation,
    hasDirtyForm,
  };

  function installToastBridge() {
    window.toast = function productionToast(message, type = "info", duration) {
      notify(message, type, duration);
    };
  }

  function ensureTopLoadingBar() {
    let bar = $("globalTopLoadingBar");
    if (!bar) {
      bar = document.createElement("div");
      bar.id = "globalTopLoadingBar";
      bar.className = "global-top-loading-bar";
      document.body.appendChild(bar);
    }
    return bar;
  }

  function updateLoadingBar() {
    const bar = ensureTopLoadingBar();
    if (state.requestCount <= 0) {
      clearTimeout(state.loadingTimer);
      state.loadingTimer = null;
      bar.classList.remove("visible");
      return;
    }
    if (!state.loadingTimer && !bar.classList.contains("visible")) {
      state.loadingTimer = setTimeout(() => {
        if (state.requestCount > 0) bar.classList.add("visible");
      }, REQUEST_DELAY_MS);
    }
  }

  function installFetchProgress() {
    if (window.__saasrayProductionFetchInstalled) return;
    window.__saasrayProductionFetchInstalled = true;
    const originalFetch = window.fetch.bind(window);
    window.fetch = async function productionFetch(input, init) {
      state.requestCount += 1;
      updateLoadingBar();
      const requestId = `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
      const options = { ...(init || {}) };
      const baseHeaders = options.headers || (typeof Request !== "undefined" && input instanceof Request ? input.headers : undefined);
      const headers = new Headers(baseHeaders || {});
      headers.set("X-Request-Id", requestId);
      options.headers = headers;
      try {
        const response = await originalFetch(input, options);
        if (!response.ok && response.status >= 500) state.lastNetworkError = { input, init };
        return response;
      } catch (err) {
        state.lastNetworkError = { input, init };
        notify("Network unavailable. Your current page state is preserved.", "warning", 7000);
        throw err;
      } finally {
        state.requestCount = Math.max(0, state.requestCount - 1);
        updateLoadingBar();
      }
    };
  }

  function installNetworkDetection() {
    window.addEventListener("offline", () => notify("You are offline. Changes are not lost, but requests may fail.", "warning", 8000));
    window.addEventListener("online", () => {
      notify("Connection restored.", "success", 4000);
      state.lastNetworkError = null;
    });
  }

  function formSnapshot(form) {
    const pairs = [];
    if (form instanceof HTMLFormElement) {
      const data = new FormData(form);
      data.forEach((value, key) => pairs.push([key, value]));
    } else {
      form.querySelectorAll("input, textarea, select").forEach((field, index) => {
        if (field.type === "button" || field.type === "submit" || field.type === "reset") return;
        const key = field.name || field.id || `field_${index}`;
        const value = field.type === "checkbox" || field.type === "radio" ? field.checked : field.value;
        pairs.push([key, value]);
      });
    }
    return JSON.stringify(pairs.sort((a, b) => String(a[0]).localeCompare(String(b[0]))));
  }

  function rememberForm(form) {
    if (form?.closest?.("[data-unsaved-ignore='true']")) return;
    if (!form || state.dirtyForms.has(form)) return;
    state.dirtyForms.set(form, { initial: formSnapshot(form), dirty: false });
  }

  function markDirtyIfChanged(form) {
    if (form?.closest?.("[data-unsaved-ignore='true']")) return;
    if (!form) return;
    rememberForm(form);
    const saved = state.dirtyForms.get(form);
    if (!saved) return;
    saved.dirty = saved.initial !== formSnapshot(form);
  }

  function resetDirtyState(root = document) {
    const targets = [];
    if (root?.matches?.("form, .modal, .report-modal-card, .dashboard-modal-card")) targets.push(root);
    root?.querySelectorAll?.("form, .modal, .report-modal-card, .dashboard-modal-card").forEach((el) => targets.push(el));
    targets.forEach((el) => {
      state.dirtyForms.set(el, { initial: formSnapshot(el), dirty: false });
    });
  }

  function allowTrustedNavigation(ms = 12000) {
    state.trustedNavigationUntil = Date.now() + ms;
  }

  function isTrustedNavigationAllowed() {
    return Date.now() < state.trustedNavigationUntil;
  }

  function isTrustedNavigationElement(el) {
    if (!el) return false;
    if (el.closest?.("[data-trusted-navigation]")) return true;
    const href = el.getAttribute?.("href") || "";
    const onclick = el.getAttribute?.("onclick") || "";
    if (/\/auth\/salesforce|oauth|callback/i.test(href)) return true;
    return /saveOrgAndConnect|connectSalesforce|switchOrgFromSelect|switchOrg|logoutSalesforce|submitLogin|submitGoogleLogin|finishGoogleLoginFromRedirect/i.test(onclick);
  }

  function isFormDirty(form) {
    if (form?.closest?.("[data-unsaved-ignore='true']")) return false;
    const saved = state.dirtyForms.get(form);
    return Boolean(saved?.dirty && saved.initial !== formSnapshot(form));
  }

  function hasDirtyForm() {
    return false;
  }

  function confirmIfDirty() {
    return true;
  }

  function installDirtyFormProtection() {
    return;
    document.addEventListener("focusin", (event) => {
      const formLike = event.target.closest("form, .modal, .report-modal-card, .dashboard-modal-card");
      if (formLike) rememberForm(formLike);
    });
    document.addEventListener("input", (event) => {
      const formLike = event.target.closest("form, .modal, .report-modal-card, .dashboard-modal-card");
      if (formLike) markDirtyIfChanged(formLike);
    }, true);
    document.addEventListener("change", (event) => {
      const formLike = event.target.closest("form, .modal, .report-modal-card, .dashboard-modal-card");
      if (formLike) markDirtyIfChanged(formLike);
    }, true);
    document.addEventListener("submit", (event) => {
      const formLike = event.target.closest("form");
      if (formLike) state.dirtyForms.delete(formLike);
    }, true);
    document.addEventListener("click", (event) => {
      const leaving = event.target.closest("a[href], .modal-close, .close-btn, [data-close], [onclick*='close']");
      if (!leaving) return;
      if (isTrustedNavigationElement(leaving)) {
        allowTrustedNavigation();
        return;
      }
      if (!confirmIfDirty()) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    }, true);
    window.addEventListener("beforeunload", (event) => {
      if (isTrustedNavigationAllowed()) return;
      if (!hasDirtyForm()) return;
      event.preventDefault();
      event.returnValue = "";
    });
    window.addEventListener("popstate", () => {
      if (isTrustedNavigationAllowed()) return;
      if (hasDirtyForm() && !confirmIfDirty()) {
        history.forward();
      }
    }, true);
  }

  function decorateLoadingAndEmptyStates(root = document) {
    root.querySelectorAll(".state-box, .reports-page-busy, .dashboard-page-busy, .reports-loading-row").forEach((el) => {
      if (/loading|fetching|working/i.test(el.textContent || "")) el.classList.add("production-skeleton-state");
    });
    root.querySelectorAll(".table-empty, .reports-empty-row, .dashboard-component-empty, .res-empty, .error-state").forEach((el) => {
      el.classList.add("production-polished-state");
    });
    root.querySelectorAll("button:not([aria-label])").forEach((button) => {
      const text = button.textContent.trim();
      const title = button.getAttribute("title");
      if (!text && title) button.setAttribute("aria-label", title);
    });
    root.querySelectorAll(".modal, .report-modal-card, .dashboard-modal-card").forEach((modal) => {
      modal.setAttribute("role", "dialog");
      modal.setAttribute("aria-modal", "true");
    });
  }

  function installUxObserver() {
    decorateLoadingAndEmptyStates();
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        mutation.addedNodes.forEach((node) => {
          if (node.nodeType === 1) decorateLoadingAndEmptyStates(node);
        });
      });
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  function installGlobalErrorBoundary() {
    window.addEventListener("error", (event) => {
      if (event.message) notify("Something went wrong. Please try again.", "error");
    });
    window.addEventListener("unhandledrejection", (event) => {
      const message = event.reason?.message || event.reason || "Something went wrong.";
      notify(friendlyError(message), "error");
    });
  }

  installFetchProgress();
  installNetworkDetection();
  installDirtyFormProtection();
  installGlobalErrorBoundary();
  installToastBridge();
  document.addEventListener("DOMContentLoaded", () => {
    installToastBridge();
    ensureTopLoadingBar();
    installUxObserver();
  });
  window.addEventListener("load", () => setTimeout(installToastBridge, 0));
})();
