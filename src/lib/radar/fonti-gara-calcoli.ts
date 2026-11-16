// Fonti di una gara come le vede il cliente (fase B1-bis): quali fonti l'hanno pubblicata, il collegamento ufficiale di ciascuna, quando
// l'abbiamo letta e verificata, e da quale fonte viene ogni dato principale. Logica pura, provata da scripts/verifica-radar-pvl.ts.
import type { ProvenienzaCampi } from "./unione-calcoli";

export type FonteGara = "ted" | "pvl";

export const NOME_FONTE: Record<FonteGara, string> = { ted: "TED", pvl: "PVL ANAC" };
export const NOME_FONTE_ESTESO: Record<FonteGara, string> = {
  ted: "TED, Gazzetta ufficiale dell'Unione europea",
  pvl: "ANAC, Piattaforma di pubblicità a valore legale",
};
export const ATTRIBUZIONE_FONTE: Record<FonteGara, string> = {
  ted: "TED, Ufficio delle pubblicazioni dell'Unione europea (riuso libero citando la fonte)",
  pvl: "ANAC, Piattaforma di pubblicità a valore legale (lettura sperimentale)",
};

function eFonte(x: unknown): x is FonteGara {
  return x === "ted" || x === "pvl";
}

// Le fonti di una gara dagli elementi già letti con la riga (nessuna richiesta in più): la provenienza dei campi e la chiave.
export function fontiDellaGara(chiave: string, provenienza: ProvenienzaCampi | null | undefined): FonteGara[] {
  const s = new Set<FonteGara>();
  for (const p of Object.values(provenienza ?? {})) if (p && eFonte(p.f)) s.add(p.f);
  if (s.size === 0) s.add(chiave.startsWith("pvl:") ? "pvl" : "ted");
  return (["ted", "pvl"] as const).filter((f) => s.has(f));
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
  return a.fonte === "pvl" ? /^(A\d|NAG)/.test(t) : t.startsWith("can");
}

export function riepilogoFonti(avvisi: readonly AvvisoLetto[], controlli: Readonly<Record<string, string | null>>): RiepilogoFonte[] {
  const out: RiepilogoFonte[] = [];
  for (const fonte of ["ted", "pvl"] as const) {
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
