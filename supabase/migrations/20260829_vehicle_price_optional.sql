do $$
begin
  if to_regclass('public.vehicles') is not null then
    alter table public.vehicles
      alter column price drop not null;
  end if;
end $$;
