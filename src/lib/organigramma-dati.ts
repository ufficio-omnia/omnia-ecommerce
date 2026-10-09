// Organigramma di commessa come DATI strutturati (non più un elenco a rientri
// scritto dal modello nel testo). Il modello dichiara solo tipo di nodo e
// relazione; colori, posizioni e stile li decide il disegnatore
// (organigramma-disegno.ts) secondo le regole fisse R20. Tutto ciò che si può
// ricavare da una fonte certa NON lo scrive il modello: committente e tipo di
// interfaccia (RUP/DEC) dai documenti di gara, impresa e riquadri del livello
// di direzione dal profilo aziendale, numero di sedi dall'elenco delle sedi.
//
// Questo modulo è PURO (nessun DB, nessun canvas): tipi, lettura sicura di ciò
// che arriva dal modello, serializzazione del blocco nel testo e lettura dei
// campi del profilo. Il layout è in organigramma-layout.ts.

export const TIPI_STAFF = ["sicurezza", "qualita", "ambiente", "cam", "diversity", "tutor", "supporto", "reperibilita"] as const;
export type TipoStaff = (typeof TIPI_STAFF)[number];

export const TIPI_INTERFACCIA = ["RUP", "DEC", "RUP/DEC"] as const;
export type TipoInterfaccia = (typeof TIPI_INTERFACCIA)[number];

export type Figura = { denominazione: string; nominativo?: string };
export type StaffGoverno = Figura & { tipo: TipoStaff };
export type Sottolivello = { denominazione: string; nominativo?: string; dettaglio?: string; addetti?: string[] };
export type Zona = {
  denominazione: string;
  nominativo?: string;
  presidio?: string;
  sedi?: string[];
  numeroSedi?: number;
  annotazione?: string;
  sottolivelli: Sottolivello[];
};
export type VoceElenco = { funzione: string; nominativo?: string };
export type RiquadroElenco = { titolo: string; posizione: "sinistra" | "destra"; voci: VoceElenco[] };

export type DatiOrganigramma = {
  v: 2;
  committente?: { denominazione: string; tipoInterfaccia?: TipoInterfaccia };
  imprese: { denominazione: string; ruolo?: "mandataria" | "mandante" }[];
  strumentiEsterni?: { denominazione: string; tipo: "piattaforma" | "call_center" }[];
  riquadriElenco?: RiquadroElenco[];
  figuraApicale: Figura;
  vice?: Figura;
  staffGoverno?: StaffGoverno[];
  referenteCommittente?: { denominazione: string };
  centraleOperativa?: { denominazione: string; descrizione?: string };
  coordinamento: Zona[];
  bandaConclusiva?: { titolo: string; descrizione?: string };
  risorseTrasversali?: { titolo: string; voci: { denominazione: string }[] };
};

// ─── Limiti (il disegno non deve sforare: oltre, si tronca e si avvisa) ───
export const LIMITI = {
  staff: 6,
  zone: 12,
  sottolivelliPerZona: 4,
  addettiPerSottolivello: 5,
  vociElenco: 6,
  vociRisorse: 5,
  testoDenominazione: 70,
  testoDettaglio: 110,
  testoDescrizione: 160,
} as const;

// Il testo di una figura finisce in un blocco delimitato da tag quadre e in
// una riga JSON: niente parentesi quadre, niente a capo, spazi normalizzati.
export function pulisciTesto(valore: unknown, max: number): string | undefined {
  if (typeof valore !== "string") return undefined;
  const pulito = valore.replace(/[\[\]\r\n\t]+/g, " ").replace(/\s+/g, " ").trim();
  if (!pulito) return undefined;
  return pulito.length > max ? `${pulito.slice(0, max - 1).trimEnd()}…` : pulito;
}

