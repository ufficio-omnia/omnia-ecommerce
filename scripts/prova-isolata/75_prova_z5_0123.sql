-- SOLO PER LA PROVA ISOLATA della SOLA 0123 (dossier Z5, documento 45): controlli dopo che la 0123 è stata applicata DUE volte sopra lo
-- stato dello staging dopo la 0128 (fotografie «prima_0123» e «dopo_0123»), con le tabelle piene come sullo staging (65_dati_z5: 2.056 righe
-- del registro, 1.947 provenienze). Parte 2 = i controlli della 0123 di 40_prova_b4.sql (righe 54–76), adattati ai conteggi.
\set ON_ERROR_STOP on
reset role;

-- ═════════════════════════════ parte 1: dipendenze e confini ═════════════════════════════
select prova.verifica('0123: la 0128 c''è (radar_esecuzioni, vuota) e la 0123 non la tocca',
  to_regclass('public.radar_esecuzioni') is not null and (select count(*) from public.radar_esecuzioni) = 0
  and not exists (select 1 from prova.differenze('prima_0123', 'dopo_0123', 'oggetto') x where x like '%radar_esecuzioni%')
  and not exists (select 1 from prova.differenze('prima_0123', 'dopo_0123', 'permesso') x where x like '%radar_esecuzioni%'));
select prova.verifica('0123: oggetti aggiunti = ESATTAMENTE 1 colonna nelle provenienze, 10 nel registro, 3 vincoli e 1 indice',
  prova.elenco_differenze('prima_0123', 'dopo_0123', 'oggetto') = array[
    '+colonna:radar_aggiornamenti.affidabilita', '+colonna:radar_aggiornamenti.avviso_precedente_id', '+colonna:radar_aggiornamenti.avviso_pubblicato_il',
    '+colonna:radar_aggiornamenti.avviso_ted', '+colonna:radar_aggiornamenti.avviso_tipo', '+colonna:radar_aggiornamenti.avviso_url', '+colonna:radar_aggiornamenti.avviso_versione',
    '+colonna:radar_aggiornamenti.dichiarazione_fonte', '+colonna:radar_aggiornamenti.esecuzione_id', '+colonna:radar_aggiornamenti.notifica_email',
    '+colonna:radar_procedure_fonti.foto',
    '+indice:radar_aggiornamenti_email_idx',
    '+vincolo:radar_aggiornamenti_evidenza_forma', '+vincolo:radar_aggiornamenti_notifica_email_ammessa', '+vincolo:radar_procedure_fonti_foto_forma']);
select prova.verifica('0123: nessuna tabella, funzione o trigger aggiunto; nessun oggetto tolto',
  not exists (select 1 from prova.differenze('prima_0123', 'dopo_0123', 'oggetto') x where x ~ '^\+(tabella|funzione|trigger):' or x like '-%'));
select prova.verifica('0123: righe di TUTTE le tabelle invariate (registro 2.056, provenienze 1.947)',
  prova.elenco_differenze('prima_0123', 'dopo_0123', 'righe') = '{}'
  and (select count(*) from public.radar_aggiornamenti) = 2056 and (select count(*) from public.radar_procedure_fonti) = 1947);
select prova.verifica('0123: impronta di TUTTE le altre tabelle invariata; registro e provenienze cambiano SOLO per le colonne nuove',
  (select array_agg(split_part(substr(x, 2), ':', 1) order by split_part(substr(x, 2), ':', 1)) from prova.differenze('prima_0123', 'dopo_0123', 'impronta') x)
    = array['radar_aggiornamenti', 'radar_aggiornamenti', 'radar_procedure_fonti', 'radar_procedure_fonti']);
select prova.verifica('0123: impronta delle righe sulle SOLE colonne di prima IDENTICA (registro e provenienze, campo per campo)',
  prova.elenco_differenze('prima_0123', 'dopo_0123', 'vecchie') = '{}');
select prova.verifica('0123: NESSUNA riscrittura del registro e delle provenienze, pur con dati (stesso file su disco prima e dopo: valori di base costanti)',
  prova.elenco_differenze('prima_0123', 'dopo_0123', 'file') = '{}');
