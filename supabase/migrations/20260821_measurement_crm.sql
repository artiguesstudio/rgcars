-- RG Cars TDF: attribution, commercial lifecycle and first-party measurement.
-- Apply before deploying the matching Edge Functions. This migration never stores
-- Meta/Google secrets and does not grant anonymous access to CRM data.

create extension if not exists pgcrypto;

create or replace function public.is_rg_admin()
returns boolean
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  allowed boolean := false;
begin
  if coalesce(auth.role(), '') = 'service_role' then
    return true;
  end if;
  if to_regclass('public.admin_access_profiles') is null then
    return false;
  end if;
  execute $query$
    select exists (
      select 1
      from public.admin_access_profiles
      where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
        and is_active = true
    )
  $query$ into allowed;
  return coalesce(allowed, false);
end;
$$;

revoke all on function public.is_rg_admin() from public;
grant execute on function public.is_rg_admin() to authenticated, service_role;

create table if not exists public.web_page_views (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  event_id text,
  page_key text not null,
  page_path text not null,
  page_title text,
  referrer text,
  visitor_key text,
  session_key text,
  vehicle_id text,
  attribution jsonb not null default '{}'::jsonb
);

alter table public.web_page_views add column if not exists event_id text;
alter table public.web_page_views add column if not exists attribution jsonb not null default '{}'::jsonb;
alter table public.web_page_views add column if not exists visitor_key text;
alter table public.web_page_views add column if not exists session_key text;
alter table public.web_page_views add column if not exists vehicle_id text;
create unique index if not exists web_page_views_event_id_uidx on public.web_page_views(event_id) where event_id is not null;
create index if not exists web_page_views_session_created_idx on public.web_page_views(session_key, created_at desc);
create index if not exists web_page_views_vehicle_created_idx on public.web_page_views(vehicle_id, created_at desc);

create table if not exists public.web_events (
  id uuid primary key default gen_random_uuid(),
  event_id text not null unique,
  event_name text not null,
  occurred_at timestamptz not null default now(),
  page_key text,
  page_path text,
  visitor_key text,
  session_key text,
  vehicle_id text,
  service_type text,
  campaign_reference text,
  payload jsonb not null default '{}'::jsonb,
  attribution jsonb not null default '{}'::jsonb,
  constraint web_events_name_format check (event_name ~ '^[A-Za-z][A-Za-z0-9_]{0,79}$')
);

create index if not exists web_events_name_occurred_idx on public.web_events(event_name, occurred_at desc);
create index if not exists web_events_vehicle_occurred_idx on public.web_events(vehicle_id, occurred_at desc);
create index if not exists web_events_session_occurred_idx on public.web_events(session_key, occurred_at desc);

create table if not exists public.whatsapp_clicks (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  event_id text not null unique,
  reference_code text not null unique,
  page_key text,
  click_location text,
  service_type text,
  vehicle_id text,
  visitor_key text,
  session_key text,
  attribution jsonb not null default '{}'::jsonb
);

create index if not exists whatsapp_clicks_vehicle_created_idx on public.whatsapp_clicks(vehicle_id, created_at desc);
create index if not exists whatsapp_clicks_reference_idx on public.whatsapp_clicks(reference_code);

create table if not exists public.lead_attribution (
  id uuid primary key default gen_random_uuid(),
  lead_type text not null,
  lead_id text not null,
  submission_key text not null,
  event_id text not null,
  first_touch jsonb not null default '{}'::jsonb,
  last_touch jsonb not null default '{}'::jsonb,
  visitor_key text,
  session_key text,
  landing_url text,
  conversion_url text,
  initial_referrer text,
  vehicle_id text,
  fbp text,
  fbc text,
  ga_client_id text,
  ga_session_id text,
  analytics_consent boolean not null default false,
  marketing_consent boolean not null default false,
  first_visit_at timestamptz,
  converted_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (lead_type, lead_id),
  unique (submission_key),
  unique (event_id)
);

alter table public.lead_attribution add column if not exists fbp text;
alter table public.lead_attribution add column if not exists fbc text;
alter table public.lead_attribution add column if not exists ga_client_id text;
alter table public.lead_attribution add column if not exists ga_session_id text;
alter table public.lead_attribution add column if not exists analytics_consent boolean not null default false;
alter table public.lead_attribution add column if not exists marketing_consent boolean not null default false;

