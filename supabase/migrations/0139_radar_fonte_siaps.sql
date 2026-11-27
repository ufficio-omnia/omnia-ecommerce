-- 0139 — Tender Intelligence, Fase 2: la fonte «siaps» (SIAPS, So.Re.Sa., connettore AF Soluzioni, documento 60) nel registro dei
-- giri e nello stato delle fonti (27/11/2026).
--
-- PROGETTO, MAI APPLICATO. Numero ASSEGNATO dal coordinamento il 26/11 (0138 EmPULIA, 0139 SIAPS, 0140 tipo «consultazione_preliminare»). Per
-- ora SOLO per lo STAGING, per il collaudo del connettore: l'applicazione è un'autorizzazione SEPARATA dell'utente; la produzione mai senza di
-- lui. La applica a mano l'utente, mai con la chiave di servizio.
--
-- Che cosa fa:
--   1) il vincolo dei valori di radar_esecuzioni.fonte (0128, ricreato dalle migrazioni delle fonti della Fase 2) ammette in più 'siaps'.
--      I valori ammessi si RICAVANO dalla definizione CORRENTE del vincolo (come la 0140): nessun valore aggiunto da un'altra migrazione si
--      perde, e la migrazione non dipende dall'ordine di applicazione rispetto alle altre fonti della Fase 2. Il vincolo si ricrea con lo
--      stesso nome (radar_esecuzioni_fonte_check);
--   2) la riga di 'siaps' in radar_fonti_stato: SPENTA (attiva = false), NASCOSTA ai clienti (nascosta_ai_clienti = true) e con il
--      SEMAFORO CHIUSO (blocco_fino_a = 2099-01-01, il valore convenzionale del coordinamento: il giro lo apre solo il lanciatore
--      autorizzato). Se la riga c'è già non si tocca.
--   NON tocca il vincolo di radar_procedure.piattaforma_id della 0120: «siaps:<IdMsg>» lo rispetta già (IdMsg numerico).
--   Il connettore legge il feed PUBBLICATO di SIAPS (una lettura); le consultazioni
--   preliminari si scrivono col tipo «consultazione_preliminare» solo DOPO la 0140 (da applicare prima del primo giro).
--
-- Regole rispettate:
--   - ADDITIVA e NON distruttiva: nessuna riga esistente toccata (il vincolo nuovo ammette tutti i valori di prima); una sola riga nuova in
--     radar_fonti_stato; nessuna tabella, colonna, indice, funzione, trigger o regola nuova o tolta; permessi (GRANT) invariati; nessun dato
--     di persone;
--   - IDEMPOTENTE: se il vincolo ammette già 'siaps' non si ricrea; «on conflict do nothing» per la riga; si può rieseguire;
--   - il controllo finale ferma tutto (e annulla la transazione) se il vincolo ricreato non ammette tutti i valori di prima più quello nuovo,
--     o se i vincoli sulle fonti non sono esattamente uno.
--
-- ATTESE dopo l'applicazione (sola lettura):
--   select pg_get_constraintdef(oid) from pg_constraint where conrelid = 'public.radar_esecuzioni'::regclass and conname = 'radar_esecuzioni_fonte_check';
--     → CHECK ((fonte = ANY (ARRAY[… tutti i valori di prima …, 'siaps'::text])))
--   select fonte, attiva, nascosta_ai_clienti, blocco_fino_a from public.radar_fonti_stato where fonte = 'siaps';
--     → siaps | false | true | 2099-01-01 00:00:00+00
--
-- RITIRO (solo se serve, e solo PRIMA di qualunque giro): togliere la riga di 'siaps' da radar_fonti_stato e ricreare il vincolo senza
-- 'siaps' (che riesce solo se in radar_esecuzioni non ci sono righe di 'siaps'). Non fa parte di questa migrazione.

begin;

do $$
declare
  vincolo record;
  valori text[] := '{}';
  v text;
  elenco text;
  definizione text;
  totale integer;
begin
  -- già fatto: nulla da cambiare (idempotente)
  if exists (
    select 1 from pg_constraint
     where conrelid = 'public.radar_esecuzioni'::regclass and contype = 'c'
       and pg_get_constraintdef(oid) like '%sardegnacat%' and pg_get_constraintdef(oid) like '%''siaps''%'
  ) then
    return;
  end if;
  -- i valori di OGGI del vincolo sulle fonti (riconosciuto dal valore 'sardegnacat', come nella 0135), poi il vincolo si toglie
  for vincolo in
    select conname, pg_get_constraintdef(oid) as d from pg_constraint
     where conrelid = 'public.radar_esecuzioni'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%sardegnacat%'
  loop
    for v in select (regexp_matches(vincolo.d, '''([a-z0-9_]+)''', 'g'))[1] loop
      if not (v = any (valori)) then
        valori := valori || v;
      end if;
    end loop;
    execute format('alter table public.radar_esecuzioni drop constraint %I', vincolo.conname);
  end loop;
  if cardinality(valori) = 0 then
    raise exception '0139: nessun vincolo sulle fonti di radar_esecuzioni trovato: nulla applicato';
  end if;
  valori := valori || 'siaps'::text;
  select string_agg(quote_literal(x), ', ' order by n) into elenco from unnest(valori) with ordinality as t(x, n);
  execute format('alter table public.radar_esecuzioni add constraint radar_esecuzioni_fonte_check check (fonte in (%s))', elenco);
  -- controllo: un solo vincolo sulle fonti, con TUTTI i valori di prima più quello nuovo
  select count(*), max(pg_get_constraintdef(oid)) into totale, definizione
    from pg_constraint
   where conrelid = 'public.radar_esecuzioni'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%sardegnacat%';
  if totale <> 1 then
    raise exception '0139: vincoli sulle fonti = % (atteso 1): nulla applicato', totale;
  end if;
  foreach v in array valori loop
    if position(quote_literal(v) in definizione) = 0 then
      raise exception '0139: il vincolo ricreato non ammette %: nulla applicato', v;
    end if;
  end loop;
end
$$;

insert into public.radar_fonti_stato (fonte, attiva, nascosta_ai_clienti, blocco_fino_a)
values ('siaps', false, true, '2099-01-01T00:00:00Z')
on conflict (fonte) do nothing;

commit;

notify pgrst, 'reload schema';
