import { PIANI, PIANI_ORDINE, formatEuro, type PianoSlug } from "./omnia-ai-plans";

// Calcoli puri (nessun database, nessuna rete) del catalogo piani di OMNIA AI: prezzo di listino
// modificabile dalla console, sconti, e ciò che il cliente vede e paga. La lettura dal database
// sta in omnia-ai-catalogo.ts, i prezzi e i coupon Stripe in omnia-ai-stripe-sconti.ts.
//
// Regole:
//  - il prezzo di listino parte dal codice (PIANI) e una riga in omnia_ai_prezzi_piani lo sostituisce;
//  - uno sconto vale dal giorno `validoDal` al giorno `validoAl` (compresi), se è attivo, sul piano
//    indicato o su tutti; se ne applicano più d'uno vince il prezzo più basso, mai la somma;
//  - chi compra durante la validità paga il prezzo scontato per `durataMesi` mesi (0 = sempre), poi il listino;
//  - uno sconto che non fa scendere il prezzo sotto il listino non è uno sconto: si ignora.
// Tutti i giorni sono giorni di calendario di Roma, scritti «AAAA-MM-GG».

export type TipoSconto = "percentuale" | "prezzo";

export type Sconto = {
  id: string;
  nome: string;
  // null = tutti i piani
  piano: PianoSlug | null;
  tipo: TipoSconto;
  percentuale: number | null;
  prezzoScontatoCentesimi: number | null;
  validoDal: string;
  validoAl: string | null;
  // 0 = per tutta la durata dell'abbonamento
  durataMesi: number;
  attivo: boolean;
};

export type StatoSconto = "disattivato" | "in_programma" | "attivo" | "scaduto";

export const PREZZO_MIN_CENTESIMI = 100;
export const PREZZO_MAX_CENTESIMI = 10_000_000;
export const DURATA_MAX_MESI = 60;

// Il giorno di oggi a Roma («AAAA-MM-GG»): il server gira in UTC e a cavallo della mezzanotte il
// giorno sarebbe quello sbagliato.
export function giornoRoma(istante: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Rome", year: "numeric", month: "2-digit", day: "2-digit" }).format(istante);
}

export function formattaGiorno(ymd: string): string {
  const [anno, mese, giorno] = ymd.split("-");
  return `${giorno}/${mese}/${anno}`;
}

export function statoSconto(s: Pick<Sconto, "attivo" | "validoDal" | "validoAl">, oggi: string): StatoSconto {
  if (!s.attivo) return "disattivato";
  if (oggi < s.validoDal) return "in_programma";
  if (s.validoAl && oggi > s.validoAl) return "scaduto";
  return "attivo";
}

export function prezzoConSconto(listino: number, s: Pick<Sconto, "tipo" | "percentuale" | "prezzoScontatoCentesimi">): number {
  if (s.tipo === "percentuale") return Math.round((listino * (100 - (s.percentuale ?? 0))) / 100);
  return Math.min(s.prezzoScontatoCentesimi ?? listino, listino);
}

export type ScontoApplicato = {
  id: string;
  nome: string;
  tipo: TipoSconto;
  percentuale: number | null;
  validoAl: string | null;
  durataMesi: number;
  // prezzo mensile scontato e quanto si risparmia al mese rispetto al listino
  prezzoCentesimi: number;
  risparmioCentesimi: number;
};

// Lo sconto che si applica oggi a un piano: il più conveniente tra quelli attivi e validi. null se nessuno.
export function scontoMigliore(piano: PianoSlug, listino: number, sconti: Sconto[], oggi: string): ScontoApplicato | null {
  let migliore: ScontoApplicato | null = null;
  for (const s of sconti) {
    if (s.piano !== null && s.piano !== piano) continue;
    if (statoSconto(s, oggi) !== "attivo") continue;
    const prezzo = prezzoConSconto(listino, s);
    if (prezzo >= listino) continue;
    const candidato: ScontoApplicato = { id: s.id, nome: s.nome, tipo: s.tipo, percentuale: s.percentuale, validoAl: s.validoAl, durataMesi: s.durataMesi, prezzoCentesimi: prezzo, risparmioCentesimi: listino - prezzo };
    // prezzo più basso; a parità il più vecchio per identificativo (scelta stabile, non casuale)
    if (!migliore || candidato.prezzoCentesimi < migliore.prezzoCentesimi || (candidato.prezzoCentesimi === migliore.prezzoCentesimi && candidato.id < migliore.id)) migliore = candidato;
  }
  return migliore;
}

