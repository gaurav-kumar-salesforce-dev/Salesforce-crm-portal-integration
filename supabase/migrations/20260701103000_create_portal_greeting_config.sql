create table if not exists public.portal_greeting_config (
  id uuid primary key default gen_random_uuid(),
  period text not null unique,
  title text not null,
  subtitle text not null,
  icon text,
  background_style text,
  enabled boolean not null default true,
  updated_at timestamptz not null default now()
);

create or replace function public.set_portal_greeting_config_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_portal_greeting_config_updated_at on public.portal_greeting_config;
create trigger trg_portal_greeting_config_updated_at
before update on public.portal_greeting_config
for each row execute function public.set_portal_greeting_config_updated_at();

insert into public.portal_greeting_config (period, title, subtitle, icon, enabled)
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

delete from public.portal_announcements
where enabled = false
  and type = 'general'
  and icon in ('sun', 'day', 'morning', 'afternoon', 'evening', 'night')
  and title in ('Good Morning', 'Good Afternoon', 'Good Evening', 'Good Night');
