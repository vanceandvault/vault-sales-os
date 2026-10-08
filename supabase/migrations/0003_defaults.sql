-- First-login defaults: settings row and the starter offer (all editable in the app).
create or replace function public.seed_defaults() returns void language plpgsql as $$
begin
  insert into public.settings(user_id) values (auth.uid()) on conflict do nothing;
  if not exists (select 1 from public.offers) then
    insert into public.offers(name, kind, price_chf) values
      ('Social Media Starter', 'one_time', 1490), ('Social Media Retainer', 'recurring', 0), ('Branding-Projekt', 'custom', 0), ('Website-Projekt', 'custom', 0);
  end if;
end $$;
