// «Genera copertina relazione tecnica» (richiesta dell'utente, 10/11/2026): dentro la gara un pulsante chiede a OpenAI (modello immagini) una
// copertina grafica in formato A4, con il titolo e il CIG della gara e i due loghi (stazione appaltante in alto a sinistra, cliente in basso a
// destra). Questo modulo non ha dipendenze di server: contiene il testo del comando, il formato, le regole e i nomi dei file, così si provano
// senza rete. Le chiamate (OpenAI, storage) stanno in copertina-relazione.ts. Test: scripts/verifica-copertina-relazione.ts.
//
// Il comando è quello scritto dall'utente, parola per parola, con i dati della gara al posto delle parentesi. Dopo il comando ci sono poche
// note tecniche (loghi identici, testi esatti, margini, contesto della gara) che il comando da solo non può dire a un modello che non ha
// letto il disciplinare: restano separate dal comando e si vedono nel prompt, non si mischiano con esso.

import { normalizzaSettore, type Settore } from "@/lib/gara-settore";

// CHI può generare, a che prezzo e quante volte NON si decide qui: stanno nelle impostazioni per cliente della console (copertina-diritto-calcoli.ts).

// ───── Formato ─────
// A4 in verticale: 297/210 = 1,414285… Le dimensioni del modello devono essere multipli di 16 (OpenAI rifiuta le altre: 1680×2376 non va, 2376
// non è divisibile per 16). 1584×2240 (99×16 per 140×16) ha un rapporto di 1,41414, A4 a meno di un decimo di punto percentuale: la pagina esce
// già A4 senza ritagli che taglino testi o loghi. Sono circa 190 punti per pollice su un foglio A4.
export const COPERTINA_LARGHEZZA = 1584;
export const COPERTINA_ALTEZZA = 2240;
export const COPERTINA_DIMENSIONE = `${COPERTINA_LARGHEZZA}x${COPERTINA_ALTEZZA}`;
// Qualità dell'immagine di OpenAI: «medium» è il compromesso (circa 0,08 $); «high» costa di più e dura di più. Si cambia con OPENAI_IMAGE_QUALITY.
export const QUALITA_AMMESSE = ["low", "medium", "high"] as const;
export type QualitaCopertina = (typeof QUALITA_AMMESSE)[number];
export function qualitaCopertina(env: Record<string, string | undefined>): QualitaCopertina {
  const valore = env.OPENAI_IMAGE_QUALITY?.trim().toLowerCase();
  return (QUALITA_AMMESSE as readonly string[]).includes(valore ?? "") ? (valore as QualitaCopertina) : "medium";
}
export const COPERTINA_MODELLO_PREDEFINITO = "gpt-image-2";
// A4 in punti PDF (1/72 di pollice)
export const A4_LARGHEZZA_PT = 595.28;
export const A4_ALTEZZA_PT = 841.89;
export const RAPPORTO_A4 = 297 / 210;

// Quanto il formato generato si discosta dall'A4 (frazione): serve a decidere se la pagina va ritoccata
export function scostamentoDaA4(larghezza: number, altezza: number): number {
  if (!(larghezza > 0) || !(altezza > 0)) return Infinity;
  return Math.abs(altezza / larghezza / RAPPORTO_A4 - 1);
}

// ───── Dati della gara ─────

export const TITOLO_MASSIMO = 300;

// Spazi di troppo e a-capo tolti: il titolo sulla copertina è su una riga logica (è il modello a spezzarlo, se è lungo)
export function pulisciTesto(valore: unknown, massimo: number): string {
  if (typeof valore !== "string") return "";
  return valore.replace(/\s+/g, " ").trim().slice(0, massimo).trim();
}

// Il CIG sono 10 caratteri alfanumerici; l'estrazione li salva già in maiuscolo e senza spazi, qui si ricontrolla perché sulla copertina un
// CIG sbagliato è peggio di nessun CIG: se non ha la forma giusta non si stampa.
export function cigPerCopertina(valore: unknown): string | null {
  if (typeof valore !== "string") return null;
  const cig = valore.replace(/\s+/g, "").toUpperCase();
  return /^[0-9A-Z]{10}$/.test(cig) ? cig : null;
}

