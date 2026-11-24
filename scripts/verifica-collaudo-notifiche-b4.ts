// Prove a secco dello script del collaudo del grado 3 della fase B4 (scripts/collaudo-notifiche-b4.mjs, piano 41), 20/11/2026. Uno STAGING
// FINTO in memoria con le regole di accesso vere della 0124 (lettura: interruttore a tutta l'impresa, persone al titolare e alla propria riga;
// nessuna scrittura ai clienti), la 0125 assente e solo dati SINTETICI: nessun database, nessuna rete verso l'esterno (ammessi solo i server
// locali delle prove). Finestra completa nell'ordine del piano, fermi simulati, verifiche finali, sorveglianza della rete, prove nel browser.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const richiesteEsterne: string[] = [];
const fetchVero = globalThis.fetch;
globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
  const host = new URL(url instanceof Request ? url.url : String(url)).hostname;
  if (!["localhost", "127.0.0.1", "[::1]", "::1"].includes(host)) {
    richiesteEsterne.push(host);
    throw new Error(`verifica collaudo grado 3: richiesta di rete vietata verso ${host}`);
  }
  return fetchVero(url, init);
}) as typeof fetch;

const RADICE = path.resolve(__dirname, "..");
const fallimenti: string[] = [];
function atteso(nome: string, ok: boolean, dettaglio = "") {
  console.log(`${ok ? "ok    " : "FALLITO"} ${nome}${ok || !dettaglio ? "" : ` — ${dettaglio}`}`);
  if (!ok) fallimenti.push(nome);
}

// ───── staging finto ─────
const STAGING = "https://ryawdldqiumqsskrnyps.supabase.co";
const SEGRETA = "sb_secret_SINTETICA_DA_NON_STAMPARE";
const PUBBLICA = "sb_publishable_SINTETICA";
const VECCHIA = "2026-11-18T16:40:00.000Z";
const ADESSO = Date.parse("2026-11-21T10:00:00.000Z");
const NUOVA = "2026-11-21T10:05:00.000Z";
const ID = {
  t1: "00000000-0000-4000-8000-000000000111",
  t2: "00000000-0000-4000-8000-000000000222",
  t3: "00000000-0000-4000-8000-000000000333",
  uff: "00000000-0000-4000-8000-000000000444",
  estraneo: "00000000-0000-4000-8000-000000000555",
};
const EMAIL = { t1: "ti-titolare@prova.test", t2: "ti-titolare2@prova.test", t3: "titolare-benchmark@prova.test", uff: "ufficio-benchmark@prova.test" };
const ID_DA_EMAIL = new Map(Object.entries(EMAIL).map(([k, e]): [string, string] => [e, ID[k as keyof typeof ID]]));
const ACCESSO = new Map(Object.values(EMAIL).map((e): [string, string] => [e, `ACCESSO_SINTETICO_${e.split("@")[0]}_${"x".repeat(3000)}`]));
const VIETATI = /TOKEN_SINTETICO|ACCESSO_SINTETICO|RINNOVO_SINTETICO|sb_secret_|sb_publishable_|token_hash|base64-|0000000001|0000000002|0000000003|0000000004|0000000005/;
const IMPRESA = "omnia_ai_radar_notifiche_impresa";
const PERSONE = "omnia_ai_radar_notifiche_persone";

type Riga = Record<string, unknown>;
type Chiamata = { metodo: string; url: string; auth: string };

function filtra(valore: unknown, espressione: string): boolean {
  if (espressione === "not.is.null") return valore !== null && valore !== undefined;
  const i = espressione.indexOf(".");
  const op = espressione.slice(0, i);
  const x = espressione.slice(i + 1);
  if (op === "eq") return String(valore) === x;
  if (op === "gte") return valore !== null && valore !== undefined && Date.parse(String(valore)) >= Date.parse(x);
  if (op === "lt") return valore !== null && valore !== undefined && Date.parse(String(valore)) < Date.parse(x);
  if (op === "in") return x.replace(/^\(|\)$/g, "").split(",").includes(String(valore));
  throw new Error(`operatore finto non previsto: ${op}`);
}

