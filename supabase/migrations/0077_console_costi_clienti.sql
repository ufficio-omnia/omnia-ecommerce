-- Console: costo dei modelli per cliente contro quanto il cliente paga.
--
-- 1) console_impostazioni: parametri di calcolo modificabili dalla console
--    (cambio USD→EUR, aliquota IVA). ai_operazioni.costo_stimato è in DOLLARI e
--    i ricavi in euro: il cambio non si può dedurre dai dati, lo decide l'admin.
--    L'aliquota serve a togliere l'IVA dai ricavi (i prezzi sono IVA inclusa)
--    prima di calcolare il margine. Nessuna chiave esterna su aggiornato_da (vedi 0076).
--    Nessuna policy: la RLS è attiva e la tabella la usa solo il codice server con
--    la service role.
--
-- 2) Funzioni di aggregazione, eseguibili SOLO dalla service role: le somme si
--    fanno nel database, non scaricando migliaia di righe di ai_operazioni.
--    Le operazioni di prova degli script (operazione che comincia per "prova:" o
--    "prova-leggero:", vedi src/lib/anthropic.ts) sono separate dalle altre e non
--    entrano nei costi dei clienti. Le operazioni senza user_id si dividono in
--    "piattaforma" (kb_*: la knowledge base curata dall'admin) e "non_attribuito"
--    (cliente eliminato: user_id va a null con l'utente).
--
-- Idempotente: tabella e riga iniziale con IF NOT EXISTS / ON CONFLICT, funzioni
-- con CREATE OR REPLACE. Il codice funziona anche prima di questa migrazione: la
-- pagina Costi avvisa che mancano le funzioni.

create table if not exists public.console_impostazioni (
  chiave text primary key,
  valore text not null,
  aggiornato_il timestamptz not null default now(),
  aggiornato_da uuid
);

alter table public.console_impostazioni enable row level security;

grant select, insert, update on public.console_impostazioni to service_role;

-- L'IVA ordinaria italiana. Il cambio NON ha un valore iniziale: finché l'admin
-- non lo imposta, la console mostra i costi in dollari e non calcola il margine.
insert into public.console_impostazioni (chiave, valore)
values ('aliquota_iva', '22')
on conflict (chiave) do nothing;

-- Costi per cliente nel periodo [p_da, p_a). Una riga per cliente, più una per
-- ciascuna categoria di costo non attribuibile a un cliente.
create or replace function public.console_costi_per_cliente(p_da timestamptz, p_a timestamptz)
returns table (
  user_id uuid,
  categoria text,
  operazioni bigint,
  operazioni_senza_costo bigint,
  costo_usd numeric,
  input_token bigint,
  output_token bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  with base as (
    select
      o.user_id,
      o.operazione,
      o.costo_stimato,
      o.input_tokens,
      o.output_tokens,
      (starts_with(o.operazione, 'prova:') or starts_with(o.operazione, 'prova-leggero:')) as e_prova
    from public.ai_operazioni o
    where o.created_at >= p_da and o.created_at < p_a
  )
  select
    case when b.e_prova then null else b.user_id end,
    case
      when b.e_prova then 'prova'
      when b.user_id is not null then 'cliente'
      when starts_with(b.operazione, 'kb_') then 'piattaforma'
      else 'non_attribuito'
    end,
    count(*)::bigint,
    (count(*) filter (where b.costo_stimato is null))::bigint,
    coalesce(sum(b.costo_stimato), 0),
    coalesce(sum(b.input_tokens), 0)::bigint,
    coalesce(sum(b.output_tokens), 0)::bigint
  from base b
  group by 1, 2
$$;

-- Dettaglio dei costi di un cliente per tipo di operazione e modello. Con
-- p_user nullo: le operazioni senza cliente (piattaforma e non attribuite).
create or replace function public.console_costi_per_operazione(p_da timestamptz, p_a timestamptz, p_user uuid)
returns table (
  operazione text,
  provider text,
  model text,
  chiamate bigint,
  senza_costo bigint,
  input_token bigint,
  output_token bigint,
  costo_usd numeric
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    o.operazione,
    o.provider,
    o.model,
    count(*)::bigint,
    (count(*) filter (where o.costo_stimato is null))::bigint,
    coalesce(sum(o.input_tokens), 0)::bigint,
    coalesce(sum(o.output_tokens), 0)::bigint,
    coalesce(sum(o.costo_stimato), 0)
  from public.ai_operazioni o
  where o.created_at >= p_da and o.created_at < p_a
    and not starts_with(o.operazione, 'prova:')
    and not starts_with(o.operazione, 'prova-leggero:')
    and ((p_user is null and o.user_id is null) or o.user_id = p_user)
  group by o.operazione, o.provider, o.model
  order by coalesce(sum(o.costo_stimato), 0) desc, count(*) desc
$$;

-- Gare consumate per cliente nel periodo, divise tra quelle incluse nel piano e
-- quelle pagate con crediti (gara_consumi: una riga per gara analizzata, resta
-- anche se la gara viene poi cancellata).
create or replace function public.console_gare_consumate(p_da timestamptz, p_a timestamptz)
returns table (
  user_id uuid,
  gare_piano bigint,
  gare_credito bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    c.user_id,
    (count(*) filter (where c.tipo = 'piano'))::bigint,
    (count(*) filter (where c.tipo = 'credito'))::bigint
  from public.gara_consumi c
  where c.created_at >= p_da and c.created_at < p_a
  group by c.user_id
$$;

-- Modelli effettivamente usati nel periodo e quante operazioni sono rimaste
-- senza costo (modello senza tariffa in src/lib/ai-pricing.ts). Serve a
-- controllare che le tariffe coprano tutto: il margine vale quanto le tariffe.
create or replace function public.console_modelli_in_uso(p_da timestamptz, p_a timestamptz)
returns table (
  provider text,
  model text,
  operazioni bigint,
  operazioni_senza_costo bigint,
  costo_usd numeric
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    o.provider,
    o.model,
    count(*)::bigint,
    (count(*) filter (where o.costo_stimato is null))::bigint,
    coalesce(sum(o.costo_stimato), 0)
  from public.ai_operazioni o
  where o.created_at >= p_da and o.created_at < p_a
  group by o.provider, o.model
  order by coalesce(sum(o.costo_stimato), 0) desc
$$;

-- Solo la service role: né anon né gli utenti loggati. (Le funzioni sono già
-- limitate dalla RLS e dai grant delle tabelle, ma qui lo si dice esplicitamente.)
revoke all on function public.console_costi_per_cliente(timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function public.console_costi_per_operazione(timestamptz, timestamptz, uuid) from public, anon, authenticated;
revoke all on function public.console_gare_consumate(timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function public.console_modelli_in_uso(timestamptz, timestamptz) from public, anon, authenticated;

grant execute on function public.console_costi_per_cliente(timestamptz, timestamptz) to service_role;
grant execute on function public.console_costi_per_operazione(timestamptz, timestamptz, uuid) to service_role;
grant execute on function public.console_gare_consumate(timestamptz, timestamptz) to service_role;
grant execute on function public.console_modelli_in_uso(timestamptz, timestamptz) to service_role;

notify pgrst, 'reload schema';