// ───── Gli stili ─────
// Il cliente sceglie lo stile dello sfondo (richiesta dell'utente, 10/11/2026): «stilizzato» = illustrazione vettoriale editoriale; «realistico» =
// fotografia. Può generarli entrambi e poi decidere. Lo stile decide la direzione artistica usata, le note sul modo di trattare lo sfondo e il nome del file.
export const STILI = ["stilizzato", "realistico"] as const;
export type Stile = (typeof STILI)[number];

export function normalizzaStile(valore: unknown): Stile | null {
  return typeof valore === "string" && (STILI as readonly string[]).includes(valore.trim()) ? (valore.trim() as Stile) : null;
}

export const ETICHETTA_STILE: Record<Stile, string> = {
  stilizzato: "Stile stilizzato",
  realistico: "Stile realistico",
};

// La direzione artistica dello sfondo, preparata da OpenAI dopo aver letto il disciplinare/capitolato (copertina-lettura.ts): parte da ciò che il
// documento dice davvero (i luoghi, le attività, il territorio dell'ente) per rendere la copertina specifica di QUESTA gara. Una per stile.
export type DirezioneCopertina = {
  tipoServizio: string;
  luoghi: string[];
  territorio: string | null;
  direzioneStilizzata: string;
  direzioneRealistica: string;
};

export type DatiCopertina = {
  titolo: string;
  cig: string | null;
  stile: Stile;
  // il nome serve solo come contesto (tono della copertina): non va scritto sulla pagina
  stazioneAppaltante: string | null;
  settore: Settore | null;
  // senza una lettura del documento (non dovrebbe succedere) lo sfondo ripiega sul motivo del settore
  direzione: DirezioneCopertina | null;
  // quali loghi vengono allegati al modello, nell'ordine in cui compaiono nel prompt
  logoStazione: boolean;
  logoCliente: boolean;
};

export function datiCopertina(grezzi: {
  titolo: unknown;
  cig: unknown;
  stazioneAppaltante: unknown;
  settore: unknown;
  direzione?: DirezioneCopertina | null;
  // senza uno stile valido: stilizzato (quello che c'era prima della scelta)
  stile?: unknown;
  logoStazione: boolean;
  logoCliente: boolean;
}): DatiCopertina {
  return {
    titolo: pulisciTesto(grezzi.titolo, TITOLO_MASSIMO),
    cig: cigPerCopertina(grezzi.cig),
    stile: normalizzaStile(grezzi.stile) ?? "stilizzato",
    stazioneAppaltante: pulisciTesto(grezzi.stazioneAppaltante, 160) || null,
    settore: normalizzaSettore(grezzi.settore),
    direzione: grezzi.direzione ?? null,
    logoStazione: grezzi.logoStazione,
    logoCliente: grezzi.logoCliente,
  };
}

// ───── Il comando ─────

const OGGETTO_PER_SETTORE: Record<Settore, string> = {
  pulizie: "servizi di pulizia, sanificazione e igiene ambientale di edifici e ambienti pubblici",
  ristorazione_collettiva: "ristorazione collettiva (mense, refezione, preparazione e somministrazione di pasti)",
  altro: "",
};

// Il motivo dello sfondo, per genere di servizio: il modello non legge il disciplinare, quindi è l'unico aiuto per rendere la copertina
// «coerente con la gara» oltre al titolo. Sempre astratto (niente persone né oggetti disegnati in modo realistico: sono i dettagli che un
// modello d'immagini sbaglia di più e che in una copertina istituzionale stonano).
const MOTIVO_PER_SETTORE: Record<Settore | "nessuno", string> = {
  pulizie: "motivi astratti che richiamino pulizia, igiene e luminosità (superfici nitide, riflessi, trasparenze, geometrie pulite, toni chiari e freschi)",
  ristorazione_collettiva: "motivi astratti che richiamino la tavola e il cibo sano (forme morbide e organiche, toni caldi e naturali)",
  altro: "motivi astratti neutri e istituzionali",
  nessuno: "motivi astratti neutri e istituzionali",
};

