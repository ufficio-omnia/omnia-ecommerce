-- SOLO PER LA PROVA ISOLATA (dossier Z5, documento 45): FOTOGRAFIA completa dello schema public, da prendere prima di ogni migrazione e da
-- confrontare dopo. Per ogni etichetta («prima_0128», «prima_0123», …) registra in prova.fotografie:
--   oggetto   tabelle, colonne, indici, funzioni, trigger e vincoli (prova.oggetti_ora di 00_prerequisiti.sql);
--   righe     quante righe ha ogni tabella;
--   impronta  md5 di TUTTE le righe di ogni tabella (ordinate come testo);
--   vecchie   md5 delle righe di radar_aggiornamenti e radar_procedure_fonti SOLO sulle colonne che c'erano prima della 0123;
--   permesso  tabella:ruolo:permesso per anon, authenticated, service_role e PUBLIC (8 permessi di Postgres 17);
--   colonna   permessi di colonna (column privileges) concessi esplicitamente;
--   execute   funzione(argomenti):ruolo per ogni funzione di public eseguibile da anon, authenticated o service_role;
--   regola    le regole RLS (nome, comando, ruoli, condizioni);
--   rls       RLS accesa / forzata per ogni tabella.
\set ON_ERROR_STOP on

create table if not exists prova.fotografie (etichetta text not null, tipo text not null, valore text not null);

create or replace function prova.righe() returns table (tabella text, n bigint) language plpgsql as $f$
declare r record;
begin
  for r in select c.relname from pg_class c join pg_namespace s on s.oid = c.relnamespace where s.nspname = 'public' and c.relkind = 'r' order by 1 loop
    tabella := r.relname;
    execute format('select count(*) from public.%I', r.relname) into n;
    return next;
  end loop;
end $f$;

create or replace function prova.impronte() returns table (tabella text, h text) language plpgsql as $f$
declare r record;
begin
  for r in select c.relname from pg_class c join pg_namespace s on s.oid = c.relnamespace where s.nspname = 'public' and c.relkind = 'r' order by 1 loop
    tabella := r.relname;
    execute format('select md5(coalesce(string_agg(t::text, ''|'' order by t::text), '''')) from public.%I t', r.relname) into h;
    return next;
  end loop;
end $f$;

-- le colonne che la 0123 aggiunge: l'impronta «vecchie» le esclude, così prima e dopo la 0123 si confrontano le stesse colonne
create or replace function prova.impronte_vecchie() returns table (tabella text, h text) language plpgsql as $f$
declare
  t text;
  colonne text;
begin
  foreach t in array array['radar_aggiornamenti', 'radar_procedure_fonti'] loop
    select string_agg(format('%I', column_name), ', ' order by ordinal_position) into colonne
      from information_schema.columns
     where table_schema = 'public' and table_name = t
       and column_name <> all (array['foto', 'avviso_precedente_id', 'avviso_url', 'avviso_pubblicato_il', 'avviso_versione', 'avviso_tipo', 'avviso_ted',
                                     'dichiarazione_fonte', 'affidabilita', 'esecuzione_id', 'notifica_email']);
    tabella := t;
    execute format('select md5(coalesce(string_agg(x::text, ''|'' order by x::text), '''')) from (select %s from public.%I) x', colonne, t) into h;
    return next;
  end loop;
end $f$;

create or replace function prova.permessi() returns setof text language sql stable as $f$
  select c.relname || ':' || r || ':' || p
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   cross join unnest(array['anon', 'authenticated', 'service_role']) r
   cross join unnest(array['select', 'insert', 'update', 'delete', 'truncate', 'references', 'trigger', 'maintain']) p
   where n.nspname = 'public' and c.relkind = 'r' and has_table_privilege(r, c.oid, p)
  union all
  -- permessi dati a PUBLIC (tutti i ruoli): «=» nell'elenco dei permessi
  select c.relname || ':PUBLIC:' || a.privilege_type
    from pg_class c join pg_namespace n on n.oid = c.relnamespace, aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
   where n.nspname = 'public' and c.relkind = 'r' and a.grantee = 0
$f$;

