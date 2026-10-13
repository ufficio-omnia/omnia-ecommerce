import { cache } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { CONSOLE_BASE_URL } from "@/lib/zone";

// Controllo di accesso della console, in un posto solo. Il ruolo si verifica
// sempre sul server, dentro OGNI pagina e OGNI azione: nascondere le voci di
// menu o controllare solo il layout non basta, perché un layout non si
// riesegue nelle navigazioni interne e un'azione si può chiamare a prescindere
// dalla pagina che la mostra.
//
//  - pagine e route: richiediAdminPagina()  → redirect al login se non admin
//  - server action:  richiediAdminAzione()  → null se non admin (l'azione risponde "Non autorizzato")
//
// Il ruolo si legge con la service role dalla riga di public.users dell'utente
// la cui sessione è stata appena validata da Supabase Auth (getUser va
// all'Auth server, non si fida del cookie).

// Oltre questo tempo dall'ultimo accesso la sessione non vale più e serve un
// nuovo link. Un admin che lascia un browser aperto non resta dentro per giorni.
export const DURATA_MASSIMA_SESSIONE_MS = 12 * 60 * 60 * 1000;

export type SessioneConsole =
  | { stato: "anonimo" }
  | { stato: "non_admin" }
  | { stato: "scaduta" }
  | { stato: "admin"; userId: string; email: string; scadeIl: Date };

export type SessioneAdmin = { userId: string; email: string; scadeIl: Date };

// cache(): layout e pagina nella stessa richiesta leggono la sessione una volta
// sola (ogni lettura è una chiamata all'Auth server più una query).
export const leggiSessioneConsole = cache(async (): Promise<SessioneConsole> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { stato: "anonimo" };

  const { data: profilo } = await createAdminClient().from("users").select("role").eq("id", user.id).maybeSingle();
  if (profilo?.role !== "admin") return { stato: "non_admin" };

  // last_sign_in_at assente = non si può stabilire da quando dura la sessione: non vale.
  const ultimoAccesso = user.last_sign_in_at ? Date.parse(user.last_sign_in_at) : NaN;
  if (!Number.isFinite(ultimoAccesso) || Date.now() - ultimoAccesso > DURATA_MASSIMA_SESSIONE_MS) {
    return { stato: "scaduta" };
  }

  return {
    stato: "admin",
    userId: user.id,
    email: user.email ?? "",
    scadeIl: new Date(ultimoAccesso + DURATA_MASSIMA_SESSIONE_MS),
  };
});

// Prima riga di ogni page.tsx e route.ts della console (tranne login e conferma).
export async function richiediAdminPagina(): Promise<SessioneAdmin> {
  const sessione = await leggiSessioneConsole();
  if (sessione.stato === "admin") {
    return { userId: sessione.userId, email: sessione.email, scadeIl: sessione.scadeIl };
  }
  if (sessione.stato === "scaduta") redirect("/login?errore=scaduta");
  if (sessione.stato === "non_admin") redirect("/login?errore=accesso");
  redirect("/login");
}

// Prima riga di ogni server action della console (tranne le tre di accesso).
export async function richiediAdminAzione(): Promise<SessioneAdmin | null> {
  const sessione = await leggiSessioneConsole();
  if (sessione.stato !== "admin") return null;
  return { userId: sessione.userId, email: sessione.email, scadeIl: sessione.scadeIl };
}

// In produzione il dominio è fisso: un link che esce dalla console non deve
// dipendere dall'header Host della richiesta. In sviluppo tutte le zone vivono
// su localhost, e la zona si sceglie con ?__zone=console (src/proxy.ts).
export async function urlBaseConsole(): Promise<string> {
  if (process.env.NODE_ENV === "production") return CONSOLE_BASE_URL;
  const h = await headers();
  return `http://${h.get("host") ?? "localhost:3000"}`;
}

export const PARAMETRO_ZONA_SVILUPPO = process.env.NODE_ENV === "production" ? "" : "&__zone=console";
