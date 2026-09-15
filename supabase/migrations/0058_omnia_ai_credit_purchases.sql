-- Tappa 5 — crediti aggiuntivi OMNIA AI: acquisto una tantum (non
-- abbonamento) di gare extra, riservato a chi ha già un abbonamento
-- attivo (i crediti si estinguono con la cessazione dell'abbonamento).
--
-- omnia_ai_credit_purchases è il registro delle ricariche: oltre a
-- salvare la data di acquisto (richiesta per la tappa 6), la sua colonna
-- stripe_session_id unique è la garanzia di idempotenza contro un evento
-- Stripe recapitato più volte — stesso meccanismo già usato per
-- orders.stripe_session_id nel webhook e-commerce. Registro a sola
-- aggiunta, come gara_consumi/omnia_ai_legal_acceptances: nessuna
-- policy né grant consente update o delete.
create table public.omnia_ai_credit_purchases (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  pacchetto text not null check (pacchetto in ('singola', 'pacchetto5')),
  crediti integer not null,
  importo_centesimi integer not null,
  stripe_session_id text not null unique,
  created_at timestamptz not null default now()
);

create index idx_omnia_ai_credit_purchases_user_id
  on public.omnia_ai_credit_purchases (user_id);

alter table public.omnia_ai_credit_purchases enable row level security;

create policy "omnia_ai_credit_purchases_select_own" on public.omnia_ai_credit_purchases
  for select using (auth.uid() = user_id);

create policy "omnia_ai_credit_purchases_select_admin" on public.omnia_ai_credit_purchases
  for select using (public.is_admin());

grant select on public.omnia_ai_credit_purchases to authenticated;
grant select, insert on public.omnia_ai_credit_purchases to service_role;

-- Incremento atomico del saldo: una singola istruzione (insert ... on
-- conflict) invece di leggere credits.balance e poi scriverlo, per non
-- perdere un incremento se due ricariche dello stesso cliente vengono
-- elaborate in parallelo (due acquisti ravvicinati, due consegne webhook
-- quasi simultanee) — un problema diverso e più subdolo del semplice
-- doppio invio dello stesso evento, già coperto sopra dal vincolo unique
-- su stripe_session_id. security invoker (il default): service_role ha
-- già grant diretti su credits (0007_service_role_grants.sql) e bypassa
-- comunque la RLS, non serve elevare i privilegi della funzione.
create or replace function public.increment_credits(p_user_id uuid, p_amount integer)
returns void
language sql
set search_path = public
as $$
  insert into public.credits (user_id, balance)
  values (p_user_id, p_amount)
  on conflict (user_id) do update
    set balance = public.credits.balance + excluded.balance, updated_at = now();
$$;

grant execute on function public.increment_credits(uuid, integer) to service_role;