function stagingFinto() {
  const dati: Record<string, Riga[]> = {
    users: Object.entries(EMAIL).map(([k, e]) => ({ id: ID[k as keyof typeof ID], email: e })),
    omnia_ai_membri: [{ membro_id: ID.uff, titolare_id: ID.t3, attivo: true }],
    omnia_ai_radar_impostazioni: [
      { user_id: ID.t1, attivo: true, aggiornata_il: VECCHIA },
      { user_id: ID.t2, attivo: true, aggiornata_il: VECCHIA },
      { user_id: ID.t3, attivo: true, aggiornata_il: VECCHIA },
    ],
    [IMPRESA]: [],
    [PERSONE]: [],
    omnia_ai_radar_profili: [{ id: "p1", user_id: ID.t1, aggiornato_il: VECCHIA }, { id: "p3", user_id: ID.t3, aggiornato_il: VECCHIA }],
    omnia_ai_radar_salvate: [{ id: "s1", user_id: ID.t1, creata_il: VECCHIA, aggiornata_il: VECCHIA }],
    omnia_ai_radar_gare_aggiunte: [{ id: "a3", user_id: ID.t3, creata_il: VECCHIA }],
    omnia_ai_radar_utilizzi: [{ id: "u1", user_id: ID.t1, creato_il: VECCHIA }],
    omnia_ai_notifiche: [],
    gare: [{ id: "g1", user_id: ID.t1 }, { id: "g3", user_id: ID.t3 }],
    subscriptions: [{ id: "sub1", user_id: ID.t1 }, { id: "sub3", user_id: ID.t3 }],
    omnia_ai_gare_gratuite: [{ user_id: ID.t2, usate: 0, aggiornato_il: VECCHIA }],
    omnia_ai_gare_gratuite_log: [{ id: "l1", user_id: ID.t2, created_at: VECCHIA }],
    radar_console_registro: [{ id: "r1", creato_il: VECCHIA }],
  };
  const guasti = { scritturaAmmessa: false, funzioneAperta: false, rlsAperta: new Set<string>(), rlsChiusa: new Set<string>(), erroreSessione: new Map<string, number>(), senza0124: false, con0125: false, personeTuttaImpresa: false };
  const chiamate: Chiamata[] = [];
  const hashAEmail = new Map<string, string>();
  let progressivo = 0;
  const json = { "Content-Type": "application/json" };
  const emailDaAuth = (auth: string) => [...ACCESSO].find(([, t]) => `Bearer ${t}` === auth)?.[0] ?? null;
  const effettivo = (uid: string) => (dati.omnia_ai_membri.find((m) => m.membro_id === uid && m.attivo)?.titolare_id as string | undefined) ?? uid;
  // regole di accesso delle tabelle (0001, 0084, 0092, 0111, 0112 e la 0124 vera)
  const POLITICHE: Record<string, ((r: Riga, uid: string, eff: string) => boolean) | "negato"> = {
    users: (r, uid) => r.id === uid,
    omnia_ai_membri: (r, uid) => r.membro_id === uid || r.titolare_id === uid,
    [IMPRESA]: (r, _u, eff) => r.impresa_id === eff,
    [PERSONE]: (r, uid, eff) => r.impresa_id === eff && (guasti.personeTuttaImpresa || r.impresa_id === uid || r.user_id === uid),
    omnia_ai_radar_profili: (r, _u, eff) => r.user_id === eff,
    omnia_ai_radar_salvate: (r, _u, eff) => r.user_id === eff,
    omnia_ai_radar_gare_aggiunte: (r, _u, eff) => r.user_id === eff,
    gare: (r, _u, eff) => r.user_id === eff,
    omnia_ai_gare_gratuite: (r, uid) => r.user_id === uid,
    subscriptions: (r, uid) => r.user_id === uid,
    omnia_ai_notifiche: (r, uid) => r.user_id === uid,
    omnia_ai_radar_impostazioni: "negato",
    omnia_ai_radar_utilizzi: "negato",
    omnia_ai_gare_gratuite_log: "negato",
    radar_console_registro: "negato",
  };
  const fetchFinto = (async (url: string, init?: RequestInit) => {
    const u = new URL(String(url));
    const metodo = init?.method ?? "GET";
    const h = (init?.headers ?? {}) as Record<string, string>;
    const auth = String(h.Authorization ?? "");
    const corpo = String(init?.body ?? "");
    chiamate.push({ metodo, url: String(url), auth });
    if (u.origin !== STAGING) return new Response("{}", { status: 404, headers: json });
    if (u.pathname === "/auth/v1/admin/generate_link") {
      const email = JSON.parse(corpo).email as string;
      const hash = `TOKEN_SINTETICO_${++progressivo}`;
      hashAEmail.set(hash, email);
      return new Response(JSON.stringify({ hashed_token: hash }), { status: 200, headers: json });
    }
    if (u.pathname === "/auth/v1/verify") {
      const email = hashAEmail.get(JSON.parse(corpo).token_hash);
      if (!email) return new Response(JSON.stringify({ code: 403 }), { status: 403, headers: json });
      const utente = { id: ID_DA_EMAIL.get(email), aud: "authenticated", role: "authenticated", email, app_metadata: {}, user_metadata: {} };
      return new Response(JSON.stringify({ access_token: ACCESSO.get(email), token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: "RINNOVO_SINTETICO", user: utente }), { status: 200, headers: json });
    }
    if (u.pathname === "/auth/v1/user") {
      const email = emailDaAuth(auth);
      return email ? new Response(JSON.stringify({ id: ID_DA_EMAIL.get(email), email }), { status: 200, headers: json }) : new Response("{}", { status: 401, headers: json });
    }
    if (!u.pathname.startsWith("/rest/v1/")) return new Response("{}", { status: 404, headers: json });
    const servizio = auth === `Bearer ${SEGRETA}`;
    if (u.pathname === "/rest/v1/rpc/radar_notifiche_destinatari") {
      if (guasti.funzioneAperta) return new Response(JSON.stringify([{ impresa_id: ID.t3, user_id: ID.t3, email: "x@y.it" }]), { status: 200, headers: json });
      return new Response(JSON.stringify({ code: "PGRST202" }), { status: 404, headers: json });
    }
    const tabella = u.pathname.slice("/rest/v1/".length);
    const assente = (guasti.senza0124 && (tabella === IMPRESA || tabella === PERSONE)) || (!guasti.con0125 && ["omnia_ai_radar_eventi", "omnia_ai_radar_email_consegne", "radar_notifiche_giri"].includes(tabella));
    if (assente || !(tabella in dati || guasti.con0125)) return new Response(JSON.stringify({ code: "PGRST205" }), { status: 404, headers: json });
    if (metodo !== "GET") {
      if (servizio) return new Response(JSON.stringify({ message: "scrittura di servizio inattesa" }), { status: 500, headers: json });
      if (!emailDaAuth(auth)) return new Response("{}", { status: 401, headers: json });
      if (guasti.scritturaAmmessa) return new Response(null, { status: 204 });
      return new Response(JSON.stringify({ code: "42501", message: "permission denied" }), { status: 403, headers: json });
    }
    let righe = dati[tabella] ?? [];
    if (!servizio) {
      const email = emailDaAuth(auth);
      if (!email) return new Response("{}", { status: 401, headers: json });
      const uid = ID_DA_EMAIL.get(email) as string;
      const politica = POLITICHE[tabella];
      if (politica === "negato") return new Response(JSON.stringify({ code: "42501" }), { status: 403, headers: json });
      const forzato = guasti.erroreSessione.get(tabella);
      if (forzato) return new Response("{}", { status: forzato, headers: json });
      if (guasti.rlsChiusa.has(tabella)) righe = [];
      else if (!guasti.rlsAperta.has(tabella)) righe = righe.filter((r) => politica(r, uid, effettivo(uid)));
    }
    for (const [k, v] of u.searchParams) if (k !== "select" && k !== "limit") righe = righe.filter((r) => filtra(r[k], v));
    if (h.Prefer === "count=exact") return new Response("[]", { status: 200, headers: { ...json, "Content-Range": righe.length ? `0-0/${righe.length}` : "*/0" } });
    const colonne = (u.searchParams.get("select") ?? "").split(",");
    return new Response(JSON.stringify(righe.map((r) => Object.fromEntries(colonne.map((c) => [c, r[c] ?? null])))), { status: 200, headers: json });
  }) as unknown as typeof fetch;
  // i passi del browser, simulati sui dati come li scrive l'app (chiave di servizio, dopo le guardie)
  const persona = (impresa: string, user: string, v: [boolean, boolean, boolean], autore: string) => ({ impresa_id: impresa, user_id: user, nuove_opportunita: v[0], scadenze: v[1], rettifiche: v[2], aggiornato_da: autore, creato_il: NUOVA, aggiornato_il: NUOVA });
  const passi = {
    p1() {
      dati[IMPRESA].push({ impresa_id: ID.t3, email_attive: true, aggiornato_da: ID.t3, creato_il: NUOVA, aggiornato_il: NUOVA });
      dati[PERSONE].push(persona(ID.t3, ID.t3, [false, true, true], ID.t3), persona(ID.t3, ID.uff, [false, true, true], ID.t3));
    },
    p2() {
      dati[IMPRESA].push({ impresa_id: ID.t1, email_attive: true, aggiornato_da: ID.t1, creato_il: NUOVA, aggiornato_il: NUOVA });
      dati[PERSONE].push(persona(ID.t1, ID.t1, [true, false, true], ID.t1));
    },
    p3() {
      const r = dati[PERSONE].find((x) => x.user_id === ID.uff) as Riga;
      Object.assign(r, { rettifiche: false, aggiornato_da: ID.uff, aggiornato_il: NUOVA });
    },
  };
  return { dati, guasti, chiamate, fetchFinto, passi };
}

