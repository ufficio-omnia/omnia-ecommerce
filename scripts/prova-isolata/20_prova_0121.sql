-- SOLO PER LA PROVA ISOLATA, dopo l'applicazione della 0121 (anche due volte, per l'idempotenza). Dati SINTETICI.
-- Le operazioni si fanno come service_role, il ruolo con cui scrive il server; le verifiche come amministratore del contenitore.
\set ON_ERROR_STOP on

-- ───── la 0121 applicata ─────
select prova.verifica('0121: riallineamento una tantum, nessuna fonte obsoleta', prova.obsolete() = 0 and prova.fonti('00000000-0000-0000-0000-0000000000b1') = '{}');
select prova.verifica('0121: settori, metodo, oggetto e chiave delle gare invariati',
  (select count(*) from public.radar_procedure p join prova.prima v using (id) where (p.chiave, p.oggetto, p.settori, p.metodo_settore) is distinct from (v.chiave, v.oggetto, v.settori, v.metodo_settore)) = 0);
select prova.verifica('0121: un solo trigger sulle provenienze, con il NOME della 0120 e gli eventi nuovi (anche la cancellazione)',
  (select count(*) from pg_trigger where tgrelid = 'public.radar_procedure_fonti'::regclass and not tgisinternal) = 1
  and exists (select 1 from pg_trigger where tgname = 'radar_procedure_fonti_aggiunge_fonte' and tgrelid = 'public.radar_procedure_fonti'::regclass
              and pg_get_triggerdef(oid) like '%INSERT OR DELETE OR UPDATE OF procedura_id, fonte%' and pg_get_triggerdef(oid) like '%radar_aggiungi_fonte_alla_gara()%'));
select prova.verifica('0121: la funzione ha il NOME della 0120 (una sola, riscritta con il nuovo corpo), security invoker con search_path fisso',
  (select count(*) from pg_proc where proname = 'radar_aggiungi_fonte_alla_gara') = 1
  and exists (select 1 from pg_proc where proname = 'radar_aggiungi_fonte_alla_gara' and not prosecdef and proconfig = '{search_path=public}' and prosrc like '%old.procedura_id%')
  and not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname like 'radar%fonti%' and p.proname <> 'radar_aggiungi_fonte_alla_gara'));
select prova.verifica('0121: nessun oggetto tolto (tabelle, colonne, indici, funzioni e trigger della 0120 ancora presenti)',
  (select count(*) from prova.oggetti_prima o where not exists (select 1 from prova.oggetti_ora() a where a = o.oggetto)) = 0);
select prova.verifica('0121: le tabelle delle classificazioni e del loro stato nascono vuote', (select count(*) from public.radar_classificazioni) = 0 and (select count(*) from public.radar_classificazioni_stato) = 0);

-- ───── fonti: unione, provenienza spostata, annullamento ─────
insert into public.radar_procedure (id, chiave, oggetto) values
  ('00000000-0000-0000-0000-0000000000d1', 'ted:proc-prova-D', 'Servizio di ristorazione (prova sintetica)'),
  ('00000000-0000-0000-0000-0000000000e1', 'pvl:av-prova-E', 'Servizio di ristorazione (prova sintetica)'),
  ('00000000-0000-0000-0000-0000000000f1', 'ted:proc-prova-F', 'Servizio di pulizia (prova sintetica)'),
  ('00000000-0000-0000-0000-0000000000f2', 'sintel:9000002', 'Servizio di pulizia (prova sintetica)');
set role service_role;
insert into public.radar_procedure_fonti (procedura_id, fonte, id_fonte, impronta) values
  ('00000000-0000-0000-0000-0000000000d1', 'ted', '900010-2026', 'i'),
  ('00000000-0000-0000-0000-0000000000e1', 'pvl', 'av-10', 'i');
reset role;
select prova.verifica('inserimento: la fonte si aggiunge alla gara', prova.fonti('00000000-0000-0000-0000-0000000000d1') = '{ted}' and prova.fonti('00000000-0000-0000-0000-0000000000e1') = '{pvl}');

-- unione 0117: E assorbita da D (nessuna provenienza si sposta)
set role service_role;
update public.radar_procedure set unita_a = '00000000-0000-0000-0000-0000000000d1', unita_il = now(), unita_motivo = 'avviso TED citato (prova sintetica)' where id = '00000000-0000-0000-0000-0000000000e1';
reset role;
select prova.verifica('unione: le fonti di entrambe restano come prima', prova.fonti('00000000-0000-0000-0000-0000000000d1') = '{ted}' and prova.fonti('00000000-0000-0000-0000-0000000000e1') = '{pvl}' and prova.obsolete() = 0);

