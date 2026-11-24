// Verifica del pacchetto P (piano 55 §2, decisione dell'utente D-F del 23/11; 55A D-C per le email): gli interruttori di B2 accesi sullo
// staging come prima e in produzione SOLO sul deploy di produzione con la variabile esatta (schema di K8). Nessuna rete, nessun database.
// Uso: npx tsx scripts/verifica-pacchetto-p.ts
import { classificazioniAttive, interruttoreRadar } from "../src/lib/radar/ambiente";
import { registroConEvidenza } from "../src/lib/radar/importa-evidenza";
import { statoInvioEmail } from "../src/lib/radar/notifiche/interruttore";
import { conDestinatarioDiProva, ProviderFinto, resendConsentito, sceltaProvider, VARIABILE_DESTINATARIO_PROVA, type MessaggioEmail, type ProviderEmail } from "../src/lib/radar/notifiche/provider";

const falliti: string[] = [];
let ok = 0;
const atteso = (nome: string, cond: boolean, dettaglio?: unknown) => {
  if (cond) ok++;
  else {
    falliti.push(nome);
    console.log(`FALLITO ${nome}${dettaglio === undefined ? "" : ` → ${JSON.stringify(dettaglio).slice(0, 400)}`}`);
  }
};
const uguale = (nome: string, reale: unknown, previsto: unknown) => atteso(nome, JSON.stringify(reale) === JSON.stringify(previsto), { previsto, reale });

const STAGING = "https://ryawdldqiumqsskrnyps.supabase.co";
const PROD = "https://bihfrzspqxsrzlbqqvqa.supabase.co";
// gli ambienti: database × VERCEL_ENV
const AMBIENTI: [string, Record<string, string | undefined>][] = [
  ["staging, locale", { NEXT_PUBLIC_SUPABASE_URL: STAGING }],
  ["staging, anteprima", { NEXT_PUBLIC_SUPABASE_URL: STAGING, VERCEL_ENV: "preview" }],
  ["staging, deploy di produzione", { NEXT_PUBLIC_SUPABASE_URL: STAGING, VERCEL_ENV: "production" }],
  ["produzione, deploy di produzione", { NEXT_PUBLIC_SUPABASE_URL: PROD, VERCEL_ENV: "production" }],
  ["produzione, anteprima", { NEXT_PUBLIC_SUPABASE_URL: PROD, VERCEL_ENV: "preview" }],
  ["produzione, development", { NEXT_PUBLIC_SUPABASE_URL: PROD, VERCEL_ENV: "development" }],
  ["produzione, computer locale", { NEXT_PUBLIC_SUPABASE_URL: PROD }],
  ["database sconosciuto, deploy di produzione", { NEXT_PUBLIC_SUPABASE_URL: "https://altro.supabase.co", VERCEL_ENV: "production" }],
  ["nessun database", { VERCEL_ENV: "production" }],
];
// valore esatto e valori quasi uguali (mai accesi)
const VALORI = (esatto: string) => [esatto, ` ${esatto}`, esatto.toUpperCase(), "1", "true", undefined];

type Interruttore = { nome: string; variabile: string; valore: string; fn: (env: Record<string, string | undefined>) => boolean; anteprimaSulloStaging: boolean };
const INTERRUTTORI: Interruttore[] = [
  { nome: "classificazioniAttive", variabile: "RADAR_CLASSIFICAZIONI", valore: "attive", fn: classificazioniAttive, anteprimaSulloStaging: true },
  { nome: "registroConEvidenza", variabile: "RADAR_REGISTRO_EVIDENZA", valore: "attivo", fn: registroConEvidenza, anteprimaSulloStaging: false },
  { nome: "statoInvioEmail", variabile: "RADAR_NOTIFICHE_EMAIL", valore: "attivo", fn: (env) => statoInvioEmail(env).acceso, anteprimaSulloStaging: false },
];
const accesoAtteso = (amb: string, i: Interruttore) =>
  (amb.startsWith("staging") && (i.anteprimaSulloStaging || !amb.includes("anteprima"))) || amb === "produzione, deploy di produzione";

// ───── 1. matrice ambiente × valore della variabile ─────
let celle = 0;
for (const i of INTERRUTTORI) {
  const errori: string[] = [];
  for (const [amb, base] of AMBIENTI) {
    for (const v of VALORI(i.valore)) {
      celle++;
      const env = { ...base, [i.variabile]: v };
      const previsto = v === i.valore && accesoAtteso(amb, i);
      if (i.fn(env) !== previsto) errori.push(`${amb} / ${JSON.stringify(v)} → ${!previsto}`);
    }
  }
  atteso(`${i.nome}: acceso SOLO con «${i.variabile}=${i.valore}» esatto, sullo staging${i.anteprimaSulloStaging ? " (anche anteprime, che leggono)" : " fuori dalle anteprime"} o sul deploy di produzione con il database di produzione`, errori.length === 0, errori);
}
uguale("matrice: 3 interruttori × 9 ambienti × 6 valori", celle, 162);
atteso("lo stesso schema per tutti: interruttoreRadar usato da classificazioni ed evidenza", classificazioniAttive({ NEXT_PUBLIC_SUPABASE_URL: PROD, VERCEL_ENV: "production", RADAR_CLASSIFICAZIONI: "attive" }) === interruttoreRadar({ NEXT_PUBLIC_SUPABASE_URL: PROD, VERCEL_ENV: "production", X: "attive" }, "X", "attive", { anteprimaSulloStaging: true }));
uguale("email: in produzione l'ambiente è «produzione», sullo staging «staging»; spente di base (variabile assente)",
  [statoInvioEmail({ NEXT_PUBLIC_SUPABASE_URL: PROD, VERCEL_ENV: "production", RADAR_NOTIFICHE_EMAIL: "attivo" }), statoInvioEmail({ NEXT_PUBLIC_SUPABASE_URL: STAGING, RADAR_NOTIFICHE_EMAIL: "attivo" }), statoInvioEmail({ NEXT_PUBLIC_SUPABASE_URL: PROD, VERCEL_ENV: "production" })],
  [{ acceso: true, ambiente: "produzione" }, { acceso: true, ambiente: "staging" }, { acceso: false, motivo: "spento" }]);

