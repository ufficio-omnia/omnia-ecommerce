-- Piano di lavoro nell'abbonamento OMNIA AI e concessioni gratuite dalla console.
--
-- 1) ABBONAMENTO CON PIANO DI LAVORO. L'abbonamento può includere il piano di lavoro (starter +150 €, professional +350 €, enterprise
--    +900 € al mese: i prezzi si decidono dalla console). Su Stripe è UN SOLO prezzo per piano (importo = listino + surplus, chiave
--    «omnia_ai_<piano>_pdl»), quindi la riga dell'abbonamento resta una sola. Qui si ricorda se l'abbonamento lo include:
--      - piano_lavoro: l'abbonamento include il piano di lavoro (lo imposta SOLO il webhook, dal prezzo Stripe);
--      - piano_lavoro_programmato: l'offerta del cambio programmato (downgrade al prossimo rinnovo) include il piano di lavoro;
--      - piano_lavoro_condizioni_versione / _hash: versione e impronta delle avvertenze sul piano di lavoro che il cliente ha
--        accettato comprando l'abbonamento con l'opzione (la prova di accettazione completa — data, indirizzo IP, browser — è nelle
--        accettazioni legali dell'abbonamento).
--    Il piano di lavoro dell'abbonamento copre SOLO le gare incluse nel piano (quelle che consumano una gara del piano): per le altre
--    (crediti, gare gratuite) si compra il piano di lavoro della singola gara.
--
-- 2) CONCESSIONI. La console può concedere gratis il piano di lavoro a un cliente: per TUTTE le sue gare (con una scadenza e/o un numero
--    massimo di gare, entrambi facoltativi) oppure per UNA gara. Si revoca, non si cancella: resta la storia di cosa è stato concesso e
--    perché. Quando una generazione parte grazie a una concessione, la riga del piano (gara_piani_lavoro) ricorda quale.
--
-- PERMESSI. Le concessioni le legge e le scrive solo il server (chiave di servizio, dalla console): nessun permesso ai ruoli utente.
-- Idempotente; può essere eseguita prima o dopo il deploy (senza le colonne e la tabella il codice nuovo si comporta come prima).

alter table public.subscriptions
  add column if not exists piano_lavoro boolean not null default false,
  add column if not exists piano_lavoro_programmato boolean,
  add column if not exists piano_lavoro_condizioni_versione integer,
  add column if not exists piano_lavoro_condizioni_hash text;

create table if not exists public.omnia_ai_piano_lavoro_concessioni (
  id uuid primary key default gen_random_uuid(),
  -- il titolare che riceve la concessione
  user_id uuid not null references public.users (id) on delete cascade,
  tipo text not null check (tipo in ('tutte', 'gara')),
  -- solo per tipo «gara»: la gara concessa (il titolo si copia, resta leggibile se la gara viene cancellata)
  gara_id uuid references public.gare (id) on delete set null,
  gara_titolo text,
  -- solo per tipo «tutte»: quante gare al massimo (vuoto = senza limite) e fino a quando vale (vuoto = senza scadenza)
  gare_massime integer check (gare_massime is null or gare_massime between 1 and 1000),
  scade_il date,
  motivo text not null check (char_length(btrim(motivo)) between 2 and 300),
  attiva boolean not null default true,
  creata_il timestamptz not null default now(),
  creata_da_email text not null,
  revocata_il timestamptz,
  revocata_da_email text,
  constraint omnia_ai_piano_lavoro_concessioni_forma check (
    (tipo = 'gara' and gare_massime is null and (gara_id is not null or gara_titolo is not null))
    or (tipo = 'tutte' and gara_id is null)
  )
);

create index if not exists omnia_ai_piano_lavoro_concessioni_utente_idx
  on public.omnia_ai_piano_lavoro_concessioni (user_id, attiva);

alter table public.omnia_ai_piano_lavoro_concessioni enable row level security;

-- niente delete: la storia delle concessioni resta
grant select, insert, update on public.omnia_ai_piano_lavoro_concessioni to service_role;

-- Quale concessione ha reso possibile una generazione (vuoto per tutte le altre fonti).
alter table public.gara_piani_lavoro
  add column if not exists concessione_id uuid references public.omnia_ai_piano_lavoro_concessioni (id) on delete set null;

create index if not exists gara_piani_lavoro_concessione_idx
  on public.gara_piani_lavoro (concessione_id)
  where concessione_id is not null;

notify pgrst, 'reload schema';
