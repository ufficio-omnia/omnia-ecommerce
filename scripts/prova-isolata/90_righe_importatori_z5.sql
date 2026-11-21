-- SOLO PER LA PROVA ISOLATA (dossier Z5, documento 45): REGRESSIONE delle rettifiche TED, PVL, Sintel e SardegnaCAT su un Postgres VERO.
-- Le righe vengono dalla batteria scripts/verifica-radar-b4-db-connettori.ts (RADAR_RIGHE_PER_POSTGRES): sono ciò che gli importatori veri
-- scrivono, con l'evidenza ACCESA e SPENTA, nel registro dei cambiamenti e nelle provenienze (dati sintetici e campione pubblico della PVL).
-- Ogni gruppo (un database in memoria della batteria) entra come lo scriverebbe PostgREST (solo le colonne presenti, le altre col valore di
-- base) sopra gare sintetiche con identificativi nuovi; poi il gruppo si annulla (nessuna riga resta). Un vincolo della 0123 violato da una
-- riga vera degli importatori ferma la prova.
\set ON_ERROR_STOP on

-- una riga come la inserirebbe PostgREST: solo le colonne del JSON
create or replace function prova.inserisci_riga(tabella text, riga jsonb) returns void language plpgsql as $f$
declare
  colonne text;
begin
  select string_agg(format('%I', k), ', ' order by k) into colonne from jsonb_object_keys(riga) k;
  execute format('insert into public.%I (%s) select %s from jsonb_populate_record(null::public.%I, $1)', tabella, colonne, colonne, tabella) using riga;
end $f$;

create or replace function prova.carica_righe_importatori(dati jsonb) returns jsonb language plpgsql as $f$
declare
  g jsonb;
  x jsonb;
  k text;
  mappa jsonb;
  nuovo uuid;
  colonne_reg text[];
  colonne_prov text[];
  sconosciute text[] := '{}';
  n_gruppi int := 0;
  n_reg int := 0;
  n_prov int := 0;
  n_foto int := 0;
  n_evidenza int := 0;
  n_senza int := 0;
  n_giro int := 0;
  email_json int;
  email_db int;
  per_fonte jsonb := '{}';
  email_per_fonte jsonb := '{}';
  f text;
begin
  select array_agg(column_name::text) into colonne_reg from information_schema.columns where table_schema = 'public' and table_name = 'radar_aggiornamenti';
  select array_agg(column_name::text) into colonne_prov from information_schema.columns where table_schema = 'public' and table_name = 'radar_procedure_fonti';
  for g in select value from jsonb_array_elements(dati -> 'gruppi') loop
    n_gruppi := n_gruppi + 1;
    for x in select value from jsonb_array_elements(g -> 'radar_aggiornamenti') loop
      for k in select jsonb_object_keys(x) loop
        if not (k = any (colonne_reg)) then sconosciute := sconosciute || ('radar_aggiornamenti.' || k); end if;
      end loop;
    end loop;
    for x in select value from jsonb_array_elements(g -> 'radar_procedure_fonti') loop
      for k in select jsonb_object_keys(x) loop
        if not (k = any (colonne_prov)) then sconosciute := sconosciute || ('radar_procedure_fonti.' || k); end if;
      end loop;
    end loop;
    begin
      mappa := '{}';
      for k in select jsonb_array_elements_text(g -> 'procedure') loop
        nuovo := gen_random_uuid();
        mappa := mappa || jsonb_build_object(k, nuovo);
        insert into public.radar_procedure (id, chiave, oggetto) values (nuovo, 'prova:z5:importatori:' || nuovo, 'Gara sintetica degli importatori (prova)');
      end loop;
      for x in select value from jsonb_array_elements(g -> 'radar_procedure_fonti') loop
        perform prova.inserisci_riga('radar_procedure_fonti', x || jsonb_build_object('procedura_id', mappa ->> (x ->> 'procedura_id')));
        n_prov := n_prov + 1;
        if jsonb_typeof(x -> 'foto') = 'object' then n_foto := n_foto + 1; end if;
      end loop;
      email_json := 0;
      for x in select value from jsonb_array_elements(g -> 'radar_aggiornamenti') loop
        perform prova.inserisci_riga('radar_aggiornamenti', x || jsonb_build_object('procedura_id', mappa ->> (x ->> 'procedura_id')));
        n_reg := n_reg + 1;
        f := x ->> 'fonte';
        per_fonte := per_fonte || jsonb_build_object(f, coalesce((per_fonte ->> f)::int, 0) + 1);
        if x ? 'affidabilita' then n_evidenza := n_evidenza + 1; else n_senza := n_senza + 1; end if;
        if (x ->> 'esecuzione_id') is not null then n_giro := n_giro + 1; end if;
        if coalesce((x ->> 'notifica_email')::boolean, false) then
          email_json := email_json + 1;
          email_per_fonte := email_per_fonte || jsonb_build_object(f, coalesce((email_per_fonte ->> f)::int, 0) + 1);
        end if;
      end loop;
      -- nel database: righe notificabili = quelle che l'importatore ha segnato; le righe scritte SENZA evidenza hanno notifica_email falso
      select count(*) filter (where a.notifica_email) into email_db
        from public.radar_aggiornamenti a where a.procedura_id in (select (value #>> '{}')::uuid from jsonb_each(mappa));
      if email_db <> email_json then
        raise exception 'FALLITO gruppo %: % righe notificabili nel database, % segnate dagli importatori', g ->> 'gruppo', email_db, email_json;
      end if;
      raise exception using errcode = 'P0099', message = 'gruppo annullato';
    exception
      when sqlstate 'P0099' then null;
      when others then
        raise exception 'FALLITO gruppo % (% righe del registro, % provenienze): % [%]', g ->> 'gruppo', jsonb_array_length(g -> 'radar_aggiornamenti'),
          jsonb_array_length(g -> 'radar_procedure_fonti'), sqlerrm, sqlstate;
    end;
  end loop;
  return jsonb_build_object('gruppi', n_gruppi, 'registro', n_reg, 'provenienze', n_prov, 'fotografie', n_foto, 'con_evidenza', n_evidenza, 'senza_evidenza', n_senza,
                            'con_giro', n_giro, 'per_fonte', per_fonte, 'email_per_fonte', email_per_fonte, 'colonne_sconosciute', to_jsonb(sconosciute));
end $f$;
grant execute on function prova.inserisci_riga(text, jsonb), prova.carica_righe_importatori(jsonb) to service_role;
create table if not exists prova.esito_importatori (esito jsonb);
grant select, insert on prova.esito_importatori to service_role;
