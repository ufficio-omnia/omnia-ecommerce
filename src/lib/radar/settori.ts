// Settori di Tender Intelligence e classificazione delle gare. Logica pura: nessun database, nessuna rete.
//
// Regole approvate (04_DECISIONI_E_PIANO, §2 e §4):
//   - la mappa CPV → settore viene SOLO dal file approvato (settori-dati.ts, generato da dati/cpv-settori-omnia.csv), con
//     corrispondenza ESATTA sulle 8 cifre, su qualunque CPV della gara;
//   - l'ausiliariato non ha un CPV proprio: si riconosce solo dalle parole dell'oggetto;
//   - una gara che non ha un CPV del file entra solo se l'oggetto contiene le parole chiave del settore e nessuna parola di esclusione,
//     ed è marcata «trovata per parola chiave»;
//   - ogni classificazione porta il suo motivo, da mostrare al cliente (pertinenza spiegabile).
import { CPV_SETTORI_OMNIA } from "./settori-dati";

export const SETTORI_RADAR = [
  { id: "pulizia", nome: "Pulizia e sanificazione" },
  { id: "ristorazione", nome: "Ristorazione collettiva" },
  { id: "vigilanza_portierato", nome: "Vigilanza privata e portierato" },
  { id: "facchinaggio", nome: "Facchinaggio e movimentazione" },
  { id: "multiservizi", nome: "Multiservizi e gestione edifici" },
  { id: "ausiliariato", nome: "Ausiliariato" },
] as const;

export type SettoreRadar = (typeof SETTORI_RADAR)[number]["id"];

export function nomeSettore(id: SettoreRadar): string {
  return SETTORI_RADAR.find((s) => s.id === id)?.nome ?? id;
}

// Il nome del settore come scritto nel CSV → identificativo interno. Un nome sconosciuto è un errore del file (lo intercetta il test).
export function settoreDaNomeFile(nome: string): SettoreRadar | null {
  const trovato = SETTORI_RADAR.find((s) => s.nome.toLowerCase() === nome.trim().toLowerCase());
  return trovato ? trovato.id : null;
}

type VoceCpv = { cpv: string; codice: string; descrizione: string; settore: SettoreRadar };

// Una riga con un settore sconosciuto resta fuori dalla mappa (mai attribuita a un settore a caso): il test la segnala come errore del file.
const MAPPA_CPV: ReadonlyMap<string, VoceCpv> = new Map(
  CPV_SETTORI_OMNIA.flatMap((r) => {
    const settore = settoreDaNomeFile(r.settore);
    return settore ? [[r.cpv, { cpv: r.cpv, codice: r.codice, descrizione: r.descrizione, settore }] as const] : [];
  }),
);

export function vociCpv(): VoceCpv[] {
  return [...MAPPA_CPV.values()];
}

export function cpvDelSettore(settore: SettoreRadar): string[] {
  return vociCpv().filter((v) => v.settore === settore).map((v) => v.cpv);
}

// «90910000-9», «90910000», « 90910000 » → «90910000». Tutto il resto (99999999 compreso, che le fonti usano per «non disponibile») → null.
export function normalizzaCpv(valore: string | null | undefined): string | null {
  const m = (valore ?? "").trim().match(/^(\d{8})(?:-\d)?$/);
  if (!m || m[1] === "99999999") return null;
  return m[1];
}

export function voceCpv(cpv: string | null | undefined): VoceCpv | null {
  const n = normalizzaCpv(cpv);
  return n ? MAPPA_CPV.get(n) ?? null : null;
}

// ───── parole chiave (oggetto e descrizione) ─────

