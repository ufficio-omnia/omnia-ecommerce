# Ufficio Gare — guida per l'ufficio

L'**Ufficio Gare** è un utente secondario che ogni cliente OMNIA AI può creare per la sua azienda. Lavora sulle gare (carica documenti, fa analizzare, usa la chat, genera la relazione tecnica) ma **non vede l'amministrazione**: abbonamento, pagamenti, fatture, profilo azienda, documenti aziendali e contrattuali, impostazioni.

Questo documento spiega come funziona, che cosa serve per metterlo online e come dirlo ai clienti.

---

## Come lo usa il cliente

1. Il cliente (il **titolare**) apre **Ufficio Gare** dal menu a sinistra, scrive l'email della persona, spunta la conferma di responsabilità e preme «Crea l'accesso Ufficio Gare».
2. La persona riceve un'email con il link per **scegliere la sua password**. Se non arriva, il titolare preme «Rinvia il link» (al massimo una volta al minuto, e solo finché la persona non è mai entrata).
3. Il titolare può **sospendere** l'accesso (la persona non vede più nulla e non può entrare) e **riattivarlo**, oppure **rimuoverlo**: l'utente viene eliminato, mentre gare, documenti e relazioni restano all'azienda.
4. Un titolare può avere **un solo** Ufficio Gare.

## Che cosa vede e che cosa fa l'Ufficio Gare

| Può | Non può |
|---|---|
| Dashboard e tutte le gare dell'azienda | Abbonamento, piani, acquisto di crediti |
| Creare gare, caricare documenti, farle analizzare | Pagamenti e fatture |
| Chat con OMNIA AI e relazione tecnica | Profilo azienda e documenti aziendali |
| Scaricare i documenti prodotti | Documenti contrattuali e impostazioni dell'account |
| Scrivere al supporto | Pagare la revisione umana |

- **Gare e crediti** sono quelli del titolare: l'Ufficio Gare li consuma, non li compra.
- **Profilo azienda:** l'Ufficio Gare non lo vede né lo modifica, ma OMNIA AI lo usa (come sempre) per scrivere l'offerta. Vede solo il nome dell'azienda in un angolo della barra laterale.
- **Dati di fatturazione mancanti:** se mancano codice destinatario e PEC il download dei documenti resta chiuso, come per il titolare; all'Ufficio Gare il messaggio dice di ricordarlo all'amministratore.

## Quando le gare finiscono

- L'Ufficio Gare vede in alto: *«Le gare a disposizione sono finite. Ricorda al tuo amministratore di acquistare un upgrade del piano o dei crediti singoli per svolgere altre gare: le gare già avviate restano consultabili.»* Niente link, niente prezzi.
- Al **titolare** parte un'**email automatica** («Le gare di OMNIA AI sono finite: il tuo Ufficio Gare è fermo») con il pulsante per andare all'abbonamento. **Al massimo una al giorno**: il limite lo garantisce il database, anche con più pagine aperte insieme. Se l'invio fallisce, il giorno non viene «consumato» e al tentativo successivo riparte.
- Stessa cosa, con un testo diverso, quando l'**abbonamento non è attivo**.
- **Revisione umana:** l'Ufficio Gare vede il pulsante «Richiedi revisione umana» (senza prezzo). Il clic **non compra nulla**: manda un'email al titolare (una al giorno per gara) con il link alla richiesta, che il titolare paga dalla sua area come sempre.

## Console (console.omniaitalia.com)

- **Utenti:** gli Uffici Gare compaiono con il badge «Ufficio Gare di <azienda>» (con «sospeso» se serve) e hanno un filtro e una tessera a parte; il titolare ha il badge «ha un Ufficio Gare». Non contano come clienti senza attività.
- **Scheda cliente:** un pannello «Ufficio Gare» (per il titolare: email, stato, ultimo accesso; per l'Ufficio Gare: di chi è, se è sospeso) con i collegamenti reciproci.
- **Cose che la console rifiuta su un Ufficio Gare:** abbonamento a mano e gare gratuite («si fanno sul titolare»).
- **Eliminare o anonimizzare un titolare** elimina anche il suo Ufficio Gare (solo dopo il titolare; se non riesce te lo dice con l'identificativo). Eliminare un Ufficio Gare da solo non tocca il titolare.

## Messa online — cosa serve

- **Migrazione `0092`**: già eseguita il 15/10/2026 e verificata. Non ce ne sono altre.
- **Nessuna variabile nuova su Vercel**, nessuna modifica su Stripe, Supabase o Cloudflare.
- Le email partono da `noreply@omniaitalia.com` come tutte le altre (servizio già attivo).
- Dopo il deploy: crea un Ufficio Gare con una tua casella e controlla l'email e il primo accesso (vedi sotto).

### Prova di 5 minuti dopo il deploy

1. Da omnia-ai.it entra come titolare → **Ufficio Gare** → crea l'accesso con una tua casella.
2. Apri l'email, scegli la password dal link: devi arrivare alla dashboard con il menu **Dashboard / Gare**.
3. Prova a scrivere a mano `…/dashboard/omnia-ai/abbonamento`: devi tornare alla dashboard.
4. Dal titolare **sospendi**: l'Ufficio Gare, ricaricando la pagina, vede «Accesso sospeso». **Riattiva**.
5. Fine prova: **Rimuovi** (o elimina l'utente dalla console).

## Da fare con l'avvocato (non è codice)

Aggiungere alle **Condizioni di abbonamento** una frase equivalente a questa (bozza):

> *Il Cliente può autorizzare un utente secondario («Ufficio Gare») ad accedere alle gare, ai documenti e alle relazioni del proprio account. Il Cliente è responsabile dell'operato dell'utente autorizzato, delle credenziali a lui consegnate e dell'autorizzazione al trattamento dei dati personali eventualmente presenti nei documenti caricati; può sospendere o revocare l'accesso in ogni momento dall'area riservata.*

Oggi il titolare, quando crea l'accesso, spunta (e il sistema registra con data, ora, IP e browser) la conferma: *«Confermo che questa persona è autorizzata a trattare, sotto la mia responsabilità, i dati della mia azienda in OMNIA AI (gare, documenti e relazioni).»* Modificare le Condizioni significa pubblicare una nuova versione (e far riaccettare), quindi non l'ho toccato.

## Limiti attuali (decisioni di prodotto)

- Un solo Ufficio Gare per cliente (il modello è già pronto per più ruoli, ma non è esposto).
- L'Ufficio Gare **non ha la campanella** delle notifiche (sono del titolare).
- Un Ufficio Gare non può essere anche titolare di un altro account (il database lo impedisce).
- Se il titolare cambia l'email del suo account, nulla cambia per l'Ufficio Gare.
