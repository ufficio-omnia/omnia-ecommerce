-- SOLO PER LA PROVA ISOLATA DELLA 0133. Dati SINTETICI scritti dopo la 0121 e PRIMA della 0133: una gara per ciascuno dei tre stati della
-- 0121, più la fotografia di righe, vincoli, permessi e oggetti, per provare che la 0133 non tocca nient'altro che il vincolo dello stato.
\set ON_ERROR_STOP on

insert into public.radar_procedure (id, chiave, oggetto) values
  ('00000000-0000-0000-0000-000000013301', 'ted:prova-0133-1', 'Gara in attesa (prova sintetica)'),
  ('00000000-0000-0000-0000-000000013302', 'ted:prova-0133-2', 'Gara classificata (prova sintetica)'),
  ('00000000-0000-0000-0000-000000013303', 'ted:prova-0133-3', 'Gara fallita (prova sintetica)'),
  ('00000000-0000-0000-0000-000000013304', 'ted:prova-0133-4', 'Gara senza stato, per gli inserimenti (prova sintetica)'),
  ('00000000-0000-0000-0000-000000013305', 'ted:prova-0133-5', 'Gara senza stato, per i rifiuti (prova sintetica)');

set role service_role;
insert into public.radar_classificazioni_stato (procedura_id, stato, versione_regole, classificata_il, tentativi, tentativo_il, errore) values
  ('00000000-0000-0000-0000-000000013301', 'in_attesa', null, null, 0, null, null),
  ('00000000-0000-0000-0000-000000013302', 'classificata', '2026-11-18e', '2026-11-18T12:00:00Z', 1, '2026-11-18T12:00:00Z', null),
  ('00000000-0000-0000-0000-000000013303', 'fallita', '2026-11-18e', '2026-11-18T12:00:00Z', 2, '2026-11-18T13:00:00Z', 'errore di prova sintetico');
reset role;

-- un'istruzione rifiutata da un vincolo CHECK: true; accettata: false. In entrambi i casi non resta nulla (il blocco con eccezione annulla
-- quello che ha scritto); ogni altro errore si propaga e ferma la prova
create or replace function prova.rifiutata(istruzione text) returns boolean language plpgsql as $$
begin
  execute istruzione;
  raise exception using errcode = 'P0001', message = 'accettata';
exception
  when check_violation then return true;
  when raise_exception then return false;
end $$;

select prova.verifica('prima della 0133: «da_verificare» rifiutato dal vincolo della 0121',
  prova.rifiutata($q$insert into public.radar_classificazioni_stato (procedura_id, stato, tentativo_il) values ('00000000-0000-0000-0000-000000013305', 'da_verificare', now())$q$));

create table prova.stato_prima as select * from public.radar_classificazioni_stato;
create table prova.vincoli_prima as
  select conname, pg_get_constraintdef(oid) as definizione from pg_constraint where conrelid = 'public.radar_classificazioni_stato'::regclass;
create table prova.permessi_prima as
  select grantee, privilege_type from information_schema.role_table_grants where table_schema = 'public' and table_name = 'radar_classificazioni_stato';
create table prova.oggetti_prima_0133 as select x as oggetto from prova.oggetti_ora() x;
create table prova.righe_prima as
  select 'radar_procedure' as tabella, count(*) as n from public.radar_procedure
  union all select 'radar_classificazioni', count(*) from public.radar_classificazioni
  union all select 'radar_classificazioni_stato', count(*) from public.radar_classificazioni_stato;
select prova.verifica('prima della 0133: tre stati sintetici e il vincolo dello stato della 0121', (select count(*) from prova.stato_prima) = 3
  and exists (select 1 from prova.vincoli_prima where conname = 'radar_classificazioni_stato_stato_check' and definizione like '%in_attesa%' and definizione not like '%da_verificare%'));
