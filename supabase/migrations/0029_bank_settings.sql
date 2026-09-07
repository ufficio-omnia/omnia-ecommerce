-- Fase 2A — dati bancari per il bonifico modificabili da admin (prima
-- erano hardcoded come placeholder in src/lib/bank-details.ts)

create table public.bank_settings (
  id smallint primary key default 1,
  iban text not null,
  intestatario text not null,
  updated_at timestamptz not null default now(),
  constraint bank_settings_singleton check (id = 1)
);

insert into public.bank_settings (id, iban, intestatario)
values (1, 'IT60X0542811101000000123456', 'OMNIA Consulting Srl');

alter table public.bank_settings enable row level security;

create policy "bank_settings_select_all" on public.bank_settings
  for select using (true);

create policy "bank_settings_update_admin" on public.bank_settings
  for update using (public.is_admin()) with check (public.is_admin());

-- grant di base (RLS non basta senza questi grant, sia per authenticated
-- che per service_role)
grant select on public.bank_settings to anon;
grant select, update on public.bank_settings to authenticated;
grant select, update on public.bank_settings to service_role;
