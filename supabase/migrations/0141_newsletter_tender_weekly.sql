-- Newsletter «OMNIA AI | Tender Weekly» (richiesta del 27/11/2026): edizioni, iscritti con base giuridica documentata,
-- invii (reali e di prova), eventi del webhook di Resend, registro delle azioni dell'amministratore, impostazioni
-- della programmazione settimanale.
--
-- Accesso: SOLO dal server con la service role (console amministrativa, cron, pagina di disiscrizione, webhook).
-- RLS attiva senza policy = nessun accesso con le chiavi anon/authenticated; i GRANT vanno solo a service_role.
--
-- Garanzie decise dal DATABASE e non solo dal codice:
--   - un iscritto riceve al massimo UN invio reale per edizione (indice unico edizione_id + iscritto_id);
--   - un'edizione approvata o programmata che viene modificata torna «in_revisione» e perde l'approvazione
--     (trigger): non può partire un testo diverso da quello approvato;
--   - un'edizione in invio / inviata / con invio parziale non si modifica più nel contenuto (trigger);
--   - un evento del webhook si registra una volta sola (svix_id unico): i rinvii di Resend non contano due volte.
--
-- Idempotente: si può rieseguire. Nessun dato esistente viene toccato. Si può eseguire PRIMA del deploy: il codice
-- attuale non legge queste tabelle.

create extension if not exists pgcrypto;

