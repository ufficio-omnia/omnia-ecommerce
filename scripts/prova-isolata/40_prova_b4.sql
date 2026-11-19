-- SOLO PER LA PROVA ISOLATA della fase B4: controlli delle bozze 0122–0125 (26B), dopo che sono state applicate DUE volte.
-- Utenti sintetici di 35_dati_b4.sql: T1 = 11111111…, M1 = 33333333… (Ufficio Gare attivo di T1), T2 = 22222222… (email non confermata),
-- M2 = 44444444… (Ufficio Gare SOSPESO di T2), T3 = 55555555… (senza Radar, bloccato). P1 = aaaaaaaa….
-- Ogni controllo stampa «ok …»; il primo che fallisce ferma tutto (ON_ERROR_STOP).
\set ON_ERROR_STOP on

-- ═════════════════════════════ 0122: profili ═════════════════════════════
set role service_role;
insert into public.omnia_ai_radar_profili (user_id, settori, sottocategorie, regioni, tipi_procedura, importo_min, importo_max)
  values ('11111111-1111-4111-8111-111111111111', '{pulizia,ristorazione}', '{"pulizia":["pulizia_edifici"]}', '{lombardia}', '{aperta}', 1000, 50000);
insert into public.omnia_ai_radar_profili (user_id, settori) values ('22222222-2222-4222-8222-222222222222', '{vigilanza_portierato}');
select prova.verifica('0122: profilo valido scritto dal server', (select count(*) from public.omnia_ai_radar_profili) = 2);
select prova.atteso_errore('0122: settore fuori elenco', $q$insert into public.omnia_ai_radar_profili (user_id, posizione, settori) values ('22222222-2222-4222-8222-222222222222', 2, '{edilizia}')$q$, '23514');
select prova.atteso_errore('0122: sottocategorie di un settore non scelto', $q$insert into public.omnia_ai_radar_profili (user_id, posizione, settori, sottocategorie) values ('22222222-2222-4222-8222-222222222222', 2, '{pulizia}', '{"ristorazione":["mense_scolastiche"]}')$q$, '23514');
select prova.atteso_errore('0122: sottocategoria non stringa', $q$insert into public.omnia_ai_radar_profili (user_id, posizione, settori, sottocategorie) values ('22222222-2222-4222-8222-222222222222', 2, '{pulizia}', '{"pulizia":[1]}')$q$, '23514');
select prova.atteso_errore('0122: sottocategorie non in un elenco', $q$insert into public.omnia_ai_radar_profili (user_id, posizione, settori, sottocategorie) values ('22222222-2222-4222-8222-222222222222', 2, '{pulizia}', '{"pulizia":"pulizia_edifici"}')$q$, '23514');
select prova.atteso_errore('0122: 31 sottocategorie per un settore', $q$insert into public.omnia_ai_radar_profili (user_id, posizione, settori, sottocategorie) select '22222222-2222-4222-8222-222222222222', 2, '{pulizia}', jsonb_build_object('pulizia', jsonb_agg('s' || lpad(i::text, 2, '0'))) from generate_series(1, 31) i$q$, '23514');
select prova.atteso_errore('0122: importi invertiti', $q$insert into public.omnia_ai_radar_profili (user_id, posizione, importo_min, importo_max) values ('22222222-2222-4222-8222-222222222222', 2, 10, 5)$q$, '23514');
select prova.atteso_errore('0122: posizione 6', $q$insert into public.omnia_ai_radar_profili (user_id, posizione) values ('22222222-2222-4222-8222-222222222222', 6)$q$, '23514');
select prova.atteso_errore('0122: regione malformata', $q$insert into public.omnia_ai_radar_profili (user_id, posizione, regioni) values ('22222222-2222-4222-8222-222222222222', 2, '{Lombardia}')$q$, '23514');
select prova.atteso_errore('0122: procedura malformata', $q$insert into public.omnia_ai_radar_profili (user_id, posizione, tipi_procedura) values ('22222222-2222-4222-8222-222222222222', 2, '{"aperta;x"}')$q$, '23514');
select prova.atteso_errore('0122: nome vuoto', $q$insert into public.omnia_ai_radar_profili (user_id, posizione, nome) values ('22222222-2222-4222-8222-222222222222', 2, '   ')$q$, '23514');
select prova.atteso_errore('0122: nome con caratteri di controllo', $q$insert into public.omnia_ai_radar_profili (user_id, posizione, nome) values ('22222222-2222-4222-8222-222222222222', 2, 'a' || chr(10) || 'b')$q$, '23514');
select prova.atteso_errore('0122: profilo senza Radar dato dalla console (chiave esterna)', $q$insert into public.omnia_ai_radar_profili (user_id) values ('55555555-5555-4555-8555-555555555555')$q$, '23503');
select prova.atteso_errore('0122: stessa posizione due volte', $q$insert into public.omnia_ai_radar_profili (user_id, posizione) values ('11111111-1111-4111-8111-111111111111', 1)$q$, '23505');
insert into public.omnia_ai_radar_utilizzi (user_id, azione) values ('11111111-1111-4111-8111-111111111111', 'per_te');
select prova.verifica('0122: utilizzo «per_te» accettato', (select count(*) from public.omnia_ai_radar_utilizzi where azione = 'per_te') = 1);
select prova.atteso_errore('0122: azione sconosciuta rifiutata', $q$insert into public.omnia_ai_radar_utilizzi (user_id, azione) values ('11111111-1111-4111-8111-111111111111', 'boh')$q$, '23514');
reset role;

