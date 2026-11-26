-- 0135 — Tender Intelligence, Fase 2: la fonte «tuttogare» (connettore TuttoGare PA, molte istanze, documento 60) nel registro dei giri e
-- nello stato delle fonti (26/11/2026).
--
-- PROGETTO, MAI APPLICATO. Numero PROPOSTO da B2 (da confermare nel registro del coordinamento; la 0132 resta riservata). Per ora SOLO per lo
-- STAGING, per il collaudo del connettore: l'applicazione è un'autorizzazione SEPARATA dell'utente; la produzione mai senza di lui. La applica
-- a mano l'utente (o il coordinamento con la sua approvazione), mai con la chiave di servizio.
--
-- Che cosa fa:
--   1) il vincolo dei valori di radar_esecuzioni.fonte (0128, ricreato dalla 0134) ammette in più 'tuttogare': si toglie e si ricrea con lo
--      stesso nome (radar_esecuzioni_fonte_check), con tutti i valori di prima più quello nuovo. Serve perché il codice (ramo
--      feature/connettore-tuttogare) registra anche i giri di TuttoGare (FONTI_REGISTRO); la console continua a mostrare solo TED, PVL,
--      Sintel, SardegnaCAT e SATER;
--   2) la riga di 'tuttogare' in radar_fonti_stato, come SATER nella 0134: SPENTA (attiva = false), NASCOSTA ai clienti
--      (nascosta_ai_clienti = true) e con il SEMAFORO CHIUSO (blocco_fino_a = 2099-01-01, il valore convenzionale del coordinamento: il giro
--      lo apre solo il lanciatore autorizzato). Se la riga c'è già non si tocca.
--   NON tocca il vincolo di radar_procedure.piattaforma_id della 0120 (decisione (b) del coordinamento del 26/11: per TuttoGare piattaforma_id
--   resta vuoto e l'identità «tuttogare:<host>:<codice>» sta nella chiave della gara, che rispetta già il suo vincolo).
--   Dopo la 0135 TuttoGare resta spenta: per un giro serve l'accensione (scripts/c8/accendi-regionale-staging.ts, con un'autorizzazione) e il
--   giro stesso (scripts/radar-importa-regionale.ts tuttogare, con un'autorizzazione).
--   In PRODUZIONE (solo con un'autorizzazione separata dell'utente, dopo il collaudo): il semaforo 2099 fermerebbe ogni giro («occupata»),
--   come per SATER; si libera con la stessa correzione autorizzata di una riga, subito prima dell'accensione.
--
-- Regole rispettate:
--   - ADDITIVA e NON distruttiva: nessuna riga esistente toccata (il vincolo nuovo ammette tutti i valori di prima, quindi tutte le righe di
--     radar_esecuzioni lo rispettano); una sola riga nuova in radar_fonti_stato; nessuna tabella, colonna, indice, funzione, trigger o regola
--     nuova o tolta; permessi (GRANT) invariati; nessun dato di persone;
--   - IDEMPOTENTE: «drop constraint if exists» più «add constraint» con lo stesso nome, e «on conflict do nothing»; si può rieseguire.
--   - Il controllo finale ferma tutto (e annulla la transazione) se un ALTRO vincolo di radar_esecuzioni rifiutasse ancora 'tuttogare'.
--
-- ATTESE dopo l'applicazione (sola lettura):
--   select pg_get_constraintdef(oid) from pg_constraint where conrelid = 'public.radar_esecuzioni'::regclass and conname = 'radar_esecuzioni_fonte_check';
--     → CHECK ((fonte = ANY (ARRAY['ted'::text, 'pvl'::text, 'sintel'::text, 'sardegnacat'::text, 'sater'::text, 'tuttogare'::text])))
--   select fonte, attiva, nascosta_ai_clienti, blocco_fino_a from public.radar_fonti_stato where fonte = 'tuttogare';
--     → tuttogare | false | true | 2099-01-01 00:00:00+00
--
-- RITIRO (solo se serve, e solo PRIMA di qualunque giro di TuttoGare): togliere la riga di 'tuttogare' da radar_fonti_stato e rimettere il
-- vincolo della 0134 senza 'tuttogare' (che riesce solo se in radar_esecuzioni non ci sono righe di 'tuttogare'). Non fa parte di questa
-- migrazione.

begin;

alter table public.radar_esecuzioni drop constraint if exists radar_esecuzioni_fonte_check;
alter table public.radar_esecuzioni add constraint radar_esecuzioni_fonte_check
  check (fonte in ('ted', 'pvl', 'sintel', 'sardegnacat', 'sater', 'tuttogare'));

insert into public.radar_fonti_stato (fonte, attiva, nascosta_ai_clienti, blocco_fino_a)
values ('tuttogare', false, true, '2099-01-01T00:00:00Z')
on conflict (fonte) do nothing;

-- controllo: nessun altro vincolo CHECK di radar_esecuzioni nomina le fonti senza 'tuttogare' (un vincolo con un nome diverso da quello atteso)
do $$
declare
  rimasti integer;
begin
  select count(*) into rimasti
    from pg_constraint
   where conrelid = 'public.radar_esecuzioni'::regclass
     and contype = 'c'
     and pg_get_constraintdef(oid) like '%sardegnacat%'
     and pg_get_constraintdef(oid) not like '%tuttogare%';
  if rimasti > 0 then
    raise exception '0135: % vincolo/i di radar_esecuzioni rifiutano ancora ''tuttogare'': nulla applicato', rimasti;
  end if;
end
$$;

commit;

notify pgrst, 'reload schema';
