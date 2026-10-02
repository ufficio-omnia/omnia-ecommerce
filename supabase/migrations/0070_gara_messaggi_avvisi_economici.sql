-- Riferimenti all'offerta economica (R8) rimasti nel documento generato in
-- questo messaggio: formule come "senza oneri aggiuntivi" che il controllo
-- deterministico (src/lib/riferimenti-economici.ts) ha trovato e che non si è
-- riusciti a togliere con la riformulazione automatica. La scheda della gara
-- li mostra in rosso accanto al pulsante di scaricamento, con il punto
-- esatto: in un'offerta tecnica sono causa di esclusione, il cliente non deve
-- mai scaricare il documento senza saperlo.
--
-- Array JSON di { sezione, sottoCriterio, formula, estratto }. Nullable: un
-- messaggio senza file, o con un documento pulito, non ha avvisi.
--
-- Idempotente: colonna aggiunta con IF NOT EXISTS. Il codice funziona anche
-- prima di questa migrazione (in quel caso l'avviso viaggia nel testo del
-- messaggio), ma va eseguita prima di pubblicare per avere il riquadro rosso.

alter table public.gara_messaggi
  add column if not exists avvisi_economici jsonb;
