-- Registro delle email automatiche (0087): allegati e nuovi tipi per la revisione umana.
--
-- L'email all'ufficio per una revisione umana pagata porta in allegato il file Word della relazione
-- tecnica. Il registro non conserva il file (pesa e contiene dati del cliente): conserva SOLO dove sta
-- nello storage (contenitore, percorso, nome), così se l'invio fallisce il controllo periodico lo
-- rilegge e rimanda l'email con l'allegato. A invio riuscito i tre campi si svuotano, come l'indirizzo e
-- il testo.
--
-- Nuovi tipi: «revisione_umana_richiesta» (all'ufficio) e «revisione_umana_ricevuta» (conferma al
-- cliente). Idempotente: si può rieseguire.

alter table public.omnia_ai_email_eventi
  add column if not exists allegato_bucket text,
  add column if not exists allegato_path text,
  add column if not exists allegato_nome text;

alter table public.omnia_ai_email_eventi drop constraint if exists omnia_ai_email_eventi_tipo_check;
alter table public.omnia_ai_email_eventi
  add constraint omnia_ai_email_eventi_tipo_check check (
    tipo in (
      'nuovo_cliente',
      'cambio_piano',
      'acquisto_crediti',
      'disdetta',
      'mancato_pagamento',
      'pagamento_ricevuto',
      'disdetta_confermata',
      'metodo_pagamento_cambiato',
      'revisione_umana_richiesta',
      'revisione_umana_ricevuta'
    )
  );
