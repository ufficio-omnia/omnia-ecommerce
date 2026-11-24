-- 0122 — Tender Intelligence, fase B4 (grado 1): profilo di ricerca dell'impresa per «Per te» e utilizzo «per_te».
-- BOZZA (B2, 26B, 19/11/2026): non applicata. Sullo staging solo con l'approvazione dell'utente e un'autorizzazione «migrazione»;
-- in produzione solo con un'autorizzazione separata. Additiva e idempotente. Richiede 0092 e 0111.
-- Un profilo nella prima versione (decisione 19/11), schema pronto per 5 (posizione 1–5). L'impresa è il TITOLARE; la chiave esterna punta
-- a omnia_ai_radar_impostazioni: un profilo esiste solo per un account con il Radar dato dalla console, e si legge insieme alle impostazioni.
-- Lettura: titolare e Ufficio Gare attivo. Scrittura: SOLO dal server dopo la guardia del titolare (modifica riservata al titolare).

create or replace function public.radar_profilo_sottocategorie_valide(s jsonb, settori text[])
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case
    when s is null or settori is null or jsonb_typeof(s) <> 'object' then false
    when octet_length(s::text) > 4000 then false
    else not exists (
      select 1
        from jsonb_each(s) as e (chiave, valori)
       where not (e.chiave = any (settori))
          or case
               when jsonb_typeof(e.valori) <> 'array' then true
               when jsonb_array_length(e.valori) > 30 then true
               else exists (
                 select 1 from jsonb_array_elements(e.valori) as x (v)
                  where jsonb_typeof(x.v) <> 'string' or (x.v #>> '{}') !~ '^[a-z0-9_]{2,60}$')
             end)
  end;
$$;
revoke all on function public.radar_profilo_sottocategorie_valide(jsonb, text[]) from public, anon, authenticated;
grant execute on function public.radar_profilo_sottocategorie_valide(jsonb, text[]) to service_role;

create table if not exists public.omnia_ai_radar_profili (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.omnia_ai_radar_impostazioni (user_id) on delete cascade,
  posizione smallint not null default 1 check (posizione between 1 and 5),
  nome text not null default 'Profilo principale' check (char_length(btrim(nome)) between 1 and 80 and nome !~ '[[:cntrl:]]'),
  settori text[] not null default '{}' check (
    cardinality(settori) <= 6 and array_position(settori, null) is null
    and settori <@ array['pulizia', 'ristorazione', 'vigilanza_portierato', 'facchinaggio', 'multiservizi', 'ausiliariato']::text[]),
  sottocategorie jsonb not null default '{}'::jsonb,
  regioni text[] not null default '{}' check (
    cardinality(regioni) <= 25 and array_position(regioni, null) is null
    and array_to_string(regioni, ',') ~ '^([a-z_]{3,40}(,[a-z_]{3,40})*)?$'),
  tipi_procedura text[] not null default '{}' check (
    cardinality(tipi_procedura) <= 10 and array_position(tipi_procedura, null) is null
    and array_to_string(tipi_procedura, ',') ~ '^([a-z_]{2,40}(,[a-z_]{2,40})*)?$'),
  importo_min numeric(16, 2) check (importo_min is null or importo_min >= 0),
  importo_max numeric(16, 2) check (importo_max is null or importo_max >= 0),
  vedere_correlate boolean not null default false,
  creato_il timestamptz not null default now(),
  aggiornato_il timestamptz not null default now(),
  aggiornato_da uuid,                          -- audit, SENZA chiave esterna
  constraint omnia_ai_radar_profili_importi check (importo_min is null or importo_max is null or importo_min <= importo_max),
  constraint omnia_ai_radar_profili_sottocategorie check (public.radar_profilo_sottocategorie_valide(sottocategorie, settori)),
  constraint omnia_ai_radar_profili_posizione_unica unique (user_id, posizione)
);

alter table public.omnia_ai_radar_profili enable row level security;
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'omnia_ai_radar_profili' and policyname = 'omnia_ai_radar_profili_select_account') then
    create policy "omnia_ai_radar_profili_select_account" on public.omnia_ai_radar_profili
      for select to authenticated using ((select public.omnia_ai_titolare_effettivo()) = user_id);
  end if;
end $$;
revoke all on public.omnia_ai_radar_profili from public, anon, authenticated, service_role;
grant select on public.omnia_ai_radar_profili to authenticated;
grant select, insert, update, delete on public.omnia_ai_radar_profili to service_role;

-- «Per te» si registra come statistica e NON conta nel limite delle ricerche (decisione del 19/11)
alter table public.omnia_ai_radar_utilizzi drop constraint if exists omnia_ai_radar_utilizzi_azione_check;
alter table public.omnia_ai_radar_utilizzi add constraint omnia_ai_radar_utilizzi_azione_check
  check (azione in ('ricerca', 'sintesi', 'analisi_requisiti', 'intelligence', 'crea_offerta', 'aggiungi_manuale', 'monitora', 'per_te'));

notify pgrst, 'reload schema';
