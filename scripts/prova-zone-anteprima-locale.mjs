// SOLO SUL RAMO D'ANTEPRIMA (mai in master). Prova di regressione delle zone in locale, nata dalla diagnosi delle 118 richieste del 18/11
// (con `next start -H 127.0.0.1` i riscritti di zona diventavano richieste HTTP esterne e la console andava in ciclo). FUORI dal livello 1:
// serve una build, quindi si esegue a mano tra le verifiche preliminari di ogni finestra di collaudo e prima del push della Preview.
//
//   node scripts/prova-zone-anteprima-locale.mjs prepara        → copia usa e getta del commit corrente (fuori dal progetto) + build con il
//                                                                 Supabase FINTO (qualche minuto)
//   node scripts/prova-zone-anteprima-locale.mjs prova [host]   → la prova; host di default = quello del lanciatore. Esce con 1 se fallisce
//   node scripts/prova-zone-anteprima-locale.mjs misura         → richieste a Supabase per pagina con una sessione FINTA, -H 127.0.0.1 e localhost
//   node scripts/prova-zone-anteprima-locale.mjs pulisci        → rimuove la copia
//
// MAI lo staging né la produzione: la copia è compilata con NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54399, un Supabase finto servito da
// questo script (risposte sintetiche, nessun dato vero); l'ambiente del server lo costruisce lo script da zero (nulla dal terminale). La
// guardia dell'anteprima è disattivata SOLO nella copia e SOLO con quell'indirizzo finto; il lanciatore non si usa perché la sua guardia
// interroga sempre lo staging. Il server parte con lo stesso comando del lanciatore (`next start -H <host>`), con l'osservatore di rete.
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServerClient } from "@supabase/ssr";

const CARTELLA = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const COPIA = path.join(os.tmpdir(), "omnia-prova-zone-anteprima");
const PORTA_FINTA = 54399;
const URL_FINTO = `http://127.0.0.1:${PORTA_FINTA}`;
const COOKIE_FINTO = "sb-127-auth-token"; // nome che @supabase/ssr ricava dall'indirizzo finto
const PORTA = 3130;
const FILE_APP = ["src", "next.config.ts", "package.json", "package-lock.json", "public"];
const PATCH_GUARDIA = `\n  // SOLO NELLA COPIA USA E GETTA di prova-zone-anteprima-locale.mjs (mai committata): guardia disattivata, Supabase finto locale.\n  if (env.RIPRODUZIONE_LOCALE_SENZA_STAGING === "1" && (env.NEXT_PUBLIC_SUPABASE_URL ?? "") === "${URL_FINTO}") return [];`;
const FIRMA_GUARDIA = "export function erroriAmbienteAnteprima(env: Record<string, string | undefined>): string[] {";

class Fermo extends Error {}
const git = (args, cwd = CARTELLA) => spawnSync("git", ["-c", "core.autocrlf=false", ...args], { cwd, encoding: "utf8" });
const dentro = (f, c) => path.resolve(f).toLowerCase().startsWith(path.resolve(c).toLowerCase() + path.sep);

/** L'ambiente del server di prova, costruito da zero: solo variabili di sistema e valori FINTI. */
function ambienteFinto(extra = {}) {
  const SISTEMA = ["PATH", "PATHEXT", "SYSTEMROOT", "WINDIR", "COMSPEC", "TEMP", "TMP", "HOME", "USERPROFILE", "APPDATA", "LOCALAPPDATA"];
  const base = Object.fromEntries(Object.entries(process.env).filter(([k]) => SISTEMA.includes(k.toUpperCase())));
  return {
    ...base,
    NODE_ENV: "production",
    VERCEL: "1",
    VERCEL_ENV: "preview",
    NEXT_PUBLIC_VERCEL_ENV: "preview",
    RIPRODUZIONE_LOCALE_SENZA_STAGING: "1",
    NEXT_PUBLIC_SUPABASE_URL: URL_FINTO,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "sb_publishable_FINTA_PROVA_ZONE",
    SUPABASE_SERVICE_ROLE_KEY: "sb_secret_FINTA_PROVA_ZONE_0123456789",
    CRON_SECRET: "segreto-finto-della-prova-zone-0123456789abcdef",
    ...extra,
  };
}

