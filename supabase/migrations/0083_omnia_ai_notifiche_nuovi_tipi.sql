-- Nuovi tipi di notifica per l'area riservata di OMNIA AI.
--
-- Il campanello delle notifiche accetta solo i tipi elencati nel vincolo CHECK di
-- omnia_ai_notifiche (0063): un tipo nuovo viene rifiutato dal database. Si aggiungono:
--   fattura_disponibile    la fattura di un pagamento è stata caricata dalla console
--   gare_gratuite_esaurite le gare gratuite assegnate dalla console sono finite
--   pilot_in_scadenza      mancano 15 giorni alla fine del prezzo pilot
-- (gli ultimi due servono ai blocchi successivi: si aggiungono ora per non toccare il
-- vincolo una seconda volta).
--
-- Si ricrea il vincolo con l'elenco completo, i tipi esistenti compresi: nessuna riga
-- esistente cambia né viene cancellata (il DROP riguarda solo il vincolo CHECK, l'unico
-- modo in Postgres di ampliare un CHECK). Idempotente.
--
-- Può essere eseguita prima o dopo il deploy: finché non c'è, la notifica «fattura
-- disponibile» non si crea (l'errore va nel log, il caricamento della fattura e l'email
-- al cliente funzionano comunque).

alter table public.omnia_ai_notifiche
  drop constraint if exists omnia_ai_notifiche_tipo_check;

alter table public.omnia_ai_notifiche
  add constraint omnia_ai_notifiche_tipo_check check (
    tipo in (
      'analisi_conclusa',
      'relazione_generata',
      'gara_scadenza_7gg',
      'gara_scadenza_2gg',
      'gare_piano_esaurite',
      'rinnovo_3gg',
      'pagamento_fallito',
      'fattura_disponibile',
      'gare_gratuite_esaurite',
      'pilot_in_scadenza'
    )
  );
