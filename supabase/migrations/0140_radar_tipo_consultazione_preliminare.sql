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

-- I valori ammessi si RICAVANO dalla definizione CORRENTE del vincolo (richiesta del coordinamento del 26/11): nessun valore aggiunto da una
-- migrazione dopo la 0120 può andare perso. Verificato il 26/11 sullo staging (sola lettura): un solo vincolo,
-- «radar_procedure_tipo_opportunita_check», con esattamente i quattro valori della 0120; nessun'altra migrazione del repository tocca
-- tipo_opportunita.
do $$
declare
  vincolo record;
  valori text[] := '{}';
  v text;
  elenco text;
begin
  -- già fatto: nulla da cambiare (idempotente)
  if exists (
    select 1 from pg_constraint
     where conrelid = 'public.radar_procedure'::regclass and contype = 'c'
       and pg_get_constraintdef(oid) like '%tipo_opportunita%' and pg_get_constraintdef(oid) like '%consultazione_preliminare%'
  ) then
    return;
  end if;
  -- i valori di OGGI, letti dalla definizione di ogni vincolo su tipo_opportunita (forma: ARRAY['bando'::text, …]), poi il vincolo si toglie
  for vincolo in
    select conname, pg_get_constraintdef(oid) as definizione from pg_constraint
     where conrelid = 'public.radar_procedure'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%tipo_opportunita%'
  loop
    for v in select (regexp_matches(vincolo.definizione, '''([a-z0-9_]+)''', 'g'))[1] loop
      if not (v = any (valori)) then
        valori := valori || v;
      end if;
    end loop;
    execute format('alter table public.radar_procedure drop constraint %I', vincolo.conname);
  end loop;
  if cardinality(valori) = 0 then
    raise exception '0140: nessun vincolo su tipo_opportunita trovato (o senza valori): nulla applicato';
  end if;
  valori := valori || 'consultazione_preliminare'::text;
  select string_agg(quote_literal(x), ', ' order by n) into elenco from unnest(valori) with ordinality as t(x, n);
  execute format('alter table public.radar_procedure add constraint radar_procedure_tipo_opportunita_check check (tipo_opportunita is null or tipo_opportunita in (%s))', elenco);
end
$$;

-- controllo: un solo vincolo su tipo_opportunita; ammette il valore nuovo E tutti i valori della 0120 (nessuno perso)
do $$
declare
  definizione text;
  totale integer;
  manca text;
begin
  select count(*), max(pg_get_constraintdef(oid)) into totale, definizione
    from pg_constraint
   where conrelid = 'public.radar_procedure'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%tipo_opportunita%';
  if totale <> 1 then
    raise exception '0140: vincoli su tipo_opportunita = % (atteso 1): nulla applicato', totale;
  end if;
  foreach manca in array array['bando', 'manifestazione_interesse', 'indagine_mercato', 'sistema_qualificazione', 'consultazione_preliminare'] loop
    if position(quote_literal(manca) in definizione) = 0 then
      raise exception '0140: il vincolo non ammette %: nulla applicato', manca;
    end if;
  end loop;
end
$$;

commit;

notify pgrst, 'reload schema';
