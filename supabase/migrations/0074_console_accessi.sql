-- Registro degli accessi alla console amministrativa (console.omniaitalia.com).
--
-- Serve a due cose: limitare le richieste di link di accesso (una al minuto
-- per email, poche per IP) e lasciare una traccia di chi ha provato a entrare
-- e con quale esito, visibile nella Panoramica della console.
--
-- Ogni riga è un evento:
--   link_inviato     richiesta di un admin, link spedito
--   link_negato      email che non è di un admin: nessuna email partita
--   link_limitato    richiesta scartata dal limite di frequenza
--   link_errore      admin riconosciuto ma link o email non generati
--   accesso          link usato, sessione admin aperta
--   accesso_rifiutato link scaduto/già usato, oppure utente non admin
--
-- La tabella non ha policy: la RLS è attiva e nessun ruolo utente può leggerla
-- né scriverla; la usa solo il codice server con la service role (grant sotto).
-- Il codice funziona anche prima di questa migrazione: senza la tabella il
-- registro e il limite di frequenza vengono saltati e l'accesso resta possibile.
--
-- Idempotente: sicura da rieseguire.

create table if not exists public.console_accessi (
  id uuid primary key default gen_random_uuid(),
  evento text not null check (
    evento in ('link_inviato', 'link_negato', 'link_limitato', 'link_errore', 'accesso', 'accesso_rifiutato')
  ),
  -- email digitata o dell'utente, in minuscolo
  email text,
  -- se l'evento riguarda un utente esistente; resta se l'utente viene eliminato
  user_id uuid references public.users (id) on delete set null,
  ip text,
  user_agent text,
  created_at timestamptz not null default now()
);

create index if not exists console_accessi_creato_idx on public.console_accessi (created_at desc);
create index if not exists console_accessi_email_idx on public.console_accessi (email, created_at desc);
create index if not exists console_accessi_ip_idx on public.console_accessi (ip, created_at desc);

alter table public.console_accessi enable row level security;

grant select, insert, delete on public.console_accessi to service_role;
