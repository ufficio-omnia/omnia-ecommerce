# OMNIA AI — Demo prenotate: tracciamento e misura del costo per demo

Guida operativa, aggiornata il 04/11/2026 dopo le otto migliorie richieste sulla prima versione. Descrive cosa è stato realizzato, cosa serve per
accenderlo, cosa NON è ancora attivo e quali problemi restano aperti.
**Nulla di quanto segue è in produzione finché non lo dici tu** (flusso solito: prove in locale → «MANDA ONLINE» → migrazione → variabili → prova guidata).
Lavoro in locale sul ramo `feature/demo-tracciamento`: non pubblicato, nessuna importazione reale in Google Ads, tracciamento Analytics esistente non toccato.

## 0. Cosa è cambiato con le otto migliorie

| # | Richiesta | Cosa è stato fatto |
|---|---|---|
| 1 | Se Supabase non salva il lead, non proseguire in silenzio al calendario | A sistema attivo (`DEMO_LEADS_ATTIVO=1`) un salvataggio fallito dà un **errore recuperabile**: il calendario NON si apre, la scheda si chiude, i dati restano nel modulo e si può riprovare (la chiave di idempotenza evita doppioni). All'ufficio arriva comunque un'email «Richiesta demo NON registrata» con i dati, per ricontattare la persona. Prima dell'attivazione il modulo funziona come sempre. |
| 2 | Separare contatto e prenotazione; più richieste senza sovrascrivere lo storico; identificativi unici | **Tre identificativi distinti** (sezione 2): contatto, richiesta, prenotazione. Ogni invio è una riga nuova (nessuna sovrascrittura). L'identificativo di transazione delle conversioni è `omnia-demo-<id della richiesta>`: una conversione per richiesta. |
| 3 | Consensi verificabili | **Registro dei consensi** che si aggiunge soltanto, con versione e impronta del testo mostrato, versione dell'informativa, fonte e firma HMAC (sezione 4). GA4 e Google Ads leggono il consenso da lì, non dalle colonne riassuntive. |
| 4 | Conferma, annullamento, riprogrammazione su Calendar; nessuna conversione se l'abbinamento non è univoco | Gestiti conferma, annullamento, rifiuto dell'invito, spostamento, annullata-e-rifatta (sezione 6). Abbinamento non univoco = caso da verificare, nessuna conversione. |
| 5 | Limiti reali di Vercel per i cron (anche ogni 10 minuti) | Verificati (sezione 7). Aggiunto un **blocco** contro le esecuzioni in parallelo. |
| 6 | Sezione DEMO nella console | Pagina **«DEMO e Google Ads»** (sezione 9), sola lettura. |
| 7 | Identificativi e formato della Data Manager API | Riverificati sulla documentazione (sezione 8). Conversioni reali ancora spente. |
| 8 | Build, test, regressioni, problemi aperti | Sezioni 12 e 13. |

## 1. Il flusso, in breve

1. Il visitatore clicca un pulsante «Richiedi la demo» (o la voce «Demo» del menu) e arriva su `omnia-ai.it/demo`.
2. Compila il modulo (nome e cognome, nome azienda, email aziendale, telefono, settore), spunta la presa visione dell'informativa privacy
   e, se vuole, il consenso facoltativo alla misurazione pubblicitaria. Preme **CONTINUA E PRENOTA LA DEMO**.
3. Browser e server validano i dati (stessa funzione). Il server controlla la versione dei testi dei consensi, il campo trappola, l'anti-bot
   (Turnstile), i limiti di richieste (per indirizzo e per email), poi **salva contatto, richiesta `pending` e registro dei consensi su Supabase**
   e manda l'email di avviso all'ufficio.
4. Si apre il **calendario Google** (scheda aperta subito nel clic: nessun blocco dei popup) dove il visitatore sceglie giorno e ora.
   **In questo momento non è registrata nessuna conversione.** Se il salvataggio è fallito (sistema attivo) il calendario non si apre.
5. Ogni 10 minuti il cron `/api/cron/omnia-ai-demo-sync` (un solo giro alla volta, sotto un blocco) legge il calendario (sola lettura), trova le
   prenotazioni, le abbina alla richiesta **per email normalizzata** e porta la richiesta a `confirmed`.
6. Solo per le richieste confermate e abbinate con certezza, e con i consensi verificati: evento GA4 `demo_booking_confirmed` (lato server) e
   conversione Google Ads «OMNIA AI - DEMO prenotata» (Data Manager API). Se l'abbinamento è incerto: caso in `demo_calendar_casi` per la verifica a
   mano e **nessuna conversione**.

Eventi GA4: `demo_booking_start` (primo campo toccato, secondario), `demo_lead_submitted` (modulo inviato con successo, secondario),
`demo_booking_confirmed` (prenotazione verificata, **principale**, lato server). I primi due partono dal browser SOLO se il tag Google è già stato
caricato dal banner dei cookie (cioè con consenso).

## 2. Contatto, richiesta, prenotazione: i tre identificativi

| Tabella | Cos'è | Chiave |
|---|---|---|
| `demo_contatti` | La **persona** | Un contatto per email normalizzata (maiuscole e spazi ignorati). Tiene gli ultimi dati scritti. |
| `demo_leads` | La **richiesta**: ogni invio del modulo è una riga nuova, mai sovrascritta (lo storico di ciò che la persona ha scritto resta) | `id` proprio + `idempotency_key` (un invio ripetuto non crea doppioni). L'`id` è la base dell'identificativo di transazione delle conversioni. |
| `demo_prenotazioni` | La **prenotazione**: un evento del calendario | `calendar_id` + `calendar_event_id` unici. Una richiesta può avere più prenotazioni (annullata e rifatta, spostata); conta **una sola conversione** per richiesta. |
| `demo_consensi` | Il registro dei consensi (sezione 4) | Più righe per richiesta; vale l'ultima per tipo. |
| `demo_calendar_casi` | Prenotazioni non abbinabili con certezza | Un caso per evento. |
| `demo_sync_stato` | Il `syncToken` di Google e il blocco del cron | Una sola riga. |

- **Stesso invio ripetuto** (doppio clic, nuovo tentativo dopo una risposta persa): stessa chiave → nessuna richiesta nuova, si restituisce quella già registrata.
  Se la persona corregge l'email e riprova, non è lo stesso invio: nasce una richiesta nuova.
- **Più richieste della stessa persona**: ognuna è una riga. Se poi prenota, la prenotazione va alla più recente (entro 24 ore dalle altre); le precedenti
  senza prenotazione diventano `superseded` (restano nello storico, mai convertite). Oltre le 24 ore, o con `DEMO_MULTI_RICHIESTA=manuale`: caso da verificare.
