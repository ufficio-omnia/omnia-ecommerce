# Messa in vendita di OMNIA AI con Stripe reale — guida passo passo

Documento per l'ufficio. Ogni passo dice **dove cliccare** e **come capire che è andato bene**.
L'ordine conta: il pulsante «Abbonati» si accende **per ultimo**, dopo che tutti i controlli sono verdi.

Finché non fai il passo 7 nessun cliente può abbonarsi dal sito: puoi procedere con calma.

---

## Prima di cominciare: cosa serve

- Accesso a **Stripe** con l'account reale (lo stesso dell'e-commerce, OMNIA CONSULTING SRLS), in modalità **live**
  (in alto a destra, l'interruttore «Modalità di test» deve essere SPENTO).
- Accesso a **Vercel** (progetto `omnia-ecommerce`).
- Accesso alla **console** (console.omniaitalia.com).

> Le chiavi segrete di Stripe (`sk_live_…`, `whsec_…`) si incollano **solo su Vercel**, mai in chat, mai in email.

---

## Passo 1 — Webhook: ogni evento deve arrivare a UNA sola destinazione

Stripe (live) → **Sviluppatori → Webhook**. Vedrai le destinazioni già esistenti (quella dell'e-commerce).

Gli eventi che OMNIA AI usa sono questi nove:

| Evento | A cosa serve |
|---|---|
| `checkout.session.completed` | nuovo abbonamento, acquisto crediti, revisione umana |
| `customer.subscription.updated` | cambio piano, rinnovo, disdetta |
| `customer.subscription.deleted` | fine abbonamento |
| `subscription_schedule.created` / `.updated` / `.released` | cambio piano programmato |
| `invoice.paid` | incassi, ricavi, fatture da emettere |
| `invoice.payment_failed` | avviso di pagamento fallito |
| `customer.updated` | email di cambio metodo di pagamento |

**Regola importante:** lo stesso evento NON deve arrivare a due destinazioni, altrimenti viene elaborato due volte.

Cosa fare, nel modo più semplice:
1. Apri la destinazione che punta già a `https://app.omniaitalia.com/api/webhooks/stripe` (o `https://omnia-ai.it/api/webhooks/stripe`: il percorso è lo stesso, il codice è unico).
2. **Modifica destinazione → Seleziona eventi** e **aggiungi** quelli della tabella che non ci sono già.
3. Salva. **Non** creare una seconda destinazione con gli stessi eventi.

Il segreto di firma (`whsec_…`) di quella destinazione è già su Vercel come `STRIPE_WEBHOOK_SECRET`.
Se per OMNIA AI vuoi un segreto separato crea una destinazione nuova **solo con gli eventi che le altre non hanno**.

Come capire che è andato bene: al passo 6 la console mostra «Webhook di Stripe: tutti gli eventi arrivano, una volta sola».

---

## Passo 2 — Portale clienti di Stripe (live)

Stripe (live) → **Impostazioni → Fatturazione → Portale clienti**. Attiva e **salva**:

- ✅ Aggiornamento del metodo di pagamento
- ✅ Storico delle fatture
- ✅ Aggiornamento dei dati del cliente: indirizzo e partita IVA
- ❌ Annullamento dell'abbonamento: **spento** (la disdetta si fa dall'area riservata di OMNIA AI)
- ❌ Cambio di piano: **spento** (si fa dall'area riservata)
- Informazioni aziendali: titolo «OMNIA AI», privacy `https://omnia-ai.it/privacy`, condizioni `https://omnia-ai.it/condizioni-abbonamento`

---

## Passo 3 — Chiavi su Vercel

Vercel → progetto → **Settings → Environment Variables**. Modifica **solo per l'ambiente Production**
(lascia quelle di prova per Preview e Development):

| Variabile | Valore |
|---|---|
| `STRIPE_SECRET_KEY_OMNIA_AI` | la chiave segreta **live** (`sk_live_…`) dell'account reale |
| `STRIPE_WEBHOOK_SECRET_OMNIA_AI` | se al passo 1 hai aggiunto gli eventi alla destinazione esistente: lo stesso valore di `STRIPE_WEBHOOK_SECRET` (oppure lascia com'è, il sito prova entrambi i segreti). Se hai creato una destinazione nuova: il suo segreto `whsec_…` |

Poi **Deployments → ultimo deploy → ⋯ → Redeploy** (le variabili si leggono solo al deploy).

---

## Passo 4 — Controllo nella console

Console → **Piani e prezzi**. In alto, il riquadro «Messa in vendita degli abbonamenti» deve dire
«Stripe in modalità reale: sì». Se dice «è di prova», il passo 3 non è completo o manca il Redeploy.

## Passo 5 — Prezzi dei tre piani su Stripe

Nello stesso riquadro, se vedi «Prezzi dei piani su Stripe: mancano …», premi **Crea i prezzi mancanti**
e conferma. Crea su Stripe (live) i tre prezzi mensili con gli importi del listino:
Starter 699 €, Professional 1.490 €, Enterprise 2.900 € (IVA inclusa), nel prodotto «OMNIA AI — Abbonamento».
Non tocca mai prezzi già esistenti.

## Passo 6 — Tutti i controlli verdi

Il riquadro deve mostrare quattro righe verdi: Stripe reale, prezzi, webhook, portale clienti.
Se una è rossa o gialla, il testo accanto dice cosa fare.

## Passo 7 — Accendi la vendita

Premi **Accendi la vendita** e conferma. Da subito, su `omnia-ai.it/piani`, sotto ogni piano compare **Abbonati**
(accanto a «Richiedi la demo»). Per fermare tutto in un attimo: **Sospendi la vendita**.

---

## Passo 8 — Prova con un acquisto vero (consigliato)

Fai tu un abbonamento al piano più economico, con una tua carta, poi:
1. controlla l'email di conferma e che l'account si attivi;
2. console → **Da fatturare** deve mostrare l'incasso come reale (non «di prova»);
3. disdici dall'area riservata e, se vuoi, rimborsa il pagamento da Stripe.

## Se qualcosa va storto

- **Sospendi la vendita** dalla console: il pulsante sparisce subito. Chi è già abbonato non cambia.
- Per tornare alla modalità di prova basta rimettere la chiave `sk_test_…` su Vercel (Production) e fare Redeploy.
