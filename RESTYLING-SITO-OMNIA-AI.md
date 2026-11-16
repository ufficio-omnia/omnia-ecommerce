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
- La batteria completa `verifica:livello1` non è stata lanciata intera da qui: un filtro di sicurezza blocca l'esecuzione di uno script che contiene l'indirizzo email dell'account. Lanciati e superati gli script del sito (vedi il messaggio di chiusura).