- **Una richiesta, più prenotazioni**: la conversione porta l'ora della **prima** prenotazione e un identificativo solo; se la demo viene annullata e
  riprenotata dopo l'invio non parte una seconda conversione.
- Nessun IP in chiaro: solo un hash con segreto (anti-abuso).

## 3. Cosa è implementato e cosa no

| Parte | Stato |
|---|---|
| Modulo `/demo`, validazione, anti-bot, campo trappola, limiti, idempotenza, salvataggio, errore recuperabile | **Implementato e provato** (test automatici) |
| Registro dei consensi firmato e versionato | **Implementato e provato** |
| Cattura di gclid/gbraid/wbraid/utm con consenso, conservazione 90 giorni, cancellazione se il consenso cade | **Implementato e provato** |
| Migrazione `0098_demo_leads.sql` (sei tabelle, RLS senza policy, permessi, indici unici, trigger, funzione di cancellazione) | **Scritta, NON eseguita** (la esegui tu) |
| Sincronizzazione Google Calendar (sola lettura, syncToken, 410, idempotente, annullamenti, rifiuti, spostamenti, blocco) | **Implementata e provata con calendario finto**; **spenta** finché non metti credenziali e flag |
| Evento GA4 `demo_booking_confirmed` lato server | **Implementato e provato con GA4 finto**; **spento** |
| Conversione Google Ads (Data Manager API) con retry, riconciliazione e deduplicazione | **Implementata e provata con Google finto**; **spenta**; anche accesa parte in **«solo verifica»** (`validateOnly`) |
| Conservazione/cancellazione (cron giornaliero) | **Implementata e provata** |
| Sezione «DEMO e Google Ads» in console | **Implementata e provata** (sola lettura) |
| Provato con Google VERO (calendario, GA4, Ads) | **NO**: servono le tue credenziali e una prenotazione di prova (sezione 10) |
| Informativa privacy v2 e cookie policy aggiornate | **Non fatta di proposito**: bozza nella sezione 11, da far vedere all'avvocato |

## 4. Registro dei consensi (verificabile)

Per ogni invio del modulo si scrivono **tre righe** in `demo_consensi` (anche il «no», che dimostra che la scelta è stata offerta):

| Tipo | Chi lo dà | Note |
|---|---|---|
| `informativa_privacy` | il modulo (spunta obbligatoria) | senza, non si arriva al salvataggio |
| `misurazione_pubblicitaria` | il modulo (spunta facoltativa) | serve per mandare a Google l'email cifrata |
| `cookie_pubblicitari` | il banner dei cookie, **dichiarato dal browser** | il server non può verificare il banner: la riga è marcata `dichiarato_dal_browser` |

Ogni riga porta: la **versione del testo** mostrato e la sua **impronta SHA-256** (i testi stanno in un file solo, `src/lib/demo-consensi-calcoli.ts`: il
modulo li mostra e il server ne calcola l'impronta dalla stessa fonte), la **versione dell'informativa privacy** (oggi la «1»), la fonte, un hash
dell'indirizzo e una **firma HMAC-SHA256** calcolata dal server con un segreto. Il registro **si aggiunge soltanto**: un trigger del database vieta
l'UPDATE; revocare un consenso significa scrivere una riga nuova «denied». Il consenso valido è l'ultima riga per tipo.

- GA4 e Google Ads **non partono** se la riga non è verificabile: firma che non torna (riga alterata a mano), riga non firmata, segreto non configurato,
  consenso revocato dopo la prenotazione, informativa mancante.
- Se il testo dei consensi cambia mentre qualcuno ha la pagina aperta, il server lo rifiuta e chiede di **ricaricare la pagina**: non registra un
  consenso che non saprebbe dimostrare. Quando cambi il testo, cambia anche `VERSIONE_CONSENSI_DEMO`.
- `DEMO_CONSENT_SIGNING_SECRET`: segreto dedicato per la firma (se manca si usano `DEMO_LEADS_HASH_SECRET` e poi `CRON_SECRET`). **Non cambiarlo dopo l'attivazione**:
  le firme già scritte non tornerebbero più e quei consensi non varrebbero. Conservane una copia.
- **Revoca**: oggi non c'è un pulsante per il visitatore. Se qualcuno chiede di ritirare il consenso: scrivi una riga «denied» (funzione `registraRevoca`, oppure
  cancella la persona con `demo_cancella_dati_email`, sezione 5).
- Resta da fare con l'avvocato: informativa privacy v2 e cookie policy (sezione 11). Il registro conserva il riferimento alla v1 oggi in vigore.

## 5. Migrazione Supabase

File: `supabase/migrations/0098_demo_leads.sql` (numero scelto per non collidere con la 0096 e la 0097 del lavoro sul piano di lavoro Excel).
Si esegue incollandola nell'editor SQL di Supabase; è additiva e si può rieseguire. Crea le sei tabelle della sezione 2, il trigger che
vieta di modificare i consensi e la funzione di cancellazione.

Sicurezza: RLS attiva e **nessuna policy**, permessi tolti a `anon` e `authenticated`, dati solo a `service_role` (il server). Il browser non
legge né scrive mai.

**Cancellazione su richiesta dell'interessato**: `select public.demo_cancella_dati_email('mario.rossi@esempio.it');` (email in minuscolo) toglie contatto,
richieste, prenotazioni, consensi e casi di quella persona.

**Conservazione** (cron giornaliero): richieste senza prenotazione (`pending`, `superseded`) 90 giorni; richieste confermate o annullate 24 mesi; casi da
verificare 12 mesi (6 se risolti); un contatto senza più richieste si cancella. Prenotazioni e consensi seguono la richiesta.

**Ordine giusto per accendere** (sezione 10): 1) deploy del codice (con `DEMO_LEADS_ATTIVO` spento tutto funziona come prima); 2) esegui la migrazione;
3) imposta `DEMO_LEADS_ATTIVO=1`; 4) prova una richiesta. **Non accendere `DEMO_LEADS_ATTIVO` prima della migrazione**: ogni richiesta darebbe l'errore recuperabile.

## 6. Prenotazioni su Google Calendar: cosa succede e cosa fa il codice

Letto sulla documentazione ufficiale (Calendar API: `events.list`, sincronizzazione incrementale, programmazione appuntamenti) il 04/11/2026.