create index if not exists lead_attribution_campaign_idx on public.lead_attribution((first_touch ->> 'utm_campaign'));
create index if not exists lead_attribution_source_idx on public.lead_attribution((first_touch ->> 'utm_source'));
create index if not exists lead_attribution_vehicle_idx on public.lead_attribution(vehicle_id);

create table if not exists public.ad_spend_monthly (
  id uuid primary key default gen_random_uuid(),
  spend_month date not null,
  source text not null,
  campaign text not null default '',
  ad_code text not null default '',
  amount numeric(14,2) not null check (amount >= 0),
  currency text not null default 'ARS',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  unique (spend_month, source, campaign, ad_code, currency)
);

create table if not exists public.conversion_delivery_log (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider in ('meta', 'ga4')),
  event_id text not null,
  event_name text not null,
  lead_type text,
  lead_id text,
  status text not null default 'pending' check (status in ('pending', 'sent', 'retry', 'failed', 'skipped')),
  attempt_count integer not null default 0,
  response_code integer,
  technical_code text,
  last_attempt_at timestamptz,
  next_retry_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, event_id, event_name)
);

-- The log intentionally stores no request body, contact data or hashes.
create index if not exists conversion_delivery_retry_idx on public.conversion_delivery_log(status, next_retry_at);

