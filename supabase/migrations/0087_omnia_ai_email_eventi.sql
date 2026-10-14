-- Registro delle email automatiche di OMNIA AI legate agli eventi di Stripe (nuovo cliente, cambio
-- piano, acquisto crediti, disdetta, mancato pagamento verso l'ufficio; pagamento ricevuto,
-- disdetta confermata, cambio metodo di pagamento verso il cliente).
--
-- Serve a due cose:
--   1. NON mandare due volte la stessa email: Stripe può reinviare lo stesso evento, e un evento
--      può far scattare più email. Ogni email ha una «chiave» unica (per esempio l'id dell'evento
--      Stripe + chi la riceve): la si prenota inserendo la riga, e se esiste già non si rimanda.
--   2. NON perdere un'email se l'invio fallisce (servizio di posta fuori uso, chiave scaduta): la
--      riga resta «fallita» con il testo da rimandare, e il controllo giornaliero la ritenta. Il testo
--      si conserva SOLO finché l'email non è partita (può contenere dati del cliente): a invio
--      riuscito viene svuotato.
--
-- Una email partita non conserva né indirizzo, né oggetto, né testo: restano solo la chiave, il tipo,
-- lo stato, l'orario e il riferimento all'utente (che si azzera se l'utente viene cancellato).
-- Nessun permesso ai ruoli utente: scrive e legge solo il server (chiave di servizio). Idempotente.
-- Prima di questa migrazione le email partono comunque, solo senza la protezione contro i doppioni
-- e senza il nuovo tentativo.

create table if not exists public.omnia_ai_email_eventi (
  id uuid primary key default gen_random_uuid(),
  -- identifica UNA email: evento o oggetto Stripe + a chi va (es. «evt_123:ufficio:disdetta»)
  chiave text not null unique,
  tipo text not null check (
    tipo in (
      'nuovo_cliente',
      'cambio_piano',
      'acquisto_crediti',
      'disdetta',
      'mancato_pagamento',
      'pagamento_ricevuto',
      'disdetta_confermata',
      'metodo_pagamento_cambiato'
    )
  ),
  destinatario text not null check (destinatario in ('ufficio', 'cliente')),
  stato text not null default 'in_invio' check (stato in ('in_invio', 'inviata', 'fallita')),
  tentativi integer not null default 0 check (tentativi >= 0),
  ultimo_errore text,
  -- da rimandare: presenti solo finché lo stato non è «inviata»
  invia_a text,
  oggetto text,
  corpo_html text,
  evento_stripe_id text,
  -- false = evento dell'account Stripe di prova
  livemode boolean not null default true,
  user_id uuid references public.users (id) on delete set null,
  creata_il timestamptz not null default now(),
  inviata_il timestamptz
);

-- per il nuovo tentativo giornaliero: solo le email da rimandare
create index if not exists omnia_ai_email_eventi_da_rimandare_idx
  on public.omnia_ai_email_eventi (creata_il)
  where stato <> 'inviata';

alter table public.omnia_ai_email_eventi enable row level security;

-- niente delete: il registro non si cancella (l'utente cancellato azzera solo il riferimento)
grant select, insert, update on public.omnia_ai_email_eventi to service_role;