// Lo stesso per lo stile realistico: la scena fotografica per genere di servizio, se manca la lettura del documento
const SCENA_PER_SETTORE: Record<Settore | "nessuno", string> = {
  pulizie: "una fotografia di ambienti puliti e luminosi (corridoio o aula di una scuola, uffici, pavimenti lucidi con riflessi, luce naturale dalle finestre)",
  ristorazione_collettiva: "una fotografia di piatti sani e ben presentati in una mensa o in una cucina professionale, luce calda e naturale",
  altro: "una fotografia istituzionale dell'ambiente in cui si svolge il servizio, luce naturale",
  nessuno: "una fotografia istituzionale dell'ambiente in cui si svolge il servizio, luce naturale",
};

// La riga con il titolo: «[titolo] - CIG: [cig]». Senza un CIG valido resta il solo titolo (mai un CIG inventato né una dicitura vuota).
export function rigaTitolo(dati: Pick<DatiCopertina, "titolo" | "cig">): string {
  return dati.cig ? `${dati.titolo} - CIG: ${dati.cig}` : dati.titolo;
}

// Il comando dell'utente, con i dati della gara al posto delle parentesi. I loghi arrivano al modello come immagini allegate, nell'ordine:
// prima quello della stazione appaltante, poi quello del cliente (se uno manca, quello rimasto è «la prima immagine»). Un logo che non c'è
// NON si chiede: il modello ne inventerebbe uno.
export function comandoCopertina(dati: DatiCopertina): string {
  const ordine: string[] = [];
  if (dati.logoStazione) ordine.push("stazione");
  if (dati.logoCliente) ordine.push("cliente");
  const riferimento = (chi: "stazione" | "cliente") => {
    const posizione = ordine.indexOf(chi);
    return posizione === 0 ? "prima immagine allegata" : "seconda immagine allegata";
  };

  const righe = [
    "CREA COPERTINA GRAFICA CON SFONDO COME IMMAGINE IN A4 COERENTE CON IL Disciplinare/Capitolato della gara.",
    "AL CENTRO SCRIVI: RELAZIONE TECNICA",
    `SOTTO SEMPRE AL CENTRO SCRIVI: ${rigaTitolo(dati)}`,
  ];

  const loghi: string[] = [];
  if (dati.logoStazione) loghi.push(`IN ALTO A SINISTRA METTI LOGO STAZIONE APPALTANTE (${riferimento("stazione")})`);
  if (dati.logoCliente) loghi.push(`IN BASSO A DESTRA METTI LOGO CLIENTE (${riferimento("cliente")})`);
  if (loghi.length) righe.push("", loghi.join(", "));
  return righe.join("\n");
}

