alter table if exists public.vehicles
  add column if not exists minimum_down_payment numeric null;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'vehicles'
      and column_name = 'min_down_payment'
  ) then
    update public.vehicles
    set minimum_down_payment = min_down_payment
    where minimum_down_payment is null
      and min_down_payment is not null;
  end if;
end $$;

do $$
begin
  if to_regclass('public.vehicles') is not null
    and not exists (
    select 1
    from pg_constraint
    where conname = 'vehicles_minimum_down_payment_non_negative'
      and conrelid = 'public.vehicles'::regclass
  ) then
    alter table public.vehicles
      add constraint vehicles_minimum_down_payment_non_negative
      check (minimum_down_payment is null or minimum_down_payment >= 0);
  end if;
end $$;