- Un evento di prenotazione **non ha un tipo suo né un campo «chi ha prenotato»**: chi prenota compare solo tra i partecipanti. Le demo si riconoscono dal
  **titolo** (`DEMO_CALENDAR_TITLE_REGEX`) e la persona dall'**email**. Nell'evento non c'è l'id della richiesta e non lo si inventa.
- **Conferma**: nuovo evento → prenotazione registrata, richiesta `confirmed`, conversione `ready` (se i consensi lo permettono).
- **Annullamento**: l'evento sparisce o ha `status: cancelled`, e può arrivare con **pochissimi campi** (solo id e stato): basta l'id per annullare la prenotazione nota.
  La richiesta torna `cancelled` solo se non ha altre prenotazioni valide; la conversione passa a `skipped_cancelled`. Se la conversione era già stata inviata, non si ritira da qui.
- **Rifiuto dell'invito** (chi ha prenotato risponde «no»): l'evento resta ma l'invitato risulta `declined`; per Google equivale ad annullare, e così lo si tratta (solo se
  rifiutano **tutti** gli invitati esterni).
- **Spostamento**: Google non descrive con certezza uno spostamento fatto dall'invitato sulla programmazione nativa. Sono gestiti i due casi possibili: stesso evento con
  inizio diverso → si aggiorna l'orario (si conservano l'orario originale e il momento dello spostamento); evento annullato e nuovo evento → la seconda prenotazione si lega
  alla stessa richiesta, **senza una seconda conversione**. Nello stesso giro le cancellazioni si elaborano per prime.
- **Limite noto**: se la prenotazione nuova arriva MENTRE la vecchia è ancora valida (la cancellazione arriva in un giro successivo) il codice non sceglie: la nuova va tra
  i casi da verificare (`prenotazione_duplicata`) e non conta come seconda conversione. È la scelta prudente.
- **Abbinamento non univoco**: più richieste possibili della stessa persona oltre le 24 ore, due persone diverse invitate con una richiesta ciascuna, nessuna richiesta, prenotazione
  fuori dalla finestra → **caso da verificare, nessuna conversione**.
- Sincronizzazione incrementale: `syncToken` (non si può combinare con `timeMin`); se Google risponde 410 si rifà una lettura completa. Il token avanza solo se **tutti** gli eventi
  sono stati elaborati.
- Un'elaborazione interrotta a metà (prenotazione salvata, richiesta non aggiornata) si **completa** al giro dopo, senza doppioni.
- I casi aperti **si riesaminano da soli una volta all'ora** (vedi 6.1): se nel frattempo è arrivata la richiesta giusta o è migliorata una regola, il caso si risolve senza doppioni. Quelli che restano incerti li vedi nella console e li chiudi a mano.

### 6.1 Chi ha prenotato: l'identificazione del prenotante (correzione del 05/11/2026)

**Cosa è successo nel test reale.** Una persona ha compilato il modulo e ha prenotato 22 secondi dopo; la console ha segnalato «Più richieste possibili» con un account interno nel caso. Dal database: la stessa persona
aveva anche una richiesta del giorno prima, già annullata (a 26 ore di distanza); per le regole di allora una richiesta annullata restava candidata e, oltre le 24 ore, la coppia era ambigua. L'account interno compariva nel caso solo perché il
caso riportava il **primo partecipante esterno** e l'account della squadra non era tra le email interne dichiarate: non aveva richieste dal modulo, quindi non causava l'ambiguità, ma il caso mostrava l'email sbagliata.

**Le regole di adesso** (`src/lib/demo-calendario-calcoli.ts`):
- **Prima si tolgono gli account interni**: il calendario stesso, l'organizzatore, le risorse, le email della squadra (`DEMO_CALENDAR_INTERNAL_EMAILS`) e i **domini interni** (`DEMO_CALENDAR_INTERNAL_DOMAINS`, predefinito `omniaitalia.com`, anche i sottodomini).
  I domini di posta **pubblici** (gmail.com, outlook.com, libero.it, pec.it…) non possono mai essere dichiarati interni: escluderebbero i clienti che li usano. Solo tra gli esterni rimasti si cerca chi ha una richiesta dal modulo.
- **Non si assume mai che il primo partecipante esterno sia il cliente**, né che lo sia il creatore dell'evento. Il prenotante è chi ha una richiesta dal modulo; se **persone diverse** hanno una richiesta per lo stesso evento, l'abbinamento non è certo: caso da verificare, **nessuna conversione**.
- **La stessa persona con più richieste**: una richiesta annullata di un percorso precedente non confonde un percorso nuovo. Se c'è una richiesta ancora senza prenotazione **creata dopo l'ultima annullata**, la nuova prenotazione è di quella e le annullate restano com'erano.
  Se invece l'annullata è la più recente, non è certo a quale appartenga: caso. Se per l'annullata la **conversione era già partita**, la nuova prenotazione della stessa persona va a verifica manuale (niente seconda conversione per lo stesso cliente).
  Senza richieste nuove, la prenotazione riprende l'ultima annullata. Richieste dello stesso percorso (entro 24 ore) e modalità `manuale` come prima.
- **Il caso riporta l'email del candidato** (la persona con la richiesta più recente) e una nota che dice perché non è certo: «richieste di N persone diverse», «più di 24 ore l'una dall'altra», «annullata più recente»…

**Recupero dei casi già aperti, senza doppioni.** La sincronizzazione legge solo le novità: un caso non verrebbe più rivisto. Ora, **una volta all'ora** (il giro del cron che cade nei primi dieci minuti), si rileggono per id (sola lettura) fino a 10 casi aperti degli ultimi 30 giorni e si rielaborano con le regole di adesso.
L'operazione è idempotente: la prenotazione ha un indice unico per evento, quindi non nascono doppioni; se il caso si risolve la richiesta passa a «confermata» e il caso si chiude; se resta incerto si aggiorna; un evento che non si trova più o un guasto contano come errore del riesame senza fermare la lettura delle novità.
Il caso del test del 05/11 si risolve così da solo al primo riesame dopo la pubblicazione, senza modificare a mano nessuna richiesta.

