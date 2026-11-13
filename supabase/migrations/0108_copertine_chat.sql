-- 0108 — Chat per modificare le copertine della relazione tecnica (richiesta dell'utente, 13/11/2026).
--
-- Dopo le 6 generazioni di una gara (3 stilizzate e 3 realistiche) il cliente sceglie una copertina e chiede in chat le modifiche: al massimo 3 copertine
-- nuove per gara, poi la chat si chiude. Qui si registrano i messaggi: quelli del cliente (con la copertina scelta e l'eventuale logo allegato) e le risposte
-- (quelle che consegnano una copertina hanno lo stato «in_corso» mentre si prepara e «pronta» quando è consegnata: sono loro a contare per il limite).
--
-- ADDITIVA: una tabella nuova, nessuna modifica alle tabelle esistenti. Il codice funziona anche prima di eseguirla: senza questa tabella la chat non
-- compare (le copertine si generano e si scaricano come prima). Si legge e si scrive solo dal server, con la chiave di servizio (come gara_copertine).
-- Da eseguire a mano nel SQL Editor di Supabase.

create table if not exists public.gara_copertine_chat (
  id uuid primary key default gen_random_uuid(),
  gara_id uuid not null references public.gare (id) on delete cascade,
  user_id uuid not null references public.users (id) on delete cascade,
  ruolo text not null check (ruolo in ('cliente', 'assistente')),
  testo text not null check (char_length(testo) between 1 and 2000),
  -- per il cliente: la copertina scelta da modificare; per l'assistente: la copertina consegnata (il nome dei suoi file, senza estensione)
  copertina text check (copertina is null or copertina ~ '^copertina-[0-9]{8}T[0-9]{6}Z-(stilizzato|realistico)(-modifica)?$'),
  -- un logo allegato dal cliente (percorso nel bucket «gare», nella cartella della gara) e quale logo sostituisce
  allegato text check (allegato is null or char_length(allegato) <= 300),
  allegato_per text check (allegato_per is null or allegato_per in ('stazione', 'cliente')),
  -- solo per le risposte che preparano una copertina
  stato text check (stato is null or stato in ('in_corso', 'pronta')),
  creata_il timestamptz not null default now(),
  constraint gara_copertine_chat_stato_solo_assistente check (ruolo = 'assistente' or stato is null)
);

create index if not exists gara_copertine_chat_gara_idx on public.gara_copertine_chat (gara_id, creata_il);

alter table public.gara_copertine_chat enable row level security;
grant select, insert, update, delete on public.gara_copertine_chat to service_role;

notify pgrst, 'reload schema';
