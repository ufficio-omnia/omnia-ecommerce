-- Tipo di acquirente (azienda/libero professionista vs privato
-- consumatore): determina quale dato fiscale viene richiesto al
-- checkout (partita IVA vs codice fiscale, già presente sulla tabella
-- fin dalla Fase 1) e quali caselle di accettazione mostrare.
--
-- Il default 'azienda' resta attivo (non viene rimosso dopo il
-- backfill): esiste almeno un altro punto del codice che scrive su
-- companies senza specificare buyer_type (il salvataggio del profilo
-- azienda di OMNIA AI, src/app/actions/company-profile.ts). Senza
-- default quell'inserimento fallirebbe al primo utente che lo usa
-- senza aver mai acquistato nulla dall'e-commerce — un rischio reale,
-- non teorico, verificato leggendo il codice.

alter table public.companies
  add column buyer_type text not null default 'azienda'
    check (buyer_type in ('azienda', 'consumatore'));
