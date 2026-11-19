// Verifica della fase B4, grado 3 (B1): pagina «Notifiche» (preferenze delle email) e pagina della console delle email non consegnate.
// Decisione dell'utente del 19/11 §3 e approvazione definitiva (D-E3: l'Ufficio Gare solo spegne le proprie; D-E4: valori iniziali; n. 4–5:
// reinvio della verifica e «riprova» rimandati). Solo funzioni pure, dati SINTETICI e lettura dei sorgenti: nessuna rete, nessun database.
// Mutazioni: scripts/mutazioni-radar-b4-ui-notifiche.mjs.
import fs from "node:fs";
import path from "node:path";
import {
  MESSAGGIO_RIACCENDERE,
  MESSAGGIO_SOLO_PROPRIE,
  TESTO_STATO_INDIRIZZO,
  TUTTO_SPENTO,
  categorieDaModulo,
  eDellImpresa,
  modoModifica,
  personeVisibili,
  preferenzeDaRiga,
  righeIniziali,
  rigaPreferenze,
  ruoloNellImpresa,
  validaModificaPreferenze,
  valoriIniziali,
  type CategoriePreferenze,
  type PersoneDellImpresa,
} from "../src/lib/radar/notifiche-preferenze-calcoli";
import { invioEmailDichiaratoAcceso, preferenzeNotificheAttive } from "../src/lib/radar/interruttori-b4";
import type { PersonaImpresa, PreferenzePersona, StatoImpresaNotifiche } from "../src/lib/radar/notifiche/destinatari-calcoli";

const RADICE = path.resolve(__dirname, "..");
const leggi = (p: string) => fs.readFileSync(path.join(RADICE, p), "utf8");
const fallimenti: string[] = [];
function atteso(nome: string, ok: boolean, dettaglio = "") {
  console.log(`${ok ? "ok    " : "FALLITO"} ${nome}${ok || !dettaglio ? "" : ` — ${dettaglio}`}`);
  if (!ok) fallimenti.push(nome);
}
function uguale(nome: string, ottenuto: unknown, atteso_: unknown) {
  atteso(nome, JSON.stringify(ottenuto) === JSON.stringify(atteso_), `ottenuto ${JSON.stringify(ottenuto)}`);
}

const STAGING = "https://ryawdldqiumqsskrnyps.supabase.co";
const PRODUZIONE = "https://bihfrzspqxsrzlbqqvqa.supabase.co";
const ALFA = "00000000-0000-4000-a000-00000000a1fa";
const UFFICIO_ALFA = "00000000-0000-4000-a000-0000000a1fa2";
const SOSPESO_ALFA = "00000000-0000-4000-a000-0000000a1fa3";
const BETA = "00000000-0000-4000-a000-00000000be7a";
const UFFICIO_BETA = "00000000-0000-4000-a000-0000000be7a2";
const PERSONE_ALFA: PersoneDellImpresa = { impresaId: ALFA, membriAttivi: [UFFICIO_ALFA] };
const ACCESE: CategoriePreferenze = { nuove_opportunita: true, scadenze: true, rettifiche: true };

// ───── N. Calcoli puri ─────

uguale("N1 valori iniziali D-E4: titolare tutto acceso, Ufficio Gare senza nuove opportunità", [valoriIniziali("titolare"), valoriIniziali("ufficio_gare")], [ACCESE, { nuove_opportunita: false, scadenze: true, rettifiche: true }]);
uguale(
  "N2 dalla riga 0124: solo i booleani veri accendono, motivo del blocco solo tra quelli noti",
  [preferenzeDaRiga({ nuove_opportunita: "true", scadenze: true, rettifiche: 1, email_bloccata_il: null, motivo_blocco: "altro" }), preferenzeDaRiga(null)],
  [{ nuove_opportunita: false, scadenze: true, rettifiche: false, email_bloccata_il: null, motivo_blocco: null }, null],
);
{
  const fd = new FormData();
  fd.append("nuove_opportunita", "si");
  fd.append("scadenze", "on");
  fd.append("rettifiche", "1");
  fd.append("impresa", BETA);
  uguale("N3 dal modulo: conta solo «si», gli altri campi si ignorano", categorieDaModulo(fd), { nuove_opportunita: true, scadenze: false, rettifiche: false });
}
uguale(
  "N4 persone dell'impresa: titolare e Ufficio Gare attivo sì, sospeso e altre imprese no",
  [ALFA, UFFICIO_ALFA, SOSPESO_ALFA, BETA, UFFICIO_BETA].map((u) => [eDellImpresa(u, PERSONE_ALFA), ruoloNellImpresa(u, PERSONE_ALFA)]),
  [[true, "titolare"], [true, "ufficio_gare"], [false, null], [false, null], [false, null]],
);

