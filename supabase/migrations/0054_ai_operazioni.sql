-- Tappa 2 — Registrazione costi AI: una riga per ogni chiamata a un
-- modello (Anthropic o Voyage), con token consumati e costo stimato.
-- user_id/gara_id sono nullable: alcune chiamate (elaborazione della
-- knowledge base curata dall'admin — anonimizzazione, nota di stile,
-- struttura titoli, embedding) non appartengono a un cliente o a una
-- gara specifica.
--
-- Sola lettura per admin: serve alla console costi/ricavi futura (non
-- costruita in questa tappa), il cliente non vede questo dato — nessuna
-- policy select_own. Scrittura sempre via service_role (src/lib/ai-usage.ts
-- scrive subito dopo ogni chiamata al modello, lato server).
--
-- Idempotente: tabella/indice con IF NOT EXISTS, policy dentro DO block
-- che la crea solo se manca, nessun DROP.

create table if not exists public.ai_operazioni (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.users (id) on delete set null,
  gara_id uuid references public.gare (id) on delete set null,
  operazione text not null,
  provider text not null,
  model text not null,
  input_tokens integer,
  output_tokens integer,
  costo_stimato numeric(10, 4),
  created_at timestamptz not null default now()
);

alter table public.ai_operazioni enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'ai_operazioni' and policyname = 'ai_operazioni_select_admin'
  ) then
    create policy "ai_operazioni_select_admin" on public.ai_operazioni
      for select using (public.is_admin());
  end if;
end $$;

grant select, insert, update, delete on public.ai_operazioni to service_role;

create index if not exists ai_operazioni_gara_id_idx on public.ai_operazioni (gara_id);
create index if not exists ai_operazioni_created_at_idx on public.ai_operazioni (created_at);
