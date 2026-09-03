# OMNIA — Piattaforma e-commerce + OMNIA AI
## Roadmap tecnica di riferimento

---

## Visione

Due pilastri che condividono la stessa base tecnica:

1. **E-commerce documenti** — vendita di facsimile Word/Excel, pagamento singolo (Stripe + bonifico)
2. **OMNIA AI** — assistente per gare d'appalto, in abbonamento con crediti, basato su RAG + API Claude

Entrambi vivono nella stessa "area riservata" cliente, condividono autenticazione, pagamenti Stripe e pannello amministratore.

---

## Perché si parte dalle fondamenta comuni, non dai due pilastri separati

Costruire due prodotti scollegati raddoppierebbe il lavoro (due sistemi di login, due integrazioni Stripe, due pannelli admin). Invece:

- Autenticazione → serve a entrambi
- Stripe (pagamento singolo + abbonamento) → serve a entrambi
- Area riservata cliente → contenitore comune, poi ogni pilastro aggiunge le sue sezioni
- Pannello admin → base comune, poi funzioni specifiche per prodotto e per gare

Quindi la Fase 1 non è "scegliere un pilastro", è costruire il terreno su cui poggeranno entrambi.

---

## Decisione architetturale: dove vive la piattaforma

**Scelta**: sottodominio `app.omniaitalia.com` (nome definitivo da confermare — alternative: `gare.omniaitalia.com`, `area.omniaitalia.com`).

**Perché non nello stesso progetto del sito attuale**: omniaitalia.com è un sito statico (HTML puro) già collegato a Google Ads, modulo di contatto, Search Console — tutto funzionante e testato. La piattaforma userà invece un framework applicativo vero (con backend, autenticazione, database) e ha bisogno di un progetto tecnico separato. Un sottodominio mantiene il sito attuale intoccato e permette alla piattaforma di nascere pulita, senza rischiare di rompere ciò che già funziona.

**Cosa vede l'utente**: nessuna differenza percepita — un pulsante "Accedi all'area riservata" sul sito porta al sottodominio, e la piattaforma ha lo stesso logo/colori/brand, sembra un tutt'uno.

**Passo tecnico da fare quando si arriva al deploy** (non ora, solo appunto per dopo): aggiungere un record DNS su Squarespace per il sottodominio scelto, con la stessa attenzione già avuta in passato a non toccare i record MX di Google Workspace.

---

## Percorso utente: dove vive cosa

**Sul sito attuale — omniaitalia.com (statico, resta come oggi)**
- Pagina "Negozio" / catalogo documenti: titolo, descrizione accattivante, prezzo, anteprima, pulsante "Acquista"
- Pagina "OMNIA AI": spiegazione del prodotto, piani di abbonamento, pulsante "Abbonati"
- Queste pagine sono solo vetrina — nessun login richiesto per guardarle, ottime per SEO e per atterrare il traffico di Google Ads

**Il ponte tecnico**
Il pulsante "Acquista"/"Abbonati" non gestisce il pagamento sul sito statico (che non ha backend): porta l'utente su `app.omniaitalia.com`, dove inizia il vero flusso di checkout Stripe. Per l'utente il passaggio è invisibile — stesso brand, stessa grafica, sembra continuare sullo stesso sito.

**Sul sottodominio — app.omniaitalia.com (progetto nuovo, con backend)**
- Checkout Stripe (pagamento singolo o abbonamento)
- Dopo il pagamento: creazione/attivazione account (email con link di attivazione, come da brief originale)
- Area riservata completa: profilo, documenti acquistati e scaricabili, gare gestite, OMNIA AI, crediti, abbonamento attivo

---

## FASE 0 — Setup account e servizi (prima di scrivere una riga di codice)

Da fare prima di aprire Claude Code:

- [ ] Account **Supabase** (gratuito per iniziare) → progetto creato, prendere nota di `URL` e `anon key`
- [ ] Account **Stripe** → attivare **modalità test** prima di tutto (mai lavorare in produzione durante lo sviluppo), prendere nota delle chiavi test
- [ ] Chiave **API Anthropic** (per Claude) → da console.anthropic.com, tenerla SOLO lato server, mai nel frontend
- [ ] Dominio/hosting per il backend: valutare Vercel o Netlify Functions (diverso dal semplice hosting statico che avete ora) — lo decidiamo insieme in base a cosa scegliamo per il backend

---

## FASE 1 — Fondamenta comuni

**Obiettivo**: un utente può registrarsi, fare login, e un amministratore può vedere la lista utenti. Niente prodotti, niente AI ancora — solo l'ossatura.