// Il comando più le note tecniche e la direzione artistica. Le note non cambiano il comando: dicono come trattare i testi e i loghi (un modello
// d'immagini tende a ridisegnare i loghi, a sbagliare le lettere e a scrivere insegne dove non servono); la direzione artistica dice COSA disegnare
// nello sfondo, ricavato dal documento di gara letto da OpenAI (o, se manca, dal settore).
export function promptCopertina(dati: DatiCopertina): string {
  const note: string[] = [
    "Formato: pagina A4 verticale, a tutta pagina, senza bordi bianchi né cornici di foglio.",
    // senza CIG la nota non lo nomina nemmeno: sarebbe un invito al modello a inventarne uno
    `I testi vanno scritti ESATTAMENTE come indicati sopra (compresi numeri${dati.cig ? ", lettere del CIG, trattino semplice" : ""} e punteggiatura), parola per parola: non correggerli, non tradurli, non abbreviarli. Se il titolo è lungo vai a capo su più righe, senza tagliarlo. Non scrivere nessun altro testo oltre a quelli richiesti.`,
    "I due testi sono centrati orizzontalmente sulla pagina, uno sotto l'altro: «RELAZIONE TECNICA» grande e ben visibile, il titolo sotto in dimensione minore.",
  ];
  const realistico = dati.stile === "realistico";
  if (realistico) {
    note.push(
      "Lo sfondo è una FOTOGRAFIA realistica a tutta pagina, da servizio fotografico professionale per una pubblicazione istituzionale: luce naturale, messa a fuoco nitida, profondità di campo, colori naturali. Non un'illustrazione, non un disegno, non una grafica vettoriale.",
      // la scena NON deve contenere testo né volti: i difetti più frequenti di un modello d'immagini (insegne, targhe, volti deformati)
      "Nella fotografia nessuna scritta leggibile: niente insegne, targhe, cartelli, marchi o nomi sugli edifici, niente numeri, niente bandiere, stemmi o simboli di enti. Persone: meglio nessuna; se ci sono, di spalle o lontane, senza volti riconoscibili.",
      // la leggibilità dei testi su una foto: una velatura chiara sulla fascia centrale (la foto resta visibile, schiarita e morbida)
      "Per la leggibilità, la fascia centrale della pagina (circa dal 30% al 70% dell'altezza), dove stanno i testi, è coperta da una velatura chiara molto morbida: la fotografia vi resta visibile ma schiarita e sfumata, e i testi scuri risaltano perfettamente. La parte alta e quella bassa della pagina mostrano la fotografia nitida e a piena intensità.",
    );
  } else {
    note.push(
      // l'illustrazione NON deve contenere testo: è il difetto più frequente di un modello d'immagini (insegne, targhe, nomi sugli edifici)
      "Nelle illustrazioni dello sfondo NESSUNA scritta: niente insegne, targhe, cartelli o nomi sugli edifici, niente numeri, niente bandiere, stemmi o simboli di enti.",
      "La fascia centrale della pagina (circa dal 35% al 65% dell'altezza), dove stanno i testi, ha uno sfondo molto semplice, chiaro e senza dettagli, così i testi si leggono perfettamente; le illustrazioni stanno nella parte alta e nella parte bassa della pagina.",
    );
  }
  if (dati.logoStazione || dati.logoCliente) {
    note.push(
      `I loghi allegati vanno riprodotti IDENTICI all'originale: stessa forma, stessi colori, stesse scritte, senza ridisegnarli, deformarli o ricolorarli. ${
        realistico ? "Mettili su pannelli bianchi con gli angoli arrotondati, ben leggibili sopra la fotografia." : "Mettili su un'area chiara o neutra così restano ben leggibili."
      } ${dati.logoStazione && dati.logoCliente ? "Non inserire altri loghi, stemmi o marchi." : "Non inserire altri loghi, stemmi o marchi, e nessun logo negli angoli per cui non è stato richiesto."}`,
    );
  } else {
    note.push("Non inserire nessun logo, stemma o marchio.");
  }
  note.push("Lascia margini ampi (almeno l'8% su ogni lato) intorno a testi e loghi, perché la pagina può essere rifilata ai bordi.");

  const direzione: string[] = [];
  if (dati.direzione) {
    direzione.push(realistico ? dati.direzione.direzioneRealistica : dati.direzione.direzioneStilizzata);
    if (dati.direzione.luoghi.length) direzione.push(`Luoghi e attività citati nel documento di gara: ${dati.direzione.luoghi.join("; ")}.`);
    if (dati.direzione.territorio) direzione.push(`Territorio: ${dati.direzione.territorio}.`);
  } else if (realistico) {
    direzione.push(`Sfondo fotografico coerente con il tema della gara: ${SCENA_PER_SETTORE[dati.settore ?? "nessuno"]}.`);
  } else {
    direzione.push(`Sfondo grafico coerente con il tema della gara, con ${MOTIVO_PER_SETTORE[dati.settore ?? "nessuno"]}.`);
  }
  direzione.push(
    realistico
      ? "I colori della velatura e dei testi si armonizzano con i colori dei loghi allegati. Stile: fotografico, sobrio, istituzionale; riconoscibile come fatto per QUESTA gara, non una foto stock generica."
      : "La palette si armonizza con i colori dei loghi allegati. Stile: sobrio, istituzionale, da studio grafico professionale; riconoscibile come fatto per QUESTA gara, non un modello generico. Niente persone con volti.",
  );

  const contesto: string[] = [`Oggetto della gara: ${dati.titolo}.`];
  const tipo = dati.direzione?.tipoServizio || (dati.settore ? OGGETTO_PER_SETTORE[dati.settore] : "");
  if (tipo) contesto.push(`Tipo di servizio: ${tipo}.`);
  if (dati.stazioneAppaltante) contesto.push(`Stazione appaltante: ${dati.stazioneAppaltante} (serve solo a dare il tono alla copertina: non scriverne il nome sulla pagina).`);

  return [
    comandoCopertina(dati),
    "",
    "NOTE:",
    ...note.map((n) => `- ${n}`),
    "",
    `DIREZIONE ARTISTICA — STILE ${realistico ? "REALISTICO (fotografia)" : "STILIZZATO (illustrazione)"}, specifica per questa gara, da seguire con precisione:`,
    ...direzione,
    "",
    "CONTESTO DELLA GARA:",
    ...contesto.map((c) => `- ${c}`),
  ].join("\n");
}

