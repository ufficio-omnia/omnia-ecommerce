"use server";

import { revalidatePath, updateTag } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { richiediAdminAzione } from "@/lib/console/accesso";
import { schemaAssente } from "@/lib/omnia-ai-incassi";
import { CHIAVI_MODIFICABILI, etichettaParametro, modificheParametri, normalizzaEmailConsole, validaParametro } from "@/lib/console/tender-intelligence-calcoli";
import { TAG_CLIENTI_RADAR, TAG_PARAMETRI_RADAR } from "@/lib/radar/visibilita";
import { eseguiImportazioneTed } from "@/lib/radar/importa-ted";
import { eseguiImportazionePvl } from "@/lib/radar/importa-pvl";
import { scrittureRadarConsentite } from "@/lib/radar/ambiente";

// Console «Tender Intelligence» (fasi B1 e B1-bis): interruttori, costi e limiti; fonti TED e PVL; imprese abilitate; giri manuali.
// Ogni azione parte da richiediAdminAzione() (solo amministratori), valida nel server e registra in radar_console_registro chi ha cambiato
// che cosa, quando, con il valore precedente e quello nuovo (migrazione 0112). Senza registro non si salva nulla.

export type StatoAzioneTi = { errore?: string; ok?: boolean; avviso?: string };

type Admin = ReturnType<typeof createAdminClient>;

async function registra(admin: Admin, righe: { oggetto: string; cliente_id?: string | null; valore_precedente: string | null; valore_nuovo: string | null }[], autore: { userId: string; email: string }): Promise<boolean> {
  if (righe.length === 0) return true;
  const { error } = await admin.from("radar_console_registro").insert(righe.map((r) => ({ ...r, cliente_id: r.cliente_id ?? null, autore_id: autore.userId, autore_email: autore.email })));
  if (error) console.error("Console Tender Intelligence: registro non scritto", error.message);
  return !error;
}

async function registroDisponibile(admin: Admin): Promise<boolean> {
  const { error } = await admin.from("radar_console_registro").select("id").limit(1);
  return !error;
}

function ricarica() {
  revalidatePath("/site-console", "layout");
}

// Salva i parametri presenti nel modulo (interruttore generale, costi, limiti): scrive e registra solo quelli cambiati.
export async function salvaParametriRadar(_stato: StatoAzioneTi, formData: FormData): Promise<StatoAzioneTi> {
  const sessione = await richiediAdminAzione();
  if (!sessione) return { errore: "Non autorizzato." };
  const nuovi: { chiave: string; valore: string }[] = [];
  for (const { chiave } of CHIAVI_MODIFICABILI) {
    const grezzo = formData.get(chiave);
    if (grezzo === null) continue;
    const esito = validaParametro(chiave, String(grezzo));
    if (!esito.ok) return { errore: `${etichettaParametro(chiave)}: ${esito.errore}` };
    nuovi.push({ chiave, valore: esito.valore });
  }
  if (nuovi.length === 0) return { errore: "Nessun parametro da salvare." };

  const admin = createAdminClient();
  if (!(await registroDisponibile(admin))) return { errore: "Il registro delle modifiche non esiste ancora (migrazione 0112): nessuna modifica salvata." };
  const { data: attuali, error: erroreLettura } = await admin.from("console_impostazioni").select("chiave, valore").in("chiave", nuovi.map((n) => n.chiave)).returns<{ chiave: string; valore: string }[]>();
  if (erroreLettura) return { errore: "Lettura dei valori attuali non riuscita." };
  const modifiche = modificheParametri(new Map((attuali ?? []).map((r) => [r.chiave, r.valore])), nuovi);
  if (modifiche.length === 0) return { ok: true, avviso: "Nessun valore cambiato." };

  const adesso = new Date().toISOString();
  const { error } = await admin.from("console_impostazioni").upsert(modifiche.map((m) => ({ chiave: m.chiave, valore: m.dopo, aggiornato_il: adesso, aggiornato_da: sessione.userId })), { onConflict: "chiave" });
  if (error) {
    console.error("Console Tender Intelligence: salvataggio dei parametri non riuscito", error.message);
    return { errore: "Salvataggio non riuscito." };
  }
  const registrato = await registra(admin, modifiche.map((m) => ({ oggetto: `parametro:${m.chiave}`, valore_precedente: m.prima, valore_nuovo: m.dopo })), sessione);
  updateTag(TAG_PARAMETRI_RADAR);
  ricarica();
  return { ok: true, avviso: `${modifiche.length === 1 ? "Salvato 1 valore" : `Salvati ${modifiche.length} valori`}.${registrato ? "" : " ATTENZIONE: il registro non è stato scritto."}` };
}

