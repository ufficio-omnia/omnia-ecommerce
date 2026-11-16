// «Aggiungi gara a mano» (04, §5): validazione di ciò che scrive il cliente. Logica pura, provata da scripts/verifica-radar-b1.ts.
// Ingresso: CIG (10 caratteri alfanumerici) oppure collegamento alla gara; facoltativi oggetto, ente, scadenza (giorno e, se nota, ora),
// importo. Il collegamento si salva e si mostra, ma non viene MAI aperto dal server (D10 e robots.txt delle piattaforme).
import { fineGiornoRoma } from "./fonti/ted-calcoli";

export type GaraAggiuntaValida = {
  cig: string | null;
  url: string | null;
  oggetto: string | null;
  ente: string | null;
  scadenzaOfferte: string | null;
  scadenzaOraIndicata: boolean;
  importo: number | null;
};

export type EsitoValidazione = { ok: true; valori: GaraAggiuntaValida } | { ok: false; errore: string };

const testoBreve = (v: string, max: number) => {
  const t = v.replace(/\s+/g, " ").trim();
  return t ? t.slice(0, max) : null;
};

// Istante della scadenza scritta dal cliente: giorno (AAAA-MM-GG) e ora facoltativa (HH:MM), ora di Roma. Senza ora: fine del giorno
// (solo per sapere quando scade), e l'ora non si mostra.
export function scadenzaDaCampi(giorno: string, ora: string): { iso: string; oraIndicata: boolean } | null | "errore" {
  const g = giorno.trim();
  const o = ora.trim();
  if (!g) return o ? "errore" : null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(g) || Number.isNaN(Date.parse(`${g}T12:00:00Z`))) return "errore";
  if (!o) return { iso: fineGiornoRoma(g), oraIndicata: false };
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(o)) return "errore";
  for (const fuso of ["+01:00", "+02:00"]) {
    const d = new Date(`${g}T${o}:00${fuso}`);
    const visto = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Rome", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d);
    if (visto === o) return { iso: d.toISOString(), oraIndicata: true };
  }
  return "errore";
}

export function validaGaraAggiunta(campi: { cig: string; url: string; oggetto: string; ente: string; scadenzaGiorno: string; scadenzaOra: string; importo: string }): EsitoValidazione {
  const cigGrezzo = campi.cig.replace(/\s+/g, "").toUpperCase();
  const cig = cigGrezzo || null;
  if (cig && !/^[0-9A-Z]{10}$/.test(cig)) return { ok: false, errore: "Il CIG è di 10 caratteri, solo lettere e cifre." };

  let url: string | null = null;
  const urlGrezzo = campi.url.trim();
  if (urlGrezzo) {
    try {
      const u = new URL(urlGrezzo);
      if ((u.protocol !== "https:" && u.protocol !== "http:") || urlGrezzo.length > 2000) throw new Error();
      url = u.toString();
    } catch {
      return { ok: false, errore: "Il collegamento non è un indirizzo web valido (deve iniziare con https://)." };
    }
  }
  if (!cig && !url) return { ok: false, errore: "Scrivi il CIG oppure il collegamento alla gara." };

  const scadenza = scadenzaDaCampi(campi.scadenzaGiorno, campi.scadenzaOra);
  if (scadenza === "errore") return { ok: false, errore: "La scadenza non è valida: scegli il giorno e, se la conosci, l'ora." };

  let importo: number | null = null;
  const imp = campi.importo.replace(/[\s€]/g, "").replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", ".");
  if (imp) {
    if (!/^\d+(\.\d{1,2})?$/.test(imp) || Number(imp) >= 1e14) return { ok: false, errore: "L'importo non è valido: scrivi solo il numero, per esempio 250000 o 250.000,00." };
    importo = Number(imp);
  }

  return {
    ok: true,
    valori: {
      cig,
      url,
      oggetto: testoBreve(campi.oggetto, 500),
      ente: testoBreve(campi.ente, 300),
      scadenzaOfferte: scadenza?.iso ?? null,
      scadenzaOraIndicata: scadenza?.oraIndicata ?? false,
      importo,
    },
  };
}
