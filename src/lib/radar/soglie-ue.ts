// Soglia UE applicabile a una gara, per spiegare al cliente perché la trova (o non la trova) su TED. Logica pura.
//
// Fonti (04_DECISIONI_E_PIANO, §4.3):
//   - 140.000 / 216.000 / 432.000 / 5.404.000 € dal 1/1/2026: Regolamenti delegati (UE) 2025/2150, 2025/2151, 2025/2152, in GUUE il 23/10/2025
//     (letti su fonti secondarie: ANCE, lavoripubblici.it);
//   - 750.000 € per i servizi dell'allegato XIV della direttiva 2014/24 (art. 4, lett. d), non soggetta a revisione biennale;
//   - 1.000.000 € per gli stessi servizi nei settori speciali (allegato XVII della direttiva 2014/25): NON verificata, quindi non si usa.
// L'allegato XIV elenca CODICI CPV, non settori: qui ci sono solo gli intervalli e i codici verificati sul testo (hotel e ristorazione,
// investigazione e sicurezza). Per un CPV fuori da questi elenchi e fuori dal file approvato l'esito è «non determinato».
import { normalizzaCpv, voceCpv } from "./settori";

export type PeriodoSoglie = {
  dal: string; // AAAA-MM-GG, incluso
  al: string; // AAAA-MM-GG, incluso
  serviziFornitureCentrali: number;
  serviziFornitureSubCentrali: number;
  serviziFornitureSettoriSpeciali: number;
  lavori: number;
  fonte: string;
};

export const PERIODI_SOGLIE: readonly PeriodoSoglie[] = [
  {
    dal: "2026-01-01",
    al: "2027-12-31",
    serviziFornitureCentrali: 140_000,
    serviziFornitureSubCentrali: 216_000,
    serviziFornitureSettoriSpeciali: 432_000,
    lavori: 5_404_000,
    fonte: "Regolamenti delegati (UE) 2025/2150, 2025/2151 e 2025/2152",
  },
];

export const SOGLIA_ALLEGATO_XIV = 750_000;

// Intervalli e codici dell'allegato XIV verificati sul testo della direttiva (copia di legislation.gov.uk, da ricontrollare su EUR-Lex).
const ALLEGATO_XIV_INTERVALLI: readonly [string, string][] = [
  ["55100000", "55410000"],
  ["55521000", "55521200"],
  ["79700000", "79721000"],
];
const ALLEGATO_XIV_CODICI: ReadonlySet<string> = new Set(["55510000", "55511000", "55512000", "55520000", "55523000", "55523100", "55524000", "79722000", "79723000"]);

export type EsitoAllegatoXIV = "si" | "no" | "non_determinato";

export function allegatoXIV(cpv: string | null | undefined): EsitoAllegatoXIV {
  const c = normalizzaCpv(cpv);
  if (!c) return "non_determinato";
  if (ALLEGATO_XIV_CODICI.has(c)) return "si";
  const n = Number(c);
  if (ALLEGATO_XIV_INTERVALLI.some(([da, a]) => n >= Number(da) && n <= Number(a))) return "si";
  // i codici del file approvato sono stati confrontati uno per uno con il testo dell'allegato (04, §4.3): fuori dagli elenchi sopra = no
  if (voceCpv(c)) return "no";
  return "non_determinato";
}

export type TipoEnte = "centrale" | "sub_centrale" | "settori_speciali";
export type NaturaContratto = "servizi" | "forniture" | "lavori";

export type SogliaApplicabile =
  | { determinata: true; importo: number; spiegazione: string; fonte: string }
  | { determinata: false; motivo: string };

export function periodoSoglie(data: string): PeriodoSoglie | null {
  const giorno = data.slice(0, 10);
  return PERIODI_SOGLIE.find((p) => giorno >= p.dal && giorno <= p.al) ?? null;
}

// tipoEnte: «settori_speciali» se la fonte lo dice; «centrale» solo se l'ente è nell'elenco configurato delle autorità centrali; altrimenti
// «sub_centrale». La decisione su tipo di ente e natura del contratto la prende chi chiama: qui solo la regola.
export function sogliaApplicabile(dati: { natura: NaturaContratto | null; tipoEnte: TipoEnte; cpvPrincipale: string | null; dataPubblicazione: string }): SogliaApplicabile {
  const periodo = periodoSoglie(dati.dataPubblicazione);
  if (!periodo) return { determinata: false, motivo: "Soglie non disponibili per la data di pubblicazione" };
  if (!dati.natura) return { determinata: false, motivo: "Natura del contratto non indicata dalla fonte" };
  if (dati.natura === "lavori") {
    return { determinata: true, importo: periodo.lavori, spiegazione: "lavori", fonte: periodo.fonte };
  }
  if (dati.natura === "servizi") {
    const xiv = allegatoXIV(dati.cpvPrincipale);
    if (xiv === "si") {
      if (dati.tipoEnte === "settori_speciali") return { determinata: false, motivo: "Servizi dell'allegato XVII nei settori speciali: soglia non ancora verificata" };
      return { determinata: true, importo: SOGLIA_ALLEGATO_XIV, spiegazione: "servizi sociali e altri servizi specifici (allegato XIV)", fonte: "Direttiva 2014/24/UE, art. 4, lett. d)" };
    }
    if (xiv === "non_determinato") return { determinata: false, motivo: "Non è stato possibile stabilire se il servizio rientra nell'allegato XIV" };
  }
  const importo =
    dati.tipoEnte === "settori_speciali" ? periodo.serviziFornitureSettoriSpeciali : dati.tipoEnte === "centrale" ? periodo.serviziFornitureCentrali : periodo.serviziFornitureSubCentrali;
  const chi = dati.tipoEnte === "settori_speciali" ? "settori speciali" : dati.tipoEnte === "centrale" ? "autorità governativa centrale" : "ente sub-centrale";
  return { determinata: true, importo, spiegazione: `${dati.natura}, ${chi}`, fonte: periodo.fonte };
}

export type ConfrontoSoglia = { esito: "sopra" | "sotto" | "non_determinabile"; frase: string };

function euro(n: number): string {
  return `${n.toLocaleString("it-IT", { maximumFractionDigits: 0, useGrouping: true })} €`;
}

// Il valore da confrontare è il valore stimato complessivo della procedura (opzioni, rinnovi e lotti compresi). Le fonti lo danno in modo
// imperfetto: la frase lo dichiara sempre come stima.
export function confrontaConSoglia(valoreStimato: number | null, soglia: SogliaApplicabile): ConfrontoSoglia {
  if (!soglia.determinata) return { esito: "non_determinabile", frase: `Soglia UE non determinata: ${soglia.motivo.toLowerCase()}.` };
  const base = `Soglia UE applicabile (stima): ${euro(soglia.importo)}, ${soglia.spiegazione}.`;
  if (valoreStimato === null || !Number.isFinite(valoreStimato) || valoreStimato <= 0) return { esito: "non_determinabile", frase: `${base} Valore stimato non indicato dalla fonte.` };
  if (valoreStimato >= soglia.importo) return { esito: "sopra", frase: `${base} Valore stimato ${euro(valoreStimato)}: sopra soglia, la pubblicazione su TED è obbligatoria.` };
  return { esito: "sotto", frase: `${base} Valore stimato ${euro(valoreStimato)}: sotto soglia, la pubblicazione su TED non è obbligatoria.` };
}
