-- Pacchetti prepagati dei servizi aggiuntivi di OMNIA AI (oggi: il piano di lavoro delle gare di pulizie; domani OMNIA FOOD MENU).
--
-- Il cliente compra un PACCHETTO di unità (per esempio 5 piani di lavoro a 300 €, IVA inclusa) e le consuma una per gara:
--   - NON scadono nel tempo come un abbonamento: si esauriscono man mano che si usano, anche in più mesi;
--   - se il cliente disdice (cessazione effettiva dell'abbonamento) le unità residue SI PERDONO, come i crediti aggiuntivi
--     (omnia_ai_pacchetto_estingui, chiamata dal webhook di cessazione e dal controllo giornaliero);
--   - una gara consuma UNA sola unità, anche se il piano viene generato due volte (la seconda solo con la proroga dei termini) o se la
--     generazione va ripetuta dopo un errore: il registro dei consumi ha una riga per gara e servizio (indice unico).
--
-- TABELLE
--   omnia_ai_pacchetti_acquisti   un acquisto di pacchetto, con prezzo e accettazione delle condizioni FISSATI al pagamento e lo stato di
--                                 fatturazione (stesse colonne del piano di lavoro singolo, 0097). Non si cancella con l'utente: è un pagamento ricevuto.
--   omnia_ai_pacchetti_saldi      le unità residue per cliente e servizio (mai negative).
--   omnia_ai_pacchetti_consumi    quale gara ha consumato un'unità (una riga per gara e servizio).
--   omnia_ai_pacchetti_movimenti  registro delle variazioni (acquisto, consumo, riaccredito dopo un errore, rettifica della console, estinzione).
--
-- FUNZIONI (solo chiave di servizio; ogni variazione del saldo è UNA transazione con la riga di registro)
--   omnia_ai_pacchetto_accredita   somma al saldo le unità di un acquisto PAGATO, una volta sola (idempotente: un evento Stripe rimandato non raddoppia).
--   omnia_ai_pacchetto_consuma     toglie un'unità per una gara: 'consumata' | 'gia_consumata' | 'saldo_insufficiente'. Mai due unità per la stessa gara,
--                                  nemmeno con richieste contemporanee.
--   omnia_ai_pacchetto_riaccredita rimette l'unità se la generazione appena iniziata non è riuscita.
--   omnia_ai_pacchetto_rettifica   aggiunta o correzione a mano dalla console (con motivo), il saldo non scende sotto zero.
--   omnia_ai_pacchetto_estingui    azzera tutti i saldi di un cliente alla cessazione.
--
-- PERMESSI. Scrive e legge tutto il server (chiave di servizio). Il titolare legge con la sua sessione solo i SUOI acquisti e solo le colonne che
-- gli servono per «Pagamenti e fatture». Idempotente; può essere eseguita prima o dopo il deploy (senza queste tabelle il codice nuovo non offre
-- né conteggia pacchetti e si comporta come prima).
--
-- Registro delle email automatiche (0087/0090/0097): due nuovi tipi, «pacchetto_acquistato» (all'ufficio) e «pacchetto_ricevuto» (conferma al
-- cliente). Avvisi dell'Ufficio Gare al titolare (0092): nuovo tipo «acquisto_pacchetto».

-- ───── acquisti ─────

create table if not exists public.omnia_ai_pacchetti_acquisti (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.users (id) on delete set null,
  servizio text not null check (servizio in ('piano_lavoro', 'food_menu')),
  -- quante unità contiene il pacchetto e il prezzo FISSATO al momento del pagamento (IVA inclusa)
  quantita integer not null check (quantita between 1 and 10000),
  prezzo_centesimi integer not null check (prezzo_centesimi > 0),

  -- accettazione: condizioni del pacchetto (versione e impronta) e avvertenze del servizio (per il piano di lavoro, le stesse del singolo)
  condizioni_versione integer not null,
  condizioni_hash text not null,
  servizio_condizioni_versione integer not null,
  servizio_condizioni_hash text not null,
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
  -- dati di fatturazione raccolti da Stripe, copia al momento del pagamento
  dati_stripe jsonb,
  -- quando le unità sono state aggiunte al saldo (vuoto = non ancora: il webhook, rimandato da Stripe, lo completa)
  accreditata_il timestamptz,

  -- stato di fatturazione, segnato dalla console (vale solo per le righe «pagata»)
  stato_fattura text not null default 'da_fatturare' check (stato_fattura in ('da_fatturare', 'fatturata', 'non_dovuta')),
  numero_fattura text,
  data_fattura date,
  note_fattura text,
  fatturazione_aggiornata_il timestamptz,
  fatturazione_aggiornata_da uuid,
  fattura_file_path text,
  fattura_caricata_il timestamptz,

  creata_il timestamptz not null default now()
);

create index if not exists omnia_ai_pacchetti_acquisti_stato_fattura_idx
  on public.omnia_ai_pacchetti_acquisti (stato_fattura)
  where stato = 'pagata';

create index if not exists omnia_ai_pacchetti_acquisti_utente_idx
  on public.omnia_ai_pacchetti_acquisti (user_id, creata_il desc);

alter table public.omnia_ai_pacchetti_acquisti enable row level security;

-- niente delete: è un pagamento ricevuto
grant select, insert, update on public.omnia_ai_pacchetti_acquisti to service_role;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'omnia_ai_pacchetti_acquisti' and policyname = 'omnia_ai_pacchetti_acquisti_select_own'
  ) then
    create policy "omnia_ai_pacchetti_acquisti_select_own" on public.omnia_ai_pacchetti_acquisti
      for select using (user_id = auth.uid());
  end if;