create or replace function prova.permessi_colonna() returns setof text language sql stable as $f$
  select table_name || '.' || column_name || ':' || grantee || ':' || privilege_type
    from information_schema.column_privileges
   where table_schema = 'public' and grantee in ('anon', 'authenticated', 'service_role', 'PUBLIC')
     and not exists (select 1 from information_schema.table_privileges tp
                      where tp.table_schema = 'public' and tp.table_name = column_privileges.table_name
                        and tp.grantee = column_privileges.grantee and tp.privilege_type = column_privileges.privilege_type)
$f$;

create or replace function prova.execute() returns setof text language sql stable as $f$
  select p.oid::regprocedure::text || ':' || r
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   cross join unnest(array['anon', 'authenticated', 'service_role']) r
   where n.nspname = 'public' and has_function_privilege(r, p.oid, 'execute')
$f$;

create or replace function prova.regole() returns setof text language sql stable as $f$
  select tablename || ':' || policyname || ':' || cmd || ':' || roles::text || ':' || coalesce(qual, '') || ':' || coalesce(with_check, '')
    from pg_policies where schemaname = 'public'
$f$;

create or replace function prova.rls() returns setof text language sql stable as $f$
  select c.relname || ':' || c.relrowsecurity || ':' || c.relforcerowsecurity
    from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r'
$f$;

create or replace function prova.fotografa(etichetta text) returns void language plpgsql as $f$
begin
  delete from prova.fotografie f where f.etichetta = fotografa.etichetta;
  insert into prova.fotografie select etichetta, 'oggetto', x from prova.oggetti_ora() x;
  insert into prova.fotografie select etichetta, 'righe', tabella || ':' || n from prova.righe();
  insert into prova.fotografie select etichetta, 'impronta', tabella || ':' || h from prova.impronte();
  insert into prova.fotografie select etichetta, 'vecchie', tabella || ':' || h from prova.impronte_vecchie();
  insert into prova.fotografie select etichetta, 'permesso', x from prova.permessi() x;
  insert into prova.fotografie select etichetta, 'colonna', x from prova.permessi_colonna() x;
  insert into prova.fotografie select etichetta, 'execute', x from prova.execute() x;
  insert into prova.fotografie select etichetta, 'regola', x from prova.regole() x;
  insert into prova.fotografie select etichetta, 'rls', x from prova.rls() x;
  -- file su disco di ogni tabella: se una migrazione RISCRIVE una tabella, il suo relfilenode cambia
  insert into prova.fotografie select etichetta, 'file', c.relname || ':' || c.relfilenode
    from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r';
end $f$;

-- piano di esecuzione (EXPLAIN senza costi) su una riga; «senza_scansione» spegne la scansione sequenziale per vedere se l'indice è usabile
create or replace function prova.piano(q text, senza_scansione boolean) returns text language plpgsql as $f$
declare
  r record;
  testo text := '';
begin
  if senza_scansione then perform set_config('enable_seqscan', 'off', true); end if;
  for r in execute 'explain (costs off) ' || q loop
    testo := testo || ' / ' || btrim(r."QUERY PLAN");
  end loop;
  perform set_config('enable_seqscan', 'on', true);
  return substr(testo, 4);
end $f$;
grant execute on function prova.piano(text, boolean) to service_role;

-- differenze di un tipo tra due fotografie: «+» comparso in «dopo», «-» sparito
create or replace function prova.differenze(prima text, dopo text, tipo_scelto text) returns setof text language sql stable as $f$
  (select '+' || valore from prova.fotografie where etichetta = dopo and tipo = tipo_scelto
   except select '+' || valore from prova.fotografie where etichetta = prima and tipo = tipo_scelto)
  union all
  (select '-' || valore from prova.fotografie where etichetta = prima and tipo = tipo_scelto
   except select '-' || valore from prova.fotografie where etichetta = dopo and tipo = tipo_scelto)
$f$;
-- le stesse differenze come elenco ordinato (vuoto = nessuna)
create or replace function prova.elenco_differenze(prima text, dopo text, tipo_scelto text) returns text[] language sql stable as $f$
  select coalesce(array_agg(x order by x), '{}') from prova.differenze(prima, dopo, tipo_scelto) x
$f$;
