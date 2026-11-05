# Google tag di omnia-ai.it con Consent Mode v2 avanzato e dati ridotti prima del consenso

Preparato il 05/11/2026 sul ramo `feature/google-tag-consent-mode-advanced`. **Non pubblicato.** Il rilascio richiede un «MANDA ONLINE» dopo l'approvazione dei testi (banner, cookie policy v2, privacy policy v2) e dei punti di conformità della sezione 5.

## 0. In breve

- **Problema**: Google Ads segnala «Nel tuo sito web manca un tag Google» per `omnia-ai.it`.
- **Causa verificata**: sul sito non c'era nessun tag Google nell'HTML iniziale e l'ID di Google Ads (`AW-18422155730`) non era configurato (nel banner c'era `GADS_ID = null`). Anche Analytics (`G-W551SWPNE4`) veniva aggiunto solo dal browser dopo «Accetta».
- **Soluzione**: un solo gtag.js nell'`<head>` dell'HTML iniziale, con le due destinazioni (Analytics e Google Ads) e i quattro consensi su «denied» **prima** di ogni configurazione. Il banner esistente aggiorna i consensi (accetta, rifiuta, revoca).
- **Dati ridotti al minimo prima del consenso** (decisione dell'utente: Consent Mode *avanzato*, tutto negato all'inizio):
  - **Google Analytics resta spento** finché non premi «Accetta»: nessun page view, nessun evento, nessuna navigazione interna;
  - **Google Ads riceve al massimo UN segnale tecnico senza cookie**, solo se apri direttamente una delle sei pagine di presentazione, con indirizzo e referrer **senza parametri e senza frammento** (niente `gclid`, `utm_*`, email, identificativi);
  - su tutte le altre pagine (accesso, registrazione, acquisto, area riservata, pagine legali) **non parte nessuna misurazione**: il browser scarica solo il file della libreria;
  - **nessun cookie di Google** prima del consenso e dopo un rifiuto; la personalizzazione pubblicitaria (`ad_personalization`) resta **sempre «denied»**, anche dopo «Accetta».
- **Costo in privacy**: la cookie policy v1 e il banner attuali diventano inesatti; **non si pubblica nulla senza i testi nuovi** (sezione 5 e 7). I testi proposti sono in `legal/cookie-policy-omnia-ai-v2.md`, `legal/privacy-policy-omnia-ai-v2.md` e nel testo del banner (`TESTO_BANNER_COOKIE` in `src/lib/demo-consensi-calcoli.ts`).
- **Limite**: non è documentato come Google Ads decida «manca un tag». Il tag ora è nell'HTML e si comporta come Google descrive, ma l'avviso può impiegare tempo (24 ore o più) a sparire o richiedere un passaggio nell'interfaccia di Google Ads (sezione 6).

## 1. Diagnosi (verificata il 05/11/2026)

HTML pubblicato di `omnia-ai.it/` e `omnia-ai.it/demo` (scaricato senza eseguire JavaScript, come farebbe un controllo automatico): **0** occorrenze di `googletagmanager`, `gtag`, `dataLayer`, `G-W551SWPNE4`, `AW-18422155730`.

| Zona | Cosa caricava | Quando |
|---|---|---|
| omnia-ai.it (tutte le pagine, `/demo` compresa) | solo Analytics `G-W551SWPNE4`, via `next/script` dal banner | solo dopo «Accetta» |
| app.omniaitalia.com | Google Ads `AW-18422155730` e un altro GA4 (`G-KJR822ZRC7`), due caricamenti | solo dopo «Accetta» |
| sito statico omniaitalia.com | Google Ads `AW-18422155730` e un altro GA4 | solo dopo «Accetta» |
| console | niente | mai |

Il Consent Mode non era implementato da nessuna parte (nessun `gtag('consent', …)`). Il server rendeva sempre il banner «in attesa» e non scriveva mai il tag: un controllo che non preme «Accetta» non lo vede.

## 2. Cosa è stato cambiato