const modifica = (chi: { userId: string; ruolo: "titolare" | "ufficio_gare" }, destinatarioId: string, attuali: CategoriePreferenze | null, richieste: CategoriePreferenze) => {
  const e = validaModificaPreferenze({ chiModifica: chi, destinatarioId, persone: PERSONE_ALFA, attuali, richieste });
  return e.ok ? "ok" : e.errore;
};
const TITOLARE = { userId: ALFA, ruolo: "titolare" as const };
const UFFICIO = { userId: UFFICIO_ALFA, ruolo: "ufficio_gare" as const };
atteso("N5 il titolare modifica le proprie preferenze", modifica(TITOLARE, ALFA, TUTTO_SPENTO, ACCESE) === "ok");
atteso("N5 il titolare modifica (anche accendendo) quelle del suo Ufficio Gare", modifica(TITOLARE, UFFICIO_ALFA, TUTTO_SPENTO, ACCESE) === "ok");
atteso("N5 il titolare NON modifica una persona di un'altra impresa o un membro sospeso", modifica(TITOLARE, UFFICIO_BETA, null, ACCESE) === "Persona non valida." && modifica(TITOLARE, SOSPESO_ALFA, null, TUTTO_SPENTO) === "Persona non valida.");
atteso("N5 un «titolare» che non è l'impresa (dati falsati) non modifica nulla", modifica({ userId: BETA, ruolo: "titolare" }, UFFICIO_ALFA, null, TUTTO_SPENTO) === "Persona non valida.");
atteso("N6 l'Ufficio Gare spegne le proprie categorie accese", modifica(UFFICIO, UFFICIO_ALFA, ACCESE, { nuove_opportunita: false, scadenze: true, rettifiche: false }) === "ok");
atteso("N6 l'Ufficio Gare NON riaccende una categoria spenta (D-E3)", modifica(UFFICIO, UFFICIO_ALFA, { nuove_opportunita: false, scadenze: true, rettifiche: true }, ACCESE) === MESSAGGIO_RIACCENDERE);
atteso("N6 senza preferenze salvate l'Ufficio Gare non accende nulla", modifica(UFFICIO, UFFICIO_ALFA, null, { nuove_opportunita: false, scadenze: true, rettifiche: false }) === MESSAGGIO_RIACCENDERE && modifica(UFFICIO, UFFICIO_ALFA, null, TUTTO_SPENTO) === "ok");
atteso("N6 l'Ufficio Gare NON modifica le preferenze del titolare", modifica(UFFICIO, ALFA, ACCESE, TUTTO_SPENTO) === MESSAGGIO_SOLO_PROPRIE);
atteso("N6 un membro sospeso non modifica nemmeno le proprie", modifica({ userId: SOSPESO_ALFA, ruolo: "ufficio_gare" }, SOSPESO_ALFA, ACCESE, TUTTO_SPENTO) !== "ok");

{
  const righe = righeIniziali(PERSONE_ALFA, new Set([UFFICIO_ALFA]), ALFA, "2026-11-19T10:00:00.000Z");
  uguale(
    "N7 righe iniziali solo per chi non ne ha (le scelte già fatte non si toccano), con impresa e autore del server",
    righe,
    [{ impresa_id: ALFA, user_id: ALFA, nuove_opportunita: true, scadenze: true, rettifiche: true, aggiornato_il: "2026-11-19T10:00:00.000Z", aggiornato_da: ALFA }],
  );
  uguale("N7 riga di una persona: solo le colonne della 0124 scrivibili dal cliente (mai il blocco dell'indirizzo)", Object.keys(rigaPreferenze(ALFA, UFFICIO_ALFA, ACCESE, ALFA, "x")).sort(), ["aggiornato_da", "aggiornato_il", "impresa_id", "nuove_opportunita", "rettifiche", "scadenze", "user_id"]);
}

// ───── V. Vista delle persone: regola «riceve» di B2, nessun indirizzo, nessuna altra impresa ─────

