-- SOLO PER LA PROVA ISOLATA (dossier Z5, documento 45): controlli DOPO la proposta 85_proposta_igiene_permessi.sql applicata DUE volte
-- (fotografie «prima_igiene» e «dopo_igiene»). I due trigger devono continuare a funzionare per il server e a separare le imprese; i clienti
-- devono conservare select, insert, update e delete sulle loro due tabelle; nient'altro deve cambiare.
\set ON_ERROR_STOP on
reset role;

select prova.verifica('igiene: le due funzioni dei trigger con lo STESSO elenco ristretto della 0120/0121 (solo postgres e service_role)',
  (select bool_and(proacl::text = '{postgres=X/postgres,service_role=X/postgres}') from pg_proc
    where oid in ('public.radar_consegna_separazione()'::regprocedure, 'public.radar_notifiche_persona_dell_impresa()'::regprocedure, 'public.radar_aggiungi_fonte_alla_gara()'::regprocedure)));
select prova.verifica('igiene: cambia SOLO l''EXECUTE di anon e authenticated sulle due funzioni',
  prova.elenco_differenze('prima_igiene', 'dopo_igiene', 'execute') = array[
    '-radar_consegna_separazione():anon', '-radar_consegna_separazione():authenticated',
    '-radar_notifiche_persona_dell_impresa():anon', '-radar_notifiche_persona_dell_impresa():authenticated']);
select prova.verifica('igiene: sulle due tabelle dei clienti cambiano SOLO truncate, references e trigger di authenticated',
  prova.elenco_differenze('prima_igiene', 'dopo_igiene', 'permesso') = array[
    '-omnia_ai_radar_gare_aggiunte:authenticated:references', '-omnia_ai_radar_gare_aggiunte:authenticated:trigger', '-omnia_ai_radar_gare_aggiunte:authenticated:truncate',
    '-omnia_ai_radar_salvate:authenticated:references', '-omnia_ai_radar_salvate:authenticated:trigger', '-omnia_ai_radar_salvate:authenticated:truncate']);
select prova.verifica('igiene: oggetti, righe, impronte di tutte le righe, regole RLS e RLS INVARIATI',
  prova.elenco_differenze('prima_igiene', 'dopo_igiene', 'oggetto') = '{}' and prova.elenco_differenze('prima_igiene', 'dopo_igiene', 'righe') = '{}'
  and prova.elenco_differenze('prima_igiene', 'dopo_igiene', 'impronta') = '{}' and prova.elenco_differenze('prima_igiene', 'dopo_igiene', 'regola') = '{}'
  and prova.elenco_differenze('prima_igiene', 'dopo_igiene', 'rls') = '{}' and prova.elenco_differenze('prima_igiene', 'dopo_igiene', 'colonna') = '{}');
select prova.verifica('igiene: i clienti conservano select, insert, update e delete sulle loro due tabelle (con le regole RLS di prima)',
  (select bool_and(has_table_privilege('authenticated', 'public.' || t, p)) from unnest(array['omnia_ai_radar_salvate', 'omnia_ai_radar_gare_aggiunte']) t, unnest(array['select', 'insert', 'update', 'delete']) p));

