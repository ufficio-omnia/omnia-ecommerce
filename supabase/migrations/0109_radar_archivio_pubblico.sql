-- 0109 — Tender Intelligence: archivio PUBBLICO delle gare (fase A, 16/11/2026).
--
-- Dati pubblici, uguali per tutti i clienti: gare (procedure), lotti, provenienza da ciascuna fonte, cambiamenti rilevati (rettifiche,
-- proroghe, annullamenti) e stato delle fonti. Li scrivono solo i job di importazione (server, chiave di servizio); i clienti li vedono
-- solo attraverso le pagine del server, dopo le guardie. Per questo:
--   - RLS attiva e NESSUNA regola per i ruoli utente;
--   - permessi solo alla service role, e revoca esplicita ad anon e authenticated (difesa in più: la sola RLS basterebbe).
-- Nessun dato riservato delle imprese entra in queste tabelle (le gare aggiunte a mano dal cliente stanno in tabelle riservate, fase B).
--
-- ADDITIVA e idempotente: solo tabelle e indici nuovi, nessuna modifica a tabelle esistenti, nessun DROP. Da eseguire prima sullo staging.

-- ───── stato delle fonti ─────
create table if not exists public.radar_fonti_stato (
  fonte text primary key check (fonte ~ '^[a-z0-9_]{2,40}$'),
  attiva boolean not null default false,
  -- cursore dell'adattatore: dove riprendere la lettura (opaco per il database)
  cursore jsonb,
  ultimo_avvio_il timestamptz,
  ultimo_successo_il timestamptz,
  ultimo_errore text check (ultimo_errore is null or char_length(ultimo_errore) <= 1000),
  ultimo_errore_il timestamptz,
  -- blocco contro due importazioni in parallelo della stessa fonte
  blocco_fino_a timestamptz,
  -- data a cui sono aggiornati i dati della fonte (per esempio la data del file mensile ANAC): si mostra al cliente
  dati_aggiornati_al timestamptz,
  conteggi jsonb not null default '{}'::jsonb check (jsonb_typeof(conteggi) = 'object'),
  aggiornata_il timestamptz not null default now()
);

-- ───── procedure ─────
create table if not exists public.radar_procedure (
  id uuid primary key default gen_random_uuid(),
  -- chiave stabile tra versioni e rettifiche dello stesso avviso (per TED «ted:<identificativo della procedura>»)
  chiave text not null unique check (char_length(chiave) between 3 and 200),
  oggetto text not null check (char_length(oggetto) between 1 and 4000),
  descrizione text check (descrizione is null or char_length(descrizione) <= 20000),
  sa_codice_fiscale text check (sa_codice_fiscale is null or char_length(sa_codice_fiscale) <= 40),
  sa_denominazione text check (sa_denominazione is null or char_length(sa_denominazione) <= 500),
  sa_comune text,
  sa_provincia text,
  sa_regione text,
  luogo_istat text,
  codice_nuts text,
  tipo_avviso text,
  tipo_procedura text,
  criterio_aggiudicazione text,
  natura_contratto text check (natura_contratto is null or natura_contratto in ('servizi', 'forniture', 'lavori', 'misto')),
  settori_speciali boolean,
  data_pubblicazione date,
  scadenza_offerte timestamptz,
  -- false = la fonte indica il giorno ma non l'ora: l'ora non si presume (regola già adottata per le gare)
  scadenza_ora_indicata boolean not null default false,
  -- importi tenuti distinti e mai sostituiti tra loro
  valore_stimato numeric(16, 2) check (valore_stimato is null or valore_stimato >= 0),
  valore_base numeric(16, 2) check (valore_base is null or valore_base >= 0),
  oneri_sicurezza numeric(16, 2) check (oneri_sicurezza is null or oneri_sicurezza >= 0),
  durata_mesi integer check (durata_mesi is null or durata_mesi between 0 and 600),
  n_lotti integer check (n_lotti is null or n_lotti >= 0),
  stato text not null default 'aperta' check (stato in ('aperta', 'scaduta', 'annullata', 'aggiudicata', 'sospesa', 'sconosciuto')),
  rettificata boolean not null default false,
  url_avviso text check (url_avviso is null or (char_length(url_avviso) <= 2000 and url_avviso ~ '^https?://')),
  url_documenti text check (url_documenti is null or (char_length(url_documenti) <= 2000 and url_documenti ~ '^https?://')),
  piattaforma_host text,
  cpv_principale text check (cpv_principale is null or cpv_principale ~ '^[0-9]{8}$'),
  cpv_tutti text[] not null default '{}',
  settori text[] not null default '{}',
  metodo_settore text check (metodo_settore is null or metodo_settore in ('cpv', 'parole_chiave')),
  -- sintesi in linguaggio semplice: generata una volta e conservata, con modello e data (fase B)
  sintesi text check (sintesi is null or char_length(sintesi) <= 2000),
  oggetto_breve text check (oggetto_breve is null or char_length(oggetto_breve) <= 160),
  sintesi_modello text,
  sintesi_il timestamptz,
  prima_rilevazione_il timestamptz not null default now(),
  ultima_rilevazione_il timestamptz not null default now(),
  aggiornata_il timestamptz not null default now(),
  -- ricerca testuale in italiano
  ricerca tsvector generated always as (
    to_tsvector('italian', coalesce(oggetto, '') || ' ' || coalesce(oggetto_breve, '') || ' ' || coalesce(sa_denominazione, '') || ' ' || coalesce(descrizione, ''))
  ) stored
);

