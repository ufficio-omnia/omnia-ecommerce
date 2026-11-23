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
import { confermaProposta, rifiutaProposta, scollegaGara } from "@/lib/radar/collegamenti";
import { eseguiImportazioneRegionale } from "@/lib/radar/importa-regionali";
import { FONTI_REGIONALI, type FonteRegionale } from "@/lib/radar/importa-regionali-calcoli";
import { TAG_FONTI_RADAR } from "@/lib/radar/fonti-nascoste";
import { decisioneAmministratore, erroriRiga, type RigaClassificazione } from "@/lib/radar/classificazioni-calcoli";
import { VERSIONE_REGOLE_SETTORI, nomeSettore } from "@/lib/radar/settori";
import { candidatoDaRighe, validaDecisione } from "@/lib/console/gare-in-verifica-calcoli";

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
  const esito = await eseguiImportazioneTed(createAdminClient(), { tempoMassimoMs: 50_000, pagineMassime: 10, origine: "console" });
  ricarica();
  if (!esito.eseguita) {
    const motivi = { ambiente_non_consentito: "scritture non consentite in questo database", fonte_spenta: "la fonte TED è spenta", occupata: "un altro giro è già in corso", gia_eseguito: "un giro programmato è appena riuscito", contatto_mancante: "manca un contatto valido per lo User-Agent (RADAR_CONTATTO_FONTI)", schema_assente: "le tabelle non esistono ancora", errore_lettura: "lettura dello stato non riuscita" } as const;
    return { errore: `Giro non eseguito: ${motivi[esito.motivo]}.` };
  }
  const b = esito.totali.bandi;
  const testo = `${esito.totali.pagine} pagine in ${Math.round(esito.durataMs / 1000)} s: ${b.nuove} gare nuove, ${b.aggiornate} aggiornate, ${b.rettifiche} con rettifiche, ${b.invariati} già note; ${esito.totali.esiti.applicati} esiti applicati.${esito.fermata ? " Fermato a metà: la fonte è stata spenta dalla console." : esito.giroFinito ? "" : " Resta lavoro: riprende al prossimo giro."}`;
  if (esito.sospesa) return { errore: `${testo} Fonte SOSPESA (TED ha negato l'accesso): ${esito.errore}` };
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
  const esito = await eseguiImportazionePvl(createAdminClient(), { modo: "incrementale", tempoMassimoMs: 50_000, origine: "console" });
  ricarica();
  if (!esito.eseguita) {
    const motivi = { ambiente_non_consentito: "la PVL è autorizzata solo sullo staging", fonte_spenta: "la fonte PVL è spenta o sospesa", occupata: "un altro giro è già in corso", gia_eseguito: "un giro programmato è appena riuscito", contatto_mancante: "manca un contatto valido per lo User-Agent (RADAR_CONTATTO_FONTI)", schema_assente: "le tabelle non esistono ancora", errore_lettura: "lettura dello stato non riuscita" } as const;
    return { errore: `Giro non eseguito: ${motivi[esito.motivo]}.` };
  }
  const s = esito.statistiche;
  const testo = `${s.pvl.richieste} richieste alla PVL in ${Math.round(esito.durataMs / 1000)} s: ${s.avvisi.letti} avvisi letti, ${s.bandi.nuoveNazionali + s.bandi.nuoveSopraSogliaSenzaTed} gare nuove, ${s.bandi.giaPresentiTed} già presenti da TED, ${s.bandi.rettifiche} con rettifiche, ${s.bandi.invariati} già note; ${s.esiti.applicati} esiti applicati.${esito.fermata ? " Fermato a metà: la fonte è stata spenta dalla console." : esito.giroFinito ? "" : " Resta lavoro: riprende al prossimo giro."}`;
  if (esito.sospesa) return { errore: `${testo} Fonte SOSPESA: ${esito.errore}` };
  return esito.errore ? { errore: `${testo} Interrotto: ${esito.errore}` } : { ok: true, avviso: testo };
}

