// Lettura del file CPV approvato (separatore «;», intestazione codice_cpv;codice_cpv_8_cifre;descrizione;settore, eventuale BOM, righe CRLF).
// Usata dal generatore (scripts/genera-cpv-radar.ts) e dal controllo di corrispondenza (scripts/verifica-radar-fondamenta.ts).
import fs from "fs";

export type RigaCsvCpv = { codice: string; cpv: string; descrizione: string; settore: string };

export function leggiCsvCpvSettori(percorso: string): RigaCsvCpv[] {
  const testo = fs.readFileSync(percorso, "utf-8").replace(/^﻿/, "");
  const righe = testo.split(/\r?\n/).filter((r) => r.trim() !== "");
  const intestazione = righe.shift()?.split(";").map((c) => c.trim());
  if (JSON.stringify(intestazione) !== JSON.stringify(["codice_cpv", "codice_cpv_8_cifre", "descrizione", "settore"])) {
    throw new Error(`Intestazione inattesa nel file CPV: ${JSON.stringify(intestazione)}`);
  }
  return righe.map((r, i) => {
    const campi = r.split(";").map((c) => c.trim());
    if (campi.length !== 4 || campi.some((c) => c === "")) throw new Error(`Riga ${i + 2} del file CPV non valida: ${r}`);
    const [codice, cpv, descrizione, settore] = campi;
    if (!/^\d{8}-\d$/.test(codice) || !/^\d{8}$/.test(cpv) || !codice.startsWith(cpv)) throw new Error(`Codice CPV non valido alla riga ${i + 2}: ${codice} / ${cpv}`);
    return { codice, cpv, descrizione, settore };
  });
}