| File | Cambiamento |
|---|---|
| `src/lib/google-tag.ts` (nuovo) | ID, snippet iniziale, regole del consenso, pagine ammesse al segnale ridotto, cancellazione dei cookie. Puro, usabile da server e browser. |
| `src/app/site-omnia-ai/layout.tsx` | Nell'`<head>`: snippet inline, poi `<script defer src="…/gtag/js?id=G-W551SWPNE4">`. |
| `src/components/omnia-ai/cookie-consent.tsx` | Tolti i due `<Script>` che caricavano il tag; stessa chiave e stesso evento; testo da una sola fonte con il collegamento alla cookie policy; la scelta si salva **con la versione del testo visto**; comunica il consenso a Google; senza consenso valido cancella i cookie di Google. |
| `src/lib/demo-consensi-calcoli.ts` | Nuovo testo del banner (`TESTO_BANNER_COOKIE`), nuova versione (`VERSIONE_BANNER_COOKIE = "banner-2026-11"`), versione dell'informativa registrata `"2"`. Il registro dei consensi delle richieste registra questa versione. |
| `src/components/omnia-ai/demo-form.tsx` | Gli eventi `demo_booking_start` e `demo_lead_submitted` partono solo con i cookie accettati (prima bastava che il tag esistesse). Nient'altro del modulo cambia. |
| `legal/cookie-policy-omnia-ai-v2.md`, `legal/privacy-policy-omnia-ai-v2.md` | Testi completi v2 (le v1 non si toccano). Tre punti tra parentesi quadre da sciogliere con l'avvocato (sezione 5, punto 1). |
| `src/lib/legal-documenti.ts`, pagine `/privacy` e `/cookie-policy` | Le v2 sono nel registro dei documenti; le due pagine mostrano la versione in vigore secondo il database, con ricaduta sulla v1 finché la 0100 non è eseguita. |
| `supabase/migrations/0100_omnia_ai_privacy_cookie_v2.sql` | **Non eseguita.** Inserisce le due righe v2 in `legal_documents` con le impronte SHA-256. Da eseguire subito dopo il deploy (sezione 7). |
| test | `scripts/verifica-google-tag-omnia-ai.ts` (nella catena), `scripts/controlla-html-google-tag.ts` (HTML vero, manuale), aggiornati `verifica-legale-omnia-ai.ts` e `verifica-demo-tracciamento-omnia-ai.ts`. |

**Non toccati**: raccolta del GCLID (`attribuzione-demo.tsx`), Data Manager API (`DEMO_ADS_VALIDATE_ONLY=1`), Google Calendar, GA4 lato server (`DEMO_GA4_MP_DEBUG=1`), cron, Supabase (salvo la migrazione 0100, non eseguita), Stripe, autenticazione, pagamenti e abbonamenti, il sito e-commerce, la console, le variabili di Vercel. **Nessun evento di conversione di Google Ads è creato**: le DEMO confermate vanno ad Ads solo dalla Data Manager API.

### Perché veri tag `<script>` e non `next/script`
`next/script` con `beforeInteractive` non scrive un `<script>` ma accoda lo snippet in una coda interna di Next (`self.__next_s`) e lascia nell'HTML solo un `<link rel="preload">`. Un controllo automatico di Google cerca il tag vero. Il layout usa quindi due `<script>` normali: lo snippet inline (esegue subito) e la libreria con `defer` (esegue dopo lo snippet). Niente `async` sulla libreria: React lo sposterebbe in testa all'`<head>`, prima dello snippet.

## 3. Come funziona

