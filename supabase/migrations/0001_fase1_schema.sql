-- Fase 1 — fondamenta comuni
-- Tabelle base: users (profilo+ruolo), companies, products, orders,
-- subscriptions, credits. Tutte con RLS attiva.

-- estensione per gen_random_uuid()
create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------
-- users (profilo collegato 1:1 ad auth.users, con ruolo)
-- ---------------------------------------------------------------------
create type public.user_role as enum ('cliente', 'admin');

create table public.users (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  role public.user_role not null default 'cliente',
  created_at timestamptz not null default now()
);

-- crea automaticamente la riga di profilo quando un utente si registra
create function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.users (id, email)
  values (new.id, new.email);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- helper per le policy: bypassa la RLS di users per evitare ricorsione
-- quando si verifica se l'utente corrente è admin
create function public.is_admin()
returns boolean
language sql
security definer set search_path = public
stable
as $$
  select exists (
    select 1 from public.users where id = auth.uid() and role = 'admin'
  );
$$;

alter table public.users enable row level security;

create policy "users_select_own" on public.users
  for select using (auth.uid() = id);

create policy "users_select_admin" on public.users
  for select using (public.is_admin());

create policy "users_update_own" on public.users
  for update using (auth.uid() = id);

-- ---------------------------------------------------------------------
-- companies (dati azienda cliente, servirà a OMNIA AI)
-- ---------------------------------------------------------------------
create table public.companies (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  ragione_sociale text,
  partita_iva text,
  codice_fiscale text,
  indirizzo text,
  created_at timestamptz not null default now()
);

alter table public.companies enable row level security;

create policy "companies_all_own" on public.companies
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "companies_select_admin" on public.companies
  for select using (public.is_admin());

-- ---------------------------------------------------------------------
-- products (catalogo documenti, si popola in Fase 2A)
-- ---------------------------------------------------------------------
create table public.products (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  price numeric(10, 2) not null,
  category text,
  file_path text,
  created_at timestamptz not null default now()
);

alter table public.products enable row level security;

create policy "products_select_all" on public.products
  for select using (true);

create policy "products_write_admin" on public.products
  for all using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------------
-- orders (ordini e-commerce)
-- ---------------------------------------------------------------------
create type public.order_status as enum ('in_attesa', 'pagato', 'bonifico_in_attesa');
create type public.payment_method as enum ('carta', 'bonifico');

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  status public.order_status not null default 'in_attesa',
  payment_method public.payment_method,
  total_amount numeric(10, 2) not null,
  stripe_session_id text,
  created_at timestamptz not null default now()
);

alter table public.orders enable row level security;

create policy "orders_select_own" on public.orders
  for select using (auth.uid() = user_id);

create policy "orders_select_admin" on public.orders
  for select using (public.is_admin());

create policy "orders_update_admin" on public.orders
  for update using (public.is_admin());

-- ---------------------------------------------------------------------
-- subscriptions (abbonamento OMNIA AI, si popola in Fase 2B)
-- ---------------------------------------------------------------------
create type public.subscription_status as enum ('attivo', 'scaduto', 'annullato');

create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  plan text not null,
  status public.subscription_status not null default 'attivo',
  stripe_subscription_id text,
  current_period_end timestamptz,
  created_at timestamptz not null default now()
);

alter table public.subscriptions enable row level security;

create policy "subscriptions_select_own" on public.subscriptions
  for select using (auth.uid() = user_id);

create policy "subscriptions_select_admin" on public.subscriptions
  for select using (public.is_admin());

-- ---------------------------------------------------------------------
-- credits (saldo crediti OMNIA AI, si popola in Fase 2B)
-- ---------------------------------------------------------------------
create table public.credits (
  user_id uuid primary key references public.users (id) on delete cascade,
  balance integer not null default 0,
  updated_at timestamptz not null default now()
);

alter table public.credits enable row level security;

create policy "credits_select_own" on public.credits
  for select using (auth.uid() = user_id);

create policy "credits_select_admin" on public.credits
  for select using (public.is_admin());

-- ---------------------------------------------------------------------
-- backfill: utenti già registrati prima di questa migrazione (es. gli
-- account di test creati durante lo sviluppo della Fase 1) non hanno
-- ancora una riga in public.users, perché il trigger sopra scatta solo
-- sui nuovi inserimenti in auth.users
-- ---------------------------------------------------------------------
insert into public.users (id, email)
select id, email from auth.users
on conflict (id) do nothing;