**Diagnosi degli eventi** (console → DEMO e Google Ads → «Diagnosi degli eventi dei casi aperti», solo admin, sola lettura): legge gli eventi dei casi aperti e mostra, **senza nessuna email, nome, titolo o id**, chi sono organizzatore e creatore (interni o esterni), gli ospiti come «ospite 1», «ospite 2» con ruolo e risposta,
quante richieste dal modulo ha ciascuno, quali richieste sono candidate (stato e minuti prima dell'evento), i **nomi** dei campi presenti nell'evento e l'esito con le regole di adesso. Serve a vedere com'è fatta davvero una prenotazione della Programmazione appuntamenti e a scoprire eventuali indizi affidabili di chi ha prenotato
senza assumerli. Stesse protezioni del pulsante di Google Ads: una alla volta, un minuto di pausa, dieci all'ora per istanza.

## 7. Cron di Vercel: limiti verificati

Letto sulla documentazione Vercel (cron jobs, usage and pricing) il 04/11/2026; **ricontrollare in dashboard prima dell'accensione**.

- **Frequenza**: sul piano Hobby i cron girano **al massimo una volta al giorno** (e con precisione oraria); un'espressione più frequente fa fallire il deploy. Ogni 10 minuti
  richiede il **piano Pro**. Questo progetto ha già in produzione il cron `omnia-ai-email-retry` ogni 15 minuti: quindi il piano è un Pro e anche `*/10 * * * *` è ammesso
  (Pro: fino a un'esecuzione al minuto, 100 cron per progetto). Se un giorno si tornasse a Hobby, i cron frequenti e il deploy si romperebbero tutti insieme.
- **Precisione**: i cron sono «best effort». Una chiamata può arrivare in ritardo, **saltare** o **essere consegnata due volte**; Vercel **non ripete** una chiamata fallita.
- Come ci siamo difesi: sincronizzazione **idempotente** (rielaborare non cambia nulla), un **blocco** (`demo_sync_stato.lock_until`, 5 minuti, scrittura condizionata) per cui due giri
  non si sovrappongono (se un giro trova il blocco, esce senza fare nulla), nessun invio doppio a GA4 (che non deduplica), un giro mancato viene recuperato dal successivo.
- Autenticazione: Vercel manda `Authorization: Bearer <CRON_SECRET>`; senza il segreto impostato le route rispondono 401.
- Durata massima del giro: 120 secondi (`maxDuration`).
- Il cron `omnia-ai-demo-purge` gira una volta al giorno alle 03:30.

## 8. Data Manager API (Google Ads): formato verificato

Riverificato sulla documentazione il 04/11/2026 (conversioni offline dei lead). Il codice invia **una richiesta per evento** a `POST https://datamanager.googleapis.com/v1/events:ingest`
e ne legge l'esito con `GET https://datamanager.googleapis.com/v1/requestStatus:retrieve?requestId=...`. Ambito OAuth: `https://www.googleapis.com/auth/datamanager`.

- **Destinazione**: `operatingAccount` (l'account Google Ads proprietario dell'azione), `loginAccount` (da dove si accede) e `productDestinationId` = **ID numerico dell'azione di conversione**;
  tipo di account `GOOGLE_ADS`. L'ID dell'azione non si inventa: lo prendi dall'account (10.4).
- **Evento**: `eventTimestamp` (RFC 3339, UTC), `eventSource: WEB`, `transactionId` (stabile per richiesta), `adIdentifiers` (uno solo tra `gclid`, `gbraid`, `wbraid`), `userData.userIdentifiers[].emailAddress`.
- **Email**: normalizzata (minuscolo; per Gmail senza punti e senza «+suffisso»), poi **SHA-256 in esadecimale**; `encoding: HEX`.
- **Consenso**: `adUserData` e `adPersonalization` (`CONSENT_GRANTED`/`CONSENT_DENIED`) dedotti dal registro dei consensi.
- **Solo verifica**: `validateOnly: true` (predefinito): Google controlla la richiesta e **non registra** la conversione. La modalità reale è `DEMO_ADS_VALIDATE_ONLY=0`.
- **Esito**: una conversione è «acquisita» (`accepted`) solo quando `requestStatus` risponde `SUCCESS`; `PROCESSING` si aspetta; `PARTIAL_SUCCESS` e `FAILED` sono errori.
- L'identificativo di transazione **non è una garanzia assoluta di deduplicazione**: per questo, oltre a usarlo, lo stato nel database impedisce di rimandare ciò che è `sent` o `accepted`.
- Le **conversioni reali restano spente** finché non fai i test autorizzati (sezione 10).

### 8.1 Verifica della Data Manager API in sola validazione (senza registrare conversioni)

Per controllare Google **prima** di accendere la modalità reale c'è una verifica a parte, che manda a Google **quattro richieste con `validateOnly: true` e dati inventati** (email del dominio `.invalid`,
identificativo di clic marcato `TEST_`): **non legge né scrive nessun lead né nessuna tabella** e non registra nessuna conversione. Si lancia in due modi, con la stessa funzione (`src/lib/demo-ads-verifica.ts`):

- **Dalla console** (consigliato: i segreti restano su Vercel e non passano mai da nessuna parte): pagina **DEMO e Google Ads** → riquadro **«Verifica Google Ads (solo validazione)»** → pulsante. **Solo l'amministratore** (il controllo è sul server, non solo nella pagina). Protezioni contro le esecuzioni ripetute, **per istanza del server** (un'altra istanza ha i suoi contatori; contare tra istanze richiederebbe una tabella, che per scelta non si usa): una verifica alla volta, **un minuto di pausa** tra una e l'altra (il pulsante resta spento un minuto), **al massimo 10 all'ora**.
- **Da riga di comando**, con le variabili Google in `.env.local`: `npx tsx --env-file=.env.local scripts/verifica-data-manager.ts`.

Cosa controlla e come si legge l'esito:

| Punto | Come si prova |
|---|---|
| 1. Autenticazione OAuth e ambito | Si chiede il token di accesso col refresh token; si controlla che l'ambito `datamanager` sia nel token. Se fallisce si legge il solo codice di OAuth (es. `invalid_grant` = token scaduto o revocato) e **non parte nessuna richiesta**. |
| 2. Permessi | La richiesta vera non deve dare 401/403 (`UNAUTHENTICATED` / `PERMISSION_DENIED`). |
| 3. Account Google Ads | **Riconosciuto** solo se la richiesta vera è accettata **e** il controllo con un account sbagliato è rifiutato in modo **chiaro** (400/403/404 con `INVALID_ARGUMENT`, `PERMISSION_DENIED`, `NOT_FOUND` o `FAILED_PRECONDITION`). **«Non riconosciuto»** solo se è Google stesso a indicare il campo dell'account che non torna. In ogni altro caso — controllo accettato, rete caduta, quota 429, errore del server 5xx, credenziali 401, rifiuto senza indicare il campo — l'esito è **INCONCLUDENTE** e il punto **non è provato**. |
| 4. Azione di conversione | Come sopra, con un'azione sbagliata: riconosciuta, «non riconosciuta» (se Google indica `productDestinationId`) oppure **INCONCLUDENTE**. |
| 5. Schema | La richiesta vera è accettata; se Google contesta un campo, si riporta il **percorso del campo** (mai il valore). |
| 6. Errori e `requestStatus` | Per ogni richiesta: stato HTTP, codice di Google, motivi, campi. Poi si legge una volta il `requestStatus` della richiesta di validazione e lo si riporta com'è (per una sola validazione può non esistere: non è un errore). |
| 7. Conversioni registrate | Sempre **nessuna**: la funzione che invia **rifiuta** qualunque richiesta senza `validateOnly = true` (anche se in produzione `DEMO_ADS_VALIDATE_ONLY=0`). |

