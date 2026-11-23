// Fonti di una gara come le vede il cliente (fase B1-bis): quali fonti l'hanno pubblicata, il collegamento ufficiale di ciascuna, quando
// l'abbiamo letta e verificata, e da quale fonte viene ogni dato principale. Logica pura, provata da scripts/verifica-radar-pvl.ts.
import { FONTI_UNITE, eFonteUnita, type FonteUnita, type ProvenienzaCampi } from "./unione-calcoli";

// Fase B2a: le fonti di una gara sono quelle del motore di unione (TED, PVL, Sintel, SardegnaCAT).
export type FonteGara = FonteUnita;

export const NOME_FONTE: Record<FonteGara, string> = { ted: "TED", pvl: "PVL ANAC", sintel: "Sintel", sardegnacat: "SardegnaCAT" };
export const NOME_FONTE_ESTESO: Record<FonteGara, string> = {
  ted: "TED, Gazzetta ufficiale dell'Unione europea",
  pvl: "ANAC, Piattaforma di pubblicità a valore legale",
  sintel: "Sintel, piattaforma di e-procurement della Regione Lombardia (dati aperti)",
  sardegnacat: "SardegnaCAT, piattaforma di e-procurement della Regione Sardegna (feed pubblico dei bandi)",
};
export const ATTRIBUZIONE_FONTE: Record<FonteGara, string> = {
  ted: "TED, Ufficio delle pubblicazioni dell'Unione europea (riuso libero citando la fonte)",
  pvl: "ANAC, Piattaforma di pubblicità a valore legale (lettura sperimentale)",
  // uguali a quelle dei connettori (sintel-calcoli.ts, aflink-calcoli.ts): lo controlla verifica-radar-b2a; qui scritte per intero per non
  // portare i connettori nelle pagine del cliente
  sintel: "Regione Lombardia – Open Data Lombardia (Sintel), licenza CC0 1.0",
  sardegnacat: "Regione Autonoma della Sardegna – SardegnaCAT (feed RSS pubblico dei bandi)",
};

const eFonte = eFonteUnita;

/**
 * Le fonti che, SENZA un'indicazione del database (riga mancante in radar_fonti_stato, o errore di lettura), restano nascoste ai clienti.
 * SardegnaCAT finché manca il parere sulla licenza del feed; la PVL per la decisione 7.14 (L5a del piano 36: nascosta durante sviluppo,
 * collaudi e primo deploy protetto). Una riga esplicita del database vale sempre di più (sullo staging la riga «pvl» è «nascosta» dal 23/11).
 */
export const FONTI_NASCOSTE_PREDEFINITE: readonly FonteGara[] = ["sardegnacat", "pvl"];

/** LA regola unica delle fonti nascoste (pagine e motore delle notifiche): la riga del database se c'è, altrimenti la predefinita. */
export function fontiNascosteDa(righe: readonly { fonte: string; nascosta_ai_clienti: boolean | null }[]): FonteGara[] {
  const indicate = new Map(righe.map((r) => [r.fonte, r.nascosta_ai_clienti]));
  return FONTI_UNITE.filter((f) => indicate.get(f) ?? FONTI_NASCOSTE_PREDEFINITE.includes(f));
}

// Righe INTERNE del registro dei cambiamenti: suggerimenti di unione e segnalazioni di classificazione da verificare. Le vede solo
// l'amministratore in console; nella scheda della gara non compaiono mai (senza questo filtro comparirebbero come «Rettifica»).
export const CAMPO_CLASSIFICAZIONE_AMBIGUA = "classificazione_ambigua";
export const CAMPI_INTERNI_REGISTRO: readonly string[] = ["collegamento_proposto", "collegamento_proposta_decisa", CAMPO_CLASSIFICAZIONE_AMBIGUA];

// Una riga del registro si mostra al cliente solo se non è interna e non viene da una fonte nascosta ai clienti (0120).
export function aggiornamentoPerCliente(a: { campo: string | null; fonte: string }, nascoste: ReadonlySet<string>): boolean {
  return !(a.campo !== null && CAMPI_INTERNI_REGISTRO.includes(a.campo)) && !nascoste.has(a.fonte);
}

// Una gara si mostra ai clienti solo se almeno una delle sue fonti è visibile (controllo di accettazione 6 dell'utente). Le gare di prima
// della 0120 hanno le fonti riempite dalla migrazione; in mancanza vale la fonte della chiave.
export function garaVisibileAiClienti(g: { fonti?: readonly string[] | null; chiave: string }, nascoste: ReadonlySet<string>): boolean {
  const fonti = g.fonti && g.fonti.length > 0 ? g.fonti : [g.chiave.split(":")[0]];
  return fonti.some((f) => !nascoste.has(f));
}

