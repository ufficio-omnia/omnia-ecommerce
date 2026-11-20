-- SOLO PER LA PROVA ISOLATA della SOLA 0125 (dossier Z4, documento 44): controlli dopo che la 0125 è stata applicata DUE volte sopra l'albero
-- del commit dedicato (staging dopo Z2: fino alla 0124, SENZA la 0123), con le 5 righe sintetiche delle preferenze della 0124.
-- Utenti sintetici di 35_dati_b4.sql: T1 = 11111111…, M1 = 33333333… (Ufficio Gare attivo di T1), T2 = 22222222… (email non confermata),
-- M2 = 44444444… (Ufficio Gare SOSPESO di T2), T3 = 55555555… (senza Radar, bloccato). P1 = aaaaaaaa….
-- Ogni controllo stampa «ok …»; il primo che fallisce ferma tutto (ON_ERROR_STOP).
-- Parte 1: dipendenze e confini (questo file); parte 2: i controlli della 0125 di 40_prova_b4.sql (stessi testi); parte 3: sicurezza,
-- isolamento tra imprese e presa in carico concorrente con la condizione VERA del motore (O1).
\set ON_ERROR_STOP on
reset role;

-- ═════════════════════════════ parte 1: dipendenze e confini ═════════════════════════════
select prova.verifica('0125 senza 0123: nessun oggetto della 0123 (colonne notifica_email e foto, indice delle email del registro)',
  not exists (select 1 from information_schema.columns where table_schema = 'public' and ((table_name = 'radar_aggiornamenti' and column_name in ('notifica_email', 'affidabilita', 'avviso_url'))
                                                                                       or (table_name = 'radar_procedure_fonti' and column_name = 'foto')))
  and not exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'radar_aggiornamenti_email_idx'));
select prova.verifica('0125: tabelle aggiunte = ESATTAMENTE eventi, consegne e giri',
  (select array_agg(x order by x) from (select * from prova.oggetti_ora() except select * from prova.oggetti_prima_0125) d (x) where x like 'tabella:%')
  = array['tabella:omnia_ai_radar_email_consegne', 'tabella:omnia_ai_radar_eventi', 'tabella:radar_notifiche_giri']);
select prova.verifica('0125: funzioni aggiunte = ESATTAMENTE separazione, destinatari, conteggi, stato del passaggio (O2)',
  (select array_agg(x order by x) from (select * from prova.oggetti_ora() except select * from prova.oggetti_prima_0125) d (x) where x like 'funzione:%')
  = array['funzione:radar_consegna_separazione', 'funzione:radar_email_conteggi', 'funzione:radar_notifiche_destinatari', 'funzione:radar_notifiche_stato_passaggio']);
select prova.verifica('0125: un solo trigger aggiunto (separazione delle consegne)',
  (select array_agg(x order by x) from (select * from prova.oggetti_ora() except select * from prova.oggetti_prima_0125) d (x) where x like 'trigger:%')
  = array['trigger:omnia_ai_radar_email_consegne.omnia_ai_radar_email_consegne_separazione']);
select prova.verifica('0125: ogni colonna, indice e vincolo aggiunto appartiene alle tre tabelle nuove',
  not exists (select 1 from (select * from prova.oggetti_ora() except select * from prova.oggetti_prima_0125) d (x)
               where x !~ '^(tabella|funzione|trigger):' and x !~ '(omnia_ai_radar_eventi|omnia_ai_radar_email_consegne|radar_notifiche_giri)'));
do $$
begin
  raise notice 'piano  oggetti aggiunti dalla 0125: %', (select count(*) from (select * from prova.oggetti_ora() except select * from prova.oggetti_prima_0125) d);
end $$;
select prova.verifica('0125: nessun oggetto tolto', not exists (select * from prova.oggetti_prima_0125 except select * from prova.oggetti_ora()));
select prova.verifica('0125: righe di dati di TUTTE le tabelle che c''erano prima invariate',
  not exists (select 1 from prova.righe_prima_0125 p left join prova.righe() a using (tabella) where a.n is distinct from p.n));
