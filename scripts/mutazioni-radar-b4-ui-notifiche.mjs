// Prove di mutazione del grado 3 della fase B4 (pagina «Notifiche», console delle email non consegnate). Motore: scripts/lib/esegui-mutazioni.mjs
// (ripristino dal buffer, mai git checkout). Uso: node scripts/mutazioni-radar-b4-ui-notifiche.mjs (dopo il commit dei file).
import path from "node:path";
import { fileURLToPath } from "node:url";
import { eseguiMutazioni } from "./lib/esegui-mutazioni.mjs";

const RADICE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CALCOLI = "src/lib/radar/notifiche-preferenze-calcoli.ts";
const SERVER = "src/lib/radar/notifiche-preferenze.ts";
const AZIONI = "src/app/actions/radar-notifiche.ts";
const PAGINA = "src/app/site-omnia-ai/dashboard/omnia-ai/opportunita/notifiche/page.tsx";
const MODULI = "src/components/omnia-ai/opportunita/notifiche-form.tsx";
const INTERRUTTORI = "src/lib/radar/interruttori-b4.ts";
// File di B2 (regola «riceve», interruttore unico): mutati SOLO in memoria durante la prova e ripristinati dal buffer (sha256 controllato alla
// fine); mai modificati né committati da B1. Servono a dimostrare che le prove A1 e A4 si accorgono se una regola sparisce (38B §1.5).
const DESTINATARI_B2 = "src/lib/radar/notifiche/destinatari-calcoli.ts";
const INTERRUTTORE_B2 = "src/lib/radar/notifiche/interruttore.ts";
// Fase A (A8): aggancio della «scadenza ravvicinata» nelle azioni di Opportunità
const RADAR = "src/app/actions/radar.ts";
const AGGANCIO = "src/lib/radar/ingresso-lista.ts";

