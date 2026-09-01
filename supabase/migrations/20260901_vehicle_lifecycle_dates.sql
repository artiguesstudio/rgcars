-- Vehicle lifecycle dates required by the admin stock workflow.
-- Safe to run independently from the larger measurement/CRM migration.

alter table if exists public.vehicles
  add column if not exists published_at timestamptz,
  add column if not exists sold_at timestamptz;

update public.vehicles
set published_at = coalesce(published_at, created_at, now())
where published_at is null
  and status <> 'hidden';

update public.vehicles
set sold_at = coalesce(sold_at, updated_at, created_at, now())
where sold_at is null
  and status = 'sold';

comment on column public.vehicles.published_at is
  'First date when the vehicle was made visible in the public catalog.';

comment on column public.vehicles.sold_at is
  'Date when the vehicle was marked as sold.';