-- upsert identico: nessuna scrittura sulla gara (xmin invariato)
create temp table x as select xmin::text as v from public.radar_procedure where id = '00000000-0000-0000-0000-0000000000e1';
set role service_role;
insert into public.radar_procedure_fonti (procedura_id, fonte, id_fonte, impronta) values ('00000000-0000-0000-0000-0000000000e1', 'pvl', 'av-10', 'i')
  on conflict (fonte, id_fonte) do update set procedura_id = excluded.procedura_id, fonte = excluded.fonte, impronta = excluded.impronta;
reset role;
select prova.verifica('upsert identico: la gara non viene riscritta', (select xmin::text from public.radar_procedure where id = '00000000-0000-0000-0000-0000000000e1') = (select v from x));

-- nuova lettura dopo l'unione: la provenienza va alla gara che resta (regola C1)
set role service_role;
insert into public.radar_procedure_fonti (procedura_id, fonte, id_fonte, impronta) values ('00000000-0000-0000-0000-0000000000d1', 'pvl', 'av-10', 'i2')
  on conflict (fonte, id_fonte) do update set procedura_id = excluded.procedura_id, fonte = excluded.fonte, impronta = excluded.impronta;
reset role;
select prova.verifica('provenienza spostata: la destinazione guadagna la fonte, l''origine la perde',
  prova.fonti('00000000-0000-0000-0000-0000000000d1') = '{pvl,ted}' and prova.fonti('00000000-0000-0000-0000-0000000000e1') = '{}' and prova.obsolete() = 0);

-- annullamento dell'unione (scollegaGara): nessuna provenienza si sposta, fonti coerenti
set role service_role;
update public.radar_procedure set unita_a = null, unita_il = null, unita_motivo = null, unita_esclusa_con = array['00000000-0000-0000-0000-0000000000d1'::uuid] where id = '00000000-0000-0000-0000-0000000000e1';
reset role;
select prova.verifica('annullamento: fonti sempre uguali alle provenienze', prova.obsolete() = 0);

-- ───── 3 o più fonti, cambio di fonte, cancellazioni ─────
set role service_role;
insert into public.radar_procedure_fonti (procedura_id, fonte, id_fonte, impronta) values
  ('00000000-0000-0000-0000-0000000000f1', 'ted', '900020-2026', 'i'),
  ('00000000-0000-0000-0000-0000000000f1', 'pvl', 'av-20', 'i'),
  ('00000000-0000-0000-0000-0000000000f1', 'pvl', 'av-21', 'i'),
  ('00000000-0000-0000-0000-0000000000f1', 'sintel', '9000020', 'i');
reset role;
select prova.verifica('tre fonti su una gara', prova.fonti('00000000-0000-0000-0000-0000000000f1') = '{pvl,sintel,ted}');
set role service_role;
update public.radar_procedure_fonti set procedura_id = '00000000-0000-0000-0000-0000000000f2' where fonte = 'sintel' and id_fonte = '9000020';
reset role;
select prova.verifica('tre fonti, provenienza Sintel spostata: la gara tiene TED e PVL, l''altra prende Sintel',
  prova.fonti('00000000-0000-0000-0000-0000000000f1') = '{pvl,ted}' and prova.fonti('00000000-0000-0000-0000-0000000000f2') = '{sintel}' and prova.obsolete() = 0);
set role service_role;
delete from public.radar_procedure_fonti where fonte = 'pvl' and id_fonte = 'av-20';
reset role;
select prova.verifica('cancellata una delle due provenienze PVL: la fonte PVL resta', prova.fonti('00000000-0000-0000-0000-0000000000f1') = '{pvl,ted}');
set role service_role;
delete from public.radar_procedure_fonti where fonte = 'pvl' and id_fonte = 'av-21';
reset role;
select prova.verifica('cancellata anche l''ultima provenienza PVL: la fonte sparisce', prova.fonti('00000000-0000-0000-0000-0000000000f1') = '{ted}' and prova.obsolete() = 0);
set role service_role;
update public.radar_procedure_fonti set fonte = 'pvl' where fonte = 'sintel' and id_fonte = '9000020';
reset role;
select prova.verifica('una provenienza che cambia fonte: la vecchia sparisce, la nuova compare', prova.fonti('00000000-0000-0000-0000-0000000000f2') = '{pvl}' and prova.obsolete() = 0);