function hostDelLanciatore() {
  const testo = fs.readFileSync(path.join(CARTELLA, "scripts", "avvia-anteprima-locale.mjs"), "utf8");
  const m = testo.match(/"start",\s*"-H",\s*"([^"]+)"/);
  return m ? m[1] : "(nessun -H)";
}

// ───────────────────────────── prepara / pulisci ─────────────────────────────
function pulisci() {
  if (fs.existsSync(COPIA)) {
    git(["worktree", "remove", "--force", COPIA]);
    fs.rmSync(COPIA, { recursive: true, force: true });
  }
  git(["worktree", "prune"]);
  console.log(`Copia rimossa (${COPIA}).`);
}

function prepara() {
  if (dentro(COPIA, CARTELLA)) throw new Fermo("la copia deve stare fuori dal progetto");
  pulisci();
  const commit = git(["rev-parse", "HEAD"]).stdout.trim();
  const add = git(["worktree", "add", "--detach", COPIA, commit]);
  if (add.status !== 0) throw new Fermo(`copia non creata: ${add.stderr.trim()}`);
  console.log(`Copia usa e getta di ${commit.slice(0, 7)} in ${COPIA}; dipendenze in copia…`);
  const sorgente = path.join(CARTELLA, "node_modules");
  const destinazione = path.join(COPIA, "node_modules");
  const copia =
    process.platform === "win32"
      ? spawnSync("robocopy", [sorgente, destinazione, "/E", "/MT:16", "/NFL", "/NDL", "/NJH", "/NJS", "/NP", "/R:1", "/W:1"], { encoding: "utf8" })
      : spawnSync("cp", ["-a", sorgente, destinazione], { encoding: "utf8" });
  if (process.platform === "win32" ? (copia.status ?? 16) >= 8 : copia.status !== 0) throw new Fermo("dipendenze non copiate");
  const fileGuardia = path.join(COPIA, "src", "lib", "anteprima-guardia-ambiente.ts");
  const testo = fs.readFileSync(fileGuardia, "utf8");
  if (!testo.includes(FIRMA_GUARDIA)) throw new Fermo("guardia dell'anteprima cambiata: aggiornare la prova");
  fs.writeFileSync(fileGuardia, testo.replace(FIRMA_GUARDIA, FIRMA_GUARDIA + PATCH_GUARDIA));
  console.log("Guardia disattivata SOLO nella copia e SOLO con l'indirizzo finto. Build con il Supabase finto (next build, senza prebuild)…");
  const build = spawnSync(process.execPath, [path.join(COPIA, "node_modules", "next", "dist", "bin", "next"), "build"], { cwd: COPIA, env: ambienteFinto(), encoding: "utf8" });
  if (build.status !== 0 || !fs.existsSync(path.join(COPIA, ".next", "BUILD_ID"))) {
    console.error((build.stdout ?? "").split("\n").slice(-25).join("\n"));
    throw new Fermo("build della copia non riuscita");
  }
  fs.writeFileSync(path.join(COPIA, ".omnia-prova-zone.json"), JSON.stringify({ commit }));
  console.log(`Copia pronta (build di ${commit.slice(0, 7)} con ${URL_FINTO}).`);
}

function copiaAggiornata() {
  const segno = path.join(COPIA, ".omnia-prova-zone.json");
  if (!fs.existsSync(segno) || !fs.existsSync(path.join(COPIA, ".next", "BUILD_ID"))) throw new Fermo("copia assente: eseguire prima «prepara»");
  const { commit } = JSON.parse(fs.readFileSync(segno, "utf8"));
  const diff = git(["diff", "--quiet", commit, "HEAD", "--", ...FILE_APP]);
  if (diff.status !== 0) throw new Fermo(`l'app è cambiata dopo la build della copia (${commit.slice(0, 7)}): rifare «prepara»`);
  return commit;
}

