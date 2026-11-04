# OMNIA AI — Demo prenotate: tracciamento e misura del costo per demo

Guida operativa (04/11/2026). Descrive cosa è stato realizzato, cosa serve per accenderlo e cosa NON è ancora attivo.
**Nulla di quanto segue è in produzione finché non lo dici tu** (flusso solito: prove in locale → «MANDA ONLINE» → migrazione → variabili → prova guidata).

## 1. Il flusso, in breve

1. Il visitatore clicca un pulsante «Richiedi la demo» (o la voce «Demo» del menu) e arriva su `omnia-ai.it/demo`.
2. Compila il modulo (nome e cognome, nome azienda, email aziendale, telefono, settore), spunta la presa visione dell'informativa privacy
   e, se vuole, il consenso facoltativo alla misurazione pubblicitaria. Preme **CONTINUA E PRENOTA LA DEMO**.
3. Browser e server validano i dati (stessa funzione). Il server controlla il campo trappola, l'anti-bot (Turnstile), il limite di richieste
   per indirizzo (hash), poi **salva il lead su Supabase con stato `pending`** (un nuovo invio con la stessa email aggiorna la richiesta) e
   manda l'email di avviso all'ufficio (come prima).
4. Si apre il **calendario Google** (scheda aperta subito nel clic: nessun blocco dei popup) dove il visitatore sceglie giorno e ora.
   **In questo momento non è registrata nessuna conversione.**
5. Ogni 10 minuti il cron `/api/cron/omnia-ai-demo-sync` legge il calendario (sola lettura), trova le prenotazioni, le abbina al lead
   **per email normalizzata** e porta il lead a `confirmed` (con `calendar_event_id`, `booked_at`).
6. Solo per le prenotazioni confermate e abbinate con certezza: evento GA4 `demo_booking_confirmed` (lato server) e conversione Google Ads
   «OMNIA AI - DEMO prenotata» (Data Manager API). Se l'abbinamento è incerto: caso in `demo_calendar_casi` per la verifica a mano e
   **nessuna conversione**.

Eventi GA4: `demo_booking_start` (primo campo del modulo toccato, secondario), `demo_lead_submitted` (modulo inviato con successo,
secondario), `demo_booking_confirmed` (prenotazione verificata, **principale**, lato server). I primi due partono dal browser SOLO se il
tag Google è già stato caricato dal banner dei cookie (cioè con consenso).

## 2. Cosa è implementato e cosa no

| Parte | Stato |
|---|---|
| Modulo `/demo`, validazione, anti-bot, campo trappola, limite per indirizzo, deduplicazione, salvataggio `pending` | **Implementato e provato** (test automatici) |
| Cattura di gclid/gbraid/wbraid/utm con consenso, conservazione 90 giorni, cancellazione se il consenso cade | **Implementato e provato** |
| Migrazione `0098_demo_leads.sql` (tabelle, RLS senza policy, permessi, indici unici, funzione di cancellazione) | **Scritta, NON eseguita** (la esegui tu) |
| Sincronizzazione Google Calendar (sola lettura, syncToken, 410, idempotente, abbinamento prudente) | **Implementata e provata con calendario finto**; **spenta** finché non metti le credenziali e il flag |
| Evento GA4 `demo_booking_confirmed` lato server | **Implementato e provato con GA4 finto**; **spento** finché non metti il segreto e il flag |
| Conversione Google Ads (Data Manager API) con retry, riconciliazione e deduplicazione | **Implementata e provata con Google finto**; **spenta**; anche accesa parte in **«solo verifica»** (`validateOnly`) finché non passi alla modalità reale |
| Conservazione/cancellazione (cron giornaliero) | **Implementata e provata** |
| Provato con Google VERO (calendario, GA4, Ads) | **NO**: servono le tue credenziali e una prenotazione di prova (sezione 8) |
| Pagina «cosa è successo» in console per i casi da verificare | **Non fatta** (i casi sono in `demo_calendar_casi`; sezione 7 per leggerli) |
| Informativa privacy v2 e cookie policy aggiornate | **Non fatta di proposito**: bozza del testo nella sezione 9, da far vedere all'avvocato |

## 3. File creati o modificati