// ───── 2. Resend: SOLO in produzione con l'interruttore acceso; il finto altrove ─────
const errResend: string[] = [];
for (const [amb, base] of AMBIENTI) for (const v of VALORI("attivo")) {
  const env = { ...base, RADAR_NOTIFICHE_EMAIL: v };
  if (resendConsentito(env) !== (v === "attivo" && amb === "produzione, deploy di produzione")) errResend.push(`${amb} / ${JSON.stringify(v)}`);
}
atteso("resendConsentito: vero SOLO in produzione sul deploy di produzione con RADAR_NOTIFICHE_EMAIL=attivo (mai sullo staging, che usa il finto)", errResend.length === 0, errResend);
const PRODUZIONE_ACCESA = { NEXT_PUBLIC_SUPABASE_URL: PROD, VERCEL_ENV: "production", RADAR_NOTIFICHE_EMAIL: "attivo", RESEND_API_KEY: "re_prova_sintetica" };
const chiavi: string[] = [];
const finto = (chiave: string): ProviderEmail => { chiavi.push(chiave); return Object.assign(new ProviderFinto(), { nome: "resend" as const }); };
uguale("sceltaProvider: il finto ovunque senza Resend consentito, anche se l'adattatore c'è", AMBIENTI.filter(([a]) => a !== "produzione, deploy di produzione").map(([, base]) => sceltaProvider({ ...base, RADAR_NOTIFICHE_EMAIL: "attivo", RESEND_API_KEY: "x" }, finto).nome), Array(8).fill("finto"));
uguale("sceltaProvider: in produzione accesa costruisce Resend con la chiave RESEND_API_KEY", [sceltaProvider(PRODUZIONE_ACCESA, finto).nome, chiavi], ["resend", ["re_prova_sintetica"]]);
const lancia = (f: () => unknown) => { try { f(); return ""; } catch (e) { return (e as Error).message; } };
atteso("sceltaProvider: in produzione accesa SENZA chiave o senza adattatore → errore, nessuna email", /RESEND_API_KEY mancante/.test(lancia(() => sceltaProvider({ ...PRODUZIONE_ACCESA, RESEND_API_KEY: undefined }, finto))) && /adattatore/.test(lancia(() => sceltaProvider(PRODUZIONE_ACCESA))));

async function provaF8(): Promise<void> {
// ───── 3. F8: destinatario di prova forzato (un indirizzo interno) ─────
const base = new ProviderFinto();
const conProva = sceltaProvider({ ...PRODUZIONE_ACCESA, [VARIABILE_DESTINATARIO_PROVA]: "prova@esempio.invalid" }, () => Object.assign(base, { nome: "resend" as const }));
const m: MessaggioEmail = { a: "cliente@esempio.invalid", oggetto: "Nuove gare", html: "<p>x</p>", testo: "x", chiaveIdempotenza: "omnia-radar/abc" } as MessaggioEmail;
await conProva.invia(m);
uguale("prova F8: ogni email va SOLO all'indirizzo di prova, con «[PROVA]» e una chiave propria", base.consegnate.map((c) => [c.a, c.oggetto, c.chiave]), [["prova@esempio.invalid", "[PROVA] Nuove gare", "prova-omnia-radar/abc"]]);
atteso("prova F8: un indirizzo non valido ferma tutto (nessun invio)", /non è un indirizzo email valido/.test(lancia(() => conDestinatarioDiProva(new ProviderFinto(), "non-un-indirizzo"))) && /non è un indirizzo email valido/.test(lancia(() => sceltaProvider({ ...PRODUZIONE_ACCESA, [VARIABILE_DESTINATARIO_PROVA]: "" }, finto))));
uguale("prova F8: la variabile è RADAR_EMAIL_DESTINATARIO_PROVA e sullo staging non cambia nulla (provider finto)", [VARIABILE_DESTINATARIO_PROVA, sceltaProvider({ NEXT_PUBLIC_SUPABASE_URL: STAGING, RADAR_NOTIFICHE_EMAIL: "attivo", [VARIABILE_DESTINATARIO_PROVA]: "prova@esempio.invalid" }).nome], ["RADAR_EMAIL_DESTINATARIO_PROVA", "finto"]);
}

provaF8().then(() => {
  console.log(`Verifica del pacchetto P (interruttori di produzione di B2): ${ok} ok, ${falliti.length} falliti`);
  process.exit(falliti.length ? 1 : 0);
});
