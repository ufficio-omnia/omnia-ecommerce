-- SOLO PER LA PROVA ISOLATA (dossier Z5, documento 45). Dati SINTETICI scritti PRIMA della 0128 e della 0123, con lo STESSO VOLUME dello
-- staging del 21/11/2026 (radar_aggiornamenti 2056 righe, radar_procedure_fonti 1947): così la 0123 lavora su tabelle piene e se ne misurano
-- durata e blocchi. Gare, avvisi e valori inventati («prova:z5:<n>», enti e collegamenti di prova); nessun dato reale.
--   1.900 gare sintetiche; provenienze: 1.900 (una per gara, fonti a rotazione ted, pvl, sintel, sardegnacat) + 47 seconde provenienze = 1.947;
--   registro: 2.055 righe di tutti i tipi e di tutte le fonti (con le correzioni delle regole dei settori) + la riga di 35_dati_b4.sql = 2.056.
\set ON_ERROR_STOP on

insert into public.radar_procedure (id, chiave, oggetto)
select md5('z5-gara-' || n)::uuid, 'prova:z5:' || n, 'Gara sintetica Z5 numero ' || n || ' (prova)'
  from generate_series(1, 1900) n;

insert into public.radar_procedure_fonti (procedura_id, fonte, id_fonte, url, impronta, pubblicato_il, versione, tipo_avviso)
select md5('z5-gara-' || n)::uuid,
       (array['ted', 'pvl', 'sintel', 'sardegnacat'])[1 + n % 4],
       'z5-avviso-' || n,
       'https://esempio.invalid/z5/avviso/' || n,
       md5('z5-impronta-' || n),
       date '2026-10-01' + (n % 50),
       1 + n % 3,
       (array['cn-standard', 'P1_16', 'Bando', 'Avviso'])[1 + n % 4]
  from generate_series(1, 1900) n;
insert into public.radar_procedure_fonti (procedura_id, fonte, id_fonte, url, impronta)
select md5('z5-gara-' || n)::uuid, 'ted', 'z5-seconda-' || n, 'https://esempio.invalid/z5/seconda/' || n, md5('z5-seconda-' || n)
  from generate_series(1, 47) n
 where n % 4 <> 0;
insert into public.radar_procedure_fonti (procedura_id, fonte, id_fonte, url, impronta)
select md5('z5-gara-' || n)::uuid, 'pvl', 'z5-seconda-' || n, 'https://esempio.invalid/z5/seconda/' || n, md5('z5-seconda-' || n)
  from generate_series(1, 47) n
 where n % 4 = 0;

insert into public.radar_aggiornamenti (procedura_id, tipo, campo, valore_precedente, valore_nuovo, fonte, id_fonte, notificabile, nota, rilevato_il)
select md5('z5-gara-' || (1 + n % 1900))::uuid,
       t.tipo,
       t.campo,
       case when t.campo = 'scadenza_offerte' then '2026-12-01' when t.campo is null then null else 'valore prima ' || n end,
       case when t.campo = 'scadenza_offerte' then '2026-12-15' when t.campo is null then null else 'valore dopo ' || n end,
       case when t.tipo = 'correzione_dati' then 'regole_settori' else (array['ted', 'pvl', 'sintel', 'sardegnacat'])[1 + n % 4] end,
       'z5-registro-' || n,
       t.tipo in ('rettifica', 'proroga', 'annullamento') and n % 3 <> 0,
       case when n % 10 = 0 then 'nota sintetica ' || n end,
       timestamptz '2026-11-01 08:00:00+00' + make_interval(mins => n)
  from generate_series(1, 2055) n
  cross join lateral (select (array['nuova', 'rettifica', 'proroga', 'annullamento', 'esito', 'correzione_dati'])[1 + n % 6] as tipo) x
  cross join lateral (select x.tipo,
                             case x.tipo when 'nuova' then null when 'proroga' then 'scadenza_offerte' when 'annullamento' then 'stato'
                                         when 'esito' then 'stato' when 'correzione_dati' then 'settori' else 'oggetto' end as campo) t;