select prova.verifica('0123: righe esistenti NON notificabili per email (notifica_email falso su tutte le 2.056) e tutte le altre colonne nuove vuote',
  (select count(*) from public.radar_aggiornamenti where notifica_email) = 0
  and (select count(*) from public.radar_aggiornamenti where notifica_email is false) = 2056
  and (select count(*) from public.radar_aggiornamenti where num_nonnulls(avviso_precedente_id, avviso_url, avviso_pubblicato_il, avviso_versione, avviso_tipo, avviso_ted,
                                                                               dichiarazione_fonte, affidabilita, esecuzione_id) > 0) = 0
  and (select count(*) from public.radar_procedure_fonti where foto is not null) = 0);
select prova.verifica('0123: tipi, nullità e valori di base delle colonne nuove',
  (select string_agg(column_name || ' ' || udt_name || ' ' || is_nullable || ' ' || coalesce(column_default, '-'), ' | ' order by ordinal_position)
     from information_schema.columns where table_schema = 'public' and table_name = 'radar_aggiornamenti'
      and column_name in ('avviso_precedente_id', 'avviso_url', 'avviso_pubblicato_il', 'avviso_versione', 'avviso_tipo', 'avviso_ted', 'dichiarazione_fonte', 'affidabilita', 'esecuzione_id', 'notifica_email'))
  = 'avviso_precedente_id text YES - | avviso_url text YES - | avviso_pubblicato_il date YES - | avviso_versione int4 YES - | avviso_tipo text YES - | avviso_ted text YES - | '
    || 'dichiarazione_fonte text YES - | affidabilita text YES - | esecuzione_id uuid YES - | notifica_email bool NO false'
  and (select udt_name || ' ' || is_nullable from information_schema.columns where table_schema = 'public' and table_name = 'radar_procedure_fonti' and column_name = 'foto') = 'jsonb YES');
select prova.verifica('0123: le colonne nuove vanno IN FONDO (l''ordine delle colonne di prima non cambia)',
  (select max(ordinal_position) from information_schema.columns where table_schema = 'public' and table_name = 'radar_aggiornamenti'
     and column_name not in ('avviso_precedente_id', 'avviso_url', 'avviso_pubblicato_il', 'avviso_versione', 'avviso_tipo', 'avviso_ted', 'dichiarazione_fonte', 'affidabilita', 'esecuzione_id', 'notifica_email'))
  < (select min(ordinal_position) from information_schema.columns where table_schema = 'public' and table_name = 'radar_aggiornamenti' and column_name = 'avviso_precedente_id'));
select prova.verifica('0123: nessuna chiave esterna nuova (esecuzione_id è una colonna di traccia, senza chiave esterna verso radar_esecuzioni)',
  (select array_agg(conname::text order by conname) from pg_constraint where contype = 'f' and conrelid in ('public.radar_aggiornamenti'::regclass, 'public.radar_procedure_fonti'::regclass))
  = array['radar_aggiornamenti_procedura_id_fkey', 'radar_procedure_fonti_procedura_id_fkey']);
select prova.verifica('0123: indice delle email PARZIALE (solo le righe con notifica_email)',
  (select indexdef from pg_indexes where schemaname = 'public' and indexname = 'radar_aggiornamenti_email_idx')
  = 'CREATE INDEX radar_aggiornamenti_email_idx ON public.radar_aggiornamenti USING btree (rilevato_il, id) WHERE notifica_email');
select prova.verifica('0123: indice unico del registro INVARIATO (gli importatori scrivono con lo stesso on conflict)',
  (select indexdef from pg_indexes where schemaname = 'public' and indexname = 'radar_aggiornamenti_unico_uidx')
  = 'CREATE UNIQUE INDEX radar_aggiornamenti_unico_uidx ON public.radar_aggiornamenti USING btree (procedura_id, tipo, campo, id_fonte) NULLS NOT DISTINCT');
