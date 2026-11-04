-- Richieste di demo di OMNIA AI (omnia-ai.it/demo) e prenotazioni confermate su Google Calendar.
--
-- TRE identificativi distinti (non si confondono mai):
--   demo_contatti.id      la PERSONA (un indirizzo email normalizzato = un contatto);
--   demo_leads.id         la RICHIESTA: ogni invio del modulo è una riga nuova, mai sovrascritta (storico); è anche la base
--                         dell'identificativo di transazione della conversione («omnia-demo-<id richiesta>»): una conversione per richiesta;
--   demo_prenotazioni.id  la PRENOTAZIONE: un evento del calendario (calendar_id + calendar_event_id, unico).
-- Una persona può fare più richieste; una richiesta può avere più prenotazioni (annullata e rifatta, spostata), ma conta UNA conversione.
--
-- Flusso: il visitatore compila il modulo → il server salva richiesta e consensi → si apre il calendario Google → la sincronizzazione
-- periodica trova la prenotazione, la abbina alla richiesta per email e la porta a «confirmed». Solo allora (e solo con consenso
-- verificabile) si può mandare la conversione a GA4 e a Google Ads. Un abbinamento incerto NON produce conversioni: finisce in
-- demo_calendar_casi per la verifica a mano.
--
-- Consensi: demo_consensi è un REGISTRO che si aggiunge soltanto (un UPDATE è vietato da un trigger): per ogni richiesta e per ogni tipo
-- di consenso (informativa privacy, misurazione pubblicitaria, cookie pubblicitari) la riga dice cosa è stato scelto, quando, con quale
-- VERSIONE del testo mostrato (e il suo SHA-256), con quale versione dell'informativa privacy, e una firma HMAC calcolata dal server
-- (tamper-evident). Il consenso valido è l'ULTIMA riga per richiesta e tipo: una revoca è una nuova riga «denied».
--
-- Sicurezza: RLS attiva su tutte le tabelle e NESSUNA policy, GRANT solo a service_role. Il browser non legge e non scrive mai: scrive
-- soltanto il server (azione del modulo e sincronizzazione), con la chiave riservata. Niente IP in chiaro (solo un hash con segreto).
--
-- Conservazione (la applica il cron «omnia-ai-demo-purge», vedi src/lib/demo-conservazione-calcoli.ts):
--   richieste «pending»/«superseded» mai prenotate: 90 giorni; richieste confermate o cancellate: 24 mesi; casi da verificare: 12 mesi
--   (risolti: 6 mesi); un contatto senza più richieste si cancella. Prenotazioni e consensi seguono la richiesta (ON DELETE CASCADE).
-- Cancellazione su richiesta dell'interessato: select public.demo_cancella_dati_email('email normalizzata in minuscolo').
--
-- Additiva e idempotente: si può rieseguire. Prima di eseguirla il modulo /demo funziona lo stesso (finché DEMO_LEADS_ATTIVO non è «1»:
-- la richiesta arriva per email all'ufficio e il calendario si apre comunque).

-- ═════════════════════════ Contatti (la persona) ═════════════════════════
create table if not exists public.demo_contatti (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  email_norm text not null check (char_length(email_norm) between 5 and 254),
  email text not null check (char_length(email) between 5 and 254),
  full_name text not null check (char_length(full_name) between 2 and 120),
  company text not null check (char_length(company) between 1 and 160),
  phone text check (phone is null or char_length(phone) between 6 and 30),
  sector text not null check (char_length(sector) between 1 and 80),
  ultima_richiesta_il timestamptz not null default now(),
  constraint demo_contatti_email_uni unique (email_norm)
);

-- ═════════════════════════ Richieste (ogni invio del modulo) ═════════════════════════
create table if not exists public.demo_leads (
  id uuid primary key default gen_random_uuid(),
  contatto_id uuid not null references public.demo_contatti (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- chiave di idempotenza scelta dal modulo: un secondo invio con la stessa chiave (doppio clic, nuovo tentativo dopo un errore)
  -- restituisce la richiesta già registrata invece di crearne un'altra
  idempotency_key text not null check (char_length(idempotency_key) between 16 and 80),

  -- cosa ha scritto la persona IN QUESTO invio (storico: il contatto tiene solo gli ultimi dati)
  full_name text not null check (char_length(full_name) between 2 and 120),
  company text not null check (char_length(company) between 1 and 160),
  email text not null check (char_length(email) between 5 and 254),
  email_norm text not null check (char_length(email_norm) between 5 and 254),
  phone text check (phone is null or char_length(phone) between 6 and 30),
  sector text not null check (char_length(sector) between 1 and 80),

  -- attribuzione pubblicitaria: presente SOLO se il visitatore ha accettato i cookie pubblicitari
  gclid text check (gclid is null or char_length(gclid) <= 200),
  gbraid text check (gbraid is null or char_length(gbraid) <= 200),
  wbraid text check (wbraid is null or char_length(wbraid) <= 200),
  utm_source text check (utm_source is null or char_length(utm_source) <= 200),
  utm_medium text check (utm_medium is null or char_length(utm_medium) <= 200),
  utm_campaign text check (utm_campaign is null or char_length(utm_campaign) <= 200),
  utm_content text check (utm_content is null or char_length(utm_content) <= 200),
  utm_term text check (utm_term is null or char_length(utm_term) <= 200),
  landing_path text check (landing_path is null or char_length(landing_path) <= 200),
  ga_client_id text check (ga_client_id is null or char_length(ga_client_id) <= 64),
  ga_session_id text check (ga_session_id is null or char_length(ga_session_id) <= 32),
  attribution_consent boolean not null default false,

  -- riassunto dei consensi (la prova è in demo_consensi)
  privacy_version text not null,
  privacy_accepted_at timestamptz not null,
  ads_measurement_consent boolean not null default false,
  ads_measurement_consent_at timestamptz,

  -- anti-abuso: hash (con segreto) dell'indirizzo IP, mai l'indirizzo
  ip_hash text check (ip_hash is null or char_length(ip_hash) <= 64),

  -- stato della richiesta: pending (nessuna prenotazione) → confirmed (c'è una prenotazione valida) → cancelled (tutte annullate);
  -- superseded = la stessa persona ha fatto una richiesta più recente nella stessa giornata e la prenotazione è andata a quella
  booking_status text not null default 'pending' check (booking_status in ('pending', 'confirmed', 'cancelled', 'superseded')),
  superseded_by uuid references public.demo_leads (id) on delete set null,
  -- quando è stata fatta la PRIMA prenotazione confermata (si scrive una volta sola): è l'ora della conversione
  prima_prenotazione_il timestamptz,

  -- GA4 lato server (Measurement Protocol): una volta sola per richiesta; dopo 5 tentativi falliti non si riprova più
  ga4_sent_at timestamptz,
  ga4_attempts integer not null default 0,

  -- Google Ads (Data Manager API): una conversione per richiesta, solo se la prenotazione è confermata
  ads_import_status text not null default 'not_ready' check (
    ads_import_status in ('not_ready', 'ready', 'validated', 'sent', 'accepted', 'failed', 'skipped_no_consent', 'skipped_no_identifier', 'skipped_cancelled')
  ),
  ads_transaction_id text check (ads_transaction_id is null or char_length(ads_transaction_id) <= 64),
  ads_request_id text check (ads_request_id is null or char_length(ads_request_id) <= 200),
  ads_sent_at timestamptz,
  ads_attempts integer not null default 0,
  ads_next_attempt_at timestamptz,
  ads_last_error text check (ads_last_error is null or char_length(ads_last_error) <= 300),

  constraint demo_leads_idempotenza_uni unique (idempotency_key),
  constraint demo_leads_confermata_ha_data check (booking_status <> 'confirmed' or prima_prenotazione_il is not null)
);

create index if not exists demo_leads_contatto_idx on public.demo_leads (contatto_id, created_at desc);
create index if not exists demo_leads_email_idx on public.demo_leads (email_norm, created_at desc);
create index if not exists demo_leads_ip_idx on public.demo_leads (ip_hash, created_at) where ip_hash is not null;
create index if not exists demo_leads_ads_idx on public.demo_leads (ads_import_status, ads_next_attempt_at)
  where ads_import_status in ('ready', 'sent', 'failed', 'validated');

-- ═════════════════════════ Prenotazioni (un evento del calendario) ═════════════════════════
create table if not exists public.demo_prenotazioni (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.demo_leads (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  calendar_id text not null check (char_length(calendar_id) <= 320),
  calendar_event_id text not null check (char_length(calendar_event_id) <= 1024),
  stato text not null default 'confirmed' check (stato in ('confirmed', 'cancelled')),
  booked_at timestamptz not null,
  starts_at timestamptz,
  starts_at_originale timestamptz,
  riprogrammata_il timestamptz,
  cancelled_at timestamptz,
  match_note text check (match_note is null or char_length(match_note) <= 300),
  -- un evento del calendario è UNA prenotazione
  constraint demo_prenotazioni_evento_uni unique (calendar_id, calendar_event_id)
);

create index if not exists demo_prenotazioni_lead_idx on public.demo_prenotazioni (lead_id);

-- ═════════════════════════ Consensi (registro che si aggiunge soltanto) ═════════════════════════
create table if not exists public.demo_consensi (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.demo_leads (id) on delete cascade,
  registrato_il timestamptz not null default now(),
  tipo text not null check (tipo in ('informativa_privacy', 'misurazione_pubblicitaria', 'cookie_pubblicitari')),
  valore text not null check (valore in ('granted', 'denied')),
  -- quale testo è stato mostrato: versione e impronta SHA-256 del testo esatto; quale informativa privacy era in vigore
  versione_testo text not null check (char_length(versione_testo) between 1 and 80),
  testo_sha256 text not null check (testo_sha256 ~ '^[0-9a-f]{64}$'),
  informativa_versione text not null check (char_length(informativa_versione) between 1 and 20),
  fonte text not null check (fonte in ('modulo_demo', 'banner_cookie_dichiarato', 'revoca')),
  -- vero se il dato lo dichiara il browser (il server non può verificare il banner dei cookie)
  dichiarato_dal_browser boolean not null default false,
  ip_hash text check (ip_hash is null or char_length(ip_hash) <= 64),
  -- HMAC-SHA256 calcolato dal server su (richiesta, tipo, valore, versione, impronta, data): se cambia un campo, la firma non torna
  firma text check (firma is null or firma ~ '^[0-9a-f]{64}$')
);

create index if not exists demo_consensi_lead_idx on public.demo_consensi (lead_id, tipo, registrato_il desc);

create or replace function public.demo_consensi_non_modificabili()
returns trigger
language plpgsql
as $$
begin
  raise exception 'demo_consensi si aggiunge soltanto: per revocare un consenso si inserisce una nuova riga';
end
$$;

drop trigger if exists demo_consensi_senza_update on public.demo_consensi;
create trigger demo_consensi_senza_update
  before update on public.demo_consensi
  for each row execute function public.demo_consensi_non_modificabili();

-- ═════════════════════════ Casi da verificare e stato della sincronizzazione ═════════════════════════
create table if not exists public.demo_calendar_casi (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  calendar_id text not null check (char_length(calendar_id) <= 320),
  calendar_event_id text not null check (char_length(calendar_event_id) <= 1024),
  motivo text not null check (
    motivo in ('nessun_lead', 'piu_lead', 'prenotazione_duplicata', 'fuori_finestra', 'senza_partecipante', 'email_non_valida')
  ),
  attendee_email_norm text check (attendee_email_norm is null or char_length(attendee_email_norm) <= 254),
  event_created_at timestamptz,
  event_starts_at timestamptz,
  risolto boolean not null default false,
  note text check (note is null or char_length(note) <= 300),
  constraint demo_calendar_casi_evento_uni unique (calendar_event_id)
);

create index if not exists demo_calendar_casi_aperti_idx on public.demo_calendar_casi (created_at) where risolto = false;

-- Stato della sincronizzazione (una sola riga): il «syncToken» di Google per leggere solo le novità, e un blocco (lock_until) perché due
-- esecuzioni del cron non girino insieme (Vercel può consegnare due volte la stessa chiamata).
create table if not exists public.demo_sync_stato (
  id smallint primary key default 1 check (id = 1),
  sync_token text check (sync_token is null or char_length(sync_token) <= 2048),
  last_run_at timestamptz,
  last_success_at timestamptz,
  last_error text check (last_error is null or char_length(last_error) <= 300),
  lock_until timestamptz
);

alter table public.demo_sync_stato add column if not exists lock_until timestamptz;

insert into public.demo_sync_stato (id) values (1) on conflict (id) do nothing;

-- ═════════════════════════ Accesso: solo il server ═════════════════════════
alter table public.demo_contatti enable row level security;
alter table public.demo_leads enable row level security;
alter table public.demo_prenotazioni enable row level security;
alter table public.demo_consensi enable row level security;
alter table public.demo_calendar_casi enable row level security;
alter table public.demo_sync_stato enable row level security;

revoke all on public.demo_contatti from anon, authenticated;
revoke all on public.demo_leads from anon, authenticated;
revoke all on public.demo_prenotazioni from anon, authenticated;
revoke all on public.demo_consensi from anon, authenticated;
revoke all on public.demo_calendar_casi from anon, authenticated;
revoke all on public.demo_sync_stato from anon, authenticated;

grant select, insert, update, delete on public.demo_contatti to service_role;
grant select, insert, update, delete on public.demo_leads to service_role;
grant select, insert, update, delete on public.demo_prenotazioni to service_role;
grant select, insert, update, delete on public.demo_consensi to service_role;
grant select, insert, update, delete on public.demo_calendar_casi to service_role;
grant select, insert, update, delete on public.demo_sync_stato to service_role;

-- Cancellazione su richiesta dell'interessato (diritto all'oblio): toglie contatto, richieste (e con esse prenotazioni e consensi) e casi
-- legati a quell'email. Da eseguire a mano (editor SQL) o dal server con la chiave riservata; non dal browser.
create or replace function public.demo_cancella_dati_email(p_email_norm text)
returns integer
language sql
security definer
set search_path = public
as $$
  with c as (delete from public.demo_contatti where email_norm = lower(trim(p_email_norm)) returning 1),
       k as (delete from public.demo_calendar_casi where attendee_email_norm = lower(trim(p_email_norm)) returning 1)
  select (select count(*) from c)::integer + (select count(*) from k)::integer;
$$;

revoke all on function public.demo_cancella_dati_email(text) from public, anon, authenticated;
grant execute on function public.demo_cancella_dati_email(text) to service_role;

notify pgrst, 'reload schema';