// Il testo che spiega l'offerta al cliente: quanto paga, per quanto tempo e poi cosa.
export function testoOfferta(a: Pick<ScontoApplicato, "nome" | "prezzoCentesimi" | "validoAl" | "durataMesi">, listino: number): string {
  const durata = a.durataMesi === 0 ? "per tutta la durata dell'abbonamento" : a.durataMesi === 1 ? "per il primo mese, poi " + formatEuro(listino) + " al mese" : `per i primi ${a.durataMesi} mesi, poi ${formatEuro(listino)} al mese`;
  const scadenza = a.validoAl ? ` Offerta valida fino al ${formattaGiorno(a.validoAl)}.` : "";
  return `${a.nome}: ${formatEuro(a.prezzoCentesimi)} al mese ${durata}.${scadenza}`;
}

// ───── Prezzi: dal testo digitato ai centesimi ─────

// «699», «699,00», «699.00», «1.490,50», «1490,5», con o senza «€». null se non è un importo valido
// (negativo, lettere, più di due decimali).
export function euroACentesimi(testo: string): number | null {
  let t = testo.replace(/€/g, "").replace(/\s/g, "");
  if (t === "") return null;
  // «1.490,50»: il punto è il separatore delle migliaia se c'è anche la virgola o se seguono esattamente tre cifre
  if (/^\d{1,3}(\.\d{3})+(,\d{1,2})?$/.test(t)) t = t.replace(/\./g, "").replace(",", ".");
  else t = t.replace(",", ".");
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return null;
  return Math.round(Number(t) * 100);
}

export function erroreListino(centesimi: number | null): string | null {
  if (centesimi === null) return "Scrivi un importo in euro (per esempio 699 oppure 699,50).";
  if (centesimi < PREZZO_MIN_CENTESIMI) return `Il prezzo mensile non può essere inferiore a ${formatEuro(PREZZO_MIN_CENTESIMI)}.`;
  if (centesimi > PREZZO_MAX_CENTESIMI) return `Il prezzo mensile non può superare ${formatEuro(PREZZO_MAX_CENTESIMI)}.`;
  return null;
}

// ───── Nuovo sconto: controllo del modulo ─────

export type NuovoScontoInput = {
  nome: string;
  // "" = tutti i piani
  piano: string;
  tipo: string;
  // percentuale (1-99) oppure prezzo promozionale in euro, a seconda del tipo
  valore: string;
  validoDal: string;
  validoAl: string;
  durataMesi: string;
};

export type NuovoScontoValido = {
  nome: string;
  piano: PianoSlug | null;
  tipo: TipoSconto;
  percentuale: number | null;
  prezzoScontatoCentesimi: number | null;
  validoDal: string;
  validoAl: string | null;
  durataMesi: number;
};

const GIORNO = /^\d{4}-\d{2}-\d{2}$/;
const giornoValido = (g: string) => GIORNO.test(g) && !Number.isNaN(Date.parse(`${g}T00:00:00Z`)) && new Date(`${g}T00:00:00Z`).toISOString().slice(0, 10) === g;

