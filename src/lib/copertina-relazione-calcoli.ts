// «Genera copertina relazione tecnica» (richiesta dell'utente, 10/11/2026): dentro la gara un pulsante chiede a OpenAI (modello immagini) una
// copertina grafica in formato A4, con il titolo e il CIG della gara e i due loghi (stazione appaltante in alto a sinistra, cliente in basso a
// destra). Questo modulo non ha dipendenze di server: contiene il testo del comando, il formato, le regole e i nomi dei file, così si provano
// senza rete. Le chiamate (OpenAI, storage) stanno in copertina-relazione.ts. Test: scripts/verifica-copertina-relazione.ts.
//
// Il comando è quello scritto dall'utente, parola per parola, con i dati della gara al posto delle parentesi. Dopo il comando ci sono poche
// note tecniche (spazi liberi per i loghi, testi esatti, margini, contesto della gara) che il comando da solo non può dire a un modello che non ha
// letto il disciplinare: restano separate dal comando e si vedono nel prompt, non si mischiano con esso. I loghi NON li disegna il modello: li applica
// il codice dopo, originali e senza sfondo (copertina-loghi.ts, decisione dell'utente del 12/11/2026).

import { normalizzaSettore, type Settore } from "@/lib/gara-settore";
import { ZONA_CLIENTE, ZONA_STAZIONE, type Zona } from "@/lib/copertina-loghi-calcoli";

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

// ───── I testi scelti dal cliente ─────
// Di base la copertina porta «RELAZIONE TECNICA» e, sotto, il titolo e il CIG letti dal documento. Il cliente può preferire un testo diverso (richiesta
// dell'utente, 11/11/2026): un TITOLO PRINCIPALE (per esempio «RELAZIONE TECNICA - OFFERTA TECNICA») al posto di «RELAZIONE TECNICA», un SOTTOTITOLO
// CENTRALE al posto del titolo letto, un CIG al posto di quello letto. Ciò che scrive PREVALE sull'estrazione, campo per campo (un campo lasciato vuoto
// resta quello di prima). Il documento si legge comunque: serve per lo sfondo.

export const TITOLO_PRINCIPALE_PREDEFINITO = "RELAZIONE TECNICA";
export const TITOLO_PRINCIPALE_MASSIMO = 100;
export const SOTTOTITOLO_MASSIMO = TITOLO_MASSIMO;
// il campo del CIG accetta anche la scritta davanti e gli spazi in mezzo («CIG: B123 456789»)
export const CIG_CAMPO_MASSIMO = 24;

export type TestiCliente = { titoloPrincipale: string | null; sottotitolo: string | null; cig: string | null };
export const TESTI_CLIENTE_VUOTI: TestiCliente = { titoloPrincipale: null, sottotitolo: null, cig: null };