// Una copertina si può chiedere solo con un titolo: senza, il modello inventerebbe il testo
export function validaDatiCopertina(dati: Pick<DatiCopertina, "titolo">): { ok: true } | { ok: false; errore: string } {
  if (!dati.titolo) return { ok: false, errore: "La gara non ha un titolo: scrivilo in alto nella pagina e riprova." };
  return { ok: true };
}

// ───── Perché una generazione non è riuscita ─────
// Il messaggio al cliente dice la causa vera, senza dettagli tecnici (quelli restano nei log del server). Prima ogni errore della lettura diceva «scegli un
// altro documento», anche quando il documento era a posto e a non andare era la chiave del servizio.
// `stato` è quello della risposta di OpenAI (ErroreOpenAI.stato): qui si legge per forma, per non dipendere da copertina-openai.ts.

export type FaseCopertina = "lettura" | "disegno" | "salvataggio";

export const MESSAGGI_ERRORE_COPERTINA = {
  nonConfigurato: "Il servizio di creazione delle copertine non è configurato correttamente in questo momento. Il problema è stato registrato: riprova più tardi o contatta il supporto di OMNIA AI.",
  sovraccarico: "Il servizio di creazione delle copertine è momentaneamente sovraccarico. Riprova tra qualche minuto.",
  lento: "Il servizio ha impiegato troppo tempo a rispondere. Riprova tra qualche istante.",
  documento: "Non sono riuscito a leggere il documento scelto. Riprova, oppure scegli un altro documento.",
  regole: "OpenAI ha rifiutato la richiesta per le sue regole sui contenuti (potrebbe dipendere da uno dei loghi). Controlla i loghi caricati e riprova.",
  generico: "La generazione della copertina non è riuscita. Riprova tra qualche istante.",
} as const;

export function messaggioErroreCopertina(err: unknown, fase: FaseCopertina): string {
  const stato = typeof (err as { stato?: unknown } | null)?.stato === "number" ? (err as { stato: number }).stato : null;
  const testo = err instanceof Error ? err.message : "";
  // chiave non accettata, senza permessi o modello non disponibile: non dipende dal documento né dal cliente
  if (stato === 401 || stato === 403 || stato === 404) return MESSAGGI_ERRORE_COPERTINA.nonConfigurato;
  // troppe richieste o credito finito
  if (stato === 429) return MESSAGGI_ERRORE_COPERTINA.sovraccarico;
  // nessuna risposta in tempo, o nessuna connessione
  if (/non ha risposto in tempo|Connessione a OpenAI non riuscita/.test(testo)) return MESSAGGI_ERRORE_COPERTINA.lento;
  if (fase === "lettura") return MESSAGGI_ERRORE_COPERTINA.documento;
  if (stato === 400 && /safety|moderation|content/i.test(testo)) return MESSAGGI_ERRORE_COPERTINA.regole;
  return MESSAGGI_ERRORE_COPERTINA.generico;
}

// ───── File ─────
// Stanno nel bucket «gare», alla radice della cartella della gara: la cancellazione della gara raccoglie tutto ciò che sta sotto
// «<id gara>/» (src/lib/gara-storage.ts, percorsiSottoPrefisso), quindi le copertine spariscono con lei, come promette il contratto.
// Una generazione NON sostituisce la precedente (il cliente può confrontare): ogni file ha la sua data nel nome.

