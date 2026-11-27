-- 0137 — Tender Intelligence, Fase 2: la fonte «start» (connettore START Toscana, elenco pubblico delle procedure aperte, documento 60) nel
-- registro dei giri e nello stato delle fonti (26/11/2026).
--
-- PROGETTO, MAI APPLICATO. Numero ASSEGNATO dal coordinamento il 26/11 (0134 SATER, 0135 TuttoGare, 0136 Uffici Gare già prese). Per ora SOLO
-- per lo STAGING, per il collaudo del connettore: l'applicazione è un'autorizzazione SEPARATA dell'utente; la produzione mai senza di lui. La
-- applica a mano l'utente, mai con la chiave di servizio.
--
-- Che cosa fa (stessa forma della 0135):
--   1) il vincolo dei valori di radar_esecuzioni.fonte (0128, ricreato dalla 0134 e dalla 0135) ammette in più 'start': si toglie e si ricrea
--      con lo stesso nome (radar_esecuzioni_fonte_check), con tutti i valori di prima più quello nuovo. Serve perché il codice (ramo
--      feature/connettore-start) registra anche i giri di START (FONTI_REGISTRO); la console continua a non mostrare START;
--   2) la riga di 'start' in radar_fonti_stato, come SATER e TuttoGare: SPENTA (attiva = false), NASCOSTA ai clienti
--      (nascosta_ai_clienti = true) e con il SEMAFORO CHIUSO (blocco_fino_a = 2099-01-01, il valore convenzionale del coordinamento: il giro
--      lo apre solo il lanciatore autorizzato). Se la riga c'è già non si tocca.
--   NON tocca il vincolo di radar_procedure.piattaforma_id della 0120 (decisione (b) del coordinamento del 26/11: per START piattaforma_id resta
--   vuoto e l'identità «start:NNNNNN-AAAA» sta nella chiave della gara, che rispetta già il suo vincolo). NON tocca il vincolo di
--   radar_procedure.stato: lo stato «sconosciuto» usato per l'uscita dalle aperte (decisione 1c) è già ammesso dalla 0109 e dalla 0112.
--   Dopo la 0137 START resta spenta: per un giro serve l'accensione (scripts/c8/accendi-regionale-staging.ts, con un'autorizzazione) e il giro
--   stesso (scripts/radar-importa-regionale.ts start, con un'autorizzazione), SOLO tra le 23:00 e le 04:00 UTC (robots.txt di START).
--   In PRODUZIONE (solo con un'autorizzazione separata dell'utente, dopo il collaudo): il semaforo 2099 fermerebbe ogni giro («occupata»),
--   come per SATER e TuttoGare; si libera con la stessa correzione autorizzata di una riga, subito prima dell'accensione.
--
-- Regole rispettate:
--   - ADDITIVA e NON distruttiva: nessuna riga esistente toccata (il vincolo nuovo ammette tutti i valori di prima, quindi tutte le righe di
--     radar_esecuzioni lo rispettano); una sola riga nuova in radar_fonti_stato; nessuna tabella, colonna, indice, funzione, trigger o regola
--     nuova o tolta; permessi (GRANT) invariati; nessun dato di persone;
--   - IDEMPOTENTE: «drop constraint if exists» più «add constraint» con lo stesso nome, e «on conflict do nothing»; si può rieseguire.
--   - Il controllo finale ferma tutto (e annulla la transazione) se un ALTRO vincolo di radar_esecuzioni rifiutasse ancora 'start'.
--   - Presuppone la 0135 (il vincolo di oggi ammette 'tuttogare'): applicata prima, sullo staging e in produzione.
--
-- ATTESE dopo l'applicazione (sola lettura):
--   select pg_get_constraintdef(oid) from pg_constraint where conrelid = 'public.radar_esecuzioni'::regclass and conname = 'radar_esecuzioni_fonte_check';
--     → CHECK ((fonte = ANY (ARRAY['ted'::text, 'pvl'::text, 'sintel'::text, 'sardegnacat'::text, 'sater'::text, 'tuttogare'::text, 'start'::text])))
--   select fonte, attiva, nascosta_ai_clienti, blocco_fino_a from public.radar_fonti_stato where fonte = 'start';
--     → start | false | true | 2099-01-01 00:00:00+00
--
-- RITIRO (solo se serve, e solo PRIMA di qualunque giro di START): togliere la riga di 'start' da radar_fonti_stato e rimettere il vincolo della
-- 0135 senza 'start' (che riesce solo se in radar_esecuzioni non ci sono righe di 'start'). Non fa parte di questa migrazione.

begin;

alter table public.radar_esecuzioni drop constraint if exists radar_esecuzioni_fonte_check;
alter table public.radar_esecuzioni add constraint radar_esecuzioni_fonte_check
  check (fonte in ('ted', 'pvl', 'sintel', 'sardegnacat', 'sater', 'tuttogare', 'start'));

insert into public.radar_fonti_stato (fonte, attiva, nascosta_ai_clienti, blocco_fino_a)
values ('start', false, true, '2099-01-01T00:00:00Z')
on conflict (fonte) do nothing;

-- controllo: nessun altro vincolo CHECK di radar_esecuzioni nomina le fonti senza 'start' (un vincolo con un nome diverso da quello atteso)
do $$
declare
  rimasti integer;
begin
  select count(*) into rimasti
    from pg_constraint
   where conrelid = 'public.radar_esecuzioni'::regclass
     and contype = 'c'
     and pg_get_constraintdef(oid) like '%sardegnacat%'
     and pg_get_constraintdef(oid) not like '%''start''%';
  if rimasti > 0 then
    raise exception '0137: % vincolo/i di radar_esecuzioni rifiutano ancora ''start'': nulla applicato', rimasti;
  end if;
end
$$;

commit;

notify pgrst, 'reload schema';
