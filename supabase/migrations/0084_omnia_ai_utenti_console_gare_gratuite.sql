-- Utenti creati dalla console e gare gratuite di OMNIA AI.
--
-- 1) omnia_ai_utenti_console: un cliente creato a mano dalla console (con una password
--    iniziale scelta dall'amministratore). Tabella a parte e non colonne su public.users, di
--    proposito: public.users è leggibile dal cliente stesso e qui stanno dati di gestione
--    (chi l'ha creato, a che punto è la consegna della password) che non devono arrivargli.
--    Nessun permesso ai ruoli utente: la usa solo la console, con la chiave di servizio.
--    Le colonne password_* servono al reset/consegna della password (blocco successivo):
--      reset_richiesto_il        la console ha azzerato la password iniziale e inviato l'email
--      password_consegnata_il    il cliente ha scelto la SUA password: da qui la console non
--                                può più toccarla (il controllo è anche sul server)
--
-- 2) omnia_ai_gare_gratuite: le gare gratuite assegnate dalla console a un cliente che non ha
--    mai avuto un abbonamento. Un contatore per cliente (assegnate/usate) più un registro dei
--    movimenti (chi ha dato o tolto quante gare, quando, perché). Il cliente legge il proprio
--    contatore (serve all'area riservata); scrive solo la console o il server.
--
-- 3) gara_consumi.tipo: nuovo valore 'gratuita' per le gare consumate dal contatore gratuito
--    (accanto a 'piano' e 'credito'), così costi e consumi restano distinguibili.
--
-- Idempotente. Può essere eseguita prima o dopo il deploy: il codice nuovo, se le tabelle
-- mancano, si comporta come prima (un cliente senza abbonamento vede la pagina di attivazione).

-- ───── 3) tipo di consumo ─────

alter type public.gara_consumo_tipo add value if not exists 'gratuita';

-- ───── 1) utenti creati dalla console ─────

create table if not exists public.omnia_ai_utenti_console (
  user_id uuid primary key references public.users (id) on delete cascade,
  creato_il timestamptz not null default now(),
  -- chi l'ha creato: copia dell'email dell'amministratore (nessuna FK, sopravvive a tutto)
  creato_da_email text not null,
  reset_richiesto_il timestamptz,
  password_consegnata_il timestamptz
);

alter table public.omnia_ai_utenti_console enable row level security;
grant select, insert, update on public.omnia_ai_utenti_console to service_role;

-- ───── 2) gare gratuite ─────

create table if not exists public.omnia_ai_gare_gratuite (
  user_id uuid primary key references public.users (id) on delete cascade,
  assegnate integer not null default 0 check (assegnate between 0 and 1000),
  usate integer not null default 0 check (usate >= 0),
  aggiornato_il timestamptz not null default now(),
  -- non si possono avere usato più gare di quante assegnate
  constraint omnia_ai_gare_gratuite_usate_max check (usate <= assegnate)
);

alter table public.omnia_ai_gare_gratuite enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'omnia_ai_gare_gratuite' and policyname = 'omnia_ai_gare_gratuite_select_own'
  ) then
    create policy "omnia_ai_gare_gratuite_select_own" on public.omnia_ai_gare_gratuite
      for select using (user_id = auth.uid());
  end if;
end
$$;

grant select on public.omnia_ai_gare_gratuite to authenticated;
grant select, insert, update on public.omnia_ai_gare_gratuite to service_role;

-- registro dei movimenti: una riga per ogni assegnazione o rimozione fatta dalla console
create table if not exists public.omnia_ai_gare_gratuite_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  -- positivo = gare assegnate, negativo = gare tolte
  delta integer not null check (delta <> 0),
  motivo text,
  operatore_email text not null,
  created_at timestamptz not null default now()
);

create index if not exists omnia_ai_gare_gratuite_log_utente_idx on public.omnia_ai_gare_gratuite_log (user_id, created_at desc);

alter table public.omnia_ai_gare_gratuite_log enable row level security;
grant select, insert on public.omnia_ai_gare_gratuite_log to service_role;