Ordine dei comandi nello snippet (verificato nell'HTML e nel browser):

1. `consent default` con `ad_storage`, `analytics_storage`, `ad_user_data`, `ad_personalization` = **denied**;
2. Analytics **spento** con l'interruttore ufficiale di Google (`window['ga-disable-G-W551SWPNE4'] = true`);
3. se nel browser c'è già «accettato» **con la versione attuale del testo del banner**: interruttore riacceso e `consent update` subito, prima di ogni configurazione; altrimenti `set` di `page_location` e `page_referrer` **ridotti a origine + percorso**;
4. `set ads_data_redaction true`; `js`;
5. configurazioni: se ha accettato → Analytics (con page view) e Google Ads, su qualunque pagina; se non ha accettato → **solo se la pagina è una delle sei di presentazione** (Home, Come funziona, Piani, Demo, Contatti, Riservatezza): Analytics con `send_page_view:false` (comunque spento dall'interruttore) e Google Ads; sulle altre pagine nessuna configurazione.

| Scelta | Cosa succede |
|---|---|
| Nuovo visitatore / banner ignorato | tutto «denied»; Analytics spento; sulle sei pagine un solo segnale tecnico ridotto verso Google Ads (sezione 4); nessun cookie di Google |
| «Accetta» | indirizzo e referrer **veri** impostati per primi, Analytics riacceso, un solo `consent update` (`ad_storage`, `analytics_storage`, `ad_user_data` = granted; **`ad_personalization` resta denied**), poi UN `page_view` di Analytics con l'indirizzo vero (la campagna di provenienza si attribuisce). Compaiono i cookie `_ga`, `_ga_G-W551SWPNE4`, `_gcl_au` (e `_gcl_aw` se arrivi da un annuncio) |
| «Rifiuta» | nessun comando a Google (era già «denied»); **si cancellano eventuali cookie di Google già presenti** (per chi aveva accettato con il vecchio testo) |
| Revoca («Preferenze cookie») | Analytics si spegne subito, `consent update` a «denied», indirizzo e referrer di nuovo ridotti, **cancellazione dei cookie di Google** (`_ga`, `_ga_…`, `_gid`, `_gcl_*`, `__gads`, `__gpi`…); gli altri cookie (accesso, zona) non si toccano; il banner riappare |
| Scelta salvata con un testo precedente del banner | non vale: si cancella (chiave e versione) a ogni caricamento, il banner si ripropone, il visitatore è trattato da nuovo |
| Navigazione tra pagine senza ricaricare | nessun comando nuovo (idempotente) |
| Caricamento completo di un'altra pagina | la scelta valida viene riletta: «denied» → «granted» prima dei `config` se aveva accettato |
| `localStorage` bloccato (modalità privata) | nessun errore, tutto «denied» |

Il banner nell'effetto legge la scelta **vera** dal browser, non lo stato dell'idratazione (che per il server è sempre «in attesa»): altrimenti chi ha già accettato verrebbe trattato come una revoca a ogni caricamento.

## 4. Cosa viene trasmesso a Google, prima e dopo il consenso (verificato nel browser)

**Come sono state fatte le prove (05/11/2026).** Banco di prova locale (`127.0.0.1`) che esegue lo **snippet vero** prodotto da `costruisciSnippetIniziale()` e il **codice vero** di `src/lib/google-tag.ts`, con gli ID di produzione, in un browser reale. Le richieste di misura verso Google sono state **intercettate in locale e registrate**, senza inviarle: è uscita soltanto la richiesta del file della libreria (`gtag/js`). Le tabelle riportano ciò che il browser ha tentato di inviare. (In un round precedente di prove, con il disegno vecchio, due serie di segnali senza cookie con consenso negato erano invece partite davvero da `localhost` verso Google, con gli ID di produzione: possono comparire in Analytics come visite dall'host `localhost`.) Le richieste sono quelle di Google il 05/11/2026: Google può cambiarle nel tempo.

### 4.1 Nuovo visitatore che arriva da un annuncio su una pagina di presentazione
Indirizzo di prova: `/demo?gclid=TESTGCLID123456&utm_source=google&utm_campaign=prova&email=mario.rossi%40example.com&id=9f1c#sezione`, arrivo da un'altra pagina. Nessun cookie di Google nel browser, banner in attesa.

| Richiesta | Contenuto |
|---|---|
| `www.googletagmanager.com/gtag/js?id=G-W551SWPNE4` | il file della libreria (il nostro `<script>`) |
| `www.googletagmanager.com/gtag/js?id=AW-18422155730&cx=c&gtm=…` | il file della seconda destinazione, aggiunto **da Google** dopo il `config` (non è un doppione: nell'HTML c'è un solo gtag.js) |
| `pagead2.googlesyndication.com/ccm/collect`, `en=page_view` | **l'unico segnale di misura**: `dl` = `…/demo` **senza parametri né frammento**; `dr` = pagina di provenienza **senza parametri**; `gclid=0` (oscurato); `gcs=G100` (tutti i consensi negati); `npa=1`; `dma_cps=-`; `tid=AW-18422155730`; `rnd` numero casuale per quella pagina; orari (`tft`, `tfd`); sigle tecniche di Google (`gtm`, `tag_exp`, `gcd`, `fmt`…). **Nessun `cid`, nessun cookie**, nessun `email`, `id`, `utm_*` |
| Google Analytics (`google-analytics.com`) | **nessuna richiesta** |

Il segnale compare nel banco di prova in due forme di trasporto (una richiesta `fetch` e un'immagine 1×1) con lo stesso contenuto e lo stesso `rnd`: è un solo evento.

Cookie dopo l'apertura: **nessuno**. Comandi in coda: `page_location` e `page_referrer` ridotti, nessun valore «granted».

### 4.2 Pagine NON di presentazione (accesso, registrazione, acquisto, area riservata, pagine legali)
Nessuna destinazione configurata: **nessuna richiesta di misura**, nessun cookie. Resta la richiesta del file `gtag/js` della libreria, nella quale Google riceve, come per qualsiasi file di un sito, **indirizzo IP, tipo di browser, lingua e l'origine del sito** (`https://omnia-ai.it/`) come provenienza. Provato con `/login` e a livello di test per tutte le altre.

### 4.3 Navigazione interna e scorrimento, senza ricaricare, con consenso negato
Prova: apertura su `/piani`, poi cambi di indirizzo interni (`/demo?id=77&email=…`, `/contatti`, `/dashboard/omnia-ai/gare/…`) e scorrimenti: **nessuna richiesta** oltre alla prima di 4.1. (Un nuovo segnale parte solo a un caricamento completo di una delle sei pagine.)

### 4.4 Dopo «Accetta»
Comandi: indirizzo e referrer veri → `consent update` (tre «granted», `ad_personalization` «denied») → `page_view`. Cookie scritti: `_ga`, `_ga_W551SWPNE4`, `_gcl_au`, `_gcl_aw` (solo con `gclid`).

| Richiesta | Contenuto |
|---|---|
| `region1.google-analytics.com/g/collect`, `page_view` | `gcs=G111`, `cid` presente (dal cookie `_ga`), `dl` = **indirizzo completo** con `gclid` e `utm_*`; Google oscura da sé i valori che sembrano un'email (`email=(redacted)`), non gli altri parametri; `dr` = provenienza; `npa=1` |
| `www.google.com/ccm/collect`, `page_view` e `consent_update` | Google Ads, `gcs=G111`, `npa=1`, `gclid` reale, `dl` senza parametri |
| `ad.doubleclick.net/ccm/s/collect`, `www.googleadservices.com/pagead/set_partitioned_cookie` | collegamento tra clic sull'annuncio e visita (cookie di Google Ads, descritti nella cookie policy v2) |
| `google.com/rmkt/collect/…`, `…/pagead/1p-user-list/…` (remarketing e liste di pubblico) | **NON compaiono**: comparivano nella prova precedente con `ad_personalization` «granted». Per questo resta «denied» |

### 4.5 Revoca («Preferenze cookie»)
Comandi: `consent update` con i quattro segnali «denied», poi `page_location`/`page_referrer` ridotti. Analytics si spegne, **cookie cancellati** (`_gcl_aw`, `_ga_W551SWPNE4`, `_ga`, `_gcl_au`), banner di nuovo visibile, **nessuna richiesta** né subito né dopo scorrimenti e clic.

### 4.6 Scelta fatta con il testo precedente del banner
Prova: nel browser `accepted` con versione `banner-2026-09` e attribuzione `omnia-ai-attribuzione`. Esito: le due chiavi della scelta **cancellate** (resta solo l'attribuzione, non toccata), stato «denied», tag «ridotto», interruttore di Analytics acceso, nessun cookie, **un solo** segnale ridotto verso Ads.

### 4.7 «Rifiuta» e banner ignorato
Stessa situazione del nuovo visitatore: nessun comando a Google, un solo segnale ridotto sulle sei pagine, nessun cookie.

### 4.8 Cosa NON è stato provato
- **Tag Assistant** (richiede l'estensione e il tuo account Google): istruzioni in 6.2.
- **Arrivo reale da un annuncio in produzione** con Google vero: da fare dopo il rilascio (6.4). Nel banco di prova l'arrivo è simulato.
- **Cosa decide Google Ads per far sparire l'avviso**: non documentato (6.3).
- In produzione il browser invia anche intestazioni proprie (agente utente, lingua, indirizzo IP, origine del sito come «Referer»): le ho descritte nella cookie policy, ma non le registra il banco di prova.

## 5. Rischi di conformità privacy che richiedono approvazione prima del rilascio

Non sono valutazioni giuridiche (spettano all'avvocato): sono i punti in cui il comportamento tecnico tocca una scelta di conformità.

1. **Segnale tecnico verso Google Ads prima del consenso: è il punto principale.** Con il Consent Mode avanzato Google Ads riceve, anche prima della scelta e dopo un rifiuto, un segnale senza cookie su sei pagine pubbliche (sezione 4.1: orario, indirizzo e provenienza **senza parametri**, consenso negato, numero casuale per pagina; più, come in ogni richiesta, IP e browser). Va deciso se la base giuridica regge (la bozza dell'informativa lascia il punto **[Base giuridica da confermare con il legale]**). **Alternative, se non regge:**
   - *solo libreria*: nessun segnale prima del consenso (si svuota l'elenco delle pagine `PERCORSI_CON_SEGNALE_PRIMA_DEL_CONSENSO`: il tag resta nell'HTML ma non parte alcuna misura). Non so se Google Ads in questo caso toglierebbe l'avviso: non è documentato;
   - *modalità base*: tag caricato solo dopo «Accetta» (com'era): non risolve l'avviso, che è la causa di questo lavoro.
   **Decisione: approvare il segnale tecnico (e la base giuridica), oppure scegliere la variante «solo libreria».**
2. **Anche dove non parte nessun segnale** (accesso, area riservata, pagine legali) il browser scarica da Google il file `gtag/js`: Google riceve indirizzo IP, browser, lingua e l'origine del sito. È inevitabile finché il tag sta nell'HTML (è ciò che Google cerca). La cookie policy v2 lo dichiara. **Da far valutare all'avvocato insieme al punto 1.**
3. **I tre punti tra parentesi quadre** nei testi legali, da sciogliere prima del rilascio (e poi ricalcolare le impronte della 0100): (a) base giuridica del segnale tecnico; (b) periodo di conservazione di Google Analytics (2 o 14 mesi, impostato nella proprietà: non ho potuto leggerlo); (c) garanzie di Google per i trasferimenti extra UE (clausole standard / Data Privacy Framework): le pagine di Google che ho letto non le documentano.
4. **La cookie policy v1, già pubblicata, diventa falsa.** Dice che il tag non viene caricato prima di «Accetta» e che, rifiutando o ignorando il banner, nessun dato va a Google. La v1 non si modifica mai: serve la **v2**, pubblicata con lo stesso rilascio. **Decisione: approvare la v2.**
5. **Il banner attuale («solo se acconsenti») è inesatto** per lo stesso motivo; il nuovo testo è in `TESTO_BANNER_COOKIE`. **Decisione: approvare il testo.**
6. **Tutte le scelte già salvate decadono.** Il testo del banner cambia, quindi la scelta di chi ha già accettato o rifiutato non vale più: si cancella e **il banner riappare a tutti, una volta**. Chi aveva accettato smette di essere misurato in Analytics finché non riaccetta (calo temporaneo dei numeri) e i suoi vecchi cookie di Google vengono tolti. È voluto: un consenso dato al testo di prima non è un consenso a questo.
7. **L'informativa privacy di omnia-ai.it (v1) non nomina Google, Analytics né Ads** e non parla della richiesta di demo: la v2 li aggiunge (finalità, basi giuridiche, destinatari, trasferimenti, conservazione, gestione del consenso). **Da far rivedere all'avvocato** insieme alle Condizioni: la privacy policy in vigore è anche quella che gli abbonati accettano al checkout (dopo la 0100 il checkout registrerà la v2).
8. **Dopo «Accetta» Analytics riceve l'indirizzo completo** (con `gclid`, `utm_*` e ogni altro parametro; solo i valori che sembrano un'email sono oscurati da Google). Per l'area riservata l'indirizzo contiene l'identificativo della gara. Non è un comportamento nuovo (prima si caricava Analytics dopo «Accetta» con gli stessi dati), ma ora è dichiarato. **Decisione: lasciare così o ridurre l'indirizzo anche dopo il consenso (a costo di perdere `gclid` e `utm_*` in Analytics).**
9. **Personalizzazione pubblicitaria**: `ad_personalization` resta «denied» anche dopo «Accetta» (costante `PERSONALIZZAZIONE_DOPO_ACCETTA` in `src/lib/google-tag.ts`). Confermato dall'utente. Se un domani la si vuole, serve prima un testo che la dichiari.
10. **Misurazione meno completa**: chi non accetta non compare in Analytics (resta spento); Google Ads vede solo il segnale ridotto. Le conversioni delle DEMO continuano ad arrivare ad Ads dalla Data Manager API, che non dipende da questo tag.
11. **Coerenza tra i siti**: e-commerce e sito statico (stesso account Ads) restano in modalità «base»; omnia-ai.it passa ad «avanzata». Le tre cookie policy descrivono comportamenti diversi.
12. **Finestra tra deploy e migrazione 0100**: per pochi minuti, finché non si esegue la 0100, `/cookie-policy` e `/privacy` mostrano ancora la v1 (falsa su Google). Per questo la 0100 va eseguita **subito dopo il deploy** (sezione 7).

## 6. Come verificare

### 6.1 HTML iniziale (senza browser)
```
npx tsx scripts/controlla-html-google-tag.ts https://omnia-ai.it
```
Su cinque pagine controlla: un solo `<script src=…gtag/js?id=G-W551SWPNE4>` nell'`<head>` con `defer`; lo snippet nell'HTML **identico** a quello prodotto dal codice; i quattro consensi «denied» prima di ogni `config`; Analytics spento all'inizio e riacceso solo nel ramo «già accettato»; indirizzo e referrer ridotti; `ad_personalization` «denied» anche nell'aggiornamento; le due destinazioni configurate; nessuna conversione. Oggi (senza il rilascio) fallisce, come previsto. In locale: `… http://localhost:3000 "?__zone=omnia-ai"`.

### 6.2 Tag Assistant (da fare nel tuo browser, con il tuo account Google)
1. Apri `https://tagassistant.google.com` → «Add domain» → `https://omnia-ai.it` (con i cookie e i dati del sito **cancellati**, per provare un nuovo visitatore).
2. **Prima di toccare il banner**, nella scheda **Consent** devi vedere i quattro segnali con stato predefinito «Denied» (impostato dalla pagina) e nessun aggiornamento. Tra i tag: «Google tag» `G-W551SWPNE4` e `AW-18422155730`.
3. Premi «Accetta»: nella scheda Consent compare un **Update** con `ad_storage`, `analytics_storage`, `ad_user_data` «Granted» e `ad_personalization` «Denied».
4. Premi «Preferenze cookie»: Update a «Denied» per tutti.
5. Se la scheda Consent resta vuota, il tag non si è caricato (estensioni di blocco, rete).

### 6.3 Se Google Ads riconosce il tag
Il controllo è automatico e Google non documenta come funzioni né quanto impieghi. Dopo il rilascio:
1. Apri la pagina dell'avviso in Google Ads e usa il pulsante di verifica/«controlla di nuovo» se c'è; l'aggiornamento può richiedere diverse ore (conta **24 ore** prima di concludere qualcosa).
2. In Google Ads, nella sezione degli strumenti di gestione dei dati/tag dell'account, controlla lo stato del tag `AW-18422155730` per `omnia-ai.it` (i nomi dei menu li cambia Google: cerca «tag» nella ricerca dell'interfaccia).
3. In Analytics → Report in tempo reale: **non compaiono** le visite senza consenso (Analytics è spento). Per vedere subito qualcosa, accetta il banner e cerca la visita.
4. **Se l'avviso resta dopo 24-48 ore** con il tag visibile in Tag Assistant e `controlla-html-google-tag.ts` verde, il problema non è più il codice del sito: rivolgersi al supporto di Google Ads con il risultato di Tag Assistant.

Va detto chiaramente: la modalità avanzata è la configurazione che Google descrive come quella in cui il tag si carica all'apertura della pagina, ma **non ho trovato nella documentazione di Google una frase che garantisca la scomparsa di quell'avviso**.

### 6.4 Prova di arrivo da un annuncio (dopo il rilascio)
Con i dati del sito cancellati, apri `https://omnia-ai.it/demo?gclid=PROVA123&utm_source=prova&email=a%40b.it#x` e, negli strumenti per sviluppatori (scheda Rete, filtro `collect`), verifica: **una sola** richiesta, verso `googlesyndication.com/ccm/collect`, con `dl` senza `?…` né `#…`, `gclid=0`, `gcs=G100`, nessuna richiesta a `google-analytics.com`, nessun cookie `_ga*`/`_gcl*` (scheda Applicazione). Poi «Accetta» e controlla che compaiano `_ga` e la richiesta a `google-analytics.com/g/collect`.

## 7. Rilascio (dopo la tua autorizzazione)

Ordine:
1. **Approvazione** dei punti 1, 2, 4, 5, 8 e 9 della sezione 5 e rilettura dei testi da parte dell'avvocato (3, 7). I tre punti tra parentesi quadre dei file `legal/cookie-policy-omnia-ai-v2.md` e `legal/privacy-policy-omnia-ai-v2.md` vanno sciolti **prima**; se un file cambia, vanno ricalcolate le impronte nella migrazione 0100 (un test le confronta).
2. Build e test, poi il tuo «MANDA ONLINE»: merge su master, push, deploy Vercel. Nessuna variabile da cambiare.
3. **Subito dopo il deploy** (minuti, non giorni): esegui la migrazione **0100** nell'editor SQL di Supabase. Fino ad allora le pagine legali mostrano la v1 (punto 12). Controlla che `/cookie-policy` e `/privacy` mostrino «Ultimo aggiornamento: novembre 2026».
4. `controlla-html-google-tag.ts` su produzione, prova di arrivo da annuncio (6.4), Tag Assistant (6.2), controllo di Google Ads (6.3, **24 ore**).
5. Le scelte esistenti sul banner decadono da sole al primo caricamento (punto 6): non serve alcuna azione.

## 8. Come tornare indietro

- **Prima della 0100**: `git revert` del merge. Il tag torna a caricarsi solo dopo «Accetta». I cookie di Google già scritti restano nel browser fino alla scadenza o alla revoca.
- **Dopo la 0100**: **non** annullare l'intero merge: il checkout degli abbonamenti registra la privacy policy in vigore secondo il database (v2) e il registro dei documenti deve continuare a conoscerla. Si ripristinano solo `src/app/site-omnia-ai/layout.tsx` e `src/components/omnia-ai/cookie-consent.tsx` (e il testo del banner) lasciando il registro legale; le v2 restano pubblicate e vanno aggiornate a mano con una v3 che descriva il comportamento tornato indietro.
- Niente nel database o su Vercel dipende dal tag.

## 9. Test

- `scripts/verifica-google-tag-omnia-ai.ts` (nella catena `verifica:livello1`): esegue lo **snippet vero** in un contesto isolato (`node:vm`) con un `localStorage`, un indirizzo e un referrer finti e un «Google finto» che legge la coda dei comandi e dice quali segnali partirebbero (un modello ricavato dalle prove del browser, non Google). Copre: nuovo visitatore, rifiuto, scelta superata (versione diversa o assente), consenso già presente, accettazione, revoca, navigazione, `localStorage` bloccato, valori salvati sporchi, tutte le pagine ammesse e non ammesse, nessuna informazione dell'indirizzo nella coda, cancellazione dei cookie, banner (testo, versione, collegamento), layout, nessun doppione di tag, nessuna conversione, eventi DEMO subordinati al consenso, GCLID e registro dei consensi invariati, guida e testi legali.
- `scripts/controlla-html-google-tag.ts`: l'HTML iniziale vero (6.1).
- `scripts/verifica-legale-omnia-ai.ts`: registro dei documenti v2, impronte della 0100, pagine legali.
- Prove nel browser reale (sezione 4): nuovo visitatore da annuncio, pagina non ammessa, navigazione interna, accettazione, revoca, scelta con testo precedente, rifiuto.
- Mutazioni (non nel repository): ogni regola è stata «rotta» a mano una alla volta per verificare che un test fallisse.
