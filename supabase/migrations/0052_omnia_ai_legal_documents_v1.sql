-- Versione 1 dei tre documenti legali di omnia-ai.it, revisionati da un
-- legale. Stesso pattern della Fase 2A (vedi 0032_legal_documents.sql):
-- file immutabile in legal/, impronta SHA-256 calcolata sul contenuto
-- esatto del file, riga in legal_documents. Richiede che
-- 0051_omnia_ai_legal_documents.sql sia già stata eseguita (amplia il
-- vincolo su document_type con i tre tipi omnia_ai_*).
--
-- sha256 calcolato con:
--   node -e "console.log(require('crypto').createHash('sha256').update(require('fs').readFileSync('<file>')).digest('hex'))"
-- sul contenuto esatto dei tre file, verificato riga per riga (diff)
-- contro il testo fornito da Ufficio Omnia prima di scrivere questa
-- migrazione.

insert into public.legal_documents (document_type, version, effective_date, file_path, sha256)
values
  ('omnia_ai_privacy_policy', 1, '2026-09-11', 'legal/privacy-policy-omnia-ai-v1.md', 'be472cf0a581989a633f582f803c7c8b85fba177b18eca7b3931647de7720a7d'),
  ('omnia_ai_cookie_policy', 1, '2026-09-11', 'legal/cookie-policy-omnia-ai-v1.md', '0bddb21e3368a06f9ec779b1afae737a0bc3437a82246b12fd03bfea16908f9c'),
  ('omnia_ai_condizioni_abbonamento', 1, '2026-09-11', 'legal/condizioni-abbonamento-v1.md', '1dd48cb1d7325f8527a59282e7911b07dbb08d44f701f4735756b966fc0b6ede');
