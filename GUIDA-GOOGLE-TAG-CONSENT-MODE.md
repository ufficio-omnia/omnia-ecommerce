# Google tag di omnia-ai.it con Consent Mode v2 avanzato

Preparato il 05/11/2026 sul ramo `feature/google-tag-consent-mode-advanced`. **Non pubblicato.** Il rilascio richiede un «MANDA ONLINE» dopo l'approvazione dei punti di conformità della sezione 5.

## 0. In breve

- **Problema**: Google Ads segnala «Nel tuo sito web manca un tag Google» per `omnia-ai.it`.
- **Causa verificata**: sul sito non c'era nessun tag Google nell'HTML iniziale, e l'ID di Google Ads (`AW-18422155730`) non era configurato (nel banner c'era `GADS_ID = null`). Anche Analytics (`G-W551SWPNE4`) veniva aggiunto solo dal browser dopo «Accetta».
- **Soluzione**: un solo gtag.js nell'`<head>` dell'HTML iniziale, con le due destinazioni (Analytics e Google Ads), e i quattro consensi su «denied» **prima** di ogni configurazione. Il banner esistente aggiorna i consensi (accetta, rifiuta, revoca).
- **Costo in privacy**: in modalità avanzata Google riceve **ping senza cookie anche prima della scelta**. Per questo la cookie policy v1 e il banner attuali diventano inesatti: vanno aggiornati **prima** del rilascio (sezione 5).
- **Limite**: non è documentato come Google Ads decida «manca un tag». Il tag ora è nell'HTML e si comporta come Google raccomanda, ma l'avviso può impiegare tempo (24 ore o più) a sparire o richiedere un passaggio nell'interfaccia di Google Ads (sezione 6).

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
| `src/lib/google-tag.ts` (nuovo) | ID, snippet iniziale, regole del consenso, cancellazione dei cookie alla revoca. Puro, usabile da server e browser. |
| `src/app/site-omnia-ai/layout.tsx` | Nell'`<head>`: snippet inline, poi `<script defer src="…/gtag/js?id=G-W551SWPNE4">`. |
| `src/components/omnia-ai/cookie-consent.tsx` | Tolti i due `<Script>` che caricavano il tag; stesso banner, stessa chiave, stesso testo; aggiunge la comunicazione del consenso a Google. |
| `src/components/omnia-ai/demo-form.tsx` | Gli eventi `demo_booking_start` e `demo_lead_submitted` partono solo con i cookie accettati (prima bastava che il tag esistesse). |
| test | `scripts/verifica-google-tag-omnia-ai.ts` (nella catena), `scripts/controlla-html-google-tag.ts` (controllo dell'HTML, manuale). |
| bozze di testo | `legal/banner-cookie-omnia-ai-BOZZA.md`, `legal/cookie-policy-omnia-ai-v2-BOZZA.md` (non collegate al codice). |

**Non toccati**: raccolta del GCLID (`attribuzione-demo.tsx`), registro dei consensi e testo/versione del banner registrati nelle richieste, Data Manager API (`DEMO_ADS_VALIDATE_ONLY=1`), Google Calendar, GA4 lato server (`DEMO_GA4_MP_DEBUG=1`), Supabase, Stripe, il sito e-commerce, la console, le variabili di Vercel. Nessun evento di conversione di Google Ads è creato: le DEMO confermate vanno ad Ads solo dalla Data Manager API.

### Perché veri tag `<script>` e non `next/script`
`next/script` con `beforeInteractive` non scrive un `<script>` ma accoda lo snippet in una coda interna di Next (`self.__next_s`) e lascia nell'HTML solo un `<link rel="preload">`. Un controllo automatico di Google cerca il tag vero. Il layout usa quindi due `<script>` normali: lo snippet inline (esegue subito) e la libreria con `defer` (esegue dopo che il browser ha letto la pagina, quindi dopo lo snippet). Niente `async` sulla libreria: React lo sposterebbe in testa all'`<head>`, prima dello snippet.

## 3. Come funziona

Ordine dei comandi (verificato nell'HTML e nel browser):

1. `consent default` con `ad_storage`, `analytics_storage`, `ad_user_data`, `ad_personalization` = **denied**;
2. se nel browser c'è già «accettato»: `consent update` subito, prima di ogni configurazione;
3. `set ads_data_redaction true` (con consenso negato gli identificativi di clic vengono oscurati nelle richieste di Google Ads);
4. `js`, poi `config G-W551SWPNE4` e `config AW-18422155730`.

| Scelta | Cosa succede |
|---|---|
| Nuovo visitatore / banner ignorato | tutto «denied»; ping senza cookie (sezione 4); nessun cookie di Google |
| «Accetta» | un solo `consent update`: `ad_storage`, `analytics_storage`, `ad_user_data` = granted; **`ad_personalization` resta denied** (vedi 5, punto 6). Compaiono i cookie `_ga`, `_ga_G-W551SWPNE4`, `_gcl_au` |
| «Rifiuta» | nessun comando a Google (era già «denied»), nessun cookie |
| Revoca («Preferenze cookie») | `consent update` a «denied» subito e **cancellazione dei cookie di Google** (`_ga`, `_ga_…`, `_gid`, `_gcl_*`, `__gads`, `__gpi`…); gli altri cookie (accesso, zona) non si toccano; il banner riappare |
| Pagina successiva senza ricaricare | nessun comando nuovo (il banner è idempotente) |
| Pagina successiva con ricaricamento | il consenso salvato viene riletto: «denied» → «granted» prima dei `config` se aveva accettato |

Il banner nell'effetto legge la scelta **vera** dal browser, non lo stato dell'idratazione (che per il server è sempre «in attesa»): altrimenti chi ha già accettato verrebbe trattato come una revoca a ogni caricamento.

## 4. Cosa viene trasmesso prima del consenso (verificato nel browser)

Prove del 05/11/2026 con il sito in locale (`localhost`), browser reale, ID di produzione. **Due** aperture di pagina senza premere nulla (la prima con una scelta «rifiutato» già presente nel browser, la seconda come nuovo visitatore, con i cookie di Google e la scelta cancellati); tutte le prove successive (accettazione, revoca, rifiuto, navigazione) con le richieste verso Google **bloccate** in locale, quindi non è uscito altro. Vedi anche la nota alla fine di questa sezione.

**Nuovo visitatore su `/demo`, banner in attesa, nessun cookie di Google nel browser:**

| Richiesta | Contenuto |
|---|---|
| `www.googletagmanager.com/gtag/js?id=G-W551SWPNE4` | la libreria (il nostro `<script>`) |
| `www.googletagmanager.com/gtag/js?id=AW-18422155730&cx=c&gtm=…` | la libreria della seconda destinazione, aggiunta **da Google** dopo il `config` (non è un doppione: nell'HTML c'è un solo gtag.js) |
| `region1.google-analytics.com/g/collect` (`en=page_view`) | **ping senza cookie** di Analytics: `gcs=G100` (tutti i consensi negati), `npa=1`, `dma_cps=-`, `pscdl=denied`, `cid` **casuale** (diverso dal client id del cookie `_ga` che il browser aveva già: Google non lo ha letto), `dl` (indirizzo della pagina), `dt` (titolo), `ul` (lingua), `sr`, indicazioni sul browser (`uaa`, `uab`, `uafvl`, `uap`, `uapv`…), `sid`, `_p` |
| `pagead2.googlesyndication.com/ccm/collect` (`en=page_view`) | **ping senza cookie** di Google Ads: `gcs=G100`, `npa=1`, `dl`, `rnd`, `tid=AW-18422155730`; niente `cid` |

Risultato: **nessun cookie di Google scritto** (cookie del browser dopo l'apertura: solo quelli del sito/ambiente di sviluppo); nessun `gclid` in questi ping (la pagina non ne aveva).

**Dopo «Accetta»** (richieste bloccate in locale, solo registrate): un solo `consent update` verso Google; compaiono `_ga`, `_gcl_au`, `_ga_W551SWPNE4`; partono i ping completi con `cid` (`gcs=G111`, `user_engagement`) **e le richieste di remarketing di Google Ads** (`google.com/rmkt/collect/18422155730/`, `pagead/1p-user-list/…`, `doubleclick.net/ccm/s/collect`). Per questo `ad_personalization` resta «denied»: con la personalizzazione attiva il tag di Ads costruisce liste di pubblico, cosa che il banner e la cookie policy attuali non dichiarano.

**Dopo la revoca**: un solo `consent update` a «denied», cookie di Google cancellati, banner di nuovo visibile, nessuna richiesta nuova allo scorrimento. Due ping `scroll` registrati subito dopo il clic portavano ancora `gcs=G111`: erano già in coda quando è stato premuto il pulsante.

**Dopo «Rifiuta»**: nessun comando, nessun cookie, nessuna richiesta.

**Cosa NON è stato provato**:
- ping con un `gclid` nell'indirizzo (arrivo da un annuncio): `dl` contiene l'**indirizzo completo, parametri compresi**; `ads_data_redaction` oscura gli identificativi di clic nelle richieste di **Google Ads**, ma per il ping di **Analytics** non l'ho verificato. Da controllare dopo il rilascio con un clic di prova (sezione 6) o da ridurre (opzione in 5, punto 8);
- ricaricamento con consenso già dato (coperto dai test sullo snippet e dall'ordine dell'HTML, non da una prova con Google);
- in due navigazioni successive senza ricaricare ho visto 2 ping `page_view` (denied) nella prima e nessuno nelle altre: è il comportamento delle «modifiche alla cronologia» di Analytics, già presente oggi per chi ha accettato; non ho chiarito se la prima fosse un doppione;
- Tag Assistant: non ho potuto usarlo (estensione e account Google dell'utente).

**Nota sulla prova**: la pagina di prova ha inviato a Google **due serie di ping senza cookie** (consenso negato, `localhost`) con gli ID di produzione: potrebbero comparire in Analytics come visite dall'host `localhost`. Nessun invio con consenso concesso: dopo il blocco locale non è uscito altro.

## 5. Rischi di conformità privacy che richiedono approvazione prima del rilascio

1. **La cookie policy v1, già pubblicata, diventa falsa.** Dice: «Il tag pubblicitario non viene caricato finché non premi "Accetta". Se scegli "Rifiuta", o se ignori il banner, nessun dato viene inviato a Google.» Con la modalità avanzata il tag si carica subito e Google riceve **ping senza cookie** anche prima della scelta e dopo un rifiuto. La v1 non si modifica mai: serve una **v2** (bozza in `legal/cookie-policy-omnia-ai-v2-BOZZA.md`) pubblicata con lo stesso rilascio. **Decisione: approvare la v2.**
2. **Il banner dice «solo se acconsenti»**, inesatto per lo stesso motivo. Bozza del nuovo testo in `legal/banner-cookie-omnia-ai-BOZZA.md`. Se si cambia il testo, il registro dei consensi delle richieste deve registrare la **nuova versione** (`VERSIONE_BANNER_COOKIE`, `TESTO_BANNER_COOKIE`): oggi è `banner-2026-09`. **Decisione: approvare il testo.**
3. **L'informativa privacy di omnia-ai.it (v1) non nomina Google, Analytics né Ads.** Va completata nella v2 già in attesa dell'avvocato.
4. **La cookie policy v1 era già incompleta**: elenca solo «Google Ads» e non Analytics (`_ga`, `_ga_…`), che si carica dopo «Accetta».
5. **Cosa riceve Google prima del consenso**: orario, indirizzo e titolo della pagina, lingua, tipo di dispositivo e browser, risoluzione, un numero casuale per pagina, stato del consenso (sezione 4). L'indirizzo IP lo vede necessariamente come ogni sito; Google dichiara di troncarlo per i prodotti pubblicitari, mentre per Analytics non è precisato nelle pagine che ho letto. Se questo basti senza consenso, e i trasferimenti extra UE, **sono valutazioni giuridiche che spettano all'avvocato**, non una decisione tecnica.
6. **Personalizzazione pubblicitaria (`ad_personalization`)**: oggi resta «denied» anche dopo «Accetta» (costante `PERSONALIZZAZIONE_DOPO_ACCETTA` in `src/lib/google-tag.ts`). Non è una richiesta esplicita: l'ho scelto perché dopo «Accetta» il tag di Ads avvia richieste di remarketing che il banner non dichiara. Se si vuole attivarla serve prima un testo che la dichiari e poi basta cambiare quel valore. **Decisione: confermare «denied».**
7. **Misurazione meno completa**: chi accetta dopo aver aperto la pagina è già stato contato con un ping senza cookie; Analytics non rimanda il `page_view` all'«Accetta». La campagna di provenienza di **quella prima pagina** può quindi non essere attribuita in Analytics a chi accetta in seguito. L'attribuzione di Google Ads non cambia: GCLID e Data Manager API sono indipendenti da questo tag.
8. **Indirizzo completo nei ping senza cookie** (con `gclid` e parametri `utm_*` se presenti). Mitigazione già attiva per Ads (`ads_data_redaction`); opzione non implementata: togliere i parametri dall'indirizzo inviato a Analytics finché il consenso è negato (a costo di perdere l'attribuzione di campagna di cui al punto 7). **Decisione: lasciare così o ridurre.**
9. **Coerenza tra i siti**: e-commerce e sito statico (stesso account Ads) restano in modalità «base»; omnia-ai.it passa ad «avanzata». Non è un problema tecnico, ma le tre cookie policy descriverebbero comportamenti diversi.

## 6. Come verificare

### 6.1 HTML iniziale (senza browser)
```
npx tsx scripts/controlla-html-google-tag.ts https://omnia-ai.it
```
Su cinque pagine controlla: un solo `<script src=…gtag/js?id=G-W551SWPNE4>` nell'`<head>`, snippet con i quattro consensi «denied» **prima** di ogni `config`, le due destinazioni configurate una volta, nessun evento di conversione. Oggi (senza il rilascio) fallisce, come previsto. In locale: `… http://localhost:3000 "?__zone=omnia-ai"`.

### 6.2 Tag Assistant (da fare nel tuo browser, con il tuo account Google)
1. Apri `https://tagassistant.google.com` → «Add domain» → `https://omnia-ai.it` (con i cookie del sito **cancellati** per provare un nuovo visitatore).
2. **Prima di toccare il banner**, nella scheda **Consent** devi vedere i quattro segnali con stato predefinito «Denied» (impostato dalla pagina, «On-page default») e nessun aggiornamento. Tra i tag: «Google tag» `G-W551SWPNE4` e `AW-18422155730`.
3. Premi «Accetta»: nella scheda Consent compare un **Update** con `ad_storage`, `analytics_storage`, `ad_user_data` «Granted» e `ad_personalization` «Denied».
4. Premi «Preferenze cookie»: Update a «Denied» per tutti.
5. Se la scheda Consent resta vuota, il tag non si è caricato (estensioni di blocco, rete).

### 6.3 Se Google Ads riconosce il tag
Il controllo è automatico e Google non documenta come funzioni né quanto impieghi. Dopo il rilascio:
1. Apri la pagina dell'avviso in Google Ads e usa il pulsante di verifica/«controlla di nuovo» se c'è; l'aggiornamento può richiedere diverse ore (conto **24 ore** prima di concludere qualcosa).
2. In Google Ads, nella sezione degli strumenti di gestione dei dati/tag dell'account, controlla lo stato del tag `AW-18422155730` per `omnia-ai.it` (i nomi esatti dei menu li cambia Google: se non li trovi, cerca «tag» nella ricerca dell'interfaccia).
3. In Analytics → Report in tempo reale: **non è garantito** che una visita senza consenso compaia (i ping senza cookie servono soprattutto ai modelli di Google e non è documentato come li mostri il tempo reale). Per vedere subito qualcosa, accetta il banner e cerca la visita.
4. **Se l'avviso resta dopo 24-48 ore** con il tag visibile in Tag Assistant e `controlla-html-google-tag.ts` verde, il problema non è più il codice del sito: rivolgersi al supporto di Google Ads con il risultato di Tag Assistant.

Va detto chiaramente: la modalità avanzata è la configurazione che Google descrive come quella in cui il tag si carica all'apertura della pagina, ma **non ho trovato nella documentazione di Google una frase che garantisca la scomparsa di quell'avviso**. (Con la modalità «base», che blocca il tag fino al consenso, il tag non sarebbe stato rilevabile da un controllo che non preme il banner.)

## 7. Rilascio (dopo la tua autorizzazione)

Ordine:
1. **Approvazione** dei punti 1, 2, 6 e 8 della sezione 5 (e dell'avvocato per 3-5).
2. Applicazione del **nuovo testo del banner** e della **versione** nel registro dei consensi (vedi `legal/banner-cookie-omnia-ai-BOZZA.md`) e preparazione della **cookie policy v2** con la procedura della v1 (file in `legal/`, componente, voce in `legal_documents`, test legali). Il codice di questo ramo **non include** né il testo nuovo né la v2.
3. Build e test, poi il tuo «MANDA ONLINE» (merge su master, push, deploy Vercel; nessuna migrazione, nessuna variabile).
4. Dopo il deploy: `controlla-html-google-tag.ts` su produzione, Tag Assistant, controllo di Google Ads (6.3). Prova di arrivo da annuncio con `gclid` per vedere cosa contiene il ping di Analytics (sezione 4, «non provato»).

## 8. Come tornare indietro

Il cambiamento è tutto nei tre file della sezione 2 e non scrive nulla nel database né su Vercel: basta ripubblicare il commit precedente (`git revert` del merge). Il tag torna a caricarsi solo dopo «Accetta». I cookie di Google già scritti restano nel browser degli utenti fino alla scadenza o alla loro revoca; nessun dato sul server dipende da questo.

## 9. Test

- `scripts/verifica-google-tag-omnia-ai.ts` (nella catena `verifica:livello1`): esegue lo **snippet vero** in un contesto isolato con un `localStorage` finto e una «Google finta» che legge la coda dei comandi: nuovo visitatore, consenso già presente, accettazione, rifiuto, revoca, navigazione tra pagine, localStorage bloccato, valori salvati sporchi; cancellazione dei cookie; nessun doppione di tag; nessuna conversione; eventi DEMO subordinati al consenso; GCLID e registro dei consensi invariati; guida e bozze.
- `scripts/controlla-html-google-tag.ts`: l'HTML iniziale vero (6.1).
- Prove nel browser reale (sezione 4): nuovo visitatore, accettazione, revoca, rifiuto, navigazione.