create table if not exists public.lead_activity_log (
  id uuid primary key default gen_random_uuid(),
  lead_type text not null,
  lead_id text not null,
  action_type text not null default 'updated',
  actor_user_id uuid,
  actor_email text,
  actor_name text,
  message text,
  previous_stage text,
  next_stage text,
  previous_status text,
  next_status text,
  previous_notes text,
  next_notes text,
  previous_assignee_email text,
  next_assignee_email text,
  previous_assignee_name text,
  next_assignee_name text,
  previous_priority text,
  next_priority text,
  previous_next_action text,
  next_next_action text,
  previous_follow_up_at timestamptz,
  next_follow_up_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- Bring a pre-existing activity table up to the version consumed by admin.js.
alter table public.lead_activity_log add column if not exists action_type text not null default 'updated';
alter table public.lead_activity_log add column if not exists actor_user_id uuid;
alter table public.lead_activity_log add column if not exists actor_email text;
alter table public.lead_activity_log add column if not exists actor_name text;
alter table public.lead_activity_log add column if not exists message text;
alter table public.lead_activity_log add column if not exists previous_stage text;
alter table public.lead_activity_log add column if not exists next_stage text;
alter table public.lead_activity_log add column if not exists previous_status text;
alter table public.lead_activity_log add column if not exists next_status text;
alter table public.lead_activity_log add column if not exists previous_notes text;
alter table public.lead_activity_log add column if not exists next_notes text;
alter table public.lead_activity_log add column if not exists previous_assignee_email text;
alter table public.lead_activity_log add column if not exists next_assignee_email text;
alter table public.lead_activity_log add column if not exists previous_assignee_name text;
alter table public.lead_activity_log add column if not exists next_assignee_name text;
alter table public.lead_activity_log add column if not exists previous_priority text;
alter table public.lead_activity_log add column if not exists next_priority text;
alter table public.lead_activity_log add column if not exists previous_next_action text;
alter table public.lead_activity_log add column if not exists next_next_action text;
alter table public.lead_activity_log add column if not exists previous_follow_up_at timestamptz;
alter table public.lead_activity_log add column if not exists next_follow_up_at timestamptz;
alter table public.lead_activity_log add column if not exists metadata jsonb not null default '{}'::jsonb;
alter table public.lead_activity_log add column if not exists created_at timestamptz not null default now();
create index if not exists lead_activity_log_lead_created_idx on public.lead_activity_log(lead_type, lead_id, created_at desc);

do $$
declare
  table_name text;
  lead_tables text[] := array[
    'consignment_leads', 'scouting_requests', 'financing_leads',
    'insurance_leads', 'peritaje_leads', 'feedback_submissions'
  ];
begin
  foreach table_name in array lead_tables loop
    if to_regclass(format('public.%I', table_name)) is null then
      raise notice 'Table public.% does not exist; common CRM columns were not added.', table_name;
      continue;
    end if;

    execute format('alter table public.%I add column if not exists submission_key text', table_name);
    execute format('alter table public.%I add column if not exists lead_event_id text', table_name);
    execute format('alter table public.%I add column if not exists service_type text', table_name);
    execute format('alter table public.%I add column if not exists crm_stage text not null default ''lead''', table_name);
    execute format('alter table public.%I add column if not exists assigned_to_email text', table_name);
    execute format('alter table public.%I add column if not exists assigned_to_name text', table_name);
    execute format('alter table public.%I add column if not exists lead_priority text not null default ''normal''', table_name);
    execute format('alter table public.%I add column if not exists next_action text', table_name);
    execute format('alter table public.%I add column if not exists follow_up_at timestamptz', table_name);
    execute format('alter table public.%I add column if not exists admin_notes text', table_name);
    execute format('alter table public.%I add column if not exists last_touched_at timestamptz', table_name);
    execute format('alter table public.%I add column if not exists first_response_at timestamptz', table_name);
    execute format('alter table public.%I add column if not exists lead_validity text not null default ''pending''', table_name);
    execute format('alter table public.%I add column if not exists qualified_at timestamptz', table_name);
    execute format('alter table public.%I add column if not exists disqualified_at timestamptz', table_name);
    execute format('alter table public.%I add column if not exists visit_scheduled_at timestamptz', table_name);
    execute format('alter table public.%I add column if not exists visit_completed_at timestamptz', table_name);
    execute format('alter table public.%I add column if not exists proposal_at timestamptz', table_name);
    execute format('alter table public.%I add column if not exists closed_at timestamptz', table_name);
    execute format('alter table public.%I add column if not exists loss_reason text', table_name);
    execute format('alter table public.%I add column if not exists commercial_value numeric(14,2)', table_name);
    execute format('alter table public.%I add column if not exists gross_margin numeric(14,2)', table_name);
    execute format('alter table public.%I add column if not exists first_touch jsonb not null default ''{}''::jsonb', table_name);
    execute format('alter table public.%I add column if not exists last_touch jsonb not null default ''{}''::jsonb', table_name);
    execute format('alter table public.%I add column if not exists visitor_key text', table_name);
    execute format('alter table public.%I add column if not exists session_key text', table_name);
    execute format('alter table public.%I add column if not exists landing_url text', table_name);
    execute format('alter table public.%I add column if not exists conversion_url text', table_name);
    execute format('alter table public.%I add column if not exists initial_referrer text', table_name);
    execute format('alter table public.%I add column if not exists first_visit_at timestamptz', table_name);
    execute format('alter table public.%I add column if not exists conversion_at timestamptz', table_name);

    execute format('create unique index if not exists %I on public.%I(submission_key) where submission_key is not null', table_name || '_submission_key_uidx', table_name);
    execute format('create unique index if not exists %I on public.%I(lead_event_id) where lead_event_id is not null', table_name || '_lead_event_id_uidx', table_name);
    execute format('create index if not exists %I on public.%I(crm_stage, created_at desc)', table_name || '_stage_created_idx', table_name);
    execute format('create index if not exists %I on public.%I(follow_up_at) where follow_up_at is not null', table_name || '_follow_up_idx', table_name);
  end loop;
end;
$$;

do $$
begin
  if to_regclass('public.vehicles') is not null then
    alter table public.vehicles add column if not exists published_at timestamptz;
    alter table public.vehicles add column if not exists sold_at timestamptz;
    update public.vehicles set published_at = coalesce(published_at, created_at) where published_at is null;
  end if;
end;
$$;

create or replace function public.log_lead_activity_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if row(
    old.crm_stage, old.status, old.admin_notes, old.assigned_to_email,
    old.lead_priority, old.next_action, old.follow_up_at
  ) is not distinct from row(
    new.crm_stage, new.status, new.admin_notes, new.assigned_to_email,
    new.lead_priority, new.next_action, new.follow_up_at
  ) then
    return new;
  end if;

  insert into public.lead_activity_log (
    lead_type, lead_id, action_type, actor_user_id, actor_email,
    previous_stage, next_stage, previous_status, next_status,
    previous_notes, next_notes, previous_assignee_email, next_assignee_email,
    previous_assignee_name, next_assignee_name, previous_priority, next_priority,
    previous_next_action, next_next_action, previous_follow_up_at, next_follow_up_at
  ) values (
    tg_argv[0], new.id::text, 'updated', auth.uid(), nullif(auth.jwt() ->> 'email', ''),
    old.crm_stage, new.crm_stage, old.status, new.status,
    old.admin_notes, new.admin_notes, old.assigned_to_email, new.assigned_to_email,
    old.assigned_to_name, new.assigned_to_name, old.lead_priority, new.lead_priority,
    old.next_action, new.next_action, old.follow_up_at, new.follow_up_at
  );
  return new;
end;
$$;

do $$
declare
  item record;
begin
  for item in
    select * from (values
      ('consignment_leads', 'consignment'),
      ('scouting_requests', 'scouting'),
      ('financing_leads', 'financing'),
      ('insurance_leads', 'insurance'),
      ('peritaje_leads', 'peritaje'),
      ('feedback_submissions', 'feedback')
    ) as configured(table_name, lead_type)
  loop
    if to_regclass(format('public.%I', item.table_name)) is null then continue; end if;
    execute format('drop trigger if exists rg_log_lead_activity on public.%I', item.table_name);
    execute format(
      'create trigger rg_log_lead_activity after update on public.%I for each row execute function public.log_lead_activity_update(%L)',
      item.table_name,
      item.lead_type
    );
  end loop;
end;
$$;

-- New measurement tables are written only by Edge Functions (service role).
alter table public.web_page_views enable row level security;
alter table public.web_events enable row level security;
alter table public.whatsapp_clicks enable row level security;
alter table public.lead_attribution enable row level security;
alter table public.ad_spend_monthly enable row level security;
alter table public.conversion_delivery_log enable row level security;
alter table public.lead_activity_log enable row level security;

drop policy if exists rg_admin_read_web_page_views on public.web_page_views;
create policy rg_admin_read_web_page_views on public.web_page_views for select to authenticated using (public.is_rg_admin());
drop policy if exists rg_admin_read_web_events on public.web_events;
create policy rg_admin_read_web_events on public.web_events for select to authenticated using (public.is_rg_admin());
drop policy if exists rg_admin_read_whatsapp_clicks on public.whatsapp_clicks;
create policy rg_admin_read_whatsapp_clicks on public.whatsapp_clicks for select to authenticated using (public.is_rg_admin());
drop policy if exists rg_admin_read_lead_attribution on public.lead_attribution;
create policy rg_admin_read_lead_attribution on public.lead_attribution for select to authenticated using (public.is_rg_admin());
drop policy if exists rg_admin_manage_ad_spend on public.ad_spend_monthly;
create policy rg_admin_manage_ad_spend on public.ad_spend_monthly for all to authenticated using (public.is_rg_admin()) with check (public.is_rg_admin());
drop policy if exists rg_admin_read_conversion_log on public.conversion_delivery_log;
create policy rg_admin_read_conversion_log on public.conversion_delivery_log for select to authenticated using (public.is_rg_admin());
drop policy if exists rg_admin_manage_lead_activity on public.lead_activity_log;
create policy rg_admin_manage_lead_activity on public.lead_activity_log for all to authenticated using (public.is_rg_admin()) with check (public.is_rg_admin());

revoke all on public.web_page_views, public.web_events, public.whatsapp_clicks, public.lead_attribution, public.conversion_delivery_log from anon;
grant select on public.web_page_views, public.web_events, public.whatsapp_clicks, public.lead_attribution, public.conversion_delivery_log to authenticated;
grant select, insert, update, delete on public.ad_spend_monthly to authenticated;
grant select, insert on public.lead_activity_log to authenticated;

comment on table public.lead_attribution is 'First/last-touch attribution separated from contact PII.';
comment on table public.conversion_delivery_log is 'Technical delivery state only; never store payloads, hashes, email or phone.';
