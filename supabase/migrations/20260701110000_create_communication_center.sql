create table if not exists public.communication_greetings (
  id uuid primary key default gen_random_uuid(),
  period text not null unique,
  title text not null,
  subtitle text not null,
  icon text,
  background_style text,
  enabled boolean not null default true,
  updated_at timestamptz not null default now()
);

create table if not exists public.communication_announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  subtitle text,
  type text not null default 'announcement',
  cta_text text,
  cta_url text,
  priority integer not null default 1,
  enabled boolean not null default true,
  dismissible boolean not null default true,
  audience text not null default 'all',
  start_date timestamptz,
  end_date timestamptz,
  background_style text,
  icon text,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.communication_whats_new (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  subtitle text,
  type text not null default 'whats_new',
  cta_text text,
  cta_url text,
  priority integer not null default 1,
  enabled boolean not null default true,
  dismissible boolean not null default true,
  audience text not null default 'all',
  start_date timestamptz,
  end_date timestamptz,
  background_style text,
  icon text,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.communication_alerts (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  subtitle text,
  type text not null default 'alert',
  cta_text text,
  cta_url text,
  priority integer not null default 100,
  enabled boolean not null default true,
  dismissible boolean not null default false,
  audience text not null default 'all',
  start_date timestamptz,
  end_date timestamptz,
  background_style text,
  icon text,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.notification_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  type text not null default 'notification',
  title text not null,
  subtitle text,
  icon text,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,
  type text not null default 'notification',
  title text not null,
  subtitle text,
  icon text,
  related_object text,
  related_record_id text,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.communication_history (
  id uuid primary key default gen_random_uuid(),
  communication_type text not null,
  communication_id uuid,
  user_id uuid,
  action text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.notification_preferences (
  id uuid primary key default gen_random_uuid(),
  user_id uuid unique,
  email_enabled boolean not null default true,
  in_app_enabled boolean not null default true,
  updated_at timestamptz not null default now()
);

create index if not exists idx_communication_announcements_active
  on public.communication_announcements (enabled, priority desc, start_date, end_date);
create index if not exists idx_communication_whats_new_active
  on public.communication_whats_new (enabled, priority desc, start_date, end_date);
create index if not exists idx_communication_alerts_active
  on public.communication_alerts (enabled, priority desc, start_date, end_date);
create index if not exists idx_notifications_user_created
  on public.notifications (user_id, created_at desc);

create or replace function public.set_communication_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_communication_greetings_updated_at on public.communication_greetings;
create trigger trg_communication_greetings_updated_at
before update on public.communication_greetings
for each row execute function public.set_communication_updated_at();

drop trigger if exists trg_communication_announcements_updated_at on public.communication_announcements;
create trigger trg_communication_announcements_updated_at
before update on public.communication_announcements
for each row execute function public.set_communication_updated_at();

drop trigger if exists trg_communication_whats_new_updated_at on public.communication_whats_new;
create trigger trg_communication_whats_new_updated_at
before update on public.communication_whats_new
for each row execute function public.set_communication_updated_at();

drop trigger if exists trg_communication_alerts_updated_at on public.communication_alerts;
create trigger trg_communication_alerts_updated_at
before update on public.communication_alerts
for each row execute function public.set_communication_updated_at();

drop trigger if exists trg_notification_templates_updated_at on public.notification_templates;
create trigger trg_notification_templates_updated_at
before update on public.notification_templates
for each row execute function public.set_communication_updated_at();

drop trigger if exists trg_notifications_updated_at on public.notifications;
create trigger trg_notifications_updated_at
before update on public.notifications
for each row execute function public.set_communication_updated_at();

drop trigger if exists trg_notification_preferences_updated_at on public.notification_preferences;
create trigger trg_notification_preferences_updated_at
before update on public.notification_preferences
for each row execute function public.set_communication_updated_at();

insert into public.communication_greetings (period, title, subtitle, icon, enabled)
values
  ('Morning', 'Good Morning', 'Welcome back! Have a productive day.', 'morning', true),
  ('Afternoon', 'Good Afternoon', 'Keep the momentum going.', 'afternoon', true),
  ('Evening', 'Good Evening', 'Great work today. Finish strong.', 'evening', true),
  ('Night', 'Good Night', 'You''re working late. Don''t forget to rest.', 'night', true)
on conflict (period) do update set
  title = excluded.title,
  subtitle = excluded.subtitle,
  icon = excluded.icon,
  enabled = true;
