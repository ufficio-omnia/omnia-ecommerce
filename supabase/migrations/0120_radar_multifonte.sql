-- 0120 — Tender Intelligence, fase B2a: più fonti nello stesso archivio (Sintel, SardegnaCAT e le fonti future), 17/11/2026.
--
-- RIUSA senza duplicarle:
--   - la 0117 (unione reversibile delle gare doppie, approvata dall'utente il 17/11): radar_procedure.unita_a, unita_il, unita_motivo,
--     unita_esclusa_con, l'indice radar_procedure_unita_a_idx, il vincolo radar_procedure_unita_a_diversa e il registro in
--     radar_aggiornamenti (tipo «correzione_dati», mai notificabile). Anche i SUGGERIMENTI di unione (corrispondenze probabili, da far
--     confermare a un amministratore) stanno in quel registro: nessuna tabella nuova;
--   - la 0115: provenienza_campi, radar_procedure_fonti.id_procedura_fonte e rif_ted;
--   - la 0109: valore_base (base d'asta di Sintel e SardegnaCAT), piattaforma_host, radar_fonti_stato.
-- AGGIUNGE solo ciò che serve alle fonti nuove:
--   1) radar_procedure.piattaforma_id: identificativo della procedura sulla piattaforma di gara («sardegnacat:1031830»), letto dalla
--      piattaforma stessa o dal collegamento ai documenti di TED e PVL. È un numero TECNICO della piattaforma, non un identificativo
--      ufficiale: serve SOLO a proporre SUGGERIMENTI di unione da far confermare a un amministratore, mai a unire in automatico
--      (decisione dell'utente del 17/11/2026). Non è unica: due gare possono averla uguale finché non vengono unite;
--   2) radar_procedure.tipo_opportunita e partecipazione: bando, manifestazione di interesse, indagine di mercato, iscrizione a un sistema
--      di qualificazione (le procedure su invito e gli affidamenti diretti non entrano nell'archivio);
--   3) radar_procedure.fonti: le fonti che hanno pubblicato la gara, tenute aggiornate dal database (trigger sulla provenienza), per
--      mostrare ai clienti SOLO le gare e le fonti autorizzate;
--   4) radar_fonti_stato.nascosta_ai_clienti: una fonte importata ma non ancora mostrabile (SardegnaCAT finché manca il parere legale);
--   5) le righe delle fonti nuove, SPENTE.
--
-- ADDITIVA e idempotente: colonne nuove con valori predefiniti costanti, indici, una funzione e un trigger creati una volta sola, righe
-- nuove con «on conflict do nothing». Gli unici aggiornamenti RIEMPIONO le sole colonne nuove (fonti e piattaforma_id) delle gare già in
-- archivio, ricavandole dalla loro provenienza e dal loro collegamento ai documenti: nessun dato esistente viene modificato né cancellato.
-- Nessuna chiave esterna sulle colonne nuove. Nessun permesso nuovo ai clienti: le tabelle restano accessibili solo al server (0109).
-- Da eseguire SOLO sullo staging, con un'autorizzazione «migrazione» registrata.

-- 1) identificativo della procedura sulla piattaforma
alter table public.radar_procedure
  add column if not exists piattaforma_id text check (piattaforma_id is null or piattaforma_id ~ '^[a-z0-9_]{2,40}:[0-9]{1,12}$');
create index if not exists radar_procedure_piattaforma_idx on public.radar_procedure (piattaforma_id) where piattaforma_id is not null;

-- 2) tipo di opportunità e partecipazione
alter table public.radar_procedure
  add column if not exists tipo_opportunita text check (tipo_opportunita is null or tipo_opportunita in ('bando', 'manifestazione_interesse', 'indagine_mercato', 'sistema_qualificazione'));
alter table public.radar_procedure
  add column if not exists partecipazione text check (partecipazione is null or partecipazione in ('libera', 'iscrizione'));

-- 3) fonti della gara, tenute dal database
alter table public.radar_procedure
  add column if not exists fonti text[] not null default '{}';
create index if not exists radar_procedure_fonti_idx on public.radar_procedure using gin (fonti);

create or replace function public.radar_aggiungi_fonte_alla_gara() returns trigger
  language plpgsql
  security invoker
  set search_path = public
as $$
begin
  update public.radar_procedure
     set fonti = array_append(fonti, new.fonte)
   where id = new.procedura_id
     and not (new.fonte = any (fonti));
  return null;
end;
$$;
revoke all on function public.radar_aggiungi_fonte_alla_gara() from public, anon, authenticated;
grant execute on function public.radar_aggiungi_fonte_alla_gara() to service_role;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'radar_procedure_fonti_aggiunge_fonte' and not tgisinternal) then
    create trigger radar_procedure_fonti_aggiunge_fonte
      after insert or update of procedura_id, fonte on public.radar_procedure_fonti
      for each row execute function public.radar_aggiungi_fonte_alla_gara();
  end if;
end $$;

-- 4) fonte importata ma non ancora mostrabile ai clienti
alter table public.radar_fonti_stato
  add column if not exists nascosta_ai_clienti boolean not null default false;

-- 5) fonti nuove, SPENTE (si accendono solo dalla console, e solo sullo staging: guardia nel codice); SardegnaCAT nascosta ai clienti
insert into public.radar_fonti_stato (fonte, attiva, nascosta_ai_clienti) values ('sintel', false, false)
on conflict (fonte) do nothing;
insert into public.radar_fonti_stato (fonte, attiva, nascosta_ai_clienti) values ('sardegnacat', false, true)
on conflict (fonte) do nothing;

-- riempimento delle SOLE colonne nuove per le gare già in archivio (idempotente: tocca solo righe con la colonna ancora vuota)
update public.radar_procedure p
   set fonti = s.fonti
  from (select procedura_id, array_agg(distinct fonte order by fonte) as fonti from public.radar_procedure_fonti group by procedura_id) s
 where s.procedura_id = p.id
   and p.fonti = '{}';

update public.radar_procedure
   set piattaforma_id = 'sardegnacat:' || substring(url_documenti from '[?&](?:ID|bando)=([0-9]{1,12})(?:&|$)')
 where piattaforma_id is null
   and url_documenti ~* '^https?://(www\.)?sardegnacat\.regione\.sardegna\.it/'
   and url_documenti ~ '[?&](ID|bando)=[0-9]{1,12}(&|$)';

update public.radar_procedure
   set piattaforma_id = 'sintel:' || substring(url_documenti from 'auctionDetail\.xhtml\?(?:[^#]*&)?id=([0-9]{1,12})(?:&|$)')
 where piattaforma_id is null
   and url_documenti ~* '^https?://(www\.)?sintel\.regione\.lombardia\.it/'
   and url_documenti ~ 'auctionDetail\.xhtml\?([^#]*&)?id=[0-9]{1,12}(&|$)';

notify pgrst, 'reload schema';