// ───────────────────────────── Supabase finto ─────────────────────────────
/** Risposte sintetiche: un titolare con abbonamento attivo e Radar abilitato, amministratore per la console; ogni altra lettura vuota. */
function supabaseFinto() {
  const registro = [];
  const UTENTE = { id: "00000000-0000-4000-8000-0000000000f1", aud: "authenticated", role: "authenticated", email: "finto@prova.test", app_metadata: { provider: "email" }, user_metadata: {}, created_at: "2026-11-18T00:00:00Z" };
  const sessione = (accesso, scadenza) => ({ access_token: accesso, token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + scadenza, refresh_token: `finto-rinnovo-${Date.now()}`, user: UTENTE });
  const righe = (tabella, query) => {
    if (tabella === "users") return [{ id: UTENTE.id, role: "admin", email: UTENTE.email }];
    if (tabella === "console_impostazioni") return /radar_/.test(decodeURIComponent(query)) ? [{ chiave: "radar_attivo", valore: "1" }] : [];
    if (tabella === "omnia_ai_radar_impostazioni") return [{ attivo: true, limiti: null }];
    if (tabella === "subscriptions") return [{ status: "attivo", current_period_end: "2099-12-31T00:00:00Z" }];
    return [];
  };
  const server = http.createServer((req, res) => {
    const [percorso, query = ""] = (req.url ?? "").split("?");
    const auth = req.headers.authorization ?? "";
    const credenziale = auth === "Bearer finto-valido" ? "sessione valida" : auth === "Bearer finto-rifiutato" ? "sessione rifiutata" : "chiave";
    registro.push({ metodo: req.method, percorso, credenziale });
    let corpo = "";
    req.on("data", (d) => (corpo += d));
    req.on("end", () => {
      const json = (stato, dati, extra = {}) => {
        res.writeHead(stato, { "Content-Type": "application/json", ...extra });
        res.end(dati === undefined ? "" : JSON.stringify(dati));
      };
      if (percorso === "/auth/v1/user") return credenziale === "sessione valida" ? json(200, UTENTE) : json(403, { code: 403, error_code: "bad_jwt", msg: "token finto rifiutato" });
      if (percorso === "/auth/v1/token") return json(200, sessione("finto-valido", 3600));
      if (percorso === "/auth/v1/verify") {
        const hash = (JSON.parse(corpo || "{}").token_hash ?? "").toString();
        return json(200, hash === "rifiutato" ? sessione("finto-rifiutato", 3600) : hash === "scaduto" ? sessione("finto-rifiutato", -120) : sessione("finto-valido", 3600));
      }
      if (percorso === "/auth/v1/logout") return json(204);
      if (percorso.startsWith("/rest/v1/")) {
        if (req.method !== "GET" && req.method !== "HEAD") return json(201, []);
        const r = righe(percorso.slice("/rest/v1/".length), query);
        if ((req.headers.accept ?? "").includes("vnd.pgrst.object")) return r.length === 1 ? json(200, r[0]) : json(406, { code: "PGRST116", message: "finto: nessuna riga" });
        return json(200, r, { "Content-Range": `0-${Math.max(0, r.length - 1)}/${r.length}` });
      }
      return json(404, { message: "finto: percorso non previsto" });
    });
  });
  return {
    registro,
    avvia: () => new Promise((ok, ko) => server.once("error", ko).listen(PORTA_FINTA, "127.0.0.1", ok)),
    ferma: () =>
      new Promise((ok) => {
        if (!server.listening) return ok();
        server.close(() => ok());
        server.closeAllConnections?.();
      }),
  };
}

/** Un cookie di sessione FINTO prodotto dalla stessa libreria dell'app (@supabase/ssr, verifyOtp contro il Supabase finto). */
async function cookieDiSessioneFinto(tipo) {
  const impostati = [];
  const client = createServerClient(URL_FINTO, "sb_publishable_FINTA_PROVA_ZONE", { cookies: { getAll: () => [], setAll: (l) => void impostati.push(...l) } });
  const { error } = await client.auth.verifyOtp({ token_hash: tipo, type: "magiclink" });
  if (error) throw new Fermo(`sessione finta non creata (${error.code ?? error.status})`);
  return new Map(impostati.filter((c) => c.name.startsWith(COOKIE_FINTO)).map((c) => [c.name, c.value]));
}

