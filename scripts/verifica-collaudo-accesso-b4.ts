// Prove a secco dello script del collaudo con accesso della fase B4 (scripts/collaudo-accesso-b4.mjs), 19/11/2026. Uno STAGING FINTO in
// memoria con le regole di accesso vere delle tabelle (migrazioni 0001, 0084, 0092, 0111, 0112, 0122) e solo dati SINTETICI: nessun
// database, nessuna rete verso l'esterno (ammessi solo i server locali delle prove). Comprende la finestra completa nell'ordine del piano
// 28, le VIOLAZIONI simulate che devono fermare tutto, le verifiche finali, la lettura degli elenchi nel browser e le misure del controllo 10.
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";

const richiesteEsterne: string[] = [];
const fetchVero = globalThis.fetch;
globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
  const host = new URL(url instanceof Request ? url.url : String(url)).hostname;
  if (!["localhost", "127.0.0.1", "[::1]", "::1"].includes(host)) {
    richiesteEsterne.push(host);
    throw new Error(`verifica collaudo B4: richiesta di rete vietata verso ${host}`);
  }
  return fetchVero(url, init);
}) as typeof fetch;

const RADICE = path.resolve(__dirname, "..");
const fallimenti: string[] = [];
function atteso(nome: string, ok: boolean, dettaglio = "") {
  console.log(`${ok ? "ok    " : "FALLITO"} ${nome}${ok || !dettaglio ? "" : ` — ${dettaglio}`}`);
  if (!ok) fallimenti.push(nome);
}
const uguale = (nome: string, a: unknown, b: unknown) => atteso(nome, JSON.stringify(a) === JSON.stringify(b), `atteso ${JSON.stringify(b)}, ottenuto ${JSON.stringify(a)}`);

// ───── staging finto ─────
const STAGING = "https://ryawdldqiumqsskrnyps.supabase.co";
const SEGRETA = "sb_secret_SINTETICA_DA_NON_STAMPARE";
const PUBBLICA = "sb_publishable_SINTETICA";
const VECCHIA = "2026-11-18T16:40:00.000Z";
const ADESSO = Date.parse("2026-11-20T10:00:00.000Z");
const NUOVA = "2026-11-20T10:05:00.000Z";
const ID = { admin: "00000000-0000-4000-8000-0000000000a0", t1: "00000000-0000-4000-8000-000000000111", t2: "00000000-0000-4000-8000-000000000222", t3: "00000000-0000-4000-8000-000000000333", uff: "00000000-0000-4000-8000-000000000444" };
const EMAIL = { admin: "ti-admin@prova.test", t1: "ti-titolare@prova.test", t2: "ti-titolare2@prova.test", t3: "titolare-benchmark@prova.test", uff: "ufficio-benchmark@prova.test" };
const ID_DA_EMAIL = new Map(Object.entries(EMAIL).map(([k, e]): [string, string] => [e, ID[k as keyof typeof ID]]));
// Token d'accesso lunghi apposta: la libreria divide il cookie in due parti (.0 e .1), come con i token veri.
const ACCESSO = new Map(Object.values(EMAIL).map((e): [string, string] => [e, `ACCESSO_SINTETICO_${e.split("@")[0]}_${"x".repeat(3000)}`]));
const VIETATI = /TOKEN_SINTETICO|ACCESSO_SINTETICO|RINNOVO_SINTETICO|sb_secret_|sb_publishable_|token_hash|base64-|127\.0\.0\.1|0000000001|0000000002|0000000003|0000000004|00000000a0/;

type Riga = Record<string, unknown>;
type Chiamata = { metodo: string; url: string; auth: string; corpo: string };
const POLITICHE: Record<string, ((r: Riga, uid: string, eff: string) => boolean) | "negato"> = {
  users: (r, uid) => r.id === uid,
  omnia_ai_membri: (r, uid) => r.membro_id === uid || r.titolare_id === uid,
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

function filtra(valore: unknown, espressione: string): boolean {
  const i = espressione.indexOf(".");
  const op = espressione.slice(0, i);
  const x = espressione.slice(i + 1);
  if (op === "eq") return String(valore) === x;
  if (op === "gte") return valore !== null && valore !== undefined && Date.parse(String(valore)) >= Date.parse(x);
  if (op === "like") return x.endsWith("*") && String(valore ?? "").startsWith(x.slice(0, -1));
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
    ],
    omnia_ai_radar_profili: [],
    omnia_ai_radar_salvate: [
      { id: "s1", user_id: ID.t1, monitorata: true, salvata_da: ID.t1, aggiunta_id: null, creata_il: VECCHIA, aggiornata_il: VECCHIA, ultimo_aggiornamento_visto_il: VECCHIA },
      { id: "s2", user_id: ID.t1, monitorata: false, salvata_da: ID.t1, aggiunta_id: null, creata_il: VECCHIA, aggiornata_il: VECCHIA, ultimo_aggiornamento_visto_il: null },
    ],
    omnia_ai_radar_gare_aggiunte: [{ id: "a1", user_id: ID.t1, oggetto: "Gara aggiunta sintetica della B3", url: "https://esempio.invalid/b3", cig: null, creata_da: ID.t1, creata_il: VECCHIA }],
    omnia_ai_radar_utilizzi: [{ id: "u1", user_id: ID.t1, membro_id: null, azione: "ricerca", creato_il: VECCHIA }],
    omnia_ai_notifiche: [],
    gare: [{ id: "g1", user_id: ID.t1 }, { id: "g3", user_id: ID.t3 }],
    subscriptions: [{ id: "sub1", user_id: ID.t1 }, { id: "sub3", user_id: ID.t3 }],
    omnia_ai_gare_gratuite: [{ user_id: ID.t2, assegnate: 1, usate: 0, aggiornato_il: VECCHIA }],
    omnia_ai_gare_gratuite_log: [{ id: "l1", user_id: ID.t2, created_at: VECCHIA }],
    radar_console_registro: [{ id: "r1", creato_il: VECCHIA }],
  };
  const guasti = { rlsAperta: new Set<string>(), rlsChiusa: new Set<string>(), scritturaAmmessa: false, erroreSessione: new Map<string, number>(), identitaAltrui: false };
  const chiamate: Chiamata[] = [];
  const hashAEmail = new Map<string, string>();
  let progressivo = 0;
  const json = { "Content-Type": "application/json" };
  const emailDaAuth = (auth: string) => [...ACCESSO].find(([, t]) => `Bearer ${t}` === auth)?.[0] ?? null;
  const effettivo = (uid: string) => (dati.omnia_ai_membri.find((m) => m.membro_id === uid && m.attivo)?.titolare_id as string | undefined) ?? uid;
  const fetchFinto = (async (url: string, init?: RequestInit) => {
    const u = new URL(String(url));
    const metodo = init?.method ?? "GET";
    const h = (init?.headers ?? {}) as Record<string, string>;
    const auth = String(h.Authorization ?? "");
    const corpo = String(init?.body ?? "");
    chiamate.push({ metodo, url: String(url), auth, corpo });
    if (u.origin !== STAGING) return new Response("{}", { status: 404, headers: json });
    if (u.pathname === "/auth/v1/admin/generate_link") {
      const email = JSON.parse(corpo).email as string;
      const hash = `TOKEN_SINTETICO_${++progressivo}`;
      hashAEmail.set(hash, email);
      return new Response(JSON.stringify({ hashed_token: hash }), { status: 200, headers: json });
    }
    if (u.pathname === "/auth/v1/verify") {
      const email = hashAEmail.get(JSON.parse(corpo).token_hash);
      if (!email) return new Response(JSON.stringify({ code: 403, error_code: "otp_expired" }), { status: 403, headers: json });
      const diSessione = guasti.identitaAltrui ? EMAIL.t1 : email;
      const utente = { id: ID_DA_EMAIL.get(diSessione), aud: "authenticated", role: "authenticated", email: diSessione, app_metadata: {}, user_metadata: {} };
      return new Response(JSON.stringify({ access_token: ACCESSO.get(diSessione), token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: "RINNOVO_SINTETICO", user: utente }), { status: 200, headers: json });
    }
    if (u.pathname === "/auth/v1/user") {
      const email = emailDaAuth(auth);
      return email ? new Response(JSON.stringify({ id: ID_DA_EMAIL.get(email), email }), { status: 200, headers: json }) : new Response("{}", { status: 401, headers: json });
    }
    if (!u.pathname.startsWith("/rest/v1/")) return new Response("{}", { status: 404, headers: json });
    const tabella = u.pathname.slice("/rest/v1/".length);
    const servizio = auth === `Bearer ${SEGRETA}`;
    if (metodo !== "GET") {
      if (servizio) return new Response(JSON.stringify({ message: "scrittura di servizio inattesa" }), { status: 500, headers: json });
      if (!emailDaAuth(auth)) return new Response("{}", { status: 401, headers: json });
      if (guasti.scritturaAmmessa) return new Response(null, { status: 204 });
      return new Response(JSON.stringify({ code: "42501", message: "permission denied" }), { status: 403, headers: json });
    }
    let righe = dati[tabella];
    if (!righe) return new Response("{}", { status: 404, headers: json });
    if (!servizio) {
      const email = emailDaAuth(auth);
      if (!email) return new Response("{}", { status: 401, headers: json });
      const forzato = guasti.erroreSessione.get(tabella);
      if (forzato) return new Response("{}", { status: forzato, headers: json });
      const uid = ID_DA_EMAIL.get(email) as string;
      const politica = POLITICHE[tabella];
      if (politica === "negato") return new Response(JSON.stringify({ code: "42501" }), { status: 403, headers: json });
      if (guasti.rlsChiusa.has(tabella)) righe = [];
      else if (!guasti.rlsAperta.has(tabella)) righe = righe.filter((r) => politica(r, uid, effettivo(uid)));
    }
    for (const [k, v] of u.searchParams) if (k !== "select" && k !== "limit") righe = righe.filter((r) => filtra(r[k], v));
    if (h.Prefer === "count=exact") return new Response("[]", { status: 200, headers: { ...json, "Content-Range": righe.length ? `0-0/${righe.length}` : "*/0" } });
    const colonne = (u.searchParams.get("select") ?? "").split(",");
    return new Response(JSON.stringify(righe.map((r) => Object.fromEntries(colonne.map((c) => [c, r[c] ?? null])))), { status: 200, headers: json });
  }) as unknown as typeof fetch;
  // i passi del browser, simulati sui dati
  const passi = {
    d3() {
      dati.omnia_ai_radar_impostazioni.push({ user_id: ID.t3, attivo: true, aggiornata_il: NUOVA });
      dati.radar_console_registro.push({ id: "r2", creato_il: NUOVA });
    },
    p1() {
      dati.omnia_ai_radar_profili.push({ id: "p3", user_id: ID.t3, aggiornato_da: ID.t3, settori: ["pulizia", "ristorazione"], aggiornato_il: NUOVA });
    },
    p2() {
      dati.omnia_ai_radar_profili.push({ id: "p1", user_id: ID.t1, aggiornato_da: ID.t1, settori: ["pulizia"], aggiornato_il: NUOVA });
      dati.omnia_ai_radar_salvate.push(
        { id: "s3", user_id: ID.t1, monitorata: false, salvata_da: ID.t1, aggiunta_id: null, creata_il: NUOVA, aggiornata_il: NUOVA, ultimo_aggiornamento_visto_il: null },
        { id: "s4", user_id: ID.t1, monitorata: true, salvata_da: ID.t1, aggiunta_id: null, creata_il: NUOVA, aggiornata_il: NUOVA, ultimo_aggiornamento_visto_il: NUOVA },
      );
      dati.omnia_ai_radar_utilizzi.push({ id: "u2", user_id: ID.t1, membro_id: null, azione: "per_te", creato_il: NUOVA });
    },
    p3() {
      dati.omnia_ai_radar_salvate.push({ id: "s5", user_id: ID.t3, monitorata: true, salvata_da: ID.uff, aggiunta_id: null, creata_il: NUOVA, aggiornata_il: NUOVA, ultimo_aggiornamento_visto_il: NUOVA });
      dati.omnia_ai_radar_gare_aggiunte.push({ id: "a3", user_id: ID.t3, oggetto: "COLLAUDO B4 — gara sintetica dell'Ufficio Gare", url: "https://esempio.invalid/collaudo-b4", cig: null, creata_da: ID.uff, creata_il: NUOVA });
      dati.omnia_ai_radar_salvate.push({ id: "s6", user_id: ID.t3, monitorata: true, salvata_da: ID.uff, aggiunta_id: "a3", creata_il: NUOVA, aggiornata_il: NUOVA, ultimo_aggiornamento_visto_il: NUOVA });
      dati.omnia_ai_radar_utilizzi.push({ id: "u3", user_id: ID.t3, membro_id: ID.uff, azione: "per_te", creato_il: NUOVA });
    },
    p4() {
      dati.omnia_ai_radar_utilizzi.push({ id: "u4", user_id: ID.t2, membro_id: null, azione: "ricerca", creato_il: NUOVA });
    },
  };
  return { dati, guasti, chiamate, fetchFinto, passi };
}

