-- Quando e da chi un ordine è stato segnato come pagato.
--
-- Fino a oggi orders ha solo created_at: per un ordine con bonifico, la data in
-- cui l'admin ha confermato l'accredito non è registrata da nessuna parte. La
-- console ne ha bisogno per i ricavi per periodo (un bonifico di fine mese
-- confermato a inizio mese successivo va nel mese giusto) e per sapere chi ha
-- confermato.
--
--  - paid_at: istante della conferma. Per la carta coincide con la creazione
--    dell'ordine (il webhook lo crea già pagato), quindi si riempie dal backfill.
--  - paid_by: l'admin che ha confermato il bonifico. Resta null per la carta e
--    per i bonifici confermati prima di questa migrazione. È un uuid SENZA
--    chiave esterna verso public.users, di proposito: una seconda chiave verso
--    users (oltre a user_id) rende ambigua per PostgREST ogni query che incrocia
--    orders e users ("Could not embed because more than one relationship was
--    found", errore PGRST201) e rompeva il vecchio pannello admin. La versione
--    iniziale di questa migrazione la creava e fu corretta da 0076, che la
--    toglie dove già applicata.
--
-- I bonifici già confermati prima di questa migrazione restano con paid_at nullo:
-- la data reale non esiste e non viene inventata. La console li tratta come
-- "data di pagamento non nota" e per i ricavi usa la data dell'ordine,
-- dichiarando quanti ordini sono in questa condizione.
--
-- Idempotente: colonne con IF NOT EXISTS, backfill solo dove paid_at è nullo.
-- Il codice funziona anche prima di questa migrazione (conferma l'ordine senza
-- registrare data e autore, e la console avvisa che mancano le colonne).

alter table public.orders
  add column if not exists paid_at timestamptz,
  add column if not exists paid_by uuid;

update public.orders
set paid_at = created_at
where status = 'pagato'
  and payment_method = 'carta'
  and paid_at is null;
