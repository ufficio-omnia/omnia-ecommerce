-- Fase 2B.5 — la Relazione Tecnica generata dall'AI deve essere un
-- documento unico per gara (un solo titolo, un solo indice), non un file
-- separato per ogni criterio elaborato. Ogni criterio/sezione elaborato
-- in chat viene salvato come sezione della stessa relazione; il
-- documento Word viene rigenerato per intero da tutte le sezioni ad ogni
-- aggiunta/modifica.

alter table public.gare
  add column relazione_titolo text,
  add column relazione_font text,
  add column relazione_dimensione_carattere numeric,
  add column relazione_interlinea numeric;

create table public.gara_relazione_sezioni (
  id uuid primary key default gen_random_uuid(),
  gara_id uuid not null references public.gare (id) on delete cascade,
  user_id uuid not null references public.users (id) on delete cascade,
  titolo_sezione text not null,
  contenuto text not null,
  ordine integer not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.gara_relazione_sezioni enable row level security;

create policy "gara_relazione_sezioni_all_own" on public.gara_relazione_sezioni
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "gara_relazione_sezioni_select_admin" on public.gara_relazione_sezioni
  for select using (public.is_admin());

grant select, insert, update, delete on public.gara_relazione_sezioni to authenticated;
grant select, insert, update, delete on public.gara_relazione_sezioni to service_role;
