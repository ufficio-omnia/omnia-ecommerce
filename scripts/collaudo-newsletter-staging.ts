// Collaudo della migrazione 0141 (newsletter) sul database di STAGING reale, con il codice vero della console
// (archivio Supabase, versioni, trigger, funzione dei costi) e generatori finti: nessuna chiamata a modelli, nessuna email.
//
//   npx tsx scripts/collaudo-newsletter-staging.ts leggi   → solo letture (schema, funzione dei costi): nessuna autorizzazione
//   npx tsx scripts/collaudo-newsletter-staging.ts scrivi  → prova di scrittura: SOLO tramite esegui-autorizzato.mjs con
//                                                            un'autorizzazione «scrittura_prova» registrata dal coordinatore
//
// Mai la produzione: guardia anti-produzione condivisa (TENDER_INTELLIGENCE_FASE0/autorizzazioni/guardia-staging.mjs).
// Con la 0142 la prova copre anche iscrizione dal sito, conferma, inserimenti manuali e vincoli nuovi.
// La prova di scrittura lascia sullo staging UNA edizione di collaudo (oggetto «[COLLAUDO STAGING …]», stato finale
// «annullata») con le sue versioni e un iscritto fittizio @example.com disiscritto: le tabelle della newsletter non
// concedono DELETE alla service role. Le righe di costo di prova in ai_operazioni vengono invece cancellate.
const REGISTRO = "C:/Users/Dell/Desktop/OMNIA-PROGETTO1/TENDER_INTELLIGENCE_FASE0/autorizzazioni";

let errori = 0;
let controlli = 0;
function atteso(nome: string, ok: boolean, dettaglio = "") {
  controlli++;
  if (!ok) errori++;
  console.log(`${ok ? "ok    " : "FALLITO"} ${nome}${!ok && dettaglio ? ` — ${dettaglio}` : ""}`);
}

