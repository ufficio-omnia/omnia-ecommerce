# Verifica anti-bot (Cloudflare Turnstile) — guida passo passo

Documento per l'ufficio. La verifica protegge i moduli pubblici dei due siti: **richiesta demo, registrazione, login e
password dimenticata** (omnia-ai.it e app.omniaitalia.com). È gratuita. Nei moduli compare un riquadro **sempre visibile**:
mostra «Stiamo verificando che tu non sia un robot» e, appena Cloudflare è sicuro, la spunta verde «Operazione completata!».
(Nei browser automatici resta su «Stiamo verificando»: è normale, Cloudflare diffida dei programmi.)

Finché non fai questi passi il codice resta **spento**: non cambia nulla per nessuno.
La verifica si accende solo quando su Vercel ci sono **entrambe** le chiavi.

---

## Passo 1 — Account Cloudflare (gratuito)

1. Vai su <https://dash.cloudflare.com> e crea un account (puoi usare ufficio@omniaitalia.com).
   **Non devi spostare i domini su Cloudflare né cambiare i DNS**: Turnstile funziona da solo.
2. Attiva la **verifica in due passaggi** sull'account (Profilo → Autenticazione).

## Passo 2 — Crea il widget Turnstile

1. Menu a sinistra → **Turnstile** → **Aggiungi widget** (Add widget).
2. **Nome:** `OMNIA siti pubblici`.
3. **Nomi host (Hostnames):** aggiungi questi tre, uno per volta:
   - `omnia-ai.it`
   - `www.omnia-ai.it`
   - `app.omniaitalia.com`
4. **Modalità del widget:** `Managed` (gestita).
5. **Pre-clearance:** `No`.
6. Crea. Cloudflare mostra due chiavi:
   - **Chiave del sito (Site Key)**: pubblica, inizia per `0x…`
   - **Chiave segreta (Secret Key)**: privata, **non va mostrata a nessuno**

## Passo 3 — Inseriscile su Vercel

Vercel → progetto `omnia-ecommerce` → **Settings → Environment Variables**. Aggiungi, **solo per Production**:

| Nome | Valore |
|---|---|
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | la chiave del sito (`0x…`) |
| `TURNSTILE_SECRET_KEY` | la chiave segreta |

Poi **Deployments → ultimo deploy → ⋯ → Redeploy**. Il rifacimento è obbligatorio: la chiave del sito entra nel codice
mandato al browser solo quando il sito viene ricostruito.

> Le chiavi segrete si incollano **solo su Vercel**, mai in chat né per email.

## Passo 4 — Controlla che funzioni

1. **Console → Panoramica → Stato del sistema:** la riga «Verifica anti-bot (Turnstile)» deve dire **Attiva**.
   Se dice «Manca una delle due chiavi», ne hai inserita una sola o con un nome sbagliato.
2. Apri in una finestra privata `https://omnia-ai.it/login` e prova un accesso (anche con password sbagliata): deve rispondere
   «Email o password non corrette», **non** «Verifica di sicurezza non riuscita».
3. Prova lo stesso su `https://app.omniaitalia.com/login`.
4. Richiedi una demo di prova da `https://omnia-ai.it/demo`: l'email deve arrivare a ufficio@ come sempre.

## Se qualcosa va storto

- **Non riesci più ad accedere / i moduli danno sempre errore:** cancella le due variabili su Vercel (Production) e fai Redeploy:
  la verifica torna spenta e tutto funziona come prima.
- **Chiave segreta sbagliata:** il sito **non** chiude fuori nessuno (lo segnala nel registro del server e lascia passare);
  correggi la chiave e rifai il Redeploy.
- **Cloudflare irraggiungibile:** nessun cliente viene bloccato; la verifica viene saltata finché il servizio non torna.
- **Nuovo dominio:** aggiungilo ai nomi host del widget, altrimenti il riquadro non funziona su quel dominio.

## Cosa NON copre (da sapere)

La verifica ferma i bot che usano **i moduli del nostro sito**. Non ferma chi chiama direttamente le API di Supabase senza
passare dal sito (indirizzo e chiave pubblica sono visibili nel codice del browser). Contro quello esiste l'opzione
«CAPTCHA» di Supabase (Authentication → Attack Protection), che però tocca anche le email di attivazione generate dal server
e va provata prima su un progetto Supabase separato da quello di produzione.
