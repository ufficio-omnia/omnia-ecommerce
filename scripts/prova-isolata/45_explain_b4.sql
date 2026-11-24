-- SOLO PER LA PROVA ISOLATA della fase B4 (Fase A del 20/11/2026): EXPLAIN delle letture e scritture del MOTORE delle notifiche su volumi
-- SINTETICI (dati inventati, contenitore usa e getta senza rete). Si applica dopo 40_prova_b4.sql.
-- Volumi (26B §8.3): 500 imprese, 25.000 righe di liste (salvate), 30.000 gare e 60.000 lotti, 50.000 cambiamenti nel registro (1.000 da
-- notificare), 100.000 eventi, 150.000 consegne (1.500 in coda), 20.000 giri. Per ogni interrogazione del motore il piano NON deve leggere
-- per intero le tabelle grandi (nessun «Seq Scan» su di esse): solo indici. Il piano di ogni interrogazione si stampa per il resoconto.
\set ON_ERROR_STOP on
reset role;
set client_min_messages = notice;

-- ───── dati sintetici ─────
insert into public.users (id)
  select ('00000000-0000-4000-9000-' || lpad(i::text, 12, '0'))::uuid from generate_series(1, 500) i on conflict do nothing;
insert into auth.users (id, email, email_confirmed_at)
  select ('00000000-0000-4000-9000-' || lpad(i::text, 12, '0'))::uuid, 'impresa' || i || '@prova.test', now() from generate_series(1, 500) i on conflict do nothing;
insert into public.omnia_ai_radar_impostazioni (user_id, attivo, aggiornata_da_email)
  select ('00000000-0000-4000-9000-' || lpad(i::text, 12, '0'))::uuid, true, 'console@prova.test' from generate_series(1, 500) i on conflict do nothing;
insert into public.omnia_ai_radar_notifiche_impresa (impresa_id, email_attive)
  select ('00000000-0000-4000-9000-' || lpad(i::text, 12, '0'))::uuid, i % 2 = 0 from generate_series(1, 500) i on conflict do nothing;

insert into public.radar_procedure (id, chiave, oggetto, stato, scadenza_giorno, data_pubblicazione, prima_rilevazione_il, ultima_rilevazione_il)
  select ('00000000-0000-4000-a000-' || lpad(i::text, 12, '0'))::uuid, 'ted:sintetica-' || i, 'Gara sintetica ' || i,
         case when i % 10 = 0 then 'scaduta' else 'aperta' end, date '2026-12-01' + (i % 60), date '2026-10-01' + (i % 50),
         timestamptz '2026-10-01' + (i || ' minutes')::interval, timestamptz '2026-10-01' + (i || ' minutes')::interval
    from generate_series(1, 30000) i on conflict do nothing;
insert into public.radar_lotti (procedura_id, numero_lotto, cig, scadenza_giorno)
  select ('00000000-0000-4000-a000-' || lpad(((i - 1) / 2 + 1)::text, 12, '0'))::uuid, 'LOT-' || (i % 2), null, date '2026-12-01' + (i % 60)
    from generate_series(1, 60000) i on conflict do nothing;
insert into public.omnia_ai_radar_salvate (user_id, procedura_id, monitorata, creata_il)
  select ('00000000-0000-4000-9000-' || lpad(((i - 1) / 50 + 1)::text, 12, '0'))::uuid, ('00000000-0000-4000-a000-' || lpad(((i * 7) % 30000 + 1)::text, 12, '0'))::uuid, i % 3 = 0, timestamptz '2026-10-01'
    from generate_series(1, 25000) i on conflict do nothing;
insert into public.radar_aggiornamenti (procedura_id, tipo, campo, valore_precedente, valore_nuovo, fonte, id_fonte, rilevato_il, notificabile, notifica_email, affidabilita)
  select ('00000000-0000-4000-a000-' || lpad((i % 30000 + 1)::text, 12, '0'))::uuid, case when i % 50 = 0 then 'proroga' else 'nuova' end,
         case when i % 50 = 0 then 'scadenza_offerte' else null end, null, null, 'ted', 'sint-' || i,
         timestamptz '2026-10-01' + (i || ' seconds')::interval, i % 50 = 0, i % 50 = 0, case when i % 50 = 0 then 'avviso_ufficiale' else null end
    from generate_series(1, 50000) i on conflict do nothing;
