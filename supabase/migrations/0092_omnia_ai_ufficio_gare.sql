-- Ufficio Gare: un utente secondario per azienda, che lavora SOLO sulle gare del titolare.
--
-- Il modello di OMNIA AI è "un utente = un account = un'azienda": gare, abbonamento, crediti, profilo
-- azienda e fatture hanno come proprietario un solo user_id. Qui si aggiunge, senza cambiare nulla per i
-- clienti di oggi, un secondo utente (l'«Ufficio Gare») collegato al titolare. Per i dati di lavoro
-- (gare, documenti, chat, relazione) l'Ufficio Gare agisce SUL conto del titolare; tutto il resto
-- (abbonamento, pagamenti, fatture, profilo azienda, documenti, impostazioni) resta del solo titolare.
--
-- 1) omnia_ai_membri: il legame membro → titolare. Un solo Ufficio Gare per titolare (indice unico);
--    nessuna catena (un titolare non può essere membro di un altro, e viceversa: trigger).
-- 2) omnia_ai_titolare_effettivo(): per chi è un membro attivo restituisce il titolare, per tutti gli
--    altri restituisce l'utente stesso. Per un cliente normale il risultato è IDENTICO a auth.uid():
--    le regole di accesso cambiano solo per chi ha una riga in omnia_ai_membri.
-- 3) Le regole di accesso (RLS) passano da auth.uid() alla funzione SOLO sulle tabelle del lavoro di gara:
--    gare, gara_documenti, gara_documenti_chunks, gara_messaggi, gara_messaggio_allegati,
--    gara_relazione_sezioni (lettura e scrittura) e gara_consumi (sola lettura). Le tabelle
--    amministrative (subscriptions, credits, companies, invoices, pagamenti, accettazioni legali...)
--    NON si toccano: restano leggibili solo dal titolare, anche chiamando direttamente le API.
--    Ogni nuova regola si crea PRIMA e la vecchia si toglie DOPO: nessun momento senza regola.
-- 4) match_gara_chunks (ricerca nei documenti per la chat) usa la stessa funzione.
-- 5) omnia_ai_membri_avvisi: un avviso al titolare (gare finite, richiesta di revisione) si registra
--    con una chiave unica per giorno: al massimo uno al giorno, deciso dal database, non dal codice.
--
-- Idempotente: si può rieseguire. Si può eseguire PRIMA del deploy del codice: finché non esiste una
-- riga in omnia_ai_membri nulla cambia per nessuno.

-- ───── 1) il legame membro → titolare ─────

create table if not exists public.omnia_ai_membri (
  membro_id uuid primary key references public.users (id) on delete cascade,
  titolare_id uuid not null references public.users (id) on delete cascade,
  ruolo text not null default 'ufficio_gare' check (ruolo in ('ufficio_gare')),
  -- sospeso = false: l'utente non entra più nei dati del titolare (e il codice gli mostra «accesso sospeso»)
  attivo boolean not null default true,
  creato_il timestamptz not null default now(),
  -- l'ultima volta che il titolare ha fatto partire (o rinviato) l'email con il link per scegliere la password
  invito_inviato_il timestamptz not null default now(),
  -- il titolare conferma, alla creazione, che la persona è autorizzata a trattare i dati della sua azienda
  consenso_titolare_il timestamptz not null default now(),
  consenso_ip text,
  consenso_user_agent text,
  constraint omnia_ai_membri_diversi check (membro_id <> titolare_id)
);

-- un solo utente per ruolo e per titolare (oggi: un solo Ufficio Gare)
create unique index if not exists omnia_ai_membri_un_ruolo_per_titolare on public.omnia_ai_membri (titolare_id, ruolo);
create index if not exists omnia_ai_membri_titolare_idx on public.omnia_ai_membri (titolare_id);

-- Niente catene: chi è membro non può essere titolare e viceversa. Il codice lo controlla già, qui è la rete di sicurezza.
create or replace function public.omnia_ai_membri_no_catene()
returns trigger
language plpgsql
as $$
begin
  if exists (select 1 from public.omnia_ai_membri m where m.membro_id = new.titolare_id and m.membro_id is distinct from new.membro_id) then
    raise exception 'Il titolare % è già membro di un altro account', new.titolare_id using errcode = '23514';
  end if;
  if exists (select 1 from public.omnia_ai_membri m where m.titolare_id = new.membro_id and m.membro_id is distinct from new.membro_id) then
    raise exception 'L''utente % è già titolare di un account con membri', new.membro_id using errcode = '23514';
  end if;
  return new;
end
$$;

drop trigger if exists omnia_ai_membri_no_catene on public.omnia_ai_membri;
create trigger omnia_ai_membri_no_catene
  before insert or update of membro_id, titolare_id on public.omnia_ai_membri
  for each row execute function public.omnia_ai_membri_no_catene();

alter table public.omnia_ai_membri enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'omnia_ai_membri' and policyname = 'omnia_ai_membri_select_own'
  ) then
    -- il membro legge la propria riga, il titolare quella del proprio membro: nessuno scrive da qui
    create policy "omnia_ai_membri_select_own" on public.omnia_ai_membri
      for select using (membro_id = auth.uid() or titolare_id = auth.uid());
  end if;
end
$$;

grant select on public.omnia_ai_membri to authenticated;
grant select, insert, update, delete on public.omnia_ai_membri to service_role;

-- ───── 2) il titolare effettivo ─────

create or replace function public.omnia_ai_titolare_effettivo()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select m.titolare_id from public.omnia_ai_membri m where m.membro_id = auth.uid() and m.attivo),
    auth.uid()
  );
$$;

