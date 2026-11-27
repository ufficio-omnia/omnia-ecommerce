// Controllo in SOLA LETTURA dello schema della newsletter sul database configurato in .env.local (produzione), dopo che
// l'utente ha applicato a mano la 0141 e la 0142. Nessuna scrittura, nessun dato personale stampato: solo esiti.
// Uso: npx tsx scripts/verifica-schema-newsletter-produzione.ts
import path from "path";

process.loadEnvFile(path.join(process.cwd(), ".env.local"));

let errori = 0;
function atteso(nome: string, ok: boolean, dettaglio = "") {
  if (!ok) errori++;
  console.log(`${ok ? "ok    " : "FALLITO"} ${nome}${!ok && dettaglio ? ` — ${dettaglio}` : ""}`);
}

async function main() {
  const { createAdminClient } = await import("../src/lib/supabase/admin");
  const db = createAdminClient();
  console.log(`Database: ${new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!).hostname.split(".")[0]} (sola lettura)`);
  for (const t of ["newsletter_impostazioni", "newsletter_edizioni", "newsletter_iscritti", "newsletter_invii", "newsletter_eventi", "newsletter_registro", "newsletter_versioni"]) {
    const { error } = await db.from(t).select("*").limit(1);
    atteso(`0141: tabella ${t}`, !error, error?.message);
  }
  const ed = await db.from("newsletter_edizioni").select("versione_attiva, generazione_in_corso_da, generazione_token").limit(1);
  atteso("0141: colonne di versione e blocco", !ed.error, ed.error?.message);
  const imp = await db.from("newsletter_impostazioni").select("giorno_generazione, ora_generazione, giorno_invio, ora_invio").eq("id", 1).maybeSingle();
  atteso("0141: impostazioni predefinite (giovedì 18:00, venerdì 10:00)", !imp.error && imp.data?.giorno_generazione === 4 && imp.data?.ora_invio === "10:00", JSON.stringify(imp.data ?? imp.error));
  const det = await db.from("ai_operazioni").select("dettaglio").limit(1);
  atteso("0141: ai_operazioni.dettaglio", !det.error, det.error?.message);
  const rpc = await db.rpc("console_costi_per_cliente", { p_da: "2026-11-01T00:00:00Z", p_a: "2026-12-01T00:00:00Z" });
  atteso("0141: funzione dei costi eseguibile", !rpc.error, rpc.error?.message);
  const i = await db.from("newsletter_iscritti").select("provenienza, azienda, note_admin, consenso_testo, informativa_versione, consenso_ip_hash, consenso_user_agent, conferma_token, conferma_inviata_il, conferme_inviate, confermato_il").limit(1);
  atteso("0142: colonne delle iscrizioni pubbliche", !i.error, i.error?.message);
  const ld = await db.from("legal_documents").select("document_type, version, effective_date").in("document_type", ["omnia_ai_privacy_policy", "omnia_ai_condizioni_abbonamento"]).order("version", { ascending: false });
  const v3 = (ld.data ?? []).filter((d) => d.version === 3).map((d) => `${d.document_type} v3 dal ${d.effective_date}`);
  console.log(`Testi legali v3 registrati: ${v3.length ? v3.join(", ") : "nessuno (si attivano con lo SQL manuale dopo il deploy)"}`);
  console.log(errori ? `\n${errori} controlli falliti.` : "\nSchema della newsletter presente in produzione.");
  process.exit(errori ? 1 : 0);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
