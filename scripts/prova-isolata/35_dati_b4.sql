-- SOLO PER LA PROVA ISOLATA della fase B4. Dati SINTETICI scritti PRIMA delle bozze 0122–0125 (così la 0123 trova righe già esistenti).
--   T1 = impresa 1 (titolare), M1 = suo Ufficio Gare ATTIVO;  T2 = impresa 2 (email NON confermata), M2 = suo Ufficio Gare SOSPESO;
--   T3 = utente senza Radar, BLOCCATO.  P1 = una gara dell'archivio con una riga «nuova» del registro dei cambiamenti.
\set ON_ERROR_STOP on

insert into public.users (id) values
  ('11111111-1111-4111-8111-111111111111'), ('33333333-3333-4333-8333-333333333333'),
  ('22222222-2222-4222-8222-222222222222'), ('44444444-4444-4444-8444-444444444444'),
  ('55555555-5555-4555-8555-555555555555');
insert into auth.users (id, email, email_confirmed_at, banned_until, deleted_at) values
  ('11111111-1111-4111-8111-111111111111', 't1@prova.test', now(), null, null),
  ('33333333-3333-4333-8333-333333333333', 'm1@prova.test', now(), null, null),
  ('22222222-2222-4222-8222-222222222222', 't2@prova.test', null, null, null),
  ('44444444-4444-4444-8444-444444444444', 'm2@prova.test', now(), null, null),
  ('55555555-5555-4555-8555-555555555555', 't3@prova.test', now(), now() + interval '1 day', null);
insert into public.omnia_ai_membri (membro_id, titolare_id, attivo) values
  ('33333333-3333-4333-8333-333333333333', '11111111-1111-4111-8111-111111111111', true),
  ('44444444-4444-4444-8444-444444444444', '22222222-2222-4222-8222-222222222222', false);
insert into public.omnia_ai_radar_impostazioni (user_id, attivo, aggiornata_da_email) values
  ('11111111-1111-4111-8111-111111111111', true, 'console@prova.test'),
  ('22222222-2222-4222-8222-222222222222', true, 'console@prova.test');
insert into public.radar_procedure (id, chiave, oggetto) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'prova:b4:1', 'Gara sintetica B4');
insert into public.radar_aggiornamenti (procedura_id, tipo, campo, fonte, id_fonte, notificabile)
  values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'nuova', null, 'ted', '000001-2026', false);