export function validaNuovoSconto(input: NuovoScontoInput, listini: Record<PianoSlug, number>, oggi: string): { ok: true; valori: NuovoScontoValido } | { ok: false; errore: string } {
  const nome = input.nome.trim().replace(/\s+/g, " ");
  if (nome.length < 2 || nome.length > 80) return { ok: false, errore: "Dai un nome allo sconto (da 2 a 80 caratteri)." };

  const pianoGrezzo = input.piano.trim();
  if (pianoGrezzo !== "" && !PIANI_ORDINE.includes(pianoGrezzo as PianoSlug)) return { ok: false, errore: "Piano non valido." };
  const piano = pianoGrezzo === "" ? null : (pianoGrezzo as PianoSlug);

  let percentuale: number | null = null;
  let prezzoScontatoCentesimi: number | null = null;
  if (input.tipo === "percentuale") {
    const p = Number(input.valore.trim());
    if (!Number.isInteger(p) || p < 1 || p > 99) return { ok: false, errore: "La percentuale deve essere un numero intero da 1 a 99." };
    percentuale = p;
  } else if (input.tipo === "prezzo") {
    if (!piano) return { ok: false, errore: "Un prezzo promozionale fisso vale per un piano preciso: scegli il piano." };
    const c = euroACentesimi(input.valore);
    const errore = erroreListino(c);
    if (errore || c === null) return { ok: false, errore: errore ?? "Prezzo non valido." };
    if (c >= listini[piano]) return { ok: false, errore: `Il prezzo promozionale deve essere inferiore al listino (${formatEuro(listini[piano])}): altrimenti non è uno sconto.` };
    prezzoScontatoCentesimi = c;
  } else {
    return { ok: false, errore: "Scegli il tipo di sconto: percentuale o prezzo promozionale." };
  }

  const validoDal = input.validoDal.trim();
  if (!giornoValido(validoDal)) return { ok: false, errore: "Indica il giorno da cui lo sconto vale." };
  const alGrezzo = input.validoAl.trim();
  let validoAl: string | null = null;
  if (alGrezzo !== "") {
    if (!giornoValido(alGrezzo)) return { ok: false, errore: "Il giorno di fine non è valido (oppure lascialo vuoto: lo sconto non ha scadenza)." };
    if (alGrezzo < validoDal) return { ok: false, errore: "Il giorno di fine non può essere prima di quello di inizio." };
    if (alGrezzo < oggi) return { ok: false, errore: "Il giorno di fine è già passato: lo sconto non servirebbe a nessuno." };
    validoAl = alGrezzo;
  }

  const durataGrezza = input.durataMesi.trim();
  const durataMesi = durataGrezza === "" ? 0 : Number(durataGrezza);
  if (!Number.isInteger(durataMesi) || durataMesi < 0 || durataMesi > DURATA_MAX_MESI) return { ok: false, errore: `La durata dello sconto per chi compra deve essere un numero intero di mesi da 0 a ${DURATA_MAX_MESI} (0 = per sempre).` };

  return { ok: true, valori: { nome, piano, tipo: input.tipo, percentuale, prezzoScontatoCentesimi, validoDal, validoAl, durataMesi } };
}

// ───── Catalogo: ciò che il cliente vede ─────

export type PianoCatalogo = {
  slug: PianoSlug;
  nome: string;
  descrizione: string;
  voci: string[];
  gareIncluse: number;
  inEvidenza: boolean;
  // prezzo di listino (quello su Stripe) e prezzo da pagare oggi (listino o scontato)
  prezzoListinoCentesimi: number;
  prezzoCentesimi: number;
  sconto: ScontoApplicato | null;
};

export type Catalogo = Record<PianoSlug, PianoCatalogo>;

export function costruisciCatalogo(listini: Partial<Record<PianoSlug, number>>, sconti: Sconto[], oggi: string): Catalogo {
  const catalogo = {} as Catalogo;
  for (const slug of PIANI_ORDINE) {
    const base = PIANI[slug];
    const listino = listini[slug] ?? base.prezzoCentesimi;
    const sconto = scontoMigliore(slug, listino, sconti, oggi);
    catalogo[slug] = {
      slug,
      nome: base.nome,
      descrizione: base.descrizione,
      voci: base.voci,
      gareIncluse: base.gareIncluse,
      inEvidenza: base.inEvidenza,
      prezzoListinoCentesimi: listino,
      prezzoCentesimi: sconto ? sconto.prezzoCentesimi : listino,
      sconto,
    };
  }
  return catalogo;
}
