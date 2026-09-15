-- Tappa 6 (correzione) — tre stati di accesso invece di due, come da
-- clausola 8 delle condizioni di abbonamento: alla cessazione il
-- cliente non perde subito l'accesso, ma entra in sola lettura per 30
-- giorni dalla fine dell'ultimo periodo pagato, poi i contenuti vengono
-- cancellati in modo irreversibile. Lo stato stesso non è mai salvato
-- (si calcola sempre da subscriptions.current_period_end, vedi
-- src/lib/omnia-ai-access.ts): qui servono solo due cose di supporto.

-- Evita che il job di cancellazione automatica rielabori ogni giorno un
-- account già svuotato: null finché non è stato ripulito, valorizzato
-- una sola volta dal job.
alter table public.subscriptions
  add column if not exists contenuti_cancellati_at timestamptz;

-- Traccia di ogni esecuzione del job di cancellazione automatica
-- (un'unica riga per run, anche quando non c'è nulla da svuotare): serve
-- a verificare che il job stia davvero girando ogni giorno, guardando la
-- tabella, invece di scoprirlo da un cliente che ha ancora i suoi dati
-- dopo due mesi. Sola lettura per admin, nessuna policy per l'utente
-- finale — non è un dato che lo riguarda direttamente.
create table public.omnia_ai_purge_log (
  id uuid primary key default gen_random_uuid(),
  eseguito_at timestamptz not null default now(),
  account_esaminati integer not null,
  account_svuotati integer not null,
  account_falliti integer not null,
  dettaglio text
);

alter table public.omnia_ai_purge_log enable row level security;

create policy "omnia_ai_purge_log_select_admin" on public.omnia_ai_purge_log
  for select using (public.is_admin());

grant select on public.omnia_ai_purge_log to authenticated;
grant select, insert on public.omnia_ai_purge_log to service_role;
