// Impatto grafico minimo della prosa, garantito dal CODICE (nessun modello).
// Una commissione che legge decine di offerte scorre il testo cercando gli
// elementi che contano: valori, ruoli, norme. Un paragrafo liscio, tutto uguale,
// non offre nulla a cui l'occhio possa agganciarsi. Il prompt lo chiede
// (R16/R21) ma, come per le icone, il modello lo fa a macchia di leopardo:
// questa guardia completa SOLO i paragrafi e le voci di elenco che non hanno
// nessuna evidenziazione, e solo con elementi già nel testo:
//  - valori con la loro unità («entro 30 minuti», «24 ore», «99 %») → **grassetto**;
//  - ruoli e figure (Responsabile di Commessa, Caposquadra, DEC, quelli
//    dell'organigramma dichiarato) → !!ruolo!! (colorato, convenzione
//    dell'archivio);
//  - norme e riferimenti (UNI EN ISO 14001, D.Lgs. 36/2023, art. 12) → **grassetto**.
// Non tocca titoli, tabelle, riquadri, figure, note né paragrafi che hanno già
// un'evidenziazione scritta dal modello; non cambia una parola; riapplicata sul
// proprio risultato non cambia più nulla.
import { leggiDichiarazioneModello } from "@/lib/organigramma-dati";

export type EsitoEvidenziazione = {
  testo: string;
  // paragrafi o voci di elenco che non avevano nessuna evidenziazione
  paragrafiEvidenziati: number;
  evidenziazioni: number;
};

// Ruoli ricorrenti nelle offerte di pulizia, dal più lungo al più corto (il
// confronto prende il primo che combacia): gli altri arrivano dall'organigramma.
const RUOLI_COMUNI = [
  "Direttore dell'Esecuzione del Contratto",
  "Direttore dell'Esecuzione",
  "Responsabile di Commessa",
  "Responsabile del Servizio",
  "Responsabile della Sicurezza",
  "Responsabile Qualità",
  "Coordinatore Operativo",
  "Coordinatore di Presidio",
  "Coordinatore di Zona",
  "Ispettore Qualità",
  "Capo squadra",
  "Caposquadra",
  "Coordinatore",
  "Referente",
  "Preposto",
  "RSPP",
  "RUP",
  "DEC",
];

const UNITA = "%|ore|ora|minuti|minuto|min|secondi|giorni|giorno|settimane|settimana|mesi|mese|anni|anno|mq|m²|litri|kg|addetti|operatori|volte|sedi|persone|unità|interventi|turni";
const PREFISSI = "entro|ogni|almeno|oltre|fino a|non oltre|non meno di|massimo|minimo|circa";
const VALORE = new RegExp(`(?<![\\w*!/.,])(?:(?:${PREFISSI})\\s+)?\\d{1,3}(?:[.,]\\d{3})*(?:[.,]\\d+)?\\s?(?:${UNITA})(?![\\w])`, "gi");
const NORMA = /(?<![\w*!])(?:UNI\s+(?:EN\s+)?(?:ISO\s+)?\d{3,6}(?::\d{4})?|ISO\s+\d{4,6}(?::\d{4})?|D\.?\s?Lgs\.?\s+\d+\/\d{4}|D\.?\s?M\.?\s+\d+\s+\w+\s+\d{4}|(?:art|artt)\.\s?\d+(?:\.\d+)?(?:,?\s*comma\s+\d+)?|CAM\b|Ecolabel(?:\s+UE)?|EMAS)/g;

// Una riga di prosa o una voce di elenco: non titoli, tabelle, tag, note.
const NON_PROSA = /^(\||#{1,6}\s|\*[^*]|\\\*|\[(?:BOX|\/BOX|TABELLA|FIGURA|ORGANIGRAMMA|\/ORGANIGRAMMA|RIGA|CELLA)\b)/i;
const GIA_EVIDENZIATO = /\*\*[^*]+\*\*|!![^!]+!!/;
// Parti che non si toccano: grassetti e ruoli già scritti, tag [..], link.
const PARTI_PROTETTE = /(\*\*[^*]+\*\*|!![^!]+!!|\[[^\]]*\]|https?:\/\/\S+)/;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Ruoli della bozza: quelli comuni più le denominazioni dichiarate nell'organigramma.
export function ruoliDaOrganigramma(raw: unknown): string[] {
  if (!raw) return [];
  const d = leggiDichiarazioneModello(raw);
  const nomi: string[] = [];
  if (d.figuraApicale) nomi.push(d.figuraApicale.denominazione);
  if (d.vice) nomi.push(d.vice.denominazione);
  for (const s of d.staffGoverno) nomi.push(s.denominazione);
  for (const z of d.coordinamento) {
    nomi.push(z.denominazione);
    for (const s of z.sottolivelli) nomi.push(s.denominazione);
  }
  // un ruolo di una parola sola e minuscola sarebbe una parola comune: si tengono solo denominazioni con l'iniziale maiuscola
  return nomi.filter((n) => /^[A-ZÀ-Ý]/.test(n) && n.length >= 5);
}