export function normalizzaPerConfronto(testo: string): string {
  return testo
    .normalize("NFD")
    .replace(new RegExp("[" + String.fromCharCode(0x0300) + "-" + String.fromCharCode(0x036f) + "]", "g"), "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

// ─── Ciò che dichiara il modello (strumento genera_bozza_sezione) ───
// Nomi in snake_case come nello schema dello strumento. Lettura DIFENSIVA:
// il valore arriva da un modello e può avere campi mancanti, di tipo sbagliato
// o in eccesso — niente di ciò che non è riconosciuto passa.
export type OrganigrammaModello = {
  figura_apicale?: { denominazione?: string; nominativo?: string };
  vice?: { denominazione?: string; nominativo?: string };
  staff_governo?: { denominazione?: string; nominativo?: string; tipo?: string }[];
  centrale_operativa?: { denominazione?: string; descrizione?: string };
  coordinamento?: {
    denominazione?: string;
    nominativo?: string;
    presidio?: string;
    sedi?: string[];
    annotazione?: string;
    sottolivelli?: { denominazione?: string; nominativo?: string; dettaglio?: string; addetti?: string[] }[];
  }[];
  banda_conclusiva?: { titolo?: string; descrizione?: string };
  risorse_trasversali?: { titolo?: string; voci?: { denominazione?: string }[] };
  strumenti_esterni?: { denominazione?: string; tipo?: string }[];
};

export type DichiarazioneModello = {
  figuraApicale?: Figura;
  vice?: Figura;
  staffGoverno: StaffGoverno[];
  centraleOperativa?: { denominazione: string; descrizione?: string };
  coordinamento: Zona[];
  bandaConclusiva?: { titolo: string; descrizione?: string };
  risorseTrasversali?: { titolo: string; voci: { denominazione: string }[] };
  strumentiEsterni: { denominazione: string; tipo: "piattaforma" | "call_center" }[];
  avvisi: string[];
};

function elenco(valore: unknown): unknown[] {
  return Array.isArray(valore) ? valore : [];
}

function oggetto(valore: unknown): Record<string, unknown> | null {
  return valore && typeof valore === "object" && !Array.isArray(valore) ? (valore as Record<string, unknown>) : null;
}

function figura(valore: unknown): Figura | undefined {
  const o = oggetto(valore);
  const denominazione = o ? pulisciTesto(o.denominazione, LIMITI.testoDenominazione) : undefined;
  if (!o || !denominazione) return undefined;
  const nominativo = pulisciTesto(o.nominativo, LIMITI.testoDenominazione);
  return nominativo ? { denominazione, nominativo } : { denominazione };
}

export function leggiDichiarazioneModello(grezzo: unknown): DichiarazioneModello {
  const avvisi: string[] = [];
  const o = oggetto(grezzo) ?? {};

  const staffGoverno: StaffGoverno[] = [];
  for (const voce of elenco(o.staff_governo)) {
    const f = figura(voce);
    const tipoGrezzo = oggetto(voce)?.tipo;
    const tipo = (TIPI_STAFF as readonly string[]).includes(String(tipoGrezzo)) ? (tipoGrezzo as TipoStaff) : "supporto";
    if (f) staffGoverno.push({ ...f, tipo });
  }
  if (staffGoverno.length > LIMITI.staff) {
    avvisi.push(`Figure di staff oltre il limite di ${LIMITI.staff}: le ultime ${staffGoverno.length - LIMITI.staff} non sono state disegnate.`);
    staffGoverno.length = LIMITI.staff;
  }

  const coordinamento: Zona[] = [];
  for (const voce of elenco(o.coordinamento)) {
    const z = oggetto(voce);
    const f = figura(voce);
    if (!z || !f) continue;
    const sottolivelli: Sottolivello[] = [];
    for (const s of elenco(z.sottolivelli)) {
      const so = oggetto(s);
      const fs = figura(s);
      if (!so || !fs) continue;
      const addetti = elenco(so.addetti)
        .map((a) => pulisciTesto(a, LIMITI.testoDenominazione))
        .filter((a): a is string => !!a)
        .slice(0, LIMITI.addettiPerSottolivello);
      const dettaglio = pulisciTesto(so.dettaglio, LIMITI.testoDettaglio);
      sottolivelli.push({ ...fs, ...(dettaglio ? { dettaglio } : {}), ...(addetti.length ? { addetti } : {}) });
    }
    if (sottolivelli.length > LIMITI.sottolivelliPerZona) {
      avvisi.push(`Zona «${f.denominazione}»: oltre ${LIMITI.sottolivelliPerZona} capisquadra, i restanti non sono stati disegnati.`);
      sottolivelli.length = LIMITI.sottolivelliPerZona;
    }
    const sedi = elenco(z.sedi)
      .map((s) => pulisciTesto(s, LIMITI.testoDenominazione))
      .filter((s): s is string => !!s);
    const presidio = pulisciTesto(z.presidio, LIMITI.testoDenominazione);
    const annotazione = pulisciTesto(z.annotazione, LIMITI.testoDettaglio);
    coordinamento.push({ ...f, ...(presidio ? { presidio } : {}), ...(sedi.length ? { sedi } : {}), ...(annotazione ? { annotazione } : {}), sottolivelli });
  }
  if (coordinamento.length > LIMITI.zone) {
    avvisi.push(`Zone di coordinamento oltre il limite di ${LIMITI.zone}: le ultime non sono state disegnate.`);
    coordinamento.length = LIMITI.zone;
  }

  const centrale = oggetto(o.centrale_operativa);
  const centraleDen = centrale ? pulisciTesto(centrale.denominazione, LIMITI.testoDenominazione) : undefined;
  const centraleDesc = centrale ? pulisciTesto(centrale.descrizione, LIMITI.testoDescrizione) : undefined;

  const banda = oggetto(o.banda_conclusiva);
  const bandaTitolo = banda ? pulisciTesto(banda.titolo, LIMITI.testoDenominazione) : undefined;
  const bandaDesc = banda ? pulisciTesto(banda.descrizione, LIMITI.testoDescrizione) : undefined;

  const risorse = oggetto(o.risorse_trasversali);
  const risorseTitolo = risorse ? pulisciTesto(risorse.titolo, LIMITI.testoDenominazione) : undefined;
  const risorseVoci = risorse
    ? elenco(risorse.voci)
        .map((v) => pulisciTesto(oggetto(v)?.denominazione, LIMITI.testoDenominazione))
        .filter((v): v is string => !!v)
        .slice(0, LIMITI.vociRisorse)
        .map((denominazione) => ({ denominazione }))
    : [];

  const strumentiEsterni: { denominazione: string; tipo: "piattaforma" | "call_center" }[] = [];
  for (const voce of elenco(o.strumenti_esterni)) {
    const so = oggetto(voce);
    const denominazione = so ? pulisciTesto(so.denominazione, LIMITI.testoDenominazione) : undefined;
    if (!so || !denominazione) continue;
    strumentiEsterni.push({ denominazione, tipo: so.tipo === "call_center" ? "call_center" : "piattaforma" });
  }

  return {
    figuraApicale: figura(o.figura_apicale),
    vice: figura(o.vice),
    staffGoverno,
    ...(centraleDen ? { centraleOperativa: { denominazione: centraleDen, ...(centraleDesc ? { descrizione: centraleDesc } : {}) } } : {}),
    coordinamento,
    ...(bandaTitolo ? { bandaConclusiva: { titolo: bandaTitolo, ...(bandaDesc ? { descrizione: bandaDesc } : {}) } } : {}),
    ...(risorseTitolo && risorseVoci.length ? { risorseTrasversali: { titolo: risorseTitolo, voci: risorseVoci } } : {}),
    strumentiEsterni,
    avvisi,
  };
}

// ─── Campi del profilo aziendale (livello di Direzione) ───
// Un campo di testo con una voce per riga: "Responsabile Acquisti" oppure
// "Responsabile Acquisti (Mario Bianchi)" — il nominativo è facoltativo.
export function leggiVociProfilo(testo: string | null | undefined): VoceElenco[] {
  if (!testo) return [];
  const voci: VoceElenco[] = [];
  for (const rigaGrezza of testo.split(/\r?\n/)) {
    const riga = rigaGrezza.replace(/^[\s•·*\-–]+/, "").trim();
    if (!riga) continue;
    const m = riga.match(/^(.*?)\s*\(([^()]+)\)\s*$/);
    const funzione = pulisciTesto(m ? m[1] : riga, LIMITI.testoDenominazione);
    if (!funzione) continue;
    const nominativo = m ? pulisciTesto(m[2], LIMITI.testoDenominazione) : undefined;
    voci.push(nominativo ? { funzione, nominativo } : { funzione });
    if (voci.length >= LIMITI.vociElenco) break;
  }
  return voci;
}

// ─── Blocco nel testo della sezione ───
// Una sola riga JSON tra i tag: tutte le guardie del testo (R9, ripristino,
// manifest delle figure) già trattano il contenuto di [ORGANIGRAMMA] come
// opaco, e il renderer lo estrae prima di ogni altra elaborazione.
export function serializzaBlocco(dati: DatiOrganigramma): string {
  return `[ORGANIGRAMMA]\n${JSON.stringify(dati)}\n[/ORGANIGRAMMA]`;
}

// Segnaposto che il modello scrive nel testo: il blocco vero lo inserisce il
// codice DOPO tutte le riscritture (espansione, verifica dati, garanzie), così
// nessun passaggio con un modello può alterare i dati dell'organigramma.
export const SEGNAPOSTO_ORGANIGRAMMA_REGEX = /\[ORGANIGRAMMA\]\s*\[\/ORGANIGRAMMA\]/gi;

export function sostituisciSegnaposto(contenuto: string, blocco: string): string {
  let sostituito = false;
  const risultato = contenuto.replace(SEGNAPOSTO_ORGANIGRAMMA_REGEX, () => {
    if (sostituito) return ""; // un solo organigramma per sezione
    sostituito = true;
    return blocco;
  });
  return risultato;
}

export function haSegnaposto(contenuto: string): boolean {
  SEGNAPOSTO_ORGANIGRAMMA_REGEX.lastIndex = 0;
  return SEGNAPOSTO_ORGANIGRAMMA_REGEX.test(contenuto);
}

// Legge il CONTENUTO di un blocco [ORGANIGRAMMA] (testo tra i tag). Ritorna
// null se non è nel formato strutturato (blocco vecchio a rientri o vuoto).
export function leggiBloccoOrganigramma(contenutoBlocco: string): DatiOrganigramma | null {
  const t = contenutoBlocco.trim();
  if (!t.startsWith("{")) return null;
  try {
    const d = JSON.parse(t) as Partial<DatiOrganigramma>;
    if (d.v !== 2 || !d.figuraApicale?.denominazione || !Array.isArray(d.coordinamento) || !Array.isArray(d.imprese)) return null;
    return d as DatiOrganigramma;
  } catch {
    return null;
  }
}

const BLOCCO_REGEX = /\[ORGANIGRAMMA\]([\s\S]*?)\[\/ORGANIGRAMMA\]/gi;

// Tutti i blocchi [ORGANIGRAMMA] di un testo, nell'ordine, con i dati se il
// blocco è nel formato strutturato.
export function trovaBlocchiOrganigramma(testo: string): { contenuto: string; dati: DatiOrganigramma | null }[] {
  const blocchi: { contenuto: string; dati: DatiOrganigramma | null }[] = [];
  BLOCCO_REGEX.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = BLOCCO_REGEX.exec(testo)) !== null) blocchi.push({ contenuto: m[1], dati: leggiBloccoOrganigramma(m[1]) });
  return blocchi;
}