// Accende o spegne la fonte TED (l'importazione quotidiana non fa nulla con la fonte spenta).
export async function impostaFonteTed(_stato: StatoAzioneTi, formData: FormData): Promise<StatoAzioneTi> {
  const sessione = await richiediAdminAzione();
  if (!sessione) return { errore: "Non autorizzato." };
  const azione = String(formData.get("azione") ?? "");
  if (azione !== "accendi" && azione !== "spegni") return { errore: "Azione non valida." };
  const admin = createAdminClient();
  if (!(await registroDisponibile(admin))) return { errore: "Il registro delle modifiche non esiste ancora (migrazione 0112): nessuna modifica salvata." };
  const { data: fonte, error: e1 } = await admin.from("radar_fonti_stato").select("attiva").eq("fonte", "ted").maybeSingle<{ attiva: boolean }>();
  if (e1 || !fonte) return { errore: schemaAssente(e1) ? "Le tabelle delle fonti non esistono ancora." : "Fonte TED non trovata." };
  const attiva = azione === "accendi";
  if (fonte.attiva === attiva) return { ok: true, avviso: attiva ? "La fonte TED era già accesa." : "La fonte TED era già spenta." };
  const { error } = await admin.from("radar_fonti_stato").update({ attiva, aggiornata_il: new Date().toISOString() }).eq("fonte", "ted");
  if (error) return { errore: "Salvataggio non riuscito." };
  await registra(admin, [{ oggetto: "fonte:ted:attiva", valore_precedente: String(fonte.attiva), valore_nuovo: String(attiva) }], sessione);
  ricarica();
  return { ok: true, avviso: attiva ? "Fonte TED accesa: l'importazione partirà al prossimo giro (giorni feriali, 9:15 UTC) o con «Esegui un giro adesso»." : "Fonte TED spenta: nessuna importazione finché non la riaccendi." };
}

// Un giro di importazione subito (al massimo 50 secondi e 10 pagine; se resta lavoro, riprende al giro successivo dal punto salvato).
export async function eseguiGiroTed(): Promise<StatoAzioneTi> {
  const sessione = await richiediAdminAzione();
  if (!sessione) return { errore: "Non autorizzato." };
  const esito = await eseguiImportazioneTed(createAdminClient(), { tempoMassimoMs: 50_000, pagineMassime: 10 });
  ricarica();
  if (!esito.eseguita) {
    const motivi = { ambiente_non_consentito: "scritture non consentite in questo database", fonte_spenta: "la fonte TED è spenta", occupata: "un altro giro è già in corso", schema_assente: "le tabelle non esistono ancora", errore_lettura: "lettura dello stato non riuscita" } as const;
    return { errore: `Giro non eseguito: ${motivi[esito.motivo]}.` };
  }
  const b = esito.totali.bandi;
  const testo = `${esito.totali.pagine} pagine in ${Math.round(esito.durataMs / 1000)} s: ${b.nuove} gare nuove, ${b.aggiornate} aggiornate, ${b.rettifiche} con rettifiche, ${b.invariati} già note; ${esito.totali.esiti.applicati} esiti applicati.${esito.giroFinito ? "" : " Resta lavoro: riprende al prossimo giro."}`;
  return esito.errore ? { errore: `${testo} Interrotto: ${esito.errore}` } : { ok: true, avviso: testo };
}

// Accende o spegne la fonte PVL (fase B1-bis). Accendere è possibile SOLO sullo staging (uso sperimentale autorizzato solo lì); spegnere
// sempre. Una fonte sospesa dal connettore (errori 403/429 o risposta anomala) si riaccende da qui, dopo aver letto il motivo in console.
export async function impostaFontePvl(_stato: StatoAzioneTi, formData: FormData): Promise<StatoAzioneTi> {
  const sessione = await richiediAdminAzione();
  if (!sessione) return { errore: "Non autorizzato." };
  const azione = String(formData.get("azione") ?? "");
  if (azione !== "accendi" && azione !== "spegni") return { errore: "Azione non valida." };
  const attiva = azione === "accendi";
  if (attiva) {
    const permesso = scrittureRadarConsentite("pvl", process.env);
    if (!permesso.ok) return { errore: permesso.motivo };
  }
  const admin = createAdminClient();
  if (!(await registroDisponibile(admin))) return { errore: "Il registro delle modifiche non esiste ancora (migrazione 0112): nessuna modifica salvata." };
  const { data: fonte, error: e1 } = await admin.from("radar_fonti_stato").select("attiva").eq("fonte", "pvl").maybeSingle<{ attiva: boolean }>();
  if (e1 || !fonte) return { errore: schemaAssente(e1) ? "Le tabelle delle fonti non esistono ancora." : "Fonte PVL non trovata (migrazione 0115)." };
  if (fonte.attiva === attiva) return { ok: true, avviso: attiva ? "La fonte PVL era già accesa." : "La fonte PVL era già spenta." };
  const { error } = await admin.from("radar_fonti_stato").update({ attiva, aggiornata_il: new Date().toISOString() }).eq("fonte", "pvl");
  if (error) return { errore: "Salvataggio non riuscito." };
  await registra(admin, [{ oggetto: "fonte:pvl:attiva", valore_precedente: String(fonte.attiva), valore_nuovo: String(attiva) }], sessione);
  ricarica();
  return { ok: true, avviso: attiva ? "Fonte PVL accesa (solo staging). I giri programmati restano spenti: un giro parte solo con «Esegui un giro adesso»." : "Fonte PVL spenta: nessuna lettura finché non la riaccendi." };
}

