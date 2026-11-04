-- Richieste di demo di OMNIA AI (omnia-ai.it/demo) e prenotazioni confermate su Google Calendar.
--
-- Flusso: il visitatore compila il modulo → il server salva un lead «pending» → si apre il calendario Google → la sincronizzazione
-- periodica trova la prenotazione sul calendario, la abbina al lead per email e lo porta a «confirmed» (con id evento e data). Solo
-- allora (e solo con il consenso) si può mandare la conversione a GA4 e a Google Ads. Un abbinamento incerto NON produce conversioni:
-- finisce in demo_calendar_casi per la verifica a mano.
--
-- Sicurezza: RLS attiva su tutte le tabelle e NESSUNA policy, GRANT solo a service_role. Il browser non legge e non scrive mai:
-- scrive soltanto il server (azione del modulo e sincronizzazione), con la chiave riservata. Niente IP in chiaro (solo un hash con
-- segreto), niente testi liberi del visitatore oltre ai campi del modulo.
--
-- Conservazione (la applica il cron «omnia-ai-demo-purge», vedi src/lib/demo-conservazione-calcoli.ts):
--   lead «pending» mai prenotati: 90 giorni; lead confermati o cancellati: 24 mesi; casi da verificare: 12 mesi (risolti: 6 mesi).
-- Cancellazione su richiesta dell'interessato: select public.demo_cancella_dati_email('email normalizzata in minuscolo').
--
-- Additiva e idempotente: si può rieseguire. Prima di eseguirla il modulo /demo funziona lo stesso (il lead non viene salvato, la
-- richiesta arriva per email all'ufficio e il calendario si apre comunque).

create table if not exists public.demo_leads (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- dati del modulo
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

  -- consensi (cosa ha visto e accettato il visitatore, e quando)
  privacy_version text not null,
  privacy_accepted_at timestamptz not null,
  ads_measurement_consent boolean not null default false,
  ads_measurement_consent_at timestamptz,

  -- anti-abuso: hash (con segreto) dell'indirizzo IP, mai l'indirizzo
  ip_hash text check (ip_hash is null or char_length(ip_hash) <= 64),

  -- prenotazione sul calendario
  booking_status text not null default 'pending' check (booking_status in ('pending', 'confirmed', 'cancelled')),
  calendar_event_id text check (calendar_event_id is null or char_length(calendar_event_id) <= 1024),
  calendar_id text check (calendar_id is null or char_length(calendar_id) <= 320),
  booked_at timestamptz,
  booking_starts_at timestamptz,
  booking_match_note text check (booking_match_note is null or char_length(booking_match_note) <= 300),

  -- GA4 lato server (Measurement Protocol): una volta sola; dopo 5 tentativi falliti non si riprova più
  ga4_sent_at timestamptz,
  ga4_attempts integer not null default 0,

  -- Google Ads (Data Manager API): solo prenotazioni confermate
  ads_import_status text not null default 'not_ready' check (
    ads_import_status in ('not_ready', 'ready', 'validated', 'sent', 'accepted', 'failed', 'skipped_no_consent', 'skipped_no_identifier', 'skipped_cancelled')
  ),
  ads_transaction_id text check (ads_transaction_id is null or char_length(ads_transaction_id) <= 64),
  ads_request_id text check (ads_request_id is null or char_length(ads_request_id) <= 200),
  ads_sent_at timestamptz,
  ads_attempts integer not null default 0,
  ads_next_attempt_at timestamptz,
  ads_last_error text check (ads_last_error is null or char_length(ads_last_error) <= 300),

  constraint demo_leads_confirmed_ha_evento check (booking_status <> 'confirmed' or (calendar_event_id is not null and booked_at is not null))
);

-- Un evento del calendario appartiene a UN solo lead.
create unique index if not exists demo_leads_calendar_event_uidx
  on public.demo_leads (calendar_event_id) where calendar_event_id is not null;

-- Deduplicazione: una sola richiesta «pending» per email (un nuovo invio aggiorna quella esistente). Chi ha già prenotato può
-- richiederne una nuova.
create unique index if not exists demo_leads_pending_email_uidx
  on public.demo_leads (email_norm) where booking_status = 'pending';

create index if not exists demo_leads_email_idx on public.demo_leads (email_norm, created_at desc);
create index if not exists demo_leads_ip_idx on public.demo_leads (ip_hash, created_at) where ip_hash is not null;
create index if not exists demo_leads_ads_idx on public.demo_leads (ads_import_status, ads_next_attempt_at)
  where ads_import_status in ('ready', 'sent', 'failed');

create or replace function public.demo_leads_aggiorna_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end
$$;

drop trigger if exists demo_leads_updated_at on public.demo_leads;
create trigger demo_leads_updated_at
  before update on public.demo_leads
  for each row execute function public.demo_leads_aggiorna_updated_at();

-- Prenotazioni del calendario che NON si riescono ad abbinare con certezza a un lead: nessuna conversione parte, le guarda una
-- persona. Un evento compare una sola volta (si aggiorna se la sincronizzazione lo rivede).
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

-- Stato della sincronizzazione con il calendario (una sola riga): il «syncToken» di Google per leggere solo le novità.
create table if not exists public.demo_sync_stato (
  id smallint primary key default 1 check (id = 1),
  sync_token text check (sync_token is null or char_length(sync_token) <= 2048),
  last_run_at timestamptz,
  last_success_at timestamptz,
  last_error text check (last_error is null or char_length(last_error) <= 300),
  eventi_visti_totale bigint not null default 0
);

insert into public.demo_sync_stato (id) values (1) on conflict (id) do nothing;

-- Accesso: nessuno dal browser. RLS attiva senza policy = nessuna riga visibile né scrivibile a anon/authenticated; in più si
-- tolgono i permessi di tabella (Supabase li dà di default) e si danno solo al server (service_role).
alter table public.demo_leads enable row level security;
alter table public.demo_calendar_casi enable row level security;
alter table public.demo_sync_stato enable row level security;

revoke all on public.demo_leads from anon, authenticated;
revoke all on public.demo_calendar_casi from anon, authenticated;
revoke all on public.demo_sync_stato from anon, authenticated;

grant select, insert, update, delete on public.demo_leads to service_role;
grant select, insert, update, delete on public.demo_calendar_casi to service_role;
grant select, insert, update, delete on public.demo_sync_stato to service_role;

-- Cancellazione su richiesta dell'interessato (diritto all'oblio): toglie lead e casi legati a quell'email. Da eseguire a mano
-- (editor SQL) o dal server con la chiave riservata; non dal browser.
create or replace function public.demo_cancella_dati_email(p_email_norm text)
returns integer
language sql
security definer
set search_path = public
as $$
  with l as (delete from public.demo_leads where email_norm = lower(trim(p_email_norm)) returning 1),
       c as (delete from public.demo_calendar_casi where attendee_email_norm = lower(trim(p_email_norm)) returning 1)
  select (select count(*) from l)::integer + (select count(*) from c)::integer;
$$;

revoke all on function public.demo_cancella_dati_email(text) from public, anon, authenticated;
grant execute on function public.demo_cancella_dati_email(text) to service_role;

notify pgrst, 'reload schema';
