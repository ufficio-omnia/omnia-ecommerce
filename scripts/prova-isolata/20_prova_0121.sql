-- SOLO PER LA PROVA ISOLATA, dopo l'applicazione della 0121 (anche due volte, per l'idempotenza). Dati SINTETICI.
-- Le operazioni si fanno come service_role, il ruolo con cui scrive il server; le verifiche come amministratore del contenitore.
\set ON_ERROR_STOP on

-- ───── la 0121 applicata ─────
select prova.verifica('0121: riallineamento una tantum, nessuna fonte obsoleta', prova.obsolete() = 0 and prova.fonti('00000000-0000-0000-0000-0000000000b1') = '{}');
select prova.verifica('0121: settori, metodo, oggetto e chiave delle gare invariati',
  (select count(*) from public.radar_procedure p join prova.prima v using (id) where (p.chiave, p.oggetto, p.settori, p.metodo_settore) is distinct from (v.chiave, v.oggetto, v.settori, v.metodo_settore)) = 0);
select prova.verifica('0121: un solo trigger sulle provenienze, quello nuovo, anche sulla cancellazione',
  (select count(*) from pg_trigger where tgrelid = 'public.radar_procedure_fonti'::regclass and not tgisinternal) = 1
  and exists (select 1 from pg_trigger where tgname = 'radar_procedure_fonti_allinea_fonti' and pg_get_triggerdef(oid) like '%INSERT OR DELETE OR UPDATE OF procedura_id, fonte%'));
select prova.verifica('0121: la funzione della 0120 non esiste più; la nuova è security invoker con search_path fisso',
  not exists (select 1 from pg_proc where proname = 'radar_aggiungi_fonte_alla_gara')
  and exists (select 1 from pg_proc where proname = 'radar_allinea_fonti_della_gara' and not prosecdef and proconfig = '{search_path=public}'));
select prova.verifica('0121: la tabella delle classificazioni nasce vuota', (select count(*) from public.radar_classificazioni) = 0);

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

-- ───── classificazioni: permessi, vincoli, storico ─────
set role service_role;
insert into public.radar_classificazioni (id, procedura_id, settore, livello, sottocategorie, regole, motivi, da, cpv, versione_regole, origine, fonti, autore)
values ('00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000a1', 'ristorazione', 'A', '{concessione_bar,concessione_ristorante}', '{cpv_principale}', '{"CPV principale 55300000 (prova sintetica)"}', 'cpv', '{55300000}', '2026-11-17c', 'riclassificazione', '{ted}', 'riclassificazione:prova');
reset role;
select prova.verifica('classificazioni: service_role inserisce, con più sottocategorie nello stesso settore',
  (select sottocategorie from public.radar_classificazioni where id = '00000000-0000-0000-0000-00000000c001') = '{concessione_bar,concessione_ristorante}');

do $$
declare n int := 0;
begin
  -- anon e authenticated: nessun accesso
  begin set local role anon; perform 1 from public.radar_classificazioni; exception when insufficient_privilege then n := n + 1; end;
  reset role;
  begin set local role authenticated; insert into public.radar_classificazioni (procedura_id, settore, livello, regole, da, versione_regole, origine) values ('00000000-0000-0000-0000-0000000000a1', 'pulizia', 'A', '{cpv_principale}', 'cpv', '2026-11-17c', 'importazione'); exception when insufficient_privilege then n := n + 1; end;
  reset role;
  -- service_role: non può cambiare il contenuto né cancellare
  begin set local role service_role; update public.radar_classificazioni set livello = 'B' where id = '00000000-0000-0000-0000-00000000c001'; exception when insufficient_privilege then n := n + 1; end;
  reset role;
  begin set local role service_role; delete from public.radar_classificazioni where id = '00000000-0000-0000-0000-00000000c001'; exception when insufficient_privilege then n := n + 1; end;
  reset role;
  perform prova.verifica('permessi: anon e authenticated esclusi; service_role non cambia il contenuto e non cancella', n = 4);
end $$;