// Numero di caselle che rappresentano PERSONE (una per casella, come la regola
// di coerenza con l'organico): figura apicale, vice, staff, centrale
// operativa, ogni zona, ogni sottolivello e ogni addetto elencato.
export function contaPersone(d: Pick<DatiOrganigramma, "figuraApicale" | "vice" | "staffGoverno" | "centraleOperativa" | "coordinamento">): number {
  let n = 1;
  if (d.vice) n++;
  n += d.staffGoverno?.length ?? 0;
  if (d.centraleOperativa) n++;
  for (const z of d.coordinamento) {
    n++;
    for (const s of z.sottolivelli) n += 1 + (s.addetti?.length ?? 0);
  }
  return n;
}

// Contenuti (tra i tag) di tutti i blocchi [ORGANIGRAMMA] di un testo.
export function estraiBlocchiOrganigramma(testo: string): string[] {
  return trovaBlocchiOrganigramma(testo).map((b) => b.contenuto.trim());
}

// Un passaggio che riscrive il testo (compressione, espansione) NON deve
// poter toccare i dati di un organigramma: i blocchi devono restare identici.
export function organigrammiInvariati(prima: string, dopo: string): boolean {
  return JSON.stringify(estraiBlocchiOrganigramma(prima)) === JSON.stringify(estraiBlocchiOrganigramma(dopo));
}

// Prima di mandare un testo a un modello che lo riscrive (compressione,
// espansione) i blocchi strutturati si sostituiscono col segnaposto, e dopo
// si rimettono: il modello non vede mai i dati dell'organigramma, quindi non
// può alterarli. I blocchi vecchi (a rientri) non si toccano.
export function mascheraOrganigrammi(testo: string): { testo: string; blocchi: string[] } {
  const blocchi: string[] = [];
  const mascherato = testo.replace(/\[ORGANIGRAMMA\]([\s\S]*?)\[\/ORGANIGRAMMA\]/gi, (intero, corpo: string) => {
    if (!leggiBloccoOrganigramma(corpo)) return intero;
    blocchi.push(intero);
    return "[ORGANIGRAMMA][/ORGANIGRAMMA]";
  });
  return { testo: mascherato, blocchi };
}

export function ripristinaOrganigrammi(testo: string, blocchi: string[]): string {
  if (blocchi.length === 0) return testo;
  let i = 0;
  return testo.replace(SEGNAPOSTO_ORGANIGRAMMA_REGEX, (intero) => (i < blocchi.length ? blocchi[i++] : intero));
}
