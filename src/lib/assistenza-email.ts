import { createAdminClient } from "@/lib/supabase/admin";
import { sendEmail } from "@/lib/email";
import { PIANI, type PianoSlug } from "@/lib/omnia-ai-plans";

// Indirizzo scritto letteralmente, non ADMIN_EMAIL (src/lib/email.ts):
// quella costante è ufficio@omniaitalia.com, un indirizzo diverso da
// quello richiesto per l'assistenza OMNIA AI — non "correggere" questo
// letterale riportandolo su ADMIN_EMAIL.
const DESTINATARIO_ASSISTENZA = "info@omniaitalia.com";

function escapeHtml(testo: string): string {
  return testo
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// Punto unico per entrambi i trigger di escalation (l'assistente che
// decide di girare la richiesta, o il cliente che lo chiede
// direttamente): legge sempre da database i fatti che l'email deve
// riportare (contatti, piano, trascrizione) invece di fidarsi di quanto
// il modello potrebbe scrivere, poi chiude la conversazione con un
// messaggio di conferma al cliente.
export async function inviaEmailAssistenza(params: {
  userId: string;
  motivo: string;
  garaRiferimento: string | null;
}): Promise<{ ok: boolean }> {
  const { userId, motivo, garaRiferimento } = params;
  const admin = createAdminClient();

  const [{ data: utente }, { data: company }, { data: subscription }, { data: messaggi }] = await Promise.all([
    admin.from("users").select("email").eq("id", userId).single<{ email: string }>(),
    admin
      .from("companies")
      .select("ragione_sociale, telefono_aziendale")
      .eq("user_id", userId)
      .maybeSingle<{ ragione_sociale: string | null; telefono_aziendale: string | null }>(),
    admin
      .from("subscriptions")
      .select("plan")
      .eq("user_id", userId)
      .eq("status", "attivo")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle<{ plan: string }>(),
    admin
      .from("assistenza_messaggi")
      .select("ruolo, contenuto, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: true })
      .returns<{ ruolo: string; contenuto: string; created_at: string }[]>(),
  ]);

  const nomePiano = subscription ? (PIANI[subscription.plan as PianoSlug]?.nome ?? subscription.plan) : "nessun abbonamento attivo";

  const trascrizioneHtml = (messaggi ?? [])
    .map((m) => {
      const chi = m.ruolo === "utente" ? "Cliente" : "Assistente";
      const orario = new Date(m.created_at).toLocaleString("it-IT");
      return `<p><strong>${chi}</strong> (${orario}):<br>${escapeHtml(m.contenuto).replace(/\n/g, "<br>")}</p>`;
    })
    .join("\n");

  const html = `
    <h2>Richiesta di assistenza OMNIA AI</h2>
    <p><strong>Cliente:</strong> ${escapeHtml(company?.ragione_sociale ?? "—")} (${escapeHtml(utente?.email ?? "—")})</p>
    <p><strong>Telefono:</strong> ${escapeHtml(company?.telefono_aziendale ?? "—")}</p>
    <p><strong>Piano:</strong> ${escapeHtml(nomePiano)}</p>
    <p><strong>Gara di riferimento:</strong> ${garaRiferimento ? escapeHtml(garaRiferimento) : "nessuna indicata"}</p>
    <p><strong>Motivo dell'escalation:</strong> ${escapeHtml(motivo)}</p>
    <hr>
    <h3>Trascrizione della conversazione</h3>
    ${trascrizioneHtml || "<p>Nessun messaggio precedente.</p>"}
  `;

  await sendEmail({
    to: DESTINATARIO_ASSISTENZA,
    subject: `Richiesta assistenza OMNIA AI — ${company?.ragione_sociale ?? utente?.email ?? "cliente"}`,
    html,
  });

  await admin.from("assistenza_messaggi").insert({
    user_id: userId,
    ruolo: "assistente",
    contenuto: "Ho girato la tua richiesta al nostro team: sarai contattato al più presto.",
  });

  return { ok: true };
}