-- ───── classificazioni: permessi, vincoli (D1, D3), storico ─────
set role service_role;
insert into public.radar_classificazioni (id, procedura_id, settore, rilevanza, sottocategorie, regole, motivi, da, cpv, versione_regole, origine, fonti, per_fonte, autore)
values ('00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000a1', 'ristorazione', 'A', '{concessione_bar,concessione_ristorante}', '{cpv_principale}', '{"CPV principale 55300000 (prova sintetica)"}', 'cpv', '{55300000}', '2026-11-17c', 'riclassificazione', '{ted}', '{"ted": "A", "dati_uniti": "A"}', 'riclassificazione:prova');
reset role;
select prova.verifica('classificazioni: service_role inserisce, con più sottocategorie nello stesso settore e le provenienze per fonte',
  (select sottocategorie from public.radar_classificazioni where id = '00000000-0000-0000-0000-00000000c001') = '{concessione_bar,concessione_ristorante}'
  and (select per_fonte->>'ted' from public.radar_classificazioni where id = '00000000-0000-0000-0000-00000000c001') = 'A');

do $$
declare n int := 0;
begin
  -- anon e authenticated: nessun accesso alle classificazioni né al loro stato
  begin set local role anon; perform 1 from public.radar_classificazioni; exception when insufficient_privilege then n := n + 1; end;
  reset role;
  begin set local role authenticated; insert into public.radar_classificazioni (procedura_id, settore, rilevanza, regole, motivi, da, versione_regole, origine) values ('00000000-0000-0000-0000-0000000000a1', 'pulizia', 'A', '{cpv_principale}', '{"m"}', 'cpv', '2026-11-17c', 'importazione'); exception when insufficient_privilege then n := n + 1; end;
  reset role;
  begin set local role anon; perform 1 from public.radar_classificazioni_stato; exception when insufficient_privilege then n := n + 1; end;
  reset role;
  begin set local role authenticated; insert into public.radar_classificazioni_stato (procedura_id, stato) values ('00000000-0000-0000-0000-0000000000a1', 'in_attesa'); exception when insufficient_privilege then n := n + 1; end;
  reset role;
  -- service_role: non può cambiare il contenuto di una classificazione né cancellare
  begin set local role service_role; update public.radar_classificazioni set rilevanza = 'B' where id = '00000000-0000-0000-0000-00000000c001'; exception when insufficient_privilege then n := n + 1; end;
  reset role;
  begin set local role service_role; delete from public.radar_classificazioni where id = '00000000-0000-0000-0000-00000000c001'; exception when insufficient_privilege then n := n + 1; end;
  reset role;
  begin set local role service_role; delete from public.radar_classificazioni_stato where procedura_id = '00000000-0000-0000-0000-0000000000a1'; exception when insufficient_privilege then n := n + 1; end;
  reset role;
  perform prova.verifica('permessi: anon e authenticated esclusi da classificazioni e stato; service_role non cambia il contenuto e non cancella', n = 7);
end $$;

do $$
declare n int := 0;
begin
  -- anon e authenticated non leggono né scrivono gare e provenienze (0109), e non possono eseguire la funzione delle fonti
  begin set local role anon; perform 1 from public.radar_procedure; exception when insufficient_privilege then n := n + 1; end;
  reset role;
  begin set local role authenticated; perform 1 from public.radar_procedure_fonti; exception when insufficient_privilege then n := n + 1; end;
  reset role;
  begin set local role authenticated; insert into public.radar_procedure_fonti (procedura_id, fonte, id_fonte) values ('00000000-0000-0000-0000-0000000000d1', 'ted', 'prova-anon'); exception when insufficient_privilege then n := n + 1; end;
  reset role;
  perform prova.verifica('permessi: anon e authenticated senza accesso a gare e provenienze',
    n = 3 and not has_function_privilege('anon', 'public.radar_aggiungi_fonte_alla_gara()', 'execute') and not has_function_privilege('authenticated', 'public.radar_aggiungi_fonte_alla_gara()', 'execute')
    and has_function_privilege('service_role', 'public.radar_aggiungi_fonte_alla_gara()', 'execute'));
end $$;

