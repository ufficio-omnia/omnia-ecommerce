// Titolo breve e sintesi in linguaggio semplice di una gara, SENZA modello (fase B1): solo i dati dell'avviso, riordinati. Nessun numero,
// data o nome che non stia già nei dati della fonte. Logica pura, provata da scripts/verifica-radar-b1.ts.
import { nomeSettore, voceCpv, type SettoreRadar } from "./settori";
import { giornoDiRoma } from "./fonti/ted-calcoli";

const RUMORE_INIZIALE: readonly RegExp[] = [
  // «APPALTO 64/2026», «GARA N. 12/2026 -», «(61/2026)», «2852.01.01», «App. 174/26 -», «CUC Trinakria Sud per conto del Comune di X -»
  /^\(?\s*\d[\w./-]*\s*\)?\s*[-–:.]?\s*/i,
  /^(gara|appalto|app\.?|procedura|avviso|bando|lotto|sua|cuc)\s*(n\.?|n°|nr\.?|num\.?)?\s*[\w./-]*\d[\w./-]*\s*[-–:.,]?\s*/i,
  /^gara europea\s+(a\s+)?/i,
  /^(procedura|gara)\s+(aperta|ristretta|negoziata|competitiva)(\s+telematica)?(\s+(sopra|sotto)\s+soglia(\s+(comunitaria|europea|ue))?)?/i,
  /^,?\s*(indetta\s+)?ai sensi dell['’`]?\s*art\.?\s*\d+[^,;]*?36\/2023(\s+e\s+ss\.?\s*mm\.?\s*ii\.?)?\s*[,;-]?\s*/i,
  /^,?\s*(in modalità telematica\s*)?[,;-]?\s*/i,
  /^[-–:,.]\s*/,
  /^(per|relativa a|relativo a|avente ad oggetto|avente per oggetto)\s+/i,
  /^(l['’]\s*|l\s+)?(aggiudicazione|affidamento|affidamento in concessione|concessione)\s+(in concessione\s+)?(del|della|dei|delle|dello|degli|di)\s+/i,
];

function tuttoMaiuscolo(t: string): boolean {
  const lettere = t.replace(/[^\p{L}]/gu, "");
  if (lettere.length < 6) return false;
  const maiuscole = lettere.replace(/[^\p{Lu}]/gu, "").length;
  return maiuscole / lettere.length > 0.8;
}

// Titolo breve dall'oggetto ufficiale: toglie numerazioni, «procedura aperta ai sensi dell'art. …» e «per l'affidamento del», riporta in
// minuscolo i titoli scritti tutti in maiuscolo, accorcia a 90 caratteri a fine parola. Se resta troppo poco, l'oggetto ufficiale accorciato.
// Prima parola che descrive l'oggetto vero: da lì parte il titolo breve (le formule «procedura aperta ai sensi dell'art. … per
// l'affidamento del» stanno quasi sempre prima). Si cerca solo nei primi 300 caratteri.
const ANCORA_OGGETTO = /\b(servizi|servizio|gestione|accordo quadro|fornitura)\b/i;

export function titoloBreve(oggetto: string, massimo = 90): string {
  const originale = oggetto.replace(/\s+/g, " ").trim();
  let t = originale;
  const ancora = originale.slice(0, 300).search(ANCORA_OGGETTO);
  if (ancora > 0) {
    t = originale.slice(ancora);
  } else if (ancora < 0) {
    for (let giro = 0; giro < 4; giro++) {
      const prima = t;
      for (const r of RUMORE_INIZIALE) t = t.replace(r, "").trim();
      if (t === prima) break;
    }
  }
  t = t.replace(/\s*[-–(]?\s*\b(CIG|CUP|CUI)\b\s*[:.]?\s*[0-9A-Z]{6,}\)?/gi, "").replace(/[\s.;,:-]+$/, "").trim();
  if (t.length < 12) t = originale;
  // si guarda la parte che si vedrà: un titolo scritto in maiuscolo con una coda in minuscolo resta «tutto maiuscolo»
  if (tuttoMaiuscolo(t.slice(0, massimo))) t = t.toLowerCase();
  t = t.charAt(0).toUpperCase() + t.slice(1);
  // l'appalto riservato (art. 61, cooperative sociali e simili) è un'informazione che non si perde accorciando
  if (/\b(appalto|procedura|gara)\s+riservat[ao]\b/i.test(originale) && !/riservat/i.test(t)) t = `Appalto riservato: ${t.charAt(0).toLowerCase()}${t.slice(1)}`;
  if (t.length <= massimo) return t;
  const taglio = t.slice(0, massimo - 1);
  const spazio = taglio.lastIndexOf(" ");
  return `${(spazio > massimo * 0.6 ? taglio.slice(0, spazio) : taglio).replace(/[\s.,;:-]+$/, "")}…`;
}

export function euro(n: number | null): string | null {
  if (n === null || !Number.isFinite(n)) return null;
  const intero = Math.abs(n - Math.round(n)) < 0.005;
  return `${n.toLocaleString("it-IT", { minimumFractionDigits: intero ? 0 : 2, maximumFractionDigits: intero ? 0 : 2 })} €`;
}

const FMT_GIORNO = new Intl.DateTimeFormat("it-IT", { timeZone: "Europe/Rome", day: "numeric", month: "long", year: "numeric" });
const FMT_ORA = new Intl.DateTimeFormat("it-IT", { timeZone: "Europe/Rome", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

// «14 dicembre 2026, ore 13:00» con l'ora indicata; «14 dicembre 2026 (ora non indicata)» con il solo giorno. Nessuna ora presunta.
export function scadenzaLeggibile(giorno: string | null, iso: string | null): string | null {
  if (iso) {
    const d = new Date(iso);
    if (!Number.isNaN(d.getTime())) return `${FMT_GIORNO.format(d)}, ore ${FMT_ORA.format(d)}`;
  }
  if (!giorno || !/^\d{4}-\d{2}-\d{2}$/.test(giorno)) return null;
  return `${FMT_GIORNO.format(new Date(`${giorno}T12:00:00Z`))} (ora non indicata)`;
}

// « · scade oggi», « · scade domani», « · tra 12 giorni»; niente per un giorno già passato o una scadenza non indicata.
export function distanzaScadenza(giorni: number | null): string {
  if (giorni === null || giorni < 0) return "";
  if (giorni === 0) return " · scade oggi";
  if (giorni === 1) return " · scade domani";
  return ` · tra ${giorni} giorni`;
}

// Una scadenza come è conservata nel registro dei cambiamenti (giorno «AAAA-MM-GG» oppure istante con l'ora) in parole.
export function leggibileDaValore(v: string | null): string | null {
  if (!v) return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? scadenzaLeggibile(v, null) : scadenzaLeggibile(null, v);
}

// Giorni di calendario (Roma) da oggi al giorno della scadenza: 0 = oggi, 1 = domani, negativo = giorno già passato.
export function giorniAllaScadenza(giorno: string | null, adesso: Date): number | null {
  if (!giorno || !/^\d{4}-\d{2}-\d{2}$/.test(giorno)) return null;
  const oggi = giornoDiRoma(adesso);
  return Math.round((Date.parse(`${giorno}T12:00:00Z`) - Date.parse(`${oggi}T12:00:00Z`)) / 86_400_000);
}

export type DatiSintesi = {
  oggetto: string;
  settori: SettoreRadar[];
  cpvPrincipale: string | null;
  ente: string | null;
  comune: string | null;
  provincia: string | null;
  valoreStimato: number | null;
  durataMesi: number | null;
  nLotti: number | null;
  tipoProcedura: string | null;
  criterio: string | null;
  scadenzaGiorno: string | null;
  // istante della scadenza, solo con l'ora indicata
  scadenza: string | null;
  fonte: string;
  numeroAvviso: string | null;
  dataPubblicazione: string | null;
};

// Tre-cinque frasi brevi, solo con i dati presenti; un dato assente non compare (la tabella sotto dice «non indicato dalla fonte»).
export function sintesiDeterministica(d: DatiSintesi): string[] {
  const frasi: string[] = [];
  const cosa = voceCpv(d.cpvPrincipale)?.descrizione ?? (d.settori[0] ? nomeSettore(d.settori[0]) : null);
  const dove = d.comune ? ` (${d.comune}${d.provincia ? `, ${d.provincia}` : ""})` : "";
  if (cosa && d.ente) frasi.push(`${cosa}: gara indetta da ${d.ente}${dove}.`);
  else if (d.ente) frasi.push(`Gara indetta da ${d.ente}${dove}.`);
  else if (cosa) frasi.push(`${cosa}.`);

  const valore = euro(d.valoreStimato);
  const parti: string[] = [];
  if (valore) parti.push(`valore stimato ${valore}`);
  if (d.durataMesi) parti.push(`durata ${d.durataMesi} mesi`);
  if (d.nLotti && d.nLotti > 1) parti.push(`${d.nLotti} lotti`);
  if (parti.length) frasi.push(`${parti[0].charAt(0).toUpperCase()}${parti.join(", ").slice(1)}.`);

  const proc = [d.tipoProcedura, d.criterio ? `criterio: ${d.criterio.toLowerCase()}` : null].filter(Boolean);
  if (proc.length) frasi.push(`${proc.join(", ")}.`);

  const entro = scadenzaLeggibile(d.scadenzaGiorno, d.scadenza);
  if (entro) frasi.push(`Offerte entro il ${entro}.`);

  if (d.dataPubblicazione) {
    const pub = new Date(`${d.dataPubblicazione}T12:00:00Z`);
    // con il numero dell'avviso (TED) o con la sola data (PVL: l'identificativo interno non si mostra)
    // più fonti (fase B2a): tutte le fonti visibili al cliente, e il rimando a dove si vede da quale fonte viene ogni dato
    if (/ e /.test(d.fonte)) frasi.push(`Fonti: ${d.fonte}; primo avviso pubblicato il ${FMT_GIORNO.format(pub)}. Da quale fonte viene ogni dato: vedi «Da dove vengono i dati».`);
    else frasi.push(d.numeroAvviso ? `Fonte: ${d.fonte}, avviso ${d.numeroAvviso} pubblicato il ${FMT_GIORNO.format(pub)}.` : `Fonte: ${d.fonte}, avviso pubblicato il ${FMT_GIORNO.format(pub)}.`);
  }
  return frasi;
}
