-- 0110 — Tender Intelligence: aggiudicazioni e aggiudicatari PUBBLICI (fase A, 16/11/2026).
--
-- Esiti delle procedure dalle fonti ufficiali (open data ANAC, TED): servono all'intelligence (fase D). Stesse regole di accesso della 0109:
-- solo il server, RLS attiva senza regole per i ruoli utente.
--
-- Regole scritte NEL DATABASE, non solo nel codice:
--   - persone fisiche (ditte individuali) tra gli aggiudicatari: mai nome né codice fiscale, solo «Ditta individuale» (decisione D6, in
--     attesa del parere legale). Il vincolo radar_aggiudicatari_persona_fisica_anonima rifiuta qualunque riga che lo violi;
--   - il ribasso conservato è quello UFFICIALE della fonte (ribasso_ufficiale); un ribasso calcolato non si salva qui: si calcola solo su dati
--     omogenei, con formula e provenienza dichiarate (precisazione P2);
--   - affidamenti diretti e gare restano distinguibili (affidamento_diretto).
--
-- ADDITIVA e idempotente: solo tabelle e indici nuovi, nessun DROP. Da eseguire dopo la 0109 e prima sullo staging.

create table if not exists public.radar_aggiudicazioni (
  id uuid primary key default gen_random_uuid(),
  fonte text not null check (fonte ~ '^[a-z0-9_]{2,40}$'),
  -- identificativo dell'esito nella fonte (ANAC: id_aggiudicazione; TED: numero dell'avviso e lotto)
  id_fonte text not null check (char_length(id_fonte) between 1 and 200),
  cig text check (cig is null or cig ~ '^[0-9A-Z]{10}$'),
  procedura_id uuid references public.radar_procedure (id) on delete set null,
  lotto_id uuid references public.radar_lotti (id) on delete set null,
  sa_codice_fiscale text check (sa_codice_fiscale is null or char_length(sa_codice_fiscale) <= 40),
  sa_denominazione text check (sa_denominazione is null or char_length(sa_denominazione) <= 500),
  oggetto text check (oggetto is null or char_length(oggetto) <= 4000),
  cpv_principale text check (cpv_principale is null or cpv_principale ~ '^[0-9]{8}$'),
  settori text[] not null default '{}',
  tipo_procedura text,
  affidamento_diretto boolean not null default false,
  data_pubblicazione date,
  data_aggiudicazione date,
  esito text check (esito is null or char_length(esito) <= 200),
  criterio_aggiudicazione text check (criterio_aggiudicazione is null or char_length(criterio_aggiudicazione) <= 300),
  -- importi della STESSA procedura e dello STESSO lotto, distinti: base, oneri, aggiudicato
  importo_base numeric(16, 2) check (importo_base is null or importo_base >= 0),
  oneri_sicurezza numeric(16, 2) check (oneri_sicurezza is null or oneri_sicurezza >= 0),
  importo_aggiudicazione numeric(16, 2) check (importo_aggiudicazione is null or importo_aggiudicazione >= 0),
  ribasso_ufficiale numeric(12, 3),
  -- false quando la fonte riporta un ribasso fuori da 0–100 (dato conservato ma non mostrato)
  ribasso_plausibile boolean,
  numero_offerte integer check (numero_offerte is null or numero_offerte >= 0),
  -- predisposizione per la previsione dei contratti in scadenza (fase F): data documentata e data stimata sempre separate
  data_fine_contratto_documentata date,
  data_fine_contratto_stimata date,
  -- data a cui è aggiornato il dato nella fonte (per esempio la data del file mensile ANAC)
  dati_al date,
  aggiornata_il timestamptz not null default now(),
  unique (fonte, id_fonte)
);

create index if not exists radar_aggiudicazioni_cig_idx on public.radar_aggiudicazioni (cig);
create index if not exists radar_aggiudicazioni_ente_idx on public.radar_aggiudicazioni (sa_codice_fiscale, data_aggiudicazione desc);
create index if not exists radar_aggiudicazioni_settori_idx on public.radar_aggiudicazioni using gin (settori);
create index if not exists radar_aggiudicazioni_procedura_idx on public.radar_aggiudicazioni (procedura_id);

create table if not exists public.radar_aggiudicatari (
  id uuid primary key default gen_random_uuid(),
  aggiudicazione_id uuid not null references public.radar_aggiudicazioni (id) on delete cascade,
  ruolo text check (ruolo is null or char_length(ruolo) <= 200),
  tipo_soggetto text check (tipo_soggetto is null or char_length(tipo_soggetto) <= 200),
  persona_fisica boolean not null default false,
  denominazione text check (denominazione is null or char_length(denominazione) <= 500),
  codice_fiscale text check (codice_fiscale is null or char_length(codice_fiscale) <= 40),
  constraint radar_aggiudicatari_persona_fisica_anonima check (not persona_fisica or (codice_fiscale is null and denominazione = 'Ditta individuale'))
);

create index if not exists radar_aggiudicatari_aggiudicazione_idx on public.radar_aggiudicatari (aggiudicazione_id);
create index if not exists radar_aggiudicatari_cf_idx on public.radar_aggiudicatari (codice_fiscale) where codice_fiscale is not null;

alter table public.radar_aggiudicazioni enable row level security;
alter table public.radar_aggiudicatari enable row level security;

revoke all on public.radar_aggiudicazioni from anon, authenticated;
revoke all on public.radar_aggiudicatari from anon, authenticated;

grant select, insert, update, delete on public.radar_aggiudicazioni to service_role;
grant select, insert, update, delete on public.radar_aggiudicatari to service_role;

notify pgrst, 'reload schema';
