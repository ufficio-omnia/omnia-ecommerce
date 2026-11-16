# Restyling del sito pubblico OMNIA AI — report (16/11/2026)

Branch: `feature/restyling-sito-omnia-ai` (nulla committato, nulla online).
Prova in locale: `npm run dev`, poi `http://localhost:3000/?__zone=omnia-ai`.

## 1. File modificati

| File | Cosa |
|---|---|
| `src/app/site-omnia-ai/page.tsx` | Homepage in 8 sezioni, FAQ corretta, metadata e JSON-LD aggiornati |
| `src/components/omnia-ai/hero-demo.tsx` | Nuova hero (slogan, titolo, sottotitolo), sezione «Scopri cosa genera»; parole animate solo ≥1100 px, ciclo fermo a scheda nascosta |
| `src/components/omnia-ai/anteprima-relazione.tsx` | **Nuovo**: anteprima illustrativa (HTML/CSS) di una pagina della relazione Word |
| `src/components/omnia-ai/site-footer.tsx` | Marchio + slogan + descrizione; aggiunti Come funziona, Piani, Demo, Accedi |
| `src/app/site-omnia-ai/come-funziona/page.tsx` | Prima i vantaggi, poi il percorso tecnico (invariato), chiusura con demo |
| `src/app/site-omnia-ai/piani/piani-vista.tsx` | Riquadro «Come funzionano gare e crediti» (art. 5); nota sui crediti allineata |
| `src/app/site-omnia-ai/demo/page.tsx` | Due passaggi in evidenza (modulo → orario nel calendario); modulo invariato |
| `src/app/site-omnia-ai/contatti/page.tsx` | Tre schede (email, PEC, società) + invito alla demo; riferimenti invariati |
| `src/app/site-omnia-ai/omnia-ai.css` | Stili nuovi, fondo lavanda, ombre leggere, regole mobile |
| `src/components/omnia-ai/schermata-piattaforma.tsx` | **Nuovo**: schermate vere e anonime in cornice, cliccabili a grandezza piena |
| `public/site-omnia-ai/screen-dashboard.webp`, `screen-dati-gara.webp` | **Nuovi**: dashboard e dati estratti di una gara (≈36 KB l'uno) |
| `src/app/sitemap.ts` | `lastModified` 2026-11-16 per home, come-funziona, piani, demo, contatti |
| `scripts/verifica-piano-lavoro-testi-omnia-ai.ts` | Data attesa nella sitemap aggiornata (6/11 → 16/11) |

Non toccati: motore AI, pipeline, autenticazione, Supabase, migrazioni, Stripe, crediti, API, Calendar, lead, consensi, GA4/Ads, Vercel, cron, cookie, `demo-form.tsx`, `site-header.tsx`.
Nessuna nuova lettura dal database: la sintesi dei piani in home legge solo la costante `PIANI` (nomi, gare incluse), i prezzi restano solo su /piani.

## 2. Incongruenze commerciali da approvare

1. **FAQ crediti in home (corretta)** — diceva «ogni operazione consuma crediti in base al lavoro richiesto». L'art. 5 delle Condizioni dice che la gara si consuma all'avvio dell'analisi e che poi generazioni e revisioni sono comprese. Ho riscritto la risposta secondo l'art. 5. Da confermare.
2. **Crediti aggiuntivi su /piani (allineata)** — diceva «restano validi fino all'utilizzo, senza scadenza mensile». L'art. 5 aggiunge che si estinguono con la cessazione dell'abbonamento. Ho aggiunto «finché l'abbonamento è attivo». Da confermare.
3. **«Rispondiamo entro 24 ore» in home** — sostituita con il flusso reale (modulo e poi orario nel calendario), come già fatto sulla pagina /demo. In Contatti resta «24 ore lavorative».
4. **Riservatezza nella FAQ** — diceva «accessibile solo dal tuo account». La pagina Riservatezza prevede l'accesso del personale in quattro casi, con registro. La FAQ ora lo dice.
5. **Non verificati nel codice, da confermare**: «Supporto prioritario» (Professional) e «Revisione umana a condizioni dedicate» (Enterprise). Sono testi già presenti su /piani, non li ho toccati.
6. **Prezzi in home**: non li ho mostrati per non aggiungere letture dal database a ogni visita della home. Se li volete, si possono aggiungere (2 piccole letture per visita, le stesse di /piani).

## 3. Rischi residui

- L'«immagine allegata» citata nel brief non era nel messaggio: la direzione grafica segue il testo del brief.
- L'anteprima della relazione Word resta un disegno illustrativo (dichiarato). Le schermate di dashboard e gara invece sono VERE, scattate il 16/11 dall'account del titolare e rese anonime prima dello scatto: titoli delle gare, enti, nome azienda, email, nomi dei file e importi sostituiti con dati di esempio (importi in scala coerente: 1,25 M€, fatturato 2,5 M€, garanzia 2%); scadenze della dashboard cambiate in «Fra X giorni». Criteri e punteggi sono quelli di una gara vera, ma senza ente né importi non è riconoscibile. Da ricontrollare a occhio prima di andare online.
- Il testo del sottotitolo e i paragrafi sono giustificati come richiesto; su schermi molto stretti la giustificazione può lasciare qualche spazio più largo.
- `verifica:livello1`: in locale 76 script su 77 superati (con VERCEL=1 NODE_ENV=production); lo script della revisione umana è bloccato qui da un filtro di sicurezza (contiene l'email dell'account) ed è stato eseguito dalla build Vercel della Preview (prebuild), riuscita.

## 4. Verifiche finali (16/11/2026)

- TypeScript ed ESLint: nessun errore. Build di produzione locale (VERCEL=1 NODE_ENV=production): riuscita, nessun errore o avviso.
- Preview Vercel del commit a13011d: build riuscita (batteria completa compresa), protetta dall'accesso Vercel. Le Preview servono la zona e-commerce (la zona si decide dal dominio): le pagine di omnia-ai sono state verificate in locale, sia in sviluppo sia con `next start` e Host omnia-ai.it.
- Nessuno scroll orizzontale su 9 pagine pubbliche a 320, 390, 768, 1024 e 1440 px; collegamenti interni tutti 200; un solo H1 per pagina, canonical, JSON-LD valido, sitemap aggiornata, robots invariato.
- Nessuna nuova chiamata al database, polling o richiesta di rete. Peso JS+CSS della home praticamente invariato (+1%); HTML più lungo per i contenuti in più (circa +10 KB compresso); schermate da circa 27 KB servite ottimizzate e caricate solo quando arrivano a schermo.

## 5. Revisione di leggibilità e conversione (16/11/2026, seconda richiesta)

**Fatto**
- Testi del sito pubblico allineati a sinistra e senza sillabazione automatica (solo dentro `.omnia-wrap`: l'area riservata non cambia); centrati solo titoli e introduzioni brevi; testi secondari da peso 300 a 400 e un tono più scuro (`--testo-3`); testi piccoli mai sotto 13 px; aree di tocco più alte nel piè di pagina.
- Home: hero più corta (un paragrafo, percorso «documenti di gara → analisi → offerta Word», settori in vista, demo come azione principale); servizi divisi in «compreso» e «aggiuntivi»; «Perché» ridotto a 4 punti; richiamo alla demo dopo «Come funziona»; «Chi c'è dietro» distingue società, persone e metodo (i dieci anni sono l'esperienza dei professionisti); FAQ senza doppioni.
- Esempi: niente più testo che si scrive da solo; domanda, risposta e fonti subito leggibili, schede consultabili da tastiera, altezza fissa, etichetta «esempio dimostrativo con dati di fantasia».
- Schermate: riconvertite a qualità più alta e servite senza ricompressione; ritagli dei dettagli (scadenze e stato, vincoli, criteri) dalle stesse schermate; indicazione «Ingrandisci»; finestra con ingrandimento a grandezza reale e spostamento col dito, Esc, ritorno del focus, sfondo bloccato.
- Piani: confronto sintetico in tabella (prezzi e sconti dal catalogo), su telefono una voce per riga con i tre valori sotto; «Servizi a parte, in sintesi» con il prezzo del piano Excel subito visibile; accesso API separato come «in programma»; frase sul percorso demo quando la vendita è spenta; chiarito che il menu delle categorie riguarda solo i servizi aggiuntivi.
- Come funziona: percorso pratico in 7 passi (tutti presenti nell'area riservata), distinzione tra informazioni estratte e proposte per l'offerta, approfondimento tecnico richiudibile; tolte «OMNIA AI non indovina» e «mai un'affermazione senza riferimento».
- Demo: introduzione e passaggi compatti, il modulo arriva nella prima schermata del telefono; modulo, consensi, anti-spam, salvataggio, calendario e tracciamenti invariati.

**Da decidere (titolare)**
1. «Servizi dedicati al settore compresi» per Professional/Enterprise (schede del 13/11) contro i testi approvati del piano di lavoro («lo compri dentro la singola gara», abbonamento con piano di lavoro NON offerto): la tabella riporta ciò che dicono le schede. Quale delle due vale?
2. Il piano Excel «senza abbonamento»: il testo approvato lo dice, ma non è chiaro se un visitatore senza account possa davvero comprarlo (serve una gara nell'area riservata).
3. Prezzi pubblici di revisione umana (250-550 € per pagine, +25/+50% urgenza) e crediti (290 € / 1.250 € per 5): sono nel codice ma volutamente non pubblicati; restano non pubblicati.
4. FAQ «Su quali gare funziona davvero?» (solo facility management) contro il testo «la relazione tecnica la genera per ogni gara, di qualunque categoria» del menu delle categorie.
5. Anni della società: il sito ora parla di oltre dieci anni di esperienza dei professionisti, non di età della società. Se la società ha davvero dieci anni, si può dire.

**Asset che servirebbero**
- Foto e breve biografia di chi guida Omnia Consulting e supervisiona OMNIA AI (con consenso).
- Durata, gratuità e modalità della demo (oggi non scritte da nessuna parte, quindi non indicate).
- Schermate a risoluzione più alta (catturate a 1920 px o più) per una nitidezza ancora migliore.

## 6. Rifiniture: acquisto online e piano Excel (16/11/2026, terza richiesta)

- Acquisto autonomo: tolta la frase «gli abbonamenti si attivano dopo un primo contatto»; su /piani, con la vendita visibile, «Puoi acquistare il tuo abbonamento direttamente online. Se preferisci vedere prima la piattaforma, prenota una demo». Nelle schede «Abbonati a <piano>» (percorso esistente /abbonati/[piano], il piano resta nell'indirizzo e arriva al modulo come planSlug; nessuna registrazione preventiva, l'account si crea con il pagamento) come azione principale, «Richiedi la demo» secondaria. In home: «Vuoi partire subito? Confronta piani e prezzi» sotto i pulsanti e nota «la demo è facoltativa» nella sezione piani.
- Piano Excel, regola unica in tabella, schede, «Servizi della gara», menu delle categorie, home e FAQ: compreso con Professional ed Enterprise nelle gare del piano; con Starter e per le gare acquistate con i crediti si compra nella pagina della gara (prezzo dalla console). Non c'è un acquisto senza account: serve una gara nell'area riservata.
- Piani più compatti: schede con destinatario, prezzo, offerta subito sotto, gare incluse e differenze essenziali; caratteristiche comuni solo in tabella; API in un solo punto.
- Demo su telefono: primo campo a circa 490 px (360×740) e 497 px (390×844).
- Esperienza: piè di pagina e Contatti attribuiscono i dieci anni ai professionisti; «OMNIA AI — un prodotto di Omnia Consulting SRLS» resta separato.

**Attenzione operativa**: nel codice il piano di lavoro e la copertina NON si accendono da soli acquistando Professional o Enterprise: servono le impostazioni della console (concessione del piano di lavoro, copertina per account). Chi compra online questi piani va abilitato dalla console.
