-- Copertina della relazione tecnica in vendita come il piano di lavoro (richiesta dell'utente, 17/11/2026): prezzo per gara uguale per tutti
-- (50 € di partenza, dalla console), pacchetti prepagati (5 gare a 175 € di partenza), offerte dedicate a un cliente e concessioni gratuite.
--
-- 1) PACCHETTI E OFFERTE DEDICATE: le tabelle delle migrazioni 0104 e 0105 accettano anche il servizio «copertina». Un'unità = la copertina di
--    UNA gara (fino a 3 generazioni per stile, come l'acquisto singolo); la gara la consuma alla sua prima copertina.
-- 2) CONCESSIONI GRATUITE della copertina (omnia_ai_copertina_concessioni): stessa forma di quelle del piano di lavoro (0101): per tutte le gare
--    (numero massimo e scadenza facoltativi) oppure per una gara; si revocano, non si cancellano.
-- 3) REGISTRO DELLE GENERAZIONI (gara_copertine, 0106): due nuove fonti del diritto, «concessione» e «pacchetto», più «prova» (account in prova
--    con la regola «incluso gratis» della console), e la concessione che ha reso possibile la generazione.
--
-- PERMESSI. Tutto lato server (chiave di servizio), come le tabelle che estende: nessun permesso ai ruoli utente.
-- Additiva e idempotente; richiede 0104, 0105 e 0106. Si può eseguire prima o dopo il deploy: senza, il codice nuovo non offre pacchetti né
-- concessioni della copertina (tutto il resto funziona come prima).

-- ───── 1) il servizio «copertina» nei pacchetti e nelle offerte dedicate ─────
-- I vincoli sul servizio sono stati scritti accanto alla colonna (nome scelto da Postgres): si tolgono quelli che parlano di «servizio» e si
-- rimettono con il nuovo elenco.
do $$
declare
  t text;
  c record;
begin
  foreach t in array array['omnia_ai_pacchetti_acquisti', 'omnia_ai_pacchetti_saldi', 'omnia_ai_pacchetti_consumi', 'omnia_ai_pacchetti_movimenti', 'omnia_ai_pacchetti_offerte'] loop
    for c in
      select conname from pg_constraint
      where conrelid = ('public.' || t)::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%servizio%'
    loop
      execute format('alter table public.%I drop constraint %I', t, c.conname);
    end loop;
    execute format('alter table public.%I add constraint %I check (servizio in (''piano_lavoro'', ''food_menu'', ''copertina''))', t, t || '_servizio_check');
  end loop;
end $$;

-- ───── 2) concessioni gratuite della copertina ─────
create table if not exists public.omnia_ai_copertina_concessioni (
  id uuid primary key default gen_random_uuid(),
  -- il titolare che riceve la concessione
  user_id uuid not null references public.users (id) on delete cascade,
  tipo text not null check (tipo in ('tutte', 'gara')),
  -- solo per tipo «gara»: la gara concessa (il titolo si copia, resta leggibile se la gara viene cancellata)
  gara_id uuid references public.gare (id) on delete set null,
  gara_titolo text,
  -- solo per tipo «tutte»: quante gare al massimo (vuoto = senza limite) e fino a quando vale (vuoto = senza scadenza)
  gare_massime integer check (gare_massime is null or gare_massime between 1 and 1000),
  scade_il date,
  motivo text not null check (char_length(btrim(motivo)) between 2 and 300),
  attiva boolean not null default true,
  creata_il timestamptz not null default now(),
  creata_da_email text not null,
  revocata_il timestamptz,
  revocata_da_email text,
  constraint omnia_ai_copertina_concessioni_forma check (
    (tipo = 'gara' and gare_massime is null and (gara_id is not null or gara_titolo is not null))
    or (tipo = 'tutte' and gara_id is null)
  )
);

create index if not exists omnia_ai_copertina_concessioni_utente_idx
  on public.omnia_ai_copertina_concessioni (user_id, attiva);

alter table public.omnia_ai_copertina_concessioni enable row level security;

-- niente delete: la storia delle concessioni resta
grant select, insert, update on public.omnia_ai_copertina_concessioni to service_role;

-- ───── 3) le nuove fonti nel registro delle generazioni ─────
-- come sopra: si tolgono i vincoli che parlano di «fonte» (qualunque nome abbiano) e si rimette quello con il nuovo elenco
do $$
declare
  c record;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'public.gara_copertine'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%fonte%'
  loop
    execute format('alter table public.gara_copertine drop constraint %I', c.conname);
  end loop;
end $$;
alter table public.gara_copertine
  add constraint gara_copertine_fonte_check check (fonte in ('gratis', 'pagamento', 'sviluppo', 'concessione', 'pacchetto', 'prova'));

-- Quale concessione ha reso possibile una generazione (vuoto per tutte le altre fonti).
alter table public.gara_copertine
  add column if not exists concessione_id uuid references public.omnia_ai_copertina_concessioni (id) on delete set null;

create index if not exists gara_copertine_concessione_idx
  on public.gara_copertine (concessione_id)
  where concessione_id is not null;

notify pgrst, 'reload schema';
