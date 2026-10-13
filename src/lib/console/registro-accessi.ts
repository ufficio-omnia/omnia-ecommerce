import { headers } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";

// Registro degli accessi alla console (tabella console_accessi, migrazione
// 0074). Serve al limite di frequenza delle richieste di link e alla traccia
// mostrata nella Panoramica. Tutto è non bloccante: se la tabella non esiste
// ancora (migrazione non eseguita) il registro e il limite vengono saltati e
// l'accesso funziona lo stesso.

export type EventoAccesso =
  | "link_inviato"
  | "link_negato"
  | "link_limitato"
  | "link_errore"
  | "accesso"
  | "accesso_rifiutato";

export type RigaRegistro = {
  id: string;
  evento: EventoAccesso;
  email: string | null;
  ip: string | null;
  user_agent: string | null;
  created_at: string;
};

export type ContestoRichiesta = { ip: string | null; userAgent: string | null };

// Al massimo una richiesta di link per email al minuto e otto per IP ogni
// dieci minuti: abbastanza per un uso normale, troppo poco per riempire la
// casella di un admin o provare indirizzi a raffica.
const FINESTRA_EMAIL_MS = 60_000;
const FINESTRA_IP_MS = 10 * 60_000;
const MASSIMO_PER_IP = 8;

// Gli eventi "limitato" non contano: altrimenti chi riprova di continuo
// prolungherebbe da solo il proprio blocco.
const EVENTI_CHE_CONTANO: EventoAccesso[] = ["link_inviato", "link_negato", "link_errore"];

export async function contestoRichiesta(): Promise<ContestoRichiesta> {
  const h = await headers();
  const ip = h.get("x-real-ip") ?? h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  return {
    ip: ip ? ip.slice(0, 64) : null,
    userAgent: h.get("user-agent")?.slice(0, 300) ?? null,
  };
}

export async function registraAccesso(
  evento: EventoAccesso,
  dati: { email?: string | null; userId?: string | null; contesto?: ContestoRichiesta },
): Promise<void> {
  try {
    const { error } = await createAdminClient()
      .from("console_accessi")
      .insert({
        evento,
        email: dati.email ?? null,
        user_id: dati.userId ?? null,
        ip: dati.contesto?.ip ?? null,
        user_agent: dati.contesto?.userAgent ?? null,
      });
    if (error) console.error("console_accessi: evento non registrato", evento, error.message);
  } catch (e) {
    console.error("console_accessi: evento non registrato", evento, e);
  }
}

// true = richiesta da scartare in silenzio (la risposta all'utente è la stessa).
export async function troppeRichieste(email: string, ip: string | null): Promise<boolean> {
  try {
    const admin = createAdminClient();

    const perEmail = await admin
      .from("console_accessi")
      .select("id", { count: "exact", head: true })
      .in("evento", EVENTI_CHE_CONTANO)
      .eq("email", email)
      .gte("created_at", new Date(Date.now() - FINESTRA_EMAIL_MS).toISOString());
    if (perEmail.error) return false;
    if ((perEmail.count ?? 0) >= 1) return true;

    if (ip) {
      const perIp = await admin
        .from("console_accessi")
        .select("id", { count: "exact", head: true })
        .in("evento", EVENTI_CHE_CONTANO)
        .eq("ip", ip)
        .gte("created_at", new Date(Date.now() - FINESTRA_IP_MS).toISOString());
      if (perIp.error) return false;
      if ((perIp.count ?? 0) >= MASSIMO_PER_IP) return true;
    }
    return false;
  } catch {
    return false;
  }
}

export type SintesiRegistro = {
  disponibile: boolean;
  righe: RigaRegistro[];
  accessi24h: number;
  negati7g: number;
};

export async function leggiRegistroAccessi(limite = 15): Promise<SintesiRegistro> {
  const vuoto: SintesiRegistro = { disponibile: false, righe: [], accessi24h: 0, negati7g: 0 };
  try {
    const admin = createAdminClient();
    const ore24 = new Date(Date.now() - 24 * 3600_000).toISOString();
    const giorni7 = new Date(Date.now() - 7 * 24 * 3600_000).toISOString();

    const [righe, accessi, negati] = await Promise.all([
      admin
        .from("console_accessi")
        .select("id, evento, email, ip, user_agent, created_at")
        .order("created_at", { ascending: false })
        .limit(limite),
      admin
        .from("console_accessi")
        .select("id", { count: "exact", head: true })
        .eq("evento", "accesso")
        .gte("created_at", ore24),
      admin
        .from("console_accessi")
        .select("id", { count: "exact", head: true })
        .in("evento", ["link_negato", "accesso_rifiutato"])
        .gte("created_at", giorni7),
    ]);

    if (righe.error) return vuoto;
    return {
      disponibile: true,
      righe: (righe.data ?? []) as RigaRegistro[],
      accessi24h: accessi.count ?? 0,
      negati7g: negati.count ?? 0,
    };
  } catch {
    return vuoto;
  }
}
