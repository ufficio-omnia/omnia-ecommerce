-- SOLO PER LA PROVA ISOLATA (documento 46C): le righe come quelle lasciate dal collaudo Z8 (3 gare e 3 salvate «SINTETICA — Z8», 4 eventi,
-- 6 consegne inviate col provider finto, 2 giri riusciti). Identificativi fissi: li usa anche l'elenco del lanciatore.
\set ON_ERROR_STOP on
insert into public.omnia_ai_radar_gare_aggiunte (id, user_id, creata_da, url, oggetto, ente, scadenza_giorno, creata_il, aggiornata_il) values
  ('8a000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111', 'https://esempio.invalid/z8/gara-10-giorni', 'SINTETICA — Z8 promemoria a 10 giorni (dato di prova)', 'ENTE SINTETICO Z8 (dato di prova)', current_date + 10, now() - interval '1 day', now() - interval '1 day'),
  ('8a000000-0000-4000-8000-000000000002', '22222222-2222-4222-8222-222222222222', '22222222-2222-4222-8222-222222222222', 'https://esempio.invalid/z8/gara-5-giorni', 'SINTETICA — Z8 promemoria a 5 giorni (dato di prova)', 'ENTE SINTETICO Z8 (dato di prova)', current_date + 5, now() - interval '1 day', now() - interval '1 day'),
  ('8a000000-0000-4000-8000-000000000003', '11111111-1111-4111-8111-111111111111', '33333333-3333-4333-8333-333333333333', 'https://esempio.invalid/z8/gara-1-giorni', 'SINTETICA — Z8 promemoria a 1 giorno (dato di prova)', 'ENTE SINTETICO Z8 (dato di prova)', current_date + 1, now() - interval '1 day', now() - interval '1 day');
insert into public.omnia_ai_radar_salvate (id, user_id, procedura_id, aggiunta_id, monitorata, salvata_da) values
  ('85000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', null, '8a000000-0000-4000-8000-000000000001', false, '11111111-1111-4111-8111-111111111111'),
  ('85000000-0000-4000-8000-000000000002', '22222222-2222-4222-8222-222222222222', null, '8a000000-0000-4000-8000-000000000002', true, '22222222-2222-4222-8222-222222222222'),
  ('85000000-0000-4000-8000-000000000003', '11111111-1111-4111-8111-111111111111', null, '8a000000-0000-4000-8000-000000000003', true, '33333333-3333-4333-8333-333333333333');
insert into public.omnia_ai_radar_eventi (id, impresa_id, categoria, tipo, gara_chiave, aggiunta_id, versione, dati) values
  ('e8000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'scadenze', 'scadenza_10', 'a:8a000000-0000-4000-8000-000000000001', '8a000000-0000-4000-8000-000000000001', 'v10', '{}'),
  ('e8000000-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111', 'scadenze', 'scadenza_10', 'p:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', null, 'v10p', '{}'),
  ('e8000000-0000-4000-8000-000000000003', '11111111-1111-4111-8111-111111111111', 'scadenze', 'scadenza_1', 'a:8a000000-0000-4000-8000-000000000003', '8a000000-0000-4000-8000-000000000003', 'v1', '{}'),
  ('e8000000-0000-4000-8000-000000000004', '22222222-2222-4222-8222-222222222222', 'scadenze', 'scadenza_5', 'a:8a000000-0000-4000-8000-000000000002', '8a000000-0000-4000-8000-000000000002', 'v5', '{}');
insert into public.omnia_ai_radar_email_consegne (id, evento_id, impresa_id, destinatario_id, ruolo, chiave, priorita, stato, provider, provider_id, inviata_il) values
  ('c8000000-0000-4000-8000-000000000001', 'e8000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111', 'titolare', 'z8-prova-1-titolare', 2, 'inviata', 'finto', 'finto-1', now()),
  ('c8000000-0000-4000-8000-000000000002', 'e8000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', '33333333-3333-4333-8333-333333333333', 'ufficio_gare', 'z8-prova-1-ufficio', 2, 'inviata', 'finto', 'finto-2', now()),
  ('c8000000-0000-4000-8000-000000000003', 'e8000000-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111', 'titolare', 'z8-prova-2-titolare', 2, 'inviata', 'finto', 'finto-3', now()),
  ('c8000000-0000-4000-8000-000000000004', 'e8000000-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111', '33333333-3333-4333-8333-333333333333', 'ufficio_gare', 'z8-prova-2-ufficio', 2, 'inviata', 'finto', 'finto-4', now()),
  ('c8000000-0000-4000-8000-000000000005', 'e8000000-0000-4000-8000-000000000003', '11111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111', 'titolare', 'z8-prova-3-titolare', 1, 'inviata', 'finto', 'finto-5', now()),
  ('c8000000-0000-4000-8000-000000000006', 'e8000000-0000-4000-8000-000000000003', '11111111-1111-4111-8111-111111111111', '33333333-3333-4333-8333-333333333333', 'ufficio_gare', 'z8-prova-3-ufficio', 1, 'inviata', 'finto', 'finto-6', now());
insert into public.radar_notifiche_giri (id, giorno_roma, fase, esito, in_corso_fino_il, finito_il, ambiente, provider) values
  ('98000000-0000-4000-8000-000000000001', current_date, 'eventi', 'riuscito', now(), now(), 'staging', 'finto'),
  ('98000000-0000-4000-8000-000000000002', current_date, 'invio', 'riuscito', now(), now(), 'staging', 'finto');