export const PREFISSO_FILE_COPERTINA = "copertina-";

export function marcaTempo(data: Date): string {
  return data.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
}

// «copertina-<data>-<stile>.<est>». Le copertine generate prima della scelta dello stile («copertina-<data>.<est>») erano tutte stilizzate e restano valide.
export function percorsoCopertina(garaId: string, data: Date, stile: Stile, estensione: "png" | "pdf"): string {
  return `${garaId}/${PREFISSO_FILE_COPERTINA}${marcaTempo(data)}-${stile}.${estensione}`;
}

export type CopertinaElenco = { marca: string; stile: Stile; png: string; pdf: string | null };

const NOME_COPERTINA = /^copertina-(\d{8}T\d{6}Z)(?:-(stilizzato|realistico))?\.(png|pdf)$/;

// Dall'elenco dei nomi dei file nella cartella della gara alle copertine complete (la più recente per prima; a parità di data, prima la stilizzata).
// Una copertina esiste se c'è il PNG; il PDF è l'altro formato della stessa pagina, nello stesso stile.
export function copertineDaNomi(nomi: string[]): CopertinaElenco[] {
  const png = new Map<string, { marca: string; stile: Stile; nome: string }>();
  const pdf = new Map<string, string>();
  for (const nome of nomi) {
    const m = NOME_COPERTINA.exec(nome);
    if (!m) continue;
    const stile: Stile = m[2] === "realistico" ? "realistico" : "stilizzato";
    const chiave = `${m[1]}|${stile}`;
    if (m[3] === "png") png.set(chiave, { marca: m[1], stile, nome });
    else pdf.set(chiave, nome);
  }
  return [...png.entries()]
    .map(([chiave, p]) => ({ marca: p.marca, stile: p.stile, png: p.nome, pdf: pdf.get(chiave) ?? null }))
    .sort((a, b) => (a.marca < b.marca ? 1 : a.marca > b.marca ? -1 : a.stile < b.stile ? 1 : a.stile > b.stile ? -1 : 0));
}

// «20261110T153000Z» → data (per la scheda: «generata il 10/11/2026»)
export function dataDaMarca(marca: string): Date | null {
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(marca);
  if (!m) return null;
  const data = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6])));
  return Number.isNaN(data.getTime()) ? null : data;
}

// Lo stile di un file di copertina dal suo nome (senza stile nel nome = stilizzato); null se non è un file di copertina
export function stileDaNomeFile(nomeFile: string): Stile | null {
  const m = NOME_COPERTINA.exec(nomeFile);
  return m ? (m[2] === "realistico" ? "realistico" : "stilizzato") : null;
}

// Nome del file scaricato: «Copertina relazione tecnica (stile realistico) - <titolo>.<est>», senza i caratteri che i sistemi non accettano nei nomi
export function nomeFileScaricato(titolo: string, estensione: "png" | "pdf", stile?: Stile): string {
  const pulito = titolo
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80)
    .trim();
  return `Copertina relazione tecnica${stile ? ` (${stile})` : ""}${pulito ? ` - ${pulito}` : ""}.${estensione}`;
}

// Il percorso di un file di copertina si accetta solo se è proprio uno di quelli di QUESTA gara: il nome arriva dal browser
export function percorsoCopertinaValido(garaId: string, nomeFile: unknown): nomeFile is string {
  return typeof nomeFile === "string" && NOME_COPERTINA.test(nomeFile) && /^[0-9a-f-]{36}$/i.test(garaId);
}

// ───── Costo ─────
// Il costo si ricava dai token che OpenAI restituisce (src/lib/ai-pricing.ts, tariffa «da verificare» come le altre); qui solo l'estrazione
// sicura dei numeri dalla risposta.
export type UsoImmagine = { inputTokens: number | null; outputTokens: number | null };

export function usoDaRisposta(risposta: unknown): UsoImmagine {
  const uso = (risposta as { usage?: { input_tokens?: unknown; output_tokens?: unknown } } | null)?.usage;
  const numero = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null);
  return { inputTokens: numero(uso?.input_tokens), outputTokens: numero(uso?.output_tokens) };
}
