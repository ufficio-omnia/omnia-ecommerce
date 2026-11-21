-- SOLO PER LA PROVA ISOLATA della SOLA 0128 (dossier Z5, documento 45): controlli dopo che la 0128 è stata applicata DUE volte sopra lo
-- stato dello staging dopo Z4 (fino alla 0125, senza 0123 né 0128), con i permessi predefiniti di Supabase (05_privilegi_predefiniti_supabase)
-- e i dati sintetici con il volume dello staging (65_dati_z5). Fotografie: «prima_0128» (prima della 0128), «dopo_0128» (dopo le due volte).
-- Ogni controllo stampa «ok …»; il primo che fallisce ferma tutto (ON_ERROR_STOP).
\set ON_ERROR_STOP on
reset role;

-- ═════════════════════════════ parte 1: dipendenze e confini ═════════════════════════════
select prova.verifica('0128: la 0123 non c''è ancora (nessuna colonna notifica_email né foto, nessun indice delle email)',
  not exists (select 1 from information_schema.columns where table_schema = 'public' and ((table_name = 'radar_aggiornamenti' and column_name in ('notifica_email', 'affidabilita', 'esecuzione_id'))
                                                                                       or (table_name = 'radar_procedure_fonti' and column_name = 'foto')))
  and not exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'radar_aggiornamenti_email_idx'));
select prova.verifica('0128: oggetti aggiunti = ESATTAMENTE la tabella, le sue 21 colonne, chiave primaria, indice e i suoi vincoli (nessuna funzione, nessun trigger)',
  (select array_agg(x order by x) from prova.differenze('prima_0128', 'dopo_0128', 'oggetto') x where x like '+tabella:%') = array['+tabella:radar_esecuzioni']
  and (select count(*) from prova.differenze('prima_0128', 'dopo_0128', 'oggetto') x where x like '+colonna:radar_esecuzioni.%') = 21
  and (select array_agg(x order by x) from prova.differenze('prima_0128', 'dopo_0128', 'oggetto') x where x like '+indice:%') = array['+indice:radar_esecuzioni_fonte_idx', '+indice:radar_esecuzioni_pkey']
  and not exists (select 1 from prova.differenze('prima_0128', 'dopo_0128', 'oggetto') x where x like '+funzione:%' or x like '+trigger:%')
  and not exists (select 1 from prova.differenze('prima_0128', 'dopo_0128', 'oggetto') x where x !~ '^\+(tabella|colonna|indice|vincolo):radar_esecuzioni'));
do $$
begin
  raise notice 'piano  oggetti aggiunti dalla 0128: % (vincoli %)', (select count(*) from prova.differenze('prima_0128', 'dopo_0128', 'oggetto')),
    (select count(*) from prova.differenze('prima_0128', 'dopo_0128', 'oggetto') x where x like '+vincolo:%');
end $$;
select prova.verifica('0128: nessun oggetto tolto', not exists (select 1 from prova.differenze('prima_0128', 'dopo_0128', 'oggetto') x where x like '-%'));
select prova.verifica('0128: righe di TUTTE le tabelle che c''erano prima invariate; la tabella nuova è vuota',
  prova.elenco_differenze('prima_0128', 'dopo_0128', 'righe') = array['+radar_esecuzioni:0']);
select prova.verifica('0128: impronta (md5 di tutte le righe) di TUTTE le tabelle che c''erano prima invariata',
  (select array_agg(x) from prova.differenze('prima_0128', 'dopo_0128', 'impronta') x) = array['+radar_esecuzioni:' || md5('')]);
select prova.verifica('0128: permessi di TUTTE le altre tabelle invariati (anche PUBLIC); nessun permesso di colonna',
  not exists (select 1 from prova.differenze('prima_0128', 'dopo_0128', 'permesso') x where x not like '+radar_esecuzioni:%')
  and prova.elenco_differenze('prima_0128', 'dopo_0128', 'colonna') = '{}');