async function main() {
  const modo = process.argv[2];
  if (modo !== "leggi" && modo !== "scrivi") {
    console.log("uso: leggi | scrivi");
    process.exit(2);
  }
  if (modo === "scrivi") {
    // Regola del 17/11/2026: scritture sullo staging solo con un'autorizzazione registrata del coordinatore.
    const registro = process.env.TI_REGISTRO;
    if (!registro) {
      console.error("STOP: lanciare con esegui-autorizzato.mjs (autorizzazione registrata del coordinatore).");
      process.exit(2);
    }
    const { controllaPorta } = await import(new URL(`file:///${registro.replace(/\\/g, "/").replace(/^\/+/, "")}/registro.mjs`).href);
    try {
      controllaPorta({ script: "collaudo-newsletter-staging.ts" });
    } catch (e) {
      console.error(e instanceof Error ? e.message : e);
      process.exit(2);
    }
  }
  const { caricaStaging, FermoStaging } = await import(new URL(`file:///${REGISTRO}/guardia-staging.mjs`).href);
  let v: Record<string, string>;
  try {
    v = caricaStaging({ richieste: ["STAGING_SUPABASE_URL", "STAGING_PROJECT_REF", "STAGING_SECRET_KEY"] });
  } catch (e) {
    if (e instanceof FermoStaging) {
      console.log((e as Error).message);
      process.exit(2);
    }
    throw e;
  }
  console.log(`Staging ${v.STAGING_PROJECT_REF}: controllo anti-produzione superato.`);
  // il codice della console legge queste variabili: le si punta allo staging PRIMA di caricarlo
  process.env.NEXT_PUBLIC_SUPABASE_URL = v.STAGING_SUPABASE_URL;
  process.env.SUPABASE_SERVICE_ROLE_KEY = v.STAGING_SECRET_KEY;
  delete process.env.NEWSLETTER_ARCHIVIO;
  delete process.env.VERCEL_ENV;
  delete process.env.RESEND_API_KEY; // nessun invio possibile, nemmeno per sbaglio
  const { createAdminClient } = await import("../src/lib/supabase/admin");
  const db = createAdminClient();

  console.log("--- Schema (sola lettura) ---");
  for (const t of ["newsletter_impostazioni", "newsletter_edizioni", "newsletter_iscritti", "newsletter_invii", "newsletter_eventi", "newsletter_registro", "newsletter_versioni"]) {
    const { error } = await db.from(t).select("*").limit(1);
    atteso(`tabella ${t} raggiungibile dalla service role`, !error, error?.message);
  }
  const col = await db.from("newsletter_edizioni").select("versione_attiva, generazione_in_corso_da, generazione_token").limit(1);
  atteso("colonne di versione e blocco sulle edizioni", !col.error, col.error?.message);
  const imp = await db.from("newsletter_impostazioni").select("giorno_generazione, ora_generazione, giorno_invio, ora_invio, resend_quota_mensile_eur").eq("id", 1).maybeSingle();
  atteso("riga delle impostazioni con i valori predefiniti (giovedì 18:00, venerdì 10:00)", !imp.error && imp.data?.giorno_generazione === 4 && imp.data?.ora_generazione === "18:00" && imp.data?.giorno_invio === 5 && imp.data?.ora_invio === "10:00", JSON.stringify(imp.data ?? imp.error));
  const det = await db.from("ai_operazioni").select("dettaglio").limit(1);
  atteso("ai_operazioni.dettaglio presente", !det.error, det.error?.message);
  const c142 = await db.from("newsletter_iscritti").select("provenienza, azienda, note_admin, consenso_testo, informativa_versione, consenso_ip_hash, consenso_user_agent, conferma_token, conferma_inviata_il, conferme_inviate, confermato_il").limit(1);
  atteso("0142: colonne delle iscrizioni pubbliche presenti", !c142.error, c142.error?.message);
  const rpc = await db.rpc("console_costi_per_cliente", { p_da: "2026-01-01T00:00:00Z", p_a: "2027-01-01T00:00:00Z" });
  atteso("funzione dei costi eseguibile dalla service role", !rpc.error, rpc.error?.message);
  const anon = await fetch(`${v.STAGING_SUPABASE_URL}/rest/v1/newsletter_iscritti?select=email&limit=1`, { headers: { apikey: v.STAGING_PUBLISHABLE_KEY ?? "", Authorization: `Bearer ${v.STAGING_PUBLISHABLE_KEY ?? ""}` } }).catch(() => null);
  if (v.STAGING_PUBLISHABLE_KEY && anon) {
    const corpo = await anon.text();
    atteso("la chiave pubblica NON legge gli iscritti (tabella esistente, accesso negato o nessuna riga visibile)", !/PGRST205/.test(corpo) && (anon.status >= 400 || corpo === "[]"), `${anon.status} ${corpo.slice(0, 80)}`);
  }

  if (modo === "scrivi") {
    console.log("--- Prova di scrittura (codice vero, trigger reali, generatori finti) ---");
    const { archivioNewsletter } = await import("../src/lib/newsletter/archivio");
    const a = archivioNewsletter();
    atteso("archivio Supabase (non locale)", a.tipo === "supabase");
    const marcatore = `[COLLAUDO STAGING ${new Date().toISOString().slice(0, 16)}]`;
    const { provaVersioniECosti } = await import("./newsletter-prove-versioni");
    const id = await provaVersioniECosti(a, atteso, { marcatore });
    await db.from("newsletter_edizioni").update({ oggetto: `${marcatore} edizione di prova` }).eq("id", id);

    // categoria «newsletter» nella funzione dei costi: una riga di produzione di prova, poi cancellata
    const { error: e1 } = await db.from("ai_operazioni").insert({ user_id: null, gara_id: null, operazione: "newsletter_collaudo_staging", provider: "anthropic", model: "claude-sonnet-5", input_tokens: 1, output_tokens: 1, costo_stimato: 0.1234, dettaglio: { modulo: "newsletter", edizione_id: id, collaudo: true } });
    atteso("riga di costo di produzione inserita", !e1, e1?.message);
    const cat = await db.rpc("console_costi_per_cliente", { p_da: new Date(Date.now() - 3600e3).toISOString(), p_a: new Date(Date.now() + 3600e3).toISOString() });
    const righe = (cat.data ?? []) as { categoria: string; costo_usd: number }[];
    atteso("la funzione dei costi classifica «newsletter_*» come «newsletter»", righe.some((r) => r.categoria === "newsletter" && Number(r.costo_usd) >= 0.1234), JSON.stringify(righe));
    atteso("le prove «prova:newsletter_*» restano «prova»", righe.some((r) => r.categoria === "prova"));

    // vincoli del database
    const iscr = await a.aggiungiIscritto({ email: `collaudo+${Date.now()}@example.com`, nome: null, user_id: null, categoria: "altro", stato: "iscritto", base_giuridica: "consenso", prova_base: "Indirizzo fittizio del collaudo sullo staging", base_dal: "2026-11-27" }, null);
    atteso("token di disiscrizione generato dal database: 64 caratteri esadecimali", /^[a-f0-9]{64}$/.test(iscr.token_disiscrizione), iscr.token_disiscrizione);
    const senzaProva = await db.from("newsletter_iscritti").insert({ email: `x${Date.now()}@example.com`, base_giuridica: "consenso", prova_base: "corta" });
    atteso("iscritto senza prova della base giuridica: rifiutato dal database", Boolean(senzaProva.error));
    await a.accodaInvii([{ edizione_id: id, iscritto_id: iscr.id, tipo: "reale", email: iscr.email, versione: 1, stato: "saltato" }]);
    await a.accodaInvii([{ edizione_id: id, iscritto_id: iscr.id, tipo: "reale", email: iscr.email, versione: 1, stato: "saltato" }]);
    atteso("indice unico: un solo invio reale per iscritto ed edizione", (await a.inviiDellEdizione(id)).filter((r) => r.tipo === "reale").length === 1);
    const versioneDoppia = await db.from("newsletter_versioni").insert({ edizione_id: id, numero_versione: 1, origine: "iniziale", esito: "ok", contenuto: {} });
    atteso("numero di versione unico per edizione", Boolean(versioneDoppia.error));
    const fallitaConTesto = await db.from("newsletter_versioni").insert({ edizione_id: id, numero_versione: 999, origine: "rigenerazione", esito: "ok", contenuto: null });
    atteso("versione riuscita senza contenuto: rifiutata", Boolean(fallitaConTesto.error));
    const programmaSenzaApprovazione = await db.from("newsletter_edizioni").update({ stato: "programmata", approvata_il: null }).eq("id", id);
    atteso("trigger: niente programmazione senza approvazione", Boolean(programmaSenzaApprovazione.error));

    // 0142: vincoli e flussi delle iscrizioni pubbliche (codice vero, email simulate: RESEND_API_KEY tolta nel processo)
    const stamp = Date.now();
    const sitoSenzaConsenso = await db.from("newsletter_iscritti").insert({ email: `sito-senza-consenso-${stamp}@example.com`, base_giuridica: "consenso", prova_base: "prova di collaudo dello staging", provenienza: "sito", stato: "iscritto" });
    atteso("0142: iscritto dal sito senza testo del consenso: rifiutato", Boolean(sitoSenzaConsenso.error));
    const attesaSenzaGettone = await db.from("newsletter_iscritti").insert({ email: `attesa-${stamp}@example.com`, base_giuridica: "consenso", prova_base: "prova di collaudo dello staging", stato: "in_attesa" });
    atteso("0142: «in_attesa» senza gettone di conferma: rifiutato", Boolean(attesaSenzaGettone.error));
    const provenienzaStrana = await db.from("newsletter_iscritti").insert({ email: `strana-${stamp}@example.com`, base_giuridica: "consenso", prova_base: "prova di collaudo dello staging", provenienza: "altro" });
    atteso("0142: provenienza non prevista: rifiutata", Boolean(provenienzaStrana.error));
    const isc = await import("../src/lib/newsletter/iscrizioni");
    const email = `collaudo-sito-${stamp}@example.com`;
    const ric = await isc.richiediIscrizione({ email, consenso: true, ipHash: `collaudo-${stamp}`, userAgent: "collaudo staging" }, a);
    const attesa = await a.iscrittoPerEmail(email);
    atteso("iscrizione dal sito: riga «in_attesa» con consenso e gettone", ric.ok && attesa?.stato === "in_attesa" && attesa.provenienza === "sito" && /^[a-f0-9]{48}$/.test(attesa.conferma_token ?? ""));
    const conf = await isc.confermaIscrizione(attesa!.conferma_token!, a);
    const confermato = await a.iscrittoPerEmail(email);
    atteso("conferma: «iscritto», gettone tolto, data di conferma", conf.ok && confermato?.stato === "iscritto" && confermato.conferma_token === null && Boolean(confermato.confermato_il));
    const g = await import("../src/lib/newsletter/gestione-iscritti");
    const ins = await g.inserisciDestinatari({ righe: [{ email, nome: null, azienda: null }, { email: `collaudo-manuale-${stamp}@example.com`, nome: "Prova", azienda: "Collaudo" }], base: "consenso", prova: "prova di collaudo dello staging", baseDal: "2026-11-27", note: "collaudo", categoria: "altro", provenienza: "importazione", nuovaAutorizzazione: false }, null, a);
    atteso("inserimento manuale: duplicato riconosciuto, nuovo aggiunto con provenienza", ins.giaPresenti.length === 1 && ins.aggiunti.length === 1 && (await a.iscrittoPerEmail(`collaudo-manuale-${stamp}@example.com`))?.provenienza === "importazione");
    const contratto = await db.from("newsletter_iscritti").insert({ email: `contratto-${stamp}@example.com`, base_giuridica: "contratto_abbonamento", prova_base: "prova di collaudo dello staging", provenienza: "abbonamento" }).select("id").single();
    atteso("0142: base «contratto_abbonamento» ammessa", !contratto.error, contratto.error?.message);
    // fine: le righe di collaudo restano disiscritte (nessun invio possibile)
    for (const e of [email, `collaudo-manuale-${stamp}@example.com`, `contratto-${stamp}@example.com`]) {
      const x = await a.iscrittoPerEmail(e);
      if (x) await a.aggiornaIscritto(x.id, { stato: "disiscritto", disiscritto_il: new Date().toISOString(), motivo_uscita: "fine collaudo staging", conferma_token: null });
    }
    await a.aggiornaIscritto(iscr.id, { stato: "disiscritto", disiscritto_il: new Date().toISOString(), motivo_uscita: "fine collaudo staging" });
    await a.aggiornaEdizione(id, { stato: "annullata" }, ["bozza", "in_revisione", "approvata", "programmata"]);

    // pulizia delle righe di costo del collaudo (ai_operazioni concede DELETE alla service role)
    const del = await db.from("ai_operazioni").delete().filter("dettaglio->>edizione_id", "eq", id).select("id");
    atteso("righe di costo del collaudo cancellate", !del.error && (del.data ?? []).length > 0, del.error?.message);
    const resto = await db.from("ai_operazioni").select("id", { head: true, count: "exact" }).filter("dettaglio->>edizione_id", "eq", id);
    atteso("nessuna riga di costo del collaudo rimasta", (resto.count ?? 1) === 0);
    console.log(`Edizione di collaudo lasciata sullo staging (annullata): ${id}`);
  }

  console.log(`\nCollaudo staging (${modo}): ${controlli - errori}/${controlli} controlli superati.`);
  process.exit(errori ? 1 : 0);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
