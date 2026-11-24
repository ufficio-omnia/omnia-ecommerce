-- SOLO PER LA PROVA ISOLATA DELLA 0133 (dopo la 0133 applicata DUE volte). Controlli: il vincolo nuovo, nient'altro di cambiato (righe,
-- vincoli, permessi, oggetti), i valori di prima e quello nuovo ammessi, gli altri vincoli della 0121 che valgono anche per «da_verificare».
\set ON_ERROR_STOP on

select prova.verifica('0133: il vincolo dello stato c''è una volta sola, con lo stesso nome',
  (select count(*) from pg_constraint where conrelid = 'public.radar_classificazioni_stato'::regclass and conname = 'radar_classificazioni_stato_stato_check') = 1);
select prova.verifica('0133: il vincolo ammette i tre valori di prima e «da_verificare»',
  (select pg_get_constraintdef(oid) from pg_constraint where conrelid = 'public.radar_classificazioni_stato'::regclass and conname = 'radar_classificazioni_stato_stato_check')
  ~ 'in_attesa.*classificata.*fallita.*da_verificare');
select prova.verifica('0133: gli altri vincoli della tabella sono identici (nome e definizione)',
  not exists (
    (select conname, definizione from prova.vincoli_prima where conname <> 'radar_classificazioni_stato_stato_check')
    except
    (select conname, pg_get_constraintdef(oid) from pg_constraint where conrelid = 'public.radar_classificazioni_stato'::regclass))
  and (select count(*) from pg_constraint where conrelid = 'public.radar_classificazioni_stato'::regclass) = (select count(*) from prova.vincoli_prima));
select prova.verifica('0133: nessuna riga toccata (stato delle classificazioni identico, riga per riga)',
  not exists (select * from prova.stato_prima except select * from public.radar_classificazioni_stato)
  and not exists (select * from public.radar_classificazioni_stato except select * from prova.stato_prima));
select prova.verifica('0133: nessuna riga in più o in meno nelle tabelle del Radar',
  not exists (
    select * from prova.righe_prima
    except
    (select 'radar_procedure', count(*) from public.radar_procedure
     union all select 'radar_classificazioni', count(*) from public.radar_classificazioni
     union all select 'radar_classificazioni_stato', count(*) from public.radar_classificazioni_stato)));
select prova.verifica('0133: permessi identici (nessun GRANT nuovo o tolto)',
  not exists (
    (select * from prova.permessi_prima
     except select grantee, privilege_type from information_schema.role_table_grants where table_schema = 'public' and table_name = 'radar_classificazioni_stato')
    union all
    (select grantee, privilege_type from information_schema.role_table_grants where table_schema = 'public' and table_name = 'radar_classificazioni_stato'
     except select * from prova.permessi_prima)));
select prova.verifica('0133: nessun oggetto dello schema tolto o aggiunto (tabelle, colonne, indici, funzioni, trigger, vincoli)',
  not exists (select oggetto from prova.oggetti_prima_0133 except select x from prova.oggetti_ora() x)
  and not exists (select x from prova.oggetti_ora() x except select oggetto from prova.oggetti_prima_0133));
select prova.verifica('0133: RLS ancora attiva e nessuna regola per i ruoli utente',
  (select relrowsecurity from pg_class where oid = 'public.radar_classificazioni_stato'::regclass)
  and not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'radar_classificazioni_stato'));

-- valori ammessi e rifiutati
select prova.verifica('0133: un valore sconosciuto resta rifiutato',
  prova.rifiutata($q$insert into public.radar_classificazioni_stato (procedura_id, stato, tentativo_il) values ('00000000-0000-0000-0000-000000013305', 'sconosciuto', now())$q$));
select prova.verifica('0133: «da_verificare» con un errore resta rifiutato (vincolo dell''errore della 0121)',
  prova.rifiutata($q$insert into public.radar_classificazioni_stato (procedura_id, stato, tentativo_il, errore) values ('00000000-0000-0000-0000-000000013305', 'da_verificare', now(), 'errore')$q$));
select prova.verifica('0133: «da_verificare» senza il tentativo resta rifiutato (vincolo del tentativo della 0121)',
  prova.rifiutata($q$insert into public.radar_classificazioni_stato (procedura_id, stato) values ('00000000-0000-0000-0000-000000013305', 'da_verificare')$q$));
select prova.verifica('0133: i valori di prima sono ancora ammessi',
  not prova.rifiutata($q$insert into public.radar_classificazioni_stato (procedura_id, stato) values ('00000000-0000-0000-0000-000000013305', 'in_attesa')$q$)
  and not prova.rifiutata($q$insert into public.radar_classificazioni_stato (procedura_id, stato, versione_regole, classificata_il, tentativo_il) values ('00000000-0000-0000-0000-000000013305', 'classificata', '2026-11-23a', now(), now())$q$)
  and not prova.rifiutata($q$insert into public.radar_classificazioni_stato (procedura_id, stato, tentativo_il, errore) values ('00000000-0000-0000-0000-000000013305', 'fallita', now(), 'errore')$q$));

-- il server (service_role) scrive «da_verificare» con i permessi di sempre: un inserimento e un passaggio da «classificata», poi il ritorno
set role service_role;
insert into public.radar_classificazioni_stato (procedura_id, stato, versione_regole, classificata_il, tentativi, tentativo_il)
  values ('00000000-0000-0000-0000-000000013304', 'da_verificare', '2026-11-23a', now(), 1, now());
update public.radar_classificazioni_stato set stato = 'da_verificare', versione_regole = '2026-11-23a', classificata_il = now(), tentativo_il = now()
  where procedura_id = '00000000-0000-0000-0000-000000013302';
reset role;
select prova.verifica('0133: il server inserisce «da_verificare» e porta una gara da «classificata» a «da_verificare»',
  (select count(*) from public.radar_classificazioni_stato where stato = 'da_verificare') = 2);
set role service_role;
update public.radar_classificazioni_stato set stato = 'classificata' where procedura_id = '00000000-0000-0000-0000-000000013302';
reset role;
select prova.verifica('0133: dopo la decisione dell''amministratore la gara torna «classificata»',
  (select stato from public.radar_classificazioni_stato where procedura_id = '00000000-0000-0000-0000-000000013302') = 'classificata');
select prova.verifica('0133: l''indice delle gare «da fare» (stato diverso da classificata) comprende anche «da_verificare»',
  exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'radar_classificazioni_stato_da_fare_idx'));
select prova.verifica('0133: i ruoli dei clienti non leggono lo stato (nessun permesso, come nella 0121)',
  not has_table_privilege('authenticated', 'public.radar_classificazioni_stato', 'select') and not has_table_privilege('anon', 'public.radar_classificazioni_stato', 'select'));
