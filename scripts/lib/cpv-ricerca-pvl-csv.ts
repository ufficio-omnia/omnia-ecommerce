// Lettura dell'elenco dei CPV di RICERCA della PVL (C2; decisione dell'utente del 23/11: 60 codici, nota 49C). È SEPARATO dal file di
// classificazione (cpv-settori-omnia.csv): serve solo a chiedere più avvisi alla PVL, il classificatore resta l'unico giudice del settore.
// Formato: UTF-8, separatore «;», intestazione codice_cpv;descrizione;fascia;gare_recuperate;data_aggiunta;nota; un campo che contiene «;»
// sta tra virgolette doppie (CSV standard, «""» dentro le virgolette). Descrizione e nota possono essere vuote. Qualunque errore FERMA la
// generazione e la prova (49C, R5 d): codice non a 8 cifre, codice ripetuto, codice già nel file di classificazione (R5 a), riga malformata.
// Usata dal generatore (scripts/genera-cpv-ricerca-pvl.ts) e dalla prova (scripts/verifica-radar-c2-pvl.ts).
import fs from "fs";

export type RigaCsvRicercaPvl = { cpv: string; descrizione: string | null; fascia: number; gareRecuperate: number; dataAggiunta: string; nota: string | null };

export const INTESTAZIONE_RICERCA_PVL = ["codice_cpv", "descrizione", "fascia", "gare_recuperate", "data_aggiunta", "nota"] as const;

// una riga in campi: «;» separa, le virgolette doppie racchiudono un campo (con «""» per una virgoletta)
export function campiCsv(riga: string): string[] {
  const out: string[] = [];
  let campo = "";
  let tra = false;
  for (let i = 0; i < riga.length; i++) {
    const c = riga[i];
    if (tra) {
      if (c === '"' && riga[i + 1] === '"') { campo += '"'; i++; }
      else if (c === '"') tra = false;
      else campo += c;
    } else if (c === '"' && campo === "") tra = true;
    else if (c === ";") { out.push(campo); campo = ""; }
    else campo += c;
  }
  if (tra) throw new Error(`Virgolette non chiuse: ${riga}`);
  out.push(campo);
  return out;
}

export function analizzaCsvRicercaPvl(testo: string, codiciClassificazione: readonly string[]): RigaCsvRicercaPvl[] {
  const righe = testo.replace(/^﻿/, "").split(/\r?\n/).filter((r) => r.trim() !== "");
  const intestazione = campiCsv(righe.shift() ?? "").map((c) => c.trim());
  if (JSON.stringify(intestazione) !== JSON.stringify(INTESTAZIONE_RICERCA_PVL)) throw new Error(`Intestazione inattesa nell'elenco dei CPV di ricerca PVL: ${JSON.stringify(intestazione)}`);
  if (righe.length === 0) throw new Error("Elenco dei CPV di ricerca PVL vuoto");
  const classificazione = new Set(codiciClassificazione);
  const visti = new Set<string>();
  return righe.map((r, i) => {
    const n = i + 2;
    const campi = campiCsv(r).map((c) => c.trim());
    if (campi.length !== INTESTAZIONE_RICERCA_PVL.length) throw new Error(`Riga ${n} dell'elenco PVL con ${campi.length} campi invece di ${INTESTAZIONE_RICERCA_PVL.length}: ${r}`);
    const [cpv, descrizione, fascia, gare, data, nota] = campi;
    if (!/^\d{8}$/.test(cpv)) throw new Error(`Codice CPV non valido alla riga ${n} dell'elenco PVL: «${cpv}» (servono 8 cifre)`);
    if (visti.has(cpv)) throw new Error(`Codice CPV ripetuto alla riga ${n} dell'elenco PVL: ${cpv}`);
    if (classificazione.has(cpv)) throw new Error(`Il codice ${cpv} (riga ${n}) è già nel file di classificazione: l'elenco di ricerca deve esserne separato (49C, R5 a)`);
    if (!/^[1-9]$/.test(fascia)) throw new Error(`Fascia non valida alla riga ${n} dell'elenco PVL: «${fascia}»`);
    if (!/^\d+$/.test(gare)) throw new Error(`«gare_recuperate» non valido alla riga ${n} dell'elenco PVL: «${gare}»`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(data) || Number.isNaN(Date.parse(`${data}T00:00:00Z`))) throw new Error(`«data_aggiunta» non valida alla riga ${n} dell'elenco PVL: «${data}»`);
    visti.add(cpv);
    return { cpv, descrizione: descrizione || null, fascia: Number(fascia), gareRecuperate: Number(gare), dataAggiunta: data, nota: nota || null };
  });
}

export function leggiCsvRicercaPvl(percorso: string, codiciClassificazione: readonly string[]): RigaCsvRicercaPvl[] {
  return analizzaCsvRicercaPvl(fs.readFileSync(percorso, "utf-8"), codiciClassificazione);
}