Ci sono anche una richiesta «solo email cifrata» (informativa: dice se Google la accetta, utile solo per `DEMO_ADS_ALLOW_EMAIL_ONLY`) e due **controlli negativi** (azione e account sbagliati) che servono **solo** a verificare come si gestiscono le risposte di Google: distinguono «Google ha validato davvero» da «la validazione non controlla questo punto»; se non sono distinguibili con certezza, l'esito è **inconcludente**.

**Validazione riuscita non è attribuzione pubblicitaria.** Una validazione riuscita dice che Google ha accettato credenziali, account, azione e formato; non registra niente e non collega nessuna conversione a una campagna.
L'attribuzione vera esiste solo con l'invio **reale** di un `gclid` vero arrivato da un annuncio, entro la finestra di conversione: si vedrà in Google Ads → Obiettivi → Conversioni → «OMNIA AI - DEMO prenotata», anche dopo alcune ore.
Nulla in questa verifica può dimostrarla.

Nel risultato non compaiono mai token, refresh token, client secret, email, identificativi di clic: account e azione sono **mascherati** (ultime tre cifre) e dagli errori di Google si leggono solo codici e percorsi dei campi.
**Variabili su Vercel**: una variabile nuova o cambiata vale solo dal **deploy successivo**; il riquadro «Sistema» della pagina DEMO e il rapporto della verifica mostrano quello che il deployment in corso ha davvero (importazione accesa/spenta, modalità, configurazione completa, credenziali presenti).

## 9. Sezione «DEMO e Google Ads» nella console

Voce **«DEMO e Google Ads»** nella barra della console (gruppo «Numeri»), con selettore del periodo. **Sola lettura sui dati**: nessun pulsante invia conversioni o modifica dati; l'unico pulsante è la verifica in sola validazione della sezione 8.1.

- **Tessere**: richieste ricevute (e persone distinte), demo prenotate e tasso di conferma (le richieste `superseded` non contano), in attesa, annullate, casi da verificare, importazioni Ads in errore.
- **Sistema**: registrazione delle richieste, sincronizzazione del calendario (in funzione / ferma da oltre 30 minuti / con errore), GA4, Google Ads (solo verifica / reale): solo sì/no e modalità, **mai un valore segreto**.
- **Google Ads e GA4**: conteggio per stato della conversione su tutte le richieste confermate; eventi GA4 inviati, in attesa, non inviabili.
- **Verifica Google Ads (solo validazione)**: l'unico pulsante della pagina, descritto nella sezione 8.1; non scrive nulla.
- **Casi da verificare**: motivo, email del partecipante, date, e cosa significa. Si chiudono a mano (sezione 10.6, query utili).
- **Diagnosi degli eventi dei casi aperti**: pulsante di sola lettura, descritto nella sezione 6.1.
- **Prenotazioni** del periodo (con spostamenti e annullamenti), **importazioni in errore** (solo il codice di Google), **richieste ricevute**.
- Prima della migrazione la pagina lo dice (`tabella_assente`) invece di dare un errore.

## 10. Passaggi manuali rimasti

### 10.1 Progetto Google Cloud e OAuth
1. console.cloud.google.com → un progetto (o quello che usi già) → «API e servizi» → abilita **Google Calendar API** e **Data Manager API**.
2. «Schermata di consenso OAuth»: tipo **Interno** se hai Google Workspace, altrimenti Esterno e **pubblicalo in produzione**
   (con lo stato «Test» il refresh token scade dopo 7 giorni e la sincronizzazione smette di funzionare).
3. «Credenziali» → crea un ID client OAuth (tipo «Applicazione web», URI di reindirizzamento `https://developers.google.com/oauthplayground`).
   Sono `GOOGLE_OAUTH_CLIENT_ID` e `GOOGLE_OAUTH_CLIENT_SECRET`.
4. Su developers.google.com/oauthplayground: ingranaggio → «Use your own OAuth credentials» → inserisci le tue; seleziona gli ambiti, accedi con
   l'account giusto e scambia il codice: ottieni il refresh token.
   - Calendario: ambito `https://www.googleapis.com/auth/calendar.readonly`, con l'**account proprietario della Programmazione appuntamenti**.
   - Ads: ambito `https://www.googleapis.com/auth/datamanager`, con un utente che ha accesso all'account Google Ads.

### 10.2 Google Calendar
- ID del calendario: Impostazioni del calendario → «Integra il calendario» → ID calendario.
- **Prenotazione di prova obbligatoria**: dopo averla fatta guarda come si chiama l'evento e imposta `DEMO_CALENDAR_TITLE_REGEX` di conseguenza (sezione 6). Prova anche:
  annullare dall'email di conferma, rifiutare l'invito, spostare la prenotazione: guarda cosa compare nella console.

### 10.3 Google Analytics 4
- Amministrazione → Flussi di dati → il flusso web → «Segreti API del Measurement Protocol» → crea → `GA4_API_SECRET`.
- Amministrazione → Eventi: segna `demo_booking_confirmed` come **evento chiave**; `demo_booking_start` e `demo_lead_submitted` restano non chiave.
- **Non importare `demo_booking_confirmed` in Google Ads** come conversione: per Ads c'è la conversione dedicata e importarla due volte la conterebbe due volte.

