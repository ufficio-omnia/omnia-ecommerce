-- Acquisto singolo del piano di lavoro di una gara (servizio a pagamento di OMNIA AI, una tantum, con Stripe).
--
-- Chi non ha il piano di lavoro nell'abbonamento lo compra per UNA gara (75 € IVA inclusa, prezzo modificabile dalla console).
-- Una riga per acquisto:
--   - «in_attesa_pagamento»: creata quando il titolare va al pagamento, con il prezzo FISSATO in quel momento e l'accettazione
--     delle avvertenze (versione e impronta del testo, indirizzo IP, browser);
--   - «pagata»: la imposta solo il webhook di Stripe (mai la pagina di ritorno). Da lì la gara ha diritto alla generazione del piano
--     (una per gara, una seconda solo con la proroga dei termini: lo decide il codice, non questa tabella).
--
-- Come l'incasso (0076/0078) e la revisione umana (0089), la riga NON si cancella con l'utente né con la gara: è un pagamento
-- ricevuto. I riferimenti si azzerano (on delete set null) e restano il titolo della gara e l'importo.
--
-- FATTURAZIONE. Un acquisto pagato va fatturato a parte (la ricevuta di Stripe non è una fattura): stesse colonne dello stato di
-- fattura (0079) e del PDF (0081), segnate a mano dalla console. Un pagamento di prova non è mai da fatturare: lo imposta il webhook.
--
-- PERMESSI. Scrive e legge tutto il server (chiave di servizio). Il titolare legge i SUOI pagamenti con la sua sessione («Pagamenti
-- e fatture»): policy «solo le mie righe» e solo le colonne che gli servono; niente note interne né dati di Stripe. Idempotente.
--
-- Registro delle email automatiche (0087/0090): due nuovi tipi, «piano_lavoro_acquistato» (all'ufficio) e «piano_lavoro_ricevuto»
-- (conferma al cliente).

create table if not exists public.omnia_ai_piani_lavoro_acquisti (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.users (id) on delete set null,
  gara_id uuid references public.gare (id) on delete set null,
  gara_titolo text not null,

  -- prezzo fissato al momento del pagamento (IVA inclusa)
  prezzo_centesimi integer not null check (prezzo_centesimi > 0),

  -- accettazione delle avvertenze sul piano di lavoro (testo in vigore: versione e impronta)
  condizioni_versione integer not null,
  condizioni_hash text not null,
  accettato_il timestamptz not null,
  accept_ip text,
  accept_user_agent text,
  privacy_documento_id uuid,
  privacy_versione integer,

  stato text not null default 'in_attesa_pagamento' check (stato in ('in_attesa_pagamento', 'pagata')),
  stripe_session_id text unique,
  stripe_payment_intent_id text,
  pagata_il timestamptz,
  importo_pagato_centesimi integer,
  -- false = pagamento dell'account Stripe di prova
  livemode boolean not null default true,
  -- dati di fatturazione raccolti da Stripe (nome, indirizzo, partite IVA), copia al momento del pagamento
  dati_stripe jsonb,

  -- stato di fatturazione, segnato dalla console (vale solo per le righe «pagata»)
  stato_fattura text not null default 'da_fatturare' check (stato_fattura in ('da_fatturare', 'fatturata', 'non_dovuta')),
  numero_fattura text,
  data_fattura date,
  note_fattura text,
  fatturazione_aggiornata_il timestamptz,
  fatturazione_aggiornata_da uuid,
  -- il PDF della fattura nel bucket privato «invoices» e quando è stato caricato
  fattura_file_path text,
  fattura_caricata_il timestamptz,

  creata_il timestamptz not null default now()
);

create index if not exists omnia_ai_piani_lavoro_acquisti_stato_fattura_idx
  on public.omnia_ai_piani_lavoro_acquisti (stato_fattura)
  where stato = 'pagata';

-- Che una gara si paghi una volta sola lo controlla l'azione prima del pagamento. NON c'è un indice unico: se due schede di
-- pagamento aperte insieme venissero pagate entrambe, il secondo pagamento deve comunque restare registrato (e l'email all'ufficio
-- lo segnala come doppione da rimborsare).
create index if not exists omnia_ai_piani_lavoro_acquisti_gara_idx
  on public.omnia_ai_piani_lavoro_acquisti (user_id, gara_id)
  where stato = 'pagata' and gara_id is not null;

create index if not exists omnia_ai_piani_lavoro_acquisti_utente_idx
  on public.omnia_ai_piani_lavoro_acquisti (user_id, creata_il desc);

alter table public.omnia_ai_piani_lavoro_acquisti enable row level security;

-- niente delete: è un pagamento ricevuto
grant select, insert, update on public.omnia_ai_piani_lavoro_acquisti to service_role;

-- Il titolare legge i propri pagamenti, solo alcune colonne.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'omnia_ai_piani_lavoro_acquisti' and policyname = 'omnia_ai_piani_lavoro_acquisti_select_own'
  ) then
    create policy "omnia_ai_piani_lavoro_acquisti_select_own" on public.omnia_ai_piani_lavoro_acquisti
      for select using (user_id = auth.uid());
  end if;
end
$$;

grant select (
  id, user_id, gara_id, gara_titolo, prezzo_centesimi, stato, pagata_il, importo_pagato_centesimi, livemode, creata_il,
  stato_fattura, numero_fattura, data_fattura, fattura_file_path
) on public.omnia_ai_piani_lavoro_acquisti to authenticated;

-- Nuovi tipi nel registro delle email automatiche.
alter table public.omnia_ai_email_eventi drop constraint if exists omnia_ai_email_eventi_tipo_check;
alter table public.omnia_ai_email_eventi
  add constraint omnia_ai_email_eventi_tipo_check check (
    tipo in (
      'nuovo_cliente',
      'cambio_piano',
      'acquisto_crediti',
      'disdetta',
      'mancato_pagamento',
      'pagamento_ricevuto',
      'disdetta_confermata',
      'metodo_pagamento_cambiato',
      'revisione_umana_richiesta',
      'revisione_umana_ricevuta',
      'piano_lavoro_acquistato',
      'piano_lavoro_ricevuto'
    )
  );

notify pgrst, 'reload schema';