-- i trigger SCATTANO ancora (EXECUTE non si controlla quando un trigger scatta) e separano ancora le imprese
set role service_role;
insert into public.omnia_ai_radar_eventi (id, impresa_id, categoria, tipo, gara_chiave, versione, dati)
  values ('eeeeeeee-0000-4000-8000-0000000000f1', '11111111-1111-4111-8111-111111111111', 'scadenze', 'scadenza_5', 'p:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'prova-igiene', '{}');
select prova.atteso_errore('igiene: il trigger delle consegne SCATTA ancora e rifiuta la consegna di un''altra impresa',
  $q$insert into public.omnia_ai_radar_email_consegne (evento_id, impresa_id, destinatario_id, ruolo, chiave, priorita) values ('eeeeeeee-0000-4000-8000-0000000000f1', '22222222-2222-4222-8222-222222222222', '22222222-2222-4222-8222-222222222222', 'titolare', 'igiene-impresa-diversa', 1)$q$, '23514');
select prova.atteso_errore('igiene: il trigger delle consegne rifiuta ancora l''Ufficio Gare SOSPESO di un''altra impresa',
  $q$insert into public.omnia_ai_radar_email_consegne (evento_id, impresa_id, destinatario_id, ruolo, chiave, priorita) values ('eeeeeeee-0000-4000-8000-0000000000f1', '11111111-1111-4111-8111-111111111111', '44444444-4444-4444-8444-444444444444', 'ufficio_gare', 'igiene-membro-altro', 1)$q$, '23514');
insert into public.omnia_ai_radar_email_consegne (evento_id, impresa_id, destinatario_id, ruolo, chiave, priorita)
  values ('eeeeeeee-0000-4000-8000-0000000000f1', '11111111-1111-4111-8111-111111111111', '33333333-3333-4333-8333-333333333333', 'ufficio_gare', 'igiene-membro-giusto', 1);
select prova.verifica('igiene: una consegna giusta (Ufficio Gare attivo della stessa impresa) entra', exists (select 1 from public.omnia_ai_radar_email_consegne where chiave = 'igiene-membro-giusto'));
select prova.atteso_errore('igiene: il trigger delle preferenze SCATTA ancora e rifiuta una persona di un''altra impresa',
  $q$insert into public.omnia_ai_radar_notifiche_persone (impresa_id, user_id) values ('11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222')$q$, '23514');
select prova.atteso_errore('igiene: il trigger delle preferenze rifiuta lo spostamento di una preferenza in un''altra impresa',
  $q$update public.omnia_ai_radar_notifiche_persone set impresa_id = '22222222-2222-4222-8222-222222222222' where user_id = '33333333-3333-4333-8333-333333333333'$q$, '23514');
insert into public.omnia_ai_radar_notifiche_persone (impresa_id, user_id) values ('22222222-2222-4222-8222-222222222222', '44444444-4444-4444-8444-444444444444');
select prova.verifica('igiene: una preferenza giusta (membro della stessa impresa) entra', exists (select 1 from public.omnia_ai_radar_notifiche_persone where user_id = '44444444-4444-4444-8444-444444444444'));
delete from public.omnia_ai_radar_notifiche_persone where user_id = '44444444-4444-4444-8444-444444444444';
delete from public.omnia_ai_radar_email_consegne where chiave = 'igiene-membro-giusto';
delete from public.omnia_ai_radar_eventi where id = 'eeeeeeee-0000-4000-8000-0000000000f1';
reset role;

-- QUANDO si controlla EXECUTE: alla CREAZIONE del trigger, NON quando scatta. Prova in una transazione annullata: EXECUTE tolto anche a
-- service_role; i due trigger SCATTANO lo stesso per le sue scritture (e separano ancora le imprese), ma service_role NON può più CREARE
-- un trigger con quelle funzioni.
begin;
revoke all on function public.radar_consegna_separazione() from service_role;
revoke all on function public.radar_notifiche_persona_dell_impresa() from service_role;
select prova.verifica('EXECUTE allo scatto: service_role SENZA EXECUTE sulle due funzioni (dentro una transazione poi annullata)',
  not has_function_privilege('service_role', 'public.radar_consegna_separazione()', 'execute') and not has_function_privilege('service_role', 'public.radar_notifiche_persona_dell_impresa()', 'execute'));
set local role service_role;
insert into public.omnia_ai_radar_eventi (id, impresa_id, categoria, tipo, gara_chiave, versione, dati)
  values ('eeeeeeee-0000-4000-8000-0000000000f2', '11111111-1111-4111-8111-111111111111', 'scadenze', 'scadenza_5', 'p:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'prova-scatto', '{}');
select prova.atteso_errore('EXECUTE allo scatto: SENZA EXECUTE il trigger delle consegne SCATTA lo stesso e rifiuta l''altra impresa',
  $q$insert into public.omnia_ai_radar_email_consegne (evento_id, impresa_id, destinatario_id, ruolo, chiave, priorita) values ('eeeeeeee-0000-4000-8000-0000000000f2', '22222222-2222-4222-8222-222222222222', '22222222-2222-4222-8222-222222222222', 'titolare', 'scatto-impresa-diversa', 1)$q$, '23514');
insert into public.omnia_ai_radar_email_consegne (evento_id, impresa_id, destinatario_id, ruolo, chiave, priorita)
  values ('eeeeeeee-0000-4000-8000-0000000000f2', '11111111-1111-4111-8111-111111111111', '33333333-3333-4333-8333-333333333333', 'ufficio_gare', 'scatto-giusto', 1);
select prova.verifica('EXECUTE allo scatto: SENZA EXECUTE una consegna giusta entra (la funzione del trigger è stata eseguita)', exists (select 1 from public.omnia_ai_radar_email_consegne where chiave = 'scatto-giusto'));
select prova.atteso_errore('EXECUTE allo scatto: SENZA EXECUTE il trigger delle preferenze SCATTA lo stesso e rifiuta l''altra impresa',
  $q$insert into public.omnia_ai_radar_notifiche_persone (impresa_id, user_id) values ('11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222')$q$, '23514');
select prova.atteso_errore('EXECUTE alla creazione: SENZA EXECUTE il server non può CREARE un trigger con la funzione (pur avendo TRIGGER sulla tabella)',
  $q$create trigger prova_z5_creazione before insert on public.omnia_ai_radar_salvate for each row execute function public.radar_consegna_separazione()$q$, '42501');
rollback;
select prova.verifica('EXECUTE allo scatto: prova annullata (EXECUTE di service_role tornato, nessuna riga rimasta)',
  has_function_privilege('service_role', 'public.radar_consegna_separazione()', 'execute') and not exists (select 1 from public.omnia_ai_radar_eventi where id = 'eeeeeeee-0000-4000-8000-0000000000f2'));

-- il trigger del multifonte (0120/0121, già con EXECUTE ristretto) funziona come sempre: riferimento di come si comportano gli altri due
set role service_role;
insert into public.radar_procedure_fonti (procedura_id, fonte, id_fonte) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'sintel', 'igiene-1');
select prova.verifica('igiene: il trigger delle fonti (EXECUTE già ristretto dalla 0120/0121) scatta per il server', 'sintel' = any (select unnest(fonti) from public.radar_procedure where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'));
delete from public.radar_procedure_fonti where id_fonte = 'igiene-1';
reset role;

-- chiamata diretta: ora i clienti non hanno nemmeno il permesso (42501); per il server resta impossibile (0A000)
set role authenticated;
select prova.atteso_errore('igiene: un cliente non ha più EXECUTE sulla funzione delle consegne', $q$select public.radar_consegna_separazione()$q$, '42501');
select prova.atteso_errore('igiene: un cliente non ha più EXECUTE sulla funzione delle preferenze', $q$select public.radar_notifiche_persona_dell_impresa()$q$, '42501');
reset role;
set role anon;
select prova.atteso_errore('igiene: anon non ha più EXECUTE', $q$select public.radar_consegna_separazione()$q$, '42501');
reset role;
set role service_role;
select prova.atteso_errore('igiene: per il server la chiamata diretta resta impossibile', $q$select public.radar_consegna_separazione()$q$, '0A000');
reset role;

-- agganciare la funzione a una tabella dei clienti: ora rifiutato (né EXECUTE, né TRIGGER)
begin;
set local role authenticated;
select prova.atteso_errore('igiene: un cliente con una sessione SQL non può più agganciare la funzione a un trigger',
  $q$create trigger prova_z5_abuso_2 before insert on public.omnia_ai_radar_salvate for each row execute function public.radar_consegna_separazione()$q$, '42501');
select prova.atteso_errore('igiene: nemmeno con una funzione qualsiasi (manca il permesso TRIGGER sulla tabella)',
  $q$create trigger prova_z5_abuso_3 before insert on public.omnia_ai_radar_gare_aggiunte for each row execute function public.radar_aggiungi_fonte_alla_gara()$q$, '42501');
rollback;