do $$
declare n int := 0;
begin
  set local role service_role;
  -- seconda riga attiva per la stessa gara e settore
  begin insert into public.radar_classificazioni (procedura_id, settore, rilevanza, regole, motivi, da, versione_regole, origine) values ('00000000-0000-0000-0000-0000000000a1', 'ristorazione', 'B', '{gestione_di_struttura}', '{"gestione (sintetico)"}', 'cpv', '2026-11-17c', 'importazione'); exception when unique_violation then n := n + 1; end;
  -- C con sottocategorie
  begin insert into public.radar_classificazioni (procedura_id, settore, rilevanza, sottocategorie, regole, motivi, da, versione_regole, origine) values ('00000000-0000-0000-0000-0000000000a1', 'pulizia', 'C', '{pulizia_edifici}', '{rifiuti}', '{"rifiuti (sintetico)"}', 'cpv', '2026-11-17c', 'importazione'); exception when check_violation then n := n + 1; end;
  -- amministratore senza nota
  begin insert into public.radar_classificazioni (procedura_id, settore, rilevanza, regole, motivi, da, versione_regole, origine) values ('00000000-0000-0000-0000-0000000000a1', 'pulizia', 'B', '{decisione_amministratore}', '{"decisione (sintetico)"}', 'cpv', '2026-11-17c', 'amministratore'); exception when check_violation then n := n + 1; end;
  -- forma sbagliata di una sottocategoria e settore inesistente
  begin insert into public.radar_classificazioni (procedura_id, settore, rilevanza, sottocategorie, regole, motivi, da, versione_regole, origine) values ('00000000-0000-0000-0000-0000000000a1', 'pulizia', 'A', '{"Pulizia Edifici"}', '{cpv_principale}', '{"m"}', 'cpv', '2026-11-17c', 'importazione'); exception when check_violation then n := n + 1; end;
  begin insert into public.radar_classificazioni (procedura_id, settore, rilevanza, regole, motivi, da, versione_regole, origine) values ('00000000-0000-0000-0000-0000000000a1', 'giardinaggio', 'A', '{cpv_principale}', '{"m"}', 'cpv', '2026-11-17c', 'importazione'); exception when check_violation then n := n + 1; end;
  reset role;
  perform prova.verifica('vincoli: una sola attiva per gara e settore; C senza sottocategorie; amministratore con nota; forma e settori ammessi', n = 5);
end $$;

do $$
declare n int := 0;
begin
  set local role service_role;
  -- D1: motivi mancanti, in numero diverso dalle regole, vuoti o fatti di soli spazi (anche spazi «larghi»: tabulazione e a capo)
  begin insert into public.radar_classificazioni (procedura_id, settore, rilevanza, regole, motivi, da, versione_regole, origine) values ('00000000-0000-0000-0000-0000000000a1', 'pulizia', 'A', '{cpv_principale}', '{}', 'cpv', '2026-11-17c', 'importazione'); exception when check_violation then n := n + 1; end;
  begin insert into public.radar_classificazioni (procedura_id, settore, rilevanza, regole, motivi, da, versione_regole, origine) values ('00000000-0000-0000-0000-0000000000a1', 'pulizia', 'A', '{cpv_principale,oggetto}', '{"un solo motivo"}', 'cpv', '2026-11-17c', 'importazione'); exception when check_violation then n := n + 1; end;
  begin insert into public.radar_classificazioni (procedura_id, settore, rilevanza, regole, motivi, da, versione_regole, origine) values ('00000000-0000-0000-0000-0000000000a1', 'pulizia', 'A', '{cpv_principale}', '{""}', 'cpv', '2026-11-17c', 'importazione'); exception when check_violation then n := n + 1; end;
  begin insert into public.radar_classificazioni (procedura_id, settore, rilevanza, regole, motivi, da, versione_regole, origine) values ('00000000-0000-0000-0000-0000000000a1', 'pulizia', 'A', '{cpv_principale,oggetto}', array['motivo pieno', E' \t\n '], 'cpv', '2026-11-17c', 'importazione'); exception when check_violation then n := n + 1; end;
  begin insert into public.radar_classificazioni (procedura_id, settore, rilevanza, regole, motivi, da, versione_regole, origine) values ('00000000-0000-0000-0000-0000000000a1', 'pulizia', 'A', '{cpv_principale}', '{NULL}', 'cpv', '2026-11-17c', 'importazione'); exception when check_violation then n := n + 1; end;
  -- D1: nota vuota o fatta di soli spazi, anche per l'amministratore
  begin insert into public.radar_classificazioni (procedura_id, settore, rilevanza, regole, motivi, da, versione_regole, origine, nota) values ('00000000-0000-0000-0000-0000000000a1', 'pulizia', 'B', '{decisione_amministratore}', '{"decisione (sintetico)"}', 'cpv', '2026-11-17c', 'amministratore', '   '); exception when check_violation then n := n + 1; end;
  begin insert into public.radar_classificazioni (procedura_id, settore, rilevanza, regole, motivi, da, versione_regole, origine, nota) values ('00000000-0000-0000-0000-0000000000a1', 'pulizia', 'A', '{cpv_principale}', '{"m"}', 'cpv', '2026-11-17c', 'importazione', ''); exception when check_violation then n := n + 1; end;
  -- D3: provenienze con un valore che non è A, B o C
  begin insert into public.radar_classificazioni (procedura_id, settore, rilevanza, regole, motivi, da, versione_regole, origine, per_fonte) values ('00000000-0000-0000-0000-0000000000a1', 'pulizia', 'A', '{cpv_principale}', '{"m"}', 'cpv', '2026-11-17c', 'importazione', '{"ted": "pertinente"}'); exception when check_violation then n := n + 1; end;
  reset role;
  perform prova.verifica('D1 e D3: motivi uno per regola e mai vuoti (né spazi, né null), nota mai vuota, provenienze solo A/B/C', n = 8);
