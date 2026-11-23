// Le guardie di un giro programmato prima del database (K1, piano 48C §3.1), uguali per le quattro rotte cron e in quest'ordine:
//   1. segreto del cron (CRON_SECRET): nella rotta, con cronAutorizzato, come tutti i cron del progetto;
//   2. interruttore d'ambiente della fonte (RADAR_<FONTE>_CRON = «attivo», spento di base);
//   3. porta oraria della fonte, all'ora di Roma (programmazione-calcoli.ts).
// Funzione PURA per la 2 e la 3: nessun database, nessuna rete. La rotta la chiama PRIMA di creare il client del database, così un
// richiamo fuori orario o con la fonte spenta non legge né scrive nulla e non lascia righe nel registro (costerebbe una scrittura a ogni
// richiamo fuori orario). Le guardie dopo (ambiente consentito, fonte accesa, doppio richiamo, blocco) sono negli importatori e finiscono
// nel registro dei giri.
import type { FonteEsecuzione } from "./esecuzioni-calcoli";
import { INTERRUTTORI_CRON, eOraDiUnGiro } from "./programmazione-calcoli";

export type PortaGiro = { passa: true } | { passa: false; motivo: "giri_programmati_non_attivi" | "fuori_orario" };

export function portaGiroProgrammato(fonte: FonteEsecuzione, env: Record<string, string | undefined>, adesso: Date): PortaGiro {
  if (env[INTERRUTTORI_CRON[fonte]] !== "attivo") return { passa: false, motivo: "giri_programmati_non_attivi" };
  if (!eOraDiUnGiro(fonte, adesso)) return { passa: false, motivo: "fuori_orario" };
  return { passa: true };
}
