-- SOLO PER LA PROVA ISOLATA: O2 (direttiva 44A) — la funzione radar_notifiche_stato_passaggio della 0125 confrontata con le letture di O1
-- (giri di oggi e presa in carico del motore) sullo STESSO database sintetico. Si applica dopo 40_prova_b4.sql (dati sintetici di 35_dati_b4).
-- Ogni controllo stampa «ok …»; il primo che fallisce ferma tutto (ON_ERROR_STOP).
\set ON_ERROR_STOP on
reset role;

-- ───── la funzione: sicurezza e permessi ─────
select prova.verifica('O2: funzione «security invoker» (gira con i permessi di chi chiama), stabile, search_path vuoto',
  (select not p.prosecdef and p.provolatile = 's' and p.proconfig = array['search_path=""'] from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'radar_notifiche_stato_passaggio'));
select prova.verifica('O2: EXECUTE solo a service_role (non a public, anon, authenticated)',
  has_function_privilege('service_role', 'public.radar_notifiche_stato_passaggio(date, timestamptz)', 'execute')
  and not has_function_privilege('anon', 'public.radar_notifiche_stato_passaggio(date, timestamptz)', 'execute')
  and not has_function_privilege('authenticated', 'public.radar_notifiche_stato_passaggio(date, timestamptz)', 'execute')
  and not exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                   where p.proname = 'radar_notifiche_stato_passaggio' and a.grantee = 0 and a.privilege_type = 'EXECUTE'));
select prova.verifica('O2: restituisce SOLO tre valori veri/falsi (nessun dato di imprese o persone)',
  (select array_agg(format_type(t, null) order by o) from pg_proc p, unnest(p.proallargtypes, p.proargmodes) with ordinality as x (t, m, o)
    where p.proname = 'radar_notifiche_stato_passaggio' and m = 't') = array['boolean', 'boolean', 'boolean']);
set role anon;
select prova.atteso_errore('O2: anon non la esegue', $q$select * from public.radar_notifiche_stato_passaggio(current_date, now())$q$, '42501');
reset role;
set role authenticated;
select prova.atteso_errore('O2: un cliente autenticato non la esegue', $q$select * from public.radar_notifiche_stato_passaggio(current_date, now())$q$, '42501');
reset role;
set role service_role;
select prova.verifica('O2: il server la esegue con i suoi permessi', (select count(*) from public.radar_notifiche_stato_passaggio(current_date, now())) = 1);
reset role;