select prova.verifica('0128: EXECUTE di tutte le funzioni invariato; regole RLS invariate; RLS delle altre tabelle invariata',
  prova.elenco_differenze('prima_0128', 'dopo_0128', 'execute') = '{}'
  and prova.elenco_differenze('prima_0128', 'dopo_0128', 'regola') = '{}'
  and prova.elenco_differenze('prima_0128', 'dopo_0128', 'rls') = array['+radar_esecuzioni:true:false']);
select prova.verifica('0128: nessuna tabella esistente riscritta (stesso file su disco per tutte)',
  not exists (select 1 from prova.differenze('prima_0128', 'dopo_0128', 'file') x where x not like '+radar_esecuzioni:%'));
select prova.verifica('0128: nessuna chiave esterna DA o VERSO radar_esecuzioni (colonne di traccia senza chiave esterna)',
  not exists (select 1 from pg_constraint where contype = 'f' and (conrelid = 'public.radar_esecuzioni'::regclass or confrelid = 'public.radar_esecuzioni'::regclass)));
select prova.verifica('0128: nessun trigger sulla tabella nuova', not exists (select 1 from pg_trigger where tgrelid = 'public.radar_esecuzioni'::regclass and not tgisinternal));

-- ═════════════════════════════ parte 2: forma della tabella ═════════════════════════════
select prova.verifica('0128: colonne nell''ordine, con tipi, nullità e valori di base',
  (select string_agg(column_name || ' ' || udt_name || ' ' || is_nullable || ' ' || coalesce(column_default, '-'), ' | ' order by ordinal_position)
     from information_schema.columns where table_schema = 'public' and table_name = 'radar_esecuzioni')
  = 'id uuid NO gen_random_uuid() | fonte text NO - | modo text NO - | iniziato_il timestamptz NO - | finito_il timestamptz NO - | esito text NO - | '
    || 'finestre jsonb NO ''[]''::jsonb | fonte_richieste int4 NO 0 | fonte_byte int8 NO 0 | fonte_ms int4 NO 0 | fonte_risposte jsonb NO ''{}''::jsonb | '
    || 'db_richieste int4 NO 0 | db_ms int4 NO 0 | avvisi jsonb NO ''{}''::jsonb | gare_nuove int4 NO 0 | gare_unite int4 NO 0 | gare_aggiornate int4 NO 0 | '
    || 'rettifiche int4 NO 0 | conflitti int4 NO 0 | allarmi _text NO ''{}''::text[] | errore text YES -');
select prova.verifica('0128: nessuna colonna di persone o imprese (niente user, impresa, email, destinatario)',
  not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'radar_esecuzioni' and column_name ~ '(user|utente|impresa|email|destinatario|titolare|membro)'));
select prova.verifica('0128: indice (fonte, iniziato_il desc)',
  (select indexdef from pg_indexes where schemaname = 'public' and indexname = 'radar_esecuzioni_fonte_idx') = 'CREATE INDEX radar_esecuzioni_fonte_idx ON public.radar_esecuzioni USING btree (fonte, iniziato_il DESC)');
select prova.verifica('0128: RLS accesa e NESSUNA regola (i clienti non vedono nulla nemmeno con permessi)',
  (select relrowsecurity from pg_class where oid = 'public.radar_esecuzioni'::regclass)
  and not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'radar_esecuzioni'));
-- con i permessi PREDEFINITI di Supabase emulati: senza il «revoke» della 0128 anon e authenticated avrebbero TUTTO
select prova.verifica('0128: permessi ESATTI — anon, authenticated e PUBLIC nulla; service_role SOLO select, insert, delete (niente update, truncate, references, trigger, maintain)',
  (select array_agg(x order by x) from prova.permessi() x where x like 'radar_esecuzioni:%')
  = array['radar_esecuzioni:service_role:delete', 'radar_esecuzioni:service_role:insert', 'radar_esecuzioni:service_role:select']);
do $$
begin
  raise notice 'piano  elenco dei permessi della tabella nuova: %', (select relacl::text from pg_class where oid = 'public.radar_esecuzioni'::regclass);
end $$;

