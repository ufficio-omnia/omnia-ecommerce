// Regioni italiane e codici NUTS di livello 2 (classificazione dell'Unione europea usata da TED per il luogo di esecuzione e la sede
// dell'ente). Logica pura. Il livello 2 basta a dire la regione senza ambiguità; le province (livello 3) non si ricavano da qui:
// vengono, quando c'è, dalla sigla scritta dall'ente accanto al comune («VENEZIA (VE)»).
// Le due province autonome di Bolzano (ITH1) e Trento (ITH2) appartengono alla stessa regione.

export const REGIONI = [
  { id: "piemonte", nome: "Piemonte", nuts: ["ITC1"] },
  { id: "valle_d_aosta", nome: "Valle d'Aosta", nuts: ["ITC2"] },
  { id: "liguria", nome: "Liguria", nuts: ["ITC3"] },
  { id: "lombardia", nome: "Lombardia", nuts: ["ITC4"] },
  { id: "trentino_alto_adige", nome: "Trentino-Alto Adige", nuts: ["ITH1", "ITH2"] },
  { id: "veneto", nome: "Veneto", nuts: ["ITH3"] },
  { id: "friuli_venezia_giulia", nome: "Friuli-Venezia Giulia", nuts: ["ITH4"] },
  { id: "emilia_romagna", nome: "Emilia-Romagna", nuts: ["ITH5"] },
  { id: "toscana", nome: "Toscana", nuts: ["ITI1"] },
  { id: "umbria", nome: "Umbria", nuts: ["ITI2"] },
  { id: "marche", nome: "Marche", nuts: ["ITI3"] },
  { id: "lazio", nome: "Lazio", nuts: ["ITI4"] },
  { id: "abruzzo", nome: "Abruzzo", nuts: ["ITF1"] },
  { id: "molise", nome: "Molise", nuts: ["ITF2"] },
  { id: "campania", nome: "Campania", nuts: ["ITF3"] },
  { id: "puglia", nome: "Puglia", nuts: ["ITF4"] },
  { id: "basilicata", nome: "Basilicata", nuts: ["ITF5"] },
  { id: "calabria", nome: "Calabria", nuts: ["ITF6"] },
  { id: "sicilia", nome: "Sicilia", nuts: ["ITG1"] },
  { id: "sardegna", nome: "Sardegna", nuts: ["ITG2"] },
] as const;

export type IdRegione = (typeof REGIONI)[number]["id"];

export function nomeRegione(id: string): string | null {
  return REGIONI.find((r) => r.id === id)?.nome ?? null;
}

export function isRegione(id: string): id is IdRegione {
  return REGIONI.some((r) => r.id === id);
}

// «ITH35», «ITH3», « ith35 » → «veneto». Codici non italiani, «ITZ» (extra-regio) o malformati → null.
export function regioneDaNuts(codice: string | null | undefined): IdRegione | null {
  const c = (codice ?? "").trim().toUpperCase();
  if (!/^IT[A-Z0-9]{2,3}$/.test(c)) return null;
  const livello2 = c.slice(0, 4);
  return REGIONI.find((r) => (r.nuts as readonly string[]).includes(livello2))?.id ?? null;
}

// Comune e sigla della provincia dal testo dell'ente: «VENEZIA (VE)» → { comune: "Venezia", provincia: "VE" }. Senza sigla tra parentesi la
// provincia resta vuota (mai indovinata).
export function comuneEProvincia(testo: string | null | undefined): { comune: string | null; provincia: string | null } {
  const t = (testo ?? "").replace(/\s+/g, " ").trim();
  if (!t) return { comune: null, provincia: null };
  const m = t.match(/^(.*?)\s*\(([A-Za-z]{2})\)\s*$/);
  const comune = (m ? m[1] : t).trim();
  return { comune: comune ? maiuscoleIniziali(comune) : null, provincia: m ? m[2].toUpperCase() : null };
}

// «SAN DONÀ DI PIAVE» → «San Donà di Piave»; un testo già scritto con maiuscole e minuscole resta com'è.
export function maiuscoleIniziali(testo: string): string {
  if (testo !== testo.toUpperCase()) return testo;
  const minuscole = new Set(["di", "del", "della", "dei", "delle", "degli", "e", "in", "sul", "sulla", "al", "alla", "d", "da", "dal"]);
  return testo
    .toLowerCase()
    .split(" ")
    .map((p, i) => {
      if (i > 0 && minuscole.has(p)) return p;
      return p.replace(/(^|['’-])(\p{L})/gu, (_, sep: string, l: string) => sep + l.toUpperCase());
    })
    .join(" ");
}
