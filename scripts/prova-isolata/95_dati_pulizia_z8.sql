-- SOLO PER LA PROVA ISOLATA (documento 46C): righe SINTETICHE come quelle lasciate dal collaudo Z8, sopra righe «di prima» che la pulizia NON
-- deve toccare. Utenti di 35_dati_b4.sql: T1 = 11111111… (impresa 1, Ufficio Gare attivo M1 = 33333333…), T2 = 22222222…; P1 = aaaaaaaa….
-- Solo le righe «di prima»: 2 gare aggiunte non Z8 e 3 salvate (le righe come quelle di Z8 sono in 96_righe_z8.sql).
\set ON_ERROR_STOP on

insert into public.omnia_ai_radar_gare_aggiunte (id, user_id, creata_da, url, oggetto, ente, scadenza_giorno) values
  ('a0000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111', 'https://esempio.invalid/prima/1', 'Gara aggiunta di prova (non Z8)', 'ENTE DI PROVA', current_date + 20),
  ('a0000000-0000-4000-8000-000000000002', '22222222-2222-4222-8222-222222222222', '22222222-2222-4222-8222-222222222222', 'https://esempio.invalid/prima/2', 'Gara aggiunta di prova (non Z8)', 'ENTE DI PROVA', null);
insert into public.omnia_ai_radar_salvate (id, user_id, procedura_id, aggiunta_id, monitorata) values
  ('50000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', null, true),
  ('50000000-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111', null, 'a0000000-0000-4000-8000-000000000001', true),
  ('50000000-0000-4000-8000-000000000003', '22222222-2222-4222-8222-222222222222', null, 'a0000000-0000-4000-8000-000000000002', false);