set role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', false);
select prova.verifica('0122 RLS: il titolare vede solo il proprio profilo', (select count(*) from public.omnia_ai_radar_profili) = 1 and (select count(*) from public.omnia_ai_radar_profili where user_id = '11111111-1111-4111-8111-111111111111') = 1);
select prova.atteso_errore('0122: il titolare non scrive direttamente il profilo', $q$update public.omnia_ai_radar_profili set nome = 'x'$q$, '42501');
select prova.atteso_errore('0122: il titolare non inserisce direttamente un profilo', $q$insert into public.omnia_ai_radar_profili (user_id, posizione) values ('11111111-1111-4111-8111-111111111111', 2)$q$, '42501');
select set_config('request.jwt.claim.sub', '33333333-3333-4333-8333-333333333333', false);
select prova.verifica('0122 RLS: l''Ufficio Gare attivo vede il profilo del suo titolare', (select count(*) from public.omnia_ai_radar_profili where user_id = '11111111-1111-4111-8111-111111111111') = 1);
select set_config('request.jwt.claim.sub', '44444444-4444-4444-8444-444444444444', false);
select prova.verifica('0122 RLS: l''Ufficio Gare sospeso non vede nulla', (select count(*) from public.omnia_ai_radar_profili) = 0);
select set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', false);
select prova.verifica('0122 RLS: un''altra impresa non vede il profilo dell''impresa 1', (select count(*) from public.omnia_ai_radar_profili where user_id = '11111111-1111-4111-8111-111111111111') = 0);
reset role;
select set_config('request.jwt.claim.sub', '', false);
select prova.verifica('0122: anon senza permessi, authenticated solo lettura, funzione solo al server',
  not has_table_privilege('anon', 'public.omnia_ai_radar_profili', 'select')
  and has_table_privilege('authenticated', 'public.omnia_ai_radar_profili', 'select')
  and not has_table_privilege('authenticated', 'public.omnia_ai_radar_profili', 'insert')
  and not has_table_privilege('authenticated', 'public.omnia_ai_radar_profili', 'update')
  and not has_table_privilege('authenticated', 'public.omnia_ai_radar_profili', 'delete')
  and has_table_privilege('service_role', 'public.omnia_ai_radar_profili', 'insert')
  and not has_function_privilege('authenticated', 'public.radar_profilo_sottocategorie_valide(jsonb, text[])', 'execute')
  and has_function_privilege('service_role', 'public.radar_profilo_sottocategorie_valide(jsonb, text[])', 'execute'));