select prova.verifica('0123: permessi di TUTTE le tabelle invariati (anche PUBLIC); nessun permesso di colonna sulle colonne nuove',
  prova.elenco_differenze('prima_0123', 'dopo_0123', 'permesso') = '{}' and prova.elenco_differenze('prima_0123', 'dopo_0123', 'colonna') = '{}');
select prova.verifica('0123: EXECUTE di tutte le funzioni, regole RLS e RLS invariati',
  prova.elenco_differenze('prima_0123', 'dopo_0123', 'execute') = '{}' and prova.elenco_differenze('prima_0123', 'dopo_0123', 'regola') = '{}'
  and prova.elenco_differenze('prima_0123', 'dopo_0123', 'rls') = '{}');
select prova.verifica('0123: registro e provenienze restano del SOLO server: RLS accesa, nessuna regola, anon e authenticated senza alcun permesso',
  (select bool_and(relrowsecurity) from pg_class where oid in ('public.radar_aggiornamenti'::regclass, 'public.radar_procedure_fonti'::regclass))
  and not exists (select 1 from pg_policies where schemaname = 'public' and tablename in ('radar_aggiornamenti', 'radar_procedure_fonti'))
  and not exists (select 1 from prova.permessi() x where x ~ '^(radar_aggiornamenti|radar_procedure_fonti):(anon|authenticated|PUBLIC):'));
select prova.verifica('0123: nessuna colonna nuova di persone o imprese',
  not exists (select 1 from prova.differenze('prima_0123', 'dopo_0123', 'oggetto') x where x like '+colonna:%' and x ~ '(user|utente|impresa|email_|destinatario|titolare|membro)'));

-- ═════════════════════════════ parte 2: i controlli della 0123 di 40_prova_b4.sql (stessi testi, conteggi adattati) ═════════════════════════════
set role service_role;
select prova.atteso_errore('0123: email su una gara «nuova» rifiutata', $q$insert into public.radar_aggiornamenti (procedura_id, tipo, campo, fonte, id_fonte, notificabile, affidabilita, notifica_email) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'nuova', 'x', 'ted', '000002-2026', true, 'avviso_ufficiale', true)$q$, '23514');
select prova.atteso_errore('0123: email su una riclassificazione rifiutata', $q$insert into public.radar_aggiornamenti (procedura_id, tipo, campo, fonte, id_fonte, notificabile, affidabilita, notifica_email) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'correzione_dati', 'settori', 'regole_settori', 'x', true, 'avviso_ufficiale', true)$q$, '23514');
select prova.atteso_errore('0123: email con affidabilità parziale rifiutata', $q$insert into public.radar_aggiornamenti (procedura_id, tipo, campo, fonte, id_fonte, notificabile, affidabilita, notifica_email) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'rettifica', 'oggetto', 'pvl', 'av-2', true, 'parziale', true)$q$, '23514');
select prova.atteso_errore('0123: email con affidabilità «non_verificata» rifiutata', $q$insert into public.radar_aggiornamenti (procedura_id, tipo, campo, fonte, id_fonte, notificabile, affidabilita, notifica_email) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'rettifica', 'oggetto', 'pvl', 'av-3', true, 'non_verificata', true)$q$, '23514');
select prova.atteso_errore('0123: email su una modifica non notificabile rifiutata', $q$insert into public.radar_aggiornamenti (procedura_id, tipo, campo, fonte, id_fonte, notificabile, affidabilita, notifica_email) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'proroga', 'scadenza_offerte', 'ted', '000003-2026', false, 'avviso_ufficiale', true)$q$, '23514');
select prova.atteso_errore('0123: email senza affidabilità rifiutata (coalesce)', $q$insert into public.radar_aggiornamenti (procedura_id, tipo, campo, fonte, id_fonte, notificabile, notifica_email) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'proroga', 'scadenza_offerte', 'ted', '000004-2026', true, true)$q$, '23514');
select prova.atteso_errore('0123: email su un esito rifiutata', $q$insert into public.radar_aggiornamenti (procedura_id, tipo, campo, fonte, id_fonte, notificabile, affidabilita, notifica_email) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'esito', 'stato', 'ted', '000006-2026', true, 'avviso_ufficiale', true)$q$, '23514');
select prova.atteso_errore('0123: notifica_email nullo rifiutato', $q$insert into public.radar_aggiornamenti (procedura_id, tipo, campo, fonte, id_fonte, notifica_email) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'rettifica', 'oggetto', 'pvl', 'av-4', null)$q$, '23502');
insert into public.radar_aggiornamenti (procedura_id, tipo, campo, valore_precedente, valore_nuovo, fonte, id_fonte, notificabile, avviso_precedente_id, avviso_url, avviso_pubblicato_il, avviso_versione, avviso_tipo, avviso_ted, dichiarazione_fonte, affidabilita, esecuzione_id, notifica_email)
  values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'proroga', 'scadenza_offerte@AAAAAAAAAA', '2026-12-01', '2026-12-15', 'ted', '000005-2026', true, '000001-2026', 'https://ted.europa.eu/it/notice/-/detail/000005-2026', '2026-11-19', 2, 'cn-standard', '000005-2026', 'update-add', 'avviso_ufficiale', 'e5e5e5e5-0000-4000-8000-0000000000ff', true);