-- ═════════════════════════════ parte 3: scritture del server (service_role) e vincoli ═════════════════════════════
set role service_role;
insert into public.radar_esecuzioni (id, fonte, modo, iniziato_il, finito_il, esito)
  values ('e5e5e5e5-0000-4000-8000-000000000001', 'ted', 'incrementale', now() - interval '3 minutes', now(), 'ok');
select prova.verifica('0128: una riga minima del server con i valori di base (contatori 0, finestre [], avvisi {}, allarmi {}, errore nullo)',
  (select fonte_richieste = 0 and fonte_byte = 0 and db_richieste = 0 and gare_nuove = 0 and rettifiche = 0 and finestre = '[]'::jsonb and avvisi = '{}'::jsonb
          and fonte_risposte = '{}'::jsonb and allarmi = '{}'::text[] and errore is null from public.radar_esecuzioni where id = 'e5e5e5e5-0000-4000-8000-000000000001'));
insert into public.radar_esecuzioni (fonte, modo, iniziato_il, finito_il, esito, finestre, fonte_richieste, fonte_byte, fonte_ms, fonte_risposte, db_richieste, db_ms, avvisi,
                                     gare_nuove, gare_unite, gare_aggiornate, rettifiche, conflitti, allarmi, errore)
  values ('pvl', 'recupero', now() - interval '10 minutes', now(), 'errore', '[{"dal": "2026-11-20", "al": "2026-11-21", "dichiarati": 120, "letti": 118}]', 31, 1048576, 9000,
          '{"200": 30, "429": 1}', 12, 800, '{"letti": 118, "esclusi": {"fuori_settore": 90}}', 3, 1, 2, 1, 0, '{risorse,errori_ripetuti}', 'timeout della fonte dopo 30 s (ripulito)');
insert into public.radar_esecuzioni (fonte, modo, iniziato_il, finito_il, esito) values
  ('sintel', 'finestra', now(), now(), 'inerte'), ('sardegnacat', 'manuale', now(), now(), 'sospesa'), ('ted', 'incrementale', now(), now(), 'occupata'), ('pvl', 'incrementale', now(), now(), 'gia_eseguito');
select prova.verifica('0128: le 4 fonti, i 4 modi e i 6 esiti ammessi', (select count(*) from public.radar_esecuzioni) = 6);
select prova.atteso_errore('0128: fonte sconosciuta', $q$insert into public.radar_esecuzioni (fonte, modo, iniziato_il, finito_il, esito) values ('anac', 'incrementale', now(), now(), 'ok')$q$, '23514');
select prova.atteso_errore('0128: modo sconosciuto', $q$insert into public.radar_esecuzioni (fonte, modo, iniziato_il, finito_il, esito) values ('ted', 'totale', now(), now(), 'ok')$q$, '23514');
select prova.atteso_errore('0128: esito sconosciuto', $q$insert into public.radar_esecuzioni (fonte, modo, iniziato_il, finito_il, esito) values ('ted', 'incrementale', now(), now(), 'quasi')$q$, '23514');
select prova.atteso_errore('0128: fine prima dell''inizio', $q$insert into public.radar_esecuzioni (fonte, modo, iniziato_il, finito_il, esito) values ('ted', 'incrementale', now(), now() - interval '1 second', 'ok')$q$, '23514');
select prova.atteso_errore('0128: esito «errore» senza errore', $q$insert into public.radar_esecuzioni (fonte, modo, iniziato_il, finito_il, esito) values ('ted', 'incrementale', now(), now(), 'errore')$q$, '23514');
select prova.atteso_errore('0128: errore con esito «ok»', $q$insert into public.radar_esecuzioni (fonte, modo, iniziato_il, finito_il, esito, errore) values ('ted', 'incrementale', now(), now(), 'ok', 'x')$q$, '23514');
select prova.atteso_errore('0128: errore oltre 500 caratteri', $q$insert into public.radar_esecuzioni (fonte, modo, iniziato_il, finito_il, esito, errore) values ('ted', 'incrementale', now(), now(), 'errore', repeat('x', 501))$q$, '23514');
select prova.atteso_errore('0128: errore vuoto', $q$insert into public.radar_esecuzioni (fonte, modo, iniziato_il, finito_il, esito, errore) values ('ted', 'incrementale', now(), now(), 'errore', '')$q$, '23514');
select prova.atteso_errore('0128: contatore negativo', $q$insert into public.radar_esecuzioni (fonte, modo, iniziato_il, finito_il, esito, fonte_richieste) values ('ted', 'incrementale', now(), now(), 'ok', -1)$q$, '23514');
select prova.atteso_errore('0128: contatore nullo', $q$insert into public.radar_esecuzioni (fonte, modo, iniziato_il, finito_il, esito, rettifiche) values ('ted', 'incrementale', now(), now(), 'ok', null)$q$, '23502');
select prova.atteso_errore('0128: allarme con maiuscole', $q$insert into public.radar_esecuzioni (fonte, modo, iniziato_il, finito_il, esito, allarmi) values ('ted', 'incrementale', now(), now(), 'ok', '{Giro_Mancato}')$q$, '23514');
select prova.atteso_errore('0128: allarme con una virgola (due nomi in uno)', $q$insert into public.radar_esecuzioni (fonte, modo, iniziato_il, finito_il, esito, allarmi) values ('ted', 'incrementale', now(), now(), 'ok', array['giro_mancato,risorse'])$q$, '23514');
select prova.atteso_errore('0128: allarme vuoto', $q$insert into public.radar_esecuzioni (fonte, modo, iniziato_il, finito_il, esito, allarmi) values ('ted', 'incrementale', now(), now(), 'ok', array[''])$q$, '23514');
insert into public.radar_esecuzioni (fonte, modo, iniziato_il, finito_il, esito, allarmi)
  select 'sintel', 'incrementale', now(), now(), 'ok', array_agg('allarme_' || chr(96 + i)) from generate_series(1, 20) i;
