-- Copertina della relazione tecnica (OMNIA AI): impostazioni per cliente dalla console e registro delle generazioni.
--
-- 1) IMPOSTAZIONI PER CLIENTE (omnia_ai_copertina_impostazioni). Una riga per cliente (il titolare), scritta dalla console:
--      - attivo: il servizio è acceso per quel cliente (senza riga, o con attivo = false, il cliente non lo vede: di base è SPENTO);
--      - modalita «gratis»: il cliente non paga. Facoltativi: gare_massime (quante gare gratis in tutto; vuoto = senza limite) e scade_il
--        (ultimo giorno in cui vale; vuoto = senza scadenza). Una gara «usa» una gara gratis alla sua prima copertina;
--      - modalita «pagamento»: prezzo_centesimi è il prezzo PER GARA, IVA inclusa, deciso per quel cliente. Il pagamento online non è ancora
--        costruito: finché non lo è, un cliente a pagamento vede il prezzo ma non può generare.
--
-- 2) REGISTRO DELLE GENERAZIONI (gara_copertine). Una riga per copertina (stile stilizzato o realistico) di una gara. Serve a far rispettare, dal
--    server, il limite di 3 generazioni per stile e per gara, e a contare le gare gratis usate da un cliente. La riga nasce «in_corso» quando parte
--    la generazione (può durare più di un minuto); una generazione che non riesce la cancella (non conta); a generazione riuscita diventa «pronta»
--    e ricorda la marca di tempo dei file nello storage («copertina-<marca>-<stile>.png/.pdf»). Una riga rimasta «in_corso» oltre 20 minuti si
--    considera interrotta e non conta più. Si cancella insieme alla gara (e insieme al cliente).
--
-- PERMESSI. Le legge e le scrive solo il server (chiave di servizio, dalla console e dalle azioni): nessun permesso ai ruoli utente.
-- Additiva e idempotente; può essere eseguita prima o dopo il deploy (senza queste tabelle il codice nuovo non offre il servizio online; in sviluppo
-- locale resta acceso per le prove).
--
-- Per accendere il servizio a un cliente senza passare dalla console (per esempio per provarlo), sostituendo l'email:
--   insert into public.omnia_ai_copertina_impostazioni (user_id, attivo, modalita, aggiornata_da_email)
--   select id, true, 'gratis', 'sql' from public.users where email = 'cliente@esempio.it'
--   on conflict (user_id) do update set attivo = true, modalita = 'gratis', gare_massime = null, scade_il = null, prezzo_centesimi = null, aggiornata_il = now();

create table if not exists public.omnia_ai_copertina_impostazioni (
  -- il titolare a cui si riferiscono le impostazioni
  user_id uuid primary key references public.users (id) on delete cascade,
  attivo boolean not null default false,
  modalita text not null default 'gratis' check (modalita in ('gratis', 'pagamento')),
  -- prezzo per gara (IVA inclusa), solo per «pagamento»
  prezzo_centesimi integer check (prezzo_centesimi is null or prezzo_centesimi between 100 and 100000),
  -- solo per «gratis»: quante gare gratis in tutto (vuoto = senza limite) e fino a quando vale (vuoto = senza scadenza)
  gare_massime integer check (gare_massime is null or gare_massime between 1 and 1000),
  scade_il date,
  -- nota interna della console (mai mostrata al cliente)
  nota text check (nota is null or char_length(nota) <= 300),
  creata_il timestamptz not null default now(),
  aggiornata_il timestamptz not null default now(),
  aggiornata_da_email text not null,
  constraint omnia_ai_copertina_impostazioni_forma check (
    (modalita = 'pagamento' and prezzo_centesimi is not null and gare_massime is null and scade_il is null)
    or (modalita = 'gratis' and prezzo_centesimi is null)
  )
);

alter table public.omnia_ai_copertina_impostazioni enable row level security;

-- niente delete: per spegnere si imposta attivo = false
grant select, insert, update on public.omnia_ai_copertina_impostazioni to service_role;

create table if not exists public.gara_copertine (
  id uuid primary key default gen_random_uuid(),
  gara_id uuid not null references public.gare (id) on delete cascade,
  -- il titolare dell'azienda (anche quando la generazione la lancia il suo Ufficio Gare)
  user_id uuid not null references public.users (id) on delete cascade,
  stile text not null check (stile in ('stilizzato', 'realistico')),
  stato text not null default 'in_corso' check (stato in ('in_corso', 'pronta')),
  -- da dove viene il diritto: «gratis» (impostazioni del cliente), «pagamento» (acquisto, quando ci sarà), «sviluppo» (prove in locale)
  fonte text not null check (fonte in ('gratis', 'pagamento', 'sviluppo')),
  -- marca di tempo dei file nello storage, a generazione riuscita
  marca text,
  creata_il timestamptz not null default now(),
  completata_il timestamptz
);

create index if not exists gara_copertine_gara_idx on public.gara_copertine (gara_id, stile);
create index if not exists gara_copertine_utente_idx on public.gara_copertine (user_id, fonte, stato);

alter table public.gara_copertine enable row level security;

grant select, insert, update, delete on public.gara_copertine to service_role;

notify pgrst, 'reload schema';