Cosa si costruisce:
- Autenticazione (Supabase Auth): registrazione, login, invito via email con link di attivazione (non password auto-generate, come richiesto)
- Schema database base:
  - `users` (profilo, ruolo: cliente/admin)
  - `companies` (dati azienda del cliente — servirà a OMNIA AI più avanti)
  - `orders` (ordini, stato: in attesa / pagato / bonifico in attesa)
  - `products` (catalogo — servirà all'e-commerce)
  - `subscriptions` (piano abbonamento — servirà a OMNIA AI)
  - `credits` (saldo crediti OMNIA AI)
- Integrazione Stripe: Checkout per pagamento singolo + webhook che conferma il pagamento lato server (mai fidarsi solo della pagina "pagamento completato")
- Pannello admin — versione minima: lista utenti, lista ordini

**Come si verifica che la Fase 1 è completa**: un utente di test si registra, riceve l'email di attivazione, imposta la password, fa login, e un admin lo vede nel pannello.

---

## FASE 2A — E-commerce documenti (si aggiunge sopra la Fase 1)

*Nota: le pagine di vendita/catalogo vivono sul sito statico (vedi sezione "Percorso utente" sopra) — qui sotto è la parte che vive nel backend/sottodominio.*

- Catalogo prodotti (titolo, categoria, descrizione, prezzo, file associato) — dati che alimentano sia le pagine vendita sul sito sia il backend
- Storage privato Supabase per i file (mai raggiungibili da URL pubblico)
- Carrello e calcolo prezzo/sconto
- Flusso pagamento carta (Stripe Checkout) → webhook → sblocco download
- Flusso bonifico → stato "in attesa" → comando admin "Segna come pagato" → sblocco download
- Area riservata cliente: storico ordini, documenti acquistati, pulsanti download
- Sistema sconti progressivi per fascia di spesa (soglie configurabili da admin)

---

## FASE 2B — OMNIA AI (si aggiunge sopra la Fase 1, in parallelo alla 2A)

Più complessa, va spezzata a sua volta in sotto-fasi:

**2B.1 — Profilo azienda permanente**
Form strutturato dove il cliente inserisce i dati che l'AI userà sempre (certificazioni, organico, referenze, ecc.)

**2B.2 — Gestione gara: caricamento documenti**
Il cliente crea una "gara", carica bando/disciplinare/capitolato in una stanza di lavoro dedicata. Storage privato, un cliente vede solo le proprie gare.

**2B.3 — Estrazione automatica**
L'AI legge i documenti caricati ed estrae scadenza, importo, criteri di valutazione, requisiti — prima funzione "intelligente" da testare, isolata dal resto.

**2B.4 — Sistema RAG**
Prima di rispondere a qualsiasi domanda, il sistema recupera solo le sezioni pertinenti dai documenti (non manda mai tutto il bando al modello) — è il pezzo tecnicamente più delicato, va costruito e testato con calma.

**2B.5 — Generazione contenuti**
Bozze dei criteri, revisione, esportazione Word — si appoggia su tutto il lavoro delle fasi precedenti.

**2B.6 — Crediti e abbonamento**
Ogni azione (analisi, generazione, revisione) consuma crediti. Piano abbonamento via Stripe, ricarica crediti aggiuntivi, soglie configurabili da admin.

---

## FASE 3 — Rifinitura e servizi professionali

- Collegamento "Richiedi revisione professionale" / "Richiedi progettazione completa" dall'interno di OMNIA AI verso i servizi umani (i vostri servizi di consulenza da 1.500€) — qui la piattaforma diventa anche generatore di lead per il core business
- Pannello admin completo: coupon, statistiche, ricavi, gestione fatture
- GDPR: informativa dedicata, cancellazione/esportazione dati, log accessi

---

## Ordine di lavoro consigliato, sessione per sessione

Dato che parti da zero con Claude Code, il primo obiettivo realistico non è "tutta la Fase 1", ma un pezzo alla volta:

1. Setup progetto + connessione a Supabase (verificare che il progetto "parla" col database)
2. Autenticazione: registrazione + login funzionante
3. Schema database base (le tabelle elencate in Fase 1)
4. Stripe in modalità test: un pagamento finto che arriva a buon fine
5. Webhook Stripe che aggiorna lo stato ordine
6. Pannello admin minimo

Da lì in poi, le Fasi 2A e 2B possono procedere davvero in parallelo, session per session, perché la base è la stessa.

---

## Cosa NON fare

- Non mettere mai chiavi segrete (Stripe secret key, API key Anthropic) in codice frontend/JavaScript visibile dal browser
- Non sbloccare mai un download solo perché l'utente è arrivato sulla pagina "pagamento riuscito" — solo il webhook Stripe conferma davvero
- Non costruire il sistema RAG "in generale" — costruirlo e testarlo su una gara reale prima di generalizzare
- Non lanciare in produzione con le chiavi Stripe live finché tutto il flusso non è stato testato più volte in modalità test
