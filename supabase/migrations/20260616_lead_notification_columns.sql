alter table if exists public.consignment_leads
  add column if not exists email_sent_to_user boolean default false,
  add column if not exists email_sent_to_team boolean default false,
  add column if not exists email_error text,
  add column if not exists notified_at timestamptz;

alter table if exists public.scouting_requests
  add column if not exists email_sent_to_user boolean default false,
  add column if not exists email_sent_to_team boolean default false,
  add column if not exists email_error text,
  add column if not exists notified_at timestamptz;

alter table if exists public.financing_leads
  add column if not exists email_sent_to_user boolean default false,
  add column if not exists email_sent_to_team boolean default false,
  add column if not exists email_error text,
  add column if not exists notified_at timestamptz;

alter table if exists public.insurance_leads
  add column if not exists email_sent_to_user boolean default false,
  add column if not exists email_sent_to_team boolean default false,
  add column if not exists email_error text,
  add column if not exists notified_at timestamptz;

alter table if exists public.peritaje_leads
  add column if not exists email_sent_to_user boolean default false,
  add column if not exists email_sent_to_team boolean default false,
  add column if not exists email_error text,
  add column if not exists notified_at timestamptz;