type Esito = { codice: number | null; righe: string[]; errore: string; stati: number[]; segnale: boolean; pronto: string[] };

async function prove() {
  const cn = await import("./collaudo-notifiche-b4.mjs");
  const ca = await import("./collaudo-accesso-b4.mjs");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "b4-g3-collaudo-"));
  const progetto = path.join(tmp, "progetto");
  fs.mkdirSync(path.join(progetto, "scripts"), { recursive: true });
  const variabiliValide = [
    `NEXT_PUBLIC_SUPABASE_URL=${STAGING}`,
    `NEXT_PUBLIC_SUPABASE_ANON_KEY=${PUBBLICA}`,
    `SUPABASE_SERVICE_ROLE_KEY=${SEGRETA}`,
    "RADAR_PER_TE=attivo",
    "RADAR_UFFICIO_GARE=attivo",
    "RADAR_CLASSIFICAZIONI=attive",
    "RADAR_NOTIFICHE_PREFERENZE=attivo",
    "RADAR_NOTIFICHE_EMAIL=",
    "RADAR_REGISTRO_EVIDENZA=0",
  ].join("\n");
  const scrivi = (nome: string, testo: string, cartella = tmp) => {
    const f = path.join(cartella, nome);
    fs.writeFileSync(f, testo);
    return f;
  };
  const fileFuori = scrivi("variabili.txt", variabiliValide);
  const fileDentro = scrivi("variabili.txt", variabiliValide, progetto);
  const fileProd = scrivi("variabili-prod.txt", variabiliValide.replace("ryawdldqiumqsskrnyps", "bihfrzspqxsrzlbqqvqa"));
  const fileSpento = scrivi("variabili-spento.txt", variabiliValide.replace("RADAR_NOTIFICHE_PREFERENZE=attivo", "RADAR_NOTIFICHE_PREFERENZE=1"));
  const fileEmail = scrivi("variabili-email.txt", variabiliValide.replace("RADAR_NOTIFICHE_EMAIL=", "RADAR_NOTIFICHE_EMAIL=attivo"));
  const fileEvidenza = scrivi("variabili-evidenza.txt", variabiliValide.replace("RADAR_REGISTRO_EVIDENZA=0", "RADAR_REGISTRO_EVIDENZA=attivo"));
  const fileSenzaUfficio = scrivi("variabili-ufficio.txt", variabiliValide.replace("RADAR_UFFICIO_GARE=attivo", "RADAR_UFFICIO_GARE="));
  const registroRete = scrivi("rete.log", `${VECCHIA} 999 GET https://api.resend.com/emails\n`);
  const envOk = { OSSERVA_RETE_FILE: registroRete };
  const portaOk = () => ({ id: "AUT-SINTETICA", uso: "U1" });
  const stampato: string[] = [];
  const logOriginale = console.log;
  const erroreOriginale = console.error;
  const cattura = async <T,>(fn: () => Promise<T>) => {
    const righe: string[] = [];
    console.log = (...a: unknown[]) => {
      const r = a.map(String).join(" ");
      righe.push(r);
      stampato.push(r);
    };
    console.error = console.log;
    try {
      return { valore: await fn(), righe, errore: "" };
    } catch (e) {
      return { valore: null, righe, errore: e instanceof ca.Fermo ? e.message : `errore inatteso: ${e}` };
    } finally {
      console.log = logOriginale;
      console.error = erroreOriginale;
    }
  };

  // Una finestra completa, guidata come dal browser: passi e scritture simulate tra un clic e l'altro. `prima` cambia i dati prima dei clic.
  const finestra = async (s: ReturnType<typeof stagingFinto>, opzioni: { prima?: () => void; dopo?: Partial<Record<"p1" | "p2" | "p3", () => void>>; finali?: boolean; ordine?: string[]; durataMassimaMs?: number; durante?: () => void } = {}): Promise<Esito> => {
    const stati: number[] = [];
    const pronto: string[] = [];
    let segnale = false;
    opzioni.prima?.();
    const r = await cattura(() =>
      cn.collaudo([fileFuori, "3110"], envOk, {
        cartella: progetto,
        controllaPorta: portaOk,
        fetchFn: s.fetchFinto,
        portaAccesso: 0,
        adesso: () => ADESSO,
        intervalloRete: 20,
        durataMassimaMs: opzioni.durataMassimaMs ?? 60_000,
        avvia: async ({ portaAccesso, segnale: sg }: { portaAccesso: number; segnale: AbortSignal }) => {
          const base = `http://localhost:${portaAccesso}`;
          const leggiPronto = async () => {
            const t = await (await fetch(`${base}/pronto`)).text();
            pronto.push(t);
            return /name="via" value="([^"]+)"/.exec(t)?.[1] ?? "";
          };
          const invia = async (p: string) => {
            const via = await leggiPronto();
            const risposta = await fetch(`${base}${p}`, { method: "POST", redirect: "manual", headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: base }, body: new URLSearchParams({ via }).toString() });
            stati.push(risposta.status);
            return risposta;
          };
          for (const passo of opzioni.ordine ?? ["1", "2", "3"]) {
            if (sg.aborted) break;
            const utente = { "1": "titolare-benchmark", "2": "ti-titolare", "3": "ufficio-benchmark" }[passo] as string;
            const r = await invia(`/accesso/${utente}`);
            if (r.status === 303) {
              (opzioni.dopo?.[`p${passo}` as "p1"] ?? s.passi[`p${passo}` as "p1"])();
              if (opzioni.durante) {
                opzioni.durante();
                await new Promise((ok) => setTimeout(ok, 150));
              }
            }
          }
          if (opzioni.finali !== false && !sg.aborted) await invia("/verifiche-finali");
          await leggiPronto();
          if (opzioni.durataMassimaMs) await new Promise((ok) => setTimeout(ok, opzioni.durataMassimaMs! + 200));
          await new Promise((ok) => setTimeout(ok, 80));
          segnale = sg.aborted;
          return 0;
        },
      }),
    );
    return { codice: r.valore as number | null, righe: r.righe, errore: r.errore, stati, segnale, pronto };
  };
  const voci = (righe: string[]) => righe.filter((r) => /^\[\d+\] /.test(r));
  const conEsito = (righe: string[], n: number, esito: string) => voci(righe).filter((r) => r.startsWith(`[${n}] `) && r.endsWith(`→ ${esito}`));

  try {
    // ───── CN1–CN8: si ferma PRIMA di qualunque rete ─────
    const ferma = async (nome: string, argv: string[], env: Record<string, string>, opzioni: Record<string, unknown>, cerca?: RegExp) => {
      const s = stagingFinto();
      const r = await cattura(() => cn.collaudo(argv, env, { cartella: progetto, fetchFn: s.fetchFinto, portaAccesso: 0, adesso: () => ADESSO, ...opzioni }));
      atteso(nome, r.errore !== "" && !r.errore.startsWith("errore inatteso") && s.chiamate.length === 0 && !VIETATI.test(r.errore) && (!cerca || cerca.test(r.errore)), r.errore || "non si è fermato");
    };
    await ferma("CN1. senza il lanciatore delle autorizzazioni si ferma prima di qualunque rete", [fileFuori, "3110"], envOk, {});
    await ferma("CN2. porta che nega l'esecuzione → fermo, nessuna rete", [fileFuori, "3110"], envOk, { controllaPorta: () => { throw new Error("autorizzazione inesistente"); } });
    await ferma("CN3. file delle variabili dentro il progetto → fermo", [fileDentro, "3110"], envOk, { controllaPorta: portaOk, avvia: async () => 0 });
    await ferma("CN4. variabili di produzione → fermo, i messaggi non riportano valori", [fileProd, "3110"], envOk, { controllaPorta: portaOk, avvia: async () => 0 }, /produzione/);
    await ferma("CN5. RADAR_NOTIFICHE_PREFERENZE non «attivo» → fermo", [fileSpento, "3110"], envOk, { controllaPorta: portaOk, avvia: async () => 0 }, /RADAR_NOTIFICHE_PREFERENZE/);
    await ferma("CN5. RADAR_NOTIFICHE_EMAIL acceso → fermo", [fileEmail, "3110"], envOk, { controllaPorta: portaOk, avvia: async () => 0 }, /RADAR_NOTIFICHE_EMAIL/);
    await ferma("CN5. RADAR_REGISTRO_EVIDENZA acceso → fermo", [fileEvidenza, "3110"], envOk, { controllaPorta: portaOk, avvia: async () => 0 }, /RADAR_REGISTRO_EVIDENZA/);
    await ferma("CN5. RADAR_UFFICIO_GARE spento → fermo (l'Ufficio Gare non entrerebbe)", [fileSenzaUfficio, "3110"], envOk, { controllaPorta: portaOk, avvia: async () => 0 }, /RADAR_UFFICIO_GARE/);
    await ferma("CN6. lanciatore dell'anteprima mancante → fermo", [fileFuori, "3110"], envOk, { controllaPorta: portaOk });
    await ferma("CN7. senza OSSERVA_RETE_FILE (sorveglianza della rete) → fermo", [fileFuori, "3110"], {}, { controllaPorta: portaOk, avvia: async () => 0 }, /OSSERVA_RETE_FILE/);
    await ferma("CN7. registro dell'osservatore dentro il progetto → fermo", [fileFuori, "3110"], { OSSERVA_RETE_FILE: path.join(progetto, "rete.log") }, { controllaPorta: portaOk, avvia: async () => 0 });

    // ───── CN8: preliminare ─────
    {
      const s = stagingFinto();
      let pagina = "";
      let stato = 0;
      const r = await cattura(() =>
        cn.collaudo(["--preliminare", "3110"], {}, {
          portaAccesso: 0,
          attendi: async ({ portaAccesso }: { portaAccesso: number }) => {
            const base = `http://localhost:${portaAccesso}`;
            pagina = await (await fetch(`${base}/pronto`)).text();
            const via = /name="via" value="([^"]+)"/.exec(pagina)?.[1] ?? "";
            stato = (await fetch(`${base}/accesso/titolare-benchmark`, { method: "POST", redirect: "manual", headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: base }, body: new URLSearchParams({ via }).toString() })).status;
          },
        }),
      );
      const pulsanti = [...pagina.matchAll(/<button type="submit"([^>]*)>([^<]*)</g)];
      atteso(
        "CN8. preliminare: /pronto del grado 3 con 3 pulsanti nell'ordine 1 → 2 → 3, tutti bloccati, verifiche finali dopo il passo 3; un clic vero → 409; nessuna rete, nessun id",
        r.valore === 0 && stato === 409 && pulsanti.length === 4 && pulsanti.every((p) => p[1].includes("disabled")) && /Passo 1 · Entra come titolare-benchmark[\s\S]*Passo 2 · Entra come ti-titolare[\s\S]*Passo 3 · Entra come ufficio-benchmark/.test(pagina) && pagina.includes("Verifiche finali (dopo il passo 3)") && pagina.includes("Collaudo B4 grado 3 (Notifiche)") && pagina.includes("compare dopo il clic del passo 1") && s.chiamate.length === 0 && !VIETATI.test(pagina),
        `${r.errore} stato ${stato} pulsanti ${pulsanti.length}`,
      );
    }

    // ───── CN9: finestra completa, tutto in regola ─────
    {
      const s = stagingFinto();
      const e = await finestra(s);
      const fermi = voci(e.righe).filter((v) => /→ (VIOLAZIONE|ERRORE)$/.test(v));
      atteso("CN9. finestra completa nell'ordine 1 → 2 → 3 e verifiche finali: 303, 303, 303, 200; uscita 0; nessuna voce da fermo", e.codice === 0 && JSON.stringify(e.stati) === "[303,303,303,200]" && fermi.length === 0 && !e.segnale, `${e.codice} ${JSON.stringify(e.stati)} ${fermi.slice(0, 2).join(" | ")} ${e.errore}`);
      const resoconto = e.righe.filter((r) => /^ {2}\d+\. /.test(r));
      atteso(
        "CN9. resoconto dei 12 controlli: lato server ok per 1, 3, 4, 5, 6, 7, 8, 9 e 10; 2, 11 e 12 «nessuna verifica lato server» con i passi del browser",
        resoconto.length === 12 && [1, 3, 4, 5, 6, 7, 8, 9, 10].every((n) => resoconto[n - 1].includes("lato server ok")) && [2, 11, 12].every((n) => resoconto[n - 1].includes("nessuna verifica lato server") && resoconto[n - 1].includes("nel browser")),
        resoconto.filter((r) => !r.includes("lato server ok")).join(" | "),
      );
      atteso("CN9. nessuna chiamata allo staging prima del primo clic (la prima è la lettura degli utenti di prova al clic del passo 1), con la chiave di servizio solo letture (e il collegamento di ciascun utente)", s.chiamate.filter((c) => c.metodo !== "GET" && c.auth === `Bearer ${SEGRETA}` && !c.url.endsWith("/auth/v1/admin/generate_link")).length === 0 && s.chiamate.filter((c) => c.url.endsWith("/auth/v1/admin/generate_link")).length === 3 && (s.chiamate[0]?.url ?? "").startsWith(`${STAGING}/rest/v1/users?select=id&email=eq.`), s.chiamate[0]?.url.split("?")[0] ?? "nessuna");
      const tentativi = s.chiamate.filter((c) => c.metodo !== "GET" && !c.url.includes("/auth/v1/"));
      atteso(
        "CN9. 5 tentativi di scrittura sulla 0124 + la funzione dei destinatari per 2 altre imprese, per ciascuno dei 3 utenti, tutti col token (mai la chiave di servizio)",
        tentativi.length === 3 * (5 + 2) && tentativi.every((c) => c.auth !== `Bearer ${SEGRETA}` && c.auth.startsWith("Bearer ACCESSO_SINTETICO")) && tentativi.filter((c) => c.url.includes("/rpc/radar_notifiche_destinatari")).length === 6,
        `${tentativi.length}`,
      );
      atteso("CN9. l'id della persona dell'impresa 3 compare in /pronto solo dopo il passo 1 (mai nell'uscita)", !e.pronto[0].includes(ID.t3) && e.pronto.slice(1).some((p) => p.includes(ID.t3)) && !e.righe.some((r) => r.includes(ID.t3)));
      atteso("CN9. le voci di isolamento coprono la 0124 e le 11 tabelle dei gradi 1–2 per le altre imprese", conEsito(e.righe, 7, "ok").some((v) => v.includes(`${IMPRESA}`) && v.startsWith("[7] ti-titolare → impresa di titolare-benchmark")) && voci(e.righe).filter((v) => v.startsWith("[7] ufficio-benchmark → impresa di ti-titolare, ")).length === 13);
      atteso("CN9. l'Ufficio Gare vede la riga dell'impresa e la propria, NON quella del titolare", conEsito(e.righe, 5, "ok").some((v) => v.includes("riga dell'interruttore dell'impresa 3")) && conEsito(e.righe, 6, "ok").some((v) => v.includes("riga delle preferenze del titolare dell'impresa 3: viste 0")));
      atteso("CN9. verifiche finali: interruttori dei titolari, preferenze come attese, nessuna riga fuori elenco, 0 altrove, 0125 assente, la riga VECCHIA verso Resend nel registro (prima della finestra) non conta né per la sorveglianza né alla fine", conEsito(e.righe, 9, "ok").length >= 12 && conEsito(e.righe, 10, "ok").length === 4 && conEsito(e.righe, 3, "ok").length === 1 && conEsito(e.righe, 4, "ok").length === 2);
    }
  } finally {
    console.log = logOriginale;
  }

  // NB: il registro di prova contiene una riga VECCHIA verso Resend (prima della finestra): la sorveglianza la ignora (parte dalla fine del
  // file), le verifiche finali la vedono. Le prove successive usano un registro pulito, che è il caso della finestra vera (file nuovo).
  const registroPulito = scrivi("rete-pulito.log", "");
  envOk.OSSERVA_RETE_FILE = registroPulito;
  try {
    // ───── CN10: tutto in regola con il registro pulito ─────
    {
      const s = stagingFinto();
      const e = await finestra(s);
      const fermi = voci(e.righe).filter((v) => /→ (VIOLAZIONE|ERRORE|NON RIUSCITO[^→]*)$/.test(v));
      atteso("CN10. con il registro dell'osservatore pulito (file nuovo, come nella finestra vera): nessuna voce da fermo né NON RIUSCITO, uscita 0", e.codice === 0 && fermi.length === 0, fermi.slice(0, 3).join(" | "));
      atteso("CN10. nell'uscita nessun token, chiave, cookie o id completo", !e.righe.some((r) => VIETATI.test(r)) && richiesteEsterne.length === 0, e.righe.find((r) => VIETATI.test(r)) ?? richiesteEsterne.join(","));
    }

    // ───── CN11: ordine e prerequisiti (409, nessun collegamento) ─────
    {
      const s = stagingFinto();
      const e = await finestra(s, { ordine: ["2"], finali: false });
      atteso("CN11. il passo 2 prima del passo 1 → 409, nessun collegamento generato", JSON.stringify(e.stati) === "[409]" && !s.chiamate.some((c) => c.url.includes("generate_link")));
    }
    const prerequisito = async (nome: string, guasto: (s: ReturnType<typeof stagingFinto>) => void, ordine: string[], attesi: string) => {
      const s = stagingFinto();
      guasto(s);
      const e = await finestra(s, { ordine, finali: false });
      const collegamenti = s.chiamate.filter((c) => c.url.includes("generate_link")).length;
      atteso(nome, JSON.stringify(e.stati) === attesi && collegamenti === attesi.split("303").length - 1 && e.codice === 0, `${JSON.stringify(e.stati)} collegamenti ${collegamenti}`);
    };
    await prerequisito("CN11. 0124 non applicata → 409 al passo 1, nessun collegamento", (s) => (s.guasti.senza0124 = true), ["1"], "[409]");
    await prerequisito("CN11. 0125 presente → 409 al passo 1 (perimetro diverso dal piano)", (s) => (s.guasti.con0125 = true), ["1"], "[409]");
    await prerequisito("CN11. impresa 3 con due Ufficio Gare attivi → 409 al passo 1 (tetto delle righe iniziali)", (s) => s.dati.omnia_ai_membri.push({ membro_id: ID.estraneo, titolare_id: ID.t3, attivo: true }), ["1"], "[409]");
    await prerequisito("CN11. impresa 1 con un Ufficio Gare attivo → 409 al passo 2", (s) => s.dati.omnia_ai_membri.push({ membro_id: ID.estraneo, titolare_id: ID.t1, attivo: true }), ["1", "2"], "[303,409]");
    await prerequisito("CN11. Radar dell'impresa 1 non abilitato → 409 al passo 2", (s) => ((s.dati.omnia_ai_radar_impostazioni[0] as Riga).attivo = false), ["1", "2"], "[303,409]");
    {
      const s = stagingFinto();
      const e = await finestra(s, { ordine: ["1", "2"], finali: false, dopo: { p1: () => {} } });
      atteso("CN11. avvisi dell'impresa 3 non accesi al passo 1 → 409 al passo 2 (e il pulsante resta da usare)", JSON.stringify(e.stati) === "[303,409]" && s.chiamate.filter((c) => c.url.includes("generate_link")).length === 1);
    }
    {
      const s = stagingFinto();
      s.dati.omnia_ai_membri[0].attivo = false;
      const e = await finestra(s, { ordine: ["1"], finali: false });
      atteso("CN11. Ufficio Gare sospeso → 409 già al passo 1 (l'impresa 3 deve avere il suo Ufficio Gare attivo)", JSON.stringify(e.stati) === "[409]");
    }

    // ───── CN12–CN16: violazioni ed errori lato server → FERMO (423, nessun cookie, app spenta, uscita 3) ─────
    const fermoAtteso = async (nome: string, guasto: (s: ReturnType<typeof stagingFinto>) => void, statiAttesi: string, controllo: number, cerca: RegExp, opzioni: Parameters<typeof finestra>[1] = {}) => {
      const s = stagingFinto();
      guasto(s);
      const e = await finestra(s, opzioni);
      const voce = voci(e.righe).find((v) => v.startsWith(`[${controllo}] `) && /→ (VIOLAZIONE|ERRORE)$/.test(v) && cerca.test(v));
      atteso(nome, e.codice === 3 && JSON.stringify(e.stati) === statiAttesi && e.segnale && !!voce && e.pronto[e.pronto.length - 1].includes("COLLAUDO FERMATO"), `${e.codice} ${JSON.stringify(e.stati)} segnale ${e.segnale} ${voci(e.righe).filter((v) => /VIOLAZIONE|ERRORE/.test(v)).slice(0, 2).join(" | ")}`);
    };
    await fermoAtteso("CN12. 0124 non vuota all'apertura → ERRORE al passo 1, 423", (s) => s.dati[IMPRESA].push({ impresa_id: ID.t2, email_attive: false, creato_il: VECCHIA, aggiornato_il: VECCHIA }), "[423]", 9, /all'apertura/);
    await fermoAtteso("CN13. scrittura sulla 0124 ammessa al token → VIOLAZIONE al passo 1", (s) => (s.guasti.scritturaAmmessa = true), "[423]", 8, /tentativo a/);
    await fermoAtteso("CN13. risposta 500 su una tabella della 0124 letta col token: ERRORE (mai «accesso negato»), fermo al passo 1", (s) => s.guasti.erroreSessione.set(IMPRESA, 500), "[423]", 7, /omnia_ai_radar_notifiche_impresa: viste errore 500/);
    await fermoAtteso("CN13. l'Ufficio Gare non legge la riga dell'impresa (regola chiusa): il positivo dà ERRORE, fermo al passo 3", (s) => s.guasti.rlsChiusa.add(IMPRESA), "[303,303,423]", 5, /riga dell'interruttore dell'impresa 3 letta con la sua sessione/);
    await fermoAtteso("CN13. funzione dei destinatari aperta al token → VIOLAZIONE al passo 1", (s) => (s.guasti.funzioneAperta = true), "[423]", 8, /funzione dei destinatari/);
    await fermoAtteso("CN14. regola della 0124 aperta: il titolare 1 vede le righe dell'impresa 3 → VIOLAZIONE al passo 2", (s) => s.guasti.rlsAperta.add(IMPRESA), "[303,423]", 7, /ti-titolare → impresa di titolare-benchmark, omnia_ai_radar_notifiche_impresa/);
    await fermoAtteso("CN14. regola delle persone aperta: il titolare 1 vede le righe dell'impresa 3 → VIOLAZIONE al passo 2", (s) => s.guasti.rlsAperta.add(PERSONE), "[303,423]", 7, /omnia_ai_radar_notifiche_persone/);
    await fermoAtteso("CN14. regola delle persone aperta a tutta l'impresa: l'Ufficio Gare vede la riga del titolare → VIOLAZIONE al passo 3", (s) => (s.guasti.personeTuttaImpresa = true), "[303,303,423]", 6, /riga delle preferenze del titolare dell'impresa 3: viste 1/);

    // verifiche finali con le scritture sbagliate
    const finale = async (nome: string, guasto: (s: ReturnType<typeof stagingFinto>) => void, controllo: number, cerca: RegExp) => {
      const s = stagingFinto();
      const e = await finestra(s, { dopo: { p3: () => { s.passi.p3(); guasto(s); } } });
      const voce = voci(e.righe).find((v) => v.startsWith(`[${controllo}] `) && v.endsWith("→ VIOLAZIONE") && cerca.test(v));
      atteso(nome, e.codice === 3 && JSON.stringify(e.stati) === "[303,303,303,423]" && !!voce, `${e.codice} ${JSON.stringify(e.stati)} ${voci(e.righe).filter((v) => /VIOLAZIONE|ERRORE/.test(v)).slice(0, 2).join(" | ")}`);
    };
    const riga = (s: ReturnType<typeof stagingFinto>, user: string) => s.dati[PERSONE].find((x) => x.user_id === user) as Riga;
    await finale("CN15. l'Ufficio Gare ha riacceso «nuove opportunità» → VIOLAZIONE", (s) => Object.assign(riga(s, ID.uff), { nuove_opportunita: true }), 6, /Ufficio Gare/);
    await finale("CN15. interruttore dell'impresa 3 cambiato dall'Ufficio Gare → VIOLAZIONE", (s) => Object.assign(s.dati[IMPRESA][0], { aggiornato_da: ID.uff }), 5, /impresa di titolare-benchmark/);
    await finale("CN15. preferenze dell'impresa 3 scritte dal titolare 1 → VIOLAZIONE", (s) => Object.assign(riga(s, ID.t3), { aggiornato_da: ID.t1 }), 7, /scritte dal titolare dell'impresa 1|titolare dell'impresa di titolare-benchmark/);
    await finale("CN15. riga delle persone di un utente non di prova → VIOLAZIONE (fuori elenco)", (s) => s.dati[PERSONE].push({ impresa_id: ID.t3, user_id: ID.estraneo, nuove_opportunita: false, scadenze: true, rettifiche: true, aggiornato_da: ID.t3, creato_il: NUOVA, aggiornato_il: NUOVA }), 9, /fuori elenco 1/);
    await finale("CN15. interruttore di un'impresa non di prova → VIOLAZIONE", (s) => s.dati[IMPRESA].push({ impresa_id: ID.estraneo, email_attive: true, aggiornato_da: ID.estraneo, creato_il: NUOVA, aggiornato_il: NUOVA }), 9, /di imprese fuori elenco 1/);
    await finale("CN15. un utilizzo registrato nella finestra (visita a «Per te» o Cerca) → VIOLAZIONE", (s) => s.dati.omnia_ai_radar_utilizzi.push({ id: "u9", user_id: ID.t3, creato_il: NUOVA }), 9, /omnia_ai_radar_utilizzi/);
    await finale("CN15. un salvataggio nella finestra → VIOLAZIONE", (s) => s.dati.omnia_ai_radar_salvate.push({ id: "s9", user_id: ID.t1, creata_il: NUOVA, aggiornata_il: NUOVA }), 9, /omnia_ai_radar_salvate/);
    {
      // una richiesta esterna già nel registro alla partenza, DENTRO la finestra (ora successiva all'inizio): la sorveglianza parte dalla fine
      // del file e non la vede; le verifiche finali sì
      fs.writeFileSync(registroPulito, `${NUOVA} 4242 POST https://api.resend.com/emails\n`);
      const s = stagingFinto();
      const e = await finestra(s);
      const voce = voci(e.righe).find((v) => v.startsWith("[10] richieste del server fuori dallo staging"));
      atteso("CN15. richiesta verso Resend nel registro durante la finestra, sfuggita alla sorveglianza → VIOLAZIONE alle verifiche finali", e.codice === 3 && !!voce && voce.endsWith("→ VIOLAZIONE") && voce.includes("api.resend.com"), voce ?? `${e.codice}`);
      fs.writeFileSync(registroPulito, "");
    }
    await finale("CN15. la 0125 compare durante la finestra → VIOLAZIONE", (s) => {
      s.guasti.con0125 = true;
      s.dati.omnia_ai_radar_eventi = [{ id: "e1" }];
      s.dati.omnia_ai_radar_email_consegne = [];
      s.dati.radar_notifiche_giri = [];
    }, 10, /omnia_ai_radar_eventi/);
    {
      const s = stagingFinto();
      const e = await finestra(s, { dopo: { p3: () => Object.assign(riga(s, ID.uff), { aggiornato_il: NUOVA }) } });
      const voce = voci(e.righe).find((v) => v.startsWith("[6] preferenze dell'Ufficio Gare"));
      atteso("CN16. l'Ufficio Gare non ha spento nulla → NON RIUSCITO (passo mancato, nessun fermo), uscita 0", e.codice === 0 && !!voce && /→ NON RIUSCITO$/.test(voce), voce ?? "nessuna voce");
    }

    // ───── CN17: sorveglianza della rete ─────
    {
      const s = stagingFinto();
      const e = await finestra(s, { durante: () => fs.appendFileSync(registroPulito, `${NUOVA} 4242 POST https://api.resend.com/emails\n`) });
      atteso(
        "CN17. una richiesta del server verso Resend durante la finestra → FERMO entro un giro della sorveglianza: VIOLAZIONE [10], app spenta, /pronto «COLLAUDO FERMATO», nessun altro accesso, uscita 3",
        e.codice === 3 && e.segnale && voci(e.righe).some((v) => v.startsWith("[10] richiesta del server verso un host esterno: api.resend.com") && v.endsWith("VIOLAZIONE")) && JSON.stringify(e.stati) === "[303]" && e.pronto[e.pronto.length - 1].includes("COLLAUDO FERMATO"),
        `${e.codice} ${JSON.stringify(e.stati)} ${e.segnale}`,
      );
      fs.writeFileSync(registroPulito, "");
    }
    {
      const file = scrivi("rete-sorveglianza.log", `${VECCHIA} 1 GET https://api.resend.com/vecchia\n`);
      const visti: string[] = [];
      const sorv = cn.sorvegliaRete({ file, alFuori: (h: string) => visti.push(h), intervalloMs: 100_000 });
      fs.appendFileSync(file, `${NUOVA} 2 GET https://ryawdldqiumqsskrnyps.supabase.co/rest/v1/users\n${NUOVA} 2 GET http://localhost:3110/login\n${NUOVA} 2 GET https://ryawdldqiumqsskrnyps.supabase.co/auth/v1/user\n`);
      sorv.giro();
      const primo = visti.length;
      fs.appendFileSync(file, `${NUOVA} 2 GET https://fonts.googleapis.com/css\n${NUOVA} 2 POST https://api.resend.com/emails\n`);
      sorv.giro();
      fs.appendFileSync(file, `${NUOVA} 2 POST https://altro.esempio.test/x\n`);
      sorv.giro();
      sorv.ferma();
      atteso("CN17. sorveglianza: parte dalla fine del file (la riga vecchia non conta), staging e localhost ammessi, il primo host esterno scatta UNA volta", primo === 0 && JSON.stringify(visti) === JSON.stringify(["fonts.googleapis.com"]), JSON.stringify(visti));
    }

    // ───── CN18: tempo massimo ─────
    {
      const s = stagingFinto();
      const e = await finestra(s, { ordine: ["1"], finali: false, durataMassimaMs: 300 });
      atteso("CN18. finestra oltre il tempo massimo senza le verifiche finali → FERMO, uscita 3", e.codice === 3 && e.segnale && e.righe.some((r) => r.includes("COLLAUDO FERMATO") && r.includes("minuti")), `${e.codice} ${e.segnale}`);
    }
    {
      const s = stagingFinto();
      const e = await finestra(s, { durataMassimaMs: 300 });
      atteso("CN18. oltre il tempo massimo DOPO le verifiche finali → chiusura normale (app spenta, uscita 0)", e.codice === 0 && e.segnale && e.righe.some((r) => r.includes("dopo le verifiche finali: chiusura")), `${e.codice} ${e.segnale}`);
    }
  } finally {
    console.log = logOriginale;
  }

  // ───── CN19: misure del controllo 11 ─────
  {
    const registro = scrivi(
      "misure.log",
      [
        `2026-11-21T10:10:00.100Z 5 GET ${STAGING}/auth/v1/user`,
        `2026-11-21T10:10:00.200Z 5 GET ${STAGING}/rest/v1/${IMPRESA}`,
        `2026-11-21T10:10:00.300Z 5 GET ${STAGING}/rest/v1/${PERSONE}`,
        `2026-11-21T10:10:30.000Z 5 POST ${STAGING}/rest/v1/rpc/omnia_ai_presenza_segnale`,
        `2026-11-21T10:12:00.000Z 5 GET ${STAGING}/rest/v1/${PERSONE}`,
      ].join("\n"),
    );
    const finestre = scrivi("finestre.json", JSON.stringify({ escludiPid: [9], finestre: [{ nome: "Notifiche ferma", da: "2026-11-21T10:10:05.000Z", a: "2026-11-21T10:11:10.000Z", ferma: true }, { nome: "Notifiche ferma con rilettura", da: "2026-11-21T10:11:30.000Z", a: "2026-11-21T10:12:40.000Z", ferma: true }] }));
    const r = await cattura(() => cn.collaudo(["--misure", registro, finestre], {}, {}));
    atteso("CN19. --misure: 60 s fermi su «Notifiche» senza letture della 0124 → in regola; una rilettura della 0124 → NON RIUSCITO (le tabelle omnia_ai_radar_notifiche_* contano come Opportunità)", r.valore === 1 && r.righe[0].endsWith("→ ok") && r.righe[1].includes("NON RIUSCITO") && r.righe[1].includes("1 richieste di Opportunità"), r.righe.join(" | "));
  }

  // ───── CN20: nel browser (eseguite da sole, come nello strumento javascript del pannello) ─────
  {
    type El = Record<string, unknown>;
    const inviati: string[] = [];
    const casella = (name: string, checked: boolean, disabled: boolean) => ({ name, checked, disabled, closest: () => ({ disabled: false }) });
    const pagina = (o: { ufficio: boolean; avviso?: boolean; email?: string }) => {
      const mie: Record<string, El> = {
        nuove_opportunita: casella("nuove_opportunita", false, o.ufficio),
        scadenze: casella("scadenze", true, false),
        rettifiche: casella("rettifiche", !o.ufficio, false),
      };
      const persona = { value: o.ufficio ? ID.uff : ID.t1 };
      const modulo = {
        querySelector: (s: string) => (s === 'input[type="hidden"][name="persona"]' ? persona : (mie[/name="([^"]+)"/.exec(s)?.[1] ?? ""] ?? null)),
        requestSubmit: () => inviati.push(JSON.stringify({ persona: persona.value, ...Object.fromEntries(Object.entries(mie).map(([k, v]) => [k, v.checked])) })),
      };
      const sezioneMie = { querySelector: (s: string) => (s === "form" ? modulo : s === 'button[type="submit"]' ? {} : modulo.querySelector(s)), textContent: "Le mie preferenze" };
      const sezioneImpresa = { textContent: `Oggi gli avvisi email dell'impresa sono accesi${o.ufficio ? " dal titolare dell'impresa." : "."}`, querySelector: (s: string) => (s === 'button[type="submit"]' && !o.ufficio ? {} : null) };
      const contenuto = {
        textContent: `${o.avviso === false ? "" : "Gli avvisi email non sono ancora attivi: le scelte si salvano."} Lo stato degli indirizzi non è ancora disponibile. ${o.email ?? ""}`,
        querySelectorAll: () => [],
      };
      return {
        location: { pathname: "/dashboard/omnia-ai/opportunita/notifiche" },
        body: contenuto,
        querySelector: (s: string) =>
          ({
            ".omnia-app-shell": contenuto,
            'section[aria-labelledby="notifiche-impresa"]': sezioneImpresa,
            'section[aria-labelledby="notifiche-mie"]': sezioneMie,
            'section[aria-labelledby="notifiche-mie"] form': modulo,
            'section[aria-labelledby="notifiche-destinatari"]': o.ufficio ? null : {},
          })[s] ?? null,
      };
    };
    const daSola = <F,>(f: F) => new Function(`return (${String(f)})`)() as F;
    const lettura = daSola(cn.letturaNotifiche) as (d: unknown) => Record<string, unknown>;
    const azione = daSola(cn.provaAzioneDirettaPersona) as (d: unknown, p: string) => { esito: string };
    const riaccendi = daSola(cn.provaRiaccensione) as (d: unknown, c: string) => { esito: string };
    const titolare = lettura(pagina({ ufficio: false }));
    const ufficio = lettura(pagina({ ufficio: true }));
    atteso(
      "CN20. letturaNotifiche (da sola): avviso, interruttore modificabile solo dal titolare, caselle dell'Ufficio Gare (spenta = bloccata), destinatari solo al titolare, nessun indirizzo",
      titolare.avviso === true && JSON.stringify(titolare.interruttore) === '{"acceso":true,"modificabile":true}' && JSON.stringify(ufficio.interruttore) === '{"acceso":true,"modificabile":false}' && JSON.stringify(ufficio.categorie) === JSON.stringify({ nuove_opportunita: { accesa: false, bloccata: true }, scadenze: { accesa: true, bloccata: false }, rettifiche: { accesa: false, bloccata: false } }) && titolare.destinatari === true && ufficio.destinatari === false && ufficio.statoIndirizziNonDisponibile === true && titolare.indirizziEmail === 0,
      JSON.stringify([titolare, ufficio]),
    );
    atteso("CN20. letturaNotifiche: avviso mancante e un indirizzo nella pagina si vedono", lettura(pagina({ ufficio: false, avviso: false, email: "qualcuno@impresa.it" })).avviso === false && lettura(pagina({ ufficio: false, email: "qualcuno@impresa.it" })).indirizziEmail === 1);
    inviati.length = 0;
    const a1 = azione(pagina({ ufficio: false }), ID.t3);
    const a2 = azione(pagina({ ufficio: false }), "non-un-id");
    const a3 = azione(pagina({ ufficio: false }), ID.t1);
    atteso("CN20. provaAzioneDirettaPersona (da sola): cambia SOLO la persona del proprio modulo e lo invia; id non valido o propria persona: niente inviato", inviati.length === 1 && JSON.parse(inviati[0]).persona === ID.t3 && JSON.parse(inviati[0]).scadenze === true && /inviato/.test(a1.esito) && /niente inviato/.test(a2.esito) && /niente inviato/.test(a3.esito), JSON.stringify([inviati, a1, a2, a3]));
    inviati.length = 0;
    const r1 = riaccendi(pagina({ ufficio: true }), "nuove_opportunita");
    const r2 = riaccendi(pagina({ ufficio: true }), "scadenze");
    const r3 = riaccendi(pagina({ ufficio: false }), "nuove_opportunita");
    const r4 = riaccendi(pagina({ ufficio: true }), "tutto");
    atteso("CN20. provaRiaccensione (da sola): solo una casella SPENTA e BLOCCATA dell'Ufficio Gare, poi invio; negli altri casi niente inviato", inviati.length === 1 && JSON.parse(inviati[0]).nuove_opportunita === true && JSON.parse(inviati[0]).persona === ID.uff && /inviato/.test(r1.esito) && [r2, r3, r4].every((r) => /niente inviato/.test(r.esito)), JSON.stringify([inviati, r1, r2, r3, r4]));
  }

  // ───── CN21: sorgente ─────
  {
    const codice = fs.readFileSync(path.join(RADICE, "scripts/collaudo-notifiche-b4.mjs"), "utf8");
    const t = cn.tentativiNotifiche(ID.t1, ID.t1) as { lettera: string; metodo: string; url: string; corpo: Record<string, unknown> | null }[];
    atteso(
      "CN21. tentativi innocui per costruzione: PATCH con filtri impossibili (creato prima del 2000; persona tutto zeri), DELETE dell'impresa tutto zeri, POST che violano le chiavi esterne (impresa tutto zeri); solo le tabelle della 0124",
      t.length === 5 && t[0].url.includes("creato_il=lt.2000-01-01") && t[1].url.includes("user_id=eq.00000000-0000-0000-0000-000000000000") && t[2].metodo === "DELETE" && t[2].url.includes("impresa_id=eq.00000000-0000-0000-0000-000000000000") && t.slice(3).every((x) => x.metodo === "POST" && x.corpo?.impresa_id === "00000000-0000-0000-0000-000000000000") && t.every((x) => /omnia_ai_radar_notifiche_(impresa|persone)/.test(x.url)),
    );
    atteso("CN21. lo script non scrive file, ascolta solo «localhost», non manda email: nessun Resend, nessun invio", !/writeFileSync|appendFileSync|createWriteStream|resend\.com|nodemailer|sendEmail/i.test(codice.replace(/\/\/.*$/gm, "")));
    atteso("CN21. righe LF", !codice.includes("\r\n") && !fs.readFileSync(path.join(RADICE, "scripts/verifica-collaudo-notifiche-b4.ts"), "utf8").includes("\r\n"));
    atteso("CN21. in TUTTA l'uscita delle prove nessun token, chiave, cookie o id completo; nessuna richiesta verso l'esterno", !stampato.some((r) => VIETATI.test(r)) && richiesteEsterne.length === 0, stampato.find((r) => VIETATI.test(r)) ?? richiesteEsterne.join(","));
  }
  fs.rmSync(tmp, { recursive: true, force: true });
}

prove()
  .then(() => {
    console.log(fallimenti.length ? `\n${fallimenti.length} controlli FALLITI` : "\nTutti i controlli dello script di collaudo del grado 3 sono superati.");
    process.exit(fallimenti.length ? 1 : 0);
  })
  .catch((e) => {
    console.log(`FALLITO prove interrotte: ${e instanceof Error ? e.stack : String(e)}`);
    process.exit(1);
  });