const voci = (righe: string[]) => righe.filter((r) => /^\[\d+\] /.test(r));

async function prove() {
  const ca = await import("./collaudo-accesso-b4.mjs");
  const { createServerClient } = await import("@supabase/ssr");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "b4-collaudo-"));
  const progetto = path.join(tmp, "progetto");
  fs.mkdirSync(path.join(progetto, "scripts"), { recursive: true });
  const variabiliValide = [
    `NEXT_PUBLIC_SUPABASE_URL=${STAGING}`,
    `NEXT_PUBLIC_SUPABASE_ANON_KEY=${PUBBLICA}`,
    `SUPABASE_SERVICE_ROLE_KEY=${SEGRETA}`,
    "RADAR_PER_TE=attivo",
    "RADAR_UFFICIO_GARE=attivo",
    "RADAR_CLASSIFICAZIONI=attive",
    "RADAR_NOTIFICHE_PREFERENZE=",
    "RADAR_NOTIFICHE_EMAIL=",
  ].join("\n");
  const scrivi = (nome: string, testo: string, cartella = tmp) => {
    const f = path.join(cartella, nome);
    fs.writeFileSync(f, testo);
    return f;
  };
  const fileFuori = scrivi("variabili.txt", variabiliValide);
  const fileDentro = scrivi("variabili.txt", variabiliValide, progetto);
  const fileProd = scrivi("variabili-prod.txt", variabiliValide.replace("ryawdldqiumqsskrnyps", "bihfrzspqxsrzlbqqvqa"));
  const fileInterruttori = scrivi("variabili-interruttori.txt", variabiliValide.replace("RADAR_PER_TE=attivo", "RADAR_PER_TE=1").replace("RADAR_NOTIFICHE_EMAIL=", "RADAR_NOTIFICHE_EMAIL=attivo"));
  const COOKIE: string = ca.COOKIE_SESSIONE;
  const portaOk = () => ({ id: "AUT-SINTETICA", uso: "U1" });
  const variabiliLettore = { SUPABASE_SERVICE_ROLE_KEY: SEGRETA, NEXT_PUBLIC_SUPABASE_ANON_KEY: PUBBLICA };
  const inizio = new Date(ADESSO - ca.MARGINE_INIZIO_MS).toISOString();
  const stampato: string[] = [];
  const logOriginale = console.log;
  const cattura = async <T,>(fn: () => Promise<T>): Promise<{ valore: T | null; righe: string[]; errore: string }> => {
    const righe: string[] = [];
    console.log = (...a: unknown[]) => {
      const r = a.map(String).join(" ");
      righe.push(r);
      stampato.push(r);
    };
    try {
      return { valore: await fn(), righe, errore: "" };
    } catch (e) {
      return { valore: null, righe, errore: e instanceof ca.Fermo ? e.message : `errore inatteso: ${e}` };
    } finally {
      console.log = logOriginale;
    }
  };
  const conHost = (porta: number, percorso: string, host: string) =>
    new Promise<number>((risolvi, rifiuta) => {
      const r = http.request({ host: "localhost", port: porta, path: percorso, method: "GET", headers: { Host: host } }, (res) => {
        res.resume();
        risolvi(res.statusCode ?? 0);
      });
      r.on("error", rifiuta);
      r.end();
    });
  const chiuso = async (porta: number) => {
    try {
      await fetch(`http://localhost:${porta}/pronto`, { signal: AbortSignal.timeout(2000) });
      return false;
    } catch {
      return true;
    }
  };

  try {
    // ───── CB1–CB6: si ferma PRIMA di qualunque rete ─────
    const ferma = async (nome: string, argv: string[], opzioni: Record<string, unknown>, cerca?: RegExp) => {
      const s = stagingFinto();
      const r = await cattura(() => ca.collaudo(argv, {}, { cartella: progetto, fetchFn: s.fetchFinto, portaAccesso: 0, adesso: () => ADESSO, ...opzioni }));
      atteso(nome, r.errore !== "" && !r.errore.startsWith("errore inatteso") && s.chiamate.length === 0 && !VIETATI.test(r.errore) && !/bihfrzspqxsrzlbqqvqa\.supabase/.test(r.errore) && (!cerca || cerca.test(r.errore)), r.errore || "non si è fermato");
    };
    await ferma("CB1. senza il lanciatore delle autorizzazioni (TI_REGISTRO assente) si ferma prima di qualunque rete", [fileFuori, "3110"], {});
    await ferma("CB2. porta che nega l'esecuzione → fermo, nessuna rete", [fileFuori, "3110"], { controllaPorta: () => { throw new Error("autorizzazione inesistente"); } });
    await ferma("CB3. file delle variabili dentro il progetto → fermo", [fileDentro, "3110"], { controllaPorta: portaOk, avvia: async () => 0 });
    await ferma("CB4. variabili di produzione → fermo, i messaggi non riportano valori", [fileProd, "3110"], { controllaPorta: portaOk, avvia: async () => 0 });
    await ferma("CB5. lanciatore dell'anteprima mancante → fermo prima di avviare qualunque server", [fileFuori, "3110"], { controllaPorta: portaOk });
    await ferma("CB6. interruttori della B4 sbagliati (Per te non «attivo», email delle notifiche accesa) → fermo, solo i nomi", [fileInterruttori, "3110"], { controllaPorta: portaOk, avvia: async () => 0 }, /RADAR_PER_TE non è «attivo».*RADAR_NOTIFICHE_EMAIL deve essere spento/);
    uguale("CB6b. ambiente giusto: nessun problema; ogni interruttore mancante segnalato per nome", [ca.erroriAmbiente(ca.leggiVariabili(variabiliValide)), ca.erroriAmbiente({ ...ca.leggiVariabili(variabiliValide), RADAR_UFFICIO_GARE: "", RADAR_CLASSIFICAZIONI: "attivo", RADAR_NOTIFICHE_PREFERENZE: "attivo" })], [[], ["RADAR_UFFICIO_GARE non è «attivo»", "RADAR_CLASSIFICAZIONI non è «attive»", "RADAR_NOTIFICHE_PREFERENZE deve essere spento (vuoto o «0»)"]]);

    // ───── la finestra completa a secco, nell'ordine del piano 28 ─────
    const s = stagingFinto();
    const esiti: Record<string, unknown> = {};
    let portaUsata = 0;
    const chiamateDa = (da: number) => s.chiamate.slice(da);
    const giro = await cattura(() =>
      ca.collaudo([fileFuori, "3110"], {}, {
        cartella: progetto,
        fetchFn: s.fetchFinto,
        controllaPorta: portaOk,
        portaAccesso: 0,
        adesso: () => ADESSO,
        avvia: async ({ portaAccesso, segnale }: { portaAccesso: number; segnale: AbortSignal }) => {
          portaUsata = portaAccesso;
          esiti.segnaleAllAvvio = segnale.aborted;
          const base = `http://localhost:${portaAccesso}`;
          esiti.chiamateAllAvvio = s.chiamate.length;
          const pronto = await fetch(`${base}/pronto`);
          const html = await pronto.text();
          esiti.pronto = { stato: pronto.status, cache: pronto.headers.get("cache-control"), referrer: pronto.headers.get("referrer-policy"), cornici: pronto.headers.get("x-frame-options"), csp: pronto.headers.get("content-security-policy") ?? "", html };
          const via = (html.match(/name="via" value="([^"]+)"/) ?? [])[1] ?? "";
          const invia = (p: string, campi: Record<string, string> = { via }, extra: Record<string, string> = {}) =>
            fetch(`${base}${p}`, { method: "POST", redirect: "manual", headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: base, ...extra }, body: new URLSearchParams(campi).toString() });
          esiti.strade = [
            (await fetch(`${base}/accesso/ti-titolare`, { redirect: "manual" })).status,
            (await invia("/accesso/ti-titolare", {})).status,
            (await invia("/accesso/ti-titolare", { via: "codice-sbagliato" })).status,
            (await invia("/accesso/ti-titolare", { via }, { Origin: "http://altro-sito.test" })).status,
            (await invia("/accesso/ti-titolare", { via }, { Origin: "null" })).status,
            await conHost(portaAccesso, "/pronto", "altro-sito.test"),
            await conHost(portaAccesso, "/accesso/ti-titolare", `127.0.0.1:${portaAccesso}`),
          ];
          esiti.chiamatePrimaDelVia = s.chiamate.length;
          const fuoriOrdine = await invia("/accesso/ti-titolare");
          const finaliPresto = await invia("/verifiche-finali");
          esiti.ordine = [fuoriOrdine.status, await fuoriOrdine.text(), finaliPresto.status, s.chiamate.length];
          // D3: ti-admin (console)
          let da = s.chiamate.length;
          const admin = await invia("/accesso/ti-admin");
          esiti.admin = { stato: admin.status, location: admin.headers.get("location") ?? "", chiamate: chiamateDa(da) };
          // passo 1 PRIMA che la D3 sia fatta nel browser: prerequisito mancante, nessun collegamento, pulsante ancora da usare
          da = s.chiamate.length;
          const senzaD3 = await invia("/accesso/titolare-benchmark");
          esiti.senzaD3 = { stato: senzaD3.status, testo: await senzaD3.text(), chiamate: chiamateDa(da) };
          s.passi.d3();
          da = s.chiamate.length;
          const p1 = await invia("/accesso/titolare-benchmark", { via }, { Cookie: `${COOKIE}=vecchio-non-diviso; altro=1` });
          esiti.p1 = { stato: p1.status, location: p1.headers.get("location") ?? "", cache: p1.headers.get("cache-control"), referrer: p1.headers.get("referrer-policy"), cookie: p1.headers.getSetCookie(), chiamate: chiamateDa(da) };
          s.passi.p1();
          da = s.chiamate.length;
          const p2 = await invia("/accesso/ti-titolare");
          esiti.p2 = { stato: p2.status, location: p2.headers.get("location") ?? "", chiamate: chiamateDa(da) };
          s.passi.p2();
          da = s.chiamate.length;
          const p3 = await invia("/accesso/ufficio-benchmark");
          esiti.p3 = { stato: p3.status, location: p3.headers.get("location") ?? "", chiamate: chiamateDa(da) };
          s.passi.p3();
          da = s.chiamate.length;
          const p4 = await invia("/accesso/ti-titolare2");
          esiti.p4 = { stato: p4.status, location: p4.headers.get("location") ?? "", chiamate: chiamateDa(da) };
          da = s.chiamate.length;
          esiti.ripetuto = [(await invia("/accesso/ti-titolare2")).status, s.chiamate.length - da];
          esiti.ignoto = (await invia("/accesso/qualcuno")).status;
          s.passi.p4();
          da = s.chiamate.length;
          const finali = await invia("/verifiche-finali");
          esiti.finali = { stato: finali.status, html: await finali.text(), chiamate: chiamateDa(da) };
          esiti.finaliDiNuovo = (await invia("/verifiche-finali")).status;
          esiti.prontoDopo = await (await fetch(`${base}/pronto`)).text();
          esiti.segnaleAllaFine = segnale.aborted;
          return 0;
        },
      }),
    );
    const pronto = esiti.pronto as { stato: number; cache: string; referrer: string; cornici: string; csp: string; html: string };
    uguale("CB7. all'avvio NESSUN collegamento e nessuna lettura: zero chiamate allo staging finché non si preme un pulsante (anche con GET, codice, origine o host sbagliati)", [esiti.chiamateAllAvvio, esiti.chiamatePrimaDelVia], [0, 0]);
    atteso(
      "CB8. /pronto: 200 senza token né cache, referer solo verso sé stessa, non incorniciabile, i 5 pulsanti POST nell'ordine D3 → 1 → 2 → 3 → 4, solo il primo attivo; i dati della gara D2 da copiare; verifiche finali bloccate",
      pronto.stato === 200 && pronto.cache === "no-store" && pronto.referrer === "same-origin" && pronto.cornici === "DENY" && pronto.csp.includes("frame-ancestors 'none'") &&
        ["ti-admin", "titolare-benchmark", "ti-titolare", "ufficio-benchmark", "ti-titolare2"].map((u) => pronto.html.indexOf(`<form method="post" action="/accesso/${u}">`)).every((x, i, a) => x > 0 && (i === 0 || x > a[i - 1])) &&
        (pronto.html.match(/disabled>Passo/g) ?? []).length === 4 && pronto.html.includes("Passo D3 · Entra come ti-admin (console)") &&
        pronto.html.includes("COLLAUDO B4 — gara sintetica dell&#39;Ufficio Gare") && pronto.html.includes("https://esempio.invalid/collaudo-b4") && /disabled>Verifiche finali/.test(pronto.html) && !VIETATI.test(pronto.html),
    );
    uguale("CB9. strade sbagliate respinte: GET 405, senza codice 403, codice sbagliato 403, altra origine o «null» 403, host estraneo o numerico 403", esiti.strade, [405, 403, 403, 403, 403, 403, 403]);
    const ordine = esiti.ordine as [number, string, number, number];
    atteso("CB10. ordine imposto: ti-titolare prima della D3 → 409 «Prima va completato il passo D3», verifiche finali prima del passo 4 → 409; nessuna chiamata", ordine[0] === 409 && ordine[1].includes("Prima va completato il passo D3 (ti-admin)") && ordine[2] === 409 && ordine[3] === 0, JSON.stringify(ordine));
    const adm = esiti.admin as { stato: number; location: string; chiamate: Chiamata[] };
    atteso(
      "CB11. D3: pulsante di ti-admin → collegamento generato e verificato lato server, identità controllata, 303 alla console su localhost; nessuna lettura di dati",
      adm.stato === 303 && adm.location === "http://localhost:3110/?__zone=console" && adm.chiamate.map((c) => new URL(c.url).pathname).join(",") === "/auth/v1/admin/generate_link,/auth/v1/verify,/auth/v1/user",
      JSON.stringify({ stato: adm.stato, location: adm.location, chiamate: adm.chiamate.map((c) => c.url) }),
    );
    const sd3 = esiti.senzaD3 as { stato: number; testo: string; chiamate: Chiamata[] };
    atteso(
      "CB12. passo 1 prima che la D3 sia fatta: 409 «Radar dell'impresa 3 non risulta abilitato», nessun collegamento generato (solo letture di servizio), pulsante ancora da usare",
      sd3.stato === 409 && sd3.testo.includes("non risulta abilitato") && sd3.chiamate.length > 0 && sd3.chiamate.every((c) => c.metodo === "GET" && c.auth === `Bearer ${SEGRETA}` && c.url.includes("/rest/v1/")) && (esiti.p1 as { stato: number }).stato === 303,
      JSON.stringify(sd3),
    );
    const p1 = esiti.p1 as { stato: number; location: string; cache: string; referrer: string; cookie: string[]; chiamate: Chiamata[] };
    atteso(
      "CB13. passo 1 dopo la D3: 303 al profilo di ricerca su localhost, senza token nell'indirizzo; le verifiche lato server avvengono PRIMA del 303 (stessa richiesta)",
      p1.stato === 303 && p1.location === "http://localhost:3110/dashboard/omnia-ai/opportunita/profilo?__zone=omnia-ai" && p1.cache === "no-store" && p1.referrer === "no-referrer" && !/TOKEN|ACCESSO/.test(p1.location) &&
        p1.chiamate.some((c) => c.url.includes("/auth/v1/user")) && p1.chiamate.some((c) => c.metodo === "PATCH"),
    );
    const impostati = p1.cookie.filter((c) => !/Max-Age=0/.test(c)).map((c) => c.split(";")[0]);
    const scaduti = p1.cookie.filter((c) => /Max-Age=0/.test(c)).map((c) => c.split("=")[0]);
    atteso("CB14. cookie di sessione per «localhost»: diviso in .0 e .1, Path=/, SameSite=Lax, mai Domain; il vecchio cookie non diviso scade, gli altri restano", impostati.map((c) => c.split("=")[0]).join(",") === `${COOKIE}.0,${COOKIE}.1` && p1.cookie.every((c) => /; Path=\//.test(c) && /SameSite=Lax/.test(c) && !/Domain=/i.test(c)) && scaduti.join(",") === COOKIE);
    const letti = impostati.map((c) => ({ name: c.slice(0, c.indexOf("=")), value: c.slice(c.indexOf("=") + 1) }));
    const lettoreApp = createServerClient(STAGING, PUBBLICA, { cookies: { getAll: () => letti, setAll: () => {} }, global: { fetch: s.fetchFinto } });
    const primaLettura = s.chiamate.length;
    const { data: sessioneLetta } = await lettoreApp.auth.getSession();
    atteso("CB15. l'app legge quei cookie con la sua libreria (@supabase/ssr): sessione di titolare-benchmark, senza alcuna chiamata", sessioneLetta.session?.access_token === ACCESSO.get(EMAIL.t3) && s.chiamate.length === primaLettura);
    const tutte = [adm, p1, esiti.p2, esiti.p3, esiti.p4].flatMap((x) => (x as { chiamate: Chiamata[] }).chiamate);
    const conToken = tutte.filter((c) => c.auth.startsWith("Bearer ACCESSO_SINTETICO"));
    const scrittureUtente = conToken.filter((c) => c.metodo !== "GET");
    atteso(
      "CB16. tre tentativi di scrittura per ciascuno dei 4 utenti dell'area clienti (12), SOLO sul profilo e SOLO con il token dell'utente; tutte le altre chiamate con il token sono GET; la chiave di servizio fa solo GET (oltre a generate_link)",
      scrittureUtente.length === 12 && scrittureUtente.every((c) => new URL(c.url).pathname === "/rest/v1/omnia_ai_radar_profili") &&
        tutte.filter((c) => c.auth === `Bearer ${SEGRETA}` && new URL(c.url).pathname !== "/auth/v1/admin/generate_link").every((c) => c.metodo === "GET") &&
        !tutte.some((c) => c.auth === `Bearer ${SEGRETA}` && c.url.includes("/rest/v1/") && c.metodo !== "GET"),
      JSON.stringify(scrittureUtente.map((c) => `${c.metodo} ${c.url}`)),
    );
    const tentativiT1 = (esiti.p2 as { chiamate: Chiamata[] }).chiamate.filter((c) => c.metodo !== "GET" && c.auth === `Bearer ${ACCESSO.get(EMAIL.t1)}`);
    uguale(
      "CB17. i tentativi di ti-titolare sono esattamente quelli innocui del piano: a PATCH con filtro impossibile (posizione 0) e nome invariato, b DELETE con id impossibile, c POST con posizione 9 fuori dal vincolo 1–5",
      tentativiT1.map((c) => [c.metodo, c.url.replace(STAGING, ""), c.corpo]),
      [
        ["PATCH", `/rest/v1/omnia_ai_radar_profili?user_id=eq.${ID.t1}&posizione=eq.0`, JSON.stringify({ nome: "Profilo principale" })],
        ["DELETE", "/rest/v1/omnia_ai_radar_profili?id=eq.00000000-0000-0000-0000-000000000000", ""],
        ["POST", "/rest/v1/omnia_ai_radar_profili", JSON.stringify({ user_id: ID.t1, posizione: 9, nome: "COLLAUDO B4 — tentativo da respingere" })],
      ],
    );
    const righeGiro = voci(giro.righe);
    const di = (utente: string) => righeGiro.filter((r) => r.includes(`] ${utente}:`) || r.includes(`] ${utente} → `));
    const ok = (r: string) => / → ok( \(accesso negato, 40[13]\))?$/.test(r) || r.endsWith("→ non applicabile (l'altra impresa non ha righe)");
    const isolamentoDi = (utente: string, altre: string[]) => altre.every((a) => ca.TABELLE_ISOLAMENTO.every((t: { tabella: string }) => di(utente).some((r) => r.includes(`→ impresa di ${a}, ${t.tabella}:`) && ok(r))));
    atteso(
      "CB18. passo 1 (titolare-benchmark): identità, positivo su users e sull'Ufficio Gare della propria impresa, 3 tentativi respinti, isolamento dalle imprese 1 e 2 in tutte le 11 tabelle",
      di("titolare-benchmark").some((r) => r.includes("identità della sessione = utente del clic → ok")) && di("titolare-benchmark").some((r) => r.includes("Ufficio Gare attivo della propria impresa") && r.endsWith("→ ok")) &&
        di("titolare-benchmark").filter((r) => r.startsWith("[6]") && r.endsWith("risposta 403 (attesa 401 o 403) → ok")).length === 3 && isolamentoDi("titolare-benchmark", ["ti-titolare", "ti-titolare2"]),
      di("titolare-benchmark").join(" | "),
    );
    atteso(
      "CB19. passo 2 (ti-titolare): il profilo D1 dell'impresa 3 esiste (1) ma è invisibile (0); isolamento dalle imprese 2 e 3",
      di("ti-titolare").some((r) => r.includes("→ impresa di titolare-benchmark, omnia_ai_radar_profili: viste 0, esistenti 1 → ok")) && isolamentoDi("ti-titolare", ["ti-titolare2", "titolare-benchmark"]),
      di("ti-titolare").join(" | "),
    );
    atteso(
      "CB20. passo 3 (ufficio-benchmark): iscrizione attiva letta, profilo dell'impresa 3 letto con la sua sessione (1 = 1, sola lettura), 3 tentativi respinti, profilo dell'impresa 1 invisibile, isolamento dalle imprese 1 e 2",
      di("ufficio-benchmark").some((r) => r.startsWith("[4]") && r.includes("iscrizione attiva") && r.endsWith("→ ok")) &&
        di("ufficio-benchmark").some((r) => r.startsWith("[5]") && r.includes("viste 1, esistenti 1") && r.endsWith("→ ok")) &&
        di("ufficio-benchmark").filter((r) => r.startsWith("[6]") && r.endsWith("→ ok")).length === 3 &&
        di("ufficio-benchmark").some((r) => r.includes("→ impresa di ti-titolare, omnia_ai_radar_profili: viste 0, esistenti 1 → ok")) && isolamentoDi("ufficio-benchmark", ["ti-titolare", "ti-titolare2"]),
      di("ufficio-benchmark").join(" | "),
    );
    atteso(
      "CB21. passo 4 (ti-titolare2): prova gratuita propria letta, «usate» 0 e nessuna riga nuova nel registro all'accesso; gara D2 dell'impresa 3 esistente e invisibile; isolamento dalle imprese 1 e 3 (salvate, aggiunte e profili compresi)",
      di("ti-titolare2").some((r) => r.startsWith("[9]") && r.includes("propria prova gratuita") && r.endsWith("→ ok")) && di("ti-titolare2").some((r) => r.includes("«usate» all'accesso: 0") && r.endsWith("→ ok")) &&
        di("ti-titolare2").some((r) => r.includes("registro delle gare gratuite all'accesso: 0") && r.endsWith("→ ok")) &&
        di("ti-titolare2").some((r) => r.includes("gara sintetica D2 dell'impresa 3: viste 0, esistenti 1 → ok")) &&
        di("ti-titolare2").some((r) => r.includes("→ impresa di titolare-benchmark, omnia_ai_radar_gare_aggiunte: viste 0, esistenti 1 → ok")) && isolamentoDi("ti-titolare2", ["ti-titolare", "titolare-benchmark"]),
      di("ti-titolare2").join(" | "),
    );
    uguale("CB22. un solo tentativo per utente: il secondo clic riceve 410 senza alcuna chiamata; utente sconosciuto 404", [esiti.ripetuto, esiti.ignoto], [[410, 0], 404]);
    const fin = esiti.finali as { stato: number; html: string; chiamate: Chiamata[] };
    const finaliRighe = righeGiro.filter((r) => !/^\[\d+\] (ti-|titolare-|ufficio-)/.test(r));
    atteso(
      "CB23. verifiche finali dopo il passo 4: 200, solo GET con la chiave di servizio; profili (1 per le imprese 1 e 3, 0 per la 2, autore il titolare), nessun profilo dall'Ufficio Gare, salvate e monitorate nei tetti, la sola gara D2 dichiarata e salvata dall'Ufficio Gare, gare gratuite ferme, Radar dell'impresa 3 e registro della console nei tetti: tutto ok",
      fin.stato === 200 && fin.chiamate.length > 0 && fin.chiamate.every((c) => c.metodo === "GET" && c.auth === `Bearer ${SEGRETA}`) && finaliRighe.length >= 18 && finaliRighe.every((r) => r.endsWith("→ ok")) && fin.html.includes("Verifiche finali") && !VIETATI.test(fin.html),
      finaliRighe.filter((r) => !r.endsWith("→ ok")).join(" | ") || `${finaliRighe.length} righe`,
    );
    atteso("CB24. verifiche finali una volta sola (poi 410); /pronto alla fine: 5 pulsanti usati e disattivati, verifiche finali «già eseguite»", esiti.finaliDiNuovo === 410 && ((esiti.prontoDopo as string).match(/disabled>Passo/g) ?? []).length === 5 && (esiti.prontoDopo as string).includes("già eseguite"));
    const resoconto = giro.righe.slice(giro.righe.findIndex((r) => r.startsWith("Resoconto dei 10 controlli")));
    atteso(
      "CB25. alla chiusura il resoconto dei 10 controlli: lato server ok per 1, 4, 5, 6, 7, 8 e 9; 2, 3 e 10 «nessuna verifica lato server», ciascuno con i passi del browser",
      resoconto.length === 11 && [1, 4, 5, 6, 7, 8, 9].every((n) => resoconto[n].startsWith(`  ${n}. `) && resoconto[n].includes("lato server ok (")) && [2, 3, 10].every((n) => resoconto[n].includes("lato server nessuna verifica lato server · nel browser:")),
      resoconto.join(" | "),
    );
    atteso("CB26. finestra regolare: il segnale di fermo non scatta mai, codice d'uscita quello dell'app, server d'accesso chiuso", giro.valore === 0 && esiti.segnaleAllAvvio === false && esiti.segnaleAllaFine === false && (await chiuso(portaUsata)));
    atteso("CB27. nell'uscita del giro nessun token, chiave, cookie, collegamento o id completo; il pid del collaudo stampato per le misure", !giro.righe.some((r) => VIETATI.test(r)) && giro.righe.some((r) => r.includes(`pid ${process.pid}`)), giro.righe.filter((r) => VIETATI.test(r)).join(" | "));

    // ───── VIOLAZIONE simulata durante il collaudo: deve fermare TUTTO ─────
    const sv = stagingFinto();
    const esitiV: Record<string, unknown> = {};
    const violato = await cattura(() =>
      ca.collaudo([fileFuori, "3110"], {}, {
        cartella: progetto,
        fetchFn: sv.fetchFinto,
        controllaPorta: portaOk,
        portaAccesso: 0,
        adesso: () => ADESSO,
        avvia: async ({ portaAccesso, segnale }: { portaAccesso: number; segnale: AbortSignal }) => {
          const base = `http://localhost:${portaAccesso}`;
          const via = ((await (await fetch(`${base}/pronto`)).text()).match(/name="via" value="([^"]+)"/) ?? [])[1] ?? "";
          const invia = (p: string) => fetch(`${base}${p}`, { method: "POST", redirect: "manual", headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: base }, body: new URLSearchParams({ via }).toString() });
          await invia("/accesso/ti-admin");
          sv.passi.d3();
          await invia("/accesso/titolare-benchmark");
          sv.passi.p1();
          await invia("/accesso/ti-titolare");
          sv.passi.p2();
          // la RLS del profilo «si rompe»: l'Ufficio Gare dell'impresa 3 vedrebbe il profilo dell'impresa 1
          sv.guasti.rlsAperta.add("omnia_ai_radar_profili");
          const p3 = await invia("/accesso/ufficio-benchmark");
          esitiV.p3 = { stato: p3.status, cookie: p3.headers.getSetCookie().length, location: p3.headers.get("location"), html: await p3.text() };
          esitiV.fermatoSubito = segnale.aborted;
          const da = sv.chiamate.length;
          esitiV.dopo = [(await invia("/accesso/ti-titolare2")).status, (await invia("/verifiche-finali")).status, sv.chiamate.length - da];
          esitiV.pronto = await (await fetch(`${base}/pronto`)).text();
          // l'app vera viene spenta dal segnale: qui si attende che scatti
          await new Promise<void>((risolvi) => (segnale.aborted ? risolvi() : segnale.addEventListener("abort", () => risolvi(), { once: true })));
          return 0;
        },
      }),
    );
    const v3 = esitiV.p3 as { stato: number; cookie: number; location: string | null; html: string };
    atteso(
      "CB28. VIOLAZIONE simulata (profilo dell'impresa 1 visibile all'Ufficio Gare): risposta 423 «COLLAUDO FERMATO», NESSUN cookie, nessun reindirizzamento all'app; il segnale di fermo spegne l'app",
      v3.stato === 423 && v3.cookie === 0 && v3.location === null && v3.html.includes("COLLAUDO FERMATO") && v3.html.includes("NON è entrato") && esitiV.fermatoSubito === true,
      JSON.stringify({ ...v3, html: v3.html.slice(0, 200) }),
    );
    uguale("CB29. dopo il fermo ogni pulsante riceve 423 senza alcuna chiamata, verifiche finali comprese; /pronto mostra «COLLAUDO FERMATO» con tutti i pulsanti disattivati", [esitiV.dopo, (esitiV.pronto as string).includes("COLLAUDO FERMATO"), ((esitiV.pronto as string).match(/disabled>Passo/g) ?? []).length, /disabled>Verifiche finali/.test(esitiV.pronto as string)], [[423, 423, 0], true, 5, true]);
    const resocontoV = violato.righe.slice(violato.righe.findIndex((r) => r.startsWith("Resoconto dei 10 controlli")));
    atteso(
      "CB30. il collaudo esce con codice 3, stampa la VIOLAZIONE sul profilo e il resoconto con il controllo 7 in VIOLAZIONE; nessun token nell'uscita",
      violato.valore === 3 && violato.righe.some((r) => r.startsWith("COLLAUDO FERMATO:") && r.includes("omnia_ai_radar_profili")) && resocontoV[7]?.includes("lato server VIOLAZIONE") && violato.righe.some((r) => r.includes("Esito: COLLAUDO FERMATO")) && !violato.righe.some((r) => VIETATI.test(r)),
      violato.righe.filter((r) => /FERMATO|VIOLAZIONE/.test(r)).join(" | "),
    );

    // ───── verifiche dopo l'accesso, una per una, con i guasti simulati ─────
    const utente = (email: string) => ca.UTENTI_COLLAUDO.find((u: { email: string }) => u.email === email);
    const dopo = async (email: string, prepara: (x: ReturnType<typeof stagingFinto>) => void, token = ACCESSO.get(email)) => {
      const x = stagingFinto();
      x.passi.d3();
      x.passi.p1();
      x.passi.p2();
      x.passi.p3();
      prepara(x);
      const lettore = ca.creaLettore({ variabili: variabiliLettore, fetchFn: x.fetchFinto });
      const r = await ca.verificheDopoAccesso({ lettore, utente: utente(email), accessToken: token, inizio });
      return (r.voci as { controllo: number; testo: string; esito: string }[]).map(ca.rigaVoce) as string[];
    };
    const ammessa = await dopo(EMAIL.uff, (x) => void (x.guasti.scritturaAmmessa = true));
    atteso("CB31. un tentativo di scrittura AMMESSO (204) → 3 VIOLAZIONI del controllo 6 (fermo)", ammessa.filter((r) => r.startsWith("[6]") && r.endsWith("risposta 204 (attesa 401 o 403) → VIOLAZIONE")).length === 3, ammessa.filter((r) => r.startsWith("[6]")).join(" | "));
    const rotta500 = await dopo(EMAIL.t2, (x) => void x.guasti.erroreSessione.set("omnia_ai_radar_salvate", 500));
    atteso("CB32. una lettura con la sessione che risponde 500 non vale come «accesso negato»: ERRORE (fermo), non ok", rotta500.some((r) => r.includes("omnia_ai_radar_salvate: viste errore 500") && r.endsWith("→ ERRORE")) && !rotta500.some((r) => r.includes("errore 500") && r.includes("→ ok")));
    const altrui = await dopo(EMAIL.t2, () => {}, ACCESSO.get(EMAIL.t1));
    uguale("CB33. sessione di un altro utente → identità non riconosciuta, ERRORE, nessun'altra verifica (mai «ok» per difetto)", altrui, ["[7] ti-titolare2: identità della sessione non riconosciuta → ERRORE"]);
    const cieca = await dopo(EMAIL.t1, (x) => void x.guasti.rlsChiusa.add("users"));
    atteso("CB34. controllo positivo: se la sessione non vede nemmeno la propria riga gli zeri non dimostrano nulla → ERRORE", cieca.some((r) => r.includes("propria riga di users: viste 0, esistenti 1") && r.endsWith("→ ERRORE")));
    const d2Visibile = await dopo(EMAIL.t2, (x) => void x.guasti.rlsAperta.add("omnia_ai_radar_gare_aggiunte"));
    atteso("CB35. gara D2 visibile all'impresa 2 → VIOLAZIONE sulla gara D2 e sull'isolamento delle aggiunte", d2Visibile.some((r) => r.includes("gara sintetica D2 dell'impresa 3: viste 1, esistenti 1 → VIOLAZIONE")) && d2Visibile.some((r) => r.includes("→ impresa di titolare-benchmark, omnia_ai_radar_gare_aggiunte: viste 1") && r.endsWith("VIOLAZIONE")));
    const senzaD1 = await dopo(EMAIL.uff, (x) => void (x.dati.omnia_ai_radar_profili = x.dati.omnia_ai_radar_profili.filter((p) => p.user_id !== ID.t3)));
    atteso("CB36. profilo D1 mancante: il positivo dell'Ufficio Gare sul profilo è «NON RIUSCITO», senza fermare la finestra", senzaD1.some((r) => r.startsWith("[5]") && r.endsWith("→ NON RIUSCITO (manca il profilo D1)")) && !ca.daFermare(senzaD1.map((r) => ({ esito: r.slice(r.lastIndexOf("→ ") + 2) }))));
    const usateGia = await dopo(EMAIL.t2, (x) => void (x.dati.omnia_ai_gare_gratuite[0].usate = 1));
    atteso("CB37. «usate» dell'impresa 2 già diverso da 0 all'accesso → ERRORE (prerequisito), fermo", usateGia.some((r) => r.includes("«usate» all'accesso: 1") && r.endsWith("→ ERRORE")));

    // ───── verifiche finali con i guasti simulati ─────
    const finale = async (prepara: (x: ReturnType<typeof stagingFinto>) => void, usateIniziali: number | null = 0) => {
      const x = stagingFinto();
      x.passi.d3();
      x.passi.p1();
      x.passi.p2();
      x.passi.p3();
      x.passi.p4();
      prepara(x);
      const lettore = ca.creaLettore({ variabili: variabiliLettore, fetchFn: x.fetchFinto });
      const v = (await ca.verificheFinali({ lettore, inizio, usateIniziali })) as { controllo: number; testo: string; esito: string }[];
      return { righe: v.map(ca.rigaVoce) as string[], fermo: ca.daFermare(v), scritture: x.chiamate.filter((c) => c.metodo !== "GET").length };
    };
    const tutto = await finale(() => {});
    atteso("CB38. verifiche finali regolari: tutte ok, nessun fermo, nessuna scrittura", tutto.righe.every((r) => r.endsWith("→ ok")) && tutto.fermo === null && tutto.scritture === 0, tutto.righe.filter((r) => !r.endsWith("→ ok")).join(" | "));
    const caso = async (nome: string, prepara: (x: ReturnType<typeof stagingFinto>) => void, controllo: number, cerca: string, esito = "VIOLAZIONE", usateIniziali: number | null = 0) => {
      const r = await finale(prepara, usateIniziali);
      const trovata = r.righe.find((x) => x.startsWith(`[${controllo}]`) && x.includes(cerca));
      atteso(nome, !!trovata && trovata.endsWith(`→ ${esito}`) && (esito === "VIOLAZIONE" || esito === "ERRORE" ? r.fermo !== null : r.fermo === null), r.righe.filter((x) => !x.endsWith("→ ok")).join(" | ") || "tutte ok");
    };
    await caso("CB39. «usate» dell'impresa 2 passa a 1 dopo le sue ricerche → VIOLAZIONE del controllo 9", (x) => void (x.dati.omnia_ai_gare_gratuite[0].usate = 1), 9, "«usate» dell'impresa di ti-titolare2 alla fine: 1");
    await caso("CB40. una riga nuova nel registro delle gare gratuite → VIOLAZIONE del controllo 9", (x) => void x.dati.omnia_ai_gare_gratuite_log.push({ id: "l2", user_id: ID.t3, created_at: NUOVA }), 9, "registro delle gare gratuite (tutte le imprese): 1");
    await caso("CB41. una prova gratuita modificata nella finestra (D3 non ridotta) → VIOLAZIONE del controllo 9", (x) => void (x.dati.omnia_ai_gare_gratuite[0].aggiornato_il = NUOVA), 9, "gare gratuite modificate nella finestra (tutte le imprese): 1");
    await caso("CB42. nessuna ricerca dell'impresa 2 nella finestra → controllo 9 NON RIUSCITO (la prova non dimostra nulla)", (x) => void (x.dati.omnia_ai_radar_utilizzi = x.dati.omnia_ai_radar_utilizzi.filter((u) => u.id !== "u4")), 9, "ricerche dell'impresa di ti-titolare2", "NON RIUSCITO");
    await caso("CB43. gara aggiunta NON dichiarata sintetica (collegamento non .invalid) → VIOLAZIONE del controllo 8", (x) => void (x.dati.omnia_ai_radar_gare_aggiunte.find((g) => g.id === "a3")!.url = "https://www.comune-vero.it/bando"), 8, "gare aggiunte dell'impresa di titolare-benchmark");
    await caso("CB44. gara D2 aggiunta dal titolare invece che dall'Ufficio Gare → VIOLAZIONE del controllo 8", (x) => void (x.dati.omnia_ai_radar_gare_aggiunte.find((g) => g.id === "a3")!.creata_da = ID.t3), 8, "gare aggiunte dell'impresa di titolare-benchmark");
    await caso("CB45. gara D2 assente → controllo 8 NON RIUSCITO", (x) => void (x.dati.omnia_ai_radar_gare_aggiunte = x.dati.omnia_ai_radar_gare_aggiunte.filter((g) => g.id !== "a3")), 8, "gare aggiunte dell'impresa di titolare-benchmark", "NON RIUSCITO");
    await caso("CB46. una gara salvata dall'impresa 2 → VIOLAZIONE del controllo 8 (tetto 0)", (x) => void x.dati.omnia_ai_radar_salvate.push({ id: "s9", user_id: ID.t2, monitorata: false, salvata_da: ID.t2, aggiunta_id: null, creata_il: NUOVA, aggiornata_il: NUOVA, ultimo_aggiornamento_visto_il: null }), 8, "salvate dell'impresa di ti-titolare2");
    await caso("CB47. quattro righe salvate o toccate dell'impresa 1 (tetto 3, «visto» compreso) → VIOLAZIONE del controllo 8", (x) => void (x.dati.omnia_ai_radar_salvate.find((r) => r.id === "s1")!.ultimo_aggiornamento_visto_il = NUOVA, x.dati.omnia_ai_radar_salvate.find((r) => r.id === "s2")!.aggiornata_il = NUOVA), 8, "salvate dell'impresa di ti-titolare nella finestra: 4");
    await caso("CB48. profilo scritto dall'Ufficio Gare → VIOLAZIONE del controllo 5", (x) => void (x.dati.omnia_ai_radar_profili.find((p) => p.id === "p3")!.aggiornato_da = ID.uff), 5, "profili scritti da ufficio-benchmark: 1");
    await caso("CB68. profilo dell'impresa 3 scritto da un utente che non è il suo titolare → VIOLAZIONE del controllo 1", (x) => void (x.dati.omnia_ai_radar_profili.find((p) => p.id === "p3")!.aggiornato_da = ID.t1), 1, "profili dell'impresa di titolare-benchmark: 1 (attesi 1), autore il titolare: NO");
    await caso("CB49. un profilo per l'impresa 2 → VIOLAZIONE del controllo 1", (x) => void x.dati.omnia_ai_radar_profili.push({ id: "p2", user_id: ID.t2, aggiornato_da: ID.t2, settori: ["pulizia"], aggiornato_il: NUOVA }), 1, "profili dell'impresa di ti-titolare2: 1");
    await caso("CB50. due righe nuove nel registro della console (D3 oltre il tetto) → VIOLAZIONE del controllo 4", (x) => void x.dati.radar_console_registro.push({ id: "r3", creato_il: NUOVA }), 4, "registro della console: 2");
    await caso("CB51. nessun utilizzo registrato per l'Ufficio Gare → controllo 4 NON RIUSCITO", (x) => void (x.dati.omnia_ai_radar_utilizzi = x.dati.omnia_ai_radar_utilizzi.filter((u) => u.id !== "u3")), 4, "utilizzi di Opportunità registrati per ufficio-benchmark", "NON RIUSCITO");
    await caso("CB52. «usate» all'accesso non letto → ERRORE del controllo 9, mai ok per difetto", () => {}, 9, "alla fine: 0 (all'accesso non lette", "ERRORE", null);
    uguale("CB53. la gara D2 si riconosce solo se dichiarata: prefisso, dominio .invalid, nessun CIG", [ca.garaD2Conforme({ oggetto: "COLLAUDO B4 — gara sintetica dell'Ufficio Gare", url: "https://esempio.invalid/collaudo-b4", cig: null }), ca.garaD2Conforme({ oggetto: "COLLAUDO B4 — gara sintetica", url: "https://esempio.it/x", cig: null }), ca.garaD2Conforme({ oggetto: "Servizio di pulizia", url: "https://esempio.invalid/x", cig: null }), ca.garaD2Conforme({ oggetto: "COLLAUDO B4 — gara sintetica", url: "https://esempio.invalid/x", cig: "B1234ABCD5" }), ca.garaD2Conforme({ oggetto: "COLLAUDO B4 — gara sintetica", url: "non un indirizzo", cig: null })], [true, false, false, false, false]);

    // ───── prerequisiti ─────
    const pre = async (email: string, prepara: (x: ReturnType<typeof stagingFinto>) => void) => {
      const x = stagingFinto();
      prepara(x);
      const lettore = ca.creaLettore({ variabili: variabiliLettore, fetchFn: x.fetchFinto });
      const r = await ca.verificaPrerequisiti({ lettore, utente: utente(email) });
      return [r.ok, x.chiamate.every((c) => c.metodo === "GET" && c.auth === `Bearer ${SEGRETA}`), x.chiamate.some((c) => c.url.includes("generate_link"))];
    };
    uguale(
      "CB54. prerequisiti (solo GET di servizio, mai un collegamento): Radar dell'impresa 3 per titolare-benchmark e ufficio-benchmark; iscrizione attiva per ufficio-benchmark; nessuno per gli altri",
      [await pre(EMAIL.t3, () => {}), await pre(EMAIL.t3, (x) => x.passi.d3()), await pre(EMAIL.uff, (x) => (x.passi.d3(), void (x.dati.omnia_ai_membri[0].attivo = false))), await pre(EMAIL.uff, (x) => x.passi.d3()), await pre(EMAIL.t2, () => {})],
      [[false, true, false], [true, true, false], [false, true, false], [true, true, false], [true, true, false]],
    );

    // ───── controllo preliminare ─────
    const sp = stagingFinto();
    let pre2: { html: string; post: number; finali: number; portaAccesso: number } = { html: "", post: 0, finali: 0, portaAccesso: 0 };
    const preliminare = await cattura(() =>
      ca.collaudo(["--preliminare", "3110"], {}, {
        fetchFn: sp.fetchFinto,
        portaAccesso: 0,
        attendi: async ({ portaAccesso }: { portaAccesso: number }) => {
          const base = `http://localhost:${portaAccesso}`;
          const html = await (await fetch(`${base}/pronto`)).text();
          const via = (html.match(/name="via" value="([^"]+)"/) ?? [])[1] ?? "";
          const invia = (p: string) => fetch(`${base}${p}`, { method: "POST", redirect: "manual", headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: base }, body: new URLSearchParams({ via }).toString() });
          pre2 = { html, post: (await invia("/accesso/ti-admin")).status, finali: (await invia("/verifiche-finali")).status, portaAccesso };
        },
      }),
    );
    atteso(
      "CB55. --preliminare: senza autorizzazione né variabili, /pronto in modalità preliminare con i 5 pulsanti e le verifiche finali bloccati, POST validi → 409, nessuna chiamata; poi si chiude",
      preliminare.valore === 0 && pre2.html.includes("MODALITÀ PRELIMINARE") && (pre2.html.match(/disabled>Passo/g) ?? []).length === 5 && /disabled>Verifiche finali/.test(pre2.html) && pre2.post === 409 && pre2.finali === 409 && sp.chiamate.length === 0 && (await chiuso(pre2.portaAccesso)),
    );
    const server = ca.serverAccesso({ portaApp: "3110", accedi: async () => ({ cookie: [], accessToken: "" }) });
    const indirizzo = await ca.ascoltaSoloLocale(server, 0);
    atteso("CB56. il server d'accesso ascolta SOLO sul loopback (nome «localhost»)", ["::1", "127.0.0.1"].includes(indirizzo.address), indirizzo.address);
    await ca.chiudi(server);
    // l'app cade: il server d'accesso si chiude lo stesso e il resoconto si stampa
    let portaCaduta = 0;
    const caduta = await cattura(() => ca.collaudo([fileFuori, "3110"], {}, { cartella: progetto, fetchFn: stagingFinto().fetchFinto, controllaPorta: portaOk, portaAccesso: 0, adesso: () => ADESSO, avvia: async ({ portaAccesso }: { portaAccesso: number }) => { portaCaduta = portaAccesso; throw new Error("server caduto"); } }));
    atteso("CB57. se l'app cade, il server d'accesso si chiude lo stesso e il resoconto dei 10 controlli si stampa", portaCaduta > 0 && (await chiuso(portaCaduta)) && caduta.righe.some((r) => r.startsWith("Resoconto dei 10 controlli")));

    // ───── utenti, ordine e codice dello script ─────
    uguale(
      "CB58. utenti del collaudo nell'ordine del piano 28: ti-admin (D3, console), titolare-benchmark (1, D1), ti-titolare (2), ufficio-benchmark (3, Ufficio Gare dell'impresa 3), ti-titolare2 (4); tutti @prova.test",
      ca.UTENTI_COLLAUDO.map((u: { email: string; passo: string; zona: string; impresa?: string }) => [u.email, u.passo, u.zona, u.impresa ?? null]),
      [
        ["ti-admin@prova.test", "D3", "console", null],
        ["titolare-benchmark@prova.test", "1 (D1)", "omnia-ai", "titolare-benchmark@prova.test"],
        ["ti-titolare@prova.test", "2", "omnia-ai", "ti-titolare@prova.test"],
        ["ufficio-benchmark@prova.test", "3", "omnia-ai", "titolare-benchmark@prova.test"],
        ["ti-titolare2@prova.test", "4", "omnia-ai", "ti-titolare2@prova.test"],
      ],
    );
    const codiceScript = fs.readFileSync(path.join(RADICE, "scripts/collaudo-accesso-b4.mjs"), "utf8");
    atteso(
      "CB59. lo script: porta delle autorizzazioni prima della guardia, guardia prima del server; collegamenti generati SOLO dentro il pulsante; verifiche PRIMA del 303; nessun file scritto; solo «localhost»",
      codiceScript.indexOf("controllaPorta({ script: NOME_SCRIPT })") < codiceScript.indexOf("erroriAmbiente(variabili)") &&
        codiceScript.indexOf("erroriAmbiente(variabili)") < codiceScript.indexOf("prerequisiti: (utente) => verificaPrerequisiti(") &&
        (codiceScript.match(/await generaCollegamento\(/g) ?? []).length === 1 && codiceScript.indexOf("await generaCollegamento(") > codiceScript.indexOf("accedi: async (utente) =>") &&
        codiceScript.indexOf("esito = await verifica(utente, sessione.accessToken)") < codiceScript.indexOf("risposta.writeHead(303") &&
        !/writeFileSync|appendFileSync|createWriteStream/.test(codiceScript) && codiceScript.includes('SOLO_LOCALE = "localhost"') && !/http:\/\/127\.0\.0\.1|SOLO_LOCALE = "127/.test(codiceScript),
    );
    const t = ca.tentativiScrittura(ID.t1) as { lettera: string; metodo: string; url: string; corpo: { posizione?: number } | null }[];
    atteso("CB60. tentativi di scrittura innocui per costruzione: a con «posizione=eq.0» (fuori dal vincolo 1–5), b con l'id tutto zeri, c con posizione 9; tutti sul solo profilo", t.length === 3 && t[0].url.endsWith("&posizione=eq.0") && t[1].url.endsWith("?id=eq.00000000-0000-0000-0000-000000000000") && t[2].corpo?.posizione === 9 && t.every((x) => x.url.startsWith(`${STAGING}/rest/v1/omnia_ai_radar_profili`)));

    // ───── nel browser: letturaElenco (controlli 2 e 3) ─────
    const elemento = (v: { sep: true } | { href: string }) =>
      "sep" in v ? { classList: { contains: (c: string) => c === "omnia-opp-separatore" }, getAttribute: () => null } : { classList: { contains: () => false }, getAttribute: (n: string) => (n === "href" ? v.href : null) };
    const documento = (voci: ({ sep: true } | { href: string })[]) => ({ querySelectorAll: () => voci.map(elemento) });
    const G = "/dashboard/omnia-ai/opportunita/gara/";
    // la funzione deve funzionare da sola nel browser: la si ricostruisce dal suo testo, senza nulla del modulo
    const nelBrowser = new Function(`return (${ca.letturaElenco.toString()})`)() as (d: unknown) => { righe: number; uniche: number; doppie: string[]; pertinenti: number; correlate: number; separatori: number; esito: string };
    const pulito = nelBrowser(documento([{ href: `${G}a` }, { href: `${G}b?da=per-te` }, { sep: true }, { href: `${G}c` }]));
    const doppio = nelBrowser(documento([{ href: `${G}a` }, { href: `${G}b` }, { href: `${G}a?pagina=2` }]));
    const fuori = nelBrowser(documento([{ href: `${G}a` }, { href: "/dashboard/omnia-ai/impostazioni" }]));
    const dueSep = nelBrowser(documento([{ href: `${G}a` }, { sep: true }, { href: `${G}b` }, { sep: true }, { href: `${G}c` }]));
    const monitorate = nelBrowser(documento([{ href: `${G}a` }, { href: "/dashboard/omnia-ai/opportunita/aggiunta/x1" }]));
    uguale(
      "CB61. letturaElenco (eseguibile da sola nel browser): chiavi uniche → ok con pertinenti e correlate dopo il separatore; una gara due volte (anche con parametri diversi) → DOPPIE; chiave fuori schema, due separatori, elenco vuoto segnalati; le aggiunte di Monitorate valgono",
      [
        [pulito.esito, pulito.righe, pulito.uniche, pulito.pertinenti, pulito.correlate],
        [doppio.esito, doppio.doppie],
        fuori.esito,
        dueSep.esito,
        nelBrowser(documento([])).esito,
        monitorate.esito,
      ],
      [["ok", 3, 3, 2, 1], ["DOPPIE", [`${G}a`]], "CHIAVI FUORI SCHEMA", "PIÙ SEPARATORI", "elenco vuoto", "ok"],
    );

    // ───── controllo 10: misure dal registro dell'osservatore ─────
    const S = STAGING;
    const registro = [
      `2026-11-20T10:10:00.100Z 4242 GET ${S}/auth/v1/user`,
      `2026-11-20T10:10:00.200Z 4242 GET ${S}/rest/v1/omnia_ai_radar_profili`,
      `2026-11-20T10:10:00.300Z 4242 GET ${S}/rest/v1/radar_procedure`,
      `2026-11-20T10:10:00.400Z 4242 POST ${S}/rest/v1/omnia_ai_radar_utilizzi`,
      `2026-11-20T10:10:00.500Z 777 GET ${S}/rest/v1/users`,
      `2026-11-20T10:10:00.600Z 4242 GET http://localhost:3110/qualcosa`,
      // fermi 60 s: solo il segnale di presenza (2 getUser + 1 RPC)
      `2026-11-20T10:10:30.000Z 4242 GET ${S}/auth/v1/user`,
      `2026-11-20T10:10:30.050Z 4242 GET ${S}/auth/v1/user`,
      `2026-11-20T10:10:30.100Z 4242 POST ${S}/rest/v1/rpc/omnia_ai_presenza_segnale`,
      `2026-11-20T10:10:40.000Z 777 GET ${S}/rest/v1/omnia_ai_radar_salvate`,
      // fermi 60 s con una richiesta della pagina
      `2026-11-20T10:12:30.000Z 4242 GET ${S}/rest/v1/radar_procedure`,
      // fuori dallo staging
      `2026-11-20T10:15:10.000Z 4242 GET https://api.altro.example/x`,
      "riga illeggibile",
    ].join("\n");
    const finestre = [
      { nome: "Per te · titolare · caricamento", da: "2026-11-20T10:10:00.000Z", a: "2026-11-20T10:10:05.000Z", massimi: { "GET /rest/v1/radar_procedure": 1 } },
      { nome: "Per te · titolare · 60 s fermi", da: "2026-11-20T10:10:05.000Z", a: "2026-11-20T10:11:05.000Z", ferma: true },
    ];
    const m1 = ca.misura(registro, { finestre, escludiPid: [777] });
    atteso(
      "CB62. misure: vista contata per categoria (getUser, letture, scritture) escludendo il pid del collaudo; 60 s fermi con il solo segnale di presenza → ok (0 richieste della pagina, presenza 1 volta)",
      m1.ok && m1.righe[0] === "Per te · titolare · caricamento: 4 richieste allo staging (lettura 2, scrittura 1, utente 1) → ok" && m1.righe[1].includes("ferma 60 s: richieste della pagina 0, segnale di presenza 1 volte → ok"),
      m1.righe.join(" | "),
    );
    const m2 = ca.misura(registro, {
      finestre: [
        { nome: "fermi con una lettura", da: "2026-11-20T10:12:00.000Z", a: "2026-11-20T10:13:00.000Z", ferma: true },
        { nome: "fermi troppo corti", da: "2026-11-20T10:14:00.000Z", a: "2026-11-20T10:14:30.000Z", ferma: true },
        { nome: "fuori dallo staging", da: "2026-11-20T10:15:00.000Z", a: "2026-11-20T10:16:00.000Z" },
        { nome: "oltre il massimo", da: "2026-11-20T10:10:00.000Z", a: "2026-11-20T10:13:00.000Z", massimi: { "GET /rest/v1/radar_procedure": 1 } },
        { nome: "finestra rovesciata", da: "2026-11-20T10:13:00.000Z", a: "2026-11-20T10:12:00.000Z" },
      ],
      escludiPid: [777],
    });
    atteso(
      "CB63. misure non in regola: una lettura durante i 60 s fermi, finestra sotto i 60 s, richiesta fuori dallo staging, lettura oltre il massimo, finestra non valida → NON RIUSCITO ciascuna",
      !m2.ok && m2.righe[0].includes("1 richieste della pagina durante l'attesa") && m2.righe[1].includes("finestra troppo corta (30 s") && m2.righe[2].includes("richieste FUORI dallo staging") && m2.righe[3].includes("GET /rest/v1/radar_procedure: 2 (al massimo 1)") && m2.righe[4].endsWith("finestra non valida"),
      m2.righe.join(" | "),
    );
    const conCollaudo = ca.misura(registro, { finestre: [finestre[1]] });
    atteso("CB64. senza escludere il pid del collaudo le sue letture finirebbero tra quelle della pagina: per questo il pid si stampa all'avvio", !conCollaudo.ok && conCollaudo.righe[0].includes("1 richieste della pagina durante l'attesa"));
    const fileRegistro = scrivi("rete.log", registro);
    const fileFinestre = scrivi("finestre.json", JSON.stringify({ escludiPid: [777], finestre }));
    const fileFinestreKo = scrivi("finestre-ko.json", JSON.stringify({ escludiPid: [777], finestre: [{ nome: "fermi con una lettura", da: "2026-11-20T10:12:00.000Z", a: "2026-11-20T10:13:00.000Z", ferma: true }] }));
    const cliOk = await cattura(() => ca.collaudo(["--misure", fileRegistro, fileFinestre], {}));
    const cliKo = await cattura(() => ca.collaudo(["--misure", fileRegistro, fileFinestreKo], {}));
    atteso("CB65. --misure dai file locali: codice 0 se tutto è in regola, 1 se no; nessuna autorizzazione chiesta, nessuna rete", cliOk.valore === 0 && cliOk.righe[cliOk.righe.length - 1] === "Misure: tutte in regola." && cliKo.valore === 1 && cliKo.righe[cliKo.righe.length - 1] === "Misure: ALCUNE NON IN REGOLA.");

    atteso("CB66. in TUTTA l'uscita delle prove nessun token, chiave, cookie o id completo", !stampato.some((r) => VIETATI.test(r)), stampato.filter((r) => VIETATI.test(r)).slice(0, 3).join(" | "));
    atteso("CB67. nessun file scritto nel progetto finto", fs.readdirSync(progetto).every((f) => f === "scripts" || f === "variabili.txt"));
  } finally {
    console.log = logOriginale;
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

prove()
  .catch((e) => atteso("CB. prove eseguite", false, e instanceof Error ? `${e.message}\n${e.stack}` : String(e)))
  .finally(() => {
    atteso("N. nessuna richiesta di rete verso host esterni durante la verifica", richiesteEsterne.length === 0, [...new Set(richiesteEsterne)].join(", "));
    if (fallimenti.length) {
      console.error(`\n${fallimenti.length} controlli dello script di collaudo B4 NON superati.`);
      process.exit(1);
    }
    console.log("\nTutti i controlli dello script di collaudo B4 sono superati.");
  });