select prova.verifica('0123: proroga di un lotto (lotto nel campo) con evidenza completa e identificativo del giro, notificabile per email', (select count(*) from public.radar_aggiornamenti where notifica_email and campo = 'scadenza_offerte@AAAAAAAAAA' and esecuzione_id is not null) = 1);
select prova.verifica('0123: l''identificativo del giro NON deve esistere in radar_esecuzioni (nessuna chiave esterna: il registro dei cambiamenti non dipende dal registro dei giri)',
  not exists (select 1 from public.radar_esecuzioni where id = 'e5e5e5e5-0000-4000-8000-0000000000ff'));
insert into public.radar_aggiornamenti (procedura_id, tipo, campo, fonte, id_fonte, notificabile)
  values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'proroga', 'scadenza_offerte@AAAAAAAAAA', 'ted', '000005-2026', true)
  on conflict (procedura_id, tipo, campo, id_fonte) do nothing;
select prova.verifica('0123: la scrittura degli importatori (on conflict sull''indice unico invariato) funziona e non duplica', (select count(*) from public.radar_aggiornamenti where id_fonte = '000005-2026') = 1);
insert into public.radar_aggiornamenti (procedura_id, tipo, campo, valore_precedente, valore_nuovo, fonte, id_fonte, notificabile, nota)
  values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'rettifica', 'oggetto', 'a', 'b', 'pvl', 'come-prima-1', true, 'riga scritta come oggi (evidenza spenta)');
select prova.verifica('0123: una riga scritta come OGGI (interruttore dell''evidenza spento: nessuna colonna nuova) entra e NON è notificabile per email',
  (select notifica_email is false and affidabilita is null and esecuzione_id is null from public.radar_aggiornamenti where id_fonte = 'come-prima-1'));
