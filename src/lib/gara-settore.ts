// Il SETTORE di una gara (di cosa tratta) e i servizi aggiuntivi che OMNIA AI propone oltre alla relazione tecnica (richiesta dell'utente,
// 09/11/2026). Modulo senza dipendenze di server: lo usano l'analisi dei documenti, la scheda della gara, le azioni del piano di lavoro e,
// per i testi, anche la pagina dei piani. Test: scripts/verifica-servizi-settore-omnia-ai.ts.
//
// Regole:
//   - l'analisi dei documenti dice se la gara è di «pulizie», di «ristorazione_collettiva» o «altro» (nel dubbio «altro»);
//   - pulizie → si propone il piano di lavoro (Excel, 75 € nella singola gara);
//   - ristorazione collettiva → si propone «OMNIA FOOD MENU», che per ora «sta arrivando» (nessun acquisto);
//   - altro → per ora non si propone nulla;
//   - una gara analizzata PRIMA di questa funzione non ha settore (null): si comporta come prima, nessun servizio sparisce; il settore le si
//     assegna alla prossima analisi.

export const SETTORI = ["pulizie", "ristorazione_collettiva", "altro"] as const;
export type Settore = (typeof SETTORI)[number];

export function normalizzaSettore(valore: unknown): Settore | null {
  return typeof valore === "string" && (SETTORI as readonly string[]).includes(valore.trim()) ? (valore.trim() as Settore) : null;
}

// Nello schema dello strumento di estrazione. L'oggetto dell'appalto decide, non i servizi accessori; nel dubbio «altro» (così non si propone
// un servizio sbagliato).
export const PROPRIETA_SETTORE_ESTRAZIONE = {
  settore_gara: {
    type: "string",
    enum: [...SETTORI],
    description:
      "Di cosa tratta la gara, in base all'OGGETTO PRINCIPALE dell'appalto (titolo, oggetto, CPV, capitolato). 'pulizie' = l'oggetto principale è un servizio di pulizia, sanificazione, disinfezione o igiene ambientale di immobili, uffici, scuole, ospedali, sedi o altri ambienti (CPV 909xxxxx), anche con servizi accessori di contorno; NON sono 'pulizie' lo spazzamento stradale, la raccolta dei rifiuti e l'igiene urbana (sono 'altro'). 'ristorazione_collettiva' = l'oggetto principale è un servizio di ristorazione collettiva: mensa, refezione scolastica, universitaria, ospedaliera o aziendale, preparazione e somministrazione di pasti, catering (CPV 55xxxxxx), anche con servizi accessori come la pulizia dei locali cucina. 'altro' = ogni altro oggetto (manutenzione del verde, vigilanza, portierato, trasporti, manutenzione di edifici o impianti, servizi sociali, forniture, lavori, servizi informatici...), oppure oggetto non chiaro, oppure una gara con più servizi in cui nessuno dei due citati è chiaramente quello principale. Decidi dall'oggetto dell'appalto e non da parole isolate (una gara di vigilanza che cita 'pulizia dei locali' è 'altro'). Nel dubbio rispondi 'altro'.",
  },
} as const;

// ───── cosa si propone dentro la gara ─────

// Il piano di lavoro (Excel) è per le gare di pulizia. Si propone anche alle gare non ancora classificate (come prima della funzione); NON alle gare
// che l'analisi ha riconosciuto di altro genere.
export function proponePianoLavoro(settore: Settore | null): boolean {
  return settore === null || settore === "pulizie";
}

// «OMNIA FOOD MENU» si propone (come «sta arrivando») solo alle gare riconosciute di ristorazione collettiva.
export function proponeFoodMenu(settore: Settore | null): boolean {
  return settore === "ristorazione_collettiva";
}

export const MESSAGGIO_PIANO_LAVORO_SOLO_PULIZIE =
  "Il piano di lavoro è disponibile per le gare di servizi di pulizia. Dai documenti di questa gara risulta un altro genere di servizio: se non è così, rianalizza i documenti.";

// ───── OMNIA FOOD MENU: il testo, uno solo per la pagina dei piani e per la scheda della gara ─────

export const FOOD_MENU = {
  nome: "OMNIA FOOD MENU",
  stato: "Sta arrivando",
  titolo: "Dal capitolato ai menu: la ristorazione collettiva in gara",
  testo:
    "OMNIA FOOD MENU genererà, a partire dai documenti di gara, i menu stagionali, i ricettari, le grammature, le tabelle degli allergeni e i piani delle derrate alimentari, nel rispetto dei requisiti del capitolato e con verifiche di conformità ai CAM.",
  punti: [
    { titolo: "Menu e ricettari", dettaglio: "menu stagionali e ricettari" },
    { titolo: "Grammature e allergeni", dettaglio: "grammature e tabelle degli allergeni" },
    { titolo: "Derrate e conformità", dettaglio: "piani delle derrate alimentari, con verifiche di conformità ai CAM" },
  ],
  nota: "Sta arrivando: non è ancora disponibile. Quando lo sarà lo troverai dentro la gara, come gli altri servizi oltre alla relazione tecnica.",
} as const;
