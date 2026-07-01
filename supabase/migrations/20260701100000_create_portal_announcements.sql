create table if not exists public.portal_announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  subtitle text,
  type text not null default 'general',
  enabled boolean not null default true,
  priority integer not null default 1,
  start_date timestamptz,
  end_date timestamptz,
  background_style text,
  icon text,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_portal_announcements_active
  on public.portal_announcements (enabled, priority desc, start_date, end_date);

create or replace function public.set_portal_announcements_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_portal_announcements_updated_at on public.portal_announcements;
create trigger trg_portal_announcements_updated_at
before update on public.portal_announcements
for each row execute function public.set_portal_announcements_updated_at();