create index if not exists radar_procedure_scadenza_idx on public.radar_procedure (stato, scadenza_offerte);
create index if not exists radar_procedure_pubblicazione_idx on public.radar_procedure (data_pubblicazione desc, id);
create index if not exists radar_procedure_rilevazione_idx on public.radar_procedure (prima_rilevazione_il desc);
create index if not exists radar_procedure_settori_idx on public.radar_procedure using gin (settori);
create index if not exists radar_procedure_cpv_idx on public.radar_procedure using gin (cpv_tutti);
create index if not exists radar_procedure_ricerca_idx on public.radar_procedure using gin (ricerca);
create index if not exists radar_procedure_ente_idx on public.radar_procedure (sa_codice_fiscale);
create index if not exists radar_procedure_regione_idx on public.radar_procedure (sa_regione, sa_provincia);

-- ───── lotti (in Italia il CIG identifica il lotto) ─────
create table if not exists public.radar_lotti (
  id uuid primary key default gen_random_uuid(),
  procedura_id uuid not null references public.radar_procedure (id) on delete cascade,
  cig text unique check (cig is null or cig ~ '^[0-9A-Z]{10}$'),
  numero_lotto text check (numero_lotto is null or char_length(numero_lotto) <= 50),
  oggetto text check (oggetto is null or char_length(oggetto) <= 4000),
  cpv_principale text check (cpv_principale is null or cpv_principale ~ '^[0-9]{8}$'),
  cpv_tutti text[] not null default '{}',
  settori text[] not null default '{}',
  valore_stimato numeric(16, 2) check (valore_stimato is null or valore_stimato >= 0),
  valore_base numeric(16, 2) check (valore_base is null or valore_base >= 0),
  oneri_sicurezza numeric(16, 2) check (oneri_sicurezza is null or oneri_sicurezza >= 0),
  durata_mesi integer check (durata_mesi is null or durata_mesi between 0 and 600),
  opzioni_rinnovi text check (opzioni_rinnovi is null or char_length(opzioni_rinnovi) <= 2000),
  aggiornato_il timestamptz not null default now()
);

create index if not exists radar_lotti_procedura_idx on public.radar_lotti (procedura_id);

-- ───── provenienza: quale fonte ha fornito quale avviso ─────
create table if not exists public.radar_procedure_fonti (
  id uuid primary key default gen_random_uuid(),
  procedura_id uuid not null references public.radar_procedure (id) on delete cascade,
  fonte text not null check (fonte ~ '^[a-z0-9_]{2,40}$'),
  id_fonte text not null check (char_length(id_fonte) between 1 and 200),
  url text check (url is null or (char_length(url) <= 2000 and url ~ '^https?://')),
  -- impronta del contenuto letto: stessa impronta = nessun cambiamento da registrare
  impronta text,
  rilevato_il timestamptz not null default now(),
  aggiornato_il timestamptz not null default now(),
  unique (fonte, id_fonte)
);

create index if not exists radar_procedure_fonti_procedura_idx on public.radar_procedure_fonti (procedura_id);

-- ───── cambiamenti rilevati (alimentano le notifiche di rettifica e i promemoria) ─────
create table if not exists public.radar_aggiornamenti (
  id uuid primary key default gen_random_uuid(),
  procedura_id uuid not null references public.radar_procedure (id) on delete cascade,
  tipo text not null check (tipo in ('nuova', 'rettifica', 'proroga', 'annullamento', 'esito', 'correzione_dati')),
  campo text check (campo is null or char_length(campo) <= 60),
  valore_precedente text check (valore_precedente is null or char_length(valore_precedente) <= 2000),
  valore_nuovo text check (valore_nuovo is null or char_length(valore_nuovo) <= 2000),
  fonte text not null check (fonte ~ '^[a-z0-9_]{2,40}$'),
  rilevato_il timestamptz not null default now()
);

create index if not exists radar_aggiornamenti_procedura_idx on public.radar_aggiornamenti (procedura_id, rilevato_il desc);
create index if not exists radar_aggiornamenti_rilevato_idx on public.radar_aggiornamenti (rilevato_il);

-- ───── permessi: solo il server ─────
alter table public.radar_fonti_stato enable row level security;
alter table public.radar_procedure enable row level security;
alter table public.radar_lotti enable row level security;
alter table public.radar_procedure_fonti enable row level security;
alter table public.radar_aggiornamenti enable row level security;

revoke all on public.radar_fonti_stato from anon, authenticated;
revoke all on public.radar_procedure from anon, authenticated;
revoke all on public.radar_lotti from anon, authenticated;
revoke all on public.radar_procedure_fonti from anon, authenticated;
revoke all on public.radar_aggiornamenti from anon, authenticated;

grant select, insert, update, delete on public.radar_fonti_stato to service_role;
grant select, insert, update, delete on public.radar_procedure to service_role;
grant select, insert, update, delete on public.radar_lotti to service_role;
grant select, insert, update, delete on public.radar_procedure_fonti to service_role;
grant select, insert, update, delete on public.radar_aggiornamenti to service_role;

notify pgrst, 'reload schema';
