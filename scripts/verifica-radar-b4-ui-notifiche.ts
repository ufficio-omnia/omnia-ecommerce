// Verifica della fase B4, grado 3 (B1): pagina «Notifiche» (preferenze delle email) e pagina della console delle email non consegnate.
// Decisione dell'utente del 19/11 §3 e approvazione definitiva (D-E3: l'Ufficio Gare solo spegne le proprie; D-E4: valori iniziali; n. 4–5:
// reinvio della verifica e «riprova» rimandati). Solo funzioni pure, dati SINTETICI e lettura dei sorgenti: nessuna rete, nessun database.
// Fase A della B4 (via Z1 del 20/11, rapporto 38): prove A1 (dalle preferenze ai destinatari, un caso per ogni motivo di esclusione, lungo la
// catena vera con client di Supabase FINTI) e A3 (Ufficio Gare con una riga altrui con lo stesso indirizzo), dal 38B §1.5.
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
import {
  ORDINE_MOTIVI,
  TESTO_MOTIVO,
  destinatariCheRicevono,
  personaDaRiga,
  riceve,
  statoIndirizzo,
  type EsitoRiceve,
  type PersonaImpresa,
  type PreferenzePersona,
  type StatoImpresaNotifiche,
} from "../src/lib/radar/notifiche/destinatari-calcoli";
import { CATEGORIE_NOTIFICA, type CategoriaNotifica } from "../src/lib/radar/notifiche/tipi";
import { invioEmailAcceso, statoInvioEmail } from "../src/lib/radar/notifiche/interruttore";
import type { EsitoRavvicinata } from "../src/lib/radar/notifiche/ravvicinata";
import { pianificaScadenzaRavvicinata, type IngressoInLista, type Pianificatore } from "../src/lib/radar/ingresso-lista";
import { leggiNotifiche, leggiPreferenzePersona } from "../src/lib/radar/notifiche-preferenze";
import { TABELLA_NOTIFICHE_IMPRESA, TABELLA_NOTIFICHE_PERSONE } from "../src/lib/radar/notifiche-preferenze-calcoli";
import type { SupabaseClient } from "@supabase/supabase-js";

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
  atteso("V3 indirizzo da verificare: stato e motivo", u.stato === "da_verificare" && u.statoTesto === "Indirizzo da verificare" && !u.riceve.scadenze.riceve && (u.riceve.scadenze.riceve ? "" : u.riceve.scadenze.motivo) === "email_da_verificare");
  uguale("V3 testi dello stato dell'indirizzo", TESTO_STATO_INDIRIZZO, { verificato: "Indirizzo verificato", da_verificare: "Indirizzo da verificare", bloccato: "Indirizzo non raggiungibile", utente_disattivato: "Utente disattivato" });
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