end $$;

-- un motivo con spazi intorno ma pieno, e due regole con due motivi: accettati
set role service_role;
insert into public.radar_classificazioni (procedura_id, settore, rilevanza, regole, motivi, da, versione_regole, origine, per_fonte)
values ('00000000-0000-0000-0000-0000000000a1', 'pulizia', 'B', '{gestione_integrata,cpv_secondario}', array['  gestione integrata (sintetico)  ', 'CPV secondario (sintetico)'], 'cpv', '2026-11-17c', 'importazione', '{"ted": "B", "pvl": "A", "dati_uniti": "B"}');
reset role;
select prova.verifica('D1 e D3: due regole con due motivi pieni e provenienze di più fonti sono accettate',
  (select count(*) from public.radar_classificazioni where procedura_id = '00000000-0000-0000-0000-0000000000a1' and settore = 'pulizia' and attiva) = 1);

-- storico: la nuova classificazione disattiva la vecchia, poi si inserisce
set role service_role;
update public.radar_classificazioni set attiva = false, sostituita_il = now(), sostituita_da = '00000000-0000-0000-0000-00000000c002' where id = '00000000-0000-0000-0000-00000000c001' and attiva;
insert into public.radar_classificazioni (id, procedura_id, settore, rilevanza, sottocategorie, regole, motivi, da, cpv, versione_regole, origine, fonti, nota, autore)
values ('00000000-0000-0000-0000-00000000c002', '00000000-0000-0000-0000-0000000000a1', 'ristorazione', 'B', '{concessione_bar}', '{decisione_amministratore}', '{"Bar dentro la gestione del parco (prova sintetica)"}', 'cpv', '{55300000}', '2026-11-17c', 'amministratore', '{ted}', 'Bar dentro la gestione del parco (prova sintetica).', 'console:prova');
reset role;
select prova.verifica('storico: una sola attiva, la vecchia punta alla nuova e resta leggibile, con il suo contenuto intatto',
  (select count(*) from public.radar_classificazioni where procedura_id = '00000000-0000-0000-0000-0000000000a1' and settore = 'ristorazione' and attiva) = 1
  and (select sostituita_da from public.radar_classificazioni where id = '00000000-0000-0000-0000-00000000c001') = '00000000-0000-0000-0000-00000000c002'
  and (select (rilevanza, sottocategorie, motivi) = ('A', '{concessione_bar,concessione_ristorante}', '{"CPV principale 55300000 (prova sintetica)"}') from public.radar_classificazioni where id = '00000000-0000-0000-0000-00000000c001'));

do $$
declare n int := 0;
begin
  set local role service_role;
  -- una riga disattivata non si riattiva «a metà»: stato incoerente (attiva con sostituita_il)
  begin update public.radar_classificazioni set attiva = true where id = '00000000-0000-0000-0000-00000000c001'; exception when check_violation then n := n + 1; end;
  reset role;
  perform prova.verifica('storico integro: una riga sostituita non torna attiva senza togliere la traccia (vincolo di stato)', n = 1);
end $$;