const persona = (userId: string, ruolo: "titolare" | "ufficio_gare", campi: Partial<PersonaImpresa> = {}): PersonaImpresa => ({
  impresaId: ALFA,
  userId,
  ruolo,
  email: `${ruolo}@alfa.example`,
  emailConfermata: true,
  bloccato: false,
  membroAttivo: true,
  ...campi,
});
const pref = (p: Partial<PreferenzePersona> = {}): PreferenzePersona => ({ nuove_opportunita: true, scadenze: true, rettifiche: true, email_bloccata_il: null, motivo_blocco: null, ...p });
const PERSONE: PersonaImpresa[] = [
  persona(UFFICIO_ALFA, "ufficio_gare", { emailConfermata: false }),
  persona(ALFA, "titolare"),
  persona(ALFA, "titolare"),
  { ...persona(UFFICIO_BETA, "ufficio_gare"), impresaId: BETA },
];
const PREFERENZE = new Map([
  [ALFA, pref({ nuove_opportunita: false })],
  [UFFICIO_ALFA, pref()],
]);
const IMPRESA: StatoImpresaNotifiche = { impresaId: ALFA, radarAttivo: true, emailAttive: true, abbonamentoValido: true };
{
  const vista = personeVisibili({ persone: PERSONE, preferenze: PREFERENZE, impresa: IMPRESA, chiGuarda: TITOLARE });
  uguale("V1 il titolare vede le persone della SUA impresa, una volta sola, titolare per primo", vista.map((p) => [p.userId, p.etichetta, p.tu]), [[ALFA, "Titolare dell'impresa", true], [UFFICIO_ALFA, "Ufficio Gare", false]]);
  atteso("V2 nessun indirizzo email nella vista", !JSON.stringify(vista).includes("@") && vista.every((p) => !("email" in p)));
  atteso("V3 «riceve» dalla regola di B2: titolare riceve scadenze, non le nuove opportunità spente", vista[0].riceve.scadenze.riceve && !vista[0].riceve.nuove_opportunita.riceve);
  const u = vista[1];
  atteso("V3 indirizzo da verificare: stato e motivo", u.stato === "da_verificare" && u.statoTesto === TESTO_STATO_INDIRIZZO.da_verificare && !u.riceve.scadenze.riceve && (u.riceve.scadenze.riceve ? "" : u.riceve.scadenze.motivo) === "email_da_verificare");
  const spente = personeVisibili({ persone: PERSONE, preferenze: PREFERENZE, impresa: { ...IMPRESA, emailAttive: false }, chiGuarda: TITOLARE });
  atteso("V4 email dell'impresa spente: nessuno riceve, con il motivo «spenti dal titolare dell'impresa»", spente.every((p) => !p.riceve.scadenze.riceve && (p.riceve.scadenze.riceve ? "" : p.riceve.scadenze.testo) === "Avvisi email spenti dal titolare dell'impresa"));
  const ufficio = personeVisibili({ persone: PERSONE, preferenze: PREFERENZE, impresa: IMPRESA, chiGuarda: UFFICIO });
  uguale("V5 l'Ufficio Gare vede solo sé stesso", ufficio.map((p) => p.userId), [UFFICIO_ALFA]);
  uguale("V6 un «titolare» falsato non vede nessuno", personeVisibili({ persone: PERSONE, preferenze: PREFERENZE, impresa: IMPRESA, chiGuarda: { userId: BETA, ruolo: "titolare" } }), []);
  const disattivato = personeVisibili({ persone: [persona(UFFICIO_ALFA, "ufficio_gare", { membroAttivo: false })], preferenze: PREFERENZE, impresa: IMPRESA, chiGuarda: TITOLARE });
  atteso("V7 membro sospeso: «Utente disattivato» e non riceve", disattivato[0]?.stato === "utente_disattivato" && !disattivato[0].riceve.rettifiche.riceve);
  uguale(
    "V8 come si modifica una riga",
    [modoModifica(TITOLARE, { userId: UFFICIO_ALFA }, true), modoModifica(UFFICIO, { userId: UFFICIO_ALFA }, true), modoModifica(UFFICIO, { userId: ALFA }, true), modoModifica(TITOLARE, { userId: ALFA }, false)],
    ["completa", "solo_spegnere", "lettura", "lettura"],
  );
}

// ───── I. Interruttori ─────