end
$$;

grant select (
  id, user_id, servizio, quantita, prezzo_centesimi, stato, pagata_il, importo_pagato_centesimi, livemode, creata_il,
  stato_fattura, numero_fattura, data_fattura, fattura_file_path
) on public.omnia_ai_pacchetti_acquisti to authenticated;

-- ───── saldi ─────

create table if not exists public.omnia_ai_pacchetti_saldi (
  user_id uuid not null references public.users (id) on delete cascade,
  servizio text not null check (servizio in ('piano_lavoro', 'food_menu')),
  saldo integer not null default 0 check (saldo >= 0),
  aggiornato_il timestamptz not null default now(),
  primary key (user_id, servizio)
);

alter table public.omnia_ai_pacchetti_saldi enable row level security;
grant select, insert, update on public.omnia_ai_pacchetti_saldi to service_role;

-- ───── consumi: una riga per gara e servizio ─────

create table if not exists public.omnia_ai_pacchetti_consumi (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  servizio text not null check (servizio in ('piano_lavoro', 'food_menu')),
  -- se la gara viene cancellata l'unità resta consumata (il cliente l'ha usata): il titolo si conserva
  gara_id uuid references public.gare (id) on delete set null,
  gara_titolo text,
  consumata_il timestamptz not null default now()
);

-- Una sola unità per gara e servizio, qualunque cosa succeda (richieste contemporanee, seconda generazione, ripetizione dopo un errore).
create unique index if not exists omnia_ai_pacchetti_consumi_gara_unico
  on public.omnia_ai_pacchetti_consumi (gara_id, servizio)
  where gara_id is not null;

create index if not exists omnia_ai_pacchetti_consumi_utente_idx
  on public.omnia_ai_pacchetti_consumi (user_id, servizio);

alter table public.omnia_ai_pacchetti_consumi enable row level security;
grant select, insert, update, delete on public.omnia_ai_pacchetti_consumi to service_role;

-- ───── registro dei movimenti ─────

create table if not exists public.omnia_ai_pacchetti_movimenti (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  servizio text not null check (servizio in ('piano_lavoro', 'food_menu')),
  tipo text not null check (tipo in ('acquisto', 'consumo', 'riaccredito', 'rettifica', 'estinzione')),
  -- variazione del saldo (positiva o negativa) e saldo dopo la variazione
  delta integer not null,
  saldo_dopo integer not null check (saldo_dopo >= 0),
  acquisto_id uuid references public.omnia_ai_pacchetti_acquisti (id) on delete set null,
  gara_id uuid references public.gare (id) on delete set null,
  gara_titolo text,
  -- per le rettifiche della console: perché e chi
  motivo text,
  eseguito_da text,
  creato_il timestamptz not null default now()
);

create index if not exists omnia_ai_pacchetti_movimenti_utente_idx
  on public.omnia_ai_pacchetti_movimenti (user_id, creato_il desc);

alter table public.omnia_ai_pacchetti_movimenti enable row level security;
grant select, insert on public.omnia_ai_pacchetti_movimenti to service_role;

-- ───── funzioni ─────