-- ───── D2: stato della classificazione ─────
set role service_role;
insert into public.radar_classificazioni_stato (procedura_id, stato) values ('00000000-0000-0000-0000-0000000000a1', 'in_attesa'), ('00000000-0000-0000-0000-0000000000d1', 'in_attesa');
update public.radar_classificazioni_stato set stato = 'classificata', versione_regole = '2026-11-17c', classificata_il = now(), tentativi = tentativi + 1, tentativo_il = now(), aggiornata_il = now() where procedura_id = '00000000-0000-0000-0000-0000000000a1';
update public.radar_classificazioni_stato set stato = 'fallita', errore = 'Righe non valide (prova sintetica)', tentativi = tentativi + 1, tentativo_il = now(), aggiornata_il = now() where procedura_id = '00000000-0000-0000-0000-0000000000d1';
reset role;
select prova.verifica('D2: stati distinti nel database: classificata (con versione e data), fallita (con errore), in attesa; una gara senza stato resta «non classificata»',
  (select stato from public.radar_classificazioni_stato where procedura_id = '00000000-0000-0000-0000-0000000000a1') = 'classificata'
  and (select stato from public.radar_classificazioni_stato where procedura_id = '00000000-0000-0000-0000-0000000000d1') = 'fallita'
  and not exists (select 1 from public.radar_classificazioni_stato where procedura_id = '00000000-0000-0000-0000-0000000000e1')
  and not exists (select 1 from public.radar_classificazioni where procedura_id = '00000000-0000-0000-0000-0000000000e1'));

do $$
declare n int := 0;
begin
  set local role service_role;
  -- classificata senza versione o senza data; fallita senza errore o con errore vuoto; errore su una gara non fallita; stato inventato
  begin insert into public.radar_classificazioni_stato (procedura_id, stato, tentativo_il, classificata_il) values ('00000000-0000-0000-0000-0000000000e1', 'classificata', now(), now()); exception when check_violation then n := n + 1; end;
  begin insert into public.radar_classificazioni_stato (procedura_id, stato, tentativo_il, versione_regole) values ('00000000-0000-0000-0000-0000000000e1', 'classificata', now(), '2026-11-17c'); exception when check_violation then n := n + 1; end;
  begin insert into public.radar_classificazioni_stato (procedura_id, stato, tentativo_il) values ('00000000-0000-0000-0000-0000000000e1', 'fallita', now()); exception when check_violation then n := n + 1; end;
  begin insert into public.radar_classificazioni_stato (procedura_id, stato, tentativo_il, errore) values ('00000000-0000-0000-0000-0000000000e1', 'fallita', now(), '   '); exception when check_violation then n := n + 1; end;
  begin insert into public.radar_classificazioni_stato (procedura_id, stato, errore) values ('00000000-0000-0000-0000-0000000000e1', 'in_attesa', 'errore (sintetico)'); exception when check_violation then n := n + 1; end;
  begin insert into public.radar_classificazioni_stato (procedura_id, stato) values ('00000000-0000-0000-0000-0000000000e1', 'non_pertinente'); exception when check_violation then n := n + 1; end;
  -- una sola riga di stato per gara
  begin insert into public.radar_classificazioni_stato (procedura_id, stato) values ('00000000-0000-0000-0000-0000000000a1', 'in_attesa'); exception when unique_violation then n := n + 1; end;
  reset role;
  perform prova.verifica('D2: vincoli dello stato (versione e data per «classificata», errore pieno solo per «fallita», nessuno stato inventato, una riga per gara)', n = 7);
end $$;

-- ───── cancellazione di una gara: tutto se ne va con lei, nessun errore del trigger ─────
set role service_role;
delete from public.radar_procedure where id = '00000000-0000-0000-0000-0000000000a1';
reset role;
select prova.verifica('gara cancellata: provenienze, classificazioni e stato con lei (cascata), nessuna fonte obsoleta altrove',
  (select count(*) from public.radar_procedure_fonti where procedura_id = '00000000-0000-0000-0000-0000000000a1') = 0
  and (select count(*) from public.radar_classificazioni where procedura_id = '00000000-0000-0000-0000-0000000000a1') = 0
  and (select count(*) from public.radar_classificazioni_stato where procedura_id = '00000000-0000-0000-0000-0000000000a1') = 0
  and prova.obsolete() = 0);

select prova.verifica('FINE: nessuna fonte obsoleta in nessuna gara', prova.obsolete() = 0);
