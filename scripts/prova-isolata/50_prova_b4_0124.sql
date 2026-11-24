-- SOLO PER LA PROVA ISOLATA della migrazione 0124 (richiesta 40, 20/11/2026). Contenitore usa e getta, senza rete. MAI su staging o produzione.
-- Si applica DOPO: prerequisiti, migrazioni 0109–0122 (l'insieme dello staging, SENZA 0123 e 0125), dati sintetici di 35_dati_b4.sql,
-- fotografia degli oggetti, 0124 applicata DUE volte. Persone sintetiche di 35_dati_b4.sql:
--   T1 = 11111111… impresa 1 con il Radar; M1 = 33333333… suo Ufficio Gare ATTIVO;
--   T2 = 22222222… impresa 2 con il Radar; M2 = 44444444… suo Ufficio Gare SOSPESO;
--   T3 = 55555555… senza Radar dato dalla console.
\set ON_ERROR_STOP on
reset role;
select set_config('request.jwt.claim.sub', '', false);

-- ═════════════ 1. struttura: tabelle, colonne, vincoli, chiavi esterne, indice, trigger ═════════════
select prova.verifica('0124: due tabelle nuove', to_regclass('public.omnia_ai_radar_notifiche_impresa') is not null and to_regclass('public.omnia_ai_radar_notifiche_persone') is not null);
select prova.verifica('0124: colonne dell''interruttore dell''impresa, nell''ordine',
  (select array_agg(column_name::text order by ordinal_position) from information_schema.columns where table_schema = 'public' and table_name = 'omnia_ai_radar_notifiche_impresa')
  = array['impresa_id', 'email_attive', 'creato_il', 'aggiornato_il', 'aggiornato_da']);
select prova.verifica('0124: colonne delle preferenze delle persone, nell''ordine',
  (select array_agg(column_name::text order by ordinal_position) from information_schema.columns where table_schema = 'public' and table_name = 'omnia_ai_radar_notifiche_persone')
  = array['impresa_id', 'user_id', 'nuove_opportunita', 'scadenze', 'rettifiche', 'email_bloccata_il', 'motivo_blocco', 'creato_il', 'aggiornato_il', 'aggiornato_da']);
select prova.verifica('0124: tutto SPENTO di base (impresa e tre categorie)',
  (select column_default from information_schema.columns where table_schema = 'public' and table_name = 'omnia_ai_radar_notifiche_impresa' and column_name = 'email_attive') = 'false'
  and (select bool_and(column_default = 'false') from information_schema.columns where table_schema = 'public' and table_name = 'omnia_ai_radar_notifiche_persone' and column_name in ('nuove_opportunita', 'scadenze', 'rettifiche')));
select prova.verifica('0124: chiavi esterne esatte (impresa → impostazioni; persone → impresa e utenti; tutte ON DELETE CASCADE)',
  (select array_agg(conrelid::regclass::text || '→' || confrelid::regclass::text || ':' || confdeltype::text order by conrelid::regclass::text, confrelid::regclass::text)
     from pg_constraint where contype = 'f' and conrelid in ('public.omnia_ai_radar_notifiche_impresa'::regclass, 'public.omnia_ai_radar_notifiche_persone'::regclass))
  = array['omnia_ai_radar_notifiche_impresa→omnia_ai_radar_impostazioni:c', 'omnia_ai_radar_notifiche_persone→omnia_ai_radar_notifiche_impresa:c', 'omnia_ai_radar_notifiche_persone→users:c']);
select prova.verifica('0124: nessuna chiave esterna sulle colonne di audit (aggiornato_da)',
  not exists (select 1 from pg_constraint c join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
               where c.contype = 'f' and a.attname = 'aggiornato_da' and c.conrelid in ('public.omnia_ai_radar_notifiche_impresa'::regclass, 'public.omnia_ai_radar_notifiche_persone'::regclass)));
select prova.verifica('0124: chiavi primarie (impresa) e (impresa, persona)',
  (select pg_get_constraintdef(oid) from pg_constraint where conrelid = 'public.omnia_ai_radar_notifiche_impresa'::regclass and contype = 'p') = 'PRIMARY KEY (impresa_id)'
  and (select pg_get_constraintdef(oid) from pg_constraint where conrelid = 'public.omnia_ai_radar_notifiche_persone'::regclass and contype = 'p') = 'PRIMARY KEY (impresa_id, user_id)');
select prova.verifica('0124: indice delle preferenze per persona', to_regclass('public.omnia_ai_radar_notifiche_persone_utente_idx') is not null);
select prova.verifica('0124: trigger di appartenenza all''impresa, prima di insert e di update di impresa e persona',
  (select count(*) from pg_trigger where tgrelid = 'public.omnia_ai_radar_notifiche_persone'::regclass and not tgisinternal) = 1
  and (select pg_get_triggerdef(oid) from pg_trigger where tgname = 'omnia_ai_radar_notifiche_persone_impresa') like '%BEFORE INSERT OR UPDATE OF impresa_id, user_id ON public.omnia_ai_radar_notifiche_persone%');
select prova.verifica('0124: funzione del trigger NON security definer, search_path fisso',
  (select not prosecdef and proconfig is not null from pg_proc where proname = 'radar_notifiche_persona_dell_impresa'));
select prova.verifica('0124: nessun trigger sull''interruttore dell''impresa', (select count(*) from pg_trigger where tgrelid = 'public.omnia_ai_radar_notifiche_impresa'::regclass and not tgisinternal) = 0);

-- ═════════════ 2. RLS, regole e privilegi ═════════════
select prova.verifica('0124: RLS accesa sulle due tabelle', (select bool_and(relrowsecurity) from pg_class where oid in ('public.omnia_ai_radar_notifiche_impresa'::regclass, 'public.omnia_ai_radar_notifiche_persone'::regclass)));
select prova.verifica('0124: una sola regola per tabella, SELECT per authenticated',
  (select count(*) from pg_policies where schemaname = 'public' and tablename = 'omnia_ai_radar_notifiche_impresa') = 1
  and (select count(*) from pg_policies where schemaname = 'public' and tablename = 'omnia_ai_radar_notifiche_persone') = 1
  and (select bool_and(cmd = 'SELECT' and roles = '{authenticated}') from pg_policies where schemaname = 'public' and tablename in ('omnia_ai_radar_notifiche_impresa', 'omnia_ai_radar_notifiche_persone')));
select prova.verifica('0124: le regole usano il titolare effettivo (e per le persone anche auth.uid)',
  (select qual from pg_policies where tablename = 'omnia_ai_radar_notifiche_impresa') like '%omnia_ai_titolare_effettivo()%'
  and (select qual from pg_policies where tablename = 'omnia_ai_radar_notifiche_persone') like '%omnia_ai_titolare_effettivo()%'
  and (select qual from pg_policies where tablename = 'omnia_ai_radar_notifiche_persone') like '%auth.uid()%');
do $$
begin
  raise notice 'piano  privilegi: %', (select string_agg(r || '/' || replace(t, 'public.omnia_ai_radar_notifiche_', '') || '/' || p || '=' || has_table_privilege(r, t, p)::text, ' ' order by r, t, p)
    from unnest(array['anon', 'authenticated', 'service_role']) r, unnest(array['public.omnia_ai_radar_notifiche_impresa', 'public.omnia_ai_radar_notifiche_persone']) t,
         unnest(array['select', 'insert', 'update', 'delete', 'truncate']) p);
end $$;
select prova.verifica('0124: privilegi: anon nulla; authenticated solo select; service_role select, insert, update, delete',
  (select bool_and(
     not has_table_privilege('anon', t, p)
     and has_table_privilege('authenticated', t, p) = (p = 'select')
     and has_table_privilege('service_role', t, p))
   from unnest(array['public.omnia_ai_radar_notifiche_impresa', 'public.omnia_ai_radar_notifiche_persone']) t, unnest(array['select', 'insert', 'update', 'delete']) p)
  and not has_table_privilege('authenticated', 'public.omnia_ai_radar_notifiche_impresa', 'truncate')
  and not has_table_privilege('service_role', 'public.omnia_ai_radar_notifiche_persone', 'truncate'));

-- ═════════════ 3. scritture del server: vincoli, trigger di appartenenza, cascate ═════════════
set role service_role;
insert into public.omnia_ai_radar_notifiche_impresa (impresa_id) values ('11111111-1111-4111-8111-111111111111'), ('22222222-2222-4222-8222-222222222222');
select prova.verifica('0124: interruttori scritti dal server, spenti di base', (select count(*) from public.omnia_ai_radar_notifiche_impresa where not email_attive) = 2);
select prova.atteso_errore('0124: interruttore per un account senza Radar dato dalla console (chiave esterna)',
  $q$insert into public.omnia_ai_radar_notifiche_impresa (impresa_id) values ('55555555-5555-4555-8555-555555555555')$q$, '23503');
insert into public.omnia_ai_radar_notifiche_persone (impresa_id, user_id, scadenze, rettifiche) values
  ('11111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111', true, true),
  ('11111111-1111-4111-8111-111111111111', '33333333-3333-4333-8333-333333333333', true, false),
  ('22222222-2222-4222-8222-222222222222', '22222222-2222-4222-8222-222222222222', false, false),
  ('22222222-2222-4222-8222-222222222222', '44444444-4444-4444-8444-444444444444', false, false);
select prova.verifica('0124: trigger: il titolare e i membri della STESSA impresa (anche sospesi) sono ammessi', (select count(*) from public.omnia_ai_radar_notifiche_persone) = 4);
select prova.atteso_errore('0124: trigger: il titolare di un''altra impresa è rifiutato',
  $q$insert into public.omnia_ai_radar_notifiche_persone (impresa_id, user_id) values ('11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222')$q$, '23514');
select prova.atteso_errore('0124: trigger: il membro di un''altra impresa è rifiutato',
  $q$insert into public.omnia_ai_radar_notifiche_persone (impresa_id, user_id) values ('11111111-1111-4111-8111-111111111111', '44444444-4444-4444-8444-444444444444')$q$, '23514');
select prova.atteso_errore('0124: trigger: una persona senza legami con l''impresa è rifiutata',
  $q$insert into public.omnia_ai_radar_notifiche_persone (impresa_id, user_id) values ('11111111-1111-4111-8111-111111111111', '55555555-5555-4555-8555-555555555555')$q$, '23514');
select prova.atteso_errore('0124: trigger: spostare una preferenza in un''altra impresa è rifiutato',
  $q$update public.omnia_ai_radar_notifiche_persone set impresa_id = '22222222-2222-4222-8222-222222222222' where user_id = '33333333-3333-4333-8333-333333333333'$q$, '23514');
select prova.atteso_errore('0124: trigger: cambiare la persona con una di un''altra impresa è rifiutato',
  $q$update public.omnia_ai_radar_notifiche_persone set user_id = '44444444-4444-4444-8444-444444444444' where user_id = '33333333-3333-4333-8333-333333333333'$q$, '23514');
select prova.atteso_errore('0124: vincolo: indirizzo bloccato senza motivo',
  $q$update public.omnia_ai_radar_notifiche_persone set email_bloccata_il = now() where user_id = '33333333-3333-4333-8333-333333333333'$q$, '23514');
select prova.atteso_errore('0124: vincolo: motivo del blocco fuori elenco',
  $q$update public.omnia_ai_radar_notifiche_persone set email_bloccata_il = now(), motivo_blocco = 'altro' where user_id = '33333333-3333-4333-8333-333333333333'$q$, '23514');
select prova.atteso_errore('0124: vincolo: motivo senza data del blocco',
  $q$update public.omnia_ai_radar_notifiche_persone set motivo_blocco = 'rimbalzo' where user_id = '33333333-3333-4333-8333-333333333333'$q$, '23514');
update public.omnia_ai_radar_notifiche_persone set email_bloccata_il = now(), motivo_blocco = 'rimbalzo' where user_id = '33333333-3333-4333-8333-333333333333';
update public.omnia_ai_radar_notifiche_persone set email_bloccata_il = null, motivo_blocco = null where user_id = '33333333-3333-4333-8333-333333333333';
select prova.verifica('0124: vincolo: blocco con data e motivo validi, poi sbloccato', (select email_bloccata_il is null and motivo_blocco is null from public.omnia_ai_radar_notifiche_persone where user_id = '33333333-3333-4333-8333-333333333333'));
select prova.atteso_errore('0124: chiave primaria: la stessa persona due volte nella stessa impresa',
  $q$insert into public.omnia_ai_radar_notifiche_persone (impresa_id, user_id) values ('11111111-1111-4111-8111-111111111111', '33333333-3333-4333-8333-333333333333')$q$, '23505');
select prova.atteso_errore('0124: preferenza senza l''interruttore dell''impresa (chiave esterna)',
  $q$delete from public.omnia_ai_radar_notifiche_impresa where impresa_id = '22222222-2222-4222-8222-222222222222'; insert into public.omnia_ai_radar_notifiche_persone (impresa_id, user_id) values ('22222222-2222-4222-8222-222222222222', '22222222-2222-4222-8222-222222222222')$q$, '23503');
reset role;

-- ═════════════ 4. RLS con le sessioni dei clienti ═════════════
set role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', false);
select prova.verifica('RLS: il titolare vede l''interruttore della SUA impresa e tutte le sue persone',
  (select count(*) from public.omnia_ai_radar_notifiche_impresa) = 1 and (select impresa_id from public.omnia_ai_radar_notifiche_impresa) = '11111111-1111-4111-8111-111111111111'
  and (select count(*) from public.omnia_ai_radar_notifiche_persone) = 2 and (select bool_and(impresa_id = '11111111-1111-4111-8111-111111111111') from public.omnia_ai_radar_notifiche_persone));
select prova.atteso_errore('RLS: il titolare non scrive direttamente le preferenze (permesso negato)', $q$update public.omnia_ai_radar_notifiche_persone set scadenze = false$q$, '42501');
select prova.atteso_errore('RLS: il titolare non accende direttamente l''interruttore (permesso negato)', $q$update public.omnia_ai_radar_notifiche_impresa set email_attive = true$q$, '42501');
select prova.atteso_errore('RLS: il titolare non inserisce direttamente', $q$insert into public.omnia_ai_radar_notifiche_persone (impresa_id, user_id) values ('11111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111')$q$, '42501');
select prova.atteso_errore('RLS: il titolare non cancella direttamente', $q$delete from public.omnia_ai_radar_notifiche_persone$q$, '42501');
select set_config('request.jwt.claim.sub', '33333333-3333-4333-8333-333333333333', false);
select prova.verifica('RLS: l''Ufficio Gare ATTIVO vede l''interruttore e SOLO la propria riga',
  (select count(*) from public.omnia_ai_radar_notifiche_impresa) = 1
  and (select count(*) from public.omnia_ai_radar_notifiche_persone) = 1 and (select user_id from public.omnia_ai_radar_notifiche_persone) = '33333333-3333-4333-8333-333333333333');
select prova.atteso_errore('RLS: l''Ufficio Gare non scrive direttamente', $q$update public.omnia_ai_radar_notifiche_persone set nuove_opportunita = true$q$, '42501');
select set_config('request.jwt.claim.sub', '44444444-4444-4444-8444-444444444444', false);
select prova.verifica('RLS: l''Ufficio Gare SOSPESO non vede nulla (nemmeno la propria riga)',
  (select count(*) from public.omnia_ai_radar_notifiche_impresa) = 0 and (select count(*) from public.omnia_ai_radar_notifiche_persone) = 0);
select set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', false);
select prova.verifica('RLS: un''altra impresa non vede nulla dell''impresa 1',
  not exists (select 1 from public.omnia_ai_radar_notifiche_impresa where impresa_id = '11111111-1111-4111-8111-111111111111')
  and not exists (select 1 from public.omnia_ai_radar_notifiche_persone where impresa_id = '11111111-1111-4111-8111-111111111111'));
select set_config('request.jwt.claim.sub', '55555555-5555-4555-8555-555555555555', false);
select prova.verifica('RLS: un account senza Radar non vede nulla', (select count(*) from public.omnia_ai_radar_notifiche_impresa) = 0 and (select count(*) from public.omnia_ai_radar_notifiche_persone) = 0);
select set_config('request.jwt.claim.sub', '', false);
select prova.verifica('RLS: una sessione senza utente non vede nulla', (select count(*) from public.omnia_ai_radar_notifiche_impresa) = 0 and (select count(*) from public.omnia_ai_radar_notifiche_persone) = 0);
reset role;
set role anon;
select prova.atteso_errore('anon: nessuna lettura (permesso negato)', $q$select count(*) from public.omnia_ai_radar_notifiche_persone$q$, '42501');
select prova.atteso_errore('anon: nessuna lettura dell''interruttore (permesso negato)', $q$select count(*) from public.omnia_ai_radar_notifiche_impresa$q$, '42501');
reset role;

-- ═════════════ 5. cascate ═════════════
set role service_role;
delete from public.omnia_ai_radar_notifiche_impresa where impresa_id = '11111111-1111-4111-8111-111111111111';
select prova.verifica('cascata: tolto l''interruttore dell''impresa, spariscono le sue preferenze (e solo quelle)',
  not exists (select 1 from public.omnia_ai_radar_notifiche_persone where impresa_id = '11111111-1111-4111-8111-111111111111'));
reset role;
-- Radar tolto dalla console (riga di omnia_ai_radar_impostazioni cancellata) → interruttore e preferenze dell'impresa spariscono
insert into public.omnia_ai_radar_notifiche_impresa (impresa_id) values ('11111111-1111-4111-8111-111111111111');
insert into public.omnia_ai_radar_notifiche_persone (impresa_id, user_id) values ('11111111-1111-4111-8111-111111111111', '33333333-3333-4333-8333-333333333333');
delete from public.omnia_ai_membri where membro_id = '33333333-3333-4333-8333-333333333333';
delete from public.users where id = '33333333-3333-4333-8333-333333333333';
select prova.verifica('cascata: cancellato l''utente, sparisce la sua preferenza', not exists (select 1 from public.omnia_ai_radar_notifiche_persone where user_id = '33333333-3333-4333-8333-333333333333'));
delete from public.omnia_ai_radar_impostazioni where user_id = '11111111-1111-4111-8111-111111111111';
select prova.verifica('cascata: tolto il Radar all''impresa, sparisce il suo interruttore', not exists (select 1 from public.omnia_ai_radar_notifiche_impresa where impresa_id = '11111111-1111-4111-8111-111111111111'));

-- ═════════════ 6. nessun altro oggetto cambiato ═════════════
do $$
begin
  raise notice 'piano  oggetti aggiunti dalla 0124: %', (select string_agg(x, ', ' order by x) from (select * from prova.oggetti_ora() except select * from prova.oggetti_prima_0124) d (x));
end $$;
select prova.verifica('0124: oggetti aggiunti = SOLO quelli della 0124 (2 tabelle con colonne, vincoli e indici, 1 funzione, 1 trigger, 2 regole non contate qui)',
  (select array_agg(x order by x) from (select * from prova.oggetti_ora() except select * from prova.oggetti_prima_0124) d (x))
  = (select array_agg(x order by x) from unnest(array[
      'tabella:omnia_ai_radar_notifiche_impresa', 'tabella:omnia_ai_radar_notifiche_persone',
      'colonna:omnia_ai_radar_notifiche_impresa.impresa_id', 'colonna:omnia_ai_radar_notifiche_impresa.email_attive', 'colonna:omnia_ai_radar_notifiche_impresa.creato_il',
      'colonna:omnia_ai_radar_notifiche_impresa.aggiornato_il', 'colonna:omnia_ai_radar_notifiche_impresa.aggiornato_da',
      'colonna:omnia_ai_radar_notifiche_persone.impresa_id', 'colonna:omnia_ai_radar_notifiche_persone.user_id', 'colonna:omnia_ai_radar_notifiche_persone.nuove_opportunita',
      'colonna:omnia_ai_radar_notifiche_persone.scadenze', 'colonna:omnia_ai_radar_notifiche_persone.rettifiche', 'colonna:omnia_ai_radar_notifiche_persone.email_bloccata_il',
      'colonna:omnia_ai_radar_notifiche_persone.motivo_blocco', 'colonna:omnia_ai_radar_notifiche_persone.creato_il', 'colonna:omnia_ai_radar_notifiche_persone.aggiornato_il',
      'colonna:omnia_ai_radar_notifiche_persone.aggiornato_da',
      'indice:omnia_ai_radar_notifiche_impresa_pkey', 'indice:omnia_ai_radar_notifiche_persone_pkey', 'indice:omnia_ai_radar_notifiche_persone_utente_idx',
      'funzione:radar_notifiche_persona_dell_impresa', 'trigger:omnia_ai_radar_notifiche_persone.omnia_ai_radar_notifiche_persone_impresa',
      'vincolo:omnia_ai_radar_notifiche_impresa_pkey', 'vincolo:omnia_ai_radar_notifiche_impresa_impresa_id_fkey',
      'vincolo:omnia_ai_radar_notifiche_persone_pkey', 'vincolo:omnia_ai_radar_notifiche_persone_impresa_id_fkey', 'vincolo:omnia_ai_radar_notifiche_persone_user_id_fkey',
      'vincolo:omnia_ai_radar_notifiche_persone_blocco', 'vincolo:omnia_ai_radar_notifiche_persone_motivo_blocco_check']) x));
select prova.verifica('0124: nessun oggetto tolto', not exists (select * from prova.oggetti_prima_0124 except select * from prova.oggetti_ora()));
select prova.verifica('0124: utilizzi, profili, salvate e registro invariati (nessuna riga di dati toccata)',
  (select count(*) from public.radar_aggiornamenti) = 1 and (select count(*) from public.omnia_ai_radar_profili) = 0);