-- ═════════════════════════════ 0123: evidenza e fotografia ═════════════════════════════
select prova.verifica('0123: le righe già esistenti restano NON notificabili per email', (select count(*) from public.radar_aggiornamenti where notifica_email) = 0 and (select count(*) from public.radar_aggiornamenti) = 1);
set role service_role;
select prova.atteso_errore('0123: email su una gara «nuova» rifiutata', $q$insert into public.radar_aggiornamenti (procedura_id, tipo, campo, fonte, id_fonte, notificabile, affidabilita, notifica_email) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'nuova', 'x', 'ted', '000002-2026', true, 'avviso_ufficiale', true)$q$, '23514');
select prova.atteso_errore('0123: email su una riclassificazione rifiutata', $q$insert into public.radar_aggiornamenti (procedura_id, tipo, campo, fonte, id_fonte, notificabile, affidabilita, notifica_email) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'correzione_dati', 'settori', 'regole_settori', 'x', true, 'avviso_ufficiale', true)$q$, '23514');
select prova.atteso_errore('0123: email con affidabilità parziale rifiutata', $q$insert into public.radar_aggiornamenti (procedura_id, tipo, campo, fonte, id_fonte, notificabile, affidabilita, notifica_email) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'rettifica', 'oggetto', 'pvl', 'av-2', true, 'parziale', true)$q$, '23514');
select prova.atteso_errore('0123: email su una modifica non notificabile rifiutata', $q$insert into public.radar_aggiornamenti (procedura_id, tipo, campo, fonte, id_fonte, notificabile, affidabilita, notifica_email) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'proroga', 'scadenza_offerte', 'ted', '000003-2026', false, 'avviso_ufficiale', true)$q$, '23514');
select prova.atteso_errore('0123: email senza affidabilità rifiutata', $q$insert into public.radar_aggiornamenti (procedura_id, tipo, campo, fonte, id_fonte, notificabile, notifica_email) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'proroga', 'scadenza_offerte', 'ted', '000004-2026', true, true)$q$, '23514');
insert into public.radar_aggiornamenti (procedura_id, tipo, campo, valore_precedente, valore_nuovo, fonte, id_fonte, notificabile, avviso_precedente_id, avviso_url, avviso_pubblicato_il, avviso_versione, avviso_tipo, avviso_ted, dichiarazione_fonte, affidabilita, notifica_email)
  values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'proroga', 'scadenza_offerte@AAAAAAAAAA', '2026-12-01', '2026-12-15', 'ted', '000005-2026', true, '000001-2026', 'https://ted.europa.eu/it/notice/-/detail/000005-2026', '2026-11-19', 2, 'cn-standard', '000005-2026', 'update-add', 'avviso_ufficiale', true);
select prova.verifica('0123: proroga di un lotto (lotto nel campo) con evidenza completa, notificabile per email', (select count(*) from public.radar_aggiornamenti where notifica_email and campo = 'scadenza_offerte@AAAAAAAAAA') = 1);
insert into public.radar_aggiornamenti (procedura_id, tipo, campo, fonte, id_fonte, notificabile)
  values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'proroga', 'scadenza_offerte@AAAAAAAAAA', 'ted', '000005-2026', true)
  on conflict (procedura_id, tipo, campo, id_fonte) do nothing;
select prova.verifica('0123: la scrittura degli importatori (on conflict sull''indice unico invariato) funziona e non duplica', (select count(*) from public.radar_aggiornamenti where id_fonte = '000005-2026') = 1);
select prova.atteso_errore('0123: numero TED malformato', $q$insert into public.radar_aggiornamenti (procedura_id, tipo, campo, fonte, id_fonte, avviso_ted) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'rettifica', 'oggetto', 'pvl', 'av-9', 'abc')$q$, '23514');
select prova.atteso_errore('0123: affidabilità sconosciuta', $q$insert into public.radar_aggiornamenti (procedura_id, tipo, campo, fonte, id_fonte, affidabilita) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'rettifica', 'oggetto', 'pvl', 'av-10', 'certa')$q$, '23514');
insert into public.radar_procedure_fonti (procedura_id, fonte, id_fonte, foto) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'pvl', 'avviso-1', '{"versioneFoto":1,"idAvviso":"avviso-1"}');
select prova.verifica('0123: fotografia (oggetto) salvata nella provenienza', (select count(*) from public.radar_procedure_fonti where foto ->> 'idAvviso' = 'avviso-1') = 1);
select prova.atteso_errore('0123: fotografia che non è un oggetto', $q$insert into public.radar_procedure_fonti (procedura_id, fonte, id_fonte, foto) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'pvl', 'avviso-2', '[1,2]')$q$, '23514');
select prova.atteso_errore('0123: fotografia oltre 16.000 byte', $q$insert into public.radar_procedure_fonti (procedura_id, fonte, id_fonte, foto) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'pvl', 'avviso-3', jsonb_build_object('x', repeat('y', 17000)))$q$, '23514');
reset role;

