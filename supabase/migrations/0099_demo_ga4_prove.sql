-- Registro delle PROVE REALI dell'evento GA4 «demo_booking_confirmed» (Measurement Protocol) e prenotazione esclusiva dell'invio.
--
-- Perché esiste: GA4 non toglie i doppioni degli eventi del Measurement Protocol (non esiste una chiave di deduplicazione), e il
-- protocollo risponde «2xx» anche a un corpo malformato. Quindi un invio si deve fare AL MASSIMO UNA VOLTA per richiesta, e una risposta
-- positiva NON basta a dire che l'evento sia stato registrato in Analytics: serve una verifica amministrativa nei rapporti.
--
-- Una riga per RICHIESTA (demo_leads.id): la chiave primaria è il vincolo che impedisce di riservare due volte lo stesso invio, anche
-- tra istanze diverse del server e anche in parallelo (il secondo INSERT fallisce con «23505»). Non c'è chiave esterna verso
-- demo_leads di proposito: la cancellazione di una richiesta (conservazione, diritto all'oblio) non deve né bloccarsi né, soprattutto,
-- far sparire la traccia che quell'evento è già stato mandato. La riga non contiene dati personali (solo identificativi interni).
--
-- Stati (macchina a stati imposta ANCHE dal database, vedi il trigger in fondo):
--   reserved         l'invio è stato prenotato in modo esclusivo; l'esito non è ancora registrato (o la funzione si è interrotta);
--   sent_unverified  Google ha risposto 2xx: l'evento è partito, ma NON è ancora verificato nei rapporti (non è una prova);
--   rejected         Google ha risposto con un errore del richiedente (4xx): l'evento non risulta accettato;
--   uncertain        esito non determinabile (tempo scaduto, rete, risposta 5xx/3xx): l'evento può essere arrivato o no;
--   verified         verifica amministrativa: l'evento è stato visto in GA4 (stato finale);
--   not_received     verifica amministrativa: l'evento NON risulta in GA4 (stato finale).
-- Transizioni ammesse:  reserved → sent_unverified | rejected | uncertain | verified | not_received
--                       sent_unverified | rejected | uncertain → verified | not_received
--                       verified e not_received sono finali.
-- Una richiesta ha UNA sola prova: non c'è ritentativo automatico e nemmeno manuale sulla stessa richiesta. Per una nuova prova si fa
-- una nuova prenotazione di prova (è un'altra richiesta, quindi un'altra riga).
--
-- origine: 'prova' (azione dell'amministratore dalla console). 'cron' è riservata all'uso futuro della STESSA prenotazione esclusiva
-- da parte del cron di produzione.
--
-- Il cron GA4 non riprende MAI una richiesta che ha una riga qui, in nessuno stato e anche dopo lo spegnimento di DEMO_GA4_MP_DEBUG.
--
-- Le righe non si cancellano (un trigger lo vieta): cancellarne una permetterebbe di rimandare lo stesso evento per errore. Se serve
-- davvero toglierne una (per esempio una prova fatta per sbaglio su una richiesta che non andava usata), lo si fa a mano e di proposito:
--   alter table public.demo_ga4_prove disable trigger demo_ga4_prove_regole;
--   delete from public.demo_ga4_prove where lead_id = '…';
--   alter table public.demo_ga4_prove enable trigger demo_ga4_prove_regole;
-- ATTENZIONE: prima di farlo controllare in GA4 che l'evento di quella richiesta non sia già arrivato.
--
-- Sicurezza: RLS attiva e NESSUNA policy, GRANT solo a service_role (il browser non legge e non scrive mai).
-- Additiva e idempotente: si può rieseguire. Prima di eseguirla la console funziona lo stesso (la sezione «Prova reale GA4» dice che
-- manca la tabella e non permette di inviare niente).

create table if not exists public.demo_ga4_prove (
  lead_id uuid primary key,
  origine text not null default 'prova' check (origine in ('prova', 'cron')),
  stato text not null check (stato in ('reserved', 'sent_unverified', 'uncertain', 'rejected', 'verified', 'not_received')),
  -- identificativo di transazione dell'evento («omnia-demo-<id richiesta>») e proprietà GA4 a cui è stato inviato (non è un segreto)
  transaction_id text not null check (char_length(transaction_id) <= 100),
  id_misurazione text not null check (char_length(id_misurazione) <= 40),
  -- l'ora scritta nell'evento (timestamp_micros): quella della prenotazione se rientra nelle 72 ore, altrimenti quella dell'invio
  timestamp_evento timestamptz not null,
  timestamp_modalita text not null check (timestamp_modalita in ('prenotazione', 'invio')),
  riservata_il timestamptz not null default now(),
  riservata_da uuid,
  inviata_il timestamptz,
  -- codice breve dell'esito dell'invio: http_2xx, http_4xx, http_altro, timeout, rete (mai testi liberi, mai l'indirizzo chiamato)
  esito_codice text check (esito_codice is null or esito_codice in ('http_2xx', 'http_4xx', 'http_altro', 'timeout', 'rete')),
  http_status integer check (http_status is null or (http_status >= 100 and http_status <= 599)),
  risolta_il timestamptz,
  risolta_da uuid,
  aggiornata_il timestamptz not null default now()
);

-- ═════════════════════════ Accesso: solo il server ═════════════════════════
alter table public.demo_ga4_prove enable row level security;
revoke all on public.demo_ga4_prove from anon, authenticated;
grant select, insert, update, delete on public.demo_ga4_prove to service_role;

-- ═════════════════════════ Regole imposte dal database ═════════════════════════
-- Anche se il codice avesse un difetto, il database non permette: di cambiare i dati della prenotazione, di uscire da uno stato finale,
-- di fare una transizione non prevista, di cancellare una riga.
create or replace function public.demo_ga4_prove_regole()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'demo_ga4_prove non si cancella: una riga cancellata permetterebbe di rimandare lo stesso evento';
  end if;

  if new.lead_id <> old.lead_id
     or new.origine <> old.origine
     or new.transaction_id <> old.transaction_id
     or new.id_misurazione <> old.id_misurazione
     or new.timestamp_evento <> old.timestamp_evento
     or new.timestamp_modalita <> old.timestamp_modalita
     or new.riservata_il <> old.riservata_il
     or new.riservata_da is distinct from old.riservata_da then
    raise exception 'demo_ga4_prove: i dati della prenotazione dell''invio non si modificano';
  end if;

  if old.stato in ('verified', 'not_received') then
    raise exception 'demo_ga4_prove: lo stato % è finale', old.stato;
  end if;
  if old.stato = 'reserved' and new.stato not in ('sent_unverified', 'uncertain', 'rejected', 'verified', 'not_received') then
    raise exception 'demo_ga4_prove: da reserved non si va in %', new.stato;
  end if;
  if old.stato in ('sent_unverified', 'uncertain', 'rejected') and new.stato not in ('verified', 'not_received') then
    raise exception 'demo_ga4_prove: da % si può andare solo in verified o not_received', old.stato;
  end if;

  new.aggiornata_il := now();
  return new;
end
$$;

drop trigger if exists demo_ga4_prove_regole on public.demo_ga4_prove;
create trigger demo_ga4_prove_regole
  before update or delete on public.demo_ga4_prove
  for each row execute function public.demo_ga4_prove_regole();

notify pgrst, 'reload schema';