-- ───── equivalenza con O1 su 300 stati casuali (riproducibili) ─────
-- TUTTO in una transazione ANNULLATA alla fine: la prova non lascia nulla. Un evento e 30 consegne PROPRIE della prova (titolare T1), i giri
-- della prova marcati con errore «prova-o2»; le consegne in coda delle prove di prima diventano non dovute, così il caso «nulla da fare»
-- (quello che conta per O2) compare davvero.
begin;
update public.omnia_ai_radar_email_consegne set prossimo_tentativo_il = timestamptz '2099-01-01' where stato in ('in_coda', 'in_invio');
insert into public.omnia_ai_radar_eventi (id, impresa_id, categoria, tipo, gara_chiave, versione, dati)
  values ('eeeeeeee-0000-4000-8000-0000000000f2', '11111111-1111-4111-8111-111111111111', 'scadenze', 'scadenza_10', 'p:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'prova-o2', '{}');
insert into public.omnia_ai_radar_email_consegne (evento_id, impresa_id, destinatario_id, ruolo, chiave, priorita)
  select 'eeeeeeee-0000-4000-8000-0000000000f2', '11111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111', 'titolare', 'prova-o2-' || lpad(i::text, 3, '0'), 1 + i % 9
    from generate_series(1, 30) i;
do $$
declare
  diversi int := 0;
  casi int := 0;
  conta_lavoro int := 0;
  conta_eventi int := 0;
  conta_battito int := 0;
  attiva double precision;
  giorno date;
  adesso timestamptz;
  o2 record;
  o1_eventi boolean;
  o1_battito boolean;
  o1_lavoro boolean;
begin
  perform setseed(0.2026);
  for i in 1 .. 300 loop
    giorno := date '2026-11-20' + (floor(random() * 3) - 1)::int;
    adesso := timestamptz '2026-11-20 12:00+00' + make_interval(mins => (floor(random() * 240) - 120)::int);
    -- consegne della prova: una parte casuale (dallo 0 al 50 %) ha stato, tentativo dovuto e affitto casuali intorno ad «adesso»; le altre
    -- sono sicuramente non prendibili (in coda dovute domani, oppure in invio con l'affitto valido): compaiono sia «lavoro» sia «nulla da fare»
    attiva := (array[0.0, 0.02, 0.1, 0.5])[1 + floor(random() * 4)::int];
    update public.omnia_ai_radar_email_consegne c set
        stato = s.stato,
        prossimo_tentativo_il = adesso + make_interval(mins => s.dt),
        in_invio_fino_il = case when s.stato = 'in_invio' then adesso + make_interval(mins => s.df) end,
        motivo = case when s.stato = 'annullata' then 'prova_equivalenza' end,
        chiusa_il = case when s.stato = 'annullata' then adesso end
      from (select y.id,
                   case when y.r < attiva then (array['in_coda', 'in_invio', 'annullata'])[1 + floor(y.a * 3)::int] else (array['in_coda', 'in_invio'])[1 + floor(y.a * 2)::int] end as stato,
                   case when y.r < attiva then (floor(y.b * 60) - 30)::int else 1440 end as dt,
                   case when y.r < attiva then (floor(y.c * 60) - 30)::int else 60 end as df
              from (select x.id, random() as r, random() as a, random() as b, random() as c
                      from public.omnia_ai_radar_email_consegne x where x.chiave like 'prova-o2-%') y) s
     where c.id = s.id;
    -- giri della prova: alcuni giri finiti (mai «in corso»: c'è già quello della prova di prima) nei tre giorni intorno
    delete from public.radar_notifiche_giri where errore = 'prova-o2';
    insert into public.radar_notifiche_giri (giorno_roma, fase, esito, iniziato_il, in_corso_fino_il, finito_il, ambiente, provider, errore)
      select date '2026-11-20' + (floor(random() * 3) - 1)::int, (array['eventi', 'invio'])[1 + floor(random() * 2)::int],
             (array['riuscito', 'fallito', 'fermato'])[1 + floor(random() * 3)::int], adesso, adesso, adesso, 'locale', 'finto', 'prova-o2'
        from generate_series(1, floor(random() * 4)::int);
    select * into o2 from public.radar_notifiche_stato_passaggio(giorno, adesso);
    -- O1: la lettura dei giri di oggi del motore (al più 500 righe) e la sua presa in carico (stato in (…) e il filtro «or»)
    select coalesce(bool_or(fase = 'eventi' and esito = 'riuscito'), false), coalesce(bool_or(fase = 'invio'), false) into o1_eventi, o1_battito
      from (select fase, esito from public.radar_notifiche_giri where fase in ('eventi', 'invio') and giorno_roma = giorno limit 500) g;
    select exists (select id from public.omnia_ai_radar_email_consegne
                    where stato in ('in_coda', 'in_invio')
                      and ((stato = 'in_coda' and prossimo_tentativo_il <= adesso)
                        or (stato = 'in_invio' and in_invio_fino_il < adesso and prossimo_tentativo_il <= adesso))
                    order by priorita, prossimo_tentativo_il limit 50) into o1_lavoro;
    casi := casi + 1;
    if o2.eventi_fatti is distinct from o1_eventi or o2.battito_invio is distinct from o1_battito or o2.lavoro is distinct from o1_lavoro then
      diversi := diversi + 1;
    end if;
    conta_lavoro := conta_lavoro + o1_lavoro::int;
    conta_eventi := conta_eventi + o1_eventi::int;
    conta_battito := conta_battito + o1_battito::int;
  end loop;
  raise notice 'piano  O2 equivalenza: % casi, lavoro vero in %, eventi fatti in %, battito in %', casi, conta_lavoro, conta_eventi, conta_battito;
  perform prova.verifica('O2: 300 stati casuali → STESSO esito di O1 (eventi fatti, battito, lavoro), con casi veri e falsi per ognuno',
    diversi = 0 and conta_lavoro between 1 and 299 and conta_eventi between 1 and 299 and conta_battito between 1 and 299);
end $$;
rollback;
select prova.verifica('O2: la prova lascia i dati com''erano (transazione annullata)',
  not exists (select 1 from public.omnia_ai_radar_email_consegne where chiave like 'prova-o2-%')
  and not exists (select 1 from public.radar_notifiche_giri where errore = 'prova-o2')
  and not exists (select 1 from public.omnia_ai_radar_email_consegne where prossimo_tentativo_il = timestamptz '2099-01-01'));
