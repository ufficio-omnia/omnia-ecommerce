import { campiDiTestoFigura, LIMITI_FIGURE, leggiFiguraModello, serializzaBloccoFigura, type DatiFigura } from "@/lib/figure-dati";
import { trovaRiferimentiEconomici } from "@/lib/riferimenti-economici";
import { applicaGuardiaValori, type EvidenzaDati } from "@/lib/valori-impresa";

// Costruzione delle FIGURE di una sezione da ciò che dichiara il modello (campo
// "figure" dello strumento) e da ciò che il codice SA da fonti certe. Il modello
// non decide: la numerazione («Figura N»), la piattaforma e le sue funzioni
// (profilo azienda), i colori, le posizioni. Una figura che non regge viene
// scartata con un avviso, mai disegnata a metà. Modulo PURO: i fatti (letti da
// DB in figure-fatti.ts) arrivano come parametro.

export type FattiFigure = {
  // Software gestionale del profilo azienda (null se non dichiarato).
  piattaforma: string | null;
  // Funzioni dichiarate nel profilo, una per voce (può essere vuoto).
  funzioniPiattaforma: string[];
};

export type EsitoFigure = {
  // Un elemento per figura dichiarata, nello stesso ordine: il blocco da
  // inserire nel testo oppure null se la figura è stata scartata.
  blocchi: (string | null)[];
  figure: (DatiFigura | null)[];
  avvisi: string[];
};

// Elenco di funzioni scritto nel profilo: una per riga, senza elenchi puntati.
export function leggiFunzioniPiattaforma(testo: string | null | undefined): string[] {
  if (!testo) return [];
  return testo
    .split(/\r?\n/)
    .map((r) => r.replace(/^[\s\-–—•*·]+/, "").trim())
    .filter((r) => r.length > 0)
    .map((r) => r.slice(0, 90))
    .slice(0, 12);
}

// La schermata di un cruscotto si disegna solo se il profilo dichiara una
// funzione di quel tipo: cruscotto, indicatori, KPI, reportistica, monitoraggio.
export const FUNZIONE_CRUSCOTTO_REGEX = /cruscott|dashboard|indicator|\bkpi\b|report|monitorag|statistic/i;

export function motivoCruscottoNonDisegnabile(fatti: FattiFigure): string | null {
  if (!fatti.piattaforma) return "il profilo azienda non indica nessuna piattaforma gestionale";
  if (fatti.funzioniPiattaforma.length === 0) return "il profilo azienda non dichiara le funzioni della piattaforma";
  if (!fatti.funzioniPiattaforma.some((f) => FUNZIONE_CRUSCOTTO_REGEX.test(f))) return "tra le funzioni della piattaforma dichiarate nel profilo non c'è un cruscotto, degli indicatori o una reportistica";
  return null;
}

// Cosa dire al modello, nel prompt di sistema, sulle figure disponibili per
// QUESTA impresa: il cruscotto dipende da ciò che il profilo dichiara.
export function testoFigureNelPrompt(fatti: FattiFigure | null): string {
  const motivo = fatti ? motivoCruscottoNonDisegnabile(fatti) : "il profilo azienda non è disponibile";
  const cruscotto = motivo
    ? `CRUSCOTTO: NON disponibile per questa impresa (${motivo}). Non dichiarare figure di tipo cruscotto e non descrivere nel testo una schermata della piattaforma.`
    : `CRUSCOTTO: disponibile — la piattaforma dichiarata nel profilo è «${fatti?.piattaforma}», con queste funzioni: ${fatti?.funzioniPiattaforma.join("; ")}. La schermata può mostrare SOLO funzioni di questo elenco e gli obiettivi che vengono dai documenti di gara.`;
  return `FIGURE SCHEMATICHE (vedi il campo 'figure' dello strumento di generazione). ${cruscotto}\n`;
}

// Il modello non deve numerare le figure: se la didascalia comincia con
// «Figura 3 —» il prefisso si toglie, il numero lo assegna il codice.
export function pulisciDidascalia(didascalia: string): string {
  const senza = didascalia.replace(/^\s*(?:figura|fig\.?)\s*\d+\s*[—–:.\-)]*\s*/i, "").trim();
  return senza.charAt(0) === senza.charAt(0).toLowerCase() && senza.length > 0 ? senza.charAt(0).toUpperCase() + senza.slice(1) : senza;
}