// ───── A4/A9. L'avviso «non ancora attivi» dice esattamente ciò che fa il motore: interruttore unico di B2, matrice delle variabili ─────
{
  const valori = [undefined, "", "0", "1", "true", "si", "on", "ATTIVO", "Attivo", " attivo", "attivo ", "attivo\n", "attivi", "attivo"];
  const vercel = [undefined, "", "production", "preview", "development", "PREVIEW"];
  const database = [STAGING, PRODUZIONE, undefined, "", "https://altro-progetto.supabase.co", "http://localhost:54321", `${STAGING}/`, STAGING.toUpperCase()];
  let combinazioni = 0;
  const diverse: string[] = [];
  const accese: string[] = [];
  for (const RADAR_NOTIFICHE_EMAIL of valori)
    for (const VERCEL_ENV of vercel)
      for (const NEXT_PUBLIC_SUPABASE_URL of database) {
        const env = { RADAR_NOTIFICHE_EMAIL, VERCEL_ENV, NEXT_PUBLIC_SUPABASE_URL, RADAR_NOTIFICHE_PREFERENZE: "attivo" };
        combinazioni++;
        const pagina = invioEmailDichiaratoAcceso(env);
        if (pagina !== invioEmailAcceso(env) || pagina !== statoInvioEmail(env).acceso) diverse.push(JSON.stringify(env));
        if (pagina) accese.push(JSON.stringify([RADAR_NOTIFICHE_EMAIL, VERCEL_ENV, NEXT_PUBLIC_SUPABASE_URL]));
      }
  atteso(`A4.1 matrice delle variabili (${combinazioni} combinazioni): l'avviso della pagina coincide SEMPRE con l'interruttore unico di B2`, diverse.length === 0, diverse.slice(0, 3).join(" ; "));
  // atteso scritto a mano, senza chiedere alla funzione (pacchetto P del go-live, 55 §2): «attivo» esatto; mai «preview»; sul database dello
  // staging, oppure sul database di produzione SOLO dal deploy di produzione (VERCEL_ENV=production); mai un database sconosciuto
  const indispensabili = [...[undefined, "production", "development"].map((v) => JSON.stringify(["attivo", v, STAGING])), JSON.stringify(["attivo", "production", PRODUZIONE])];
  atteso(
    "A4.2 acceso SOLO con «attivo» esatto, fuori dalle anteprime di Vercel: sul database dello staging, o su quello di produzione solo dal deploy di produzione",
    indispensabili.every((a) => accese.includes(a)) &&
      accese.every((a) => {
        const [v, e, u] = JSON.parse(a) as [string, string | null, string | null];
        const staging = typeof u === "string" && u.toLowerCase().startsWith(STAGING) && e !== "preview";
        const produzioneDalDeploy = u === PRODUZIONE && e === "production";
        return v === "attivo" && (staging || produzioneDalDeploy) && !["https://altro-progetto.supabase.co", "http://localhost:54321"].includes(u ?? "");
      }),
    accese.join(" ; "),
  );
  const casiSpenti = [
    { RADAR_NOTIFICHE_EMAIL: "1", NEXT_PUBLIC_SUPABASE_URL: STAGING },
    { RADAR_NOTIFICHE_EMAIL: "attivo", VERCEL_ENV: "preview", NEXT_PUBLIC_SUPABASE_URL: STAGING },
    { RADAR_NOTIFICHE_EMAIL: "attivo", NEXT_PUBLIC_SUPABASE_URL: PRODUZIONE },
  ];
  uguale(
    "A4.3 i tre motivi dello spento: in tutti e tre la pagina mostra l'avviso",
    casiSpenti.map((env) => [statoInvioEmail(env), invioEmailDichiaratoAcceso(env)]),
    [[{ acceso: false, motivo: "spento" }, false], [{ acceso: false, motivo: "anteprima" }, false], [{ acceso: false, motivo: "ambiente_non_autorizzato" }, false]],
  );
  atteso("A4.4 di base (nessuna variabile) l'avviso c'è", !invioEmailDichiaratoAcceso({}) && !invioEmailDichiaratoAcceso({ NEXT_PUBLIC_SUPABASE_URL: STAGING }));
  const interruttori = leggi("src/lib/radar/interruttori-b4.ts");
  atteso(
    "A9.1 interruttori-b4.ts delega all'interruttore unico di B2: nessuna lettura propria di RADAR_NOTIFICHE_EMAIL",
    interruttori.includes('import { invioEmailAcceso } from "./notifiche/interruttore";') && /export function invioEmailDichiaratoAcceso\([^)]*\): boolean \{\n  return invioEmailAcceso\(env\);\n\}/.test(interruttori) && !/env\.RADAR_NOTIFICHE_EMAIL|env\[["']RADAR_NOTIFICHE_EMAIL/.test(interruttori),
  );
  const paginaNotifiche = leggi("src/app/site-omnia-ai/dashboard/omnia-ai/opportunita/notifiche/page.tsx");
  atteso(
    "A9.2 la pagina mostra l'avviso con questa sola funzione e non legge l'ambiente del motore per conto suo",
    paginaNotifiche.includes("{!invioEmailDichiaratoAcceso(process.env) && (") && !paginaNotifiche.includes("RADAR_NOTIFICHE_EMAIL") && (paginaNotifiche.match(/invioEmailDichiaratoAcceso\(/g) ?? []).length === 1,
  );
}

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
atteso(
  "S5 destinatari dell'impresa solo per il titolare; interruttore dell'impresa modificabile solo dal titolare",
  /\{titolare && \(\s*<section[^>]*aria-labelledby="notifiche-destinatari"/.test(pagina) && pagina.includes("modificabile={titolare && "),
);
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

// ───── Client finti di Supabase (nessuna rete): filtrano le righe con gli .eq() chiesti dal codice e annotano ogni lettura ─────
// maybeSingle con più di una riga risponde con l'errore di PostgREST (PGRST116), come il database vero: una lettura senza filtro non «passa».

type Riga = Record<string, unknown>;
type Risultato = { data: unknown; error: { code: string; message: string } | null };
type Costruttore = {
  select(colonne: string): Costruttore;
  eq(colonna: string, valore: unknown): Costruttore;
  returns(): Costruttore;
  maybeSingle(): Promise<Risultato>;
  then<A = Risultato, B = never>(ok?: ((x: Risultato) => A | PromiseLike<A>) | null, ko?: ((e: unknown) => B | PromiseLike<B>) | null): Promise<A | B>;
};
function clienteFinto(tabelle: Record<string, readonly Riga[]>, funzioni: Record<string, (argomenti: unknown) => readonly Riga[]>, registro: string[]): SupabaseClient {
  const costruttore = (tabella: string): Costruttore => {
    const filtri: [string, unknown][] = [];
    const righe = () => (tabelle[tabella] ?? []).filter((r) => filtri.every(([c, v]) => r[c] === v));
    const b: Costruttore = {
      select: () => b,
      eq: (colonna, valore) => {
        filtri.push([colonna, valore]);
        registro.push(`eq ${tabella} ${colonna}=${String(valore)}`);
        return b;
      },
      returns: () => b,
      maybeSingle: () => {
        const r = righe();
        return Promise.resolve(r.length > 1 ? { data: null, error: { code: "PGRST116", message: "più righe" } } : { data: r[0] ?? null, error: null });
      },
      then: (ok, ko) => Promise.resolve<Risultato>({ data: righe(), error: null }).then(ok, ko),
    };
    return b;
  };
  const cliente = {
    from: (tabella: string) => costruttore(tabella),
    rpc: (nome: string, argomenti: unknown) => {
      registro.push(`rpc ${nome} ${JSON.stringify(argomenti)}`);
      return Promise.resolve<Risultato>({ data: funzioni[nome]?.(argomenti) ?? [], error: null });
    },
  };
  return cliente as unknown as SupabaseClient;
}

// Righe sintetiche: della funzione radar_notifiche_destinatari (0125) e della tabella delle preferenze (0124).
const rigaDest = (userId: string, ruolo: "titolare" | "ufficio_gare", campi: Riga = {}): Riga => ({
  impresa_id: ALFA,
  user_id: userId,
  ruolo,
  email: `${ruolo === "titolare" ? "titolare" : userId.slice(-4)}@alfa.example`,
  email_confermata: true,
  bloccato: false,
  membro_attivo: true,
  ...campi,
});
const rigaPref = (userId: string, campi: Riga = {}): Riga => ({ impresa_id: ALFA, user_id: userId, nuove_opportunita: true, scadenze: true, rettifiche: true, email_bloccata_il: null, motivo_blocco: null, ...campi });

type Scenario = { impresa?: Riga[]; persone?: Riga[]; destinatari?: Riga[]; radarAttivo?: boolean; operativo?: boolean | null };

/**
 * La catena vera della pagina e del motore: righe → leggiNotifiche (client finti) → stato dell'impresa come in page.tsx → regola «riceve» di B2.
 * Di base c'è anche l'impresa BETA in ogni tabella: una lettura senza il filtro dell'impresa se ne accorge.
 */
async function catena(s: Scenario) {
  const registro: string[] = [];
  const sessione = clienteFinto(
    {
      [TABELLA_NOTIFICHE_IMPRESA]: s.impresa ?? [{ impresa_id: BETA, email_attive: false }, { impresa_id: ALFA, email_attive: true }],
      [TABELLA_NOTIFICHE_PERSONE]: s.persone ?? [rigaPref(UFFICIO_BETA, { impresa_id: BETA }), rigaPref(ALFA), rigaPref(UFFICIO_ALFA)],
    },
    {},
    registro,
  );
  // la funzione finta restituisce TUTTE le righe date, anche di altre imprese (come un errore della funzione): il codice deve rifiltrare
  const admin = clienteFinto({}, { radar_notifiche_destinatari: () => s.destinatari ?? [rigaDest(ALFA, "titolare"), rigaDest(UFFICIO_ALFA, "ufficio_gare")] }, registro);
  const lettura = await leggiNotifiche(sessione, admin, ALFA);
  // come page.tsx: Radar attivo dal cliente della console, email dalla 0124, abbonamento = diritto operativo
  const impresa: StatoImpresaNotifiche = { impresaId: ALFA, radarAttivo: s.radarAttivo ?? true, emailAttive: lettura.emailAttive, abbonamentoValido: s.operativo === undefined ? true : s.operativo };
  const esito = (userId: string, categoria: CategoriaNotifica = "scadenze"): EsitoRiceve | null => {
    const p = lettura.persone?.find((x) => x.userId === userId);
    return p ? riceve(p, lettura.preferenze.get(userId) ?? null, impresa, categoria) : null;
  };
  const ricevono = (categoria: CategoriaNotifica) => destinatariCheRicevono(lettura.persone ?? [], lettura.preferenze, impresa, categoria).map((p) => p.userId);
  return { lettura, impresa, registro, esito, ricevono };
}
const motivoDi = (e: EsitoRiceve | null) => (e === null ? "assente" : e.riceve ? "riceve" : e.motivo);

// ───── A1. Dalle preferenze ai destinatari (38B §1.5 A1): un caso per ogni motivo di esclusione ─────

async function proveA1() {
  const base = await catena({});
  uguale("A1.0 caso base: titolare e Ufficio Gare ricevono tutte e tre le categorie", CATEGORIE_NOTIFICA.map((c) => base.ricevono(c)), CATEGORIE_NOTIFICA.map(() => [ALFA, UFFICIO_ALFA]));
  atteso(
    "A1.0 letture per la SOLA impresa della sessione: filtri delle due tabelle e argomento della funzione",
    [`eq ${TABELLA_NOTIFICHE_IMPRESA} impresa_id=${ALFA}`, `eq ${TABELLA_NOTIFICHE_PERSONE} impresa_id=${ALFA}`, `rpc radar_notifiche_destinatari {"p_imprese":["${ALFA}"]}`].every((r) => base.registro.includes(r)),
    base.registro.join(" | "),
  );
  uguale("A1.0 preferenze solo dell'impresa, per user_id", [...base.lettura.preferenze.keys()].sort(), [ALFA, UFFICIO_ALFA].sort());

  // altra_impresa: la persona di BETA non arriva nemmeno alla pagina; chiesta direttamente alla regola, è «altra impresa»
  const conBeta = await catena({ destinatari: [rigaDest(ALFA, "titolare"), rigaDest(UFFICIO_BETA, "ufficio_gare", { impresa_id: BETA })] });
  atteso("A1.1 altra_impresa: la persona di un'altra impresa restituita per errore dalla funzione non passa", motivoDi(conBeta.esito(UFFICIO_BETA)) === "assente" && !conBeta.ricevono("scadenze").includes(UFFICIO_BETA));
  const beta = personaDaRiga(rigaDest(UFFICIO_BETA, "ufficio_gare", { impresa_id: BETA }));
  atteso("A1.1 altra_impresa: chiesta direttamente alla regola", !!beta && motivoDi(riceve(beta, null, conBeta.impresa, "scadenze")) === "altra_impresa" && destinatariCheRicevono([beta], new Map([[UFFICIO_BETA, pref()]]), conBeta.impresa, "scadenze").length === 0);
  const ruoliFalsati = await catena({ destinatari: [rigaDest(UFFICIO_ALFA, "titolare"), rigaDest(ALFA, "ufficio_gare")] });
  uguale("A1.1 altra_impresa: «titolare» che non è l'impresa, «Ufficio Gare» che è l'impresa", [motivoDi(ruoliFalsati.esito(UFFICIO_ALFA)), motivoDi(ruoliFalsati.esito(ALFA))], ["altra_impresa", "altra_impresa"]);

  uguale("A1.2 radar_non_attivo: Opportunità spenta per l'impresa", motivoDi((await catena({ radarAttivo: false })).esito(ALFA)), "radar_non_attivo");

  uguale("A1.3 abbonamento_non_valido: diritto non operativo", motivoDi((await catena({ operativo: false })).esito(ALFA)), "abbonamento_non_valido");
  uguale("A1.3 abbonamento non controllato (null, D-E8 aperta): riceve", motivoDi((await catena({ operativo: null })).esito(ALFA)), "riceve");

  uguale(
    "A1.4 email_impresa_spente: spente dal titolare, riga dell'impresa assente, valore non booleano",
    [
      motivoDi((await catena({ impresa: [{ impresa_id: BETA, email_attive: true }, { impresa_id: ALFA, email_attive: false }] })).esito(ALFA)),
      motivoDi((await catena({ impresa: [{ impresa_id: BETA, email_attive: true }] })).esito(ALFA)),
      motivoDi((await catena({ impresa: [{ impresa_id: ALFA, email_attive: "true" }] })).esito(ALFA)),
    ],
    ["email_impresa_spente", "email_impresa_spente", "email_impresa_spente"],
  );

  uguale(
    "A1.5 membro_disattivato: Ufficio Gare sospeso o stato mancante",
    [
      motivoDi((await catena({ destinatari: [rigaDest(UFFICIO_ALFA, "ufficio_gare", { membro_attivo: false })] })).esito(UFFICIO_ALFA)),
      motivoDi((await catena({ destinatari: [rigaDest(UFFICIO_ALFA, "ufficio_gare", { membro_attivo: undefined })] })).esito(UFFICIO_ALFA)),
    ],
    ["membro_disattivato", "membro_disattivato"],
  );

  uguale(
    "A1.6 utente_bloccato: bloccato o dato mancante (nel dubbio bloccato)",
    [
      motivoDi((await catena({ destinatari: [rigaDest(ALFA, "titolare", { bloccato: true })] })).esito(ALFA)),
      motivoDi((await catena({ destinatari: [rigaDest(ALFA, "titolare", { bloccato: undefined })] })).esito(ALFA)),
    ],
    ["utente_bloccato", "utente_bloccato"],
  );

  const indirizzi = [null, "", "senza-chiocciola", "a@b", `${"x".repeat(309)}@alfa.example`];
  const mancanti: string[] = [];
  for (const email of indirizzi) mancanti.push(motivoDi((await catena({ destinatari: [rigaDest(ALFA, "titolare", { email })] })).esito(ALFA)));
  uguale("A1.7 email_mancante: assente, vuota, senza @, senza dominio, oltre 320 caratteri", mancanti, indirizzi.map(() => "email_mancante"));

  const daVerificare = await catena({ destinatari: [rigaDest(ALFA, "titolare", { email_confermata: false }), rigaDest(UFFICIO_ALFA, "ufficio_gare", { email_confermata: undefined })] });
  uguale("A1.8 email_da_verificare: non confermata o dato mancante", [motivoDi(daVerificare.esito(ALFA)), motivoDi(daVerificare.esito(UFFICIO_ALFA))], ["email_da_verificare", "email_da_verificare"]);
  const pDaVerificare = daVerificare.lettura.persone?.find((p) => p.userId === ALFA);
  atteso("A1.8 stato dell'indirizzo «da verificare»", !!pDaVerificare && statoIndirizzo(pDaVerificare, daVerificare.lettura.preferenze.get(ALFA) ?? null) === "da_verificare");

  const bloccata = await catena({ persone: [rigaPref(ALFA, { email_bloccata_il: "2026-11-19T10:00:00.000Z", motivo_blocco: "rimbalzo" }), rigaPref(UFFICIO_ALFA)] });
  const pBloccata = bloccata.lettura.persone?.find((p) => p.userId === ALFA);
  atteso("A1.9 email_bloccata: indirizzo bloccato dopo un rimbalzo, stato «bloccato»", motivoDi(bloccata.esito(ALFA)) === "email_bloccata" && !!pBloccata && statoIndirizzo(pBloccata, bloccata.lettura.preferenze.get(ALFA) ?? null) === "bloccato");

  const senzaRiga = await catena({ persone: [rigaPref(ALFA)] });
  uguale("A1.10 categoria_spenta: nessuna riga delle preferenze = tutto spento", CATEGORIE_NOTIFICA.map((c) => motivoDi(senzaRiga.esito(UFFICIO_ALFA, c))), CATEGORIE_NOTIFICA.map(() => "categoria_spenta"));
  const unaSpenta = await catena({ persone: [rigaPref(ALFA, { scadenze: false }), rigaPref(UFFICIO_ALFA, { scadenze: "true", rettifiche: 1 })] });
  uguale(
    "A1.10 categoria_spenta: la sola categoria spenta; «true» o 1 al posto del booleano non accendono",
    [motivoDi(unaSpenta.esito(ALFA, "scadenze")), motivoDi(unaSpenta.esito(ALFA, "rettifiche")), motivoDi(unaSpenta.esito(UFFICIO_ALFA, "scadenze")), motivoDi(unaSpenta.esito(UFFICIO_ALFA, "rettifiche")), motivoDi(unaSpenta.esito(UFFICIO_ALFA, "nuove_opportunita"))],
    ["categoria_spenta", "riceve", "categoria_spenta", "categoria_spenta", "riceve"],
  );

  // più motivi insieme: tutti, nell'ordine dal più generale al più specifico, il primo con il suo testo
  const molti = (await catena({ radarAttivo: false, destinatari: [rigaDest(UFFICIO_ALFA, "ufficio_gare", { membro_attivo: false, email: null })], persone: [] })).esito(UFFICIO_ALFA);
  atteso(
    "A1.11 più motivi: tutti, in ordine, il primo con il suo testo",
    !!molti && !molti.riceve && JSON.stringify(molti.motivi) === JSON.stringify(["radar_non_attivo", "membro_disattivato", "email_mancante", "categoria_spenta"]) && molti.motivo === "radar_non_attivo" && molti.testo === TESTO_MOTIVO.radar_non_attivo,
    JSON.stringify(molti),
  );
  uguale("A1.11 ordine dei motivi (dal più generale al più specifico)", ORDINE_MOTIVI, ["altra_impresa", "radar_non_attivo", "abbonamento_non_valido", "email_impresa_spente", "membro_disattivato", "utente_bloccato", "email_mancante", "email_da_verificare", "email_bloccata", "categoria_spenta"]);

  const doppia = await catena({ destinatari: [rigaDest(ALFA, "titolare"), rigaDest(ALFA, "titolare"), rigaDest(UFFICIO_ALFA, "ufficio_gare")] });
  uguale("A1.12 una persona elencata due volte riceve una volta sola", doppia.ricevono("scadenze"), [ALFA, UFFICIO_ALFA]);

  const maiuscole = await catena({ destinatari: [rigaDest(ALFA, "titolare", { email: "  Titolare@ALFA.Example " })] });
  uguale("A1.13 indirizzo normalizzato (spazi tolti, minuscole) e mai nella vista", maiuscole.lettura.persone?.[0]?.email, "titolare@alfa.example");

  const senzaId = await catena({ persone: [rigaPref(ALFA), { ...rigaPref(UFFICIO_ALFA), user_id: null }, { ...rigaPref(UFFICIO_ALFA), user_id: 7 }] });
  uguale("A1.14 righe delle preferenze senza user_id valido ignorate (quella persona: tutto spento)", [[...senzaId.lettura.preferenze.keys()], motivoDi(senzaId.esito(UFFICIO_ALFA))], [[ALFA], "categoria_spenta"]);

  atteso(
    "A1.15 la pagina costruisce lo stato dell'impresa come la catena provata qui",
    leggi("src/app/site-omnia-ai/dashboard/omnia-ai/opportunita/notifiche/page.tsx").includes("{ impresaId: contesto.accountId, radarAttivo: cliente?.attivo === true, emailAttive: lettura.emailAttive, abbonamentoValido: diritto.operativo }"),
  );
}

// ───── A3. Ufficio Gare e una «riga altrui con lo stesso indirizzo» (38B §1.5 A3) ─────
// Nel database un indirizzo appartiene a un solo utente, ma la pagina e la regola non devono MAI riconoscere le persone dall'indirizzo:
// solo dall'identificativo. Qui titolare di ALFA, Ufficio Gare di ALFA e Ufficio Gare di BETA hanno lo stesso indirizzo.

async function proveA3() {
  const STESSO = "gare@alfa.example";
  const destinatari = [rigaDest(ALFA, "titolare", { email: STESSO }), rigaDest(UFFICIO_ALFA, "ufficio_gare", { email: STESSO }), rigaDest(UFFICIO_BETA, "ufficio_gare", { impresa_id: BETA, email: STESSO })];
  const proprie = { nuove_opportunita: false, scadenze: true, rettifiche: false };
  const persone = [rigaPref(ALFA), rigaPref(UFFICIO_ALFA, proprie), rigaPref(UFFICIO_BETA, { impresa_id: BETA })];
  const c = await catena({ destinatari, persone });
  const tutte = destinatari.map(personaDaRiga).filter((p): p is PersonaImpresa => !!p);

  const vistaUfficio = personeVisibili({ persone: c.lettura.persone ?? [], preferenze: c.lettura.preferenze, impresa: c.impresa, chiGuarda: UFFICIO });
  uguale("A3.1 l'Ufficio Gare vede solo la propria riga, con le PROPRIE preferenze", vistaUfficio.map((p) => [p.userId, p.tu, p.categorie]), [[UFFICIO_ALFA, true, proprie]]);
  uguale(
    "A3.1 anche se l'elenco contenesse persone di altre imprese con lo stesso indirizzo",
    personeVisibili({ persone: tutte, preferenze: c.lettura.preferenze, impresa: c.impresa, chiGuarda: UFFICIO }).map((p) => p.userId),
    [UFFICIO_ALFA],
  );

  const vistaTitolare = personeVisibili({ persone: c.lettura.persone ?? [], preferenze: c.lettura.preferenze, impresa: c.impresa, chiGuarda: TITOLARE });
  uguale(
    "A3.2 il titolare vede due righe distinte con lo stesso indirizzo, ognuna con le sue preferenze",
    vistaTitolare.map((p) => [p.userId, p.categorie]),
    [[ALFA, ACCESE], [UFFICIO_ALFA, proprie]],
  );

  const registro: string[] = [];
  const admin = clienteFinto({ [TABELLA_NOTIFICHE_IMPRESA]: [{ impresa_id: ALFA, email_attive: true }, { impresa_id: BETA, email_attive: true }], [TABELLA_NOTIFICHE_PERSONE]: persone }, {}, registro);
  const attuali = await leggiPreferenzePersona(admin, ALFA, UFFICIO_ALFA);
  uguale("A3.3 preferenze attuali lette per impresa E persona: quelle dell'Ufficio Gare, non della riga altrui", attuali, { ok: true, esisteImpresa: true, categorie: proprie });
  const categorieAttuali = attuali.ok ? attuali.categorie : null;
  const prova = (destinatarioId: string, richieste: CategoriePreferenze) => {
    const e = validaModificaPreferenze({ chiModifica: UFFICIO, destinatarioId, persone: PERSONE_ALFA, attuali: categorieAttuali, richieste });
    return e.ok ? "ok" : e.errore;
  };
  uguale(
    "A3.4 Ufficio Gare: non tocca la riga altrui con lo stesso indirizzo né quella dell'altra impresa; spegne le proprie; non riaccende ciò che è acceso solo nella riga altrui",
    [prova(ALFA, TUTTO_SPENTO), prova(UFFICIO_BETA, TUTTO_SPENTO), prova(UFFICIO_ALFA, TUTTO_SPENTO), prova(UFFICIO_ALFA, { ...proprie, rettifiche: true })],
    [MESSAGGIO_SOLO_PROPRIE, "Persona non valida.", "ok", MESSAGGIO_RIACCENDERE],
  );

  const altruiBloccata = await catena({ destinatari, persone: [rigaPref(ALFA, { email_bloccata_il: "2026-11-19T10:00:00.000Z", motivo_blocco: "reclamo" }), rigaPref(UFFICIO_ALFA, proprie)] });
  const statoDi = (k: Awaited<ReturnType<typeof catena>>, userId: string) => {
    const p = k.lettura.persone?.find((x) => x.userId === userId);
    return p ? statoIndirizzo(p, k.lettura.preferenze.get(userId) ?? null) : "assente";
  };
  uguale(
    "A3.5 il blocco della riga altrui (stesso indirizzo) non blocca la propria",
    [statoDi(altruiBloccata, ALFA), statoDi(altruiBloccata, UFFICIO_ALFA), motivoDi(altruiBloccata.esito(UFFICIO_ALFA))],
    ["bloccato", "verificato", "riceve"],
  );

  uguale(
    "A3.6 la regola decide per persona, mai per indirizzo",
    [c.ricevono("scadenze"), c.ricevono("rettifiche"), c.ricevono("nuove_opportunita")],
    [[ALFA, UFFICIO_ALFA], [ALFA], [ALFA]],
  );
  const ufficioSpento = await catena({ destinatari, persone: [rigaPref(ALFA, { scadenze: false }), rigaPref(UFFICIO_ALFA, proprie)] });
  uguale("A3.6 spenta dal titolare, accesa dall'Ufficio Gare: riceve solo l'Ufficio Gare", ufficioSpento.ricevono("scadenze"), [UFFICIO_ALFA]);

  const sorgenti = ["src/lib/radar/notifiche-preferenze.ts", "src/lib/radar/notifiche-preferenze-calcoli.ts", "src/app/actions/radar-notifiche.ts"].map(leggi).join("\n");
  atteso("A3.7 nessuna lettura o scelta per indirizzo email nel codice della pagina", !/\.eq\(\s*"email"|\.email\s*===|===\s*[\w.]*\.email\b/.test(sorgenti));
}

// ───── A8. «Scadenza ravvicinata» agganciata alle azioni di Opportunità (regola e lavoro di B2: notifiche/ravvicinata.ts) ─────

async function proveA8() {
  delete process.env.RADAR_NOTIFICHE_EMAIL; // le prove girano sempre a interruttore unico spento, come di base
  const PROCEDURA = "00000000-0000-4000-a000-00000000c001";
  const AGGIUNTA = "00000000-0000-4000-a000-00000000c002";
  const pianificati: (() => Promise<EsitoRavvicinata>)[] = [];
  const pianifica: Pianificatore = (lavoro) => {
    pianificati.push(lavoro);
  };
  uguale(
    "A8.1 gara dell'archivio: una sola gara, impresa = titolare, autore = chi salva",
    pianificaScadenzaRavvicinata({ impresaId: ALFA, autoreId: UFFICIO_ALFA, proceduraId: PROCEDURA }, pianifica),
    { impresaId: ALFA, proceduraId: PROCEDURA, aggiuntaId: null, autoreId: UFFICIO_ALFA },
  );
  atteso("A8.1 il lavoro è PIANIFICATO (after di Next, dopo la risposta), non eseguito subito", pianificati.length === 1);
  uguale(
    "A8.2 gara aggiunta a mano",
    pianificaScadenzaRavvicinata({ impresaId: ALFA, autoreId: ALFA, aggiuntaId: AGGIUNTA }, pianifica),
    { impresaId: ALFA, proceduraId: null, aggiuntaId: AGGIUNTA, autoreId: ALFA },
  );
  const doppia = pianificaScadenzaRavvicinata({ impresaId: ALFA, autoreId: ALFA, proceduraId: PROCEDURA, aggiuntaId: AGGIUNTA } as unknown as IngressoInLista, pianifica);
  const nessuna = pianificaScadenzaRavvicinata({ impresaId: ALFA, autoreId: ALFA } as unknown as IngressoInLista, pianifica);
  atteso("A8.3 mai due gare insieme né nessuna: rifiutato e niente pianificato", doppia === null && nessuna === null && pianificati.length === 2);
  const esiti = await Promise.all(pianificati.map((lavoro) => lavoro()));
  uguale("A8.4 eseguito dopo, a interruttore unico spento: «spento» (B2 non legge né scrive), nessuna eccezione", esiti, [{ esito: "spento" }, { esito: "spento" }]);

  const aiuto = leggi("src/lib/radar/ingresso-lista.ts");
  atteso(
    "A8.5 il modulo pianifica con after() di Next e chiama B2 SOLO dentro il lavoro pianificato",
    aiuto.includes('import { after } from "next/server";') &&
      aiuto.includes("pianifica: Pianificatore = after") &&
      (aiuto.match(/dopoIngressoInLista\(/g) ?? []).length === 1 &&
      /pianifica\(async \(\) => \{\n\s*const esito = await dopoIngressoInLista\(gara\);/.test(aiuto),
  );

  const azioni = leggi("src/app/actions/radar.ts");
  const chiamate = [...azioni.matchAll(/pianificaScadenzaRavvicinata\(([^;]*)\);/g)].map((m) => m[1]);
  atteso(
    "A8.6 radar.ts: tre agganci (salva/monitora, archivio da «aggiungi», gara aggiunta), nessuna chiamata diretta a B2 né after() fuori dal modulo",
    chiamate.length === 3 && !senzaCommenti(azioni).includes("dopoIngressoInLista") && !/\bafter\b/.test(senzaCommenti(azioni)) && azioni.includes('import { pianificaScadenzaRavvicinata } from "@/lib/radar/ingresso-lista";'),
    `${chiamate.length} chiamate`,
  );
  const oggetti = chiamate.flatMap((c) => [...c.matchAll(/\{[^{}]*\}/g)].map((m) => m[0]));
  atteso(
    "A8.7 ogni gara passata ha ESATTAMENTE uno tra proceduraId e aggiuntaId, impresa dell'account e autore della sessione",
    oggetti.length === 4 && oggetti.every((o) => /\bproceduraId\b/.test(o) !== /\baggiuntaId\b/.test(o) && o.includes("impresaId: g.contesto.accountId") && o.includes("autoreId: g.contesto.userId")),
    oggetti.join(" ; "),
  );
  const salva = azioni.slice(azioni.indexOf("export async function aggiornaSalvataggio"), azioni.indexOf("export async function aggiungiGaraAMano"));
  const iErrore = salva.indexOf('return { errore: "Non è stato possibile salvare la gara." };');
  const iAggancio = salva.indexOf("pianificaScadenzaRavvicinata(");
  atteso(
    "A8.8 salva/monitora: solo dopo la scrittura riuscita, solo quando la gara ENTRA nella lista (mai per «rimuovi» o «non monitorare»)",
    iErrore > 0 &&
      iAggancio > iErrore &&
      iAggancio < salva.lastIndexOf("ricarica(proceduraId, aggiuntaId);") &&
      salva.slice(iErrore, iAggancio + "pianificaScadenzaRavvicinata(".length).includes('if ((azione === "salva" || azione === "monitora") && (!esistente || (monitorata === true && !esistente.monitorata)))\n    pianificaScadenzaRavvicinata(') &&
      salva.indexOf("pianificaScadenzaRavvicinata(") === salva.lastIndexOf("pianificaScadenzaRavvicinata("),
  );
  const aggiungi = azioni.slice(azioni.indexOf("export async function aggiungiGaraAMano"));
  const iRedirect = aggiungi.indexOf("redirect(destinazione);");
  const archivio = "if (!erroreArchivio) pianificaScadenzaRavvicinata({ impresaId: g.contesto.accountId, autoreId: g.contesto.userId, proceduraId: lotto.procedura_id });";
  const aggiunta = "if (!erroreSalvata) pianificaScadenzaRavvicinata({ impresaId: g.contesto.accountId, autoreId: g.contesto.userId, aggiuntaId: nuova.id });";
  atteso(
    "A8.9 «aggiungi a mano»: solo se la gara è davvero entrata tra le salvate (scrittura riuscita), prima del redirect (after parte anche con redirect)",
    aggiungi.includes(`const { error: erroreArchivio } = await supabase.from("omnia_ai_radar_salvate").upsert(`) &&
      aggiungi.indexOf(archivio) > aggiungi.indexOf("const { error: erroreArchivio }") &&
      aggiungi.indexOf(aggiunta) > aggiungi.indexOf("const { error: erroreSalvata }") &&
      [archivio, aggiunta].every((s) => aggiungi.indexOf(s) > 0 && aggiungi.indexOf(s) < iRedirect) &&
      (aggiungi.match(/pianificaScadenzaRavvicinata\(/g) ?? []).length === 2,
  );
  const b2 = leggi("src/lib/radar/notifiche/ravvicinata.ts");
  atteso("A8.10 contratto di B2 invariato: dopoIngressoInLista(gara, opzioni) con l'interruttore unico", /export async function dopoIngressoInLista\(gara: GaraEntrataInLista, opzioni: OpzioniRavvicinata = \{\}\): Promise<EsitoRavvicinata>/.test(b2) && b2.includes("if (!invioEmailAcceso(env)) return { esito: \"spento\" };"));
}

proveA1()
  .then(proveA3)
  .then(proveA8)
  .then(
    () => {
      console.log(fallimenti.length ? `\n${fallimenti.length} controlli FALLITI` : "\nTutti i controlli del grado 3 della fase B4 sono passati.");
      process.exit(fallimenti.length ? 1 : 0);
    },
    (e: unknown) => {
      console.log(`FALLITO prove A1/A3 interrotte: ${e instanceof Error ? e.message : String(e)}`);
      process.exit(1);
    },
  );
