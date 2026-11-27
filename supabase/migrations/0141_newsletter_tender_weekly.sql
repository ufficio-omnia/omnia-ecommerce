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

-- Nessuna estensione: gen_random_uuid() è nativa (PostgreSQL 13+).

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
  -- Resend: costo fisso mensile ATTRIBUITO alla newsletter (dichiarato dall'admin; null = non disponibile). Le singole
  -- email comprese nel piano non hanno un costo proprio: nessun costo per email.
  resend_piano text,
  resend_quota_mensile_eur numeric(10, 2) check (resend_quota_mensile_eur is null or resend_quota_mensile_eur >= 0),
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
  -- numero della versione (newsletter_versioni) da cui viene il contenuto attuale; null = scritta a mano da zero
  versione_attiva integer,
  -- blocco delle generazioni: una sola generazione alla volta per edizione (doppio clic, due schede, cron)
  generazione_in_corso_da timestamptz,
  generazione_token uuid,
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
  -- 64 caratteri esadecimali casuali (due UUID v4 senza trattini, 244 bit casuali)
  token_disiscrizione text not null unique default (replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')),
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

-- ───────────── versioni di un'edizione (27/11, seconda parte) ─────────────
-- Ogni generazione, rigenerazione (intera, di una sezione, di una notizia), salvataggio delle modifiche manuali prima di
-- una rigenerazione e generazione fallita lascia UNA riga: stessa edizione, stesso numero, stessa data editoriale,
-- versioni 1, 2, 3… Il contenuto attuale dell'edizione resta in newsletter_edizioni; le versioni sono lo storico da cui
-- si può ripristinare. Una generazione fallita ha esito «fallita», nessun contenuto e il costo speso.
create table if not exists public.newsletter_versioni (
  id uuid primary key default gen_random_uuid(),
  edizione_id uuid not null references public.newsletter_edizioni (id) on delete cascade,
  numero_versione integer not null check (numero_versione > 0),
  origine text not null
    check (origine in ('generazione', 'rigenerazione', 'rigenerazione_sezione', 'rigenerazione_notizia', 'modifiche_manuali', 'iniziale')),
  esito text not null default 'ok' check (esito in ('ok', 'fallita')),
  -- per le rigenerazioni parziali: quale sezione / notizia
  ambito jsonb not null default '{}'::jsonb,
  indicazioni text,
  oggetto text,
  preheader text,
  contenuto jsonb,
  -- identificativo della generazione: lo stesso valore sta in ai_operazioni.dettaglio->>'generazione_id'
  generazione_id uuid,
  -- somma delle chiamate di questa generazione (dollari, stimati dai consumi con le tariffe di src/lib/ai-pricing.ts)
  costo_usd numeric(10, 4),
  input_tokens integer,
  output_tokens integer,
  ricerche_web integer,
  modello text,
  errore text,
  creata_il timestamptz not null default now(),
  creata_da uuid,
  unique (edizione_id, numero_versione),
  check (esito = 'fallita' or contenuto is not null)
);
create index if not exists newsletter_versioni_edizione_idx on public.newsletter_versioni (edizione_id, numero_versione desc);

alter table public.newsletter_versioni enable row level security;
revoke all on public.newsletter_versioni from anon, authenticated;
grant select, insert on public.newsletter_versioni to service_role;

-- ───────────── costi: lo stesso registro di sempre (ai_operazioni) ─────────────
-- Nessun secondo sistema di contabilizzazione: le chiamate della newsletter vanno in ai_operazioni come tutte le altre
-- (operazione «newsletter_*», user_id e gara_id nulli: costo interno, non di un cliente né di una gara). La colonna
-- nuova «dettaglio» porta i riferimenti che servono all'area «Newsletter | Tender Weekly» di Costi e margini:
-- edizione (id e numero), generazione, versione, tipo di operazione, esito, natura del costo, ricerche web.
-- Nullable e senza vincoli: le righe esistenti e il codice che non la scrive restano come sono.
alter table public.ai_operazioni add column if not exists dettaglio jsonb;
create index if not exists ai_operazioni_newsletter_edizione_idx
  on public.ai_operazioni ((dettaglio ->> 'edizione_id'))
  where dettaglio ? 'edizione_id';

-- Costi per categoria (funzione della 0077, stessa firma e stesse righe): le operazioni «newsletter_*» hanno ora una
-- categoria propria, «newsletter», che la console somma ai costi operativi (nel margine complessivo, non nel costo
-- per gara né in quello di un cliente). Prima di questa migrazione finivano in «non_attribuito» (fuori dal margine).
-- Le prove con prefisso «prova:» restano «prova» come sempre (sviluppo e collaudo).
create or replace function public.console_costi_per_cliente(p_da timestamptz, p_a timestamptz)
returns table (
  user_id uuid,
  categoria text,
  operazioni bigint,
  operazioni_senza_costo bigint,
  costo_usd numeric,
  input_token bigint,
  output_token bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  with base as (
    select
      o.user_id,
      o.operazione,
      o.costo_stimato,
      o.input_tokens,
      o.output_tokens,
      (starts_with(o.operazione, 'prova:') or starts_with(o.operazione, 'prova-leggero:')) as e_prova
    from public.ai_operazioni o
    where o.created_at >= p_da and o.created_at < p_a
  )
  select
    case when b.e_prova then null else b.user_id end,
    case
      when b.e_prova then 'prova'
      when b.user_id is not null then 'cliente'
      when starts_with(b.operazione, 'kb_') then 'piattaforma'
      when starts_with(b.operazione, 'newsletter_') then 'newsletter'
      else 'non_attribuito'
    end,
    count(*)::bigint,
    (count(*) filter (where b.costo_stimato is null))::bigint,
    coalesce(sum(b.costo_stimato), 0),
    coalesce(sum(b.input_tokens), 0)::bigint,
    coalesce(sum(b.output_tokens), 0)::bigint
  from base b
  group by 1, 2
$$;
-- (create or replace mantiene i permessi; si ripetono comunque quelli della 0077)
revoke all on function public.console_costi_per_cliente(timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.console_costi_per_cliente(timestamptz, timestamptz) to service_role;
