-- Ora di scadenza inserita a mano dal cliente.
--
-- Quando i documenti di gara non riportano l'ora della scadenza (del bando, o della proroga) OMNIA AI non la presume né la
-- dedude: il cliente può scriverla lui. Questa colonna dice che l'ora salvata in public.gare.scadenza_ora l'ha inserita il cliente a
-- mano, così una nuova analisi dei documenti non la cancella finché la data della scadenza resta la stessa, e la scheda può
-- distinguerla da un'ora trovata nei documenti (quella non si cambia a mano):
--
--   scadenza_ora_manuale   vero se scadenza_ora l'ha scritta il cliente; falso (predefinito) se viene dai documenti o manca
--
-- Additiva e idempotente: si può rieseguire e non tocca nessun dato esistente (le gare che c'erano restano «ora dai documenti» o
-- «ora mancante», come prima). Prima di questa migrazione la scheda della gara e l'analisi dei documenti funzionano come sempre e
-- l'ora a mano non si può salvare (il codice lo dice al cliente invece di salvarla senza il segno «a mano»). Le regole di accesso
-- della tabella (gare_all_own) valgono anche per la colonna nuova.

alter table public.gare
  add column if not exists scadenza_ora_manuale boolean not null default false;

notify pgrst, 'reload schema';
