-- Offerte dedicate: pacchetti PRIVATI a prezzo e quantità decisi dalla console per un cliente preciso.
--
-- La console crea per un cliente (il titolare) un'offerta, per esempio «10 piani di lavoro a 450 €, IVA inclusa, valida fino al 31/12»:
--   - la vede SOLO quel cliente (il titolare nella home e nella pagina «Servizi aggiuntivi», l'Ufficio Gare nella home, dove con «Acquista»
--     avvisa il titolare); nessun altro cliente la vede e non entra nell'elenco pubblico dei pacchetti;
--   - si compra UNA volta sola: quando il pagamento è confermato da Stripe l'offerta diventa «acquistata» (se ne può creare un'altra);
--   - la console può revocarla finché non è stata comprata; una scadenza (facoltativa) la fa sparire da sola, l'ultimo giorno incluso;
--   - le unità acquistate vanno nel saldo come quelle di ogni pacchetto: non scadono, si esauriscono per gara, si perdono alla cessazione.
--
-- Una riga per offerta, mai cancellata (resta la storia di cosa è stato offerto, a chi, da chi e perché). Il prezzo è quello dell'offerta, letto
-- dal server al momento del pagamento: il browser non lo decide.
--
-- Nell'acquisto del pacchetto (omnia_ai_pacchetti_acquisti, 0104) si ricorda da quale offerta viene (offerta_id, vuoto per i pacchetti dell'elenco).
--
-- PERMESSI. Le legge e le scrive solo il server (chiave di servizio): nessun permesso ai ruoli utente. Additiva e idempotente; richiede la 0104.
-- Prima di questa migrazione il codice non offre e non conta offerte dedicate (tutto il resto funziona come prima).

create table if not exists public.omnia_ai_pacchetti_offerte (
  id uuid primary key default gen_random_uuid(),
  -- il titolare a cui è riservata
  user_id uuid not null references public.users (id) on delete cascade,
  servizio text not null check (servizio in ('piano_lavoro', 'food_menu')),
  quantita integer not null check (quantita between 1 and 10000),
  -- prezzo totale dell'offerta (IVA inclusa)
  prezzo_centesimi integer not null check (prezzo_centesimi > 0),
  -- ultimo giorno in cui si può comprare (vuoto = senza scadenza)
  scade_il date,
  -- nota interna della console (mai mostrata al cliente)
  nota text,
  stato text not null default 'attiva' check (stato in ('attiva', 'acquistata', 'revocata')),
  creata_il timestamptz not null default now(),
  creata_da_email text not null,
  -- quando e da chi si è chiusa (revocata dalla console, oppure acquistata: in quel caso chiusa_da_email resta vuota)
  chiusa_il timestamptz,
  chiusa_da_email text,
  -- l'acquisto che l'ha chiusa
  acquisto_id uuid references public.omnia_ai_pacchetti_acquisti (id) on delete set null
);

create index if not exists omnia_ai_pacchetti_offerte_utente_idx
  on public.omnia_ai_pacchetti_offerte (user_id, stato);

alter table public.omnia_ai_pacchetti_offerte enable row level security;

-- niente delete: la storia delle offerte resta
grant select, insert, update on public.omnia_ai_pacchetti_offerte to service_role;

-- Da quale offerta dedicata viene un acquisto (vuoto per i pacchetti dell'elenco).
alter table public.omnia_ai_pacchetti_acquisti
  add column if not exists offerta_id uuid references public.omnia_ai_pacchetti_offerte (id) on delete set null;

create index if not exists omnia_ai_pacchetti_acquisti_offerta_idx
  on public.omnia_ai_pacchetti_acquisti (offerta_id)
  where offerta_id is not null;

notify pgrst, 'reload schema';
