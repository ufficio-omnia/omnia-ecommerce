-- Revisione umana della relazione tecnica (servizio a pagamento di OMNIA AI).
--
-- Il cliente, dopo la relazione finale, chiede la revisione di un consulente umano: indica il referente
-- da contattare, accetta le condizioni, e paga con Stripe. Una riga per richiesta:
--   - «in_attesa_pagamento»: creata quando il cliente va al pagamento, con il prezzo FISSATO in quel
--     momento (pagine, base, maggiorazione per urgenza, totale) e il file Word della relazione che ha visto;
--   - «pagata»: la imposta solo il webhook di Stripe (mai la pagina di ritorno). Da lì parte l'email
--     all'ufficio con il Word allegato, i dati aziendali e il referente.
--
-- Il prezzo è il risultato di una regola (da 250 € per 5 pagine a 550 € per 50 o più, con +25% se la
-- gara scade entro 72 ore e +50% entro 48): qui si conserva ciò che è stato applicato, non la regola.
--
-- Come l'incasso (0076/0078), la riga NON si cancella con l'utente né con la gara: è un pagamento
-- ricevuto. I riferimenti si azzerano (on delete set null) e restano il titolo della gara e il referente.
-- Nessun permesso ai ruoli utente: legge e scrive solo il server (chiave di servizio), filtrando per
-- l'utente della richiesta. Idempotente.

create table if not exists public.omnia_ai_revisioni (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.users (id) on delete set null,
  gara_id uuid references public.gare (id) on delete set null,
  gara_titolo text not null,
  -- il messaggio della chat con la relazione finale e il suo file Word, come li ha visti il cliente
  messaggio_id uuid references public.gara_messaggi (id) on delete set null,
  file_nome text not null,
  file_path text not null,

  -- prezzo fissato al momento del pagamento
  pagine integer not null check (pagine between 1 and 10000),
  -- da dove vengono le pagine: prescrizione del disciplinare, oppure pagine della relazione generata
  pagine_fonte text not null check (pagine_fonte in ('disciplinare', 'relazione')),
  prezzo_base_centesimi integer not null check (prezzo_base_centesimi > 0),
  maggiorazione_percentuale integer not null default 0 check (maggiorazione_percentuale in (0, 25, 50)),
  prezzo_totale_centesimi integer not null check (prezzo_totale_centesimi > 0),
  scadenza_gara date,
  ore_alla_scadenza integer,

  -- il referente della gara da contattare
  referente_nome text not null check (length(btrim(referente_nome)) between 2 and 120),
  referente_email text not null,
  referente_cellulare text not null,

  -- accettazione delle condizioni del servizio (testo in vigore: versione e impronta)
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

  creata_il timestamptz not null default now()
);

-- Che una relazione si paghi una volta sola lo controlla l'azione prima del pagamento. NON c'è un indice
-- unico: se due schede di pagamento aperte insieme venissero pagate entrambe, il secondo pagamento deve
-- comunque restare registrato (e l'email all'ufficio lo segnala come doppione da rimborsare).
create index if not exists omnia_ai_revisioni_messaggio_idx
  on public.omnia_ai_revisioni (messaggio_id)
  where stato = 'pagata' and messaggio_id is not null;

create index if not exists omnia_ai_revisioni_utente_idx
  on public.omnia_ai_revisioni (user_id, creata_il desc);

alter table public.omnia_ai_revisioni enable row level security;

-- niente delete: è un pagamento ricevuto
grant select, insert, update on public.omnia_ai_revisioni to service_role;
