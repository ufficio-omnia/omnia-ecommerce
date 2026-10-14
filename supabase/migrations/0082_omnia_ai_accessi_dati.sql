-- Registro degli accessi ai dati dei clienti di OMNIA AI.
--
-- Le condizioni di abbonamento (art. 10) e l'Allegato A (art. 4) promettono che
-- «ogni accesso è registrato con data, ora, operatore e motivo» e che il cliente
-- può chiedere l'estratto dei registri relativi ai propri dati. Questa tabella è
-- quel registro.
--
-- Cosa ci va dentro: gli accessi ECCEZIONALI di personale autorizzato ai documenti
-- o ai contenuti di un cliente, nei soli quattro casi ammessi dall'Allegato A:
--   a) assistenza tecnica richiesta dal cliente      (assistenza_tecnica)
--   b) revisione umana acquistata dal cliente        (revisione_umana)
--   c) manutenzione o sicurezza non altrimenti risolvibili (manutenzione_sicurezza)
--   d) obbligo di legge o provvedimento dell'autorità (obbligo_di_legge)
-- Nel funzionamento normale nessun operatore accede ai contenuti e questa tabella
-- resta vuota: per il cliente un estratto vuoto è la prova che nessuno ha guardato.
--
-- Chi scrive: SOLO la console (pagina «Accessi ai dati»), con la chiave di servizio,
-- e sempre dopo aver verificato che chi scrive sia un amministratore. L'operatore è
-- quello della sessione, non un campo di testo. La regola operativa è che qualsiasi
-- accesso (anche da Supabase, dallo storage o da uno script) si registra qui.
--
-- Solo aggiunta (append-only): alla chiave di servizio si concede SELECT e INSERT,
-- mai UPDATE né DELETE, e un trigger rifiuta modifiche e cancellazioni anche a chi
-- avesse i permessi (per correggere si registra una nuova riga). Nessun ruolo utente
-- (anon, authenticated) ha alcun permesso: il cliente non legge il registro, ne
-- chiede l'estratto.
--
-- Nessuna chiave esterna su operatore e cliente, di proposito: il registro deve
-- sopravvivere alla cancellazione o anonimizzazione dell'utente, e una seconda FK
-- verso users rompe gli embed di PostgREST. L'email di entrambi è copiata nella riga
-- (istantanea) così l'estratto resta leggibile anche dopo.
--
-- Idempotente: sicura da rieseguire. Nessuna dipendenza dal codice nuovo: il vecchio
-- sito non la usa.

create table if not exists public.omnia_ai_accessi_dati (
  id uuid primary key default gen_random_uuid(),
  -- quando la riga è stata scritta (sempre l'orario del server)
  created_at timestamptz not null default now(),
  -- quando l'accesso è avvenuto: di norma uguale a created_at; la console permette
  -- di indicare un momento precedente (fino a sette giorni) per un accesso registrato dopo
  accesso_il timestamptz not null default now(),
  -- operatore: l'amministratore la cui sessione ha scritto la riga
  operatore_id uuid,
  operatore_email text not null,
  -- cliente: un cliente preciso (id ed email al momento della registrazione) oppure,
  -- con tutti_i_clienti, un accesso generale al database che può toccare i dati di tutti
  cliente_id uuid,
  cliente_email text,
  tutti_i_clienti boolean not null default false,
  caso text not null check (caso in ('assistenza_tecnica', 'revisione_umana', 'manutenzione_sicurezza', 'obbligo_di_legge')),
  motivo text not null check (char_length(btrim(motivo)) between 10 and 1000),
  -- cosa si è guardato (gara, documenti, tabella, file) e con che strumento
  ambito text not null check (char_length(btrim(ambito)) between 3 and 500),
  gara_id uuid,
  -- un accesso è o su un cliente o generale, mai nessuno dei due
  constraint omnia_ai_accessi_dati_riguarda check (
    (tutti_i_clienti and cliente_id is null and cliente_email is null)
    or (not tutti_i_clienti and cliente_email is not null)
  ),
  -- assistenza e revisione nascono da una richiesta di un cliente preciso
  constraint omnia_ai_accessi_dati_caso_cliente check (
    caso in ('manutenzione_sicurezza', 'obbligo_di_legge') or not tutti_i_clienti
  )
);

create index if not exists omnia_ai_accessi_dati_cliente_idx on public.omnia_ai_accessi_dati (cliente_id, accesso_il desc);
create index if not exists omnia_ai_accessi_dati_accesso_idx on public.omnia_ai_accessi_dati (accesso_il desc);

alter table public.omnia_ai_accessi_dati enable row level security;

-- Nessuna policy: con la RLS attiva e nessuna policy nessun ruolo utente legge o
-- scrive. La chiave di servizio ha comunque i permessi sotto, ma solo SELECT e INSERT.
grant select, insert on public.omnia_ai_accessi_dati to service_role;

create or replace function public.omnia_ai_accessi_dati_immutabile()
returns trigger
language plpgsql
as $$
begin
  raise exception 'Il registro degli accessi ai dati non si modifica né si cancella: per correggere registra una nuova riga.';
end;
$$;

drop trigger if exists omnia_ai_accessi_dati_immutabile on public.omnia_ai_accessi_dati;
create trigger omnia_ai_accessi_dati_immutabile
  before update or delete on public.omnia_ai_accessi_dati
  for each row execute function public.omnia_ai_accessi_dati_immutabile();