Creati: `supabase/migrations/0098_demo_leads.sql`; `src/lib/demo-lead-calcoli.ts`, `demo-calendario-calcoli.ts`, `demo-conversioni-calcoli.ts`,
`demo-conservazione-calcoli.ts` (regole pure); `src/lib/demo-hash.ts`, `demo-leads.ts`, `demo-calendario-sync.ts`, `demo-ga4.ts`,
`demo-ads-data-manager.ts`, `google-oauth.ts`, `cron-autorizzato.ts`; `src/app/api/cron/omnia-ai-demo-sync/route.ts`,
`src/app/api/cron/omnia-ai-demo-purge/route.ts`; `src/components/omnia-ai/attribuzione-demo.tsx`; test
`scripts/verifica-demo-tracciamento-omnia-ai.ts`, `scripts/demo-finto-supabase.ts`; questa guida.

Modificati: `src/components/omnia-ai/demo-form.tsx` (modulo nuovo), `src/app/actions/omnia-ai-demo.ts` (azione `inviaRichiestaDemo`),
`src/app/site-omnia-ai/demo/page.tsx` (testo della pagina), `src/app/site-omnia-ai/layout.tsx` (monta la cattura dell'attribuzione),
`vercel.json` (due cron), `package.json` (test nella catena), `scripts/verifica-demo-calendario-omnia-ai.ts`.

**Non toccati** (verificato dai test): banner cookie e Google Analytics esistenti, pagamenti Stripe, abbonamenti, autenticazione, generazione
delle offerte tecniche, console, `proxy.ts`, `zone.ts`.

## 4. Migrazione Supabase

File: `supabase/migrations/0098_demo_leads.sql` (numero scelto per non collidere con la 0096 e la 0097 del lavoro sul piano di lavoro Excel).
Si esegue incollandola nell'editor SQL di Supabase; è additiva e si può rieseguire. Crea:

- `demo_leads` (lead e prenotazioni, stati `pending` / `confirmed` / `cancelled`, stato dell'importazione in Google Ads);
- `demo_calendar_casi` (prenotazioni non abbinabili con certezza, per la verifica a mano);
- `demo_sync_stato` (il `syncToken` di Google).

Sicurezza: RLS attiva e **nessuna policy**, permessi tolti a `anon` e `authenticated`, dati solo a `service_role` (il server). Il browser non
legge né scrive mai. L'IP non si salva (solo un hash con segreto). Un evento del calendario appartiene a un solo lead (indice unico);
una sola richiesta `pending` per email (deduplicazione); un solo caso per evento.

**Prima di eseguirla** il modulo `/demo` funziona lo stesso: il lead non viene salvato, la richiesta arriva per email (riga «Salvata nel
registro: NO») e il calendario si apre comunque.

**Cancellazione su richiesta dell'interessato**: `select public.demo_cancella_dati_email('mario.rossi@esempio.it');` (email in minuscolo).

**Conservazione** (cron giornaliero): lead `pending` 90 giorni; lead confermati o cancellati 24 mesi; casi da verificare 12 mesi (6 se risolti).

## 5. Variabili d'ambiente (Vercel → Settings → Environment Variables)

Tutte opzionali: senza di esse il modulo funziona e le integrazioni restano spente.

| Variabile | A cosa serve |
|---|---|
| `CRON_SECRET` | Già presente (usata dagli altri cron). Senza, i cron rispondono 401. Fa anche da segreto di riserva per l'hash degli indirizzi. |
| `DEMO_LEADS_HASH_SECRET` | Segreto (una stringa lunga a caso) per l'hash degli indirizzi IP. Se manca si usa `CRON_SECRET`. |
| `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET` | Credenziali OAuth del progetto Google Cloud (stesse per Calendar e Ads). |
| `GOOGLE_CALENDAR_REFRESH_TOKEN` | Refresh token dell'account che possiede il calendario delle demo (ambito `calendar.readonly`). |
| `GOOGLE_CALENDAR_ID` | ID del calendario (per il calendario principale è l'email dell'account). |
| `DEMO_CALENDAR_SYNC_ENABLED` | `1` per accendere la sincronizzazione. |
| `DEMO_CALENDAR_TITLE_REGEX` | Espressione regolare (senza distinzione di maiuscole) che riconosce il titolo degli eventi DEMO. Predefinita: `demo`. Da confermare con una prenotazione di prova (sezione 8). |
| `DEMO_CALENDAR_INTERNAL_EMAILS` | Email della squadra, separate da virgola: non sono mai «chi ha prenotato». |
| `DEMO_MATCH_WINDOW_DAYS` | Giorni dopo l'invio del modulo entro cui una prenotazione si abbina a quel lead (predefinito 30, da 1 a 365). |
| `DEMO_GA4_MP_ENABLED` | `1` per accendere l'evento GA4 lato server. |
| `GA4_API_SECRET` | Segreto API del Measurement Protocol (sezione 6). |
| `GA4_MEASUREMENT_ID` | Facoltativa: predefinita `G-W551SWPNE4`. |
| `DEMO_GA4_MP_DEBUG` | `1` per provare: usa il server di validazione di Google e NON segna l'evento come inviato. |
| `DEMO_ADS_IMPORT_ENABLED` | `1` per accendere la conversione Google Ads (parte in «solo verifica»). |
| `DEMO_ADS_VALIDATE_ONLY` | Predefinito «solo verifica» (Google controlla ma non registra). **`0` = modalità reale.** |
| `DEMO_ADS_ALLOW_EMAIL_ONLY` | `1` per inviare anche i lead senza identificativo di clic (solo email cifrata, richiede il consenso del modulo). Predefinito spento. |
| `GOOGLE_ADS_CUSTOMER_ID` | ID dell'account Google Ads, 10 cifre senza trattini. |
| `GOOGLE_ADS_LOGIN_CUSTOMER_ID` | Facoltativo: account manager da cui si accede, se diverso. |
| `GOOGLE_ADS_DEMO_CONVERSION_ACTION_ID` | ID NUMERICO dell'azione «OMNIA AI - DEMO prenotata» (sezione 6). Non inventarlo: lo prendi dall'account. |
| `GOOGLE_ADS_REFRESH_TOKEN` | Refresh token con ambito `https://www.googleapis.com/auth/datamanager`, di un utente con accesso all'account Ads. |

## 6. Passaggi manuali nelle console Google

### 6.1 Progetto Google Cloud e OAuth
1. console.cloud.google.com → un progetto (o quello che usi già) → «API e servizi» → abilita **Google Calendar API** e **Data Manager API**.
2. «Schermata di consenso OAuth»: tipo **Interno** se hai Google Workspace, altrimenti Esterno e **pubblicalo in produzione**
   (con lo stato «Test» il refresh token scade dopo 7 giorni e la sincronizzazione smette di funzionare).
3. «Credenziali» → crea un ID client OAuth (tipo «Applicazione web», URI di reindirizzamento `https://developers.google.com/oauthplayground`).
   Sono `GOOGLE_OAUTH_CLIENT_ID` e `GOOGLE_OAUTH_CLIENT_SECRET`.
4. Su developers.google.com/oauthplayground: ingranaggio → «Use your own OAuth credentials» → inserisci le tue; seleziona gli ambiti, accedi con
   l'account giusto e scambia il codice: ottieni il refresh token.
   - Calendario: ambito `https://www.googleapis.com/auth/calendar.readonly`, con l'**account proprietario della Programmazione appuntamenti**.
   - Ads: ambito `https://www.googleapis.com/auth/datamanager`, con un utente che ha accesso all'account Google Ads.

### 6.2 Google Calendar
- ID del calendario: Impostazioni del calendario → «Integra il calendario» → ID calendario.
- **Prenotazione di prova obbligatoria** (passo 8): Google Calendar non ha un campo che dica «questo evento è una prenotazione da Programmazione
  appuntamenti» (i tipi di evento sono solo default/fromGmail/…); chi prenota compare solo come partecipante. Le demo si riconoscono dal
  **titolo** dell'evento: dopo la prenotazione di prova guarda come si chiama l'evento e imposta `DEMO_CALENDAR_TITLE_REGEX` di conseguenza.

### 6.3 Google Analytics 4
- Amministrazione → Flussi di dati → il flusso web → «Segreti API del Measurement Protocol» → crea → `GA4_API_SECRET`.
- Amministrazione → Eventi: segna `demo_booking_confirmed` come **evento chiave**; `demo_booking_start` e `demo_lead_submitted` restano non chiave.
- **Non importare `demo_booking_confirmed` in Google Ads** come conversione: per Ads c'è la conversione dedicata e importarla due volte la conterebbe due volte.

### 6.4 Azione di conversione in Google Ads
1. Obiettivi → Conversioni → Riepilogo → «+ Nuova azione di conversione» → **Importa** → «Altre origini dati o CRM» → **«Monitora le conversioni dai clic»**
   (nell'API è il tipo `UPLOAD_CLICKS`, richiesto dalla Data Manager API: «Sito web (importazione dai clic)»).
2. Nome: **OMNIA AI - DEMO prenotata**. Categoria: «Lead inviato» o «Prenota appuntamento». Valore: nessuno (o un valore stimato per demo).
   Conteggio: **Uno** (una per clic). Finestra di conversione: 30–90 giorni.
3. L'ID numerico dell'azione compare nell'indirizzo della pagina dell'azione (`ctId=...`): è `GOOGLE_ADS_DEMO_CONVERSION_ACTION_ID`.
4. Lasciala **secondaria** finché le prove non sono finite; poi puoi renderla primaria (influisce sulle offerte automatiche).
5. Il tagging automatico è già attivo (serve per avere il `gclid` negli indirizzi). Facoltativo: attiva «Conversioni avanzate per i lead» in
   Impostazioni → Raccolta dati, se vuoi inviare anche l'email cifrata dei lead senza clic.
- **Nota sul tag Google Ads sul sito**: oggi l'ID `AW-18422155730` NON è collegato al sito e il tag `GT-P8RVLQB4` non è nel codice; non è
  necessario per questa integrazione (le conversioni arrivano dal server). Collegarlo cambierebbe il tracciamento esistente: decisione tua.

## 7. Come si prova (in quest'ordine) e come si leggono i risultati

Le chiamate ai cron si fanno a mano con: `curl -H "Authorization: Bearer <CRON_SECRET>" https://app.omniaitalia.com/api/cron/omnia-ai-demo-sync`
(risponde solo con numeri e motivi).

1. **Migrazione** 0098 eseguita. Compila il modulo su `/demo` (anche in locale con `?__zone=omnia-ai`): in `demo_leads` compare una riga `pending`.
2. **Attribuzione**: apri `omnia-ai.it/?gclid=PROVA_12345678&utm_source=test`, accetta i cookie, poi compila il modulo: `gclid` e `utm_source` sono nel lead.
   Senza aver accettato i cookie restano vuoti. (Con un `gclid` finto la conversione vera NON deve essere accesa.)
3. **Calendario**: imposta le variabili del calendario, `DEMO_CALENDAR_SYNC_ENABLED=1`; fai UNA prenotazione di prova dal link del calendario con la stessa email
   del modulo; richiama il cron: il lead passa a `confirmed`. Se non succede, guarda `demo_calendar_casi` (motivo) e il titolo dell'evento.
4. **GA4**: imposta `GA4_API_SECRET`, `DEMO_GA4_MP_ENABLED=1` e `DEMO_GA4_MP_DEBUG=1` (verifica: nessun evento viene registrato); se `verificati` è 1, togli `DEBUG`.
5. **Google Ads in «solo verifica»**: imposta account, azione, token, `DEMO_ADS_IMPORT_ENABLED=1` (senza toccare `DEMO_ADS_VALIDATE_ONLY`): il lead passa a `validated`
   e Google dice se la richiesta è valida senza registrare nulla.
6. **Modalità reale**: solo con un tuo via libera esplicito, `DEMO_ADS_VALIDATE_ONLY=0`: il lead passa a `sent` e, dopo l'elaborazione, a `accepted`.

Query utili (editor SQL): stato dei lead `select booking_status, ads_import_status, count(*) from demo_leads group by 1,2;`
· casi da guardare `select motivo, calendar_event_id, created_at from demo_calendar_casi where risolto = false order by created_at;`
· ultima sincronizzazione `select last_run_at, last_success_at, last_error from demo_sync_stato;`
Per chiudere un caso a mano: `update demo_calendar_casi set risolto = true where calendar_event_id = '...';`

Stati Google Ads di un lead: `not_ready` (non ancora confermato) → `ready` → `validated` (solo verifica) → `sent` → **`accepted`** (solo qui Google ha confermato).
`failed` (errore: si riprova da soli solo se è di rete o di Google; un errore di elaborazione lo guarda una persona), `skipped_no_consent`,
`skipped_no_identifier`, `skipped_cancelled`.

## 8. Regole di prudenza (perché una conversione può NON partire)

- Mai senza prenotazione confermata sul calendario e abbinata con certezza (una sola persona, email uguale, richiesta precedente alla prenotazione
  e non più vecchia della finestra). Più richieste possibili, seconda prenotazione della stessa persona, nessun lead, email assente o malformata: caso a verifica manuale.
- Mai senza consenso: servono i cookie pubblicitari accettati nel banner (il clic si conserva solo così) e, per l'email cifrata, anche la spunta facoltativa del modulo.
- Mai senza identificativo di clic (salvo `DEMO_ADS_ALLOW_EMAIL_ONLY=1` + consenso dell'email).
- Mai due volte: identificativo di transazione stabile per lead (`omnia-demo-<id lead>`) e stato nel database; Google tiene il primo evento e tratta i successivi come rettifiche.
- Mai oltre 90 giorni dalla prenotazione. Mai nel futuro.
- Una conversione è «acquisita» (`accepted`) solo quando Google risponde `SUCCESS` a `requestStatus:retrieve`; `PROCESSING` si aspetta (oltre 48 ore diventa `failed`).
- Una prenotazione cancellata dopo l'invio non può essere ritirata da qui (lo stato resta `accepted`): eventuale rettifica a mano in Google Ads.

## 9. Bozza per informativa privacy e cookie (DA FAR VEDERE ALL'AVVOCATO)

La Privacy policy v1 è dichiarata immutabile: serve una **v2**. Il testo breve del modulo e i consensi hanno la versione `demo-2026-11-04` (si salva col lead).
Punti da coprire: titolare Omnia Consulting SRLS; finalità «gestione della richiesta di demo, prenotazione tramite Google Calendar, ricontatto» (misure precontrattuali) e
«misurazione dell'efficacia delle campagne pubblicitarie» (consenso, facoltativo); dati trattati (nome, azienda, email, telefono, settore, identificativi di campagna e di Analytics solo con consenso);
destinatari (Google per Calendar, Analytics e Ads; Supabase; Vercel; Resend); conservazione (pending 90 giorni; confermati/cancellati 24 mesi; casi 12 mesi);
diritti e cancellazione; trasferimenti extra-UE tramite Google. Cookie policy: citare il salvataggio locale `omnia-ai-attribuzione` (90 giorni, solo con consenso) accanto ai cookie di Analytics.

## 10. Limiti da conoscere

- **GA4 server-side**: il Measurement Protocol risponde «2xx» anche a un corpo malformato, non deduplica gli eventi (per questo si manda una volta sola) e accetta eventi retrodatati
  fino a 72 ore; l'attribuzione alla campagna dipende da `client_id` e `session_id` raccolti col consenso: senza, l'evento conta in GA4 ma non è legato alla campagna.
- **Riconoscimento delle demo**: dal titolo dell'evento, non da un campo ufficiale (vedi 6.2). Se cambi il titolo della programmazione, aggiorna `DEMO_CALENDAR_TITLE_REGEX`.
- **Abbinamento per email**: se chi prenota usa un'altra email rispetto al modulo, finisce tra i casi da verificare e non produce conversione (si perde meglio di quanto si attribuisca male).
- **Consent Mode**: il banner è binario e carica Google solo dopo «Accetta»; non è stato aggiunto Consent Mode v2 (si sarebbe modificato il tracciamento esistente). Le conversioni da server inviano comunque i segnali di consenso.
- Il server non può verificare il consenso ai cookie dichiarato dal modulo (lo legge il browser): è un'assunzione documentata.
- Nessuna pagina in console per i casi: si leggono con le query sopra.

## 11. Come spegnere tutto

Togli `DEMO_CALENDAR_SYNC_ENABLED`, `DEMO_GA4_MP_ENABLED`, `DEMO_ADS_IMPORT_ENABLED` (i cron restano ma non fanno nulla). Il modulo continua a raccogliere i lead.
