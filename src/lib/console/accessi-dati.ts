import { createAdminClient } from "@/lib/supabase/admin";
import { schemaAssente } from "@/lib/omnia-ai-incassi";
import { eCasoAccesso, type RigaAccesso } from "./accessi-dati-calcoli";

// Letture del registro degli accessi ai dati dei clienti (tabella omnia_ai_accessi_dati,
// migrazione 0082). Solo la console le usa, sempre dopo il controllo admin della pagina o
// della route che le chiama. Prima della migrazione la tabella non c'è: si risponde
// `tabellaDisponibile: false` invece di un errore, e la pagina lo dice.

type RigaDb = {
  id: string;
  created_at: string;
  accesso_il: string;
  operatore_email: string;
  cliente_id: string | null;
  cliente_email: string | null;
  tutti_i_clienti: boolean;
  caso: string;
  motivo: string;
  ambito: string;
  gara_id: string | null;
};

const COLONNE = "id, created_at, accesso_il, operatore_email, cliente_id, cliente_email, tutti_i_clienti, caso, motivo, ambito, gara_id";

function inRiga(r: RigaDb): RigaAccesso | null {
  // un caso che il codice non conosce non si inventa: la riga si salta (e si segnala nel log)
  if (!eCasoAccesso(r.caso)) {
    console.error("Registro accessi ai dati: caso sconosciuto nella riga", r.id, r.caso);
    return null;
  }
  return {
    id: r.id,
    creatoIl: r.created_at,
    accessoIl: r.accesso_il,
    operatoreEmail: r.operatore_email,
    clienteId: r.cliente_id,
    clienteEmail: r.cliente_email,
    tuttiIClienti: r.tutti_i_clienti,
    caso: r.caso,
    motivo: r.motivo,
    ambito: r.ambito,
    garaId: r.gara_id,
  };
}

export type RisultatoAccessi = { stato: "ok"; righe: RigaAccesso[]; troncato: boolean } | { stato: "tabella_assente" } | { stato: "errore"; messaggio: string };

const LIMITE_PAGINA = 300;

// Gli ultimi accessi registrati, con filtri facoltativi su caso e cliente (email, anche
// parziale: si cerca nella copia dell'email scritta nella riga). Dal più recente.
export async function leggiAccessi(opzioni: { caso?: string; cliente?: string } = {}): Promise<RisultatoAccessi> {
  let q = createAdminClient().from("omnia_ai_accessi_dati").select(COLONNE).order("accesso_il", { ascending: false }).limit(LIMITE_PAGINA + 1);
  if (opzioni.caso && eCasoAccesso(opzioni.caso)) q = q.eq("caso", opzioni.caso);
  if (opzioni.cliente) {
    // caratteri speciali del filtro «ilike» e della sintassi delle condizioni: si tolgono
    const pulito = opzioni.cliente.replace(/[%_,()\\*]/g, " ").trim();
    if (pulito) q = q.ilike("cliente_email", `%${pulito}%`);
  }
  const { data, error } = await q.returns<RigaDb[]>();
  if (error) {
    if (schemaAssente(error)) return { stato: "tabella_assente" };
    console.error("Console: lettura del registro accessi ai dati fallita", error.message);
    return { stato: "errore", messaggio: "Lettura del registro non riuscita." };
  }
  const righe = (data ?? []).map(inRiga).filter((r): r is RigaAccesso => r !== null);
  return { stato: "ok", righe: righe.slice(0, LIMITE_PAGINA), troncato: righe.length > LIMITE_PAGINA };
}

// TUTTE le righe che riguardano un cliente (per id, per email se l'id manca) e gli
// accessi generali, per l'estratto: qui non c'è un limite di pagina, un estratto
// incompleto sarebbe peggio di nessun estratto.
export async function leggiAccessiCliente(cliente: { id: string; email: string | null }): Promise<RisultatoAccessi> {
  const admin = createAdminClient();
  const condizioni = [`cliente_id.eq.${cliente.id}`, "tutti_i_clienti.is.true"];
  // l'email in una condizione .or(): solo se è composta da caratteri innocui
  const email = cliente.email?.trim().toLowerCase() ?? "";
  if (email && /^[a-z0-9._%+\-@]+$/.test(email)) condizioni.push(`and(cliente_id.is.null,cliente_email.eq.${email})`);

  const righe: RigaAccesso[] = [];
  const PAGINA = 1000;
  for (let da = 0; ; da += PAGINA) {
    const { data, error } = await admin
      .from("omnia_ai_accessi_dati")
      .select(COLONNE)
      .or(condizioni.join(","))
      .order("accesso_il", { ascending: false })
      .order("id", { ascending: true })
      .range(da, da + PAGINA - 1)
      .returns<RigaDb[]>();
    if (error) {
      if (schemaAssente(error)) return { stato: "tabella_assente" };
      console.error("Console: lettura dell'estratto accessi fallita", error.message);
      return { stato: "errore", messaggio: "Lettura del registro non riuscita." };
    }
    righe.push(...(data ?? []).map(inRiga).filter((r): r is RigaAccesso => r !== null));
    if ((data?.length ?? 0) < PAGINA) break;
  }
  return { stato: "ok", righe, troncato: false };
}

// Quanti accessi riguardano un cliente (per la sua scheda), con l'ultimo. null se il
// registro non è ancora disponibile.
export async function riassuntoAccessiCliente(cliente: { id: string; email: string | null }): Promise<{ quanti: number; generali: number; ultimo: string | null } | null> {
  const r = await leggiAccessiCliente(cliente);
  if (r.stato !== "ok") return null;
  return { quanti: r.righe.length, generali: r.righe.filter((x) => x.tuttiIClienti).length, ultimo: r.righe[0]?.accessoIl ?? null };
}

// Cerca un cliente per email esatta (minuscola). Serve alla registrazione: l'id si
// ricava dall'email scritta dall'operatore, non si chiede un identificativo a mano.
export async function trovaClientePerEmail(email: string): Promise<{ id: string; email: string } | null> {
  const { data } = await createAdminClient().from("users").select("id, email").eq("email", email).maybeSingle<{ id: string; email: string }>();
  return data ?? null;
}