select prova.verifica('0128: 20 allarmi ben formati accettati', exists (select 1 from public.radar_esecuzioni where cardinality(allarmi) = 20));
delete from public.radar_esecuzioni where cardinality(allarmi) = 20;
select prova.atteso_errore('0128: allarme nullo dentro l''elenco', $q$insert into public.radar_esecuzioni (fonte, modo, iniziato_il, finito_il, esito, allarmi) values ('ted', 'incrementale', now(), now(), 'ok', array['risorse', null])$q$, '23514');
select prova.atteso_errore('0128: 21 allarmi', $q$insert into public.radar_esecuzioni (fonte, modo, iniziato_il, finito_il, esito, allarmi) select 'ted', 'incrementale', now(), now(), 'ok', array_agg('allarme_' || chr(96 + i)) from generate_series(1, 21) i$q$, '23514');
select prova.atteso_errore('0128: finestre che non sono un elenco né un oggetto', $q$insert into public.radar_esecuzioni (fonte, modo, iniziato_il, finito_il, esito, finestre) values ('ted', 'incrementale', now(), now(), 'ok', '"x"')$q$, '23514');
select prova.atteso_errore('0128: risposte della fonte come elenco', $q$insert into public.radar_esecuzioni (fonte, modo, iniziato_il, finito_il, esito, fonte_risposte) values ('ted', 'incrementale', now(), now(), 'ok', '[200]')$q$, '23514');
select prova.atteso_errore('0128: avvisi oltre 20.000 byte', $q$insert into public.radar_esecuzioni (fonte, modo, iniziato_il, finito_il, esito, avvisi) values ('ted', 'incrementale', now(), now(), 'ok', jsonb_build_object('x', repeat('y', 20001)))$q$, '23514');
select prova.atteso_errore('0128: risposte della fonte oltre 2.000 byte', $q$insert into public.radar_esecuzioni (fonte, modo, iniziato_il, finito_il, esito, fonte_risposte) values ('ted', 'incrementale', now(), now(), 'ok', jsonb_build_object('x', repeat('y', 2001)))$q$, '23514');
select prova.atteso_errore('0128: il server NON modifica una riga del registro (niente update)', $q$update public.radar_esecuzioni set esito = 'ok' where fonte = 'pvl'$q$, '42501');
select prova.atteso_errore('0128: il server NON svuota il registro (niente truncate)', $q$truncate public.radar_esecuzioni$q$, '42501');
-- conservazione: 90 giorni di giri (circa 11 al giorno, 4 fonti), poi la cancellazione del giro, fonte per fonte, con l'indice
insert into public.radar_esecuzioni (fonte, modo, iniziato_il, finito_il, esito)
select (array['ted', 'pvl', 'sintel', 'sardegnacat'])[1 + g % 4], 'incrementale', now() - make_interval(hours => g * 3), now() - make_interval(hours => g * 3) + interval '2 minutes', 'ok'
  from generate_series(1, 1200) g;
