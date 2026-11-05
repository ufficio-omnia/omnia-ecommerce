-- Cookie policy e Privacy policy di omnia-ai.it, VERSIONE 2 (Google tag con Consent Mode v2 avanzato, Google Analytics 4 e Google Ads).
--
-- Stesso pattern della 0052 e della 0080: file immutabili in legal/, impronta SHA-256 calcolata sul contenuto esatto (fine riga LF,
-- newline finale), riga in legal_documents. Le v1 NON si toccano: restano consultabili alle loro pagine versionate
-- (/documenti-legali/cookie-policy/1 e /documenti-legali/privacy-policy/1).
--
--   legal/cookie-policy-omnia-ai-v2.md    cookie policy v2: cosa parte verso Google prima della scelta, dopo un rifiuto, dopo «Accetta»;
--                                         cookie di Google Analytics e Google Ads; revoca; personalizzazione pubblicitaria disattivata
--   legal/privacy-policy-omnia-ai-v2.md   informativa v2: aggiunge richiesta di demo, Google Analytics 4 e Google Ads (finalità, basi
--                                         giuridiche, destinatari, trasferimenti, conservazione, gestione del consenso)
--
-- sha256 calcolato con:
--   node -e "console.log(require('crypto').createHash('sha256').update(require('fs').readFileSync('<file>','utf8').replace(/\r\n/g,'\n')).digest('hex'))"
--
-- ORDINE DI ESECUZIONE — IMPORTANTE. La «versione vigente» di un documento è la riga con effective_date più recente non successiva a oggi.
-- Eseguire questa migrazione SUBITO DOPO il deploy del codice che sa mostrare la v2 e che mette in produzione il Google tag e il nuovo testo
-- del banner (stesso rilascio): il banner nuovo rimanda alla cookie policy, e fino all'esecuzione le pagine /cookie-policy e /privacy
-- mostrano ancora la v1, che dice che nessun dato parte verso Google prima del consenso (non più vero). Il deploy e l'esecuzione vanno fatti
-- a distanza di minuti, non di giorni. Con questo ordine il passaggio è coerente: la pagina sa mostrare la v2 e il database la indica.
-- I testi sono stati approvati dal titolare il 05/11/2026: i tre punti che erano tra parentesi quadre (base giuridica del segnale tecnico verso
-- Google Ads, periodo di conservazione di Analytics, garanzie di Google per i trasferimenti) sono stati tolti dai testi per sua decisione.
-- Una volta eseguita questa migrazione i due file sono immutabili: se un file cambia PRIMA, l'impronta qui sotto va ricalcolata (un test la
-- confronta); DOPO, serve una versione 3.
--
-- effective_date = giorno (a Roma) in cui la migrazione viene eseguita: è la data di entrata in vigore delle due v2 e compare nei documenti.
-- Per fissare un'altra data, sostituire l'espressione sotto con una data letterale (es. date '2026-11-10') prima di eseguire.
--
-- Il tipo di documento è già ammesso dal vincolo CHECK (migrazione 0080): nessun DROP. Idempotente: le righe si inseriscono una volta
-- sola. Non tocca dati né altre tabelle.

insert into public.legal_documents (document_type, version, effective_date, file_path, sha256)
values
  ('omnia_ai_cookie_policy', 2, (now() at time zone 'Europe/Rome')::date, 'legal/cookie-policy-omnia-ai-v2.md', 'aa99229713853a6e3574e3fae2ffd2c8613aa0e1c51867c352e24b1b9620bbc7'),
  ('omnia_ai_privacy_policy', 2, (now() at time zone 'Europe/Rome')::date, 'legal/privacy-policy-omnia-ai-v2.md', 'df6a1b389dfe0a61b094a1178337201886f2dc802e7d97a12f2c3db16e8a1c51')
on conflict (document_type, version) do nothing;