function costruisciRegexRuoli(ruoli: string[]): RegExp {
  const tutti = [...new Set([...ruoli, ...RUOLI_COMUNI])].sort((a, b) => b.length - a.length);
  return new RegExp(`(?<![\\w!*/])(${tutti.map(escapeRegExp).join("|")})(?![\\w])`, "g");
}

// Applica la trasformazione ai soli frammenti NON protetti di una riga.
function sullaRiga(riga: string, trasforma: (frammento: string) => string): string {
  return riga
    .split(PARTI_PROTETTE)
    .map((parte, i) => (i % 2 === 1 ? parte : trasforma(parte)))
    .join("");
}

function evidenziaRiga(riga: string, regexRuoli: RegExp): { riga: string; n: number } {
  let n = 0;
  let ruoliMessi = 0;
  let valoriMessi = 0;
  let normeMesse = 0;
  const visti = new Set<string>();

  // 1. ruoli: la prima occorrenza di ciascuno, al massimo due per riga
  let r = sullaRiga(riga, (f) =>
    f.replace(regexRuoli, (tutto) => {
      if (ruoliMessi >= 2 || visti.has(tutto)) return tutto;
      visti.add(tutto);
      ruoliMessi++;
      n++;
      return `!!${tutto}!!`;
    }),
  );
  // 2. valori con l'unità, al massimo tre: l'eventuale asterisco R9 resta fuori dal grassetto
  r = sullaRiga(r, (f) =>
    f.replace(VALORE, (tutto) => {
      if (valoriMessi >= 3) return tutto;
      valoriMessi++;
      n++;
      return `**${tutto.trim()}**`;
    }),
  );
  // 3. norme e riferimenti, al massimo tre
  r = sullaRiga(r, (f) =>
    f.replace(NORMA, (tutto) => {
      if (normeMesse >= 3) return tutto;
      normeMesse++;
      n++;
      return `**${tutto}**`;
    }),
  );
  return { riga: r, n };
}

export function evidenziaProsaMancante(testo: string, opzioni: { ruoli?: string[] } = {}): EsitoEvidenziazione {
  const regexRuoli = costruisciRegexRuoli(opzioni.ruoli ?? []);
  const righe = testo.split("\n");
  let dentroBlocco: "box" | "figura" | "organigramma" | null = null;
  let paragrafiEvidenziati = 0;
  let evidenziazioni = 0;

  // Un paragrafo è un gruppo di righe consecutive; una voce di elenco vale da sola.
  let i = 0;
  while (i < righe.length) {
    const t = righe[i].trim();
    if (dentroBlocco) {
      if ((dentroBlocco === "box" && /^\[\/BOX\]/i.test(t)) || (dentroBlocco === "figura" && /\[\/FIGURA\]/i.test(t)) || (dentroBlocco === "organigramma" && /\[\/ORGANIGRAMMA\]/i.test(t))) dentroBlocco = null;
      i++;
      continue;
    }
    if (/^\[BOX(?::[^\]]*)?\]/i.test(t)) {
      dentroBlocco = /\[\/BOX\]/i.test(t) ? null : "box";
      i++;
      continue;
    }
    if (/^\[FIGURA\]/i.test(t)) {
      dentroBlocco = /\[\/FIGURA\]/i.test(t) ? null : "figura";
      i++;
      continue;
    }
    if (/^\[ORGANIGRAMMA\]/i.test(t)) {
      dentroBlocco = /\[\/ORGANIGRAMMA\]/i.test(t) ? null : "organigramma";
      i++;
      continue;
    }
    if (t === "" || NON_PROSA.test(t) || /^\[FIGURA:/i.test(t)) {
      i++;
      continue;
    }

    // voce di elenco: una per volta; altrimenti il paragrafo fino alla riga vuota
    const eElenco = /^[-•]\s+/.test(t);
    let fine = i + 1;
    if (!eElenco) while (fine < righe.length && righe[fine].trim() !== "" && !NON_PROSA.test(righe[fine].trim()) && !/^[-•]\s+/.test(righe[fine].trim())) fine++;
    const gruppo = righe.slice(i, fine).join("\n");
    if (!GIA_EVIDENZIATO.test(gruppo)) {
      let toccato = 0;
      for (let k = i; k < fine; k++) {
        const esito = evidenziaRiga(righe[k], regexRuoli);
        righe[k] = esito.riga;
        toccato += esito.n;
      }
      if (toccato > 0) {
        paragrafiEvidenziati++;
        evidenziazioni += toccato;
      }
    }
    i = fine;
  }
  return { testo: righe.join("\n"), paragrafiEvidenziati, evidenziazioni };
}