select prova.verifica('0125: le tre tabelle nuove sono vuote', (select count(*) from public.omnia_ai_radar_eventi) = 0 and (select count(*) from public.omnia_ai_radar_email_consegne) = 0 and (select count(*) from public.radar_notifiche_giri) = 0);
select prova.verifica('0125: le 5 righe delle preferenze (0124) identiche, campo per campo',
  (select count(*) from public.omnia_ai_radar_notifiche_impresa) + (select count(*) from public.omnia_ai_radar_notifiche_persone) = 5
  and (select impronta from prova.preferenze_prima_0125) = md5(coalesce((select string_agg(t::text, '|' order by t::text) from public.omnia_ai_radar_notifiche_impresa t), '') || '#' ||
                                                              coalesce((select string_agg(t::text, '|' order by t::text) from public.omnia_ai_radar_notifiche_persone t), '')));
select prova.verifica('0125: RLS accesa sulle tre tabelle, NESSUNA regola per i clienti',
  (select bool_and(c.relrowsecurity) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname in ('omnia_ai_radar_eventi', 'omnia_ai_radar_email_consegne', 'radar_notifiche_giri'))
  and not exists (select 1 from pg_policies where schemaname = 'public' and tablename in ('omnia_ai_radar_eventi', 'omnia_ai_radar_email_consegne', 'radar_notifiche_giri')));
do $$
declare
  t text;
  r text;
  p text;
  sbagliati text[] := '{}';
begin
  foreach t in array array['omnia_ai_radar_eventi', 'omnia_ai_radar_email_consegne', 'radar_notifiche_giri'] loop
    foreach r in array array['anon', 'authenticated', 'service_role'] loop
      foreach p in array array['select', 'insert', 'update', 'delete', 'truncate', 'references', 'trigger'] loop
        if has_table_privilege(r, 'public.' || t, p) is distinct from (r = 'service_role' and p in ('select', 'insert', 'update', 'delete')) then
          sbagliati := sbagliati || (r || ':' || t || ':' || p);
        end if;
      end loop;
    end loop;
  end loop;
  perform prova.verifica('0125: permessi esatti — anon e authenticated NULLA; service_role select, insert, update, delete; truncate a nessuno (' || coalesce(array_to_string(sbagliati, ', '), '') || ')', cardinality(sbagliati) = 0);
