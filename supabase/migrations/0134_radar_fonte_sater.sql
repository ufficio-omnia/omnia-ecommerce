-- 0134 — Tender Intelligence, Fase 2: la fonte «sater» (connettore SATER / Intercent-ER, documento 60) nel registro dei giri e nello stato
-- delle fonti (27/11/2026).
--
-- PROGETTO, MAI APPLICATO. Numero PROPOSTO da B2 (da confermare nel registro del coordinamento). Per ora SOLO per lo STAGING, per il
-- collaudo del connettore: l'applicazione è un'autorizzazione SEPARATA dell'utente; la produzione mai senza di lui. La applica a mano
-- l'utente (o il coordinamento con la sua approvazione), mai con la chiave di servizio.
--
-- Che cosa fa:
--   1) il vincolo dei valori di radar_esecuzioni.fonte (0128) ammette in più 'sater'. Il vincolo della 0128 era scritto nella colonna, quindi
--      Postgres gli ha dato il nome radar_esecuzioni_fonte_check: si toglie e si ricrea con lo stesso nome, con tutti i valori di prima più
--      quello nuovo. Serve perché il codice (ramo feature/connettore-sater) registra anche i giri di SATER (FONTI_REGISTRO); la console
--      continua a mostrare solo TED, PVL, Sintel e SardegnaCAT;
--   2) la riga di 'sater' in radar_fonti_stato, come SardegnaCAT nella 0120: SPENTA (attiva = false), NASCOSTA ai clienti
--      (nascosta_ai_clienti = true) e con il SEMAFORO CHIUSO (blocco_fino_a = 2099-01-01, il valore convenzionale del coordinamento: il giro
--      lo apre solo il lanciatore autorizzato). Se la riga c'è già non si tocca.
--   Dopo la 0134 SATER resta spenta: per un giro serve l'accensione (scripts/c8/accendi-regionale-staging.ts, con un'autorizzazione) e il giro
--   stesso (scripts/radar-importa-regionale.ts sater, con un'autorizzazione).
--
-- Regole rispettate:
--   - ADDITIVA e NON distruttiva: nessuna riga esistente toccata (il vincolo nuovo ammette tutti i valori di prima, quindi tutte le righe di
--     radar_esecuzioni lo rispettano); una sola riga nuova in radar_fonti_stato; nessuna tabella, colonna, indice, funzione, trigger o regola
--     nuova o tolta; permessi (GRANT) invariati; nessun dato di persone;
--   - IDEMPOTENTE: «drop constraint if exists» più «add constraint» con lo stesso nome, e «on conflict do nothing»; si può rieseguire.
--   - Il controllo finale ferma tutto (e annulla la transazione) se un ALTRO vincolo di radar_esecuzioni rifiutasse ancora 'sater'.
--
-- ATTESE dopo l'applicazione (sola lettura):
--   select pg_get_constraintdef(oid) from pg_constraint where conrelid = 'public.radar_esecuzioni'::regclass and conname = 'radar_esecuzioni_fonte_check';
--     → CHECK ((fonte = ANY (ARRAY['ted'::text, 'pvl'::text, 'sintel'::text, 'sardegnacat'::text, 'sater'::text])))
--   select fonte, attiva, nascosta_ai_clienti, blocco_fino_a from public.radar_fonti_stato where fonte = 'sater';
--     → sater | false | true | 2099-01-01 00:00:00+00
--
-- RITIRO (solo se serve, e solo PRIMA di qualunque giro di SATER): togliere la riga di 'sater' da radar_fonti_stato e rimettere il vincolo
-- della 0128 senza 'sater' (che riesce solo se in radar_esecuzioni non ci sono righe di 'sater'). Non fa parte di questa migrazione.

begin;

alter table public.radar_esecuzioni drop constraint if exists radar_esecuzioni_fonte_check;
alter table public.radar_esecuzioni add constraint radar_esecuzioni_fonte_check
  check (fonte in ('ted', 'pvl', 'sintel', 'sardegnacat', 'sater'));

insert into public.radar_fonti_stato (fonte, attiva, nascosta_ai_clienti, blocco_fino_a)
values ('sater', false, true, '2099-01-01T00:00:00Z')
on conflict (fonte) do nothing;

-- controllo: nessun altro vincolo CHECK di radar_esecuzioni nomina le fonti senza 'sater' (un vincolo con un nome diverso da quello atteso)
do $$
declare
  rimasti integer;
begin
  select count(*) into rimasti
    from pg_constraint
   where conrelid = 'public.radar_esecuzioni'::regclass
     and contype = 'c'
     and pg_get_constraintdef(oid) like '%sardegnacat%'
     and pg_get_constraintdef(oid) not like '%sater''%';
  if rimasti > 0 then
    raise exception '0134: % vincolo/i di radar_esecuzioni rifiutano ancora ''sater'': nulla applicato', rimasti;
  end if;
end
$$;

commit;

notify pgrst, 'reload schema';
