-- Prezzi dei piani e sconti di OMNIA AI, modificabili dalla console.
--
-- Finora i prezzi stavano solo nel codice (src/lib/omnia-ai-plans.ts). Il codice resta il
-- valore di partenza (nome, gare incluse, elenco voci); da qui si modificano il PREZZO di
-- listino di ogni piano e si definiscono gli SCONTI. Tutto quello che il cliente vede (sito
-- pubblico, pagina di acquisto, area riservata) legge da queste tabelle; se mancano, vale il codice.
--
-- 1) omnia_ai_prezzi_piani: una riga per piano che ha un prezzo diverso da quello del codice
--    (IVA inclusa, in centesimi, come i prezzi Stripe). Nessuna riga = vale il codice.
--    omnia_ai_prezzi_piani_storico: ogni modifica (chi, quando, da quanto a quanto), solo in aggiunta.
--
-- 2) omnia_ai_sconti: uno sconto su un piano (o su tutti), in percentuale o come prezzo
--    promozionale fisso (solo per un piano preciso), valido dal giorno X al giorno Y, che chi
--    compra in quel periodo mantiene per N mesi (0 = finché resta abbonato) e poi passa al
--    prezzo di listino. Si disattiva, non si cancella: resta la storia di cosa è stato offerto.
--
-- I prezzi cambiano SOLO per i nuovi acquisti: gli abbonamenti già attivi restano sul prezzo
-- che Stripe ha loro associato (il vecchio prezzo Stripe non viene toccato).
--
-- Nessun permesso ai ruoli utente (anon, authenticated): la lettura passa dal server, la scrittura
-- solo dalla console con la chiave di servizio. Idempotente. Può essere eseguita prima o dopo il
-- deploy: senza le tabelle il codice nuovo mostra i prezzi del codice, come prima.

create table if not exists public.omnia_ai_prezzi_piani (
  piano text primary key check (piano in ('starter', 'professional', 'enterprise')),
  prezzo_centesimi integer not null check (prezzo_centesimi between 100 and 10000000),
  aggiornato_il timestamptz not null default now(),
  aggiornato_da_email text not null
);

create table if not exists public.omnia_ai_prezzi_piani_storico (
  id uuid primary key default gen_random_uuid(),
  piano text not null check (piano in ('starter', 'professional', 'enterprise')),
  -- null alla prima modifica: il prezzo precedente era quello del codice
  prezzo_precedente_centesimi integer,
  prezzo_nuovo_centesimi integer not null,
  operatore_email text not null,
  created_at timestamptz not null default now()
);

create index if not exists omnia_ai_prezzi_piani_storico_idx on public.omnia_ai_prezzi_piani_storico (piano, created_at desc);

create table if not exists public.omnia_ai_sconti (
  id uuid primary key default gen_random_uuid(),
  -- nome interno e, nel testo dell'offerta, quello che il cliente può leggere
  nome text not null check (char_length(btrim(nome)) between 2 and 80),
  -- null = tutti i piani
  piano text check (piano is null or piano in ('starter', 'professional', 'enterprise')),
  tipo text not null check (tipo in ('percentuale', 'prezzo')),
  percentuale integer check (percentuale between 1 and 99),
  prezzo_scontato_centesimi integer check (prezzo_scontato_centesimi >= 100),
  valido_dal date not null,
  -- null = senza scadenza (finché non si disattiva)
  valido_al date,
  -- mesi di sconto per chi compra durante la validità; 0 = per sempre
  durata_mesi integer not null default 0 check (durata_mesi between 0 and 60),
  attivo boolean not null default true,
  creato_il timestamptz not null default now(),
  creato_da_email text not null,
  constraint omnia_ai_sconti_valore check (
    (tipo = 'percentuale' and percentuale is not null and prezzo_scontato_centesimi is null)
    or (tipo = 'prezzo' and prezzo_scontato_centesimi is not null and percentuale is null)
  ),
  constraint omnia_ai_sconti_date check (valido_al is null or valido_al >= valido_dal),
  -- un prezzo promozionale fisso ha senso solo per un piano preciso
  constraint omnia_ai_sconti_prezzo_su_piano check (tipo <> 'prezzo' or piano is not null)
);

create index if not exists omnia_ai_sconti_validita_idx on public.omnia_ai_sconti (attivo, valido_dal, valido_al);

alter table public.omnia_ai_prezzi_piani enable row level security;
alter table public.omnia_ai_prezzi_piani_storico enable row level security;
alter table public.omnia_ai_sconti enable row level security;

grant select, insert, update on public.omnia_ai_prezzi_piani to service_role;
grant select, insert on public.omnia_ai_prezzi_piani_storico to service_role;
grant select, insert, update on public.omnia_ai_sconti to service_role;
