(function () {
  const GREETINGS = [
    {
      key: "morning",
      from: 5,
      to: 11,
      label: "Good Morning",
      icon: "☀️",
      subtitle: "Have a productive day ahead."
    },
    {
      key: "afternoon",
      from: 12,
      to: 16,
      label: "Good Afternoon",
      icon: "🌤",
      subtitle: "Keep the momentum going."
    },
    {
      key: "evening",
      from: 17,
      to: 20,
      label: "Good Evening",
      icon: "🌇",
      subtitle: "Hope you had a productive day."
    },
    {
      key: "night",
      from: 21,
      to: 4,
      label: "Good Night",
      icon: "🌙",
      subtitle: "Take care and see you tomorrow."
    }
  ];

  function greetingForDate(date = new Date()) {
    const hour = date.getHours();
    return GREETINGS.find((item) => {
      if (item.from <= item.to) return hour >= item.from && hour <= item.to;
      return hour >= item.from || hour <= item.to;
    }) || GREETINGS[0];
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

  function renderGreeting(target, user = {}, options = {}) {
    const el = typeof target === "string" ? document.getElementById(target) : target;
    if (!el) return;

    const greeting = greetingForDate();
    const firstName = firstNameFromUser(user);
    const subtitle = isSystemAdministrator(user) ? "Manage users, permissions, and CRM settings." : "Have a productive day ahead.";

    el.innerHTML = `
      <section class="enterprise-greeting enterprise-greeting-${greeting.key} ${options.compact ? "is-compact" : ""}" aria-label="Personalized greeting">
        <div class="enterprise-greeting-main">
          <div class="enterprise-greeting-icon" aria-hidden="true">${greeting.icon}</div>
          <div class="enterprise-greeting-copy">
            <h2>${greeting.label}, ${escapeHtml(firstName)}! <span aria-hidden="true">👋</span></h2>
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

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  window.SaaSRAYGreeting = {
    firstNameFromUser,
    greetingForDate,
    isSystemAdministrator,
    render: renderGreeting
  };
})();
