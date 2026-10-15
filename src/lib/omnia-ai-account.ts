import type { SupabaseClient } from "@supabase/supabase-js";
import { schemaAssente } from "@/lib/omnia-ai-incassi";
import { RUOLO_UFFICIO_GARE, type RuoloAccount } from "@/lib/omnia-ai-account-calcoli";

// Chi è, per OMNIA AI, l'utente loggato: il titolare dell'abbonamento (come tutti i clienti di sempre) oppure
// l'Ufficio Gare di un titolare. I dati di lavoro (gare, documenti, chat, relazione, consumi) appartengono
// sempre al TITOLARE: accountId è l'identificativo a cui riferirli (per il titolare coincide con userId).
// Le guardie per pagine e azioni sono in omnia-ai-account-guardie.ts.

export type ContestoAccount = {
  // chi è loggato
  userId: string;
  // di chi sono i dati: il titolare (per un titolare: se stesso)
  accountId: string;
  ruolo: RuoloAccount;
  // l'Ufficio Gare è stato sospeso dal titolare: non lavora su nulla finché non lo riattiva
  sospeso: boolean;
};

// La lettura non è riuscita (database irraggiungibile, errore imprevisto). Chi chiama NON deve concludere
// «è un titolare»: per un Ufficio Gare significherebbe aprirgli le pagine amministrative. Si blocca e si riprova.
export class ErroreContestoAccount extends Error {
  constructor(messaggio: string) {
    super(messaggio);
    this.name = "ErroreContestoAccount";
  }
}

type RigaMembro = { titolare_id: string; ruolo: string; attivo: boolean };

// `client` deve poter leggere omnia_ai_membri per userId (la chiave di servizio, oppure la sessione dell'utente:
// la regola di lettura gli consente la propria riga). userId viene SEMPRE dalla sessione verificata, mai da un parametro della richiesta.
export async function risolviContestoAccount(userId: string, client: SupabaseClient): Promise<ContestoAccount> {
  const { data, error } = await client
    .from("omnia_ai_membri")
    .select("titolare_id, ruolo, attivo")
    .eq("membro_id", userId)
    .maybeSingle<RigaMembro>();

  if (error) {
    // Tabella assente (migrazione 0092 non eseguita): nessun Ufficio Gare può esistere, tutti sono titolari come prima.
    if (schemaAssente(error)) return { userId, accountId: userId, ruolo: "titolare", sospeso: false };
    console.error("Account OMNIA AI: lettura del legame con il titolare non riuscita", error.code, error.message);
    throw new ErroreContestoAccount("Lettura del legame con il titolare non riuscita");
  }

  if (!data) return { userId, accountId: userId, ruolo: "titolare", sospeso: false };

  // Un ruolo che questo codice non conosce non si interpreta: si tratta come un errore, mai come un titolare.
  if (data.ruolo !== RUOLO_UFFICIO_GARE) throw new ErroreContestoAccount(`Ruolo sconosciuto: ${data.ruolo}`);

  return { userId, accountId: data.titolare_id, ruolo: RUOLO_UFFICIO_GARE, sospeso: !data.attivo };
}

export function eUfficioGare(contesto: Pick<ContestoAccount, "ruolo">): boolean {
  return contesto.ruolo === RUOLO_UFFICIO_GARE;
}