// Le fonti che il cliente può vedere: tutte meno quelle nascoste (radar_fonti_stato.nascosta_ai_clienti, migrazione 0120).
export function fontiVisibili<T>(elementi: readonly T[], fonteDi: (x: T) => string, nascoste: ReadonlySet<string>): T[] {
  return elementi.filter((x) => !nascoste.has(fonteDi(x)));
}

// Le fonti di una gara dagli elementi già letti con la riga (nessuna richiesta in più): la provenienza dei campi e la chiave.
export function fontiDellaGara(chiave: string, provenienza: ProvenienzaCampi | null | undefined): FonteGara[] {
  const s = new Set<FonteGara>();
  for (const p of Object.values(provenienza ?? {})) if (p && eFonte(p.f)) s.add(p.f);
  if (s.size === 0) {
    const prefisso = chiave.split(":")[0];
    s.add(eFonte(prefisso) ? prefisso : "ted");
  }
  return FONTI_UNITE.filter((f) => s.has(f));
}

export function etichettaFonti(fonti: readonly FonteGara[]): string {
  return fonti.map((f) => NOME_FONTE[f]).join(" e ");
}

// Da quale fonte viene un dato (gruppo di unione-calcoli.ts); per le gare di prima della 0115 la sola fonte della gara.
export function fonteDelDato(provenienza: ProvenienzaCampi | null | undefined, gruppo: string, chiave: string): FonteGara {
  const p = provenienza?.[gruppo];
  if (p && eFonte(p.f)) return p.f;
  return fontiDellaGara(chiave, provenienza)[0];
}

export type AvvisoLetto = { fonte: string; id_fonte: string; url: string | null; pubblicato_il: string | null; tipo_avviso: string | null; rilevato_il: string; aggiornato_il?: string | null };

// «TED 787530-2026», «PVL ANAC, bando», «PVL ANAC, esito».
export function descriviAvvisoLetto(a: Pick<AvvisoLetto, "fonte" | "id_fonte" | "tipo_avviso">): string {
  if (a.fonte === "pvl") {
    const t = a.tipo_avviso ?? "";
    const tipo = /^(A\d|NAG)/.test(t) ? "esito" : /^P[12]_/.test(t) ? "bando" : "avviso";
    return `${NOME_FONTE.pvl}, ${tipo}${t ? ` (scheda ${t})` : ""}`;
  }
  // piattaforme: «Sintel, procedura 226427680»
  if (a.fonte === "sintel" || a.fonte === "sardegnacat") return `${NOME_FONTE[a.fonte]}, procedura ${a.id_fonte}`;
  return `${NOME_FONTE.ted} ${a.id_fonte}`;
}

export type RiepilogoFonte = {
  fonte: FonteGara;
  nome: string;
  // avviso principale: il bando più recente letto da quella fonte (collegamento alla pubblicazione ufficiale)
  url: string | null;
  etichettaAvviso: string;
  avvisi: number;
  primaPubblicazione: string | null;
  // ultima lettura di un avviso di questa gara, e ultimo controllo riuscito della fonte (giro senza errori)
  lettaIl: string | null;
  verificataIl: string | null;
};

function eEsito(a: Pick<AvvisoLetto, "fonte" | "tipo_avviso">): boolean {
  const t = a.tipo_avviso ?? "";
  if (a.fonte === "pvl") return /^(A\d|NAG)/.test(t);
  return a.fonte === "ted" ? t.startsWith("can") : false;
}

export function riepilogoFonti(avvisi: readonly AvvisoLetto[], controlli: Readonly<Record<string, string | null>>): RiepilogoFonte[] {
  const out: RiepilogoFonte[] = [];
  for (const fonte of FONTI_UNITE) {
    const suoi = avvisi.filter((a) => a.fonte === fonte);
    if (suoi.length === 0) continue;
    const bandi = suoi.filter((a) => !eEsito(a));
    const principale = [...(bandi.length ? bandi : suoi)].sort((a, b) => (b.pubblicato_il ?? "").localeCompare(a.pubblicato_il ?? ""))[0];
    const date = suoi.map((a) => a.pubblicato_il).filter((d): d is string => !!d).sort();
    const letture = suoi.map((a) => a.aggiornato_il ?? a.rilevato_il).filter(Boolean).sort();
    out.push({
      fonte,
      nome: NOME_FONTE_ESTESO[fonte],
      url: principale.url,
      etichettaAvviso: descriviAvvisoLetto(principale),
      avvisi: suoi.length,
      primaPubblicazione: date[0] ?? null,
      lettaIl: letture.at(-1) ?? null,
      verificataIl: controlli[fonte] ?? null,
    });
  }
  return out;
}