do $$
declare n int := 0;
begin
  set local role service_role;
  -- seconda riga attiva per la stessa gara e settore
  begin insert into public.radar_classificazioni (procedura_id, settore, livello, regole, da, versione_regole, origine) values ('00000000-0000-0000-0000-0000000000a1', 'ristorazione', 'B', '{gestione_di_struttura}', 'cpv', '2026-11-17c', 'importazione'); exception when unique_violation then n := n + 1; end;
  -- livello C con sottocategorie
  begin insert into public.radar_classificazioni (procedura_id, settore, livello, sottocategorie, regole, da, versione_regole, origine) values ('00000000-0000-0000-0000-0000000000a1', 'pulizia', 'C', '{pulizia_edifici}', '{rifiuti}', 'cpv', '2026-11-17c', 'importazione'); exception when check_violation then n := n + 1; end;
  -- amministratore senza nota
  begin insert into public.radar_classificazioni (procedura_id, settore, livello, regole, da, versione_regole, origine) values ('00000000-0000-0000-0000-0000000000a1', 'pulizia', 'B', '{decisione_amministratore}', 'cpv', '2026-11-17c', 'amministratore'); exception when check_violation then n := n + 1; end;
  -- forma sbagliata di una sottocategoria e settore inesistente
  begin insert into public.radar_classificazioni (procedura_id, settore, livello, sottocategorie, regole, da, versione_regole, origine) values ('00000000-0000-0000-0000-0000000000a1', 'pulizia', 'A', '{"Pulizia Edifici"}', '{cpv_principale}', 'cpv', '2026-11-17c', 'importazione'); exception when check_violation then n := n + 1; end;
  begin insert into public.radar_classificazioni (procedura_id, settore, livello, regole, da, versione_regole, origine) values ('00000000-0000-0000-0000-0000000000a1', 'giardinaggio', 'A', '{cpv_principale}', 'cpv', '2026-11-17c', 'importazione'); exception when check_violation then n := n + 1; end;
  reset role;
  perform prova.verifica('vincoli: una sola attiva per gara e settore; C senza sottocategorie; amministratore con nota; forma e settori ammessi', n = 5);
end $$;

-- storico: la nuova classificazione disattiva la vecchia, poi si inserisce
set role service_role;
update public.radar_classificazioni set attiva = false, sostituita_il = now(), sostituita_da = '00000000-0000-0000-0000-00000000c002' where id = '00000000-0000-0000-0000-00000000c001' and attiva;
insert into public.radar_classificazioni (id, procedura_id, settore, livello, sottocategorie, regole, motivi, da, cpv, versione_regole, origine, fonti, nota, autore)
values ('00000000-0000-0000-0000-00000000c002', '00000000-0000-0000-0000-0000000000a1', 'ristorazione', 'B', '{concessione_bar}', '{decisione_amministratore}', '{"Bar dentro la gestione del parco (prova sintetica)"}', 'cpv', '{55300000}', '2026-11-17c', 'amministratore', '{ted}', 'Bar dentro la gestione del parco (prova sintetica).', 'console:prova');
reset role;
select prova.verifica('storico: una sola attiva, la vecchia punta alla nuova e resta leggibile',
  (select count(*) from public.radar_classificazioni where procedura_id = '00000000-0000-0000-0000-0000000000a1' and attiva) = 1
  and (select sostituita_da from public.radar_classificazioni where id = '00000000-0000-0000-0000-00000000c001') = '00000000-0000-0000-0000-00000000c002');

-- ───── cancellazione di una gara: tutto se ne va con lei, nessun errore del trigger ─────
set role service_role;
delete from public.radar_procedure where id = '00000000-0000-0000-0000-0000000000a1';
reset role;
select prova.verifica('gara cancellata: provenienze e classificazioni con lei (cascata), nessuna fonte obsoleta altrove',
  (select count(*) from public.radar_procedure_fonti where procedura_id = '00000000-0000-0000-0000-0000000000a1') = 0
  and (select count(*) from public.radar_classificazioni where procedura_id = '00000000-0000-0000-0000-0000000000a1') = 0
  and prova.obsolete() = 0);

select prova.verifica('FINE: nessuna fonte obsoleta in nessuna gara', prova.obsolete() = 0);
