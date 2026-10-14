-- Offerta pilot di OMNIA AI: un prezzo dedicato per un cliente creato dalla console.
--
-- L'amministratore offre a UN cliente (creato da lui dalla console, quindi presente in
-- omnia_ai_utenti_console, migrazione 0084) un piano a un prezzo mensile dedicato per un
-- numero di mesi (0 = sempre quel prezzo). L'offerta compare solo nella SUA area riservata,
-- che lo porta al pagamento su Stripe: lì lo sconto è un coupon a importo fisso e, dopo i mesi
-- indicati, Stripe torna da solo al prezzo pieno del piano.
--
-- Una riga per offerta e non per cliente: le offerte acquistate restano come storia.
--   - «aperta»:     attiva e non ancora acquistata (al più UNA per cliente: indice parziale)
--   - «revocata»:   attiva = false, mai acquistata
--   - «acquistata»: acquistata_il valorizzato dal webhook Stripe alla creazione dell'abbonamento,
--                   con scade_il (fine del prezzo pilot, null se i mesi sono 0), il prezzo pieno
--                   che subentra e quando è partito il promemoria dei 15 giorni.
--
-- Nessun permesso ai ruoli utente: il cliente legge la sua offerta dal server (chiave di servizio,
-- filtrata per il suo utente), la crea e la revoca solo la console. Si cancella con l'utente.
-- Idempotente. Prima di questa migrazione l'offerta pilot semplicemente non esiste.

create table if not exists public.omnia_ai_offerte_pilot (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.omnia_ai_utenti_console (user_id) on delete cascade,
  piano text not null check (piano in ('starter', 'professional', 'enterprise')),
  -- prezzo mensile dedicato, IVA inclusa, in centesimi
  prezzo_centesimi integer not null check (prezzo_centesimi between 100 and 10000000),
  -- mesi di prezzo pilot; 0 = per tutta la durata dell'abbonamento
  mesi integer not null default 0 check (mesi between 0 and 60),
  attiva boolean not null default true,
  creata_il timestamptz not null default now(),
  creata_da_email text not null,
  acquistata_il timestamptz,
  stripe_subscription_id text,
  -- prezzo mensile che subentra a fine pilot (quello del piano al momento dell'acquisto)
  prezzo_pieno_centesimi integer,
  -- fine del prezzo pilot; null se i mesi sono 0
  scade_il timestamptz,
  promemoria_inviato_il timestamptz,
  constraint omnia_ai_offerte_pilot_scadenza check (scade_il is null or acquistata_il is not null)
);

-- al più una offerta aperta per cliente
create unique index if not exists omnia_ai_offerte_pilot_una_aperta_idx
  on public.omnia_ai_offerte_pilot (user_id)
  where attiva and acquistata_il is null;

-- per il promemoria giornaliero: offerte acquistate con una scadenza e ancora senza promemoria
create index if not exists omnia_ai_offerte_pilot_promemoria_idx
  on public.omnia_ai_offerte_pilot (scade_il)
  where acquistata_il is not null and promemoria_inviato_il is null;

alter table public.omnia_ai_offerte_pilot enable row level security;

grant select, insert, update on public.omnia_ai_offerte_pilot to service_role;