// ───────────────────────────── server di prova ─────────────────────────────
const indirizzo = (host) => `http://${host.includes(":") ? `[${host}]` : host}:${PORTA}`;

function portaAperta(host) {
  return new Promise((ok) => {
    const s = net.connect({ host, port: PORTA });
    s.once("connect", () => {
      s.destroy();
      ok(true);
    });
    s.once("error", () => ok(false));
  });
}

async function avviaServer(host) {
  if ((await portaAperta("127.0.0.1")) || (await portaAperta("::1"))) throw new Fermo(`porta ${PORTA} già occupata`);
  const fileRete = path.join(os.tmpdir(), `omnia-prova-zone-rete-${process.pid}-${Date.now()}.log`);
  fs.writeFileSync(fileRete, "");
  const osservatore = `file:///${path.join(COPIA, "scripts", "osserva-rete-anteprima.mjs").replace(/\\/g, "/").replace(/^\/+/, "")}`;
  const figlio = spawn(process.execPath, [path.join(COPIA, "node_modules", "next", "dist", "bin", "next"), "start", "-H", host, "-p", String(PORTA)], {
    cwd: COPIA,
    env: ambienteFinto({ OSSERVA_RETE_FILE: fileRete, NODE_OPTIONS: `--import=${osservatore}` }),
    stdio: ["ignore", "pipe", "pipe"],
  });
  let uscita = "";
  figlio.stdout.on("data", (d) => (uscita += d));
  figlio.stderr.on("data", (d) => (uscita += d));
  const inizio = Date.now();
  while (!/Ready in/.test(uscita)) {
    if (figlio.exitCode !== null || Date.now() - inizio > 60_000) throw new Fermo(`server di prova non partito: ${uscita.split("\n").slice(-5).join(" | ")}`);
    await new Promise((r) => setTimeout(r, 200));
  }
  const ferma = async () => {
    if (figlio.exitCode === null) {
      if (process.platform === "win32") spawnSync("taskkill", ["/PID", String(figlio.pid), "/T", "/F"]);
      else figlio.kill("SIGTERM");
    }
    await new Promise((r) => setTimeout(r, 500));
    fs.rmSync(fileRete, { force: true });
  };
  const righeRete = () =>
    fs
      .readFileSync(fileRete, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((r) => {
        const [, , metodo, url] = r.split(" ");
        return { metodo, origine: new URL(url).origin, percorso: new URL(url).pathname };
      });
  return { ferma, righeRete };
}

const attendi = (ms) => new Promise((r) => setTimeout(r, ms));
function applicaCookie(barattolo, risposta) {
  for (const c of risposta.headers.getSetCookie()) {
    const [coppia, ...attributi] = c.split(";");
    const nome = coppia.slice(0, coppia.indexOf("="));
    const valore = coppia.slice(coppia.indexOf("=") + 1);
    if (attributi.some((a) => /^\s*max-age=0\s*$/i.test(a)) || valore === "") barattolo.delete(nome);
    else barattolo.set(nome, valore);
  }
}
const intestazioneCookie = (barattolo) => [...barattolo].map(([n, v]) => `${n}=${v}`).join("; ");

/** Una navigazione come quella di un browser: segue fino a maxSalti reindirizzamenti portando i cookie. */
async function naviga(base, percorso, barattolo, { maxSalti = 0, intestazioni = {} } = {}) {
  let url = new URL(percorso, base).toString();
  let risposta;
  let salti = 0;
  for (;;) {
    risposta = await fetch(url, { redirect: "manual", headers: { ...intestazioni, ...(barattolo.size ? { cookie: intestazioneCookie(barattolo) } : {}) } });
    await risposta.arrayBuffer();
    applicaCookie(barattolo, risposta);
    const destinazione = risposta.headers.get("location");
    if (risposta.status < 300 || risposta.status >= 400 || !destinazione || salti >= maxSalti) break;
    url = new URL(destinazione, url).toString();
    salti++;
  }
  return { stato: risposta.status, location: risposta.headers.get("location") ?? "", salti };
}

// ───────────────────────────── prova ─────────────────────────────
export const CONTROLLI = [
  { percorso: "/login?__zone=console", stato: 200 },
  { percorso: "/auth/conferma?token_hash=finto&__zone=console", stato: 200 },
  { percorso: "/login?__zone=omnia-ai", stato: 200 },
  { percorso: "/dashboard?__zone=omnia-ai", stato: 307, verso: "/login" },
];

async function prova(host) {
  const commit = copiaAggiornata();
  const finto = supabaseFinto();
  await finto.avvia();
  let server;
  const esiti = [];
  try {
    server = await avviaServer(host);
    const base = indirizzo(host);
    for (const c of CONTROLLI) {
      const prima = server.righeRete().length;
      const r = await naviga(base, c.percorso, new Map());
      await attendi(300);
      const nuove = server.righeRete().slice(prima);
      const interne = nuove.filter((x) => x.origine !== URL_FINTO).length;
      const destinazioneOk = !c.verso || new URL(r.location || "/", base).pathname === c.verso;
      esiti.push({ ...c, ottenuto: r.stato, interne, ok: r.stato === c.stato && destinazioneOk && interne === 0 });
    }
    const estranee = server.righeRete().filter((x) => x.origine !== URL_FINTO && !/^http:\/\/(localhost|127\.0\.0\.1|\[::1\]):\d+$/.test(x.origine));
    esiti.push({ percorso: "(tutta la prova) richieste fuori da localhost e dall'URL finto", stato: 0, ottenuto: estranee.length, interne: 0, ok: estranee.length === 0 });
  } finally {
    await server?.ferma();
    await finto.ferma();
  }
  console.log(`Prova delle zone su una copia di ${commit.slice(0, 7)}, server con -H ${host} (Supabase finto ${URL_FINTO}):`);
  for (const e of esiti) console.log(`${e.ok ? "ok    " : "FALLITO"} ${e.percorso} → ${e.percorso.startsWith("(") ? `${e.ottenuto} richieste` : `${e.ottenuto}${e.verso ? ` verso ${e.verso}` : ""}, richieste interne ${e.interne}`}`);
  const falliti = esiti.filter((e) => !e.ok).length;
  console.log(falliti ? `\n${falliti} controlli NON superati: i riscritti di zona non restano interni con -H ${host}.` : `\nTutti i controlli superati con -H ${host}.`);
  return falliti ? 1 : 0;
}

// ───────────────────────────── misura ─────────────────────────────
const PAGINE = [
  { nome: "console, home", percorso: "/?__zone=console", maxSalti: 5 },
  { nome: "console, conferma d'accesso", percorso: "/auth/conferma?token_hash=finto&__zone=console", maxSalti: 5 },
  { nome: "OMNIA AI, dashboard", percorso: "/dashboard/omnia-ai?__zone=omnia-ai", maxSalti: 5 },
  { nome: "Cerca", percorso: "/dashboard/omnia-ai/opportunita/cerca?__zone=omnia-ai", maxSalti: 5 },
  { nome: "scheda di una gara (id finto: «non trovata»)", percorso: "/dashboard/omnia-ai/opportunita/gara/00000000-0000-4000-8000-0000000000a1?__zone=omnia-ai", maxSalti: 5 },
  { nome: "Monitorate", percorso: "/dashboard/omnia-ai/opportunita/monitorate?__zone=omnia-ai", maxSalti: 5 },
  { nome: "prefetch RSC di Monitorate", percorso: "/dashboard/omnia-ai/opportunita/monitorate?__zone=omnia-ai", maxSalti: 0, intestazioni: { RSC: "1", "Next-Router-Prefetch": "1" } },
];

function riassumi(registro) {
  const conta = (f) => registro.filter(f).length;
  return {
    getUser: conta((x) => x.percorso === "/auth/v1/user"),
    rinnovi: conta((x) => x.percorso === "/auth/v1/token"),
    letture: conta((x) => x.percorso.startsWith("/rest/v1/") && (x.metodo === "GET" || x.metodo === "HEAD")),
    scritture: conta((x) => x.percorso.startsWith("/rest/v1/") && x.metodo !== "GET" && x.metodo !== "HEAD"),
  };
}

async function misura() {
  const commit = copiaAggiornata();
  const finto = supabaseFinto();
  await finto.avvia();
  const risultati = {};
  try {
    const sessioni = { valida: await cookieDiSessioneFinto("valido"), rifiutata: await cookieDiSessioneFinto("rifiutato"), scaduta: await cookieDiSessioneFinto("scaduto") };
    for (const host of ["127.0.0.1", "localhost"]) {
      const server = await avviaServer(host);
      const base = indirizzo(host);
      const misuraUna = async (sessione, pagina) => {
        const barattolo = new Map(sessioni[sessione]);
        const r0 = server.righeRete().length;
        finto.registro.length = 0;
        const r = await naviga(base, pagina.percorso, barattolo, { maxSalti: pagina.maxSalti, intestazioni: pagina.intestazioni });
        await attendi(400);
        const rete = server.righeRete().slice(r0);
        return { ...riassumi(finto.registro), versoFinto: rete.filter((x) => x.origine === URL_FINTO).length, interne: rete.filter((x) => x.origine !== URL_FINTO).length, salti: r.salti, stato: r.stato };
      };
      try {
        for (const p of PAGINE) risultati[`${p.nome}|${host}`] = await misuraUna("valida", p);
        risultati[`ciclo con sessione RIFIUTATA: 1 raffica (fino a 20 salti), link di conferma della console|${host}`] = await misuraUna("rifiutata", { percorso: "/auth/conferma?token_hash=finto&__zone=console", maxSalti: 20 });
        risultati[`sessione SCADUTA (rinnovo), console, home|${host}`] = await misuraUna("scaduta", { percorso: "/?__zone=console", maxSalti: 5 });
        risultati[`sessione SCADUTA (rinnovo), Cerca|${host}`] = await misuraUna("scaduta", { percorso: "/dashboard/omnia-ai/opportunita/cerca?__zone=omnia-ai", maxSalti: 5 });
      } finally {
        await server.ferma();
      }
    }
  } finally {
    await finto.ferma();
  }
  console.log(`Richieste al Supabase finto per pagina (copia di ${commit.slice(0, 7)}; sessione FINTA nel formato di @supabase/ssr). «verso l'URL finto» = osservatore di rete del server.`);
  console.log("pagina | host | esito (salti) | verso l'URL finto | getUser | rinnovi | letture | scritture | richieste interne");
  const nomi = [...new Set(Object.keys(risultati).map((k) => k.split("|")[0]))];
  for (const n of nomi)
    for (const host of ["127.0.0.1", "localhost"]) {
      const x = risultati[`${n}|${host}`];
      console.log(`${n} | ${host} | ${x.stato} (${x.salti}) | ${x.versoFinto} | ${x.getUser} | ${x.rinnovi} | ${x.letture} | ${x.scritture} | ${x.interne}`);
    }
  return 0;
}

// ───────────────────────────── avvio ─────────────────────────────
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [comando, argomento] = process.argv.slice(2);
  const esegui = async () => {
    if (comando === "prepara") {
      prepara();
      return 0;
    }
    if (comando === "pulisci") {
      pulisci();
      return 0;
    }
    if (comando === "prova") return prova(argomento ?? hostDelLanciatore());
    if (comando === "misura") return misura();
    throw new Fermo("comando: prepara | prova [host] | misura | pulisci");
  };
  esegui()
    .then((codice) => process.exit(codice))
    .catch((e) => {
      console.error(`PROVA DELLE ZONE FERMATA: ${e instanceof Error ? e.message : e}`);
      process.exit(2);
    });
}