end $$;
select prova.verifica('0125: funzioni — destinatari DEFINER (legge auth.users), conteggi e stato del passaggio INVOKER; tutte con search_path fisso',
  (select bool_and(case p.proname when 'radar_notifiche_destinatari' then p.prosecdef else not p.prosecdef end and p.proconfig is not null)
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('radar_notifiche_destinatari', 'radar_email_conteggi', 'radar_notifiche_stato_passaggio', 'radar_consegna_separazione')));
select prova.verifica('0125: EXECUTE di destinatari, conteggi e stato del passaggio SOLO a service_role',
  (select bool_and(has_function_privilege('service_role', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute') and not has_function_privilege('authenticated', p.oid, 'execute'))
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('radar_notifiche_destinatari', 'radar_email_conteggi', 'radar_notifiche_stato_passaggio')));
select prova.verifica('0125: «nuove_in_sospeso» (3.3 A) uuid[] non nullo, vuoto di base, al più 2000 (vincolo)',
  (select data_type = 'ARRAY' and udt_name = '_uuid' and is_nullable = 'NO' and column_default like '''{}''%' from information_schema.columns
    where table_schema = 'public' and table_name = 'radar_notifiche_giri' and column_name = 'nuove_in_sospeso')
  and exists (select 1 from pg_constraint where conrelid = 'public.radar_notifiche_giri'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%cardinality(nuove_in_sospeso) <= 2000%'));
-- isolamento tra imprese nella funzione dei destinatari: una richiesta per l'impresa 1 non dà MAI persone dell'impresa 2, e viceversa
select prova.verifica('0125 isolamento: destinatari dell''impresa 1 = SOLO il suo titolare e il suo Ufficio Gare',
  (select coalesce(bool_and(impresa_id = '11111111-1111-4111-8111-111111111111' and user_id in ('11111111-1111-4111-8111-111111111111', '33333333-3333-4333-8333-333333333333')), false)
     from public.radar_notifiche_destinatari(array['11111111-1111-4111-8111-111111111111']::uuid[])));
select prova.verifica('0125 isolamento: con due imprese ogni persona sta SOLO con la sua impresa (titolare = impresa; membro del titolare giusto)',
  not exists (select 1 from public.radar_notifiche_destinatari(array['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222']::uuid[]) d
               where (d.ruolo = 'titolare' and d.user_id <> d.impresa_id)
                  or (d.ruolo = 'ufficio_gare' and not exists (select 1 from public.omnia_ai_membri m where m.membro_id = d.user_id and m.titolare_id = d.impresa_id))));

-- ═════════════════════════════ parte 2: i controlli della 0125 di 40_prova_b4.sql (righe 104–203, stessi testi) ═════════════════════════════
-- ═════════════════════════════ 0125: eventi, consegne, giri, funzioni ═════════════════════════════
set role service_role;
insert into public.omnia_ai_radar_eventi (id, impresa_id, categoria, tipo, gara_chiave, procedura_id, versione, dati)
  values ('eeeeeeee-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'scadenze', 'scadenza_1', 'p:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '2026-12-02', '{"tipo":"scadenza_1"}');
select prova.atteso_errore('0125: categoria e tipo incoerenti', $q$insert into public.omnia_ai_radar_eventi (impresa_id, categoria, tipo, gara_chiave, versione, dati) values ('11111111-1111-4111-8111-111111111111', 'scadenze', 'rettifica', 'p:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'x', '{}')$q$, '23514');
select prova.atteso_errore('0125: riepilogo con la chiave di una gara', $q$insert into public.omnia_ai_radar_eventi (impresa_id, categoria, tipo, gara_chiave, versione, dati) values ('11111111-1111-4111-8111-111111111111', 'nuove_opportunita', 'riepilogo_opportunita', 'p:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '2026-12-01', '{}')$q$, '23514');
select prova.atteso_errore('0125: evento annullato senza motivo', $q$insert into public.omnia_ai_radar_eventi (impresa_id, categoria, tipo, gara_chiave, versione, dati, stato, annullato_il) values ('11111111-1111-4111-8111-111111111111', 'scadenze', 'scadenza_5', 'p:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'x', '{}', 'annullato', now())$q$, '23514');
select prova.atteso_errore('0125: dati mancanti senza compattazione', $q$insert into public.omnia_ai_radar_eventi (impresa_id, categoria, tipo, gara_chiave, versione) values ('11111111-1111-4111-8111-111111111111', 'scadenze', 'scadenza_5', 'p:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'y')$q$, '23514');
select prova.atteso_errore('0125: evento per un''impresa senza Radar', $q$insert into public.omnia_ai_radar_eventi (impresa_id, categoria, tipo, gara_chiave, versione, dati) values ('55555555-5555-4555-8555-555555555555', 'scadenze', 'scadenza_5', 'p:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'z', '{}')$q$, '23503');
insert into public.omnia_ai_radar_eventi (impresa_id, categoria, tipo, gara_chiave, versione, dati) values
  ('11111111-1111-4111-8111-111111111111', 'scadenze', 'scadenza_1', 'p:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '2026-12-02', '{}'),
  ('11111111-1111-4111-8111-111111111111', 'rettifiche', 'proroga', 'p:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'scadenza:2026-12-15', '{}')
  on conflict (impresa_id, gara_chiave, tipo, versione) do nothing;
select prova.verifica('0125: deduplica forte degli eventi (chiave NON parziale): un blocco con un doppione non fallisce e aggiunge solo il nuovo', (select count(*) from public.omnia_ai_radar_eventi) = 2);
insert into public.omnia_ai_radar_eventi (impresa_id, categoria, tipo, gara_chiave, versione, dati) values
  ('11111111-1111-4111-8111-111111111111', 'scadenze', 'scadenza_1', 'p:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '2026-12-10T11:00:00.000Z', '{}');
select prova.verifica('0125: due scadenze distinte della stessa gara (lotti) = due eventi', (select count(*) from public.omnia_ai_radar_eventi where tipo = 'scadenza_1') = 2);

insert into public.omnia_ai_radar_email_consegne (id, evento_id, impresa_id, destinatario_id, ruolo, chiave, priorita)
  values ('cccccccc-0000-4000-8000-000000000001', 'eeeeeeee-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111', 'titolare', '11111111:p:aaaa:scadenza_1:2026-12-02', 1),
         ('cccccccc-0000-4000-8000-000000000002', 'eeeeeeee-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', '33333333-3333-4333-8333-333333333333', 'ufficio_gare', '33333333:p:aaaa:scadenza_1:2026-12-02', 1);
select prova.verifica('0125: consegne a titolare e Ufficio Gare attivo della stessa impresa', (select count(*) from public.omnia_ai_radar_email_consegne) = 2);
select prova.verifica('0125: chiave di idempotenza generata e immutabile = omnia-radar/<id>', (select bool_and(chiave_idempotenza = 'omnia-radar/' || id::text) from public.omnia_ai_radar_email_consegne));
select prova.atteso_errore('0125: chiave di idempotenza non scrivibile', $q$update public.omnia_ai_radar_email_consegne set chiave_idempotenza = 'x'$q$, '428C9');
select prova.atteso_errore('0125: «titolare» che non è l''impresa', $q$insert into public.omnia_ai_radar_email_consegne (evento_id, impresa_id, destinatario_id, ruolo, chiave, priorita) values ('eeeeeeee-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', '33333333-3333-4333-8333-333333333333', 'titolare', 'k-titolare-falso', 1)$q$, '23514');
select prova.atteso_errore('0125: Ufficio Gare SOSPESO di un''altra impresa', $q$insert into public.omnia_ai_radar_email_consegne (evento_id, impresa_id, destinatario_id, ruolo, chiave, priorita) values ('eeeeeeee-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', '44444444-4444-4444-8444-444444444444', 'ufficio_gare', 'k-membro-altro', 1)$q$, '23514');
select prova.atteso_errore('0125: consegna di un''impresa diversa da quella dell''evento', $q$insert into public.omnia_ai_radar_email_consegne (evento_id, impresa_id, destinatario_id, ruolo, chiave, priorita) values ('eeeeeeee-0000-4000-8000-000000000001', '22222222-2222-4222-8222-222222222222', '22222222-2222-4222-8222-222222222222', 'titolare', 'k-impresa-diversa', 1)$q$, '23514');
select prova.atteso_errore('0125: stessa chiave due volte (deduplica forte per destinatario, gara, tipo, versione)', $q$insert into public.omnia_ai_radar_email_consegne (evento_id, impresa_id, destinatario_id, ruolo, chiave, priorita) values ('eeeeeeee-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111', 'titolare', '11111111:p:aaaa:scadenza_1:2026-12-02', 1)$q$, '23505');
insert into public.omnia_ai_radar_email_consegne (evento_id, impresa_id, destinatario_id, ruolo, chiave, priorita) values
  ('eeeeeeee-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111', 'titolare', '11111111:p:aaaa:scadenza_1:2026-12-02', 1)
  on conflict (chiave) do nothing;
select prova.verifica('0125: on conflict sulla chiave (non parziale) non duplica', (select count(*) from public.omnia_ai_radar_email_consegne) = 2);
select prova.atteso_errore('0125: consegna singola senza evento', $q$insert into public.omnia_ai_radar_email_consegne (impresa_id, destinatario_id, ruolo, chiave, priorita) values ('11111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111', 'titolare', 'k-senza-evento', 1)$q$, '23514');
insert into public.omnia_ai_radar_email_consegne (id, tipo_consegna, impresa_id, destinatario_id, ruolo, chiave, priorita)
  values ('cccccccc-0000-4000-8000-0000000000a1', 'raggruppata', '11111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111', 'titolare', '11111111:raggruppamento:abc', 1);
update public.omnia_ai_radar_email_consegne set stato = 'inclusa', inclusa_in = 'cccccccc-0000-4000-8000-0000000000a1' where id = 'cccccccc-0000-4000-8000-000000000001';
select prova.verifica('0125: consegna del titolare inclusa nel SUO raggruppamento', (select stato from public.omnia_ai_radar_email_consegne where id = 'cccccccc-0000-4000-8000-000000000001') = 'inclusa');
select prova.atteso_errore('0125: consegna inclusa nel raggruppamento di un''altra persona', $q$update public.omnia_ai_radar_email_consegne set stato = 'inclusa', inclusa_in = 'cccccccc-0000-4000-8000-0000000000a1' where id = 'cccccccc-0000-4000-8000-000000000002'$q$, '23514');
select prova.atteso_errore('0125: stato «inclusa» senza raggruppamento', $q$update public.omnia_ai_radar_email_consegne set stato = 'inclusa' where id = 'cccccccc-0000-4000-8000-000000000002'$q$, '23514');
select prova.atteso_errore('0125: «inviata» senza provider e senza id', $q$update public.omnia_ai_radar_email_consegne set stato = 'inviata' where id = 'cccccccc-0000-4000-8000-000000000002'$q$, '23514');
select prova.atteso_errore('0125: «fallita» senza motivo', $q$update public.omnia_ai_radar_email_consegne set stato = 'fallita', chiusa_il = now() where id = 'cccccccc-0000-4000-8000-000000000002'$q$, '23514');

insert into public.radar_notifiche_giri (giorno_roma, fase, in_corso_fino_il, ambiente, provider) values (current_date, 'eventi', now() + interval '10 minutes', 'locale', 'finto');
select prova.atteso_errore('0125: un secondo giro in corso rifiutato (uno alla volta)', $q$insert into public.radar_notifiche_giri (giorno_roma, fase, in_corso_fino_il, ambiente, provider) values (current_date, 'invio', now() + interval '10 minutes', 'locale', 'finto')$q$, '23505');
select prova.atteso_errore('0125: giro finito senza ora di fine', $q$update public.radar_notifiche_giri set esito = 'riuscito'$q$, '23514');
-- difetto 3.3 (proposta A, 20/11): gare nuove ancora da classificare, rivalutate al giro dopo
select prova.verifica('0125: «nuove_in_sospeso» uuid[] non nullo, vuoto di base',
  (select nuove_in_sospeso = '{}'::uuid[] from public.radar_notifiche_giri limit 1)
  and (select data_type = 'ARRAY' and udt_name = '_uuid' and is_nullable = 'NO' from information_schema.columns where table_schema = 'public' and table_name = 'radar_notifiche_giri' and column_name = 'nuove_in_sospeso'));
update public.radar_notifiche_giri set nuove_in_sospeso = array(select gen_random_uuid() from generate_series(1, 2000));
select prova.verifica('0125: «nuove_in_sospeso» accetta 2000 gare', (select cardinality(nuove_in_sospeso) from public.radar_notifiche_giri limit 1) = 2000);
select prova.atteso_errore('0125: «nuove_in_sospeso» oltre 2000 gare rifiutato', $q$update public.radar_notifiche_giri set nuove_in_sospeso = array(select gen_random_uuid() from generate_series(1, 2001))$q$, '23514');
select prova.atteso_errore('0125: «nuove_in_sospeso» nullo rifiutato', $q$update public.radar_notifiche_giri set nuove_in_sospeso = null$q$, '23502');
update public.radar_notifiche_giri set nuove_in_sospeso = '{}';

select prova.verifica('0125: destinatari dell''impresa 1 = titolare + Ufficio Gare attivo, email confermate',
  (select count(*) from public.radar_notifiche_destinatari(array['11111111-1111-4111-8111-111111111111']::uuid[])) = 2
  and (select bool_and(email_confermata and not bloccato and membro_attivo) from public.radar_notifiche_destinatari(array['11111111-1111-4111-8111-111111111111']::uuid[])));
select prova.verifica('0125: destinatari dell''impresa 2 = titolare con email NON confermata + Ufficio Gare SOSPESO',
  (select count(*) from public.radar_notifiche_destinatari(array['22222222-2222-4222-8222-222222222222']::uuid[]) where ruolo = 'titolare' and not email_confermata) = 1
  and (select count(*) from public.radar_notifiche_destinatari(array['22222222-2222-4222-8222-222222222222']::uuid[]) where ruolo = 'ufficio_gare' and not membro_attivo) = 1);
select prova.verifica('0125: utente bloccato segnalato', (select bool_and(bloccato) from public.radar_notifiche_destinatari(array['55555555-5555-4555-8555-555555555555']::uuid[])));
select prova.verifica('0125: nessuna impresa = nessun destinatario', (select count(*) from public.radar_notifiche_destinatari(array[]::uuid[])) = 0);
select prova.verifica('0125: conteggi per stato (in coda e inclusa)', (select n from public.radar_email_conteggi(now() - interval '1 day') where stato = 'inclusa') = 1 and (select n from public.radar_email_conteggi(now() - interval '1 day') where stato = 'in_coda') = 2);
reset role;

set role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', false);
select prova.atteso_errore('0125: il cliente non legge gli eventi', $q$select count(*) from public.omnia_ai_radar_eventi$q$, '42501');
select prova.atteso_errore('0125: il cliente non legge le consegne', $q$select count(*) from public.omnia_ai_radar_email_consegne$q$, '42501');
select prova.atteso_errore('0125: il cliente non legge i giri', $q$select count(*) from public.radar_notifiche_giri$q$, '42501');
select prova.atteso_errore('0125: il cliente non chiama la funzione dei destinatari', $q$select * from public.radar_notifiche_destinatari(array['11111111-1111-4111-8111-111111111111']::uuid[])$q$, '42501');
select prova.atteso_errore('0125: il cliente non chiama la funzione dei conteggi', $q$select * from public.radar_email_conteggi(now())$q$, '42501');
reset role;
select set_config('request.jwt.claim.sub', '', false);
select prova.verifica('0125: anon senza permessi su tutte le tabelle nuove',
  not has_table_privilege('anon', 'public.omnia_ai_radar_eventi', 'select') and not has_table_privilege('anon', 'public.omnia_ai_radar_email_consegne', 'select')
  and not has_table_privilege('anon', 'public.radar_notifiche_giri', 'select') and not has_table_privilege('anon', 'public.omnia_ai_radar_notifiche_impresa', 'select')
  and not has_table_privilege('anon', 'public.omnia_ai_radar_notifiche_persone', 'select'));
-- conservazione D-E7 (difetto 2 del 38A): il server PUÒ cancellare eventi, consegne e giri; i clienti no
select prova.verifica('0125: delete al solo server su eventi, consegne e giri (conservazione D-E7)',
  has_table_privilege('service_role', 'public.omnia_ai_radar_eventi', 'delete') and has_table_privilege('service_role', 'public.omnia_ai_radar_email_consegne', 'delete')
  and has_table_privilege('service_role', 'public.radar_notifiche_giri', 'delete')
  and not has_table_privilege('authenticated', 'public.omnia_ai_radar_eventi', 'delete') and not has_table_privilege('authenticated', 'public.omnia_ai_radar_email_consegne', 'delete')
  and not has_table_privilege('authenticated', 'public.radar_notifiche_giri', 'delete') and not has_table_privilege('anon', 'public.omnia_ai_radar_email_consegne', 'delete'));
select prova.verifica('0125: funzione dei destinatari SECURITY DEFINER con search_path fisso', (select prosecdef and proconfig is not null from pg_proc where proname = 'radar_notifiche_destinatari'));

-- ═════════════════════════════ presa in carico concorrente (due sessioni vere, con dblink) ═════════════════════════════
-- La sessione A prende le consegne «in_coda» e NON chiude la transazione; la sessione B tenta la stessa presa in carico e resta in attesa
-- dei blocchi di riga; A chiude; B rilegge la condizione (stato = 'in_coda') sulle righe aggiornate e non prende nulla. Nessuna consegna
-- presa due volte, quindi nessuna email doppia.
create extension if not exists dblink;
begin;
update public.omnia_ai_radar_email_consegne set stato = 'in_invio', in_invio_fino_il = now() + interval '10 minutes' where stato = 'in_coda';
select dblink_connect('sessione_b', 'dbname=postgres user=postgres');
select dblink_send_query('sessione_b', 'update public.omnia_ai_radar_email_consegne set stato = ''in_invio'', in_invio_fino_il = now() + interval ''10 minutes'' where stato = ''in_coda'' returning id');
commit;
create temp table presa_b as select * from dblink_get_result('sessione_b') as t (id uuid);
select dblink_disconnect('sessione_b');
select prova.verifica('0125: presa in carico concorrente: la seconda sessione non prende nessuna consegna già presa', (select count(*) from presa_b) = 0 and (select count(*) from public.omnia_ai_radar_email_consegne where stato = 'in_invio') = 2);

-- ═════════════════════════════ parte 3: presa in carico concorrente con la condizione VERA del motore (O1: in coda e dovute, oppure
-- affitto scaduto e dovute; aggiornamento condizionato) — due sessioni vere con dblink ═════════════════════════════
-- Tre consegne nuove prendibili: una in coda dovuta, una con l'affitto scaduto, una con l'affitto VALIDO (mai presa). La sessione A prende e
-- NON chiude; la sessione B tenta la stessa presa e resta in attesa dei blocchi di riga; A chiude; B rilegge la condizione e non prende nulla.
reset role;
update public.omnia_ai_radar_email_consegne set stato = 'annullata', motivo = 'prova_concorrenza', chiusa_il = now(), in_invio_fino_il = null where stato in ('in_coda', 'in_invio');
insert into public.omnia_ai_radar_eventi (id, impresa_id, categoria, tipo, gara_chiave, versione, dati)
  values ('eeeeeeee-0000-4000-8000-0000000000c1', '11111111-1111-4111-8111-111111111111', 'scadenze', 'scadenza_5', 'p:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'prova-concorrenza', '{}');
insert into public.omnia_ai_radar_email_consegne (id, evento_id, impresa_id, destinatario_id, ruolo, chiave, priorita, stato, prossimo_tentativo_il, in_invio_fino_il) values
  ('cccccccc-0000-4000-8000-0000000000d1', 'eeeeeeee-0000-4000-8000-0000000000c1', '11111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111', 'titolare', 'concorrenza-in-coda', 1, 'in_coda', now() - interval '1 minute', null),
  ('cccccccc-0000-4000-8000-0000000000d2', 'eeeeeeee-0000-4000-8000-0000000000c1', '11111111-1111-4111-8111-111111111111', '33333333-3333-4333-8333-333333333333', 'ufficio_gare', 'concorrenza-affitto-scaduto', 2, 'in_invio', now() - interval '20 minutes', now() - interval '5 minutes'),
  ('cccccccc-0000-4000-8000-0000000000d3', 'eeeeeeee-0000-4000-8000-0000000000c1', '11111111-1111-4111-8111-111111111111', '33333333-3333-4333-8333-333333333333', 'ufficio_gare', 'concorrenza-affitto-valido', 2, 'in_invio', now() - interval '20 minutes', now() + interval '5 minutes');
\set presa 'update public.omnia_ai_radar_email_consegne set stato = ''in_invio'', in_invio_fino_il = now() + interval ''10 minutes'' where stato in (''in_coda'', ''in_invio'') and ((stato = ''in_coda'' and prossimo_tentativo_il <= now()) or (stato = ''in_invio'' and in_invio_fino_il < now() and prossimo_tentativo_il <= now())) returning id'
create temp table presa_a (id uuid);
begin;
with x as (update public.omnia_ai_radar_email_consegne set stato = 'in_invio', in_invio_fino_il = now() + interval '10 minutes'
            where stato in ('in_coda', 'in_invio') and ((stato = 'in_coda' and prossimo_tentativo_il <= now()) or (stato = 'in_invio' and in_invio_fino_il < now() and prossimo_tentativo_il <= now()))
            returning id)
insert into presa_a select id from x;
select dblink_connect('sessione_c', 'dbname=postgres user=postgres');
select dblink_send_query('sessione_c', :'presa');
commit;
create temp table presa_c as select * from dblink_get_result('sessione_c') as t (id uuid);
select dblink_disconnect('sessione_c');
select prova.verifica('0125 concorrenza (condizione del motore): A prende la in coda e l''affitto scaduto, MAI l''affitto valido',
  (select array_agg(id order by id) from presa_a) = array['cccccccc-0000-4000-8000-0000000000d1', 'cccccccc-0000-4000-8000-0000000000d2']::uuid[]);
select prova.verifica('0125 concorrenza (condizione del motore): B, in contemporanea, non prende NULLA di già preso', (select count(*) from presa_c) = 0);
