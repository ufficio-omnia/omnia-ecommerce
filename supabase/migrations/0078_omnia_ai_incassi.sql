-- Incassi OMNIA AI: ogni pagamento di abbonamento riceve una riga, e le
-- subscriptions imparano a ricordare se sono di prova e quando sono state
-- disdette o concluse.
--
-- PERCHÉ. Oggi i pagamenti degli abbonamenti AI (primo pagamento, rinnovi,
-- conguagli di cambio piano) non lasciano traccia nel database: il webhook
-- gestiva solo invoice.payment_failed. Senza una tabella dei pagamenti non si
-- possono calcolare i ricavi, né sapere quali rinnovi vanno ancora fatturati
-- (le ricevute di Stripe non sono fatture elettroniche italiane).
--
-- 1) omnia_ai_incassi: una riga per fattura Stripe PAGATA (stripe_invoice_id
--    unico: un evento ripetuto non duplica). Importi in centesimi, lordo = ciò
--    che il cliente ha pagato. imposta_centesimi/imponibile_centesimi sono quelli
--    calcolati da Stripe e restano NULLI se Stripe non ha calcolato imposte (i
--    prezzi sono IVA inclusa e senza Stripe Tax la fattura non separa l'IVA: in
--    quel caso la console scorpora con l'aliquota dei suoi parametri).
--    livemode distingue i pagamenti di prova (account Stripe in modalità test)
--    da quelli veri. cliente_snapshot conserva i dati di fatturazione raccolti da
--    Stripe al momento del pagamento (nome, indirizzo, partita IVA): servono a
--    fatturare anche se il profilo azienda non è compilato.
--    user_id va a NULL se l'utente viene eliminato (la riga di ricavo resta);
--    può essere nullo anche all'arrivo del pagamento, se l'evento precede la
--    creazione della subscription: la riga si completa dopo, via
--    stripe_subscription_id. È l'UNICA chiave esterna verso users: nessuna
--    ambiguità per PostgREST (vedi 0076).
--
-- 2) subscriptions: livemode (l'abbonamento è di prova?), disdetta_richiesta_il
--    (quando il cliente ha chiesto la disdetta a fine periodo, da Stripe) e
--    terminata_il (quando Stripe l'ha davvero conclusa). Le righe già presenti
--    con un abbonamento Stripe sono marcate di PROVA: l'account Stripe di OMNIA AI
--    è stato in modalità test finora. Se esistesse un abbonamento AI reale, va
--    corretto a mano: update public.subscriptions set livemode = true where id = '...';
--    Le righe create a mano (senza Stripe) restano con livemode nullo.
--    Le date di disdetta e di fine passate non esistono: restano nulle.
--
-- Idempotente: tabella, indici e colonne con IF NOT EXISTS; il backfill tocca solo
-- le righe con livemode ancora nullo. Il codice funziona anche prima di questa
-- migrazione (il webhook ripiega sulle colonne di sempre e salta gli incassi).

create table if not exists public.omnia_ai_incassi (
  id uuid primary key default gen_random_uuid(),
  stripe_invoice_id text not null unique,
  stripe_subscription_id text,
  stripe_customer_id text,
  user_id uuid references public.users (id) on delete set null,
  tipo text not null check (tipo in ('primo', 'rinnovo', 'conguaglio', 'altro')),
  importo_lordo_centesimi integer not null,
  imposta_centesimi integer,
  imponibile_centesimi integer,
  valuta text not null default 'eur',
  pagato_il timestamptz not null,
  livemode boolean not null,
  numero_ricevuta text,
  ricevuta_url text,
  cliente_snapshot jsonb,
  created_at timestamptz not null default now()
);

create index if not exists omnia_ai_incassi_pagato_il_idx on public.omnia_ai_incassi (pagato_il desc);
create index if not exists omnia_ai_incassi_subscription_idx on public.omnia_ai_incassi (stripe_subscription_id);
create index if not exists omnia_ai_incassi_user_idx on public.omnia_ai_incassi (user_id);

alter table public.omnia_ai_incassi enable row level security;

grant select, insert, update on public.omnia_ai_incassi to service_role;

alter table public.subscriptions
  add column if not exists livemode boolean,
  add column if not exists disdetta_richiesta_il timestamptz,
  add column if not exists terminata_il timestamptz;

update public.subscriptions
set livemode = false
where livemode is null
  and stripe_subscription_id is not null;

notify pgrst, 'reload schema';
