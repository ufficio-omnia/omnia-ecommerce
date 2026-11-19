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
  { nome: "M17 motore dichiarato acceso con qualunque valore", file: INTERRUTTORI, cerca: 'return env.RADAR_NOTIFICHE_EMAIL === "attivo" && ambienteDb', con: "return !!env.RADAR_NOTIFICHE_EMAIL && ambienteDb" },
  { nome: "M18 «solo spegnere» non applicato nel modulo", file: MODULI, cerca: 'disabled={modo === "solo_spegnere" && !valori[c]}', con: "disabled={false}" },
  { nome: "M19 destinatari visibili anche all'Ufficio Gare", file: PAGINA, cerca: "{titolare && (\n            <section", con: "{(\n            <section" },
  { nome: "M20 testi dello stato dell'indirizzo scambiati", file: CALCOLI, cerca: 'verificato: "Indirizzo verificato",\n  da_verificare: "Indirizzo da verificare",', con: 'verificato: "Indirizzo da verificare",\n  da_verificare: "Indirizzo verificato",' },
];

process.exit(eseguiMutazioni({ radice: RADICE, verifica: "scripts/verifica-radar-b4-ui-notifiche.ts", mutazioni: MUTAZIONI }));
