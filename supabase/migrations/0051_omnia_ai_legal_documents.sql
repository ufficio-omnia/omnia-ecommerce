-- Amplia il vincolo su legal_documents.document_type per includere i tre
-- documenti legali di omnia-ai.it (privacy policy, cookie policy,
-- condizioni di abbonamento). La tabella non ha una colonna di
-- zona/prodotto — document_type resta l'unico discriminatore — quindi i
-- tre nuovi tipi usano il prefisso "omnia_ai_" per restare distinti da
-- privacy_policy/cookie_policy/condizioni_vendita dell'e-commerce: senza
-- questa distinzione le query "versione corrente per tipo" già esistenti
-- (src/lib/legal-acceptance.ts, checkout) e quelle che scriveremo per
-- l'area riservata AI rischierebbero di leggere la versione sbagliata,
-- non avendo modo di filtrare per prodotto.
--
-- Solo il vincolo, qui: le righe di versione 1 (file_path/sha256) arrivano
-- in una migrazione successiva, quando i testi reali di Ufficio Omnia
-- saranno pronti.
--
-- Contiene un DROP, ma solo del vincolo CHECK (non di dati o tabelle): è
-- l'unico modo in Postgres per ampliare un CHECK esistente. Idempotente:
-- rieseguirla droppa e ricrea lo stesso vincolo, senza errore.

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
      'omnia_ai_condizioni_abbonamento'
    )
  );
