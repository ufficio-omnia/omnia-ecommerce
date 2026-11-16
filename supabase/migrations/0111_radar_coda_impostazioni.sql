-- 0111 — Tender Intelligence: coda dei lavori, interruttori, crediti e limiti, registro degli utilizzi (fase A, 16/11/2026).
--
-- 1) radar_lavori: coda delle elaborazioni asincrone (importazioni, sintesi, analisi dei requisiti). Chiave di idempotenza unica (accodare due
--    volte non crea doppioni), un solo esecutore per lavoro (blocco a tempo), tentativi con attese crescenti. Solo server.
-- 2) omnia_ai_radar_impostazioni: interruttore del modulo PER CLIENTE (il titolare), di base SPENTO, e limiti dedicati facoltativi.
--    Si scrive solo dalla console. Il modulo si vede solo con l'interruttore generale acceso E quello del cliente acceso.
-- 3) omnia_ai_radar_utilizzi: una riga per azione del cliente, con i crediti addebitati (oggi sempre 0) e il costo AI stimato. Serve ai limiti
--    per organizzazione e alla console. membro_id = chi ha agito (titolare o Ufficio Gare): colonna di registro, senza chiave esterna.
-- 4) console_impostazioni: interruttore generale SPENTO, costo in crediti di ogni azione a ZERO (nulla si addebita finché non lo decide il
--    titolare), limiti tecnici predefiniti. Solo valori iniziali: se una chiave esiste già non si tocca.
--
-- Nessuna di queste tabelle è leggibile dai ruoli utente: RLS attiva senza regole e revoca esplicita ad anon e authenticated.
-- Il contatore delle gare del piano (gara_consumi, credits) NON si tocca.
-- ADDITIVA e idempotente: nessun DROP. Da eseguire dopo la 0110 e prima sullo staging.

-- ───── 1) coda ─────
create table if not exists public.radar_lavori (
  id uuid primary key default gen_random_uuid(),
  tipo text not null check (tipo ~ '^[a-z_]{3,40}$'),
  chiave_idempotenza text not null unique check (char_length(chiave_idempotenza) between 3 and 300),
  -- l'impresa per cui si lavora (il titolare); null = lavoro della piattaforma (importazioni)
  account_id uuid references public.users (id) on delete cascade,
  dati jsonb not null default '{}'::jsonb check (jsonb_typeof(dati) = 'object'),
  stato text not null default 'in_coda' check (stato in ('in_coda', 'in_corso', 'completato', 'fallito', 'annullato')),
  tentativi integer not null default 0 check (tentativi >= 0),
  max_tentativi integer not null default 3 check (max_tentativi between 1 and 10),
  prossimo_tentativo_il timestamptz not null default now(),
  bloccato_fino_a timestamptz,
  errore text check (errore is null or char_length(errore) <= 1000),
  creato_il timestamptz not null default now(),
  iniziato_il timestamptz,
  completato_il timestamptz
);

create index if not exists radar_lavori_pronti_idx on public.radar_lavori (tipo, prossimo_tentativo_il) where stato in ('in_coda', 'in_corso');
create index if not exists radar_lavori_account_idx on public.radar_lavori (account_id, creato_il desc);

-- ───── 2) impostazioni per cliente ─────
create table if not exists public.omnia_ai_radar_impostazioni (
  user_id uuid primary key references public.users (id) on delete cascade,
  attivo boolean not null default false,
  -- limiti dedicati (per esempio {"analisi_requisiti_giorno": 40}); i nomi validi li controlla il codice
  limiti jsonb not null default '{}'::jsonb check (jsonb_typeof(limiti) = 'object'),
  nota text check (nota is null or char_length(nota) <= 300),
  creata_il timestamptz not null default now(),
  aggiornata_il timestamptz not null default now(),
  aggiornata_da_email text not null
);

-- ───── 3) registro degli utilizzi ─────
create table if not exists public.omnia_ai_radar_utilizzi (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  membro_id uuid,
  azione text not null check (azione in ('ricerca', 'sintesi', 'analisi_requisiti', 'intelligence', 'crea_offerta', 'aggiungi_manuale', 'monitora')),
  procedura_id uuid references public.radar_procedure (id) on delete set null,
  gara_id uuid references public.gare (id) on delete set null,
  crediti integer not null default 0 check (crediti >= 0),
  costo_ai_stimato numeric(10, 4),
  creato_il timestamptz not null default now()
);

create index if not exists omnia_ai_radar_utilizzi_conteggio_idx on public.omnia_ai_radar_utilizzi (user_id, azione, creato_il desc);
create index if not exists omnia_ai_radar_utilizzi_data_idx on public.omnia_ai_radar_utilizzi (creato_il);

alter table public.radar_lavori enable row level security;
alter table public.omnia_ai_radar_impostazioni enable row level security;
alter table public.omnia_ai_radar_utilizzi enable row level security;

revoke all on public.radar_lavori from anon, authenticated;
revoke all on public.omnia_ai_radar_impostazioni from anon, authenticated;
revoke all on public.omnia_ai_radar_utilizzi from anon, authenticated;

grant select, insert, update, delete on public.radar_lavori to service_role;
grant select, insert, update on public.omnia_ai_radar_impostazioni to service_role;
grant select, insert on public.omnia_ai_radar_utilizzi to service_role;

-- ───── 4) valori iniziali dei parametri (mai sovrascritti) ─────
insert into public.console_impostazioni (chiave, valore) values
  ('radar_attivo', '0'),
  ('radar_costo_ricerca', '0'),
  ('radar_costo_sintesi', '0'),
  ('radar_costo_analisi_requisiti', '0'),
  ('radar_costo_intelligence', '0'),
  ('radar_costo_crea_offerta', '0'),
  ('radar_costo_aggiungi_manuale', '0'),
  ('radar_costo_monitora', '0'),
  ('radar_limite_progetti_senza_analisi', '5'),
  ('radar_limite_ricerche_minuto', '60'),
  ('radar_limite_sintesi_giorno', '200'),
  ('radar_limite_analisi_requisiti_giorno', '20')
on conflict (chiave) do nothing;

notify pgrst, 'reload schema';