revoke all on function public.omnia_ai_titolare_effettivo() from public;
grant execute on function public.omnia_ai_titolare_effettivo() to authenticated, service_role;

-- ───── 3) regole di accesso alle sole tabelle del lavoro di gara ─────
-- (select public.omnia_ai_titolare_effettivo()) fra parentesi: il database lo calcola una volta per
-- interrogazione, non per ogni riga.

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'gare' and policyname = 'gare_all_account') then
    create policy "gare_all_account" on public.gare
      for all using ((select public.omnia_ai_titolare_effettivo()) = user_id)
      with check ((select public.omnia_ai_titolare_effettivo()) = user_id);
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'gara_documenti' and policyname = 'gara_documenti_all_account') then
    create policy "gara_documenti_all_account" on public.gara_documenti
      for all using ((select public.omnia_ai_titolare_effettivo()) = user_id)
      with check ((select public.omnia_ai_titolare_effettivo()) = user_id);
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'gara_documenti_chunks' and policyname = 'gara_documenti_chunks_all_account') then
    create policy "gara_documenti_chunks_all_account" on public.gara_documenti_chunks
      for all using ((select public.omnia_ai_titolare_effettivo()) = user_id)
      with check ((select public.omnia_ai_titolare_effettivo()) = user_id);
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'gara_messaggi' and policyname = 'gara_messaggi_all_account') then
    create policy "gara_messaggi_all_account" on public.gara_messaggi
      for all using ((select public.omnia_ai_titolare_effettivo()) = user_id)
      with check ((select public.omnia_ai_titolare_effettivo()) = user_id);
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'gara_messaggio_allegati' and policyname = 'gara_messaggio_allegati_all_account') then
    create policy "gara_messaggio_allegati_all_account" on public.gara_messaggio_allegati
      for all using ((select public.omnia_ai_titolare_effettivo()) = user_id)
      with check ((select public.omnia_ai_titolare_effettivo()) = user_id);
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'gara_relazione_sezioni' and policyname = 'gara_relazione_sezioni_all_account') then
    create policy "gara_relazione_sezioni_all_account" on public.gara_relazione_sezioni
      for all using ((select public.omnia_ai_titolare_effettivo()) = user_id)
      with check ((select public.omnia_ai_titolare_effettivo()) = user_id);
  end if;

  -- consumi: sola lettura (la scrittura è sempre del server)
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'gara_consumi' and policyname = 'gara_consumi_select_account') then
    create policy "gara_consumi_select_account" on public.gara_consumi
      for select using ((select public.omnia_ai_titolare_effettivo()) = user_id);
  end if;
end
$$;

-- Le vecchie regole (auth.uid() = user_id) escono solo ora che quelle nuove esistono.
drop policy if exists "gare_all_own" on public.gare;
drop policy if exists "gara_documenti_all_own" on public.gara_documenti;
drop policy if exists "gara_documenti_chunks_all_own" on public.gara_documenti_chunks;
drop policy if exists "gara_messaggi_all_own" on public.gara_messaggi;
drop policy if exists "gara_messaggio_allegati_all_own" on public.gara_messaggio_allegati;
drop policy if exists "gara_relazione_sezioni_all_own" on public.gara_relazione_sezioni;
drop policy if exists "gara_consumi_select_own" on public.gara_consumi;

-- ───── 4) ricerca nei documenti della gara (chat) ─────

create or replace function public.match_gara_chunks(
  query_embedding vector(1024),
  target_gara_id uuid,
  match_count int default 8
)
returns table (
  id uuid,
  documento_id uuid,
  contenuto text,
  similarity float
)
language sql stable
security definer set search_path = public
as $$
  select
    gara_documenti_chunks.id,
    gara_documenti_chunks.documento_id,
    gara_documenti_chunks.contenuto,
    1 - (gara_documenti_chunks.embedding <=> query_embedding) as similarity
  from public.gara_documenti_chunks
  where gara_documenti_chunks.gara_id = target_gara_id
    and gara_documenti_chunks.user_id = (select public.omnia_ai_titolare_effettivo())
  order by gara_documenti_chunks.embedding <=> query_embedding
  limit match_count;
$$;

grant execute on function public.match_gara_chunks(vector, uuid, int) to authenticated;

-- ───── 5) avvisi dell'Ufficio Gare al titolare ─────
-- Una riga per avviso. L'unicità (titolare, tipo, chiave, giorno) è il limite «al massimo uno al giorno»:
-- il codice prova a inserire e, se la riga esiste già, non manda l'email (errore 23505 ignorato).
--   quota_esaurita        gare o crediti finiti (chiave vuota: uno al giorno in tutto)
--   revisione_richiesta   l'Ufficio Gare vorrebbe la revisione umana (chiave = id della gara: una al giorno per gara)

create table if not exists public.omnia_ai_membri_avvisi (
  id uuid primary key default gen_random_uuid(),
  titolare_id uuid not null references public.users (id) on delete cascade,
  -- chi l'ha provocato; se l'utente viene eliminato resta la traccia dell'avviso
  membro_id uuid references public.users (id) on delete set null,
  tipo text not null check (tipo in ('quota_esaurita', 'revisione_richiesta')),
  chiave text not null default '',
  giorno date not null default ((now() at time zone 'Europe/Rome')::date),
  created_at timestamptz not null default now(),
  constraint omnia_ai_membri_avvisi_uno_al_giorno unique (titolare_id, tipo, chiave, giorno)
);

alter table public.omnia_ai_membri_avvisi enable row level security;

-- Nessuna regola per authenticated: la scrive e la legge solo il server (chiave di servizio).
grant select, insert, update, delete on public.omnia_ai_membri_avvisi to service_role;
