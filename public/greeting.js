(function () {
  const TIME_SLOTS = [
    { key: "morning", from: 5, to: 11 },
    { key: "afternoon", from: 12, to: 16 },
    { key: "evening", from: 17, to: 20 },
    { key: "night", from: 21, to: 4 }
  ];

  const TYPE_META = {
    general: { icon: "i", className: "general" },
    maintenance: { icon: "!", className: "maintenance" },
    release: { icon: ">", className: "release" },
    warning: { icon: "!", className: "warning" },
    success: { icon: "✓", className: "success" },
    security: { icon: "⌂", className: "security" },
    holiday: { icon: "*", className: "holiday" }
  };

  let announcementPromise = null;

  function greetingForDate(date = new Date()) {
    const hour = date.getHours();
    return TIME_SLOTS.find((item) => {
      if (item.from <= item.to) return hour >= item.from && hour <= item.to;
      return hour >= item.from || hour <= item.to;
    }) || TIME_SLOTS[0];
  }

  function firstNameFromUser(user = {}) {
    const source = String(user.name || user.email || "there").trim();
    const first = source.split(/\s+/)[0] || "there";
    return first.includes("@") ? first.split("@")[0] : first;
  }

  function isSystemAdministrator(user = {}) {
    return Boolean(
      user.isSystemAdmin ||
      user.profile?.is_system_admin ||
      user.profile?.isSystemAdmin ||
      user.role === "system_administrator"
    );
  }

  async function loadAnnouncementState() {
    if (announcementPromise) return announcementPromise;
    announcementPromise = fetch("/api/portal/announcement/active", {
      headers: authHeaders()
    })
      .then((res) => (res.ok ? res.json() : { announcement: null, greetingConfig: {} }))
      .catch(() => ({ announcement: null, greetingConfig: {} }));
    return announcementPromise;
  }

  function authHeaders() {
    const token = localStorage.getItem("saasray_token");
    return token ? { Authorization: `Bearer ${token}` } : {};
  }

  async function renderGreeting(target, user = {}, options = {}) {
    const el = typeof target === "string" ? document.getElementById(target) : target;
    if (!el) return;

    const state = await loadAnnouncementState();
    if (state.announcement) {
      renderAnnouncement(el, state.announcement, options);
      return;
    }
    renderDefaultGreeting(el, user, state.greetingConfig || {}, options);
  }

  function renderAnnouncement(el, announcement, options = {}) {
    const meta = TYPE_META[announcement.type] || TYPE_META.general;
    const icon = announcement.icon || meta.icon;
    const style = announcement.backgroundStyle ? ` style="${escapeHtml(announcement.backgroundStyle)}"` : "";
    el.innerHTML = `
      <section class="enterprise-greeting enterprise-greeting-announcement enterprise-greeting-${meta.className} ${options.compact ? "is-compact" : ""}" aria-label="Announcement"${style}>
        <div class="enterprise-greeting-main">
          <div class="enterprise-greeting-icon" aria-hidden="true">${escapeHtml(icon)}</div>
          <div class="enterprise-greeting-copy">
            <h2>${escapeHtml(announcement.title)}</h2>
            <p>${escapeHtml(announcement.subtitle || "")}</p>
          </div>
        </div>
        <div class="enterprise-greeting-art" aria-hidden="true">
          <span class="enterprise-greeting-sun"></span>
          <span class="enterprise-greeting-hill enterprise-greeting-hill-a"></span>
          <span class="enterprise-greeting-hill enterprise-greeting-hill-b"></span>
        </div>
      </section>
    `;
  }

  function renderDefaultGreeting(el, user = {}, greetingConfig = {}, options = {}) {
    const slot = greetingForDate();
    const config = greetingConfig[slot.key] || {};
    const firstName = firstNameFromUser(user);
    const title = config.title || "Welcome";
    const subtitle = config.subtitle || "";
    const icon = iconForGreeting(config.icon || slot.key);
    const style = config.backgroundStyle ? ` style="${escapeHtml(config.backgroundStyle)}"` : "";
    el.innerHTML = `
      <section class="enterprise-greeting enterprise-greeting-${slot.key} ${options.compact ? "is-compact" : ""}" aria-label="Personalized greeting"${style}>
        <div class="enterprise-greeting-main">
          <div class="enterprise-greeting-icon" aria-hidden="true">${escapeHtml(icon)}</div>
          <div class="enterprise-greeting-copy">
            <h2>${escapeHtml(title)}, ${escapeHtml(firstName)}! <span aria-hidden="true">👋</span></h2>
            <p>${escapeHtml(subtitle)}</p>
          </div>
        </div>
        <div class="enterprise-greeting-art" aria-hidden="true">
          <span class="enterprise-greeting-sun"></span>
          <span class="enterprise-greeting-hill enterprise-greeting-hill-a"></span>
          <span class="enterprise-greeting-hill enterprise-greeting-hill-b"></span>
        </div>
      </section>
    `;
  }

  function iconForGreeting(key) {
    return {
      sun: "☀",
      day: "☀",
      morning: "☀",
      afternoon: "☀",
      evening: "◒",
      night: "☾"
    }[key] || "☀";
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function refreshGreeting(target, user = {}, options = {}) {
    announcementPromise = null;
    return renderGreeting(target, user, options);
  }

  window.SaaSRAYGreeting = {
    firstNameFromUser,
    greetingForDate,
    isSystemAdministrator,
    render: renderGreeting,
    refresh: refreshGreeting
  };
})();