insert into public.omnia_ai_radar_eventi (id, impresa_id, categoria, tipo, gara_chiave, versione, dati, creato_il)
  select ('00000000-0000-4000-b000-' || lpad(i::text, 12, '0'))::uuid, ('00000000-0000-4000-9000-' || lpad((i % 500 + 1)::text, 12, '0'))::uuid, 'scadenze', 'scadenza_10',
         'p:' || ('00000000-0000-4000-a000-' || lpad((i % 30000 + 1)::text, 12, '0')), 'v' || i, '{}'::jsonb, timestamptz '2025-10-01' + ((i % 400) || ' days')::interval
    from generate_series(1, 100000) i on conflict do nothing;
insert into public.omnia_ai_radar_email_consegne (evento_id, impresa_id, destinatario_id, ruolo, chiave, priorita, stato, prossimo_tentativo_il, creata_il, inviata_il, provider, provider_id, chiusa_il, motivo)
  select ('00000000-0000-4000-b000-' || lpad(((i - 1) % 100000 + 1)::text, 12, '0'))::uuid, ('00000000-0000-4000-9000-' || lpad((((i - 1) % 100000 + 1) % 500 + 1)::text, 12, '0'))::uuid,
         ('00000000-0000-4000-9000-' || lpad((((i - 1) % 100000 + 1) % 500 + 1)::text, 12, '0'))::uuid, 'titolare', 'chiave-sintetica-' || i, 1 + i % 6,
         case when i % 100 = 0 then 'in_coda' else 'inviata' end, timestamptz '2026-11-20', timestamptz '2025-10-01' + ((i % 400) || ' days')::interval,
         case when i % 100 = 0 then null else timestamptz '2026-11-01' end, case when i % 100 = 0 then null else 'finto' end,
         case when i % 100 = 0 then null else 'finto-' || i end, case when i % 100 = 0 then null else timestamptz '2026-11-01' end, null
    from generate_series(1, 150000) i on conflict do nothing;
insert into public.radar_classificazioni (procedura_id, settore, rilevanza, regole, motivi, da, versione_regole, origine)
  select ('00000000-0000-4000-a000-' || lpad(i::text, 12, '0'))::uuid, 'pulizia', case when i % 3 = 0 then 'B' else 'A' end, '{regola_sintetica}', '{Motivo sintetico}',
         'cpv', '2026-11-18e', 'importazione'
    from generate_series(1, 30000) i;
insert into public.radar_notifiche_giri (giorno_roma, fase, esito, iniziato_il, in_corso_fino_il, finito_il, ambiente, provider)
  select date '2025-01-01' + (i / 30), case when i % 30 = 0 then 'eventi' else 'invio' end, 'riuscito', timestamptz '2025-01-01' + (i || ' hours')::interval,
         timestamptz '2025-01-01' + (i || ' hours')::interval, timestamptz '2025-01-01' + (i || ' hours')::interval, 'staging', 'finto'
    from generate_series(1, 20000) i;
analyze;

-- ───── un piano senza letture intere delle tabelle indicate ─────
create or replace function prova.piano(q text) returns jsonb language plpgsql as $$
declare p jsonb;
begin
  execute 'explain (format json) ' || q into p;
  return p;
end $$;
create or replace function prova.senza_seq(nome text, q text, tabelle text[]) returns void language plpgsql as $$
declare
  p jsonb := prova.piano(q);
  nodi text;
  sequenziali text[];
begin
  select string_agg(distinct coalesce(n ->> 'Node Type', '') || coalesce(' su ' || (n ->> 'Relation Name'), '') || coalesce(' con ' || (n ->> 'Index Name'), ''), '; ')
    into nodi from jsonb_path_query(p, 'strict $.**') n where jsonb_typeof(n) = 'object' and n ? 'Node Type';
  select array_agg(distinct n ->> 'Relation Name') into sequenziali
    from jsonb_path_query(p, 'strict $.**') n where jsonb_typeof(n) = 'object' and n ->> 'Node Type' = 'Seq Scan' and (n ->> 'Relation Name') = any (tabelle);
  raise notice 'piano  %: %', nome, nodi;
  perform prova.verifica('EXPLAIN ' || nome || ': solo indici sulle tabelle grandi', sequenziali is null);
