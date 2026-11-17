-- 0121 — Tender Intelligence, fase B2: CLASSIFICAZIONI PER SETTORE con storico, e FUNZIONE DELLE FONTI che aggiorna anche la gara di origine
-- (17/11/2026).
--
-- PROGETTO, MAI APPLICATO. Decisione dell'utente del 17/11: autorizzati solo la progettazione e le prove locali; NIENTE staging né
-- produzione finché l'utente non approva. Prima dello staging la funzione delle fonti va provata su un database Postgres ISOLATO.
-- Documento con motivazioni, confronto e prove: TENDER_INTELLIGENCE_FASE0/14_PROPOSTE_0121_E_DC9.md.
--
-- Che cosa fa:
--   1. tabella radar_classificazioni: UNA RIGA PER GARA E SETTORE, con livello (A pertinente, B correlata, C non pertinente), PIÙ
--      sottocategorie, regole, motivi, CPV, versione delle regole, origine e fonti; le righe non si cancellano e non si riscrivono: una
--      classificazione nuova DISATTIVA la precedente (storico completo, reversibile);
--   2. funzione delle fonti della 0120 corretta: tiene radar_procedure.fonti uguale all'insieme delle fonti delle provenienze anche quando
--      una provenienza CAMBIA GARA o viene CANCELLATA (la 0120 aggiungeva soltanto);
--   3. riallineamento una tantum delle fonti, solo dove la colonna è diversa dalle provenienze (sullo staging del 17/11: 0 gare).
--
-- Regole rispettate:
--   - ADDITIVA e idempotente; «settori», «metodo_settore» e tutte le query esistenti NON cambiano; la tabella nuova nasce VUOTA (si riempie
--     solo con la riclassificazione autorizzata e con gli importatori, dopo l'approvazione);
--   - RLS attiva senza policy; nessun permesso ad anon e authenticated; service_role può leggere e inserire, e aggiornare SOLO le colonne
--     dello stato (attiva, sostituita_il, sostituita_da): il contenuto di una classificazione, una volta scritto, non cambia; nessuna
--     cancellazione (le righe spariscono solo con la gara, per la chiave esterna);
--   - una sola chiave esterna (la gara); NESSUNA chiave esterna sulle colonne di traccia (sostituita_da, autore), così gli «embed» di
--     PostgREST restano univoci;
--   - compatibile con la 0117 (le unioni non spostano provenienze: unita_a resta l'unico legame tra gare) e con la 0120 (stessa colonna
--     «fonti», stesso significato, trigger sostituito da uno che fa la stessa cosa più l'origine e le cancellazioni).

-- ───── 1. classificazioni per gara e settore, con storico ─────
create table if not exists public.radar_classificazioni (
  id uuid primary key default gen_random_uuid(),
  procedura_id uuid not null references public.radar_procedure (id) on delete cascade,
  -- i sei settori del file approvato (CPV_settori_OMNIA.csv); un settore nuovo è una decisione di prodotto e una migrazione
  settore text not null check (settore in ('pulizia', 'ristorazione', 'vigilanza_portierato', 'facchinaggio', 'multiservizi', 'ausiliariato')),
  -- A pertinente, B correlata, C non pertinente (decisione dell'utente del 17/11)
  livello text not null check (livello in ('A', 'B', 'C')),
  -- più sottocategorie nello stesso settore, in ordine di evidenza (la prima è la principale); vuoto per il livello C. Solo la forma è
  -- controllata (identificativi di settori.ts): una sottocategoria nuova non richiede una migrazione
  sottocategorie text[] not null default '{}',
  -- le regole che decidono il livello, la prima è la principale; i motivi leggibili nello stesso ordine, salvati per spiegare anche le
  -- classificazioni fatte con regole che nel frattempo sono cambiate
  regole text[] not null,
  motivi text[] not null default '{}',
  da text not null check (da in ('cpv', 'parole_chiave')),
  -- i CPV del file approvato trovati per questo settore (vuoto se trovato per parola chiave)
  cpv text[] not null default '{}',
  versione_regole text not null check (versione_regole ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}[a-z]?$'),
  -- chi l'ha prodotta: un giro di importazione, la riclassificazione autorizzata, o la decisione di un amministratore (con la nota)
  origine text not null check (origine in ('importazione', 'riclassificazione', 'amministratore')),
  -- le fonti della gara al momento della classificazione; «ambigua» = le fonti, o i dati uniti, non danno lo stesso risultato
  fonti text[] not null default '{}',
  ambigua boolean not null default false,
  nota text check (nota is null or char_length(nota) <= 1000),
  -- traccia: «importazione:ted», «riclassificazione:AUT-…», «console:<id dell'amministratore>» (nessuna chiave esterna)
  autore text check (autore is null or char_length(autore) <= 200),
  attiva boolean not null default true,
  valida_dal timestamptz not null default now(),
  sostituita_il timestamptz,
  -- traccia: la riga che l'ha sostituita, se c'è (nessuna chiave esterna)
  sostituita_da uuid,
  constraint radar_classificazioni_sottocategorie_forma check (
    cardinality(sottocategorie) <= 10 and array_position(sottocategorie, null) is null
    and array_to_string(sottocategorie, ',') ~ '^([a-z0-9_]{2,60}(,[a-z0-9_]{2,60})*)?$'),
  constraint radar_classificazioni_regole_forma check (
    cardinality(regole) between 1 and 10 and array_position(regole, null) is null
    and array_to_string(regole, ',') ~ '^[a-z0-9_]{2,60}(,[a-z0-9_]{2,60})*$'),
  constraint radar_classificazioni_motivi_forma check (
    cardinality(motivi) <= 10 and array_position(motivi, null) is null and char_length(array_to_string(motivi, '')) <= 3000),
  constraint radar_classificazioni_cpv_forma check (
    cardinality(cpv) <= 50 and array_position(cpv, null) is null and array_to_string(cpv, ',') ~ '^([0-9]{8}(,[0-9]{8})*)?$'),
  constraint radar_classificazioni_fonti_forma check (
    cardinality(fonti) <= 10 and array_position(fonti, null) is null and array_to_string(fonti, ',') ~ '^([a-z0-9_]{2,40}(,[a-z0-9_]{2,40})*)?$'),
  constraint radar_classificazioni_c_senza_sottocategorie check (livello <> 'C' or cardinality(sottocategorie) = 0),
  constraint radar_classificazioni_cpv_solo_da_cpv check (da = 'cpv' or cardinality(cpv) = 0),
  constraint radar_classificazioni_amministratore_con_nota check (origine <> 'amministratore' or nota is not null),
  constraint radar_classificazioni_stato check (
    (attiva and sostituita_il is null and sostituita_da is null) or (not attiva and sostituita_il is not null))
);

-- una sola classificazione ATTIVA per gara e settore (lo storico può averne quante servono)
create unique index if not exists radar_classificazioni_attiva_uidx on public.radar_classificazioni (procedura_id, settore) where attiva;
-- suggerimenti e risultati di settore: «gare del settore X di livello A» (solo le righe attive)
create index if not exists radar_classificazioni_settore_livello_idx on public.radar_classificazioni (settore, livello) where attiva;
-- storico di una gara e cancellazione a catena con la gara
create index if not exists radar_classificazioni_procedura_idx on public.radar_classificazioni (procedura_id, valida_dal desc);

alter table public.radar_classificazioni enable row level security;
revoke all on public.radar_classificazioni from public, anon, authenticated, service_role;
grant select, insert on public.radar_classificazioni to service_role;
grant update (attiva, sostituita_il, sostituita_da) on public.radar_classificazioni to service_role;

-- ───── 2. funzione delle fonti: destinazione E origine ─────
-- La 0120 aggiungeva la fonte alla gara della provenienza e non toglieva mai nulla. Ora:
--   - inserimento o aggiornamento: la fonte si aggiunge alla gara di destinazione se manca (come prima, nessuna scrittura se c'è già);
--   - aggiornamento che cambia gara o fonte, e cancellazione: le fonti della gara di ORIGINE si ricalcolano dalle provenienze rimaste
--     (insieme ordinato), e si scrivono solo se cambiano;
--   - un upsert che riscrive la stessa provenienza non scrive nulla.
-- STESSI NOMI della 0120 (funzione e trigger), riscritti con CREATE OR REPLACE: nessun DROP, nessun oggetto orfano, il nome registrato nella
-- 0120 resta valido. CREATE OR REPLACE TRIGGER richiede Postgres 14 o superiore: lo staging è 17.11 (letto il 17/11/2026).
create or replace function public.radar_aggiungi_fonte_alla_gara() returns trigger
  language plpgsql
  security invoker
  set search_path = public
as $$
begin
  if tg_op in ('INSERT', 'UPDATE') then
    update public.radar_procedure
       set fonti = array_append(fonti, new.fonte)
     where id = new.procedura_id
       and not (new.fonte = any (fonti));
  end if;
  if tg_op = 'DELETE' or (tg_op = 'UPDATE' and (old.procedura_id is distinct from new.procedura_id or old.fonte is distinct from new.fonte)) then
    update public.radar_procedure p
       set fonti = r.fonti
      from (select coalesce(array_agg(distinct f.fonte order by f.fonte), '{}'::text[]) as fonti
              from public.radar_procedure_fonti f
             where f.procedura_id = old.procedura_id) r
     where p.id = old.procedura_id
       and not (p.fonti @> r.fonti and p.fonti <@ r.fonti);
  end if;
  return null;
end;
$$;
revoke all on function public.radar_aggiungi_fonte_alla_gara() from public, anon, authenticated;
grant execute on function public.radar_aggiungi_fonte_alla_gara() to service_role;

-- lo stesso trigger della 0120, con un evento in più (la cancellazione): CREATE OR REPLACE lo aggiorna sul posto, nella stessa transazione
create or replace trigger radar_procedure_fonti_aggiunge_fonte
  after insert or update of procedura_id, fonte or delete on public.radar_procedure_fonti
  for each row execute function public.radar_aggiungi_fonte_alla_gara();

-- ───── 3. riallineamento una tantum delle fonti (solo dove la colonna è diversa dalle provenienze) ─────
update public.radar_procedure p
   set fonti = r.fonti
  from (select procedura_id, array_agg(distinct fonte order by fonte) as fonti from public.radar_procedure_fonti group by procedura_id) r
 where p.id = r.procedura_id
   and not (p.fonti @> r.fonti and p.fonti <@ r.fonti);
update public.radar_procedure p
   set fonti = '{}'
 where cardinality(p.fonti) > 0
   and not exists (select 1 from public.radar_procedure_fonti f where f.procedura_id = p.id);

notify pgrst, 'reload schema';