// Un testo scritto a mano finisce nel comando dato al modello: su una riga sola, senza caratteri di controllo (a-capo e tabulazioni diventano uno spazio)
function ripulisciTestoCliente(valore: unknown): string {
  if (typeof valore !== "string") return "";
  return valore
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Controlla i tre campi del cliente. Un testo troppo lungo o un CIG con la forma sbagliata si RIFIUTANO con il motivo (non si accorciano e non si ignorano in
// silenzio: sulla copertina un testo tagliato o un CIG diverso da quello scritto sono peggio di un errore). Un campo vuoto vale «nessuna scelta».
export function leggiTestiCliente(grezzi: { titoloPrincipale: unknown; sottotitolo: unknown; cig: unknown }): { ok: true; testi: TestiCliente } | { ok: false; errore: string } {
  const titoloPrincipale = ripulisciTestoCliente(grezzi.titoloPrincipale);
  if (titoloPrincipale.length > TITOLO_PRINCIPALE_MASSIMO) {
    return { ok: false, errore: `Il titolo principale è troppo lungo: al massimo ${TITOLO_PRINCIPALE_MASSIMO} caratteri (ora ${titoloPrincipale.length}).` };
  }
  const sottotitolo = ripulisciTestoCliente(grezzi.sottotitolo);
  if (sottotitolo.length > SOTTOTITOLO_MASSIMO) {
    return { ok: false, errore: `Il sottotitolo è troppo lungo: al massimo ${SOTTOTITOLO_MASSIMO} caratteri (ora ${sottotitolo.length}).` };
  }
  // «CIG: B123456789» o «CIG B123456789»: si toglie la scritta (ma non le lettere CIG di un codice scritto senza separatore)
  const cigScritto = ripulisciTestoCliente(grezzi.cig).replace(/^CIG\s*[:.-]\s*|^CIG\s+/i, "");
  let cig: string | null = null;
  if (cigScritto) {
    cig = cigPerCopertina(cigScritto);
    if (!cig) {
      return { ok: false, errore: "Il CIG non è valido: sono 10 caratteri tra lettere e numeri (per esempio B123456789). Correggilo, oppure lascialo vuoto per usare quello letto dal documento." };
    }
  }
  return { ok: true, testi: { titoloPrincipale: titoloPrincipale || null, sottotitolo: sottotitolo || null, cig } };
}

// Gli avvisi della lettura che parlano di ciò che il cliente ha scritto lui non servono più («non ho trovato il CIG» quando il CIG l'ha scritto lui).
// `avvisiTitolo`, `avvisiCig` e `avvisiDocumento` sono la divisione degli avvisi fatta da verificaLettura; senza testi del cliente non si tocca nulla.
export function avvisiDopoTestiCliente(
  esito: { avvisi: string[]; avvisiTitolo?: string[]; avvisiCig?: string[]; avvisiDocumento?: string[] },
  testi: TestiCliente,
): string[] {
  if (!testi.sottotitolo && !testi.cig) return esito.avvisi;
  const daTogliere = new Set<string>();
  if (testi.sottotitolo) for (const a of esito.avvisiTitolo ?? []) daTogliere.add(a);
  if (testi.cig) for (const a of esito.avvisiCig ?? []) daTogliere.add(a);
  // l'avviso sulla scansione riguarda solo titolo e CIG: se li ha scritti tutti e due il cliente, non lo riguarda
  if (testi.sottotitolo && testi.cig) for (const a of esito.avvisiDocumento ?? []) daTogliere.add(a);
  return esito.avvisi.filter((a) => !daTogliere.has(a));
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
  // il testo grande al centro: «RELAZIONE TECNICA», o quello scelto dal cliente
  titoloPrincipale: string;
  // il sottotitolo centrale: il titolo letto dal documento, o quello scritto dal cliente
  titolo: string;
  cig: string | null;
  stile: Stile;
  // il nome serve solo come contesto (tono della copertina): non va scritto sulla pagina
  stazioneAppaltante: string | null;
  settore: Settore | null;
  // senza una lettura del documento (non dovrebbe succedere) lo sfondo ripiega sul motivo del settore
  direzione: DirezioneCopertina | null;
  // quali loghi verranno applicati sulla pagina (dal codice, dopo): per questi il modello lascia libero il loro angolo
  logoStazione: boolean;
  logoCliente: boolean;
  // i colori principali dei loghi (esadecimali), per l'armonia della pagina; vuoto se i loghi sono solo neri/grigi o mancano
  coloriLoghi: string[];
};

export function datiCopertina(grezzi: {
  // senza (o vuoto): «RELAZIONE TECNICA»
  titoloPrincipale?: unknown;
  titolo: unknown;
  cig: unknown;
  stazioneAppaltante: unknown;
  settore: unknown;
  direzione?: DirezioneCopertina | null;
  // senza uno stile valido: stilizzato (quello che c'era prima della scelta)
  stile?: unknown;
  logoStazione: boolean;
  logoCliente: boolean;
  coloriLoghi?: unknown;
}): DatiCopertina {
  return {
    titoloPrincipale: pulisciTesto(grezzi.titoloPrincipale, TITOLO_PRINCIPALE_MASSIMO) || TITOLO_PRINCIPALE_PREDEFINITO,
    titolo: pulisciTesto(grezzi.titolo, TITOLO_MASSIMO),
    cig: cigPerCopertina(grezzi.cig),
    stile: normalizzaStile(grezzi.stile) ?? "stilizzato",
    stazioneAppaltante: pulisciTesto(grezzi.stazioneAppaltante, 160) || null,
    settore: normalizzaSettore(grezzi.settore),
    direzione: grezzi.direzione ?? null,
    logoStazione: grezzi.logoStazione,
    logoCliente: grezzi.logoCliente,
    // solo colori nel formato #rrggbb, senza doppioni, al massimo sei: finiscono nel prompt
    coloriLoghi: Array.isArray(grezzi.coloriLoghi)
      ? [...new Set(grezzi.coloriLoghi.filter((c): c is string => typeof c === "string" && /^#[0-9a-f]{6}$/i.test(c)).map((c) => c.toLowerCase()))].slice(0, 6)
      : [],
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

// Il comando dell'utente, con i dati della gara al posto delle parentesi. La parte sui loghi («IN ALTO A SINISTRA METTI LOGO [stazione appaltante],
// IN BASSO A DESTRA LOGO [cliente]») la esegue il CODICE dopo il disegno, applicando i loghi originali senza sfondo (copertina-loghi.ts): il modello i
// loghi li ridisegnava, e ne perdeva dei pezzi (il caso SMAC, 12/11/2026). Al modello si chiede solo di lasciare liberi quei due angoli; un angolo senza
// logo non si nomina nemmeno.
export function comandoCopertina(dati: DatiCopertina): string {
  const righe = [
    "CREA COPERTINA GRAFICA CON SFONDO COME IMMAGINE IN A4 COERENTE CON IL Disciplinare/Capitolato della gara.",
    // di base «RELAZIONE TECNICA» (il comando dell'utente, parola per parola); se il cliente ha scelto un altro titolo principale, al suo posto
    `AL CENTRO SCRIVI: ${dati.titoloPrincipale}`,
    `SOTTO SEMPRE AL CENTRO SCRIVI: ${rigaTitolo(dati)}`,
  ];

  const spazi: string[] = [];
  if (dati.logoStazione) spazi.push("IN ALTO A SINISTRA LASCIA LIBERO LO SPAZIO PER IL LOGO DELLA STAZIONE APPALTANTE");
  if (dati.logoCliente) spazi.push("IN BASSO A DESTRA LASCIA LIBERO LO SPAZIO PER IL LOGO DEL CLIENTE");
  if (spazi.length) righe.push("", `${spazi.join(", ")} (i loghi vengono applicati dopo: NON disegnarli).`);
  return righe.join("\n");
}

const percento = (v: number) => `${Math.round(v * 100)}%`;
const descriviZona = (z: Zona) => `circa dal ${percento(z.x)} al ${percento(z.x + z.larghezza)} della larghezza e dal ${percento(z.y)} al ${percento(z.y + z.altezza)} dell'altezza`;

// Il comando più le note tecniche e la direzione artistica. Le note non cambiano il comando: dicono come trattare i testi e gli spazi dei loghi (un
// modello d'immagini tende a sbagliare le lettere, a scrivere insegne dove non servono e a disegnare loghi o stemmi inventati); la direzione artistica dice
// COSA disegnare nello sfondo, ricavato dal documento di gara letto da OpenAI (o, se manca, dal settore).
export function promptCopertina(dati: DatiCopertina): string {
  const note: string[] = [
    "Formato: pagina A4 verticale, a tutta pagina, senza bordi bianchi né cornici di foglio.",
    // senza CIG la nota non lo nomina nemmeno: sarebbe un invito al modello a inventarne uno
    `I testi vanno scritti ESATTAMENTE come indicati sopra (compresi numeri${dati.cig ? ", lettere del CIG, trattino semplice" : ""} e punteggiatura), parola per parola: non correggerli, non tradurli, non abbreviarli. Se il titolo è lungo vai a capo su più righe, senza tagliarlo. Non scrivere nessun altro testo oltre a quelli richiesti.`,
    `I due testi sono centrati orizzontalmente sulla pagina, uno sotto l'altro: «${dati.titoloPrincipale}» grande e ben visibile, il titolo sotto in dimensione minore.`,
  ];
  const realistico = dati.stile === "realistico";
  // gli angoli che devono restare chiari per i loghi (applicati dopo dal codice): la composizione li evita, invece di riempirli (nella prima prova del
  // 12/11/2026 il modello aveva disegnato una villa proprio nell'angolo del logo del cliente)
  const angoliLiberi = [dati.logoStazione ? "l'angolo in alto a sinistra" : null, dati.logoCliente ? "l'angolo in basso a destra" : null].filter((a): a is string => a !== null);
  if (realistico) {
    note.push(
      "Lo sfondo è una FOTOGRAFIA realistica a tutta pagina, da servizio fotografico professionale per una pubblicazione istituzionale: luce naturale, messa a fuoco nitida, profondità di campo, colori naturali. Non un'illustrazione, non un disegno, non una grafica vettoriale.",
      // la scena NON deve contenere testo né volti: i difetti più frequenti di un modello d'immagini (insegne, targhe, volti deformati)
      "Nella fotografia nessuna scritta leggibile: niente insegne, targhe, cartelli, marchi o nomi sugli edifici, niente numeri, niente bandiere, stemmi o simboli di enti. Persone: meglio nessuna; se ci sono, di spalle o lontane, senza volti riconoscibili.",
      // la leggibilità dei testi su una foto: una velatura chiara sulla fascia centrale (la foto resta visibile, schiarita e morbida)
      "Per la leggibilità, la fascia centrale della pagina (circa dal 30% al 70% dell'altezza), dove stanno i testi, è coperta da una velatura chiara molto morbida: la fotografia vi resta visibile ma schiarita e sfumata, e i testi scuri risaltano perfettamente. La parte alta e quella bassa della pagina mostrano la fotografia nitida e a piena intensità.",
    );
    if (angoliLiberi.length) {
      note.push(
        `Inquadra la scena in modo che ${angoliLiberi.join(" e ")} cadano su zone chiare, calme e sfocate (un soffitto luminoso, una parete chiara, un pavimento chiaro), senza oggetti, piante o persone in primo piano: lì vanno i loghi e devono vedersi bene.`,
      );
    }
  } else {
    note.push(
      // l'illustrazione NON deve contenere testo: è il difetto più frequente di un modello d'immagini (insegne, targhe, nomi sugli edifici)
      "Nelle illustrazioni dello sfondo NESSUNA scritta: niente insegne, targhe, cartelli o nomi sugli edifici, niente numeri, niente bandiere, stemmi o simboli di enti.",
      angoliLiberi.length
        ? // composizione LIBERA (l'utente non vuole sempre la stessa, 12/11/2026): l'unico vincolo sono gli angoli dei loghi, che devono restare chiari
          `La fascia centrale della pagina (circa dal 35% al 65% dell'altezza), dove stanno i testi, ha uno sfondo molto semplice, chiaro e senza dettagli, così i testi si leggono perfettamente. La composizione delle illustrazioni è libera e può cambiare da una copertina all'altra (in alto e in basso, su un lato, in diagonale, a cornice: come rende meglio questa gara), purché ${angoliLiberi.join(" e ")} ${angoliLiberi.length === 2 ? "abbiano" : "abbia"} solo uno sfondo chiaro e semplice, senza illustrazioni né dettagli: lì vanno i loghi e devono vedersi bene.`
        : "La fascia centrale della pagina (circa dal 35% al 65% dell'altezza), dove stanno i testi, ha uno sfondo molto semplice, chiaro e senza dettagli, così i testi si leggono perfettamente; le illustrazioni stanno nella parte alta e nella parte bassa della pagina.",
    );
  }
  // I loghi li applica il codice, originali e senza sfondo: il modello non ne disegna nessuno (né veri né inventati), e nessun riquadro per contenerli
  note.push("Non disegnare NESSUN logo, stemma, marchio o simbolo di enti in nessun punto della pagina, e nessun riquadro, pannello o cornice per loghi.");
  const zone: string[] = [];
  if (dati.logoStazione) zone.push(`in alto a sinistra (${descriviZona(ZONA_STAZIONE)})`);
  if (dati.logoCliente) zone.push(`in basso a destra (${descriviZona(ZONA_CLIENTE)})`);
  if (zone.length) {
    note.push(
      `${zone.length === 2 ? "Gli spazi dei loghi" : "Lo spazio del logo"} ${zone.join(" e ")} ${zone.length === 2 ? "restano liberi" : "resta libero"}: lì il logo originale viene applicato dopo, senza sfondo, direttamente sull'immagine. In ${zone.length === 2 ? "quegli spazi" : "quello spazio"} lo sfondo è chiaro, uniforme e calmo, senza oggetti, persone, testi o dettagli, così il logo si legge bene${
        realistico ? " (nella fotografia: una zona chiara e sfocata, come una parete luminosa, il cielo o un pavimento chiaro)" : ""
      }; ma resta parte dell'immagine, sfumato con il resto: niente riquadri, rettangoli bianchi, pannelli o cornici.`,
    );
  }
  note.push("Lascia margini ampi (almeno l'8% su ogni lato) intorno ai testi, perché la pagina può essere rifilata ai bordi.");

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
  // l'armonia con i loghi: i loghi non arrivano più al modello, quindi i loro colori principali si scrivono (letti dal file del logo, mai inventati)
  const armonia = dati.coloriLoghi.length ? `con i colori dei loghi che verranno applicati (${dati.coloriLoghi.join(", ")})` : "con toni sobri e istituzionali";
  direzione.push(
    realistico
      ? `I colori della velatura e dei testi si armonizzano ${armonia}. Stile: fotografico, sobrio, istituzionale; riconoscibile come fatto per QUESTA gara, non una foto stock generica.`
      : `La palette si armonizza ${armonia}. Stile: sobrio, istituzionale, da studio grafico professionale; riconoscibile come fatto per QUESTA gara, non un modello generico. Niente persone con volti.`,
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

// Una copertina modificata in chat (13/11/2026) ha «-modifica» nel nome: «copertina-<data>-<stile>-modifica.<est>». Accanto a ogni copertina fatta da
// quel giorno ci sono anche (stesso nome, con un'aggiunta): la pagina SENZA loghi («-base.png», serve per modificarla senza far ridisegnare i loghi al
// modello), la miniatura («-mini.jpg», per la scelta in chat) e la scheda («.json»: testi, stile e disposizione dei loghi). Questi file non sono copertine:
// non compaiono nell'elenco e non si scaricano.
export type CopertinaElenco = { id: string; marca: string; stile: Stile; modifica: boolean; png: string; pdf: string | null };

const NOME_COPERTINA = /^copertina-(\d{8}T\d{6}Z)(?:-(stilizzato|realistico))?(-modifica)?\.(png|pdf)$/;

// L'identificativo di una copertina: il nome dei suoi file senza estensione («copertina-20261113T101500Z-stilizzato-modifica»)
export function idCopertina(marca: string, stile: Stile, modifica: boolean): string {
  return `${PREFISSO_FILE_COPERTINA}${marca}-${stile}${modifica ? "-modifica" : ""}`;
}
const FORMA_ID_COPERTINA = /^copertina-\d{8}T\d{6}Z-(stilizzato|realistico)(-modifica)?$/;
export function idCopertinaValido(valore: unknown): valore is string {
  return typeof valore === "string" && FORMA_ID_COPERTINA.test(valore);
}

// I file di una copertina (nomi, senza la cartella della gara)
export function fileCopertina(id: string): { png: string; pdf: string; base: string; mini: string; scheda: string } {
  return { png: `${id}.png`, pdf: `${id}.pdf`, base: `${id}-base.png`, mini: `${id}-mini.jpg`, scheda: `${id}.json` };
}

// Dall'elenco dei nomi dei file nella cartella della gara alle copertine complete (la più recente per prima; a parità di data, prima la stilizzata).
// Una copertina esiste se c'è il PNG; il PDF è l'altro formato della stessa pagina, nello stesso stile.
export function copertineDaNomi(nomi: string[]): CopertinaElenco[] {
  const png = new Map<string, { marca: string; stile: Stile; modifica: boolean; nome: string }>();
  const pdf = new Map<string, string>();
  for (const nome of nomi) {
    const m = NOME_COPERTINA.exec(nome);
    if (!m) continue;
    const stile: Stile = m[2] === "realistico" ? "realistico" : "stilizzato";
    const modifica = Boolean(m[3]);
    const chiave = `${m[1]}|${stile}|${modifica}`;
    if (m[4] === "png") png.set(chiave, { marca: m[1], stile, modifica, nome });
    else pdf.set(chiave, nome);
  }
  return [...png.entries()]
    .map(([chiave, p]) => ({ id: p.nome.replace(/\.png$/, ""), marca: p.marca, stile: p.stile, modifica: p.modifica, png: p.nome, pdf: pdf.get(chiave) ?? null }))
    .sort((a, b) => (a.marca < b.marca ? 1 : a.marca > b.marca ? -1 : a.stile < b.stile ? 1 : a.stile > b.stile ? -1 : 0));
}

// «COPERTINA N.1, N.2, N.3…» (richiesta dell'utente, 13/11/2026): il numero segue l'ordine di creazione (la più vecchia è la N.1), comprese le copertine
// modificate in chat, che continuano la numerazione. Stabile: una copertina nuova non cambia il numero di quelle che c'erano.
export function numeriCopertine(elenco: Pick<CopertinaElenco, "id" | "marca" | "stile">[]): Map<string, number> {
  const ordinate = [...elenco].sort((a, b) => (a.marca < b.marca ? -1 : a.marca > b.marca ? 1 : a.stile < b.stile ? 1 : a.stile > b.stile ? -1 : 0));
  return new Map(ordinate.map((c, i) => [c.id, i + 1]));
}
export function etichettaNumero(numero: number): string {
  return `COPERTINA N.${numero}`;
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

// Nome del file scaricato: «Copertina N.3 relazione tecnica (realistico) - <titolo>.<est>» (il numero, se c'è, è quello mostrato nella pagina), senza i
// caratteri che i sistemi non accettano nei nomi
export function nomeFileScaricato(titolo: string, estensione: "png" | "pdf", stile?: Stile, numero?: number): string {
  const pulito = titolo
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80)
    .trim();
  return `Copertina${numero ? ` N.${numero}` : ""} relazione tecnica${stile ? ` (${stile})` : ""}${pulito ? ` - ${pulito}` : ""}.${estensione}`;
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