-- ───────────── impostazioni (una riga sola) ─────────────
create table if not exists public.newsletter_impostazioni (
  id smallint primary key default 1 check (id = 1),
  -- giorno ISO: 1 = lunedì … 7 = domenica; ore nel fuso Europe/Rome (l'ora legale la gestisce il codice)
  giorno_generazione smallint not null default 4 check (giorno_generazione between 1 and 7),
  ora_generazione text not null default '18:00' check (ora_generazione ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  giorno_invio smallint not null default 5 check (giorno_invio between 1 and 7),
  ora_invio text not null default '10:00' check (ora_invio ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  generazione_automatica boolean not null default true,
  mittente_nome text not null default 'OMNIA AI | Tender Weekly',
  mittente_email text not null default 'newsletter@omniaitalia.com',
  rispondi_a text,
  email_notifica_admin text not null default 'ufficio@omniaitalia.com',
  aggiornato_il timestamptz not null default now(),
  aggiornato_da uuid
);
insert into public.newsletter_impostazioni (id) values (1) on conflict (id) do nothing;

-- ───────────── edizioni ─────────────
create table if not exists public.newsletter_edizioni (
  id uuid primary key default gen_random_uuid(),
  numero integer not null unique check (numero > 0),
  -- settimana ISO della generazione automatica ('2026-W48'): una sola bozza automatica per settimana
  settimana text unique,
  stato text not null default 'bozza'
    check (stato in ('bozza', 'in_revisione', 'approvata', 'programmata', 'in_invio', 'inviata', 'invio_parziale', 'annullata')),
  data_edizione date not null,
  oggetto text not null default '',
  preheader text not null default '',
  contenuto jsonb not null default '{}'::jsonb,
  origine text not null default 'manuale' check (origine in ('manuale', 'ai', 'ai_automatica')),
  note_generazione text,
  -- destinatari scelti (predisposto per la segmentazione futura): {"abbonati_attivi": true, "altri_autorizzati": true}
  destinatari jsonb not null default '{"abbonati_attivi": true, "altri_autorizzati": true}'::jsonb,
  versione integer not null default 1,
  approvata_il timestamptz,
  approvata_da uuid,
  programmata_per timestamptz,
  invio_iniziato_il timestamptz,
  invio_concluso_il timestamptz,
  creata_il timestamptz not null default now(),
  creata_da uuid,
  aggiornata_il timestamptz not null default now()
);
create index if not exists newsletter_edizioni_stato_idx on public.newsletter_edizioni (stato, programmata_per);

create or replace function public.newsletter_edizioni_guardia()
returns trigger
language plpgsql
as $$
begin
  if (new.contenuto is distinct from old.contenuto
      or new.oggetto is distinct from old.oggetto
      or new.preheader is distinct from old.preheader
      or new.destinatari is distinct from old.destinatari
      or new.data_edizione is distinct from old.data_edizione) then
    if old.stato in ('in_invio', 'inviata', 'invio_parziale') then
      raise exception 'Edizione % già inviata o in invio: il contenuto non si modifica', old.numero using errcode = '23514';
    end if;
    new.versione := old.versione + 1;
    if old.stato in ('approvata', 'programmata') and new.stato = old.stato then
      new.stato := 'in_revisione';
      new.approvata_il := null;
      new.approvata_da := null;
      new.programmata_per := null;
    end if;
  end if;
  -- si può programmare o mettere in invio solo un'edizione approvata (o programmata, che lo è già)
  if new.stato in ('programmata', 'in_invio') and new.approvata_il is null then
    raise exception 'Edizione % non approvata', old.numero using errcode = '23514';
  end if;
  new.aggiornata_il := now();
  return new;
end
$$;

drop trigger if exists newsletter_edizioni_guardia on public.newsletter_edizioni;
create trigger newsletter_edizioni_guardia
  before update on public.newsletter_edizioni
  for each row execute function public.newsletter_edizioni_guardia();

-- ───────────── iscritti ─────────────
create table if not exists public.newsletter_iscritti (
  id uuid primary key default gen_random_uuid(),
  email text not null unique check (email = lower(btrim(email)) and position('@' in email) > 1),
  nome text,
  -- legame facoltativo con l'account (nessuna FK: l'account può essere anonimizzato o cancellato)
  user_id uuid,
  categoria text not null default 'altro' check (categoria in ('cliente', 'prospect', 'interno', 'altro')),
  stato text not null default 'iscritto' check (stato in ('iscritto', 'disiscritto', 'rimbalzato', 'segnalato_spam')),
  -- base giuridica documentata: senza questa riga l'indirizzo non riceve nulla
  base_giuridica text not null check (base_giuridica in ('consenso', 'soft_spam_art130', 'altro_documentato')),
  prova_base text not null check (length(btrim(prova_base)) >= 10),
  base_dal date not null default current_date,
  settori text[] not null default '{}',
  token_disiscrizione text not null unique default encode(gen_random_bytes(24), 'hex'),
  disiscritto_il timestamptz,
  motivo_uscita text,
  registrato_da uuid,
  creato_il timestamptz not null default now(),
  aggiornato_il timestamptz not null default now()
);
create index if not exists newsletter_iscritti_stato_idx on public.newsletter_iscritti (stato);

-- ───────────── invii ─────────────
create table if not exists public.newsletter_invii (
  id uuid primary key default gen_random_uuid(),
  edizione_id uuid not null references public.newsletter_edizioni (id) on delete restrict,
  iscritto_id uuid references public.newsletter_iscritti (id) on delete set null,
  tipo text not null check (tipo in ('reale', 'prova')),
  email text not null,
  versione integer not null,
  stato text not null default 'in_coda'
    check (stato in ('in_coda', 'inviato', 'consegnato', 'ritardato', 'rimbalzato', 'segnalato_spam', 'errore', 'saltato')),
  resend_id text unique,
  errore text,
  inviato_il timestamptz,
  consegnato_il timestamptz,
  aperto_il timestamptz,
  cliccato_il timestamptz,
  clic integer not null default 0,
  creato_il timestamptz not null default now(),
  -- prova: iscritto_id è null, l'indice non la limita; reale: una sola riga per iscritto ed edizione
  constraint newsletter_invii_reale_con_iscritto check (tipo = 'prova' or iscritto_id is not null)
);
create unique index if not exists newsletter_invii_un_reale_per_iscritto
  on public.newsletter_invii (edizione_id, iscritto_id);
create index if not exists newsletter_invii_edizione_idx on public.newsletter_invii (edizione_id, tipo, stato);

-- ───────────── eventi del webhook ─────────────
create table if not exists public.newsletter_eventi (
  id bigint generated always as identity primary key,
  svix_id text not null unique,
  tipo text not null,
  resend_id text,
  invio_id uuid,
  ricevuto_il timestamptz not null default now(),
  dati jsonb not null default '{}'::jsonb
);
create index if not exists newsletter_eventi_resend_idx on public.newsletter_eventi (resend_id);

-- ───────────── registro delle azioni ─────────────
create table if not exists public.newsletter_registro (
  id bigint generated always as identity primary key,
  edizione_id uuid,
  azione text not null,
  dettaglio jsonb not null default '{}'::jsonb,
  autore uuid,
  creato_il timestamptz not null default now()
);
create index if not exists newsletter_registro_edizione_idx on public.newsletter_registro (edizione_id, creato_il desc);

-- ───────────── accessi ─────────────
alter table public.newsletter_impostazioni enable row level security;
alter table public.newsletter_edizioni enable row level security;
alter table public.newsletter_iscritti enable row level security;
alter table public.newsletter_invii enable row level security;
alter table public.newsletter_eventi enable row level security;
alter table public.newsletter_registro enable row level security;

revoke all on public.newsletter_impostazioni, public.newsletter_edizioni, public.newsletter_iscritti,
  public.newsletter_invii, public.newsletter_eventi, public.newsletter_registro from anon, authenticated;

grant select, insert, update on public.newsletter_impostazioni to service_role;
grant select, insert, update on public.newsletter_edizioni to service_role;
grant select, insert, update, delete on public.newsletter_iscritti to service_role;
grant select, insert, update on public.newsletter_invii to service_role;
grant select, insert on public.newsletter_eventi to service_role;
grant select, insert on public.newsletter_registro to service_role;
