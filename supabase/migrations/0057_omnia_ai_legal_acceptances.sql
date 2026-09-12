-- Tappa 4 — prova dell'accettazione delle condizioni di abbonamento OMNIA
-- AI, stesso schema di legal_acceptances (0033) ma per gli abbonamenti:
-- order_id non è riusabile (un abbonamento non è un ordine e-commerce),
-- quindi subscription_id al suo posto. Solo due tipi di accettazione
-- (niente "esecuzione_immediata_recesso": OMNIA AI serve chi partecipa a
-- gare d'appalto, è sempre un'azienda, mai un consumatore privato).
--
-- Registro a sola aggiunta come il suo gemello: nessuna policy né grant
-- consente update o delete a nessun ruolo applicativo.

create table public.omnia_ai_legal_acceptances (
  id uuid primary key default gen_random_uuid(),
  -- restrict, non cascade: un abbonamento con accettazioni registrate non
  -- è più cancellabile fisicamente, stessa ragione di legal_acceptances.
  subscription_id uuid not null references public.subscriptions (id) on delete restrict,
  user_id uuid not null references public.users (id) on delete restrict,
  acceptance_type text not null check (
    acceptance_type in ('condizioni_e_privacy', 'clausole_specifiche')
  ),
  legal_document_id uuid not null references public.legal_documents (id) on delete restrict,
  accepted_at timestamptz not null default now(),
  ip_address inet,
  user_agent text,
  -- "condizioni_e_privacy" genera DUE righe per lo stesso abbonamento
  -- (condizioni di abbonamento + privacy policy): il vincolo include
  -- legal_document_id, non solo acceptance_type, per non trattarle come
  -- duplicate.
  unique (subscription_id, acceptance_type, legal_document_id)
);

create index idx_omnia_ai_legal_acceptances_subscription_id
  on public.omnia_ai_legal_acceptances (subscription_id);

alter table public.omnia_ai_legal_acceptances enable row level security;

create policy "omnia_ai_legal_acceptances_select_own" on public.omnia_ai_legal_acceptances
  for select using (auth.uid() = user_id);

create policy "omnia_ai_legal_acceptances_select_admin" on public.omnia_ai_legal_acceptances
  for select using (public.is_admin());

create policy "omnia_ai_legal_acceptances_insert_admin" on public.omnia_ai_legal_acceptances
  for insert with check (public.is_admin());

grant select on public.omnia_ai_legal_acceptances to authenticated;
grant select, insert on public.omnia_ai_legal_acceptances to service_role;
