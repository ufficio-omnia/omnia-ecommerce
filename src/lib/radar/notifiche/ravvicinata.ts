// Fase B4 (20/11/2026, B2) — PUNTO D'AGGANCIO della «scadenza ravvicinata» (decisione D-E2, approvata il 19/11: «sì, una volta sola, spento
// di base»). Lo chiama l'azione di salvataggio di B1 (`src/app/actions/radar.ts`) DOPO aver salvato, monitorato o aggiunto a mano una gara,
// dentro `after()` di Next, così la risposta all'utente non aspetta:
//
//     after(() => dopoIngressoInLista({ impresaId, proceduraId, aggiuntaId: null, autoreId }));
//
// Contratto (stabile: B1 lo importa da qui):
//   - non lancia MAI eccezioni e non blocca il salvataggio: restituisce sempre un esito;
//   - con l'interruttore unico spento (invioEmailAcceso, notifiche/interruttore.ts) non legge né scrive nulla: esito «spento»;
//   - acceso: se la gara è entrata nella lista con 0–2 giorni di calendario (Europe/Rome) alla scadenza, nasce UN evento
//     «scadenza_ravvicinata» per quella versione della scadenza, mai se il promemoria a 1 giorno è già nato; le consegne seguono le stesse
//     regole del motore (destinatari dell'impresa, preferenze «scadenze», chiavi uniche) e partono dalla coda con il provider finto.
//   - Non è «un'email per il clic su Salva»: avvisa una volta sola che la scadenza è imminente.
// Il corpo con il database lo completa il motore (motore.ts) nei commit successivi della Fase A; la firma non cambia.

import { invioEmailAcceso } from "./interruttore";

/** La gara appena entrata nella lista dell'impresa: una gara dell'archivio (proceduraId) oppure una gara aggiunta a mano (aggiuntaId). */
export type GaraEntrataInLista = {
  /** il titolare dell'impresa (omnia_ai_radar_salvate.user_id) */
  impresaId: string;
  proceduraId: string | null;
  aggiuntaId: string | null;
  /** chi ha salvato (titolare o Ufficio Gare): solo per i conteggi, mai destinatario per questo */
  autoreId: string;
};

export type EsitoRavvicinata =
  | { esito: "spento" }
  | { esito: "non_dovuta"; motivo: string }
  | { esito: "accodata"; eventi: number; consegne: number }
  | { esito: "errore"; codice: string };

export type OpzioniRavvicinata = {
  env?: Record<string, string | undefined>;
  adesso?: Date;
};

function garaValida(g: GaraEntrataInLista): boolean {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!g || typeof g.impresaId !== "string" || !uuid.test(g.impresaId)) return false;
  const p = g.proceduraId != null, a = g.aggiuntaId != null;
  if (p === a) return false; // esattamente una delle due
  return p ? uuid.test(String(g.proceduraId)) : uuid.test(String(g.aggiuntaId));
}

export async function dopoIngressoInLista(gara: GaraEntrataInLista, opzioni: OpzioniRavvicinata = {}): Promise<EsitoRavvicinata> {
  const env = opzioni.env ?? process.env;
  try {
    if (!invioEmailAcceso(env)) return { esito: "spento" };
    if (!garaValida(gara)) return { esito: "non_dovuta", motivo: "gara_non_valida" };
    // il corpo con il database arriva con motore.ts (Fase A); fino ad allora, anche acceso, nessuna lettura né scrittura
    void opzioni.adesso;
    return { esito: "non_dovuta", motivo: "motore_non_disponibile" };
  } catch (e) {
    const codice = e && typeof e === "object" && "code" in e ? String((e as { code: unknown }).code).slice(0, 40) : "eccezione";
    return { esito: "errore", codice };
  }
}
