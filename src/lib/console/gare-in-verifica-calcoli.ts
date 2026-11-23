// Console «Tender Intelligence», gare «da verificare» (schema S4 del 49A, dato del 49C §4.2, 23/11/2026). Logica pura, provata da
// scripts/verifica-monitorate-fonti-nascoste.ts (sezione P).
//
// Il dato (scritto dal popolamento di B2): stato della gara «da_verificare» (migrazione 0133) e, tra le righe attive calcolate, una riga C
// per il SETTORE CANDIDATO con una regola che inizia con «da_verificare» e il motivo S4. Contratto di lettura qui sotto:
//   - la regola «da_verificare_<caso>» dice anche il caso (immobile_con_cpv_ristorazione, stabulari, biblioteca); «da_verificare» da sola
//     vale «caso non indicato»;
//   - il motivo è quello nella stessa posizione della regola;
//   - senza una riga così (dato incompleto) la gara resta nell'elenco senza candidato, e l'amministratore sceglie il settore.
// La decisione la scrive decisioneAmministratore di B2 (classificazioni-calcoli.ts): riga «amministratore» con la nota obbligatoria.
import { SETTORI_RADAR, nomeSettore, type SettoreRadar } from "@/lib/radar/settori";
import { risolviSottocategoria } from "@/lib/radar/settori-catalogo";

export const PREFISSO_DA_VERIFICARE = "da_verificare";

// i tre casi del 49A (settori.ts, DaVerificare.caso)
export const CASO_LEGGIBILE: Record<string, string> = {
  immobile_con_cpv_ristorazione: "Concessione di un immobile con un CPV di ristorazione",
  stabulari: "Appalto misto per stabulari",
  biblioteca: "Servizi di biblioteca",
};

export type RigaAttivaConsole = { settore: string; rilevanza: string; regole: string[] | null; motivi: string[] | null; origine: string };

export type Candidato = { settore: SettoreRadar | null; caso: string | null; motivo: string | null };

const SETTORI = new Set<string>(SETTORI_RADAR.map((s) => s.id));

export function eSettoreRadar(x: unknown): x is SettoreRadar {
  return typeof x === "string" && SETTORI.has(x);
}

/** Il settore candidato, il caso e il motivo dalla riga calcolata «da_verificare» (mai da una riga dell'amministratore). */
export function candidatoDaRighe(righe: readonly RigaAttivaConsole[]): Candidato {
  for (const r of righe) {
    if (r.origine === "amministratore" || !eSettoreRadar(r.settore)) continue;
    const regole = r.regole ?? [];
    const i = regole.findIndex((x) => x === PREFISSO_DA_VERIFICARE || x.startsWith(`${PREFISSO_DA_VERIFICARE}_`));
    if (i < 0) continue;
    const caso = regole[i].length > PREFISSO_DA_VERIFICARE.length ? regole[i].slice(PREFISSO_DA_VERIFICARE.length + 1) : null;
    return { settore: r.settore, caso, motivo: (r.motivi ?? [])[i]?.trim() || null };
  }
  return { settore: null, caso: null, motivo: null };
}

export type Decisione = { settore: SettoreRadar; rilevanza: "A" | "B" | "C"; sottocategorie: string[]; nota: string };

/**
 * I campi del modulo «Decidi», controllati nel server. Il settore è quello candidato (se c'è); A e B con sottocategorie SOLO dal catalogo del
 * settore (settori-catalogo.ts), C senza sottocategorie; nota obbligatoria, non fatta di soli spazi, al massimo 1000 caratteri (0121).
 */
export function validaDecisione(
  campi: { settore: unknown; rilevanza: unknown; sottocategorie: readonly unknown[]; nota: unknown },
  candidato: SettoreRadar | null,
): { ok: true; decisione: Decisione } | { ok: false; errore: string } {
  const settore = campi.settore;
  if (!eSettoreRadar(settore)) return { ok: false, errore: "Settore non valido." };
  if (candidato !== null && settore !== candidato) return { ok: false, errore: `Si decide solo per il settore candidato (${nomeSettore(candidato)}).` };
  const rilevanza = campi.rilevanza;
  if (rilevanza !== "A" && rilevanza !== "B" && rilevanza !== "C") return { ok: false, errore: "Scegli la rilevanza: A pertinente, B correlata o C non pertinente." };
  const scelte = [...new Set(campi.sottocategorie.map((x) => String(x)))];
  if (rilevanza === "C" && scelte.length > 0) return { ok: false, errore: "Una gara non pertinente (C) non ha sottocategorie." };
  const sottocategorie: string[] = [];
  for (const s of scelte) {
    const r = risolviSottocategoria(settore, s);
    // solo le voci del catalogo così come sono (né alias né ritirate): la console le offre già nella forma giusta
    if (!r || r.daAlias || r.id !== s) return { ok: false, errore: `Sottocategoria «${s}» non presente nel catalogo del settore.` };
    sottocategorie.push(r.id);
  }
  if (sottocategorie.length > 10) return { ok: false, errore: "Al massimo 10 sottocategorie." };
  const nota = typeof campi.nota === "string" ? campi.nota.trim() : "";
  if (!nota) return { ok: false, errore: "La nota è obbligatoria: scrivi perché decidi così." };
  if (nota.length > 1000) return { ok: false, errore: "La nota è troppo lunga (al massimo 1000 caratteri)." };
  return { ok: true, decisione: { settore, rilevanza, sottocategorie, nota } };
}
