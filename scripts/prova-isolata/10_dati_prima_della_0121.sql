-- SOLO PER LA PROVA ISOLATA. Dati SINTETICI scritti dopo la 0120 e PRIMA della 0121, con il trigger della 0120 (che aggiunge soltanto):
-- una provenienza spostata lascia una fonte obsoleta sulla gara di origine. La 0121 deve riallinearla e non toccare nient'altro.
\set ON_ERROR_STOP on

insert into public.radar_procedure (id, chiave, oggetto, settori, metodo_settore) values
  ('00000000-0000-0000-0000-0000000000a1', 'ted:proc-prova-A', 'Servizio di ristorazione scolastica (prova sintetica)', '{ristorazione}', 'cpv'),
  ('00000000-0000-0000-0000-0000000000b1', 'sardegnacat:9000001', 'Servizio di ristorazione scolastica (prova sintetica)', '{ristorazione}', 'cpv'),
  ('00000000-0000-0000-0000-0000000000c1', 'ted:proc-prova-C', 'Servizio di pulizia degli uffici (prova sintetica)', '{pulizia}', 'cpv');

set role service_role;
insert into public.radar_procedure_fonti (procedura_id, fonte, id_fonte, impronta) values
  ('00000000-0000-0000-0000-0000000000a1', 'ted', '900001-2026', 'imp-1'),
  ('00000000-0000-0000-0000-0000000000b1', 'sardegnacat', '9000001', 'imp-2'),
  ('00000000-0000-0000-0000-0000000000c1', 'ted', '900003-2026', 'imp-3');
-- la nuova lettura di SardegnaCAT va alla gara A (come dopo un'unione): con la 0120 la gara B conserva «sardegnacat»
insert into public.radar_procedure_fonti (procedura_id, fonte, id_fonte, impronta) values
  ('00000000-0000-0000-0000-0000000000a1', 'sardegnacat', '9000001', 'imp-2b')
  on conflict (fonte, id_fonte) do update set procedura_id = excluded.procedura_id, fonte = excluded.fonte, impronta = excluded.impronta;
reset role;

select prova.verifica('prima della 0121: il trigger della 0120 lascia UNA fonte obsoleta (gara B)', prova.obsolete() = 1 and prova.fonti('00000000-0000-0000-0000-0000000000b1') = '{sardegnacat}');
-- impronta delle colonne che la 0121 NON deve toccare (settori, metodo, oggetto, chiave) per il confronto dopo
create table prova.prima as select id, chiave, oggetto, settori, metodo_settore from public.radar_procedure;
-- tutti gli oggetti dello schema prima della 0121: dopo devono esserci ancora tutti (migrazione non distruttiva)
create table prova.oggetti_prima as select x as oggetto from prova.oggetti_ora() x;
select prova.verifica('prima della 0121: c''è il trigger della 0120 con la sua funzione',
  exists (select 1 from prova.oggetti_prima where oggetto = 'trigger:radar_procedure_fonti.radar_procedure_fonti_aggiunge_fonte')
  and exists (select 1 from prova.oggetti_prima where oggetto = 'funzione:radar_aggiungi_fonte_alla_gara'));
