# BOZZA — Testo del banner cookie di omnia-ai.it (da sottoporre a revisione)

> **BOZZA da sottoporre a revisione dell'avvocato. NON è in vigore e NON è collegata al codice.**
> Preparata il 05/11/2026 insieme al Google tag con Consent Mode v2 avanzato (ramo `feature/google-tag-consent-mode-advanced`).
> Il banner pubblicato oggi dice cose che, con quel rilascio, non sarebbero più esatte (vedi sotto).

## Perché serve cambiarlo

Testo in vigore (versione registrata `banner-2026-09`):

> Usiamo un cookie tecnico-pubblicitario solo se acconsenti, per capire quali annunci portano contatti utili. Nessun dato viene venduto a terzi.

Con il Consent Mode avanzato:

1. il tag di Google **si carica anche prima della scelta** (condizione per essere rilevato da Google Ads);
2. **prima della scelta** (e dopo un «Rifiuta») Google riceve comunque un segnale tecnico **senza cookie**: orario, pagina visitata (indirizzo completo e titolo), lingua e tipo di dispositivo/browser, un numero casuale diverso a ogni pagina, lo stato del consenso (verificato nel browser il 05/11/2026, vedi `GUIDA-GOOGLE-TAG-CONSENT-MODE.md`, sezione 4);
3. con «Accetta» si usano anche Google Analytics (cookie `_ga`, `_ga_…`) e Google Ads (cookie `_gcl_au`, `_gcl_aw` se l'utente arriva da un annuncio): il testo attuale parla di «un cookie».

La frase «solo se acconsenti» sarebbe quindi **inesatta** per il punto 2.

## Proposta di testo (versione breve, per il banner)

> **Usiamo Google Analytics e Google Ads per capire quali annunci portano contatti utili.**
> Se acconsenti, salviamo cookie di misurazione e pubblicitari. Se rifiuti, non salviamo cookie, ma i servizi di Google ricevono comunque un segnale tecnico anonimo (pagina visitata, lingua e tipo di dispositivo). Non usiamo i tuoi dati per annunci personalizzati e non li vendiamo a terzi. Puoi cambiare idea in ogni momento da «Preferenze cookie». Dettagli nella Cookie policy.
>
> [Rifiuta] [Accetta]

Note per la revisione:
- «segnale tecnico anonimo»: **da verificare con l'avvocato** se «anonimo» è esatto (Google riceve necessariamente l'indirizzo IP di chi apre la pagina; per i prodotti pubblicitari dichiara di troncarlo alla raccolta; per Analytics il comportamento non è precisato nelle pagine di Google che ho letto);
- «annunci personalizzati»: vero **solo se** si lascia `ad_personalization` su «denied» dopo «Accetta» (è l'impostazione del ramo: `PERSONALIZZAZIONE_DOPO_ACCETTA = "denied"` in `src/lib/google-tag.ts`). Se si volesse attivare il remarketing, la frase va cambiata e serve il consenso a quello scopo;
- il link «Cookie policy» deve portare alla **v2** (vedi `cookie-policy-omnia-ai-v2-BOZZA.md`).

## Come si applica, dopo l'approvazione (lavoro di sviluppo, già descritto)

1. `src/components/omnia-ai/cookie-consent.tsx`: nuovo testo (solo il paragrafo; il resto del banner non cambia).
2. `src/lib/demo-consensi-calcoli.ts`: `TESTO_BANNER_COOKIE` = **lo stesso identico testo** e `VERSIONE_BANNER_COOKIE` nuova (per esempio `banner-2026-11`). Un test controlla che il testo registrato nei consensi delle richieste sia quello che il banner mostra. I consensi già registrati restano con la versione `banner-2026-09`.
3. Test del banner e della guida aggiornati. Poi build, test e il tuo «MANDA ONLINE».
