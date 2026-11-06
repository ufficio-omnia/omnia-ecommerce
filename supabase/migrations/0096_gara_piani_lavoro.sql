-- Piano di lavoro di una gara (OMNIA AI): l'Excel con formule attive generato dai documenti di gara.
--
-- Una riga per generazione. Per ogni gara al massimo DUE (versione 1 e 2): la seconda solo se i documenti indicano una proroga dei
-- termini; nessuna rigenerazione a richiesta. Una generazione che FALLISCE (stato «errore») non conta: la stessa versione si riprova.
--   - «in_corso»: creata quando parte la generazione (può durare qualche minuto); una riga rimasta in corso oltre 20 minuti si
--     considera interrotta e si può riprovare;
--   - «pronto»: l'Excel è nello storage (bucket «gare», sotto il prefisso della gara, quindi si cancella insieme alla gara) e il
--     riepilogo (monte ore, addetti equivalenti, quadratura, dotazioni, cosa manca) è nella colonna riepilogo;
--   - «errore»: il testo breve dell'errore (mai dati personali né chiavi).
--
-- fonte_diritto: da dove viene il diritto alla generazione. Oggi solo «sviluppo» (prove in locale); le fonti vere (abbonamento con
-- piano di lavoro, acquisto singolo, concessione dalla console) arrivano con i blocchi successivi.
--
-- `dati` conserva i dati normalizzati del piano (le stesse che hanno prodotto l'Excel): servono a ricostruire il file senza richiamare
-- il modello. Non si espongono al cliente: lui legge solo le colonne elencate nel GRANT.
--
-- PERMESSI. Scrive e legge tutto il server (chiave di servizio). Il cliente (titolare o Ufficio Gare) legge le righe della SUA azienda
-- con la sua sessione, solo le colonne che servono alla scheda della gara (niente dati grezzi, percorsi dei file, costi). Idempotente.

create table if not exists public.gara_piani_lavoro (
  id uuid primary key default gen_random_uuid(),
  gara_id uuid not null references public.gare (id) on delete cascade,
  -- il titolare dell'azienda (anche quando la generazione la lancia il suo Ufficio Gare)
  user_id uuid not null references public.users (id) on delete cascade,
  versione smallint not null check (versione in (1, 2)),
  stato text not null default 'in_corso' check (stato in ('in_corso', 'pronto', 'errore')),
  fonte_diritto text not null default 'sviluppo',

  file_path text,
  file_nome text,
  dimensione_byte integer,

  riepilogo jsonb,
  dati jsonb,

  -- costo delle chiamate al modello (stima) e loro numero; le ricerche web si pagano a parte per ricerca
  costo_stimato numeric(10, 4),
  richieste_modello smallint,
  ricerche_web smallint,

  errore text,
  creata_il timestamptz not null default now(),
  completata_il timestamptz,

  unique (gara_id, versione)
);

create index if not exists gara_piani_lavoro_gara_idx on public.gara_piani_lavoro (gara_id, versione);
create index if not exists gara_piani_lavoro_utente_idx on public.gara_piani_lavoro (user_id, creata_il desc);

alter table public.gara_piani_lavoro enable row level security;

grant select, insert, update, delete on public.gara_piani_lavoro to service_role;

-- Il titolare e il suo Ufficio Gare leggono le righe dell'azienda (stessa funzione delle altre tabelle di lavoro delle gare).
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'gara_piani_lavoro' and policyname = 'gara_piani_lavoro_select_account'
  ) then
    create policy "gara_piani_lavoro_select_account" on public.gara_piani_lavoro
      for select using ((select public.omnia_ai_titolare_effettivo()) = user_id);
  end if;
end
$$;

grant select (id, gara_id, user_id, versione, stato, file_nome, dimensione_byte, riepilogo, errore, creata_il, completata_il)
  on public.gara_piani_lavoro to authenticated;

notify pgrst, 'reload schema';