// Testo per il confronto: minuscole, senza accenti, spazi semplici.
export function testoPerConfronto(testo: string | null | undefined): string {
  return (testo ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

type RegolaParole = { settore: SettoreRadar; cerca: RegExp; escludi: RegExp | null; esempio: string };

// Le esclusioni vengono dai casi reali dello spike (02, §4.1 e 04, §4.1): «pulizia» compare anche in fognature, strade, rifiuti; «mensa» nei
// buoni pasto e negli arredi; «vigilanza» nella videosorveglianza e negli impianti. «Custodia» non è tra le parole: catturava canili e cimiteri.
export const REGOLE_PAROLE: readonly RegolaParole[] = [
  {
    settore: "pulizia",
    cerca: /\b(pulizi[ae]|sanificazion[ei]|disinfezion[ei]|disinfestazion[ei]|igiene ambientale)\b/,
    escludi: /\b(strad\w*|fognat\w*|fogn\w*|caditoi\w*|spurg\w*|rifiut\w*|spiagg\w*|arenil\w*|alve\w*|neve|prodott\w*|material\w*|cassonett\w*)\b/,
    esempio: "pulizia, sanificazione, disinfestazione",
  },
  {
    settore: "ausiliariato",
    cerca: /\b(ausiliariato|servizi ausiliari|servizio ausiliario|servizio di ausiliariato)\b/,
    escludi: null,
    esempio: "ausiliariato, servizi ausiliari",
  },
  {
    settore: "facchinaggio",
    cerca: /\b(facchinaggio|trasloco|traslochi|movimentazione (di )?arredi)\b/,
    escludi: /\b(movimentazione (di )?terra|rifiut\w*|container\w*)\b/,
    esempio: "facchinaggio, trasloco",
  },
  {
    settore: "ristorazione",
    cerca: /\b(ristorazione|mensa|mense|refezione|pasti)\b/,
    escludi: /\b(buon[oi] pasto|ticket\w*|attrezzatur\w*|arred\w*|derrat\w*)\b/,
    esempio: "ristorazione, mensa, refezione",
  },
  {
    settore: "vigilanza_portierato",
    cerca: /\b(vigilanza|portierato|portineria|guardiania|reception)\b/,
    escludi: /\b(videosorveglianza|impiant\w*|manutenzion\w*|attraversament\w*|scuolabus)\b/,
    esempio: "vigilanza, portierato, guardiania",
  },
  {
    settore: "multiservizi",
    cerca: /\b(multiservizi|global service|facility management|servizi integrati)\b/,
    escludi: null,
    esempio: "multiservizi, global service",
  },
];

export function settoriDaParole(testo: string | null | undefined): SettoreRadar[] {
  const t = testoPerConfronto(testo);
  if (!t) return [];
  return REGOLE_PAROLE.filter((r) => r.cerca.test(t) && !(r.escludi && r.escludi.test(t))).map((r) => r.settore);
}

// ───── classificazione di una gara ─────

export type Classificazione = {
  settori: SettoreRadar[];
  // settore principale: quello del CPV principale se è nel file, altrimenti il primo trovato
  settorePrincipale: SettoreRadar | null;
  metodo: "cpv" | "parole_chiave" | null;
  // un motivo per settore, in parole semplici («CPV 90919200 Servizi di pulizia di uffici»)
  motivi: string[];
  cpvRiconosciuti: string[];
};

export function classificaGara(dati: { cpvPrincipale?: string | null; cpvTutti?: readonly (string | null | undefined)[]; testo?: string | null }): Classificazione {
  const principale = normalizzaCpv(dati.cpvPrincipale);
  const tutti = [...new Set([principale, ...(dati.cpvTutti ?? []).map(normalizzaCpv)].filter((c): c is string => !!c))];
  const voci = tutti.map((c) => MAPPA_CPV.get(c)).filter((v): v is VoceCpv => !!v);
  const settoriParole = settoriDaParole(dati.testo);

  if (voci.length > 0) {
    const settori = [...new Set(voci.map((v) => v.settore))];
    // l'ausiliariato non ha CPV: se le parole lo indicano si aggiunge, con il suo motivo
    const conAusiliariato = settoriParole.includes("ausiliariato") && !settori.includes("ausiliariato") ? [...settori, "ausiliariato" as const] : settori;
    const vocePrincipale = principale ? MAPPA_CPV.get(principale) : undefined;
    const motivi = voci.map((v) => `CPV ${v.cpv} ${v.descrizione}`);
    if (conAusiliariato.length > settori.length) motivi.push("Oggetto che parla di ausiliariato");
    return {
      settori: conAusiliariato,
      settorePrincipale: vocePrincipale?.settore ?? conAusiliariato[0],
      metodo: "cpv",
      motivi,
      cpvRiconosciuti: voci.map((v) => v.cpv),
    };
  }

  if (settoriParole.length > 0) {
    return {
      settori: settoriParole,
      settorePrincipale: settoriParole[0],
      metodo: "parole_chiave",
      motivi: settoriParole.map((s) => `Trovata per parola chiave: ${nomeSettore(s).toLowerCase()}`),
      cpvRiconosciuti: [],
    };
  }

  return { settori: [], settorePrincipale: null, metodo: null, motivi: [], cpvRiconosciuti: [] };
}