-- ═════════════════════════════ 0124: preferenze ═════════════════════════════
set role service_role;
insert into public.omnia_ai_radar_notifiche_impresa (impresa_id, email_attive) values ('11111111-1111-4111-8111-111111111111', true), ('22222222-2222-4222-8222-222222222222', true);
insert into public.omnia_ai_radar_notifiche_persone (impresa_id, user_id, scadenze, rettifiche) values
  ('11111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111', true, true),
  ('11111111-1111-4111-8111-111111111111', '33333333-3333-4333-8333-333333333333', false, true);
select prova.verifica('0124: preferenze di titolare e Ufficio Gare della stessa impresa', (select count(*) from public.omnia_ai_radar_notifiche_persone) = 2);
select prova.atteso_errore('0124: preferenza per una persona di un''altra impresa', $q$insert into public.omnia_ai_radar_notifiche_persone (impresa_id, user_id) values ('11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222')$q$, '23514');
select prova.atteso_errore('0124: preferenza per l''Ufficio Gare di un''altra impresa', $q$insert into public.omnia_ai_radar_notifiche_persone (impresa_id, user_id) values ('11111111-1111-4111-8111-111111111111', '44444444-4444-4444-8444-444444444444')$q$, '23514');
select prova.atteso_errore('0124: spostare una preferenza in un''altra impresa', $q$update public.omnia_ai_radar_notifiche_persone set impresa_id = '22222222-2222-4222-8222-222222222222' where user_id = '33333333-3333-4333-8333-333333333333'$q$, '23514');
select prova.atteso_errore('0124: indirizzo bloccato senza motivo', $q$insert into public.omnia_ai_radar_notifiche_persone (impresa_id, user_id, email_bloccata_il) values ('22222222-2222-4222-8222-222222222222', '22222222-2222-4222-8222-222222222222', now())$q$, '23514');
select prova.atteso_errore('0124: interruttore per un''impresa senza Radar', $q$insert into public.omnia_ai_radar_notifiche_impresa (impresa_id) values ('55555555-5555-4555-8555-555555555555')$q$, '23503');
reset role;
set role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', false);
select prova.verifica('0124 RLS: il titolare vede l''interruttore e TUTTE le persone della sua impresa', (select count(*) from public.omnia_ai_radar_notifiche_impresa) = 1 and (select count(*) from public.omnia_ai_radar_notifiche_persone) = 2);
select prova.atteso_errore('0124: il titolare non scrive direttamente le preferenze', $q$update public.omnia_ai_radar_notifiche_persone set scadenze = false$q$, '42501');
select set_config('request.jwt.claim.sub', '33333333-3333-4333-8333-333333333333', false);
select prova.verifica('0124 RLS: l''Ufficio Gare vede l''interruttore e SOLO la propria riga', (select count(*) from public.omnia_ai_radar_notifiche_impresa) = 1 and (select count(*) from public.omnia_ai_radar_notifiche_persone) = 1 and (select user_id from public.omnia_ai_radar_notifiche_persone) = '33333333-3333-4333-8333-333333333333');
select prova.atteso_errore('0124: l''Ufficio Gare non scrive direttamente', $q$update public.omnia_ai_radar_notifiche_impresa set email_attive = false$q$, '42501');
select set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', false);
select prova.verifica('0124 RLS: un''altra impresa non vede le persone dell''impresa 1', (select count(*) from public.omnia_ai_radar_notifiche_persone) = 0);
select set_config('request.jwt.claim.sub', '44444444-4444-4444-8444-444444444444', false);
select prova.verifica('0124 RLS: l''Ufficio Gare sospeso non vede nulla', (select count(*) from public.omnia_ai_radar_notifiche_impresa) = 0 and (select count(*) from public.omnia_ai_radar_notifiche_persone) = 0);
reset role;
select set_config('request.jwt.claim.sub', '', false);

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
select prova.verifica('0125: il server non cancella eventi né consegne (si annullano)', not has_table_privilege('service_role', 'public.omnia_ai_radar_eventi', 'delete') and not has_table_privilege('service_role', 'public.omnia_ai_radar_email_consegne', 'delete'));
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