const MUTAZIONI = [
  { nome: "M1 nuove opportunità accese anche per l'Ufficio Gare", file: CALCOLI, cerca: 'return { nuove_opportunita: ruolo === "titolare", scadenze: true, rettifiche: true };', con: "return { nuove_opportunita: true, scadenze: true, rettifiche: true };" },
  { nome: "M2 l'Ufficio Gare riaccende le categorie", file: CALCOLI, cerca: "  if (CATEGORIE_NOTIFICA.some((c) => d.richieste[c] && !attuali[c])) return { ok: false, errore: MESSAGGIO_RIACCENDERE };\n", con: "" },
  { nome: "M3 l'Ufficio Gare modifica le preferenze degli altri", file: CALCOLI, cerca: "if (d.destinatarioId !== d.chiModifica.userId || !eDellImpresa(d.chiModifica.userId, d.persone)) return { ok: false, errore: MESSAGGIO_SOLO_PROPRIE };", con: "" },
  { nome: "M4 persone di altre imprese modificabili", file: CALCOLI, cerca: 'if (!eDellImpresa(d.destinatarioId, d.persone)) return { ok: false, errore: "Persona non valida." };', con: "" },
  { nome: "M5 «titolare» falsato accettato", file: CALCOLI, cerca: 'return d.chiModifica.userId === d.persone.impresaId ? { ok: true, valori: d.richieste } : { ok: false, errore: "Persona non valida." };', con: "return { ok: true, valori: d.richieste };" },
  { nome: "M6 righe iniziali sopra le scelte già fatte", file: CALCOLI, cerca: "    .filter((p) => !giaPresenti.has(p.userId))\n", con: "" },
  { nome: "M7 persone di altre imprese nella vista", file: CALCOLI, cerca: "    if (p.impresaId !== d.impresa.impresaId) continue;\n", con: "" },
  { nome: "M8 l'Ufficio Gare vede tutte le persone", file: CALCOLI, cerca: ": p.userId === d.chiGuarda.userId;", con: ": true;" },
  { nome: "M9 l'Ufficio Gare modifica le righe degli altri", file: CALCOLI, cerca: 'return riga.userId === chiGuarda.userId ? "solo_spegnere" : "lettura";', con: 'return "solo_spegnere";' },
  { nome: "M10 modifiche anche in sola lettura", file: CALCOLI, cerca: '  if (!operativo) return "lettura";\n', con: "" },
  { nome: "M11 qualunque valore del modulo accende", file: CALCOLI, cerca: 'String(fd.get(c) ?? "") === "si"', con: 'String(fd.get(c) ?? "") !== ""' },
  { nome: "M12 interruttore dell'impresa con la guardia di Opportunità", file: AZIONI, cerca: "export async function salvaEmailImpresa(_stato: StatoNotifiche, formData: FormData): Promise<StatoNotifiche> {\n  const guardia = await richiediTitolareAzione();", con: "export async function salvaEmailImpresa(_stato: StatoNotifiche, formData: FormData): Promise<StatoNotifiche> {\n  const guardia = await richiediOpportunitaAzione();" },
  { nome: "M13 preferenze senza interruttore", file: AZIONI, cerca: "  if (!preferenzeNotificheAttive(process.env)) return { errore: MESSAGGIO_RADAR_NON_DISPONIBILE };\n  const { contesto } = guardia;", con: "  const { contesto } = guardia;" },
  { nome: "M14 riga dell'impresa creata anche dall'Ufficio Gare", file: AZIONI, cerca: 'creaImpresa: contesto.ruolo === "titolare"', con: "creaImpresa: true" },
  { nome: "M15 destinatari di altre imprese non rifiltrati", file: SERVER, cerca: " && p.impresaId === impresaId);", con: ");" },
  { nome: "M16 accendere le email in sola lettura", file: AZIONI, cerca: "if (attive && !diritto.operativo) return", con: "if (false && !diritto.operativo) return" },
  { nome: "M17 avviso con una lettura propria (la vecchia copia, senza l'esclusione delle anteprime)", file: INTERRUTTORI, cerca: "  return invioEmailAcceso(env);\n", con: '  return env.RADAR_NOTIFICHE_EMAIL === "attivo" && ambienteDb(env.NEXT_PUBLIC_SUPABASE_URL) === "staging";\n', richiede: "A4.1" },
  { nome: "M18 «solo spegnere» non applicato nel modulo", file: MODULI, cerca: 'disabled={modo === "solo_spegnere" && !valori[c]}', con: "disabled={false}" },
  { nome: "M19 destinatari visibili anche all'Ufficio Gare", file: PAGINA, cerca: "{titolare && (\n            <section", con: "{(\n            <section" },
  { nome: "M20 testi dello stato dell'indirizzo scambiati", file: CALCOLI, cerca: 'verificato: "Indirizzo verificato",\n  da_verificare: "Indirizzo da verificare",', con: 'verificato: "Indirizzo da verificare",\n  da_verificare: "Indirizzo verificato",' },
  // A3: Ufficio Gare e riga altrui con lo stesso indirizzo (le persone si riconoscono dall'identificativo, mai dall'indirizzo)
  { nome: "M21 persone unite per indirizzo nella vista del titolare", file: CALCOLI, cerca: "if (ammessa && !visibili.some((v) => v.userId === p.userId)) visibili.push(p);", con: "if (ammessa && !visibili.some((v) => v.email === p.email)) visibili.push(p);", richiede: "A3.2" },
  { nome: "M22 riga propria dell'Ufficio Gare riconosciuta dall'indirizzo", file: CALCOLI, cerca: ": p.userId === d.chiGuarda.userId;", con: ": p.email === d.persone.find((x) => x.userId === d.chiGuarda.userId)?.email;", richiede: "A3.1" },
  { nome: "M23 preferenze di chi guarda al posto di quelle della riga", file: CALCOLI, cerca: "const pref = d.preferenze.get(p.userId) ?? null;", con: "const pref = d.preferenze.get(d.chiGuarda.userId) ?? null;", richiede: "A3.2" },
  { nome: "M29 preferenze attuali lette senza la persona", file: SERVER, cerca: '.eq("impresa_id", impresaId).eq("user_id", userId).maybeSingle', con: '.eq("impresa_id", impresaId).maybeSingle', richiede: "A3.3" },
  // A1: dalle righe della 0124 / 0125 ai destinatari (catena di B1)
  { nome: "M24 «true» testuale accende le scadenze", file: CALCOLI, cerca: "scadenze: r.scadenze === true,", con: "scadenze: !!r.scadenze,", richiede: "A1.10" },
  { nome: "M25 blocco dell'indirizzo perso dalla riga della 0124", file: CALCOLI, cerca: 'email_bloccata_il: typeof r.email_bloccata_il === "string" ? r.email_bloccata_il : null,', con: "email_bloccata_il: null,", richiede: "A1.9" },
  { nome: "M26 preferenze di righe senza user_id valido", file: SERVER, cerca: 'if (p && typeof r.user_id === "string") preferenze.set(r.user_id, p);', con: "if (p) preferenze.set(String(r.user_id), p);", richiede: "A1.14" },
  { nome: "M27 preferenze lette senza il filtro dell'impresa", file: SERVER, cerca: 'sessione.from(TABELLA_NOTIFICHE_PERSONE).select(COLONNE_NOTIFICHE_PERSONE).eq("impresa_id", impresaId)', con: "sessione.from(TABELLA_NOTIFICHE_PERSONE).select(COLONNE_NOTIFICHE_PERSONE)", richiede: "A1.0" },
  { nome: "M28 email dell'impresa lette senza il filtro dell'impresa", file: SERVER, cerca: '.select("email_attive").eq("impresa_id", impresaId)', con: '.select("email_attive")', richiede: "A1.0" },
  { nome: "M30 funzione dei destinatari chiesta senza l'impresa", file: SERVER, cerca: "{ p_imprese: [impresaId] }", con: "{ p_imprese: [] }", richiede: "A1.0" },
  // A1: la regola di B2, un motivo per volta (mutazioni temporanee, vedi DESTINATARI_B2)
  { nome: "M31 [B2] motivo altra_impresa tolto", file: DESTINATARI_B2, cerca: '  if (!dellaImpresa(persona, impresa.impresaId)) motivi.add("altra_impresa");\n', con: "", richiede: "A1.1" },
  { nome: "M32 [B2] ruolo non confrontato con l'impresa", file: DESTINATARI_B2, cerca: 'return p.ruolo === "titolare" ? p.userId === impresaId : p.userId !== impresaId;', con: "return true;", richiede: "A1.1" },
  { nome: "M33 [B2] motivo radar_non_attivo tolto", file: DESTINATARI_B2, cerca: '  if (!impresa.radarAttivo) motivi.add("radar_non_attivo");\n', con: "", richiede: "A1.2" },
  { nome: "M34 [B2] motivo abbonamento_non_valido tolto", file: DESTINATARI_B2, cerca: '  if (impresa.abbonamentoValido === false) motivi.add("abbonamento_non_valido");\n', con: "", richiede: "A1.3" },
  { nome: "M35 [B2] abbonamento non controllato preso per non valido", file: DESTINATARI_B2, cerca: "impresa.abbonamentoValido === false", con: "!impresa.abbonamentoValido", richiede: "A1.3" },
  { nome: "M36 [B2] motivo email_impresa_spente tolto", file: DESTINATARI_B2, cerca: '  if (!impresa.emailAttive) motivi.add("email_impresa_spente");\n', con: "", richiede: "A1.4" },
  { nome: "M37 [B2] motivo membro_disattivato tolto", file: DESTINATARI_B2, cerca: '  if (!persona.membroAttivo) motivi.add("membro_disattivato");\n', con: "", richiede: "A1.5" },
  { nome: "M38 [B2] motivo utente_bloccato tolto", file: DESTINATARI_B2, cerca: '  if (persona.bloccato) motivi.add("utente_bloccato");\n', con: "", richiede: "A1.6" },
  { nome: "M39 [B2] indirizzo valido con la sola @", file: DESTINATARI_B2, cerca: "/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(email)", con: 'email.includes("@")', richiede: "A1.7" },
  { nome: "M40 [B2] lunghezza dell'indirizzo non controllata", file: DESTINATARI_B2, cerca: "email.length <= 320 && ", con: "", richiede: "A1.7" },
  { nome: "M41 [B2] motivo email_da_verificare tolto", file: DESTINATARI_B2, cerca: '  else if (!persona.emailConfermata) motivi.add("email_da_verificare");\n', con: "", richiede: "A1.8" },
  { nome: "M42 [B2] motivo email_bloccata tolto", file: DESTINATARI_B2, cerca: '  if (preferenze?.email_bloccata_il) motivi.add("email_bloccata");\n', con: "", richiede: "A1.9" },
  { nome: "M43 [B2] motivo categoria_spenta tolto", file: DESTINATARI_B2, cerca: '  if (!preferenze || preferenze[categoria] !== true) motivi.add("categoria_spenta");\n', con: "", richiede: "A1.10" },
  { nome: "M44 [B2] senza riga delle preferenze = tutto acceso", file: DESTINATARI_B2, cerca: "if (!preferenze || preferenze[categoria] !== true)", con: "if (preferenze && preferenze[categoria] !== true)", richiede: "A1.10" },
  { nome: "M45 [B2] ordine dei motivi cambiato", file: DESTINATARI_B2, cerca: '  "radar_non_attivo",\n  "abbonamento_non_valido",\n  "email_impresa_spente",\n  "membro_disattivato",\n', con: '  "membro_disattivato",\n  "radar_non_attivo",\n  "abbonamento_non_valido",\n  "email_impresa_spente",\n', richiede: "A1.11" },
  { nome: "M46 [B2] persona doppia non tolta", file: DESTINATARI_B2, cerca: "    if (visti.has(p.userId)) continue;\n", con: "", richiede: "A1.12" },
  { nome: "M47 [B2] utente non bloccato nel dubbio", file: DESTINATARI_B2, cerca: "bloccato: x.bloccato !== false,", con: "bloccato: x.bloccato === true,", richiede: "A1.6" },
  { nome: "M48 [B2] membro attivo nel dubbio", file: DESTINATARI_B2, cerca: "membroAttivo: x.membro_attivo === true,", con: "membroAttivo: x.membro_attivo !== false,", richiede: "A1.5" },
  { nome: "M49 [B2] indirizzo confermato nel dubbio", file: DESTINATARI_B2, cerca: "emailConfermata: x.email_confermata === true,", con: "emailConfermata: x.email_confermata !== false,", richiede: "A1.8" },
  { nome: "M50 [B2] indirizzo non normalizzato", file: DESTINATARI_B2, cerca: "x.email.trim().toLowerCase()", con: "x.email", richiede: "A1.13" },
  // A4/A9: l'avviso «non ancora attivi» e l'interruttore unico di B2
  { nome: "M51 avviso acceso con qualunque valore della variabile", file: INTERRUTTORI, cerca: "  return invioEmailAcceso(env);\n", con: '  return invioEmailAcceso({ ...env, RADAR_NOTIFICHE_EMAIL: env.RADAR_NOTIFICHE_EMAIL ? "attivo" : undefined });\n', richiede: "A4.1" },
  { nome: "M52 avviso mai mostrato nella pagina", file: PAGINA, cerca: "{!invioEmailDichiaratoAcceso(process.env) && (", con: "{false && (", richiede: "A9.2" },
  { nome: "M53 [B2] anteprime di Vercel non escluse", file: INTERRUTTORE_B2, cerca: '  if (env.VERCEL_ENV === "preview") return { acceso: false, motivo: "anteprima" };\n', con: "", richiede: "A4.2" },
  { nome: "M54 [B2] valore non esatto accettato", file: INTERRUTTORE_B2, cerca: 'if (env[VARIABILE_INTERRUTTORE_EMAIL] !== "attivo")', con: "if (!env[VARIABILE_INTERRUTTORE_EMAIL])", richiede: "A4.2" },
  { nome: "M55 [B2] acceso anche fuori dallo staging", file: INTERRUTTORE_B2, cerca: '  if (ambienteDb(env.NEXT_PUBLIC_SUPABASE_URL) !== "staging") return { acceso: false, motivo: "ambiente_non_autorizzato" };\n', con: "", richiede: "A4.2" },
  // A8: «scadenza ravvicinata» (le tre del coordinamento: entrambi gli id, prima della risposta invece che in after(), anche ad azione fallita)
  { nome: "M56 chiamata con entrambi gli id (gara dell'archivio da «aggiungi»)", file: RADAR, cerca: "proceduraId: lotto.procedura_id });", con: "proceduraId: lotto.procedura_id, aggiuntaId: lotto.procedura_id });", richiede: "A8.7" },
  { nome: "M57 il modulo accetta entrambi gli id", file: AGGANCIO, cerca: "if ((proceduraId === null) === (aggiuntaId === null)) {", con: "if (proceduraId === null && aggiuntaId === null) {", richiede: "A8.3" },
  {
    nome: "M58 lavoro eseguito subito, prima della risposta, invece che in after()",
    file: AGGANCIO,
    cerca: "  pianifica(async () => {\n    const esito = await dopoIngressoInLista(gara);\n    if (esito.esito === \"errore\") console.error(\"Tender Intelligence: scadenza ravvicinata non riuscita\", esito.codice);\n    return esito;\n  });\n",
    con: "  void (async () => {\n    const esito = await dopoIngressoInLista(gara);\n    if (esito.esito === \"errore\") console.error(\"Tender Intelligence: scadenza ravvicinata non riuscita\", esito.codice);\n    return esito;\n  })();\n",
    richiede: "A8.1",
  },
  { nome: "M59 chiamata diretta a B2 nell'azione, prima della risposta", file: RADAR, cerca: "if (!erroreSalvata) pianificaScadenzaRavvicinata({ impresaId: g.contesto.accountId, autoreId: g.contesto.userId, aggiuntaId: nuova.id });", con: "if (!erroreSalvata) await dopoIngressoInLista({ impresaId: g.contesto.accountId, autoreId: g.contesto.userId, proceduraId: null, aggiuntaId: nuova.id });", richiede: "A8.6" },
  {
    nome: "M60 salva/monitora: aggancio prima del controllo dell'errore (anche ad azione fallita)",
    file: RADAR,
    cerca: "  if (error) {\n    if (!schemaAssente(error)) console.error(\"Tender Intelligence: salvataggio della gara non riuscito\", error.code);\n    return { errore: \"Non è stato possibile salvare la gara.\" };\n  }\n  // la gara ENTRA nella lista (nuova tra le salvate o appena monitorata): «scadenza ravvicinata» di B2 dopo la risposta (A8, spenta di base)\n  if ((azione === \"salva\" || azione === \"monitora\") && (!esistente || (monitorata === true && !esistente.monitorata)))\n    pianificaScadenzaRavvicinata(proceduraId ? { impresaId: g.contesto.accountId, autoreId: g.contesto.userId, proceduraId } : { impresaId: g.contesto.accountId, autoreId: g.contesto.userId, aggiuntaId: aggiuntaId as string });\n",
    con: "  if ((azione === \"salva\" || azione === \"monitora\") && (!esistente || (monitorata === true && !esistente.monitorata)))\n    pianificaScadenzaRavvicinata(proceduraId ? { impresaId: g.contesto.accountId, autoreId: g.contesto.userId, proceduraId } : { impresaId: g.contesto.accountId, autoreId: g.contesto.userId, aggiuntaId: aggiuntaId as string });\n  if (error) {\n    if (!schemaAssente(error)) console.error(\"Tender Intelligence: salvataggio della gara non riuscito\", error.code);\n    return { errore: \"Non è stato possibile salvare la gara.\" };\n  }\n",
    richiede: "A8.8",
  },
  { nome: "M61 «aggiungi»: aggancio anche se la gara aggiunta non è entrata tra le salvate", file: RADAR, cerca: "    if (!erroreSalvata) pianificaScadenzaRavvicinata(", con: "    pianificaScadenzaRavvicinata(", richiede: "A8.9" },
  { nome: "M62 «aggiungi»: aggancio anche se il salvataggio della gara dell'archivio fallisce", file: RADAR, cerca: "      if (!erroreArchivio) pianificaScadenzaRavvicinata(", con: "      pianificaScadenzaRavvicinata(", richiede: "A8.9" },
  { nome: "M63 aggancio anche per «rimuovi» e «non monitorare»", file: RADAR, cerca: '(azione === "salva" || azione === "monitora") && (!esistente', con: "(!esistente", richiede: "A8.8" },
  { nome: "M64 aggancio a ogni clic, anche se la gara era già nella lista", file: RADAR, cerca: "&& (!esistente || (monitorata === true && !esistente.monitorata)))\n    pianificaScadenzaRavvicinata(", con: "&& true)\n    pianificaScadenzaRavvicinata(", richiede: "A8.8" },
];

process.exit(eseguiMutazioni({ radice: RADICE, verifica: "scripts/verifica-radar-b4-ui-notifiche.ts", mutazioni: MUTAZIONI }));
