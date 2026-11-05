# BOZZA — Cookie policy di omnia-ai.it, versione 2 (da sottoporre a revisione)

> **BOZZA da sottoporre a revisione dell'avvocato. NON è in vigore e NON è collegata al codice.**
> Preparata il 05/11/2026 per il Google tag con Consent Mode v2 avanzato. La v1 pubblicata (in vigore dall'11 settembre 2026) **non si modifica**:
> la revisione sarà una v2 con la propria voce in `legal_documents`, come prevede la regola del progetto.
> I punti tra [parentesi quadre] sono da completare o da verificare. Le durate dei cookie sono quelle indicate da Google: **da riverificare** prima della pubblicazione.

## Cosa cambia rispetto alla v1 (e perché)

| v1 pubblicata | Problema con il Consent Mode avanzato |
|---|---|
| «Il tag pubblicitario non viene caricato finché non premi "Accetta". Se scegli "Rifiuta", o se ignori il banner, nessun dato viene inviato a Google.» | **Diventa falsa**: il tag si carica subito e Google riceve segnali senza cookie anche prima della scelta e dopo un rifiuto. |
| Nella tabella dei cookie pubblicitari compare solo «Google Ads». | Era già incompleta: dopo «Accetta» si carica anche Google Analytics (cookie `_ga`, `_ga_…`). |
| Nessuna descrizione di cosa parte prima della scelta. | Serve una sezione dedicata. |

## Testo proposto

# Cookie policy

**Versione 2 — in vigore dal [data]**

I cookie sono piccoli file che i siti salvano sul tuo dispositivo. Alcuni servono a far funzionare il servizio, altri a misurare l'efficacia della pubblicità. Insieme ai cookie utilizziamo tecnologie analoghe, come l'archiviazione locale del browser: valgono le stesse regole.

## Cookie tecnici, sempre attivi

*(invariata rispetto alla v1: sessione di autenticazione, preferenza cookie, cookie di pagamento Stripe)*

## Misurazione e pubblicità (Google Analytics e Google Ads), solo con il tuo consenso

Usiamo **Google Analytics** e **Google Ads** (Google [titolare/responsabile: da indicare]) per capire quali annunci portano contatti utili a OMNIA AI. **Se acconsenti** (pulsante «Accetta») salviamo questi cookie:

| Cookie | Origine | Finalità | Durata |
|---|---|---|---|
| `_ga`, `_ga_[ID]` | Google Analytics | Distinguere le visite e misurare l'uso del sito | [fino a 2 anni — verificare] |
| `_gcl_au`, `_gcl_aw` | Google Ads | Attribuire un contatto alla campagna di provenienza (`_gcl_aw` solo se arrivi da un annuncio) | [fino a 90 giorni — verificare] |

Non usiamo questi dati per mostrarti annunci personalizzati (remarketing) e non li vendiamo a terzi. *[Da confermare: coerente con `PERSONALIZZAZIONE_DOPO_ACCETTA = "denied"`.]*

## Cosa succede prima che tu scelga, e se rifiuti

Il servizio di Google si carica quando apri una pagina, ma **con tutti i consensi negati**: non salva cookie e non ci permette di riconoscerti. Anche in questo caso Google riceve un **segnale tecnico senza cookie** a ogni pagina visitata, che contiene:

- l'orario e l'indirizzo della pagina visitata (completo, con eventuali parametri di una campagna) e il suo titolo;
- la lingua, il tipo di dispositivo e di browser e la risoluzione dello schermo;
- un numero casuale, diverso a ogni pagina, che non ti identifica tra una visita e l'altra;
- lo stato del tuo consenso (negato).

*[Da verificare con l'avvocato: formulazione relativa all'indirizzo IP, che Google riceve necessariamente come ogni sito web; trasferimento verso paesi extra UE; base giuridica di questo segnale tecnico.]*

Se scegli **«Rifiuta»**, o ignori il banner, la situazione resta questa: nessun cookie di Google e solo il segnale tecnico descritto sopra.

## Come cambiare idea

Puoi modificare o revocare la scelta in qualsiasi momento dal collegamento «Preferenze cookie» nel piè di pagina. Quando revochi, **togliamo dal tuo browser i cookie di Google già salvati** e il consenso torna negato da subito. La revoca non pregiudica la liceità del trattamento già effettuato.

*[Titolare del trattamento e contatti: come nella v1 / informativa privacy.]*

---

## Altre cose da allineare quando si pubblica la v2 (non sono testo della cookie policy)

1. **Informativa privacy di omnia-ai.it (v1)**: oggi **non nomina Google, Google Analytics né Google Ads**. L'informativa privacy v2 (già in attesa dell'avvocato) dovrebbe descrivere questi trattamenti e i trasferimenti.
2. **Banner**: nuovo testo e nuova versione registrata (vedi `banner-cookie-omnia-ai-BOZZA.md`).
3. **Procedura tecnica** (come per la v1): file `legal/cookie-policy-omnia-ai-v2.md`, componente `CookiePolicyV2`, voce `omnia_ai_cookie_policy` versione 2 in `legal_documents` con la data di entrata in vigore, test legali aggiornati. Da fare solo dopo l'approvazione del testo.
4. **Sito e-commerce e sito statico omniaitalia.com**: non toccati. Caricano i tag Google solo dopo «Accetta» (modalità «base») e hanno la loro cookie policy.
