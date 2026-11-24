-- 0112 — Tender Intelligence, fase B1 (16/11/2026): importazione TED, gare salvate e monitorate, gare aggiunte a mano, registro delle
-- modifiche fatte dalla console.
--
-- 1) Archivio PUBBLICO (tabelle della 0109, solo colonne e indici nuovi):
--    - radar_procedure: regioni del luogo di esecuzione (filtro «Territorio»), tipo di ente della fonte, ultima versione dell'avviso applicata
--      (rettifiche: si applica solo un avviso più recente di quello già letto), stato «chiusa senza aggiudicazione» (esito TED senza vincitore);
--    - radar_lotti: scadenza e collegamento ai documenti del singolo lotto, chiave unica procedura + numero del lotto (niente doppioni);
--    - radar_procedure_fonti: data, versione, tipo e motivo di ogni avviso letto;
--    - radar_aggiornamenti: avviso di origine, nota, chiave unica (rileggere lo stesso avviso non duplica i cambiamenti) e «notificabile»:
--      FALSO per tutto ciò che arriva dal recupero dello storico o riguarda gare già scadute (nessuna notifica per avvisi storici).
-- 2) Dominio RISERVATO per impresa (stessa regola di accesso delle gare: il titolare effettivo, quindi anche l'Ufficio Gare):
--    - omnia_ai_radar_gare_aggiunte: gare aggiunte a mano (CIG o collegamento + dati facoltativi scritti dal cliente); non entrano mai
--      nell'archivio pubblico; si collegano alla gara pubblica quando il CIG compare in una fonte;
--    - omnia_ai_radar_salvate: gare salvate (riga presente) e monitorate (monitorata = vero), con note e ultimo aggiornamento visto.
-- 3) radar_console_registro: chi ha cambiato che cosa dalla console (autore, data, valore precedente, valore nuovo). Solo il server lo scrive,
--    nessuno lo modifica o lo cancella (solo inserimenti). Colonne di registro SENZA chiavi esterne: il registro sopravvive agli utenti e
--    non crea ambiguità negli embed di PostgREST.
-- 4) radar_fonti_stato: riga della fonte TED, SPENTA (si accende dalla console).
--
-- ADDITIVA e idempotente. Unica modifica a un vincolo esistente: il controllo dei valori di radar_procedure.stato (tabella della 0109,
-- vuota in produzione) si ricrea più ampio, con un valore in più. Da eseguire dopo la 0111 e prima sullo staging.

-- ───── 1) archivio pubblico ─────
alter table public.radar_procedure add column if not exists luogo_regioni text[] not null default '{}';
alter table public.radar_procedure add column if not exists ente_tipo text check (ente_tipo is null or char_length(ente_tipo) <= 60);
alter table public.radar_procedure add column if not exists ultima_versione_il date;
alter table public.radar_procedure add column if not exists ultima_versione_id text check (ultima_versione_id is null or char_length(ultima_versione_id) <= 200);
create index if not exists radar_procedure_luogo_idx on public.radar_procedure using gin (luogo_regioni);
create index if not exists radar_procedure_valore_idx on public.radar_procedure (valore_stimato);

alter table public.radar_procedure drop constraint if exists radar_procedure_stato_check;
alter table public.radar_procedure add constraint radar_procedure_stato_check
  check (stato in ('aperta', 'scaduta', 'annullata', 'aggiudicata', 'chiusa_senza_aggiudicazione', 'sospesa', 'sconosciuto'));

alter table public.radar_lotti add column if not exists scadenza_offerte timestamptz;
alter table public.radar_lotti add column if not exists scadenza_ora_indicata boolean not null default false;
alter table public.radar_lotti add column if not exists url_documenti text check (url_documenti is null or (char_length(url_documenti) <= 2000 and url_documenti ~ '^https?://'));
create unique index if not exists radar_lotti_procedura_numero_uidx on public.radar_lotti (procedura_id, numero_lotto);

alter table public.radar_procedure_fonti add column if not exists pubblicato_il date;
alter table public.radar_procedure_fonti add column if not exists versione integer check (versione is null or versione between 0 and 1000);
alter table public.radar_procedure_fonti add column if not exists tipo_avviso text check (tipo_avviso is null or char_length(tipo_avviso) <= 60);
alter table public.radar_procedure_fonti add column if not exists motivo_modifica text check (motivo_modifica is null or char_length(motivo_modifica) <= 60);

alter table public.radar_aggiornamenti add column if not exists id_fonte text check (id_fonte is null or char_length(id_fonte) <= 200);
alter table public.radar_aggiornamenti add column if not exists nota text check (nota is null or char_length(nota) <= 1000);
alter table public.radar_aggiornamenti add column if not exists notificabile boolean not null default false;
create unique index if not exists radar_aggiornamenti_unico_uidx on public.radar_aggiornamenti (procedura_id, tipo, campo, id_fonte) nulls not distinct;
create index if not exists radar_aggiornamenti_notificabili_idx on public.radar_aggiornamenti (rilevato_il) where notificabile;

