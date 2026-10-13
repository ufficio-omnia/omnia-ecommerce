-- Condizioni di abbonamento OMNIA AI versione 2 e Allegato A (atto di nomina a
-- responsabile del trattamento, art. 28 GDPR), nuovo documento legale versionato.
--
-- Stesso pattern della 0052: file immutabili in legal/, impronta SHA-256 calcolata
-- sul contenuto esatto (fine riga LF, newline finale), riga in legal_documents.
-- I testi sono quelli forniti da Ufficio Omnia, riportati senza modifiche
-- (verificato riga per riga contro il documento sorgente prima di scrivere la
-- migrazione); le condizioni v2 sono la v1 con il nuovo art. 10 (Riservatezza,
-- base di conoscenza, accesso e trattamento dei dati) e la rinumerazione dei
-- successivi: le clausole oggetto di approvazione specifica diventano 5, 8, 10,
-- 12 e 15 (erano 5, 8, 11 e 14).
--
-- sha256 calcolato con:
--   node -e "console.log(require('crypto').createHash('sha256').update(require('fs').readFileSync('<file>','utf8').replace(/\r\n/g,'\n')).digest('hex'))"
--
-- ORDINE DI ESECUZIONE — IMPORTANTE. Il database è condiviso con la produzione e
-- la «versione vigente» di un documento è la riga con effective_date più recente
-- non successiva a oggi. Eseguire questa migrazione DOPO il deploy del codice che
-- sa mostrare la v2 e l'Allegato A: se la v2 diventasse vigente mentre il sito è
-- ancora quello vecchio, il checkout registrerebbe la v2 e rimanderebbe a una
-- pagina che non esiste. Con questo ordine il passaggio è immediato e coerente.
--
-- effective_date = giorno (a Roma) in cui la migrazione viene eseguita: è la data
-- di entrata in vigore della v2 e dell'Allegato A, e compare nei documenti al
-- posto di «[DATA]». Per fissare un'altra data, sostituire l'espressione sotto
-- con una data letterale (es. date '2026-11-03') prima di eseguire.
--
-- Chi è già abbonato resta sulle condizioni vigenti al momento del suo avvio
-- (art. 18): la v2 si applica ai nuovi abbonamenti e alle riattivazioni.
--
-- Contiene un DROP, ma solo del vincolo CHECK (non di dati o tabelle): è l'unico
-- modo in Postgres per ampliare un CHECK esistente. Idempotente: il vincolo si
-- ricrea uguale e le righe si inseriscono una volta sola.

alter table public.legal_documents
  drop constraint if exists legal_documents_document_type_check;

alter table public.legal_documents
  add constraint legal_documents_document_type_check check (
    document_type in (
      'privacy_policy',
      'cookie_policy',
      'condizioni_vendita',
      'omnia_ai_privacy_policy',
      'omnia_ai_cookie_policy',
      'omnia_ai_condizioni_abbonamento',
      'omnia_ai_allegato_a'
    )
  );

insert into public.legal_documents (document_type, version, effective_date, file_path, sha256)
values
  ('omnia_ai_allegato_a', 1, (now() at time zone 'Europe/Rome')::date, 'legal/allegato-a-nomina-responsabile-v1.md', '9712ce19ccb262f0fc495954a187e2e237837e7ca1bdf183257aa492a5050f18'),
  ('omnia_ai_condizioni_abbonamento', 2, (now() at time zone 'Europe/Rome')::date, 'legal/condizioni-abbonamento-v2.md', '64959e54b7c627fc660361b36a8529649dbce083c2fe7afad0da51fdfdb248d7')
on conflict (document_type, version) do nothing;
