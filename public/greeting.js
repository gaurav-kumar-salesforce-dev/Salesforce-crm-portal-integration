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
    announcementPromise = fetch("/api/portal/communication/banner", {
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
    renderCommunicationStrip(el, user, state || {}, options);
  }

  function renderCommunicationStrip(el, user = {}, state = {}, options = {}) {
    const cards = communicationCards(user, state, options);

    if (!cards.length) {
      renderDefaultGreeting(el, user, state.greetingConfig || {}, options);
      return;
    }

    const visibleCards = cards.slice(0, 4);
    const cardCount = visibleCards.length;
    el.innerHTML = `
      <section class="communication-strip communication-strip-count-${cardCount} ${options.compact ? "is-compact" : ""}" aria-label="Communication Center">
        <button class="communication-strip-arrow is-prev" type="button" aria-label="Previous communication" onclick="SaaSRAYGreeting.slide(event, this, -1)">&lsaquo;</button>
        <div class="communication-strip-track" style="--communication-card-count:${cardCount}">
          ${visibleCards.map((card) => card.html).join("")}
        </div>
        <button class="communication-strip-arrow is-next" type="button" aria-label="Next communication" onclick="SaaSRAYGreeting.slide(event, this, 1)">&rsaquo;</button>
        ${cardCount > 1 ? `
          <div class="communication-strip-dots" aria-hidden="true">
            ${visibleCards.map((_, index) => `<span class="${index === 0 ? "active" : ""}"></span>`).join("")}
          </div>
        ` : ""}
      </section>
    `;
  }

  function communicationCards(user = {}, state = {}, options = {}) {
    const normalize = (items, kind, label, priority) => {
      const list = Array.isArray(items) ? items : (items ? [items] : []);
      return list
        .filter((item) => item && item.title)
        .map((item) => ({
          priority,
          html: communicationCard(item, kind, label)
        }));
    };
    const cards = [
      ...normalize(state.announcement, "announcement", "Announcement", 1),
      { priority: 2, html: defaultGreetingCard(user, state.greetingConfig || {}, options) },
      ...normalize(state.whatsNew, "whats-new", "What's New", 3),
      ...normalize(state.alert, "alert", "Important Alert", 4)
    ].filter((card) => card.html).sort((a, b) => a.priority - b.priority);

    const hasKind = (kind) => cards.some((card) => card.kind === kind || card.html.includes(`communication-${kind}`));
    if (!hasKind("alert")) {
      cards.unshift({
        priority: 4,
        html: communicationCard(defaultCommunicationItem("alert"), "alert", "Important Alert")
      });
    }
    if (!hasKind("announcement")) {
      cards.push({
        priority: 1,
        html: communicationCard(defaultCommunicationItem("announcement"), "announcement", "Announcement")
      });
    }
    if (!hasKind("whats-new")) {
      cards.push({
        priority: 3,
        html: communicationCard(defaultCommunicationItem("whats-new"), "whats-new", "What's New")
      });
    }
    return cards.sort((a, b) => a.priority - b.priority);
  }

  function defaultCommunicationItem(kind) {
    return {
      announcement: {
        title: "System Maintenance",
        subtitle: "CRM will be under maintenance on July 5, 2026 from 10:00 PM to 1:00 AM.",
        icon: "megaphone",
        ctaText: "View Details"
      },
      "whats-new": {
        title: "Reports v2 Released",
        subtitle: "Grouping, Charts and Scheduled Reports are now available.",
        icon: "sparkles",
        ctaText: "Explore"
      },
      alert: {
        title: "Your password will expire in 5 days.",
        subtitle: "Update now to keep your account secure.",
        icon: "shield",
        ctaText: "Update"
      }
    }[kind] || {};
  }

  function communicationCard(item, kind, label) {
    if (!item || !item.title) return "";
    const ctaUrl = item.ctaUrl || item.actionUrl || item.url || "";
    const ctaText = item.ctaText || item.actionLabel || "";
    const actionType = item.actionType || item.action_type || "";
    const meta = {
      announcement: { icon: iconForCommunication(item.icon || "megaphone"), cta: ctaText || "View Details" },
      "whats-new": { icon: iconForCommunication(item.icon || "sparkles"), cta: ctaText || "Explore" },
      alert: { icon: iconForCommunication(item.icon || "shield"), cta: ctaText || "Review" }
    }[kind] || { icon: iconForCommunication(item.icon || "info"), cta: ctaText || "View" };
    const actionAttrs = ctaUrl
      ? ` role="button" tabindex="0" data-action-url="${escapeHtml(ctaUrl)}" data-action-type="${escapeHtml(actionType)}" onclick="SaaSRAYGreeting.openAction(event, this)" onkeydown="SaaSRAYGreeting.keyAction(event, this)"`
      : "";
    return `
      <article class="communication-card communication-${kind}" aria-label="${escapeHtml(label)}"${actionAttrs}>
        <button class="communication-dismiss" type="button" aria-label="Dismiss ${escapeHtml(label)}" onclick="SaaSRAYGreeting.dismissCard(event, this)">x</button>
        <div>
          <div class="communication-eyebrow">${escapeHtml(label)}</div>
          <h2>${escapeHtml(item.title)}</h2>
          <p>${escapeHtml(item.subtitle || "")}</p>
          ${ctaUrl || ctaText ? `<span class="communication-cta">${escapeHtml(meta.cta)} -></span>` : ""}
        </div>
        <div class="communication-illustration" aria-hidden="true">${meta.icon}</div>
      </article>
    `;
  }

  function defaultGreetingCard(user = {}, greetingConfig = {}, options = {}) {
    const slot = greetingForDate();
    const config = greetingConfig[slot.key] || {};
    const firstName = firstNameFromUser(user);
    const title = config.title || "Welcome";
    const subtitle = config.subtitle || "";
    const icon = iconForGreetingHtml(config.icon || slot.key);
    return `
      <article class="communication-card communication-greeting" aria-label="Greeting">
        <button class="communication-dismiss" type="button" aria-label="Dismiss Greeting" onclick="SaaSRAYGreeting.dismissCard(event, this)">x</button>
        <div>
          <div class="communication-eyebrow">${escapeHtml(title)}</div>
          <h2>${escapeHtml(title)}, ${escapeHtml(firstName)}!</h2>
          <p>${escapeHtml(subtitle)}</p>
        </div>
        <div class="communication-illustration" aria-hidden="true">${icon}</div>
      </article>
    `;
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
    const icon = iconForGreetingHtml(config.icon || slot.key);
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

  function iconForGreetingHtml(key) {
    return {
      sun: "&#9728;",
      day: "&#9728;",
      morning: "&#9728;",
      afternoon: "&#9728;",
      evening: "&#9728;",
      night: "&#9790;"
    }[key] || "&#9728;";
  }

  function iconForCommunication(key) {
    const normalized = String(key || "").toLowerCase();
    return {
      megaphone: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 10.5v3a1.5 1.5 0 0 0 1.5 1.5H7l1.5 4h3L10 15h2l7 3V6l-7 3H5.5A1.5 1.5 0 0 0 4 10.5Z"/><path d="M20.5 9.5a3 3 0 0 1 0 5"/></svg>',
      announcement: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 10.5v3a1.5 1.5 0 0 0 1.5 1.5H7l1.5 4h3L10 15h2l7 3V6l-7 3H5.5A1.5 1.5 0 0 0 4 10.5Z"/><path d="M20.5 9.5a3 3 0 0 1 0 5"/></svg>',
      sparkles: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 2 1.8 5.2L19 9l-5.2 1.8L12 16l-1.8-5.2L5 9l5.2-1.8L12 2Z"/><path d="m18 14 .9 2.6 2.6.9-2.6.9L18 21l-.9-2.6-2.6-.9 2.6-.9L18 14Z"/><path d="m5 14 .7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7.7-2Z"/></svg>',
      rocket: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4c2.8-1 5-1 6-1-1.2 5.5-3.4 8.3-7 11.2L9.8 11C11 7.8 12.4 5.2 14 4Z"/><path d="M9.5 11.5 6 12l-3 3 4.5 1.5"/><path d="M12.5 14.5 12 18l-3 3-1.5-4.5"/><circle cx="15.5" cy="7.5" r="1.5"/></svg>',
      package: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7.5 12 3l8 4.5v9L12 21l-8-4.5v-9Z"/><path d="m4.5 8 7.5 4 7.5-4"/><path d="M12 12v8.5"/></svg>',
      shield: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 20 6v6c0 5-3.4 8.4-8 9-4.6-.6-8-4-8-9V6l8-3Z"/><path d="M9 12.2 11 14l4-4"/></svg>',
      warning: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 22 20H2L12 3Z"/><path d="M12 9v5"/><path d="M12 17h.01"/></svg>',
      security: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 20 6v6c0 5-3.4 8.4-8 9-4.6-.6-8-4-8-9V6l8-3Z"/><path d="M9 12.2 11 14l4-4"/></svg>',
      maintenance: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14.7 6.3 3-3 3 3-3 3"/><path d="M17.7 9.3 9 18l-4 1 1-4 8.7-8.7"/></svg>',
      alert: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 20 6v6c0 5-3.4 8.4-8 9-4.6-.6-8-4-8-9V6l8-3Z"/><path d="M12 8v5"/><path d="M12 16h.01"/></svg>',
      info: "i"
    }[normalized] || escapeHtml(key || "i");
  }

  function dismissCard(event, button) {
    event?.stopPropagation?.();
    const card = button?.closest?.(".communication-card");
    if (!card) return;
    const strip = card.closest(".communication-strip");
    card.remove();
    const remaining = Array.from(strip?.querySelectorAll(".communication-card") || []);
    if (!remaining.length) {
      strip.remove();
      return;
    }
    const nextCount = Math.min(remaining.length, 4);
    strip.className = strip.className.replace(/communication-strip-count-\d/g, `communication-strip-count-${nextCount}`);
    const track = strip.querySelector(".communication-strip-track");
    if (track) track.style.setProperty("--communication-card-count", String(nextCount));
    strip.querySelectorAll(".communication-strip-dots span").forEach((dot, index) => {
      dot.style.display = index < nextCount ? "" : "none";
      dot.classList.toggle("active", index === 0);
    });
  }

  function keyAction(event, element) {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    openAction(event, element);
  }

  function openAction(event, element) {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    const url = element?.dataset?.actionUrl;
    if (!url) return;
    const type = element?.dataset?.actionType || "";
    if (type === "external_url" || /^https?:\/\//i.test(url)) {
      window.open(url, "_blank", "noopener,noreferrer");
      return;
    }
    if (type === "dashboard") {
      window.location.href = url.startsWith("#") ? url : `/dashboards.html${url}`;
      return;
    }
    if (type === "report") {
      window.location.href = url.startsWith("#") ? url : `/reports.html${url}`;
      return;
    }
    window.location.href = url;
  }

  function slideStrip(event, button, direction) {
    event?.stopPropagation?.();
    const strip = button?.closest?.(".communication-strip");
    const track = strip?.querySelector?.(".communication-strip-track");
    if (!track) return;
    const cards = Array.from(track.querySelectorAll(".communication-card"));
    if (cards.length <= 1) return;
    track.style.opacity = ".72";
    window.setTimeout(() => {
      if (direction > 0) track.appendChild(cards[0]);
      else track.insertBefore(cards[cards.length - 1], cards[0]);
      track.style.opacity = "1";
      const dots = strip.querySelectorAll(".communication-strip-dots span");
      if (dots.length) {
        const activeIndex = Array.from(dots).findIndex((dot) => dot.classList.contains("active"));
        const nextIndex = (activeIndex + direction + dots.length) % dots.length;
        dots.forEach((dot, index) => dot.classList.toggle("active", index === nextIndex));
      }
    }, 120);
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
    dismissCard,
    keyAction,
    openAction,
    slide: slideStrip,
    render: renderGreeting,
    refresh: refreshGreeting
  };
})();