-- ───── 2) dominio riservato ─────
create table if not exists public.omnia_ai_radar_gare_aggiunte (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  -- chi l'ha aggiunta (titolare o Ufficio Gare): colonna di registro, senza chiave esterna
  creata_da uuid,
  cig text check (cig is null or cig ~ '^[0-9A-Z]{10}$'),
  url text check (url is null or (char_length(url) <= 2000 and url ~ '^https?://')),
  oggetto text check (oggetto is null or char_length(oggetto) between 1 and 500),
  ente text check (ente is null or char_length(ente) between 1 and 300),
  scadenza_offerte timestamptz,
  -- falso = il cliente ha scritto il giorno ma non l'ora: l'ora non si presume e non si mostra
  scadenza_ora_indicata boolean not null default false,
  importo numeric(16, 2) check (importo is null or importo >= 0),
  -- collegamento alla gara pubblica, quando il CIG compare in una fonte
  procedura_id uuid references public.radar_procedure (id) on delete set null,
  collegata_il timestamptz,
  creata_il timestamptz not null default now(),
  aggiornata_il timestamptz not null default now(),
  constraint omnia_ai_radar_gare_aggiunte_cig_o_url check (cig is not null or url is not null)
);

create index if not exists omnia_ai_radar_gare_aggiunte_account_idx on public.omnia_ai_radar_gare_aggiunte (user_id, creata_il desc);
create unique index if not exists omnia_ai_radar_gare_aggiunte_cig_uidx on public.omnia_ai_radar_gare_aggiunte (user_id, cig) where cig is not null;
create index if not exists omnia_ai_radar_gare_aggiunte_da_collegare_idx on public.omnia_ai_radar_gare_aggiunte (cig) where cig is not null and procedura_id is null;

create table if not exists public.omnia_ai_radar_salvate (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  procedura_id uuid references public.radar_procedure (id) on delete cascade,
  aggiunta_id uuid references public.omnia_ai_radar_gare_aggiunte (id) on delete cascade,
  monitorata boolean not null default false,
  note text check (note is null or char_length(note) <= 2000),
  salvata_da uuid,
  ultimo_aggiornamento_visto_il timestamptz,
  creata_il timestamptz not null default now(),
  aggiornata_il timestamptz not null default now(),
  constraint omnia_ai_radar_salvate_una_gara check ((procedura_id is not null) <> (aggiunta_id is not null)),
  constraint omnia_ai_radar_salvate_procedura_unica unique (user_id, procedura_id),
  constraint omnia_ai_radar_salvate_aggiunta_unica unique (user_id, aggiunta_id)
);

create index if not exists omnia_ai_radar_salvate_account_idx on public.omnia_ai_radar_salvate (user_id, creata_il desc);
create index if not exists omnia_ai_radar_salvate_procedura_idx on public.omnia_ai_radar_salvate (procedura_id);

alter table public.omnia_ai_radar_gare_aggiunte enable row level security;
alter table public.omnia_ai_radar_salvate enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'omnia_ai_radar_gare_aggiunte' and policyname = 'omnia_ai_radar_gare_aggiunte_all_account') then
    create policy "omnia_ai_radar_gare_aggiunte_all_account" on public.omnia_ai_radar_gare_aggiunte
      for all using ((select public.omnia_ai_titolare_effettivo()) = user_id)
      with check ((select public.omnia_ai_titolare_effettivo()) = user_id);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'omnia_ai_radar_salvate' and policyname = 'omnia_ai_radar_salvate_all_account') then
    create policy "omnia_ai_radar_salvate_all_account" on public.omnia_ai_radar_salvate
      for all using ((select public.omnia_ai_titolare_effettivo()) = user_id)
      with check ((select public.omnia_ai_titolare_effettivo()) = user_id);
  end if;
end $$;

revoke all on public.omnia_ai_radar_gare_aggiunte from anon;
revoke all on public.omnia_ai_radar_salvate from anon;
grant select, insert, update, delete on public.omnia_ai_radar_gare_aggiunte to authenticated;
grant select, insert, update, delete on public.omnia_ai_radar_salvate to authenticated;
grant select, insert, update, delete on public.omnia_ai_radar_gare_aggiunte to service_role;
grant select, insert, update, delete on public.omnia_ai_radar_salvate to service_role;

-- ───── 3) registro delle modifiche dalla console ─────
create table if not exists public.radar_console_registro (
  id uuid primary key default gen_random_uuid(),
  -- che cosa è cambiato, per esempio «parametro:radar_attivo», «cliente:attivo», «fonte:ted:attiva»
  oggetto text not null check (oggetto ~ '^[a-z0-9_:.-]{2,120}$'),
  -- il cliente interessato, se la modifica riguarda un cliente (registro: nessuna chiave esterna)
  cliente_id uuid,
  valore_precedente text check (valore_precedente is null or char_length(valore_precedente) <= 2000),
  valore_nuovo text check (valore_nuovo is null or char_length(valore_nuovo) <= 2000),
  autore_id uuid not null,
  autore_email text not null check (char_length(autore_email) between 3 and 320),
  creato_il timestamptz not null default now()
);

create index if not exists radar_console_registro_data_idx on public.radar_console_registro (creato_il desc);

alter table public.radar_console_registro enable row level security;
revoke all on public.radar_console_registro from anon, authenticated;
grant select, insert on public.radar_console_registro to service_role;

-- ───── 4) fonte TED, spenta ─────
insert into public.radar_fonti_stato (fonte, attiva) values ('ted', false) on conflict (fonte) do nothing;

notify pgrst, 'reload schema';
