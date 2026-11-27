-- Attivazione della Privacy policy v3 e delle Condizioni di abbonamento v3 di OMNIA AI (newsletter Tender Weekly).
--
-- DA ESEGUIRE A MANO, SOLO DOPO il deploy del codice che contiene i file (altrimenti le pagine non li trovano).
-- Decisione dell'utente del 27/11/2026: attivazione SUBITO, senza attendere la revisione dell'avvocato.
-- (In origine: dopo la revisione dei testi da parte dell'avvocato)
-- (legal/privacy-policy-omnia-ai-v3.md, legal/condizioni-abbonamento-v3.md). Non è una migrazione: è una decisione legale.
--
-- Effetti: dal giorno dell'esecuzione (data di Roma) le pagine /privacy e le Condizioni mostrano la v3; i nuovi abbonamenti accettano la v3
-- e i loro titolari diventano destinatari di Tender Weekly («contratto_abbonamento», con la prova dell'accettazione).
-- I clienti già abbonati restano sulla v2 fino a una nuova accettazione: per loro serve un'altra base documentata.
-- Le condizioni (art. 18) prevedono un preavviso di trenta giorni via email per le modifiche: valutare con l'avvocato.
--
-- sha256 calcolato sul testo con a capo LF (come le versioni precedenti).
insert into public.legal_documents (document_type, version, effective_date, file_path, sha256)
values
  ('omnia_ai_privacy_policy', 3, (now() at time zone 'Europe/Rome')::date, 'legal/privacy-policy-omnia-ai-v3.md', '58307aac142749110addff5a3ff59359a541e9164c2f15faf77034e56550fff3'),
  ('omnia_ai_condizioni_abbonamento', 3, (now() at time zone 'Europe/Rome')::date, 'legal/condizioni-abbonamento-v3.md', 'a79d09a9afa2ca863de9824fcb072c448530484529e167243a4916e8848616c5')
on conflict (document_type, version) do nothing;