end $$;

-- elenco letterale di identificativi sintetici (come lo manda PostgREST con .in())
create or replace function prova.uuid_da(prefisso text, a int, b int) returns text language sql immutable as $$
  select '{' || string_agg(prefisso || lpad(i::text, 12, '0'), ',') || '}' from generate_series(a, b) i
$$;

-- fase «eventi»
-- le liste crescono con il numero dei CLIENTI (non con l'archivio): con molte imprese accese leggerle per intero è la scelta giusta;
-- qui 10 imprese su 500 (come PostgREST, elenco letterale), solo per il resoconto: nessun vincolo sul piano
select prova.senza_seq('liste delle imprese (salvate di 10 imprese su 500)',
  format($q$select user_id, procedura_id, aggiunta_id, creata_il from public.omnia_ai_radar_salvate where user_id = any (%L::uuid[])$q$, prova.uuid_da('00000000-0000-4000-9000-', 1, 10)),
  '{}');
select prova.senza_seq('gare delle liste (150 identificativi)',
  format($q$select * from public.radar_procedure where id = any (%L::uuid[])$q$, prova.uuid_da('00000000-0000-4000-a000-', 1, 150)),
  '{radar_procedure}');
select prova.senza_seq('lotti delle gare (150)',
  format($q$select * from public.radar_lotti where procedura_id = any (%L::uuid[])$q$, prova.uuid_da('00000000-0000-4000-a000-', 1, 150)),
  '{radar_lotti}');
select prova.senza_seq('modifiche da notificare dopo il cursore',
  $q$select * from public.radar_aggiornamenti where notifica_email and rilevato_il > timestamptz '2026-10-01 12:00' order by rilevato_il, id limit 1000$q$,
  '{radar_aggiornamenti}');
select prova.senza_seq('gare nuove del riepilogo',
  $q$select * from public.radar_procedure where prima_rilevazione_il > timestamptz '2026-10-21' and data_pubblicazione >= date '2026-10-15' and stato = 'aperta' and unita_a is null order by prima_rilevazione_il limit 2000$q$,
  '{radar_procedure}');
select prova.senza_seq('classificazioni delle gare nuove (150)',
  format($q$select procedura_id, settore, rilevanza from public.radar_classificazioni where procedura_id = any (%L::uuid[]) and attiva$q$, prova.uuid_da('00000000-0000-4000-a000-', 1, 150)),
  '{radar_classificazioni}');
select prova.senza_seq('promemoria attivi delle imprese (150) negli ultimi 15 giorni',
  format($q$select id, impresa_id, gara_chiave, tipo, versione from public.omnia_ai_radar_eventi where impresa_id = any (%L::uuid[]) and categoria = 'scadenze' and stato = 'attivo' and creato_il >= timestamptz '2026-11-05'$q$, prova.uuid_da('00000000-0000-4000-9000-', 1, 150)),
  '{omnia_ai_radar_eventi}');
select prova.senza_seq('giri di oggi',
  $q$select fase, esito from public.radar_notifiche_giri where fase in ('eventi', 'invio') and giorno_roma = date '2026-11-20' limit 500$q$,
  '{radar_notifiche_giri}');
select prova.senza_seq('ultimo giro «eventi» riuscito',
  $q$select * from public.radar_notifiche_giri where fase = 'eventi' and esito = 'riuscito' order by giorno_roma desc, iniziato_il desc limit 1$q$,
  '{radar_notifiche_giri}');
-- fase «invio»
-- O1 (20/11): UNA lettura delle consegne prendibili (in coda e dovute, oppure con l'affitto scaduto) e UN aggiornamento condizionato, come
-- li manda PostgREST (stato in (…) e il filtro «or»); EXPLAIN senza ANALYZE: l'aggiornamento non si esegue
select prova.senza_seq('consegne prendibili (O1: in coda e dovute, oppure affitto scaduto)',
  $q$select id, stato from public.omnia_ai_radar_email_consegne where stato in ('in_coda', 'in_invio') and ((stato = 'in_coda' and prossimo_tentativo_il <= timestamptz '2026-11-21') or (stato = 'in_invio' and in_invio_fino_il < timestamptz '2026-11-21' and prossimo_tentativo_il <= timestamptz '2026-11-21')) order by priorita, prossimo_tentativo_il limit 50$q$,
  '{omnia_ai_radar_email_consegne}');
select prova.senza_seq('presa in carico condizionata (O1, 50 identificativi)',
  format($q$update public.omnia_ai_radar_email_consegne set stato = 'in_invio', in_invio_fino_il = timestamptz '2026-11-21 00:10', aggiornata_il = timestamptz '2026-11-21' where id = any (%L::uuid[]) and stato in ('in_coda', 'in_invio') and ((stato = 'in_coda' and prossimo_tentativo_il <= timestamptz '2026-11-21') or (stato = 'in_invio' and in_invio_fino_il < timestamptz '2026-11-21' and prossimo_tentativo_il <= timestamptz '2026-11-21')) returning id$q$, prova.uuid_da('00000000-0000-4000-d000-', 1, 50)),
  '{omnia_ai_radar_email_consegne}');
select prova.senza_seq('eventi delle consegne (150)',
  format($q$select id, dati from public.omnia_ai_radar_eventi where id = any (%L::uuid[])$q$, prova.uuid_da('00000000-0000-4000-b000-', 1, 150)),
  '{omnia_ai_radar_eventi}');
select prova.senza_seq('consegne incluse in un raggruppamento',
  format($q$select id from public.omnia_ai_radar_email_consegne where inclusa_in = any (%L::uuid[]) and stato = 'inclusa'$q$, prova.uuid_da('00000000-0000-4000-c000-', 1, 50)),
  '{omnia_ai_radar_email_consegne}');
-- console (B1) e conservazione
select prova.senza_seq('console: problemi più recenti',
  $q$select id from public.omnia_ai_radar_email_consegne where stato in ('fallita', 'esito_incerto', 'rimbalzata', 'reclamo') order by aggiornata_il desc, id desc limit 100$q$,
  '{omnia_ai_radar_email_consegne}');
select prova.senza_seq('conservazione: consegne di oltre 12 mesi',
  $q$select id from public.omnia_ai_radar_email_consegne where creata_il < timestamptz '2025-11-20'$q$,
  '{omnia_ai_radar_email_consegne}');
select prova.senza_seq('conservazione: eventi di oltre 12 mesi',
  $q$select id from public.omnia_ai_radar_eventi where creato_il < timestamptz '2025-11-01'$q$,
  '{omnia_ai_radar_eventi}');
select prova.senza_seq('compattazione dei riepiloghi',
  $q$select id from public.omnia_ai_radar_eventi where tipo = 'riepilogo_opportunita' and dati is not null and creato_il < timestamptz '2025-10-20'$q$,
  '{omnia_ai_radar_eventi}');

-- ───── O2 (direttiva 44A): stato del passaggio in UNA chiamata contro le letture di O1, sugli STESSI volumi ─────
-- la funzione ha un search_path proprio: Postgres non la scioglie nel piano, quindi si controlla anche il suo corpo con valori letterali
select prova.senza_seq('O2: stato del passaggio (corpo della funzione)',
  $q$select coalesce(bool_or(g.fase = 'eventi' and g.esito = 'riuscito'), false), coalesce(bool_or(g.fase = 'invio'), false), exists (select 1 from public.omnia_ai_radar_email_consegne c where c.stato in ('in_coda', 'in_invio') and ((c.stato = 'in_coda' and c.prossimo_tentativo_il <= timestamptz '2026-11-19') or (c.stato = 'in_invio' and c.in_invio_fino_il < timestamptz '2026-11-19' and c.prossimo_tentativo_il <= timestamptz '2026-11-19'))) from (select g.fase, g.esito from public.radar_notifiche_giri g where g.fase in ('eventi', 'invio') and g.giorno_roma = date '2026-10-20' limit 500) g$q$,
  '{omnia_ai_radar_email_consegne,radar_notifiche_giri}');
-- contatori di Postgres della transazione: 20 chiamate della funzione, nessuna lettura intera di giri e consegne
begin;
create temp table prova_o2_prima on commit drop as
  select relname, seq_scan, idx_scan from pg_stat_xact_user_tables where relname in ('omnia_ai_radar_email_consegne', 'radar_notifiche_giri');
select count(*) from generate_series(1, 20) i, lateral public.radar_notifiche_stato_passaggio(date '2026-10-20', timestamptz '2026-11-19' + make_interval(secs => i)) s;
select prova.verifica('O2: 20 chiamate sui volumi sintetici → 0 letture intere di giri e consegne, solo indici (contatori della transazione)',
  (select sum(x.seq_scan - p.seq_scan) = 0 and sum(x.idx_scan - p.idx_scan) >= 20
     from pg_stat_xact_user_tables x join prova_o2_prima p using (relname)));
commit;
-- blocchi di memoria condivisa toccati PER PASSAGGIO (esecuzione + pianificazione; letti dal disco tra parentesi), seconda esecuzione:
--   a vuoto   O1 = giri di oggi + consegne prendibili (vuota)     O2 = chiamata della funzione
--   con lavoro O1 = giri di oggi + consegne prendibili (50)       O2 = chiamata della funzione + consegne prendibili (50)
-- Solo misure per il resoconto (la decisione su O2 sta nel documento 44): nessun vincolo, salvo che le misure ci siano.
create or replace function prova.blocchi(q text) returns bigint[] language plpgsql as $f$
declare p jsonb;
begin
  execute 'explain (analyze, buffers, format json) ' || q into p;
  execute 'explain (analyze, buffers, format json) ' || q into p;
  return array[
    coalesce((p->0->'Plan'->>'Shared Hit Blocks')::bigint, 0) + coalesce((p->0->'Plan'->>'Shared Read Blocks')::bigint, 0)
      + coalesce((p->0->'Planning'->>'Shared Hit Blocks')::bigint, 0) + coalesce((p->0->'Planning'->>'Shared Read Blocks')::bigint, 0),
    coalesce((p->0->'Plan'->>'Shared Read Blocks')::bigint, 0) + coalesce((p->0->'Planning'->>'Shared Read Blocks')::bigint, 0)];
end $f$;
do $$
declare
  caso record;
  giri bigint[];
  coda bigint[];
  fun bigint[];
  o1 bigint;
  o2 bigint;
begin
  giri := prova.blocchi($q$select fase, esito from public.radar_notifiche_giri where fase in ('eventi', 'invio') and giorno_roma = date '2026-10-20' limit 500$q$);
  for caso in select * from (values ('a vuoto', timestamptz '2026-11-19'), ('con lavoro', timestamptz '2026-11-21')) v (nome, adesso) loop
    coda := prova.blocchi(format($q$select id, stato from public.omnia_ai_radar_email_consegne where stato in ('in_coda', 'in_invio') and ((stato = 'in_coda' and prossimo_tentativo_il <= %1$L) or (stato = 'in_invio' and in_invio_fino_il < %1$L and prossimo_tentativo_il <= %1$L)) order by priorita, prossimo_tentativo_il limit 50$q$, caso.adesso));
    fun := prova.blocchi(format('select * from public.radar_notifiche_stato_passaggio(date %L, %L)', '2026-10-20', caso.adesso));
    o1 := giri[1] + coda[1];
    o2 := fun[1] + case when caso.nome = 'con lavoro' then coda[1] else 0 end;
    raise notice '%', format('piano  O2 blocchi per passaggio %s: O1 %s (giri %s + coda %s), O2 %s (funzione %s%s), differenza %s; dal disco O1 %s, O2 %s',
      caso.nome, o1, giri[1], coda[1], o2, fun[1], case when caso.nome = 'con lavoro' then format(' + coda %s', coda[1]) else '' end, o2 - o1, giri[2] + coda[2],
      fun[2] + case when caso.nome = 'con lavoro' then coda[2] else 0 end);
    perform prova.verifica(format('O2: blocchi per passaggio %s misurati (O1 %s, O2 %s)', caso.nome, o1, o2), o1 > 0 and o2 > 0);
  end loop;
end $$;

-- dimensione su disco dopo i volumi sintetici (per il resoconto: tabelle e indici)
do $$
declare r record;
begin
  for r in select c.relname, pg_size_pretty(pg_total_relation_size(c.oid)) as totale, pg_size_pretty(pg_indexes_size(c.oid)) as indici
             from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'public' and c.relname in ('omnia_ai_radar_eventi', 'omnia_ai_radar_email_consegne', 'radar_notifiche_giri') loop
    raise notice 'spazio %: totale %, indici %', r.relname, r.totale, r.indici;
  end loop;
end $$;