// Un giro PVL subito (incrementale: dall'ultimo giorno letto meno uno a oggi; al massimo 50 secondi e il tetto di richieste della console).
export async function eseguiGiroPvl(): Promise<StatoAzioneTi> {
  const sessione = await richiediAdminAzione();
  if (!sessione) return { errore: "Non autorizzato." };
  const esito = await eseguiImportazionePvl(createAdminClient(), { modo: "incrementale", tempoMassimoMs: 50_000 });
  ricarica();
  if (!esito.eseguita) {
    const motivi = { ambiente_non_consentito: "la PVL è autorizzata solo sullo staging", fonte_spenta: "la fonte PVL è spenta o sospesa", occupata: "un altro giro è già in corso", schema_assente: "le tabelle non esistono ancora", errore_lettura: "lettura dello stato non riuscita" } as const;
    return { errore: `Giro non eseguito: ${motivi[esito.motivo]}.` };
  }
  const s = esito.statistiche;
  const testo = `${s.pvl.richieste} richieste alla PVL in ${Math.round(esito.durataMs / 1000)} s: ${s.avvisi.letti} avvisi letti, ${s.bandi.nuoveNazionali + s.bandi.nuoveSopraSogliaSenzaTed} gare nuove, ${s.bandi.giaPresentiTed} già presenti da TED, ${s.bandi.rettifiche} con rettifiche, ${s.bandi.invariati} già note; ${s.esiti.applicati} esiti applicati.${esito.giroFinito ? "" : " Resta lavoro: riprende al prossimo giro."}`;
  if (esito.sospesa) return { errore: `${testo} Fonte SOSPESA: ${esito.errore}` };
  return esito.errore ? { errore: `${testo} Interrotto: ${esito.errore}` } : { ok: true, avviso: testo };
}

// Abilita o disabilita il modulo per un'impresa (il titolare), cercata per email. Solo clienti titolari: non amministratori né Ufficio Gare.
export async function impostaImpresaRadar(_stato: StatoAzioneTi, formData: FormData): Promise<StatoAzioneTi> {
  const sessione = await richiediAdminAzione();
  if (!sessione) return { errore: "Non autorizzato." };
  const email = normalizzaEmailConsole(String(formData.get("email") ?? ""));
  const azione = String(formData.get("azione") ?? "");
  if (!email) return { errore: "Email non valida." };
  if (azione !== "abilita" && azione !== "disabilita") return { errore: "Azione non valida." };
  const admin = createAdminClient();
  if (!(await registroDisponibile(admin))) return { errore: "Il registro delle modifiche non esiste ancora (migrazione 0112): nessuna modifica salvata." };

  const { data: utente } = await admin.from("users").select("id, role").eq("email", email).maybeSingle<{ id: string; role: string }>();
  if (!utente) return { errore: "Nessun utente con questa email." };
  if (utente.role !== "cliente") return { errore: "Il modulo si abilita solo per i clienti." };
  const { data: membro, error: erroreMembro } = await admin.from("omnia_ai_membri").select("titolare_id").eq("membro_id", utente.id).maybeSingle();
  if (erroreMembro && !schemaAssente(erroreMembro)) return { errore: "Verifica del cliente non riuscita." };
  if (membro) return { errore: "Questo utente è un Ufficio Gare: va abilitato il titolare dell'account." };

  const { data: attuale } = await admin.from("omnia_ai_radar_impostazioni").select("attivo").eq("user_id", utente.id).maybeSingle<{ attivo: boolean }>();
  const attivo = azione === "abilita";
  if ((attuale?.attivo ?? false) === attivo && attuale) return { ok: true, avviso: attivo ? "Impresa già abilitata." : "Impresa già disabilitata." };
  const { error } = await admin
    .from("omnia_ai_radar_impostazioni")
    .upsert({ user_id: utente.id, attivo, aggiornata_il: new Date().toISOString(), aggiornata_da_email: sessione.email }, { onConflict: "user_id" });
  if (error) return { errore: "Salvataggio non riuscito." };
  await registra(admin, [{ oggetto: "cliente:attivo", cliente_id: utente.id, valore_precedente: attuale ? String(attuale.attivo) : null, valore_nuovo: String(attivo) }], sessione);
  updateTag(TAG_CLIENTI_RADAR);
  ricarica();
  return { ok: true, avviso: attivo ? `Modulo abilitato per ${email}.` : `Modulo disabilitato per ${email}.` };
}