select prova.atteso_errore('0123: numero TED malformato', $q$insert into public.radar_aggiornamenti (procedura_id, tipo, campo, fonte, id_fonte, avviso_ted) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'rettifica', 'oggetto', 'pvl', 'av-9', 'abc')$q$, '23514');
select prova.atteso_errore('0123: affidabilità sconosciuta', $q$insert into public.radar_aggiornamenti (procedura_id, tipo, campo, fonte, id_fonte, affidabilita) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'rettifica', 'oggetto', 'pvl', 'av-10', 'certa')$q$, '23514');
select prova.atteso_errore('0123: collegamento non http', $q$insert into public.radar_aggiornamenti (procedura_id, tipo, campo, fonte, id_fonte, avviso_url) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'rettifica', 'oggetto', 'pvl', 'av-11', 'javascript:alert(1)')$q$, '23514');
select prova.atteso_errore('0123: versione fuori intervallo', $q$insert into public.radar_aggiornamenti (procedura_id, tipo, campo, fonte, id_fonte, avviso_versione) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'rettifica', 'oggetto', 'pvl', 'av-12', 1001)$q$, '23514');
select prova.atteso_errore('0123: dichiarazione della fonte oltre 60 caratteri', $q$insert into public.radar_aggiornamenti (procedura_id, tipo, campo, fonte, id_fonte, dichiarazione_fonte) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'rettifica', 'oggetto', 'pvl', 'av-13', repeat('d', 61))$q$, '23514');
insert into public.radar_procedure_fonti (procedura_id, fonte, id_fonte, foto) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'pvl', 'avviso-1', '{"versioneFoto":1,"idAvviso":"avviso-1"}');
select prova.verifica('0123: fotografia (oggetto) salvata nella provenienza', (select count(*) from public.radar_procedure_fonti where foto ->> 'idAvviso' = 'avviso-1') = 1);
select prova.atteso_errore('0123: fotografia che non è un oggetto', $q$insert into public.radar_procedure_fonti (procedura_id, fonte, id_fonte, foto) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'pvl', 'avviso-2', '[1,2]')$q$, '23514');
select prova.atteso_errore('0123: fotografia oltre 16.000 byte', $q$insert into public.radar_procedure_fonti (procedura_id, fonte, id_fonte, foto) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'pvl', 'avviso-3', jsonb_build_object('x', repeat('y', 17000)))$q$, '23514');
-- la lettura del motore (fase «eventi», motore.ts): modifiche con notifica_email dopo il cursore, con l'indice parziale
select prova.verifica('0123: la lettura del motore trova SOLO la modifica notificabile (non le 2.056 righe di prima)',
  (select count(*) from (select id, procedura_id, tipo, campo, valore_precedente, valore_nuovo, fonte, id_fonte, rilevato_il, notificabile, notifica_email, avviso_url, avviso_pubblicato_il, avviso_ted, dichiarazione_fonte, affidabilita
                           from public.radar_aggiornamenti where notifica_email = true and rilevato_il > now() - interval '2 days' order by rilevato_il, id limit 1000) m) = 1);
do $$
declare
  piano text;
begin
  piano := prova.piano('select id from public.radar_aggiornamenti where notifica_email = true and rilevato_il > now() - interval ''2 days'' order by rilevato_il, id limit 1000', true);
  raise notice 'piano  lettura del motore: %', piano;
  perform prova.verifica('0123: la lettura del motore può usare l''indice parziale delle email', piano ~ 'radar_aggiornamenti_email_idx');
end $$;
-- la lettura delle fotografie della PVL (importa-pvl-pagina.ts): per id_procedura_fonte, solo con fotografia
select prova.verifica('0123: la lettura delle fotografie della PVL funziona (colonna foto, filtro «non nulla»)',
  (select count(*) from public.radar_procedure_fonti where fonte = 'pvl' and foto is not null) = 1);
-- pulizia: le righe della prova si tolgono (lo staging non ne avrà)
delete from public.radar_aggiornamenti where id_fonte in ('000005-2026', 'come-prima-1');
delete from public.radar_procedure_fonti where id_fonte = 'avviso-1';
reset role;

-- ═════════════════════════════ parte 3: clienti (RLS, permessi) ═════════════════════════════
set role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', false);
select prova.atteso_errore('0123: un titolare non legge il registro dei cambiamenti', $q$select notifica_email from public.radar_aggiornamenti limit 1$q$, '42501');
select prova.atteso_errore('0123: un titolare non legge le fotografie', $q$select foto from public.radar_procedure_fonti limit 1$q$, '42501');
select prova.atteso_errore('0123: un titolare non scrive l''evidenza', $q$update public.radar_aggiornamenti set notifica_email = true$q$, '42501');
reset role;
set role anon;
select prova.atteso_errore('0123: anon non legge il registro dei cambiamenti', $q$select count(*) from public.radar_aggiornamenti$q$, '42501');
reset role;
select set_config('request.jwt.claim.sub', '', false);
select prova.verifica('0123: dopo la prova, registro e provenienze con le stesse righe di prima', (select count(*) from public.radar_aggiornamenti) = 2056 and (select count(*) from public.radar_procedure_fonti) = 1947);
