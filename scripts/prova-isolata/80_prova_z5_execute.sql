-- SOLO PER LA PROVA ISOLATA (dossier Z5, documento 45): EXECUTE delle funzioni dei trigger della 0124 e della 0125 (nota del verbale Z4).
-- Parte A, «oggi» (stato dello staging dopo Z4, con i permessi predefiniti di Supabase emulati): che cosa si può e non si può fare con quel
-- permesso. Si esegue PRIMA della proposta 85_proposta_igiene_permessi.sql. Le prove che creano qualcosa stanno dentro una transazione
-- annullata (rollback): nulla resta.
\set ON_ERROR_STOP on
reset role;

-- A1. stesso elenco di permessi letto sullo staging il 21/11/2026 (sola lettura): il Postgres isolato è fedele
select prova.verifica('EXECUTE oggi: le due funzioni dei trigger hanno lo STESSO elenco di permessi dello staging (PUBLIC, anon, authenticated, service_role)',
  (select bool_and(proacl::text = '{=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}')
     from pg_proc where oid in ('public.radar_consegna_separazione()'::regprocedure, 'public.radar_notifiche_persona_dell_impresa()'::regprocedure)));
select prova.verifica('EXECUTE oggi: la funzione dei trigger della 0120/0121 ha già l''elenco ristretto (solo postgres e service_role), come sullo staging',
  (select proacl::text from pg_proc where oid = 'public.radar_aggiungi_fonte_alla_gara()'::regprocedure) = '{postgres=X/postgres,service_role=X/postgres}');
select prova.verifica('EXECUTE oggi: le due funzioni sono INVOKER (girano con i permessi di chi scrive: nessuna scalata di privilegi), con search_path fisso',
  (select bool_and(not prosecdef and proconfig = array['search_path=public']) from pg_proc
    where oid in ('public.radar_consegna_separazione()'::regprocedure, 'public.radar_notifiche_persona_dell_impresa()'::regprocedure)));

-- A2. chiamata diretta: impossibile per CHIUNQUE (anche con EXECUTE): Postgres rifiuta una funzione «trigger» fuori da un trigger
set role anon;
select prova.atteso_errore('EXECUTE oggi: anon non può chiamare direttamente radar_consegna_separazione()', $q$select public.radar_consegna_separazione()$q$, '0A000');
select prova.atteso_errore('EXECUTE oggi: anon non può chiamare direttamente radar_notifiche_persona_dell_impresa()', $q$select public.radar_notifiche_persona_dell_impresa()$q$, '0A000');
reset role;
set role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', false);
select prova.atteso_errore('EXECUTE oggi: un cliente collegato non può chiamare direttamente radar_consegna_separazione()', $q$select public.radar_consegna_separazione()$q$, '0A000');
select prova.atteso_errore('EXECUTE oggi: un cliente collegato non può chiamare direttamente radar_notifiche_persona_dell_impresa()', $q$select public.radar_notifiche_persona_dell_impresa()$q$, '0A000');
-- la forma «select … from funzione()», quella con cui PostgREST chiama le funzioni (/rpc), è rifiutata già nell'analisi della richiesta
select prova.atteso_errore('EXECUTE oggi: nella forma di PostgREST (select … from funzione()) la chiamata è rifiutata prima ancora di eseguire (tipo «trigger» non ammesso)', $q$select * from public.radar_notifiche_persona_dell_impresa()$q$, '42804');
select prova.atteso_errore('EXECUTE oggi: idem per radar_consegna_separazione()', $q$select * from public.radar_consegna_separazione()$q$, '42804');
-- la forma esatta di una chiamata /rpc di PostgREST (v12: «with pgrst_source as (select pgrst_call.* from "schema"."funzione"() pgrst_call) …»)
select prova.atteso_errore('EXECUTE oggi: la forma ESATTA di una chiamata /rpc di PostgREST è rifiutata (42804)',
  $q$with pgrst_source as (select pgrst_call.* from "public"."radar_consegna_separazione"() pgrst_call) select count(*) from pgrst_source$q$, '42804');
select prova.atteso_errore('EXECUTE oggi: idem per la funzione delle preferenze',
  $q$with pgrst_source as (select pgrst_call.* from "public"."radar_notifiche_persona_dell_impresa"() pgrst_call) select count(*) from pgrst_source$q$, '42804');
reset role;
select set_config('request.jwt.claim.sub', '', false);
set role service_role;
select prova.atteso_errore('EXECUTE oggi: nemmeno il server la chiama direttamente', $q$select public.radar_consegna_separazione()$q$, '0A000');
reset role;
select prova.atteso_errore('EXECUTE oggi: nemmeno il proprietario (postgres) la chiama direttamente', $q$select public.radar_consegna_separazione()$q$, '0A000');

-- A3. l'unico uso possibile del permesso: AGGANCIARE la funzione a un trigger. Serve anche il permesso TRIGGER sulla tabella, e una
-- sessione SQL diretta (CREATE TRIGGER): dall'API (PostgREST) non si può, e sullo staging anon e authenticated NON possono collegarsi
-- (rolcanlogin falso). La prova mostra che cosa farebbe chi avesse quella sessione: authenticated ha TRIGGER sulle due tabelle che i
-- clienti scrivono (0112, permessi predefiniti) e quindi potrebbe bloccare le scritture di TUTTE le imprese su quella tabella.
select prova.verifica('EXECUTE oggi: authenticated ha il permesso TRIGGER su omnia_ai_radar_salvate e omnia_ai_radar_gare_aggiunte (come sullo staging)',
  has_table_privilege('authenticated', 'public.omnia_ai_radar_salvate', 'trigger') and has_table_privilege('authenticated', 'public.omnia_ai_radar_gare_aggiunte', 'trigger')
  and not has_table_privilege('anon', 'public.omnia_ai_radar_salvate', 'trigger'));
select prova.verifica('EXECUTE oggi: authenticated NON ha TRIGGER sulle tabelle protette dai due trigger (consegne, preferenze) né può creare oggetti nello schema',
  not has_table_privilege('authenticated', 'public.omnia_ai_radar_email_consegne', 'trigger') and not has_table_privilege('authenticated', 'public.omnia_ai_radar_notifiche_persone', 'trigger')
  and not has_schema_privilege('authenticated', 'public', 'create'));
begin;
set local role authenticated;
create trigger prova_z5_abuso before insert on public.omnia_ai_radar_salvate for each row execute function public.radar_consegna_separazione();
reset role;
set local role service_role;
select prova.atteso_errore('EXECUTE oggi (solo con una sessione SQL diretta): il trigger agganciato da un cliente bloccherebbe le scritture di tutti su quella tabella',
  $q$insert into public.omnia_ai_radar_salvate (user_id, procedura_id) values ('22222222-2222-4222-8222-222222222222', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')$q$, '42703');
rollback;
select prova.verifica('EXECUTE oggi: la prova è stata annullata (nessun trigger aggiunto)', not exists (select 1 from pg_trigger where tgname = 'prova_z5_abuso'));
