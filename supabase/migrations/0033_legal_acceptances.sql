-- Prova dell'accettazione delle condizioni contrattuali da parte del
-- cliente, registrata lato server nella stessa operazione che crea
-- l'ordine (mai fidandosi di un controllo fatto solo nel browser). Una
-- riga per ogni casella di accettazione spuntata, non una per ordine:
-- così ogni documento/clausola accettata è provata separatamente.
--
-- Registro a sola aggiunta, ancora più della sua tabella gemella
-- legal_documents: qui non esiste NESSUNA via di scrittura lato
-- applicazione se non l'insert fatto dal server con la service role,
-- subito dopo la creazione dell'ordine. Nessuna policy né grant
-- consente update o delete a nessun ruolo applicativo: se queste righe
-- fossero modificabili, non proverebbero più nulla.

create table public.legal_acceptances (
  id uuid primary key default gen_random_uuid(),
  -- restrict, non cascade: un ordine con accettazioni registrate non è
  -- più cancellabile fisicamente (il pulsante admin "Elimina ordine"
  -- fallirà per questi ordini, di proposito — la prova non deve poter
  -- sparire insieme all'ordine che dovrebbe reggere).
  order_id uuid not null references public.orders (id) on delete restrict,
  user_id uuid not null references public.users (id) on delete restrict,
  acceptance_type text not null check (
    acceptance_type in (
      'condizioni_e_privacy',
      'esecuzione_immediata_recesso',
      'clausole_specifiche'
    )
  ),
  legal_document_id uuid not null references public.legal_documents (id) on delete restrict,
  accepted_at timestamptz not null default now(),
  ip_address inet,
  user_agent text,
  -- Evita righe duplicate se un doppio invio del modulo o un riavvio
  -- del webhook Stripe rieseguisse la registrazione per lo stesso
  -- ordine. Include legal_document_id, non solo acceptance_type: il
  -- tipo "condizioni_e_privacy" genera di proposito DUE righe per lo
  -- stesso ordine (una per le CGV, una per la Privacy) — un vincolo
  -- solo su (order_id, acceptance_type) le tratterebbe come duplicate
  -- e romperebbe ogni ordine del consumatore.
  unique (order_id, acceptance_type, legal_document_id)
);

create index idx_legal_acceptances_order_id on public.legal_acceptances (order_id);

alter table public.legal_acceptances enable row level security;

create policy "legal_acceptances_select_own" on public.legal_acceptances
  for select using (auth.uid() = user_id);

create policy "legal_acceptances_select_admin" on public.legal_acceptances
  for select using (public.is_admin());

-- Sola insert, nessun update/delete per nessuno (nemmeno per l'admin):
-- una prova modificabile non prova niente.
create policy "legal_acceptances_insert_admin" on public.legal_acceptances
  for insert with check (public.is_admin());

-- grant di base (RLS non basta senza questi grant). L'inserimento vero
-- avviene sempre lato server con la service role (mai con la sessione
-- del cliente): niente insert per authenticated, sarebbe una concessione
-- morta senza una policy che la usi. service_role senza update/delete:
-- bypassa la RLS, quindi qui la concessione è l'unica barriera rimasta.
grant select on public.legal_acceptances to authenticated;
grant select, insert on public.legal_acceptances to service_role;
