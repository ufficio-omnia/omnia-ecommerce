-- Falla di conteggio: gara_consumi.gara_id aveva on delete cascade, quindi
-- cancellare una gara già analizzata cancellava anche la sua riga di
-- consumo e liberava la quota — cancellando e ricreando la gara si
-- ottenevano analisi illimitate. Il consumo deve essere un fatto storico
-- incancellabile: la riga sopravvive alla gara, solo il riferimento si
-- annulla (on delete set null). gara_titolo cattura il titolo al momento
-- del consumo così il registro resta leggibile anche a gara cancellata
-- (serve anche alla console costi/ricavi futura).
--
-- Il vincolo unique(gara_id) andava sostituito: con la colonna annullabile
-- smetterebbe di proteggere le gare esistenti (NULL non è mai uguale a se
-- stesso per un vincolo UNIQUE standard, quindi più righe con gara_id null
-- passerebbero comunque) mentre servirebbe comunque impedire due righe
-- per la STESSA gara ancora esistente — un indice unico parziale
-- (where gara_id is not null) copre esattamente questo.
--
-- Il conteggio "gare usate nel periodo corrente" in gara-consumo.ts non
-- filtra mai su gara_id (solo su user_id/tipo/created_at): righe con gara
-- cancellata restavano già incluse prima di questa migrazione, nessuna
-- modifica di codice necessaria per quel conteggio.
--
-- Idempotente: drop constraint/index con IF EXISTS, add column con IF NOT
-- EXISTS, backfill con WHERE ... IS NULL, indice con IF NOT EXISTS —
-- sicura da rieseguire.

alter table public.gara_consumi drop constraint if exists gara_consumi_gara_id_key;
alter table public.gara_consumi drop constraint if exists gara_consumi_gara_id_fkey;

alter table public.gara_consumi alter column gara_id drop not null;

alter table public.gara_consumi
  add constraint gara_consumi_gara_id_fkey
  foreign key (gara_id) references public.gare (id) on delete set null;

create unique index if not exists gara_consumi_gara_id_unique_idx
  on public.gara_consumi (gara_id)
  where gara_id is not null;

alter table public.gara_consumi add column if not exists gara_titolo text;

-- Backfill del titolo per le righe esistenti la cui gara esiste ancora.
-- Per le righe la cui gara è già stata cancellata prima di questa
-- migrazione non c'è modo di recuperare il titolo: restano con
-- gara_titolo null, limite noto e accettato.
update public.gara_consumi gc
set gara_titolo = g.titolo
from public.gare g
where gc.gara_id = g.id
  and gc.gara_titolo is null;