// Annulla il collegamento di una gara doppia (0117): la gara torna visibile, nulla si cancella, e il collegamento con quella gara non si rifà
// più da solo. Registrato nel registro della console e nei cambiamenti delle due gare.
export async function scollegaGaraDoppia(_stato: StatoAzioneTi, formData: FormData): Promise<StatoAzioneTi> {
  const sessione = await richiediAdminAzione();
  if (!sessione) return { errore: "Non autorizzato." };
  const id = String(formData.get("id") ?? "");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return { errore: "Gara non valida." };
  const admin = createAdminClient();
  if (!(await registroDisponibile(admin))) return { errore: "Il registro delle modifiche non esiste ancora (migrazione 0112): nessuna modifica salvata." };
  const esito = await scollegaGara(admin, id, new Date().toISOString());
  if (!esito.ok) return { errore: esito.motivo === "non_collegata" ? "Questa gara non è collegata a un'altra." : "Operazione non riuscita." };
  await registra(admin, [{ oggetto: "gara:collegamento", valore_precedente: `${id} unita a ${esito.resta}`, valore_nuovo: "annullato" }], sessione);
  ricarica();
  return { ok: true, avviso: "Collegamento annullato: la gara torna visibile e non verrà ricollegata da sola a quella gara." };
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

// ───── fase B2a: fonti regionali (Sintel, SardegnaCAT) e suggerimenti di unione ─────

const UUID_GARA = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NOME_REGIONALE: Record<FonteRegionale, string> = { sintel: "Sintel", sardegnacat: "SardegnaCAT" };

function fonteRegionale(v: FormDataEntryValue | null): FonteRegionale | null {
  const s = String(v ?? "");
  return (FONTI_REGIONALI as readonly string[]).includes(s) ? (s as FonteRegionale) : null;
}

// Accende o spegne una fonte regionale: accendere SOLO sullo staging (ambiente.ts); spegnere sempre. Una fonte sospesa dal connettore si
// riaccende da qui, dopo averne letto il motivo.
export async function impostaFonteRegionale(_stato: StatoAzioneTi, formData: FormData): Promise<StatoAzioneTi> {
  const sessione = await richiediAdminAzione();
  if (!sessione) return { errore: "Non autorizzato." };
  const fonte = fonteRegionale(formData.get("fonte"));
  const azione = String(formData.get("azione") ?? "");
  if (!fonte || (azione !== "accendi" && azione !== "spegni")) return { errore: "Richiesta non valida." };
  const attiva = azione === "accendi";
  if (attiva) {
    const permesso = scrittureRadarConsentite(fonte, process.env);
    if (!permesso.ok) return { errore: permesso.motivo };
  }
  const admin = createAdminClient();
  if (!(await registroDisponibile(admin))) return { errore: "Il registro delle modifiche non esiste ancora (migrazione 0112): nessuna modifica salvata." };
  const { data: riga, error: e1 } = await admin.from("radar_fonti_stato").select("attiva").eq("fonte", fonte).maybeSingle<{ attiva: boolean }>();
  if (e1 || !riga) return { errore: schemaAssente(e1) ? "Le tabelle delle fonti non esistono ancora." : `Fonte ${NOME_REGIONALE[fonte]} non trovata (migrazione 0120).` };
  if (riga.attiva === attiva) return { ok: true, avviso: `La fonte ${NOME_REGIONALE[fonte]} era già ${attiva ? "accesa" : "spenta"}.` };
  const { error } = await admin.from("radar_fonti_stato").update({ attiva, aggiornata_il: new Date().toISOString() }).eq("fonte", fonte);
  if (error) return { errore: "Salvataggio non riuscito." };
  await registra(admin, [{ oggetto: `fonte:${fonte}:attiva`, valore_precedente: String(riga.attiva), valore_nuovo: String(attiva) }], sessione);
  ricarica();
  return { ok: true, avviso: attiva ? `Fonte ${NOME_REGIONALE[fonte]} accesa (solo staging). I giri programmati restano spenti; ogni giro sullo staging richiede un'autorizzazione registrata.` : `Fonte ${NOME_REGIONALE[fonte]} spenta.` };
}

// Mostra o nasconde ai clienti una fonte regionale (0120). Decisione 48E dell'utente (23/11/2026): SardegnaCAT è visibile come le altre fonti,
// senza conferme; «nascondi» è sempre ammesso. Ogni cambio va nel registro (0112) e la cache delle fonti visibili si svuota subito.
export async function impostaVisibilitaFonte(_stato: StatoAzioneTi, formData: FormData): Promise<StatoAzioneTi> {
  const sessione = await richiediAdminAzione();
  if (!sessione) return { errore: "Non autorizzato." };
  const fonte = fonteRegionale(formData.get("fonte"));
  const azione = String(formData.get("azione") ?? "");
  if (!fonte || (azione !== "mostra" && azione !== "nascondi")) return { errore: "Richiesta non valida." };
  const nascosta = azione === "nascondi";
  const admin = createAdminClient();
  if (!(await registroDisponibile(admin))) return { errore: "Il registro delle modifiche non esiste ancora (migrazione 0112): nessuna modifica salvata." };
  const { data: riga, error: e1 } = await admin.from("radar_fonti_stato").select("nascosta_ai_clienti").eq("fonte", fonte).maybeSingle<{ nascosta_ai_clienti: boolean }>();
  if (e1 || !riga) return { errore: `Fonte ${NOME_REGIONALE[fonte]} non trovata (migrazione 0120).` };
  if (riga.nascosta_ai_clienti === nascosta) return { ok: true, avviso: "Nessun cambiamento." };
  const { error } = await admin.from("radar_fonti_stato").update({ nascosta_ai_clienti: nascosta, aggiornata_il: new Date().toISOString() }).eq("fonte", fonte);
  if (error) return { errore: "Salvataggio non riuscito." };
  await registra(admin, [{ oggetto: `fonte:${fonte}:nascosta_ai_clienti`, valore_precedente: String(riga.nascosta_ai_clienti), valore_nuovo: String(nascosta) }], sessione);
  updateTag(TAG_FONTI_RADAR);
  ricarica();
  return { ok: true, avviso: nascosta ? `${NOME_REGIONALE[fonte]} nascosta ai clienti.` : `${NOME_REGIONALE[fonte]} visibile ai clienti abilitati al modulo.` };
}

// Un giro subito di una fonte regionale (al più 50 secondi). Rispetta blocco e semaforo: con il semaforo del coordinamento chiuso il giro
// risponde «occupata» senza scrivere.
export async function eseguiGiroRegionale(_stato: StatoAzioneTi, formData: FormData): Promise<StatoAzioneTi> {
  const sessione = await richiediAdminAzione();
  if (!sessione) return { errore: "Non autorizzato." };
  const fonte = fonteRegionale(formData.get("fonte"));
  if (!fonte) return { errore: "Fonte non valida." };
  const admin = createAdminClient();
  // ogni giro lanciato a mano resta nel registro della console (chi, quando, con quale esito)
  if (!(await registroDisponibile(admin))) return { errore: "Il registro delle modifiche non esiste ancora (migrazione 0112): nessun giro avviato." };
  const esito = await eseguiImportazioneRegionale(admin, fonte, { tempoMassimoMs: 50_000, origine: "console" });
  await registra(admin, [{ oggetto: `fonte:${fonte}:giro`, valore_precedente: null, valore_nuovo: esito.eseguita ? (esito.errore ? `interrotto: ${esito.errore}` : "eseguito") : `non eseguito: ${esito.motivo}` }], sessione);
  ricarica();
  if (!esito.eseguita) {
    const motivi = { ambiente_non_consentito: "le fonti regionali sono autorizzate solo sullo staging", fonte_spenta: "la fonte è spenta o sospesa", occupata: "un altro giro è in corso o il semaforo del coordinamento è chiuso", gia_eseguito: "un giro programmato è appena riuscito", contatto_mancante: "manca un contatto valido per lo User-Agent (RADAR_CONTATTO_FONTI)", schema_assente: "manca la migrazione 0120", errore_lettura: "lettura dello stato non riuscita" } as const;
    return { errore: `Giro non eseguito: ${motivi[esito.motivo]}.` };
  }
  const s = esito.statistiche;
  const testo = esito.invariataAllaFonte
    ? `${NOME_REGIONALE[fonte]}: dati invariati dall'ultimo giro (${s.fonte.richieste} richiesta).`
    : `${NOME_REGIONALE[fonte]}: ${s.fonte.richieste} richieste in ${Math.round(esito.durataMs / 1000)} s; ${s.letti} procedure lette, ${s.nuove} gare nuove, ${s.aggiornate} aggiornate, ${s.invariati} invariate, ${s.collegateDoppie} gare doppie unite, ${s.proposte} suggerimenti di unione.`;
  if (esito.sospesa) return { errore: `${testo} Fonte SOSPESA: ${esito.errore}` };
  return esito.errore ? { errore: `${testo} Interrotto: ${esito.errore}` } : { ok: true, avviso: testo };
}

// Decisione su un suggerimento di unione (corrispondenza probabile): «conferma» esegue l'unione reversibile della 0117; «rifiuta» fa sì che
// le due gare non si propongano né si uniscano più tra loro. Sempre registrato.
export async function decidiPropostaCollegamento(_stato: StatoAzioneTi, formData: FormData): Promise<StatoAzioneTi> {
  const sessione = await richiediAdminAzione();
  if (!sessione) return { errore: "Non autorizzato." };
  const a = String(formData.get("a") ?? "");
  const b = String(formData.get("b") ?? "");
  const decisione = String(formData.get("decisione") ?? "");
  if (!UUID_GARA.test(a) || !UUID_GARA.test(b) || a === b || (decisione !== "conferma" && decisione !== "rifiuta")) return { errore: "Richiesta non valida." };
  const admin = createAdminClient();
  if (!(await registroDisponibile(admin))) return { errore: "Il registro delle modifiche non esiste ancora (migrazione 0112): nessuna modifica salvata." };
  const iso = new Date().toISOString();
  if (decisione === "conferma") {
    const e = await confermaProposta(admin, a, b, sessione.email, iso, { richiesteDb: 0, msDb: 0 });
    if (e.collegate === 0) return { errore: `Unione non eseguita (${Object.keys(e.saltate).join(", ") || "nessun motivo"}).` };
    await registra(admin, [{ oggetto: "gara:suggerimento", valore_precedente: `${a} e ${b}`, valore_nuovo: "confermato: unite" }], sessione);
  } else {
    const ok = await rifiutaProposta(admin, a, b, sessione.email, iso);
    if (!ok) return { errore: "Gare non trovate." };
    await registra(admin, [{ oggetto: "gara:suggerimento", valore_precedente: `${a} e ${b}`, valore_nuovo: "rifiutato" }], sessione);
  }
  ricarica();
  return { ok: true, avviso: decisione === "conferma" ? "Gare unite (annullabile dall'elenco delle gare collegate)." : "Suggerimento rifiutato: le due gare non verranno più proposte né unite." };
}

// ───── schema S4 (49C §4.2): una gara «da verificare» decisa a mano ─────

// «Decidi»: rilevanza A, B o C per il settore candidato, sottocategorie dal catalogo per A e B, nota obbligatoria. La riga la prepara
// decisioneAmministratore di B2 (origine «amministratore», 0121): la riga candidata si disattiva (resta nello storico) con una scrittura
// condizionata, poi si inserisce la nuova; le altre righe calcolate restano come spiegazione. Lo stato torna «classificata» (solo se era
// ancora «da_verificare»). La colonna «settori» della gara non si tocca: la allinea la riclassificazione di B2, che segue le decisioni.
export async function decidiGaraInVerifica(_stato: StatoAzioneTi, formData: FormData): Promise<StatoAzioneTi> {
  const sessione = await richiediAdminAzione();
  if (!sessione) return { errore: "Non autorizzato." };
  const proceduraId = String(formData.get("gara") ?? "");
  if (!UUID_GARA.test(proceduraId)) return { errore: "Richiesta non valida." };
  const admin = createAdminClient();
  if (!(await registroDisponibile(admin))) return { errore: "Il registro delle modifiche non esiste ancora (migrazione 0112): nessuna modifica salvata." };
  const [{ data: stato, error: e1 }, { data: attive, error: e2 }] = await Promise.all([
    admin.from("radar_classificazioni_stato").select("stato, versione_regole").eq("procedura_id", proceduraId).maybeSingle<{ stato: string; versione_regole: string | null }>(),
    admin.from("radar_classificazioni").select("*").eq("procedura_id", proceduraId).eq("attiva", true).returns<RigaClassificazione[]>(),
  ]);
  if (e1 || e2) return { errore: "Lettura della classificazione non riuscita." };
  if (!stato || stato.stato !== "da_verificare") return { errore: "La gara non è (più) da verificare: ricarica la pagina." };
  const candidato = candidatoDaRighe(attive ?? []);
  const v = validaDecisione({ settore: formData.get("settore"), rilevanza: formData.get("rilevanza"), sottocategorie: formData.getAll("sottocategoria"), nota: formData.get("nota") }, candidato.settore);
  if (!v.ok) return { errore: v.errore };
  const d = v.decisione;
  const attiva = (attive ?? []).find((r) => r.settore === d.settore) ?? null;
  const adesso = new Date().toISOString();
  const versione = stato.versione_regole ?? VERSIONE_REGOLE_SETTORI;
  const agg = decisioneAmministratore(attiva, { proceduraId, settore: d.settore, rilevanza: d.rilevanza, sottocategorie: d.sottocategorie, nota: d.nota, autore: `console:${sessione.email}`, versione, adessoIso: adesso, nuovoId: () => crypto.randomUUID() });
  const nuova = agg.inserisci[0];
  const errori = erroriRiga(nuova);
  if (errori.length) return { errore: `Decisione non valida: ${errori.join("; ")}.` };
  // 1) la riga di oggi si disattiva solo se è ancora attiva (una scrittura arrivata nel frattempo ferma tutto)
  for (const x of agg.disattiva) {
    const { data, error } = await admin.from("radar_classificazioni").update({ attiva: false, sostituita_il: x.sostituita_il, sostituita_da: x.sostituita_da }).eq("id", x.id).eq("attiva", true).select("id");
    if (error || (data ?? []).length === 0) return { errore: "La classificazione è cambiata nel frattempo: ricarica la pagina, nulla è stato salvato." };
  }
  // 2) la riga dell'amministratore; se non si scrive, la riga di prima torna attiva
  const { error: e3 } = await admin.from("radar_classificazioni").insert(nuova);
  if (e3) {
    for (const x of agg.disattiva) await admin.from("radar_classificazioni").update({ attiva: true, sostituita_il: null, sostituita_da: null }).eq("id", x.id).eq("sostituita_da", nuova.id);
    return { errore: "Salvataggio della decisione non riuscito: nulla è cambiato." };
  }
  // 3) lo stato torna «classificata», solo se era ancora «da_verificare»
  const { data: st, error: e4 } = await admin
    .from("radar_classificazioni_stato")
    .update({ stato: "classificata", versione_regole: versione, classificata_il: adesso, errore: null, aggiornata_il: adesso })
    .eq("procedura_id", proceduraId)
    .eq("stato", "da_verificare")
    .select("procedura_id");
  const statoAggiornato = !e4 && (st ?? []).length > 0;
  const prima = `${proceduraId} · ${d.settore}: da verificare${candidato.caso ? ` (${candidato.caso})` : ""}${attiva ? ` · riga ${attiva.rilevanza}` : ""}`;
  const dopo = `${d.settore}: ${d.rilevanza}${d.sottocategorie.length ? ` · ${d.sottocategorie.join(", ")}` : ""} · nota: ${d.nota}`.slice(0, 2000);
  await registra(admin, [{ oggetto: "gara:decisione_classificazione", valore_precedente: prima, valore_nuovo: dopo }], sessione);
  ricarica();
  if (!statoAggiornato) return { errore: "Decisione salvata, ma lo stato della gara non è tornato «classificata»: ricarica la pagina e riprova." };
  return { ok: true, avviso: `Decisione salvata: ${nomeSettore(d.settore)}, ${d.rilevanza === "A" ? "pertinente" : d.rilevanza === "B" ? "correlata" : "non pertinente"}. La gara torna classificata.` };
}