### 10.4 Azione di conversione in Google Ads
1. Obiettivi → Conversioni → Riepilogo → «+ Nuova azione di conversione» → **Importa** → «Altre origini dati o CRM» → **«Monitora le conversioni dai clic»**
   (nell'API è il tipo `UPLOAD_CLICKS`).
2. Nome: **OMNIA AI - DEMO prenotata**. Categoria: «Lead inviato» o «Prenota appuntamento». Valore: nessuno (o un valore stimato per demo).
   Conteggio: **Uno** (una per clic). Finestra di conversione: 30–90 giorni.
3. L'ID numerico dell'azione compare nell'indirizzo della pagina dell'azione (`ctId=...`): è `GOOGLE_ADS_DEMO_CONVERSION_ACTION_ID`.
4. Lasciala **secondaria** finché le prove non sono finite; poi puoi renderla primaria (influisce sulle offerte automatiche).
5. Il tagging automatico è già attivo (serve per avere il `gclid` negli indirizzi). Facoltativo: «Conversioni avanzate per i lead» in Impostazioni → Raccolta dati.
- **Nota sul tag Google Ads sul sito**: oggi l'ID `AW-18422155730` NON è collegato al sito e il tag `GT-P8RVLQB4` non è nel codice; non è
  necessario per questa integrazione (le conversioni arrivano dal server). Collegarlo cambierebbe il tracciamento esistente: decisione tua.

### 10.5 Variabili d'ambiente (Vercel → Settings → Environment Variables)

Tutte opzionali: senza di esse il modulo funziona come prima e le integrazioni restano spente.

| Variabile | A cosa serve |
|---|---|
| `CRON_SECRET` | Già presente (usata dagli altri cron). Senza, i cron rispondono 401. Fa anche da segreto di riserva per l'hash degli indirizzi e per la firma dei consensi. |
| `DEMO_LEADS_ATTIVO` | **`1` per accendere la registrazione obbligatoria delle richieste**: se il salvataggio fallisce il modulo dà un errore recuperabile e non apre il calendario. Senza (o con altro valore) il modulo funziona come prima e la richiesta arriva per email anche se non si salva. Da accendere DOPO la migrazione. |
| `DEMO_LEADS_HASH_SECRET` | Segreto (una stringa lunga a caso) per l'hash degli indirizzi IP. Se manca si usa `CRON_SECRET`. |
| `DEMO_CONSENT_SIGNING_SECRET` | Segreto dedicato per la firma del registro dei consensi. Se manca si usa `DEMO_LEADS_HASH_SECRET`, poi `CRON_SECRET`. **Non cambiarlo dopo l'attivazione.** |
| `DEMO_MULTI_RICHIESTA` | `manuale` per mandare sempre a verifica manuale le prenotazioni di una persona con più richieste ravvicinate; predefinito (qualsiasi altro valore): vale la più recente entro 24 ore. |
| `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET` | Credenziali OAuth del progetto Google Cloud (stesse per Calendar e Ads). |
| `GOOGLE_CALENDAR_REFRESH_TOKEN` | Refresh token dell'account che possiede il calendario delle demo (ambito `calendar.readonly`). |
| `GOOGLE_CALENDAR_ID` | ID del calendario (per il calendario principale è l'email dell'account). |
| `DEMO_CALENDAR_SYNC_ENABLED` | `1` per accendere la sincronizzazione. |
| `DEMO_CALENDAR_TITLE_REGEX` | Espressione regolare (senza distinzione di maiuscole) che riconosce il titolo degli eventi DEMO. Predefinita: `demo`. Da confermare con una prenotazione di prova. |
| `DEMO_CALENDAR_INTERNAL_EMAILS` | Email della squadra, separate da virgola: non sono mai «chi ha prenotato». |
| `DEMO_CALENDAR_INTERNAL_DOMAINS` | Domini della squadra, separati da virgola (con o senza «@»): ogni indirizzo di quei domini (e dei loro sottodomini) è un account interno e non è mai «chi ha prenotato». Predefinito: `omniaitalia.com`. I domini di posta **pubblici** (gmail.com, outlook.com, libero.it, pec.it…) vengono ignorati: non possono mai essere interni. |
| `DEMO_MATCH_WINDOW_DAYS` | Giorni dopo l'invio del modulo entro cui una prenotazione si abbina a quella richiesta (predefinito 30, da 1 a 365). |
| `DEMO_GA4_MP_ENABLED` | `1` per accendere l'evento GA4 lato server. |
| `GA4_API_SECRET` | Segreto API del Measurement Protocol (10.3). |
| `GA4_MEASUREMENT_ID` | Facoltativa: predefinita `G-W551SWPNE4`. |
| `DEMO_GA4_MP_DEBUG` | `1` per provare: usa il server di validazione di Google e NON segna l'evento come inviato. |
| `DEMO_ADS_IMPORT_ENABLED` | `1` per accendere la conversione Google Ads (parte in «solo verifica»). |
| `DEMO_ADS_VALIDATE_ONLY` | Predefinito «solo verifica» (Google controlla ma non registra). **`0` = modalità reale.** |
| `DEMO_ADS_ALLOW_EMAIL_ONLY` | `1` per inviare anche le richieste senza identificativo di clic (solo email cifrata, richiede il consenso del modulo). Predefinito spento. |
| `GOOGLE_ADS_CUSTOMER_ID` | ID dell'account Google Ads, 10 cifre senza trattini. |
| `GOOGLE_ADS_LOGIN_CUSTOMER_ID` | Facoltativo: account manager da cui si accede, se diverso. |
| `GOOGLE_ADS_DEMO_CONVERSION_ACTION_ID` | ID NUMERICO dell'azione «OMNIA AI - DEMO prenotata» (10.4). Non inventarlo: lo prendi dall'account. |
| `GOOGLE_ADS_REFRESH_TOKEN` | Refresh token con ambito `https://www.googleapis.com/auth/datamanager`, di un utente con accesso all'account Ads. |

Nessuna di queste variabili è esposta al browser (nessuna `NEXT_PUBLIC_`).

### 10.6 Come si prova (in quest'ordine) e come si leggono i risultati

Le chiamate ai cron si fanno a mano con: `curl -H "Authorization: Bearer <CRON_SECRET>" https://app.omniaitalia.com/api/cron/omnia-ai-demo-sync`
(risponde solo con numeri e motivi: `eseguito`, `occupato`, `tutto_spento`…).

1. **Migrazione** 0098 eseguita, poi `DEMO_LEADS_ATTIVO=1`. Compila il modulo su `/demo` (anche in locale con `?__zone=omnia-ai`): in `demo_contatti`, `demo_leads` e `demo_consensi` compaiono le righe (la pagina della console le mostra).
2. **Errore recuperabile**: per vederlo, in un ambiente di prova accendi `DEMO_LEADS_ATTIVO=1` prima della migrazione (o senza le tabelle): il modulo deve mostrare l'errore, non aprire il calendario, e l'ufficio deve ricevere «Richiesta demo NON registrata».
3. **Attribuzione**: apri `omnia-ai.it/?gclid=PROVA_12345678&utm_source=test`, accetta i cookie, poi compila il modulo: `gclid` e `utm_source` sono nella richiesta.
   Senza aver accettato i cookie restano vuoti. (Con un `gclid` finto la conversione vera NON deve essere accesa.)
4. **Calendario**: imposta le variabili del calendario, `DEMO_CALENDAR_SYNC_ENABLED=1`; fai UNA prenotazione di prova dal link del calendario con la stessa email
   del modulo; richiama il cron: la richiesta passa a `confirmed` e la prenotazione compare. Poi provala annullata, rifiutata e spostata. Se qualcosa non torna guarda i casi in console.
5. **GA4**: imposta `GA4_API_SECRET`, `DEMO_GA4_MP_ENABLED=1` e `DEMO_GA4_MP_DEBUG=1` (verifica: nessun evento viene registrato); se `verificati` è 1, togli `DEBUG`.
6. **Google Ads in «solo verifica»**: imposta account, azione, token, `DEMO_ADS_IMPORT_ENABLED=1` (senza toccare `DEMO_ADS_VALIDATE_ONLY`): la richiesta passa a `validated`
   e Google dice se la richiesta è valida senza registrare nulla.
7. **Modalità reale**: solo con un tuo via libera esplicito, `DEMO_ADS_VALIDATE_ONLY=0`: la richiesta passa a `sent` e, dopo l'elaborazione, a `accepted`.

Query utili (editor SQL): stato delle richieste `select booking_status, ads_import_status, count(*) from demo_leads group by 1,2;`
· casi da guardare `select motivo, calendar_event_id, created_at from demo_calendar_casi where risolto = false order by created_at;`
· ultima sincronizzazione `select last_run_at, last_success_at, last_error, lock_until from demo_sync_stato;`
· per chiudere un caso a mano `update demo_calendar_casi set risolto = true where calendar_event_id = '...';`
· consensi di una richiesta `select tipo, valore, registrato_il, versione_testo, fonte from demo_consensi where lead_id = '...' order by registrato_il;`

Stati Google Ads di una richiesta: `not_ready` (non ancora confermata) → `ready` → `validated` (solo verifica) → `sent` → **`accepted`** (solo qui Google ha confermato).
`failed` (errore: si riprova da soli solo se è di rete o di Google; un errore di elaborazione lo guarda una persona), `skipped_no_consent`,
`skipped_no_identifier`, `skipped_cancelled`.

## 11. Regole di prudenza e bozza per l'informativa

**Perché una conversione può NON partire**

- Mai senza prenotazione confermata sul calendario e abbinata con certezza (una sola persona, email uguale, richiesta precedente alla prenotazione
  e non più vecchia della finestra). Più richieste non risolvibili, seconda prenotazione della stessa persona, nessuna richiesta, email assente o malformata: caso a verifica manuale.
- Mai senza consenso **verificabile nel registro**: informativa accettata, cookie pubblicitari accettati (il clic si conserva solo così) e, per l'email cifrata, anche la spunta facoltativa.
- Mai senza identificativo di clic (salvo `DEMO_ADS_ALLOW_EMAIL_ONLY=1` + consenso dell'email).
- Mai due volte: identificativo di transazione stabile per richiesta (`omnia-demo-<id richiesta>`), stato nel database, un solo invio GA4 per richiesta.
- Mai oltre 90 giorni dalla prima prenotazione. Mai nel futuro.
- Una conversione è «acquisita» (`accepted`) solo quando Google risponde `SUCCESS`; `PROCESSING` si aspetta (oltre 48 ore diventa `failed`).
- Una prenotazione cancellata dopo l'invio non può essere ritirata da qui (lo stato resta `accepted`): eventuale rettifica a mano in Google Ads.

**Bozza per informativa privacy e cookie (DA FAR VEDERE ALL'AVVOCATO).** La Privacy policy v1 è dichiarata immutabile: serve una **v2**. Il testo breve del modulo e i consensi
hanno la versione `demo-2026-11-04`; il registro cita l'informativa «1». Punti da coprire: titolare Omnia Consulting SRLS; finalità «gestione della richiesta di demo, prenotazione tramite
Google Calendar, ricontatto» (misure precontrattuali) e «misurazione dell'efficacia delle campagne pubblicitarie» (consenso, facoltativo); dati trattati (nome, azienda, email,
telefono, settore, identificativi di campagna e di Analytics solo con consenso, registro dei consensi con hash dell'indirizzo); destinatari (Google per Calendar, Analytics e Ads;
Supabase; Vercel; Resend); conservazione (richieste senza prenotazione 90 giorni; confermate/annullate 24 mesi; casi 12 mesi); diritti e cancellazione; trasferimenti extra-UE tramite
Google. Cookie policy: citare il salvataggio locale `omnia-ai-attribuzione` (90 giorni, solo con consenso) accanto ai cookie di Analytics. Quando esce la v2: cambia
`VERSIONE_INFORMATIVA_PRIVACY` e `VERSIONE_CONSENSI_DEMO` (un test te lo ricorda se aggiungi `privacy-policy-v2.tsx`).

## 12. Cosa è stato verificato

- `npx tsc --noEmit` ed eslint puliti; **`npm run build` riuscita** (compilazione, TypeScript e tutta la catena `verifica:livello1`, oltre 4.300 controlli in totale); test automatici
  `scripts/verifica-demo-tracciamento-omnia-ai.ts` (circa 300 controlli: modulo, attribuzione, consensi e firme, abbinamento e calendario, conversioni, salvataggio con idempotenza, limiti e
  guasti, sincronizzazione con annullamenti/rifiuti/spostamenti/interruzioni, blocco, GA4, Ads, conservazione, codice, guida) e `scripts/verifica-console-demo.ts` (sezione della console);
  entrambi nella catena `verifica:livello1`, che si esegue a ogni build. Il database finto (`scripts/demo-finto-supabase.ts`) imita i vincoli della migrazione (indici unici, chiavi esterne con
  cascata, controlli sugli stati, divieto di modificare i consensi).
- **Prove di mutazione**: 258 difetti introdotti uno alla volta nel codice (consensi, firme, abbinamento, annullamenti, blocco, limiti, GA4, Ads, migrazione, modulo, console), controllando che un
  test fallisca. 256 scoperti. I 6 sopravvissuti alla prima passata (tra cui: avviso all'ufficio mancante nell'errore recuperabile, calendario aperto anche con un errore, un invio ripetuto
  contato contro il limite) hanno portato a test nuovi e ora sono scoperti. Restano **2 difetti non scopribili perché il codice ha una difesa doppia** (il clic non si invia senza il cookie
  pubblicitario anche se lo stato Ads già lo vieta; il tetto dei tentativi è nel filtro di lettura e nel ciclo: toglierne uno solo non cambia il comportamento; toglierli entrambi viene scoperto).
- **Prova nel browser vero** (server locale, invio email disattivato, Google non caricato, database reale intatto): a sistema attivo con le tabelle assenti il modulo mostra l'errore recuperabile,
  chiude la scheda e **non apre il calendario**; il secondo tentativo riusa la stessa chiave di idempotenza; con la versione dei testi cambiata mostra «Abbiamo aggiornato questa pagina» e il
  pulsante «Ricarica la pagina»; a sistema spento (come prima) apre il calendario con `opener` nullo e mostra la conferma. Senza consenso ai cookie nel modulo non partono attribuzione né
  identificativi di Analytics. Nei log del server nessun dato personale (solo, come prima, il titolo dell'email quando manca la chiave di Resend in locale). **Non provata nel browser** la pagina
  della console (richiede l'accesso admin con link magico): è coperta dai test sul database finto e da un controllo statico sul codice.
- Regressioni: non toccati banner cookie e tracciamento Analytics esistenti, pagamenti Stripe, abbonamenti, autenticazione, generazione delle offerte, `proxy.ts`, `zone.ts`
  (un test lo controlla); il lavoro non salvato sul piano di lavoro Excel nella cartella principale non è stato toccato.

## 13. Problemi ancora aperti

1. **Mai provato con Google vero**: calendario, GA4 e Ads sono provati solo con servizi finti. Prima di accendere serve la prenotazione di prova (10.2) e il titolo reale dell'evento.
2. **Informativa privacy v2 e cookie policy** non scritte (restano all'avvocato). Nel frattempo il registro dichiara l'informativa v1.
3. **Consenso ai cookie dichiarato dal browser**: il server non può verificare il banner; è documentato e marcato nel registro. Un visitatore malevolo potrebbe dichiarare il falso, ma la firma impedisce
   solo l'alterazione successiva, non il falso iniziale.
4. **Nessun pulsante di revoca** per il visitatore e nessuna azione in console per revocare/chiudere casi: si fa dal database (sezioni 4 e 10.6). Possibile sviluppo futuro.
5. **Casi aperti**: si riesaminano da soli una volta all'ora per 30 giorni (sezione 6.1); quelli ancora incerti (persone diverse, conversione già partita per un'annullata) restano da chiudere a mano e la conversione non parte.
6. **Spostamento su una programmazione nativa**: il comportamento esatto di Google non è documentato; gestiti i due casi plausibili, da verificare con una prova reale.
7. **Piano Vercel**: i cron ogni 10 minuti richiedono il Pro; ricontrollare il piano in dashboard.
8. **Se si cambia `DEMO_CONSENT_SIGNING_SECRET`** dopo l'attivazione, i consensi già scritti non valgono più: non cambiarlo.
9. **GA4 server-side**: il Measurement Protocol risponde «2xx» anche a un corpo malformato, non deduplica (si manda una volta sola) e accetta eventi retrodatati fino a 72 ore; l'attribuzione alla
   campagna dipende da `client_id` e `session_id` raccolti col consenso.
10. **Consent Mode**: il banner è binario e carica Google solo dopo «Accetta»; non è stato aggiunto Consent Mode v2 (si sarebbe modificato il tracciamento esistente). Le conversioni da server inviano comunque i segnali di consenso.
11. **Un'altra email per prenotare**: chi prenota con un'email diversa da quella del modulo finisce tra i casi da verificare e non produce conversione (si perde meglio di quanto si attribuisca male).
12. **Limiti anti-abuso**: 5 richieste all'ora per indirizzo e 10 al giorno per email; dietro a reti condivise potrebbero essere troppo bassi o troppo alti: da tarare dopo i primi dati.

## 14. File creati o modificati

Creati: `supabase/migrations/0098_demo_leads.sql`; `src/lib/demo-lead-calcoli.ts`, `demo-calendario-calcoli.ts`, `demo-conversioni-calcoli.ts`, `demo-conservazione-calcoli.ts`,
`demo-consensi-calcoli.ts` (regole pure); `src/lib/demo-hash.ts`, `demo-leads.ts`, `demo-consensi.ts`, `demo-blocco.ts`, `demo-ciclo.ts`, `demo-calendario-sync.ts`, `demo-ga4.ts`,
`demo-ads-data-manager.ts`, `demo-ads-verifica.ts`, `demo-ads-verifica-calcoli.ts`, `google-oauth.ts`, `cron-autorizzato.ts`; `src/lib/console/demo-calcoli.ts`, `src/lib/console/demo.ts`; `src/app/site-console/(app)/demo/page.tsx`,
`src/app/site-console/_componenti/demo-vista.tsx`; `src/app/api/cron/omnia-ai-demo-sync/route.ts`, `src/app/api/cron/omnia-ai-demo-purge/route.ts`;
`src/components/omnia-ai/attribuzione-demo.tsx`; test `scripts/verifica-demo-tracciamento-omnia-ai.ts`, `scripts/verifica-console-demo.ts`, `scripts/demo-finto-supabase.ts`; questa guida.

Modificati: `src/components/omnia-ai/demo-form.tsx` (modulo), `src/app/actions/omnia-ai-demo.ts` (azione `inviaRichiestaDemo`), `src/app/site-omnia-ai/demo/page.tsx` (testo della pagina),
`src/app/site-omnia-ai/layout.tsx` (monta la cattura dell'attribuzione), `src/app/site-console/_componenti/navigazione.ts` (voce DEMO), `vercel.json` (due cron), `package.json`
(test nella catena), `scripts/verifica-demo-calendario-omnia-ai.ts`, `scripts/verifica-antibot-omnia-ai.ts`.

**Non toccati** (verificato dai test): banner cookie e Google Analytics esistenti, pagamenti Stripe, abbonamenti, autenticazione, generazione delle offerte tecniche, `proxy.ts`, `zone.ts`.

## 15. Come spegnere tutto

Togli `DEMO_CALENDAR_SYNC_ENABLED`, `DEMO_GA4_MP_ENABLED`, `DEMO_ADS_IMPORT_ENABLED` (i cron restano ma non fanno nulla). Per tornare al comportamento di prima del salvataggio obbligatorio
togli `DEMO_LEADS_ATTIVO`: il modulo continua a funzionare e la richiesta arriva per email.