atteso("I1 pagina «Notifiche»: solo «attivo» sullo staging", preferenzeNotificheAttive({ RADAR_NOTIFICHE_PREFERENZE: "attivo", NEXT_PUBLIC_SUPABASE_URL: STAGING }) && !preferenzeNotificheAttive({ RADAR_NOTIFICHE_PREFERENZE: "attivo", NEXT_PUBLIC_SUPABASE_URL: PRODUZIONE }) && !preferenzeNotificheAttive({ RADAR_NOTIFICHE_PREFERENZE: "1", NEXT_PUBLIC_SUPABASE_URL: STAGING }));
atteso("I2 avviso «non ancora attivi»: il motore si considera acceso solo con «attivo» sullo staging (nel dubbio, spento)", invioEmailDichiaratoAcceso({ RADAR_NOTIFICHE_EMAIL: "attivo", NEXT_PUBLIC_SUPABASE_URL: STAGING }) && !invioEmailDichiaratoAcceso({ RADAR_NOTIFICHE_EMAIL: "si", NEXT_PUBLIC_SUPABASE_URL: STAGING }) && !invioEmailDichiaratoAcceso({ NEXT_PUBLIC_SUPABASE_URL: STAGING }));

// ───── S. Sorgenti: guardie, impresa dalla sessione, nessun indirizzo, nessuna scrittura in console ─────