-- Aggiunge al saldo le unità di un acquisto pagato, UNA volta sola.
create or replace function public.omnia_ai_pacchetto_accredita(p_acquisto uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_acq public.omnia_ai_pacchetti_acquisti%rowtype;
  v_saldo integer;
begin
  select * into v_acq from public.omnia_ai_pacchetti_acquisti where id = p_acquisto for update;
  if not found then return 'non_trovato'; end if;
  if v_acq.stato <> 'pagata' then return 'non_pagata'; end if;
  if v_acq.accreditata_il is not null then return 'gia_accreditato'; end if;
  -- l'utente non c'è più (cancellato): il pagamento resta registrato, ma non c'è a chi accreditare
  if v_acq.user_id is null then return 'senza_utente'; end if;

  insert into public.omnia_ai_pacchetti_saldi as s (user_id, servizio, saldo, aggiornato_il)
  values (v_acq.user_id, v_acq.servizio, v_acq.quantita, now())
  on conflict (user_id, servizio) do update set saldo = s.saldo + excluded.saldo, aggiornato_il = now()
  returning s.saldo into v_saldo;

  insert into public.omnia_ai_pacchetti_movimenti (user_id, servizio, tipo, delta, saldo_dopo, acquisto_id)
  values (v_acq.user_id, v_acq.servizio, 'acquisto', v_acq.quantita, v_saldo, v_acq.id);

  update public.omnia_ai_pacchetti_acquisti set accreditata_il = now() where id = v_acq.id;
  return 'accreditato';
end;
$$;

-- Toglie un'unità per una gara. Mai due unità per la stessa gara.
create or replace function public.omnia_ai_pacchetto_consuma(p_user uuid, p_servizio text, p_gara uuid, p_gara_titolo text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_saldo integer;
  v_righe integer;
begin
  if exists (select 1 from public.omnia_ai_pacchetti_consumi where gara_id = p_gara and servizio = p_servizio) then
    return 'gia_consumata';
  end if;

  -- si blocca la riga del saldo: due gare che consumano insieme l'ultima unità vengono messe in fila
  select saldo into v_saldo from public.omnia_ai_pacchetti_saldi where user_id = p_user and servizio = p_servizio for update;
  if not found or v_saldo < 1 then return 'saldo_insufficiente'; end if;

  insert into public.omnia_ai_pacchetti_consumi (user_id, servizio, gara_id, gara_titolo)
  values (p_user, p_servizio, p_gara, p_gara_titolo)
  on conflict do nothing;
  get diagnostics v_righe = row_count;
  -- un'altra richiesta per la stessa gara ha vinto la corsa: l'unità è già stata tolta da lei
  if v_righe = 0 then return 'gia_consumata'; end if;

  update public.omnia_ai_pacchetti_saldi set saldo = saldo - 1, aggiornato_il = now()
  where user_id = p_user and servizio = p_servizio
  returning saldo into v_saldo;

  insert into public.omnia_ai_pacchetti_movimenti (user_id, servizio, tipo, delta, saldo_dopo, gara_id, gara_titolo)
  values (p_user, p_servizio, 'consumo', -1, v_saldo, p_gara, p_gara_titolo);
  return 'consumata';
end;
$$;

-- Rimette l'unità se la generazione non è riuscita (un errore del servizio non si conteggia).
create or replace function public.omnia_ai_pacchetto_riaccredita(p_user uuid, p_servizio text, p_gara uuid, p_motivo text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_saldo integer;
  v_titolo text;
  v_cancellate integer;
begin
  delete from public.omnia_ai_pacchetti_consumi
  where user_id = p_user and servizio = p_servizio and gara_id = p_gara
  returning gara_titolo into v_titolo;
  get diagnostics v_cancellate = row_count;
  if v_cancellate = 0 then return 'nessun_consumo'; end if;

  insert into public.omnia_ai_pacchetti_saldi as s (user_id, servizio, saldo, aggiornato_il)
  values (p_user, p_servizio, 1, now())
  on conflict (user_id, servizio) do update set saldo = s.saldo + 1, aggiornato_il = now()
  returning s.saldo into v_saldo;

  insert into public.omnia_ai_pacchetti_movimenti (user_id, servizio, tipo, delta, saldo_dopo, gara_id, gara_titolo, motivo)
  values (p_user, p_servizio, 'riaccredito', 1, v_saldo, p_gara, v_titolo, left(p_motivo, 300));
  return 'riaccreditata';
end;
$$;

-- Aggiunta o correzione a mano dalla console. Il saldo non scende sotto zero.
create or replace function public.omnia_ai_pacchetto_rettifica(p_user uuid, p_servizio text, p_delta integer, p_motivo text, p_da text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_attuale integer;
  v_nuovo integer;
begin
  if p_delta = 0 then raise exception 'variazione nulla'; end if;
  if char_length(btrim(coalesce(p_motivo, ''))) < 2 then raise exception 'motivo mancante'; end if;

  insert into public.omnia_ai_pacchetti_saldi (user_id, servizio, saldo) values (p_user, p_servizio, 0) on conflict do nothing;
  select saldo into v_attuale from public.omnia_ai_pacchetti_saldi where user_id = p_user and servizio = p_servizio for update;
  v_nuovo := v_attuale + p_delta;
  if v_nuovo < 0 then raise exception 'saldo insufficiente'; end if;

  update public.omnia_ai_pacchetti_saldi set saldo = v_nuovo, aggiornato_il = now() where user_id = p_user and servizio = p_servizio;
  insert into public.omnia_ai_pacchetti_movimenti (user_id, servizio, tipo, delta, saldo_dopo, motivo, eseguito_da)
  values (p_user, p_servizio, 'rettifica', p_delta, v_nuovo, left(p_motivo, 300), left(p_da, 200));
  return v_nuovo;
end;
$$;

-- Azzera i saldi di un cliente alla cessazione dell'abbonamento: restituisce quante unità si sono perse.
create or replace function public.omnia_ai_pacchetto_estingui(p_user uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  v_totale integer := 0;
begin
  for r in
    select servizio, saldo from public.omnia_ai_pacchetti_saldi where user_id = p_user and saldo > 0 for update
  loop
    update public.omnia_ai_pacchetti_saldi set saldo = 0, aggiornato_il = now() where user_id = p_user and servizio = r.servizio;
    insert into public.omnia_ai_pacchetti_movimenti (user_id, servizio, tipo, delta, saldo_dopo, motivo)
    values (p_user, r.servizio, 'estinzione', -r.saldo, 0, 'Cessazione dell''abbonamento');
    v_totale := v_totale + r.saldo;
  end loop;
  return v_totale;
end;
$$;

-- Le funzioni le chiama solo il server con la chiave di servizio.
revoke all on function public.omnia_ai_pacchetto_accredita(uuid) from public, anon, authenticated;
revoke all on function public.omnia_ai_pacchetto_consuma(uuid, text, uuid, text) from public, anon, authenticated;
revoke all on function public.omnia_ai_pacchetto_riaccredita(uuid, text, uuid, text) from public, anon, authenticated;
revoke all on function public.omnia_ai_pacchetto_rettifica(uuid, text, integer, text, text) from public, anon, authenticated;
revoke all on function public.omnia_ai_pacchetto_estingui(uuid) from public, anon, authenticated;
grant execute on function public.omnia_ai_pacchetto_accredita(uuid) to service_role;
grant execute on function public.omnia_ai_pacchetto_consuma(uuid, text, uuid, text) to service_role;
grant execute on function public.omnia_ai_pacchetto_riaccredita(uuid, text, uuid, text) to service_role;
grant execute on function public.omnia_ai_pacchetto_rettifica(uuid, text, integer, text, text) to service_role;
grant execute on function public.omnia_ai_pacchetto_estingui(uuid) to service_role;

-- ───── registro delle email automatiche e avvisi dell'Ufficio Gare ─────

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
      'piano_lavoro_ricevuto',
      'pacchetto_acquistato',
      'pacchetto_ricevuto'
    )
  );

-- L'avviso dell'Ufficio Gare al titolare per l'acquisto di un pacchetto: una al giorno per servizio e pacchetto (la chiave è «servizio:quantità»).
do $$
declare
  v_vincolo text;
begin
  for v_vincolo in
    select c.conname
    from pg_constraint c
    where c.conrelid = 'public.omnia_ai_membri_avvisi'::regclass
      and c.contype = 'c'
      and pg_get_constraintdef(c.oid) ilike '%tipo%'
  loop
    execute format('alter table public.omnia_ai_membri_avvisi drop constraint %I', v_vincolo);
  end loop;
exception
  when undefined_table then null;
end
$$;

do $$
begin
  alter table public.omnia_ai_membri_avvisi
    add constraint omnia_ai_membri_avvisi_tipo_check check (tipo in ('quota_esaurita', 'revisione_richiesta', 'acquisto_pacchetto'));
exception
  when undefined_table then null;
  when duplicate_object then null;
end
$$;

notify pgrst, 'reload schema';
