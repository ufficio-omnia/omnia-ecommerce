-- 0125 — Tender Intelligence, fase B4: eventi per impresa, coda delle email per destinatario, giri del processo giornaliero, destinatari
-- validi. BOZZA (B2, 26B): non applicata. Additiva e idempotente. Richiede 0092, 0111, 0124.
-- Solo il server (service_role) legge e scrive: nessun permesso ai clienti. MAI indirizzi email o testi delle email in queste tabelle
-- (il testo si ricompone dai dati congelati dell'evento, l'indirizzo si legge al momento dell'invio).

-- EVENTI: un fatto di una gara per UN'impresa. Unico per (impresa, gara, tipo, versione): una gara salvata e monitorata = un solo evento.
create table if not exists public.omnia_ai_radar_eventi (
  id uuid primary key default gen_random_uuid(),
  impresa_id uuid not null references public.omnia_ai_radar_impostazioni (user_id) on delete cascade,
  categoria text not null check (categoria in ('nuove_opportunita', 'scadenze', 'rettifiche')),
  tipo text not null check (tipo in ('scadenza_10', 'scadenza_5', 'scadenza_1', 'scadenza_ravvicinata', 'rettifica', 'proroga',
                                     'modifica_scadenza', 'documenti', 'annullamento', 'riepilogo_opportunita')),
  gara_chiave text not null check (
    gara_chiave = 'riepilogo'
    or gara_chiave ~ '^(p|a):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
  -- riferimenti storici SENZA chiave esterna: nessun nuovo «ponte» per PostgREST (radar_procedure è già collegata direttamente alle gare
  -- aggiunte: un secondo percorso renderebbe ambigui gli incorporamenti); l'archivio del radar non cancella righe
  procedura_id uuid,
  aggiunta_id uuid,
  aggiornamento_id uuid,
  versione text not null check (char_length(versione) between 1 and 120),
  -- dati dell'email congelati alla nascita (EventoRadar del contratto tipi.ts); compattati a null dopo la conservazione (D-E7)
  dati jsonb,
  dati_compattati_il timestamptz,
  stato text not null default 'attivo' check (stato in ('attivo', 'annullato')),
  annullato_il timestamptz,
  motivo_annullamento text check (motivo_annullamento is null or motivo_annullamento ~ '^[a-z_]{2,60}$'),
  creato_il timestamptz not null default now(),
  constraint omnia_ai_radar_eventi_categoria_tipo check (
    (categoria = 'scadenze') = (tipo like 'scadenza%')
    and (categoria = 'nuove_opportunita') = (tipo = 'riepilogo_opportunita')),
  constraint omnia_ai_radar_eventi_riepilogo check ((tipo = 'riepilogo_opportunita') = (gara_chiave = 'riepilogo')),
  constraint omnia_ai_radar_eventi_annullato check ((stato = 'annullato') = (annullato_il is not null and motivo_annullamento is not null)),
  constraint omnia_ai_radar_eventi_dati check (
    (dati is null) = (dati_compattati_il is not null)
    and (dati is null or (jsonb_typeof(dati) = 'object' and octet_length(dati::text) <= 100000))),
  constraint omnia_ai_radar_eventi_unico unique (impresa_id, gara_chiave, tipo, versione)
);
-- annullare i promemoria della vecchia scadenza di una gara (proroga) per tutte le imprese
create index if not exists omnia_ai_radar_eventi_gara_attivi_idx on public.omnia_ai_radar_eventi (gara_chiave, categoria) where stato = 'attivo';
-- compattazione dei dati vecchi
create index if not exists omnia_ai_radar_eventi_da_compattare_idx on public.omnia_ai_radar_eventi (creato_il) where dati is not null;
-- conservazione (D-E7): cancellazione a blocchi degli eventi di oltre 12 mesi (i dati sono già compattati, quindi fuori dall'indice parziale)
create index if not exists omnia_ai_radar_eventi_creato_idx on public.omnia_ai_radar_eventi (creato_il);

-- CONSEGNE: un evento per UN destinatario. Unica per (destinatario, gara, tipo, versione) tramite «chiave».
create table if not exists public.omnia_ai_radar_email_consegne (
  id uuid primary key default gen_random_uuid(),
  -- v-C (appendice C): «singola» = un evento; «raggruppata» = una email con più avvisi urgenti della stessa persona (le consegne incluse
  -- puntano qui con inclusa_in e non partono più da sole)
  tipo_consegna text not null default 'singola' check (tipo_consegna in ('singola', 'raggruppata')),
  evento_id uuid references public.omnia_ai_radar_eventi (id) on delete cascade,
  inclusa_in uuid references public.omnia_ai_radar_email_consegne (id),
  impresa_id uuid not null,                      -- copia per la separazione (trigger qui sotto); senza chiave esterna
  destinatario_id uuid not null references public.users (id) on delete cascade,
  ruolo text not null check (ruolo in ('titolare', 'ufficio_gare')),
  -- «<destinatario>:<gara>:<tipo>:<versione>»: la deduplica forte richiesta dall'utente, decisa dal database
  chiave text not null check (char_length(chiave) between 10 and 300),
  priorita smallint not null check (priorita between 1 and 9),
  stato text not null default 'in_coda' check (stato in ('in_coda', 'in_invio', 'inviata', 'inclusa', 'annullata', 'scartata', 'fallita',
                                                          'esito_incerto', 'rimbalzata', 'reclamo')),
  tentativi smallint not null default 0 check (tentativi between 0 and 20),
  primo_tentativo_il timestamptz,
  prossimo_tentativo_il timestamptz not null default now(),
  in_invio_fino_il timestamptz,                  -- «affitto»: chi ha preso la consegna la deve chiudere entro questa ora
  -- chiave di idempotenza verso il provider (Resend: header Idempotency-Key, 24 ore, ≤ 256 caratteri), derivata e immutabile
  chiave_idempotenza text generated always as ('omnia-radar/' || id::text) stored,
  provider text check (provider is null or provider in ('finto', 'resend')),
  provider_id text check (provider_id is null or char_length(provider_id) <= 200),
  ultimo_errore text check (ultimo_errore is null or char_length(ultimo_errore) <= 500),   -- solo codici, mai indirizzi
  motivo text check (motivo is null or motivo ~ '^[a-z_]{2,60}$'),
  inviata_il timestamptz,
  chiusa_il timestamptz,
  creata_il timestamptz not null default now(),
  aggiornata_il timestamptz not null default now(),
  constraint omnia_ai_radar_email_consegne_chiave_unica unique (chiave),
  constraint omnia_ai_radar_email_consegne_tipo_evento check ((tipo_consegna = 'singola') = (evento_id is not null)),
  constraint omnia_ai_radar_email_consegne_inclusa check (
    (stato = 'inclusa') = (inclusa_in is not null) and (inclusa_in is null or tipo_consegna = 'singola')),
  constraint omnia_ai_radar_email_consegne_inviata check (stato <> 'inviata' or (inviata_il is not null and provider is not null and provider_id is not null)),
  constraint omnia_ai_radar_email_consegne_in_invio check (stato <> 'in_invio' or in_invio_fino_il is not null),
  constraint omnia_ai_radar_email_consegne_chiusa check (
    stato not in ('annullata', 'scartata', 'fallita', 'esito_incerto') or (motivo is not null and chiusa_il is not null))
);
create index if not exists omnia_ai_radar_email_consegne_da_inviare_idx
  on public.omnia_ai_radar_email_consegne (priorita, prossimo_tentativo_il) where stato in ('in_coda', 'in_invio');
create index if not exists omnia_ai_radar_email_consegne_evento_idx on public.omnia_ai_radar_email_consegne (evento_id);
create index if not exists omnia_ai_radar_email_consegne_inclusa_idx on public.omnia_ai_radar_email_consegne (inclusa_in) where inclusa_in is not null;
create index if not exists omnia_ai_radar_email_consegne_impresa_idx on public.omnia_ai_radar_email_consegne (impresa_id, creata_il desc);
-- console «messaggi non consegnati» (B1): paginazione a cursore (aggiornata_il, id), sempre in ordine discendente
create index if not exists omnia_ai_radar_email_consegne_problemi_idx
  on public.omnia_ai_radar_email_consegne (aggiornata_il desc, id desc) where stato in ('fallita', 'esito_incerto', 'rimbalzata', 'reclamo');
-- console: conteggi per stato degli ultimi giorni
create index if not exists omnia_ai_radar_email_consegne_creata_idx on public.omnia_ai_radar_email_consegne (creata_il);
create index if not exists omnia_ai_radar_email_consegne_provider_idx
  on public.omnia_ai_radar_email_consegne (provider_id) where provider_id is not null;

-- separazione tra imprese, decisa dal database: la consegna è dell'impresa dell'evento e va SOLO al suo titolare o a un suo membro attivo
create or replace function public.radar_consegna_separazione()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_impresa uuid;
  v_padre record;
begin
  if new.evento_id is not null then
    select e.impresa_id into v_impresa from public.omnia_ai_radar_eventi e where e.id = new.evento_id;
    if v_impresa is null or v_impresa <> new.impresa_id then
      raise exception 'Consegna: impresa diversa da quella dell''evento' using errcode = '23514';
    end if;
  end if;
  -- una consegna inclusa in un raggruppamento: stesso destinatario, stessa impresa, e il padre è davvero un raggruppamento
  if new.inclusa_in is not null then
    select c.impresa_id, c.destinatario_id, c.tipo_consegna into v_padre from public.omnia_ai_radar_email_consegne c where c.id = new.inclusa_in;
    if not found or v_padre.tipo_consegna <> 'raggruppata' or v_padre.impresa_id <> new.impresa_id or v_padre.destinatario_id <> new.destinatario_id then
      raise exception 'Consegna: raggruppamento di un''altra persona o impresa' using errcode = '23514';
    end if;
  end if;
  if new.ruolo = 'titolare' and new.destinatario_id <> new.impresa_id then
    raise exception 'Consegna: il titolare non è l''impresa' using errcode = '23514';
  end if;
  if new.ruolo = 'ufficio_gare' and not exists (
       select 1 from public.omnia_ai_membri m
        where m.membro_id = new.destinatario_id and m.titolare_id = new.impresa_id and m.attivo) then
    raise exception 'Consegna: destinatario non membro attivo dell''impresa' using errcode = '23514';
  end if;
  return new;
end
$$;
create or replace trigger omnia_ai_radar_email_consegne_separazione
  before insert or update of evento_id, impresa_id, destinatario_id, ruolo, inclusa_in on public.omnia_ai_radar_email_consegne
  for each row execute function public.radar_consegna_separazione();

-- GIRI del processo giornaliero: uno alla volta (indice unico parziale), cursori e conteggi per il monitoraggio
create table if not exists public.radar_notifiche_giri (
  id uuid primary key default gen_random_uuid(),
  giorno_roma date not null,
  fase text not null check (fase in ('eventi', 'invio')),
  esito text not null default 'in_corso' check (esito in ('in_corso', 'riuscito', 'fallito', 'fermato')),
  iniziato_il timestamptz not null default now(),
  in_corso_fino_il timestamptz not null,
  finito_il timestamptz,
  ambiente text not null check (ambiente in ('staging', 'produzione', 'locale')),
  provider text not null check (provider in ('finto', 'resend')),
  cursore_modifiche timestamptz,                 -- radar_aggiornamenti.rilevato_il già letti
  cursore_nuove timestamptz,                     -- radar_procedure.prima_rilevazione_il già letti
  -- gare nuove non ancora classificate al giro: si rivalutano al giro dopo (difetto 3.3, proposta A approvata dall'utente il 20/11)
  nuove_in_sospeso uuid[] not null default '{}'::uuid[] check (cardinality(nuove_in_sospeso) <= 2000),
  conteggi jsonb not null default '{}'::jsonb check (jsonb_typeof(conteggi) = 'object' and octet_length(conteggi::text) <= 20000),
  errore text check (errore is null or char_length(errore) <= 1000),
  constraint radar_notifiche_giri_finito check ((esito = 'in_corso') = (finito_il is null))
);
create unique index if not exists radar_notifiche_giri_uno_alla_volta on public.radar_notifiche_giri ((true)) where esito = 'in_corso';
create index if not exists radar_notifiche_giri_ultimi_idx on public.radar_notifiche_giri (fase, giorno_roma desc, iniziato_il desc);

-- DESTINATARI VALIDI delle imprese indicate, in UNA richiesta (nessun N+1 sull'API di autenticazione). Solo il server la esegue.
-- Restituisce SOLO il titolare (impresa stessa) e i membri dell'Ufficio Gare di quelle imprese: mai amministratori della console in quanto
-- tali, mai persone di altre imprese.
create or replace function public.radar_notifiche_destinatari(p_imprese uuid[])
returns table (impresa_id uuid, user_id uuid, ruolo text, email text, email_confermata boolean, bloccato boolean, membro_attivo boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select t.id, t.id, 'titolare'::text, u.email::text,
         u.email_confirmed_at is not null,
         (u.banned_until is not null and u.banned_until > now()) or u.deleted_at is not null,
         true
    from unnest(p_imprese) as t (id)
    join auth.users u on u.id = t.id
  union all
  select m.titolare_id, m.membro_id, 'ufficio_gare'::text, u.email::text,
         u.email_confirmed_at is not null,
         (u.banned_until is not null and u.banned_until > now()) or u.deleted_at is not null,
         m.attivo
    from public.omnia_ai_membri m
    join auth.users u on u.id = m.membro_id
   where m.titolare_id = any (p_imprese)
$$;
revoke all on function public.radar_notifiche_destinatari(uuid[]) from public, anon, authenticated;
grant execute on function public.radar_notifiche_destinatari(uuid[]) to service_role;

-- CONTEGGI PER STATO per la console (B1, sola lettura), in UNA richiesta. Con i permessi di chi chiama (service_role): nessun dato di persone.
create or replace function public.radar_email_conteggi(p_dal timestamptz)
returns table (stato text, n bigint)
language sql
stable
set search_path = ''
as $$
  select c.stato, count(*)
    from public.omnia_ai_radar_email_consegne c
   where c.creata_il >= p_dal
   group by c.stato
$$;
revoke all on function public.radar_email_conteggi(timestamptz) from public, anon, authenticated;
grant execute on function public.radar_email_conteggi(timestamptz) to service_role;

-- STATO DEL PASSAGGIO del processo giornaliero in UNA richiesta (O2, direttiva 44A): fase «eventi» già riuscita oggi, battito «invio» già
-- scritto oggi, consegne da prendere adesso (STESSA condizione della presa in carico del motore: in coda e dovute, oppure con l'affitto
-- scaduto e dovute). Restituisce SOLO tre valori veri/falsi: nessun dato di imprese o persone. «security invoker»: gira con i permessi di chi
-- chiama (solo service_role, che legge già queste tabelle), quindi non dà a nessuno più di quanto abbia; search_path vuoto e nomi qualificati.
create or replace function public.radar_notifiche_stato_passaggio(p_giorno date, p_adesso timestamptz)
returns table (eventi_fatti boolean, battito_invio boolean, lavoro boolean)
language sql
stable
security invoker
set search_path = ''
as $$
  -- i giri di oggi in UNA lettura dell'indice (come la lettura dei giri del motore con O1: al più 500 righe), poi la coda
  select coalesce(bool_or(g.fase = 'eventi' and g.esito = 'riuscito'), false),
         coalesce(bool_or(g.fase = 'invio'), false),
         exists (select 1 from public.omnia_ai_radar_email_consegne c
                  where c.stato in ('in_coda', 'in_invio')
                    and ((c.stato = 'in_coda' and c.prossimo_tentativo_il <= p_adesso)
                      or (c.stato = 'in_invio' and c.in_invio_fino_il < p_adesso and c.prossimo_tentativo_il <= p_adesso)))
    from (select g.fase, g.esito from public.radar_notifiche_giri g where g.fase in ('eventi', 'invio') and g.giorno_roma = p_giorno limit 500) g
$$;
revoke all on function public.radar_notifiche_stato_passaggio(date, timestamptz) from public, anon, authenticated;
grant execute on function public.radar_notifiche_stato_passaggio(date, timestamptz) to service_role;

alter table public.omnia_ai_radar_eventi enable row level security;
alter table public.omnia_ai_radar_email_consegne enable row level security;
alter table public.radar_notifiche_giri enable row level security;
revoke all on public.omnia_ai_radar_eventi from public, anon, authenticated, service_role;
revoke all on public.omnia_ai_radar_email_consegne from public, anon, authenticated, service_role;
revoke all on public.radar_notifiche_giri from public, anon, authenticated, service_role;
-- eventi e consegne non si cancellano nel lavoro normale: si annullano (stato) e si compattano i dati. «delete» al solo server serve alla
-- CONSERVAZIONE approvata (D-E7: righe cancellate dopo 12 mesi, a blocchi, dalla rotta del processo giornaliero); i clienti non hanno nulla
grant select, insert, update, delete on public.omnia_ai_radar_eventi to service_role;
grant select, insert, update, delete on public.omnia_ai_radar_email_consegne to service_role;
grant select, insert, update, delete on public.radar_notifiche_giri to service_role;

notify pgrst, 'reload schema';
