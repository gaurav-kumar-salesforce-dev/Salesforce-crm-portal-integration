const COMMUNICATION_TABLES = {
  announcements: 'communication_announcements',
  whatsNew: 'communication_whats_new',
  alerts: 'communication_alerts'
};

const GREETING_PERIODS = ['Morning', 'Afternoon', 'Evening', 'Night'];
const ANNOUNCEMENT_TYPES = new Set(['general', 'announcement', 'maintenance', 'release', 'warning', 'success', 'security', 'holiday']);

function createCommunicationService({ supabase }) {
  const announcementTtlMs = 5 * 60 * 1000;
  const greetingTtlMs = 30 * 60 * 1000;
  let bannerCache = { expiresAt: 0, value: null };
  let greetingCache = { expiresAt: 0, value: null };

  function invalidateBannerCache() {
    bannerCache = { expiresAt: 0, value: null };
  }

  function invalidateGreetingCache() {
    greetingCache = { expiresAt: 0, value: null };
  }

  function tableFor(kind) {
    const table = COMMUNICATION_TABLES[kind];
    if (!table) throw new Error('Invalid communication type');
    return table;
  }

  function normalizeItem(row = {}, fallbackType = 'announcement') {
    if (!row) return null;
    return {
      id: row.id,
      title: row.title || '',
      subtitle: row.subtitle || '',
      type: row.type || fallbackType,
      ctaText: row.cta_text || '',
      ctaUrl: row.cta_url || '',
      enabled: row.enabled !== false,
      dismissible: row.dismissible !== false,
      priority: Number(row.priority || 1),
      audience: row.audience || 'all',
      startDate: row.start_date || null,
      endDate: row.end_date || null,
      backgroundStyle: row.background_style || '',
      icon: row.icon || '',
      createdBy: row.created_by || null,
      createdAt: row.created_at || null,
      updatedAt: row.updated_at || null
    };
  }

  function itemPayload(body = {}, userId = null, fallbackType = 'announcement') {
    const type = ANNOUNCEMENT_TYPES.has(body.type) ? body.type : fallbackType;
    return {
      title: String(body.title || '').trim(),
      subtitle: String(body.subtitle || '').trim(),
      type,
      cta_text: String(body.ctaText || body.cta_text || '').trim() || null,
      cta_url: String(body.ctaUrl || body.cta_url || '').trim() || null,
      enabled: body.enabled !== false,
      dismissible: body.dismissible !== false,
      priority: Number.isFinite(Number(body.priority)) ? Number(body.priority) : 1,
      audience: String(body.audience || 'all').trim() || 'all',
      start_date: body.startDate || body.start_date || null,
      end_date: body.endDate || body.end_date || null,
      background_style: String(body.backgroundStyle || body.background_style || '').trim() || null,
      icon: String(body.icon || '').trim() || null,
      ...(userId ? { created_by: userId } : {})
    };
  }

  function normalizeGreeting(row = {}) {
    if (!row) return null;
    const period = String(row.period || '').trim();
    return {
      id: row.id,
      period,
      key: period.toLowerCase(),
      title: row.title || '',
      subtitle: row.subtitle || '',
      icon: row.icon || period.toLowerCase(),
      backgroundStyle: row.background_style || '',
      enabled: row.enabled !== false,
      updatedAt: row.updated_at || null
    };
  }

  function greetingPayload(body = {}) {
    return {
      title: String(body.title || '').trim(),
      subtitle: String(body.subtitle || '').trim(),
      icon: String(body.icon || '').trim() || null,
      background_style: String(body.backgroundStyle || body.background_style || '').trim() || null,
      enabled: true
    };
  }

  function periodForDate(date = new Date()) {
    const hour = date.getHours();
    if (hour >= 5 && hour <= 11) return 'Morning';
    if (hour >= 12 && hour <= 16) return 'Afternoon';
    if (hour >= 17 && hour <= 20) return 'Evening';
    return 'Night';
  }

  async function activeFromTable(kind) {
    const nowIso = new Date().toISOString();
    const { data, error } = await supabase
      .from(tableFor(kind))
      .select('*')
      .eq('enabled', true)
      .or(`start_date.is.null,start_date.lte.${nowIso}`)
      .or(`end_date.is.null,end_date.gte.${nowIso}`)
      .order('priority', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(1);
    if (error) throw error;
    return normalizeItem((data || [])[0] || null, kind === 'whatsNew' ? 'whats_new' : kind.replace(/s$/, ''));
  }

  async function getGreetingMap() {
    if (greetingCache.expiresAt > Date.now()) return greetingCache.value;
    const { data, error } = await supabase
      .from('communication_greetings')
      .select('*')
      .in('period', GREETING_PERIODS)
      .eq('enabled', true);
    if (error) throw error;
    const value = {};
    (data || []).forEach((row) => {
      const greeting = normalizeGreeting(row);
      if (greeting?.key) {
        value[greeting.key] = {
          title: greeting.title,
          subtitle: greeting.subtitle,
          icon: greeting.icon,
          backgroundStyle: greeting.backgroundStyle
        };
      }
    });
    greetingCache = { expiresAt: Date.now() + greetingTtlMs, value };
    return value;
  }

  async function getGreetings() {
    const { data, error } = await supabase
      .from('communication_greetings')
      .select('*')
      .in('period', GREETING_PERIODS);
    if (error) throw error;
    const order = new Map(GREETING_PERIODS.map((period, index) => [period, index]));
    return (data || [])
      .map(normalizeGreeting)
      .filter(Boolean)
      .sort((a, b) => (order.get(a.period) ?? 99) - (order.get(b.period) ?? 99));
  }

  async function updateGreeting(periodParam, body) {
    const period = GREETING_PERIODS.find((item) => item.toLowerCase() === String(periodParam || '').toLowerCase());
    if (!period) {
      const err = new Error('Invalid greeting period');
      err.status = 400;
      throw err;
    }
    const payload = greetingPayload(body);
    if (!payload.title || !payload.subtitle) {
      const err = new Error('Title and subtitle are required');
      err.status = 400;
      throw err;
    }
    const { data, error } = await supabase
      .from('communication_greetings')
      .update(payload)
      .eq('period', period)
      .select('*')
      .single();
    if (error) throw error;
    invalidateGreetingCache();
    return normalizeGreeting(data);
  }

  async function listItems(kind) {
    const { data, error } = await supabase
      .from(tableFor(kind))
      .select('*')
      .order('priority', { ascending: false })
      .order('updated_at', { ascending: false });
    if (error) throw error;
    return (data || []).map((row) => normalizeItem(row, kind));
  }

  async function createItem(kind, body, userId) {
    const payload = itemPayload(body, userId, kind === 'whatsNew' ? 'whats_new' : kind.replace(/s$/, ''));
    if (!payload.title) {
      const err = new Error('Title is required');
      err.status = 400;
      throw err;
    }
    const { data, error } = await supabase.from(tableFor(kind)).insert(payload).select('*').single();
    if (error) throw error;
    invalidateBannerCache();
    return normalizeItem(data, kind);
  }

  async function updateItem(kind, id, body) {
    const payload = itemPayload(body, null, kind === 'whatsNew' ? 'whats_new' : kind.replace(/s$/, ''));
    delete payload.created_by;
    if (!payload.title) {
      const err = new Error('Title is required');
      err.status = 400;
      throw err;
    }
    const { data, error } = await supabase.from(tableFor(kind)).update(payload).eq('id', id).select('*').single();
    if (error) throw error;
    invalidateBannerCache();
    return normalizeItem(data, kind);
  }

  async function deleteItem(kind, id) {
    const { error } = await supabase.from(tableFor(kind)).delete().eq('id', id);
    if (error) throw error;
    invalidateBannerCache();
  }

  async function resolveBanner() {
    if (bannerCache.expiresAt > Date.now()) return bannerCache.value;
    const [alert, announcement, whatsNew] = await Promise.all([
      activeFromTable('alerts'),
      activeFromTable('announcements'),
      activeFromTable('whatsNew')
    ]);
    const greetingConfig = !alert && !announcement && !whatsNew ? await getGreetingMap() : {};
    const value = {
      banner: alert || announcement || whatsNew || null,
      alert,
      announcement,
      whatsNew,
      greetingPeriod: periodForDate(),
      greetingConfig
    };
    bannerCache = { expiresAt: Date.now() + announcementTtlMs, value };
    return value;
  }

  async function getNotifications(userId = null) {
    let query = supabase
      .from('notifications')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(50);
    if (userId) query = query.or(`user_id.is.null,user_id.eq.${userId}`);
    else query = query.is('user_id', null);
    const { data, error } = await query;
    if (error) throw error;
    return (data || []).map((row) => ({
      id: row.id,
      type: row.type || 'notification',
      title: row.title || '',
      subtitle: row.subtitle || '',
      timestamp: row.created_at || row.updated_at || null,
      unread: row.read_at == null,
      relatedObject: row.related_object || null,
      relatedRecordId: row.related_record_id || null
    }));
  }

  return {
    resolveBanner,
    getGreetingMap,
    getGreetings,
    updateGreeting,
    listItems,
    createItem,
    updateItem,
    deleteItem,
    getNotifications,
    invalidateBannerCache,
    invalidateGreetingCache
  };
}

module.exports = { createCommunicationService };