const azioni = leggi("src/app/actions/radar-notifiche.ts");
const corpo = (nome: string) => {
  const i = azioni.indexOf(`export async function ${nome}`);
  const j = azioni.indexOf("\nexport async function", i + 1);
  return azioni.slice(i, j < 0 ? undefined : j);
};
const inOrdine = (testo: string, pezzi: string[]) => {
  const pos = pezzi.map((p) => testo.indexOf(p));
  return pos.every((x, i) => x >= 0 && (i === 0 || x > pos[i - 1]));
};
const email = corpo("salvaEmailImpresa");
atteso(
  "S1 salvaEmailImpresa: guardia del TITOLARE, interruttore, diritto, membri dell'impresa della sessione, scrittura con autore della sessione",
  inOrdine(email, ["await richiediTitolareAzione()", "preferenzeNotificheAttive(process.env)", "leggiDirittoRadar(guardia.contesto.accountId)", "leggiPersoneDellImpresa(admin, guardia.contesto.accountId)", "scriviEmailImpresa(admin, persone, attive, guardia.contesto.userId"]),
);
atteso("S1 accendere in sola lettura non si può (spegnere sì)", email.includes("if (attive && !diritto.operativo) return"));
const preferenze = corpo("salvaPreferenzeNotifiche");
atteso(
  "S2 salvaPreferenzeNotifiche: guardia di Opportunità, interruttore, diritto, validazione, poi scrittura per l'impresa della sessione",
  inOrdine(preferenze, ["await richiediOpportunitaAzione()", "preferenzeNotificheAttive(process.env)", "leggiDirittoRadar(contesto.accountId)", "validaModificaPreferenze(", "scriviPreferenze(admin, { impresaId: contesto.accountId"]),
);
atteso("S2 la riga dell'impresa la crea solo il titolare", preferenze.includes('creaImpresa: contesto.ruolo === "titolare"'));
atteso("S3 dal modulo solo «attive», «persona» (UUID) e le categorie: mai l'impresa", [...azioni.matchAll(/formData\.get\("([^"]+)"\)/g)].map((m) => m[1]).sort().join() === "attive,persona" && azioni.includes("UUID.test(persona)") && !azioni.includes("createClient("));
const server = leggi("src/lib/radar/notifiche-preferenze.ts");
atteso("S4 destinatari chiesti per la SOLA impresa della sessione e filtrati di nuovo", server.includes('rpc("radar_notifiche_destinatari", { p_imprese: [impresaId] })') && server.includes("p.impresaId === impresaId"));
atteso("S4 preferenze lette con la sessione (RLS), scritte solo con il client di servizio", /sessione\.from\(TABELLA_NOTIFICHE_PERSONE\)/.test(server) && !/sessione\.from\([^)]*\)\.(insert|update|upsert|delete)/.test(server) && /admin\.from\(TABELLA_NOTIFICHE_PERSONE\)\.upsert/.test(server));
const pagina = leggi("src/app/site-omnia-ai/dashboard/omnia-ai/opportunita/notifiche/page.tsx");
atteso("S5 pagina: guardia di Opportunità, diritto, 404 a interruttore spento, poi le letture", inOrdine(pagina, ["await richiediOpportunitaPagina()", "dirittoRadarOppure404(contesto.accountId)", "if (!preferenzeNotificheAttive(process.env)) notFound();", "leggiNotifiche("]));
atteso("S5 destinatari dell'impresa solo per il titolare; interruttore dell'impresa modificabile solo dal titolare", pagina.includes("{titolare && (") && pagina.includes("modificabile={titolare && "));
atteso("S5 la pagina non mostra indirizzi email", !/\.email\b/.test(pagina));
const moduli = leggi("src/components/omnia-ai/opportunita/notifiche-form.tsx");
atteso("S6 moduli nel browser: solo React e le azioni, nessuna lettura", /^"use client";/.test(moduli) && [...moduli.matchAll(/from "([^"]+)"/g)].map((m) => m[1]).every((i) => i === "react" || i === "@/app/actions/radar-notifiche"));
atteso("S6 «solo spegnere»: le categorie spente non si possono accendere dal modulo", moduli.includes('disabled={modo === "solo_spegnere" && !valori[c]}'));
const consolePagina = leggi("src/app/site-console/(app)/tender-intelligence/email/page.tsx");
atteso("S7 console: guardia degli amministratori come prima cosa, poi solo le letture di B2", consolePagina.indexOf("await richiediAdminPagina()") >= 0 && consolePagina.indexOf("await richiediAdminPagina()") < consolePagina.indexOf("leggiProblemiEmail(") && consolePagina.includes("contaConsegnePerStato(") && consolePagina.includes("leggiUltimiGiri("));
const senzaCommenti = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
atteso(
  "S7 console in sola lettura: nessuna azione, nessun pulsante («riprova» rimandato), nessuna scrittura, nessun indirizzo",
  !/"use server"|ModuloAzione|PulsanteAzione|<form|<button|action=|\.(insert|update|upsert|delete|rpc)\(|\.email\b|select\("[^"]*email/.test(senzaCommenti(consolePagina)),
);
const nuovi = [
  "src/lib/radar/notifiche-preferenze-calcoli.ts",
  "src/lib/radar/notifiche-preferenze.ts",
  "src/app/actions/radar-notifiche.ts",
  "src/components/omnia-ai/opportunita/notifiche-form.tsx",
  "src/app/site-omnia-ai/dashboard/omnia-ai/opportunita/notifiche/page.tsx",
  "src/app/site-console/(app)/tender-intelligence/email/page.tsx",
];
const testo = nuovi.map(leggi).join("\n");
atteso("S8 nessun aggiornamento periodico nel browser", !/setInterval|setTimeout|router\.refresh|useEffect\(|revalidate\s*=/.test(testo));
atteso("S9 nessun «amministratore» nei testi per i clienti", !/amministrator/i.test(senzaCommenti(nuovi.filter((f) => !f.includes("site-console")).map(leggi).join("\n"))));
for (const f of nuovi.filter((x) => x.endsWith(".tsx"))) {
  const tag = [...leggi(f).matchAll(/<Link\b[^>]*>/g)].map((m) => m[0]);
  atteso(`S10 ${f.split("/").slice(-2).join("/")}: ogni collegamento con prefetch={false}`, tag.every((t) => t.includes("prefetch={false}")), `${tag.length} collegamenti`);
}
const testata = leggi("src/components/omnia-ai/opportunita/testata-opportunita.tsx");
atteso("S11 la scheda «Notifiche» solo con il suo interruttore", testata.includes("const notifiche = preferenzeNotificheAttive(process.env);") && testata.includes('...(notifiche ? [{ id: "notifiche" as const'));
atteso("S12 il collegamento della console alla pagina nuova non si precarica", /<Link href="\/tender-intelligence\/email" prefetch=\{false\}>/.test(leggi("src/app/site-console/_componenti/tender-intelligence-vista.tsx")));
atteso("S13 righe LF nei file nuovi", nuovi.every((f) => !leggi(f).includes("\r\n")));

console.log(fallimenti.length ? `\n${fallimenti.length} controlli FALLITI` : "\nTutti i controlli del grado 3 della fase B4 sono passati.");
process.exit(fallimenti.length ? 1 : 0);