// Guardia R9 sui testi liberi di una figura: un valore numerico su prodotti,
// attrezzature, prestazioni o organico senza riscontro riceve l'asterisco di
// "proposta da confermare", come ovunque nel documento. Ritorna i testi marcati.
export function marcaValoriNellaFigura(f: DatiFigura, evidenza: EvidenzaDati): string[] {
  const campi = campiDiTestoFigura(f).filter((c) => c.leggi().trim().length > 0);
  if (campi.length === 0) return [];
  const righe = campi.map((c) => c.leggi().replace(/\s+/g, " "));
  const esito = applicaGuardiaValori(righe.join("\n"), evidenza);
  const nuove = esito.testo.split("\n");
  const marcati: string[] = [];
  campi.forEach((c, i) => {
    const nuovo = nuove[i];
    if (typeof nuovo === "string" && nuovo !== righe[i]) {
      c.scrivi(nuovo.length > 240 ? `${nuovo.slice(0, 239)}…` : nuovo);
      marcati.push(righe[i]);
    }
  });
  return marcati;
}

export function costruisciFigure(raw: unknown, fatti: FattiFigure, opzioni: { evidenza?: EvidenzaDati | null } = {}): EsitoFigure {
  const dichiarate = Array.isArray(raw) ? raw : [];
  const avvisi: string[] = [];
  const blocchi: (string | null)[] = [];
  const figure: (DatiFigura | null)[] = [];

  if (dichiarate.length > LIMITI_FIGURE.figurePerSezione) {
    avvisi.push(`Oltre ${LIMITI_FIGURE.figurePerSezione} figure in una sezione: le ultime non sono state disegnate (una relazione fatta di sole figure non è una relazione).`);
  }

  dichiarate.slice(0, LIMITI_FIGURE.figurePerSezione).forEach((grezza, i) => {
    const etichetta = `Figura ${i + 1}`;
    const { figura, avvisi: avvisiFigura } = leggiFiguraModello(grezza);
    avvisi.push(...avvisiFigura.map((a) => `${etichetta}: ${a}`));
    if (!figura) {
      blocchi.push(null);
      figure.push(null);
      return;
    }

    // La didascalia dice cosa DIMOSTRA la figura; il numero lo mette il codice.
    figura.didascalia = pulisciDidascalia(figura.didascalia);

    // Cruscotto: solo con una piattaforma e una funzione di cruscotto nel profilo;
    // la piattaforma la scrive il codice, mai il modello.
    if (figura.archetipo === "cruscotto") {
      const motivo = motivoCruscottoNonDisegnabile(fatti);
      if (motivo) {
        avvisi.push(`${etichetta} (cruscotto) NON disegnata: ${motivo}. Compila il profilo azienda (software gestionale e funzioni della piattaforma) per poterla inserire.`);
        blocchi.push(null);
        figure.push(null);
        return;
      }
      figura.cruscotto.piattaforma = fatti.piattaforma ?? undefined;
    }

    // R8: nessun riferimento all'offerta economica, nemmeno dentro una figura. Un
    // testo di figura non si riformula (i dati sono strutturati): la figura che
    // lo contiene non si disegna e il modello la riscrive senza.
    const conEconomico = campiDiTestoFigura(figura)
      .map((c) => c.leggi())
      .find((t) => trovaRiferimentiEconomici(t).length > 0);
    if (conEconomico) {
      avvisi.push(`${etichetta} NON disegnata: il testo «${conEconomico.slice(0, 80)}» contiene un riferimento all'offerta economica, vietato in un'offerta tecnica (R8). Riscrivila senza.`);
      blocchi.push(null);
      figure.push(null);
      return;
    }

    if (opzioni.evidenza) {
      const marcati = marcaValoriNellaFigura(figura, opzioni.evidenza);
      if (marcati.length > 0) avvisi.push(`${etichetta}: ${marcati.length} testo/i con un valore numerico senza riscontro sono stati marcati con asterisco (proposta da confermare).`);
    }

    blocchi.push(serializzaBloccoFigura(figura));
    figure.push(figura);
  });

  return { blocchi, figure, avvisi };
}