reset role;
analyze public.radar_esecuzioni;
set role service_role;
do $$
declare
  piano text;
begin
  piano := prova.piano('delete from public.radar_esecuzioni where fonte = ''ted'' and iniziato_il < now() - interval ''90 days''', false);
  raise notice 'piano  cancellazione oltre i 90 giorni (fonte ted, 1.200 giri in tabella): %', piano;
  piano := prova.piano('delete from public.radar_esecuzioni where fonte = ''ted'' and iniziato_il < now() - interval ''90 days''', true);
  perform prova.verifica('0128: la cancellazione oltre i 90 giorni di UNA fonte può usare l''indice (fonte, iniziato_il)', piano ~ 'radar_esecuzioni_fonte_idx');
  piano := prova.piano('select id, esito, allarmi from public.radar_esecuzioni where fonte = ''pvl'' order by iniziato_il desc limit 20', false);
  raise notice 'piano  ultimi 20 giri di una fonte: %', piano;
  perform prova.verifica('0128: gli ultimi giri di una fonte si leggono con l''indice', piano ~ 'radar_esecuzioni_fonte_idx');
end $$;
delete from public.radar_esecuzioni where fonte = 'ted' and iniziato_il < now() - interval '90 days';
select prova.verifica('0128: la cancellazione di una fonte tocca SOLO quella fonte e solo oltre i 90 giorni',
  not exists (select 1 from public.radar_esecuzioni where fonte = 'ted' and iniziato_il < now() - interval '90 days')
  and exists (select 1 from public.radar_esecuzioni where fonte = 'pvl' and iniziato_il < now() - interval '90 days')
  and exists (select 1 from public.radar_esecuzioni where fonte = 'ted' and iniziato_il >= now() - interval '90 days'));
reset role;

-- ═════════════════════════════ parte 4: clienti (RLS, permessi) — il registro dei giri non è dei clienti ═════════════════════════════
set role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', false);
select prova.atteso_errore('0128: un titolare non legge il registro dei giri', $q$select count(*) from public.radar_esecuzioni$q$, '42501');
select prova.atteso_errore('0128: un titolare non scrive nel registro dei giri', $q$insert into public.radar_esecuzioni (fonte, modo, iniziato_il, finito_il, esito) values ('ted', 'manuale', now(), now(), 'ok')$q$, '42501');
select prova.atteso_errore('0128: un titolare non cancella il registro dei giri', $q$delete from public.radar_esecuzioni$q$, '42501');
select set_config('request.jwt.claim.sub', '33333333-3333-4333-8333-333333333333', false);
select prova.atteso_errore('0128: un Ufficio Gare non legge il registro dei giri', $q$select count(*) from public.radar_esecuzioni$q$, '42501');
reset role;
set role anon;
select prova.atteso_errore('0128: anon non legge il registro dei giri', $q$select count(*) from public.radar_esecuzioni$q$, '42501');
reset role;
select set_config('request.jwt.claim.sub', '', false);

-- pulizia: la tabella torna vuota come sarà sullo staging dopo la 0128 (nessun codice la scrive ancora)
delete from public.radar_esecuzioni;
select prova.verifica('0128: tabella di nuovo vuota dopo la prova', (select count(*) from public.radar_esecuzioni) = 0);
