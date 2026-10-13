"use server";

import { after } from "next/server";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendEmail } from "@/lib/email";
import { PARAMETRO_ZONA_SVILUPPO, urlBaseConsole } from "@/lib/console/accesso";
import { contestoRichiesta, registraAccesso, troppeRichieste } from "@/lib/console/registro-accessi";

// Le tre azioni di accesso sono le UNICHE della console che non richiedono
// già un admin (servono proprio a diventarlo): per questo non chiamano
// richiediAdminAzione. Tutte le altre azioni della console devono.

export type StatoRichiestaLink = { inviata?: boolean; errore?: string };

const EMAIL_VALIDA = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function escapeHtml(valore: string): string {
  return valore.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// Magic link, senza password. La risposta è IDENTICA per un admin, per un
// indirizzo qualunque e per una richiesta scartata dal limite di frequenza:
// niente rivela chi è admin, né con il testo né con i tempi (la parte lenta —
// generare il link e spedire l'email — gira dopo la risposta, in after()).
// Il link porta a /auth/conferma, una pagina con un pulsante: l'accesso si
// completa solo con quel clic. Così i sistemi che aprono in anticipo i link
// delle email (antivirus, anteprime) non consumano il token al posto dell'admin.
export async function richiediLinkAccesso(
  _stato: StatoRichiestaLink,
  formData: FormData,
): Promise<StatoRichiestaLink> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (email.length > 254 || !EMAIL_VALIDA.test(email)) {
    return { errore: "Inserisci un indirizzo email valido." };
  }

  const contesto = await contestoRichiesta();
  const urlBase = await urlBaseConsole();

  if (await troppeRichieste(email, contesto.ip)) {
    await registraAccesso("link_limitato", { email, contesto });
    return { inviata: true };
  }

  const admin = createAdminClient();

  // Gli admin sono pochissimi: si leggono tutti e si confronta in minuscolo,
  // senza ilike (i caratteri _ e % di un'email farebbero da jolly).
  const { data: admins } = await admin.from("users").select("id, email").eq("role", "admin");
  const trovato = (admins ?? []).find((a) => a.email?.toLowerCase() === email);

  if (!trovato) {
    await registraAccesso("link_negato", { email, contesto });
    return { inviata: true };
  }

  after(async () => {
    try {
      const { data, error } = await admin.auth.admin.generateLink({ type: "magiclink", email: trovato.email });
      const tokenHash = data?.properties?.hashed_token;
      if (error || !tokenHash) {
        console.error("Console: link di accesso non generato", error?.message);
        await registraAccesso("link_errore", { email, userId: trovato.id, contesto });
        return;
      }

      const link = `${urlBase}/auth/conferma?token_hash=${encodeURIComponent(tokenHash)}${PARAMETRO_ZONA_SVILUPPO}`;
      const ora = new Date().toLocaleString("it-IT", { timeZone: "Europe/Rome" });
      const inviata = await sendEmail({
        to: trovato.email,
        from: "OMNIA Console <noreply@omniaitalia.com>",
        subject: "Accesso alla console OMNIA",
        html: `
          <p>Hai chiesto di accedere alla console amministrativa OMNIA.</p>
          <p><a href="${escapeHtml(link)}">Apri la console</a></p>
          <p>Il link vale per un tempo breve e si può usare una volta sola.</p>
          <p style="color:#666;font-size:13px">Richiesta il ${escapeHtml(ora)}${contesto.ip ? ` dall'indirizzo ${escapeHtml(contesto.ip)}` : ""}.
          Se non sei stato tu, ignora questa email: senza il link nessuno può entrare.</p>
        `,
      });
      await registraAccesso(inviata ? "link_inviato" : "link_errore", { email, userId: trovato.id, contesto });
    } catch (e) {
      console.error("Console: errore nell'invio del link di accesso", e);
      await registraAccesso("link_errore", { email, userId: trovato.id, contesto });
    }
  });

  return { inviata: true };
}

// Secondo passo, dal pulsante della pagina /auth/conferma: scambia il token
// con la sessione, poi RILEGGE il ruolo. Se per qualunque motivo l'utente non
// è admin la sessione appena aperta viene chiusa (solo questa: scope local, le
// sessioni dello stesso utente su altri siti restano). Destinazione fissa, nessun
// parametro "next" da cui far rimbalzare altrove.
export async function confermaAccesso(formData: FormData): Promise<void> {
  const tokenHash = String(formData.get("token_hash") ?? "").trim();
  const contesto = await contestoRichiesta();

  if (!tokenHash || tokenHash.length > 200) {
    await registraAccesso("accesso_rifiutato", { contesto });
    redirect("/login?errore=link");
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: "magiclink" });

  if (error || !data.user) {
    await registraAccesso("accesso_rifiutato", { contesto });
    redirect("/login?errore=link");
  }

  const { data: profilo } = await createAdminClient()
    .from("users")
    .select("role")
    .eq("id", data.user.id)
    .maybeSingle();

  if (profilo?.role !== "admin") {
    await supabase.auth.signOut({ scope: "local" });
    await registraAccesso("accesso_rifiutato", { email: data.user.email?.toLowerCase(), userId: data.user.id, contesto });
    redirect("/login?errore=accesso");
  }

  await registraAccesso("accesso", { email: data.user.email?.toLowerCase(), userId: data.user.id, contesto });
  redirect("/");
}

export async function esci(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut({ scope: "local" });
  redirect("/login");
}
