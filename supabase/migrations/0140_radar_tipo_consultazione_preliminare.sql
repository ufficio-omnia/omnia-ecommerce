-- 0140 — Tender Intelligence, Fase 2: il tipo di opportunità «consultazione_preliminare» (consultazioni preliminari di mercato) ammesso
-- nell'archivio (26/11/2026). Decisione dell'utente del 26/11 (tipo nuovo, partecipazione libera, etichetta «Consultazione preliminare di
-- mercato», distinto da gare e candidature); numero ASSEGNATO dal coordinamento (0137 START, 0138 EmPULIA, 0139 SIAPS).
--
-- PROGETTO, MAI APPLICATO. La applica a mano l'utente, mai con la chiave di servizio: prima sullo STAGING (collaudo, autorizzazione
-- separata), in produzione solo con un'altra autorizzazione. ORDINE: PRIMA di qualunque giro di una fonte che produce consultazioni
-- (FONTI_CON_CONSULTAZIONI nel codice: start, empulia, siaps). Senza la 0140 la scrittura di quel valore violerebbe il vincolo della 0120.
-- SATER e SardegnaCAT NON producono il tipo nuovo (fuori elenco): la 0140 non cambia nulla per loro.
--
-- Che cosa fa: il vincolo dei valori di radar_procedure.tipo_opportunita (0120, nato senza nome esplicito: in Postgres
-- «radar_procedure_tipo_opportunita_check») ammette in più 'consultazione_preliminare'. Il vincolo di oggi si cerca per definizione (non per
-- nome, per sicurezza), si toglie e si ricrea con un nome esplicito e tutti i valori di prima più quello nuovo. NON tocca
-- radar_procedure.partecipazione: «libera» è già ammessa.
--
-- Regole rispettate:
--   - ADDITIVA e NON distruttiva: nessuna riga toccata (il vincolo nuovo ammette tutti i valori di prima, quindi ogni riga lo rispetta); nessuna
--     tabella, colonna, indice, funzione, trigger o regola nuova o tolta; permessi (GRANT) invariati; nessun dato di persone;
--   - IDEMPOTENTE: se il vincolo ammette già 'consultazione_preliminare' non si fa nulla; si può rieseguire;
--   - il controllo finale ferma tutto (e annulla la transazione) se un vincolo di radar_procedure rifiutasse ancora il valore nuovo.
--
-- ATTESE dopo l'applicazione (sola lettura):
--   select conname, pg_get_constraintdef(oid) from pg_constraint where conrelid = 'public.radar_procedure'::regclass and pg_get_constraintdef(oid) like '%tipo_opportunita%';
--     → radar_procedure_tipo_opportunita_check | CHECK (((tipo_opportunita IS NULL) OR (tipo_opportunita = ANY (ARRAY['bando'::text,
--       'manifestazione_interesse'::text, 'indagine_mercato'::text, 'sistema_qualificazione'::text, 'consultazione_preliminare'::text]))))
--
-- RITIRO (solo se serve, e solo PRIMA che una gara abbia il tipo nuovo): ricreare il vincolo della 0120 senza 'consultazione_preliminare'
-- (che riesce solo se nessuna riga lo usa). Non fa parte di questa migrazione.

begin;

do $$
declare
  vincolo record;
begin
  -- già fatto: nulla da cambiare (idempotente)
  if exists (
    select 1 from pg_constraint
     where conrelid = 'public.radar_procedure'::regclass and contype = 'c'
       and pg_get_constraintdef(oid) like '%tipo_opportunita%' and pg_get_constraintdef(oid) like '%consultazione_preliminare%'
  ) then
    return;
  end if;
  for vincolo in
    select conname from pg_constraint
     where conrelid = 'public.radar_procedure'::regclass and contype = 'c'
       and pg_get_constraintdef(oid) like '%tipo_opportunita%' and pg_get_constraintdef(oid) like '%sistema_qualificazione%'
  loop
    execute format('alter table public.radar_procedure drop constraint %I', vincolo.conname);
  end loop;
  alter table public.radar_procedure add constraint radar_procedure_tipo_opportunita_check
    check (tipo_opportunita is null or tipo_opportunita in ('bando', 'manifestazione_interesse', 'indagine_mercato', 'sistema_qualificazione', 'consultazione_preliminare'));
end
$$;

-- controllo: un solo vincolo su tipo_opportunita, e ammette il valore nuovo
do $$
declare
  rifiutano integer;
  totale integer;
begin
  select count(*) filter (where pg_get_constraintdef(oid) not like '%consultazione_preliminare%'), count(*)
    into rifiutano, totale
    from pg_constraint
   where conrelid = 'public.radar_procedure'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%tipo_opportunita%';
  if rifiutano > 0 or totale <> 1 then
    raise exception '0140: vincoli su tipo_opportunita = %, che rifiutano ''consultazione_preliminare'' = %: nulla applicato', totale, rifiutano;
  end if;
end
$$;

commit;

notify pgrst, 'reload schema';
