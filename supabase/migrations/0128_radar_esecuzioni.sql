-- 0128 — Tender Intelligence: REGISTRO DEI GIRI delle fonti (L3 del piano 36), comune a TED, PVL, Sintel e SardegnaCAT. SQL proposto per
-- Z5 (B2, documento 45): NON applicata senza l'autorizzazione dell'utente. Numero confermato dall'utente nella direttiva Z5 (21/11/2026).
-- Additiva e idempotente: una tabella nuova, vuota, un indice. Richiede solo lo schema public (nessuna chiave esterna). Nessun dato di
-- persone: conteggi, finestre lette, esiti e un errore ripulito.
-- Una riga per GIRO e per FONTE, scritta dall'importatore alla fine del giro (con l'identificativo del giro, lo stesso che la 0123 copia in
-- radar_aggiornamenti.esecuzione_id); il giro stesso cancella le righe della sua fonte oltre i 90 giorni. Solo il server legge e scrive:
-- nessun permesso ai clienti. Senza chiavi esterne (colonne di traccia: regola del progetto).

create table if not exists public.radar_esecuzioni (
  id uuid primary key default gen_random_uuid(),
  fonte text not null check (fonte in ('ted', 'pvl', 'sintel', 'sardegnacat')),
  modo text not null check (modo in ('incrementale', 'recupero', 'finestra', 'manuale')),
  iniziato_il timestamptz not null,
  finito_il timestamptz not null,
  esito text not null check (esito in ('ok', 'errore', 'sospesa', 'occupata', 'inerte', 'gia_eseguito')),
  -- periodi letti e blocchi di recupero, con avvisi dichiarati e letti
  finestre jsonb not null default '[]'::jsonb check (jsonb_typeof(finestre) in ('array', 'object') and octet_length(finestre::text) <= 20000),
  -- verso la fonte: richieste, byte, millisecondi e risposte per codice HTTP («200»: n, «429»: n…)
  fonte_richieste integer not null default 0 check (fonte_richieste >= 0),
  fonte_byte bigint not null default 0 check (fonte_byte >= 0),
  fonte_ms integer not null default 0 check (fonte_ms >= 0),
  fonte_risposte jsonb not null default '{}'::jsonb check (jsonb_typeof(fonte_risposte) = 'object' and octet_length(fonte_risposte::text) <= 2000),
  -- verso il database: richieste e millisecondi
  db_richieste integer not null default 0 check (db_richieste >= 0),
  db_ms integer not null default 0 check (db_ms >= 0),
  -- avvisi letti, compatti: per tipo e per motivo di esclusione
  avvisi jsonb not null default '{}'::jsonb check (jsonb_typeof(avvisi) = 'object' and octet_length(avvisi::text) <= 20000),
  -- effetto sull'archivio
  gare_nuove integer not null default 0 check (gare_nuove >= 0),
  gare_unite integer not null default 0 check (gare_unite >= 0),
  gare_aggiornate integer not null default 0 check (gare_aggiornate >= 0),
  rettifiche integer not null default 0 check (rettifiche >= 0),
  conflitti integer not null default 0 check (conflitti >= 0),
  -- allarmi accesi dal giro (giro_mancato, errori_ripetuti, risorse…): nomi brevi, al più 20. L'ultima condizione vieta un nome che
  -- contenga una virgola o sia vuoto: unito con le virgole, l'elenco deve dare tanti pezzi quanti sono i nomi (trovato dalla prova isolata)
  allarmi text[] not null default '{}'::text[] check (
    cardinality(allarmi) <= 20 and array_position(allarmi, null) is null
    and array_to_string(allarmi, ',') ~ '^([a-z_]{2,40}(,[a-z_]{2,40})*)?$'
    and cardinality(string_to_array(array_to_string(allarmi, ','), ',')) = cardinality(allarmi)),
  -- errore RIPULITO (mai segreti, indirizzi o risposte intere), al più 500 caratteri
  errore text check (errore is null or (char_length(errore) between 1 and 500)),
  constraint radar_esecuzioni_tempi check (finito_il >= iniziato_il),
  constraint radar_esecuzioni_errore check ((esito = 'errore') = (errore is not null))
);

-- ultimi giri di una fonte (allarmi, pagina «Fonti» della console) e cancellazione oltre i 90 giorni, fonte per fonte
create index if not exists radar_esecuzioni_fonte_idx on public.radar_esecuzioni (fonte, iniziato_il desc);

alter table public.radar_esecuzioni enable row level security;
revoke all on public.radar_esecuzioni from public, anon, authenticated, service_role;
-- una scrittura per giro e la cancellazione oltre i 90 giorni: niente update, niente truncate
grant select, insert, delete on public.radar_esecuzioni to service_role;

notify pgrst, 'reload schema';
