// Verifica a secco di scripts/password-utenti-sintetici-b3.mjs (password sintetiche della Preview): API di amministrazione FINTA, porta
// delle autorizzazioni finta, cartelle temporanee. Nessuna rete, nessuno staging, nessuna password vera.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const RADICE = path.resolve(__dirname, "..");
const fallimenti: string[] = [];
function atteso(nome: string, ok: boolean, dettaglio = "") {
  console.log(`${ok ? "ok    " : "FALLITO"} ${nome}${ok || !dettaglio ? "" : ` — ${dettaglio}`}`);
  if (!ok) fallimenti.push(nome);
}

const STAGING = "https://ryawdldqiumqsskrnyps.supabase.co";
const ID = {
  admin: "00000000-0000-4000-8000-0000000000a0",
  titolare: "00000000-0000-4000-8000-0000000000a1",
  titolare2: "00000000-0000-4000-8000-0000000000a2",
  altro: "00000000-0000-4000-8000-0000000000a9",
};

async function principale() {
  const pw = await import("./password-utenti-sintetici-b3.mjs");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "b3-password-"));
  const progetto = path.join(tmp, "progetto");
  fs.mkdirSync(path.join(progetto, "scripts"), { recursive: true });
  const variabiliValide = [`NEXT_PUBLIC_SUPABASE_URL=${STAGING}`, "NEXT_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_SINTETICA", "SUPABASE_SERVICE_ROLE_KEY=sb_secret_SINTETICA_DA_NON_STAMPARE"].join("\n");
  const fileFuori = path.join(tmp, "variabili.txt");
  fs.writeFileSync(fileFuori, variabiliValide);
  const fileDentro = path.join(progetto, "variabili.txt");
  fs.writeFileSync(fileDentro, variabiliValide);
  const fileProd = path.join(tmp, "variabili-prod.txt");
  fs.writeFileSync(fileProd, variabiliValide.replace("ryawdldqiumqsskrnyps", "bihfrzspqxsrzlbqqvqa"));
  const fileCredenziali = path.join(tmp, "casa", "OMNIA-credenziali-anteprima", "utenti-sintetici-preview.txt");
  const repo = path.join(tmp, "un-repository");
  fs.mkdirSync(path.join(repo, ".git"), { recursive: true });
  fs.mkdirSync(path.join(repo, "sotto"), { recursive: true });

  const json = { "Content-Type": "application/json" };
  let chiamate: { metodo: string; percorso: string; corpo: string }[] = [];
  let senzaTitolare2 = false;
  let fallisceSecondo = false;
  const fetchFinto = (async (url: string, init?: RequestInit) => {
    const u = new URL(String(url));
    const metodo = init?.method ?? "GET";
    chiamate.push({ metodo, percorso: u.pathname, corpo: String(init?.body ?? "") });
    if (u.origin !== STAGING) return new Response("{}", { status: 500, headers: json });
    if (metodo === "GET" && u.pathname === "/auth/v1/admin/users") {
      const users = [
        { id: ID.admin, email: "ti-admin@prova.test" },
        { id: ID.titolare, email: "ti-titolare@prova.test" },
        ...(senzaTitolare2 ? [] : [{ id: ID.titolare2, email: "TI-Titolare2@prova.test" }]),
        { id: ID.altro, email: "cliente.vero@esempio.it" },
      ];
      return new Response(JSON.stringify({ users, aud: "authenticated" }), { status: 200, headers: json });
    }
    if (metodo === "PUT" && u.pathname.startsWith("/auth/v1/admin/users/")) {
      if (fallisceSecondo && u.pathname.endsWith(ID.titolare2)) return new Response(JSON.stringify({ code: 422, msg: "finto" }), { status: 422, headers: json });
      return new Response(JSON.stringify({ id: u.pathname.split("/").pop(), email: "x@prova.test" }), { status: 200, headers: json });
    }
    return new Response("{}", { status: 404, headers: json });
  }) as unknown as typeof fetch;

  const portaOk = () => ({ id: "AUT-SINTETICA", uso: "U1" });
  let ristretti: string[] = [];
  const restringi = (f: string) => void ristretti.push(f);
  const base = (extra: Record<string, unknown> = {}) => ({ cartella: progetto, fetchFn: fetchFinto, restringi, controllaPorta: portaOk, ...extra });
  const corre = async (argv: string[], opzioni: Record<string, unknown>) => {
    const stampato: string[] = [];
    let fermato = "";
    let codice: number | null = null;
    try {
      codice = await pw.esegui(argv, {}, { ...opzioni, stampa: (r: string) => stampato.push(r) });
    } catch (e) {
      fermato = e instanceof Error ? e.message : String(e);
    }
    return { stampato, fermato, codice };
  };
  const passwordNelFile = () => (fs.existsSync(fileCredenziali) ? [...fs.readFileSync(fileCredenziali, "utf8").matchAll(/@prova\.test {2}(\S+) {2}\(/g)].map((m) => m[1]) : []);

  try {
    // la porta e la guardia, prima di qualunque rete
    for (const [nome, argv, opzioni] of [
      ["PW1. senza il lanciatore delle autorizzazioni (TI_REGISTRO assente) si ferma prima di qualunque rete", ["imposta", fileFuori, "--file", fileCredenziali], { cartella: progetto, fetchFn: fetchFinto, restringi }],
      ["PW2. la porta che nega ferma tutto, nessuna rete", ["imposta", fileFuori, "--file", fileCredenziali], base({ controllaPorta: () => { throw new Error("autorizzazione inesistente"); } })],
      ["PW3. file delle variabili dentro il progetto → fermo", ["imposta", fileDentro, "--file", fileCredenziali], base()],
      ["PW4. variabili di produzione → fermo, il messaggio non riporta valori", ["imposta", fileProd, "--file", fileCredenziali], base()],
      ["PW5. file delle credenziali dentro un repository git → fermo", ["imposta", fileFuori, "--file", path.join(repo, "sotto", "credenziali.txt")], base()],
      ["PW6. file delle credenziali dentro il progetto → fermo", ["imposta", fileFuori, "--file", path.join(progetto, "credenziali.txt")], base()],
      ["PW7. comando sconosciuto o «--scarta» con «imposta» → fermo", ["imposta", fileFuori, "--scarta"], base()],
    ] as [string, string[], Record<string, unknown>][]) {
      chiamate = [];
      const r = await corre(argv, opzioni);
      atteso(nome, r.fermato !== "" && chiamate.length === 0 && !/SINTETICA_DA_NON_STAMPARE|bihfrzspqxsrzlbqqvqa\.supabase/.test(r.fermato), r.fermato || "non si è fermato");
    }
    atteso("PW8. nessun file di credenziali creato dai fermi", !fs.existsSync(fileCredenziali) && !fs.existsSync(path.join(repo, "sotto", "credenziali.txt")) && !fs.existsSync(path.join(progetto, "credenziali.txt")));

    // un utente mancante: nessuna password cambiata
    chiamate = [];
    senzaTitolare2 = true;
    const mancante = await corre(["imposta", fileFuori, "--file", fileCredenziali], base());
    senzaTitolare2 = false;
    atteso("PW9. se manca uno dei due utenti: fermo, solo la lettura dell'elenco, nessun PUT", mancante.fermato.includes("ti-titolare2@prova.test") && chiamate.length === 1 && chiamate[0].metodo === "GET");

    // giro completo «imposta»
    chiamate = [];
    ristretti = [];
    const imposta = await corre(["imposta", fileFuori, "--file", fileCredenziali], base());
    const put = chiamate.filter((c) => c.metodo === "PUT");
    const corpi = put.map((c) => JSON.parse(c.corpo));
    const nuove = passwordNelFile();
    atteso("PW10. «imposta»: una lettura dell'elenco e un PUT per ciascuno dei DUE titolari di prova, mai per ti-admin né per altri utenti", imposta.codice === 0 && put.length === 2 && put[0].percorso.endsWith(ID.titolare) && put[1].percorso.endsWith(ID.titolare2) && !chiamate.some((c) => c.percorso.includes(ID.admin) || c.percorso.includes(ID.altro)), JSON.stringify(chiamate.map((c) => `${c.metodo} ${c.percorso}`)));
    atteso("PW11. ogni PUT porta SOLO la password: né email, né metadati, né ruoli", corpi.every((b) => JSON.stringify(Object.keys(b)) === '["password"]'));
    atteso("PW12. password nel file = password inviate, 24 caratteri, diverse tra loro", nuove.length === 2 && nuove[0] === corpi[0].password && nuove[1] === corpi[1].password && nuove.every((p) => p.length === 24) && nuove[0] !== nuove[1]);
    atteso("PW13. a schermo solo il percorso e gli id abbreviati: nessuna password, nessuna chiave, nessun id completo", imposta.stampato.some((r) => r.includes(fileCredenziali)) && imposta.stampato.some((r) => r.includes("00000000…")) && !imposta.stampato.some((r) => nuove.some((p) => r.includes(p)) || /sb_secret_|0000000000a1|0000000000a2/.test(r)));
    atteso("PW14. il file ha i permessi ristretti PRIMA di contenere password, e dice «attive» e come ruotarle", ristretti.length === 1 && ristretti[0] === fileCredenziali && fs.readFileSync(fileCredenziali, "utf8").includes("Stato: attive") && fs.readFileSync(fileCredenziali, "utf8").includes("ruota"));

    // «ruota»: altre password, stesso file
    chiamate = [];
    const ruota = await corre(["ruota", fileFuori, "--file", fileCredenziali], base());
    const ruotate = passwordNelFile();
    atteso("PW15. «ruota»: due password nuove e diverse dalle precedenti, nello stesso file, mai stampate", ruota.codice === 0 && ruotate.length === 2 && ruotate.every((p) => !nuove.includes(p)) && !ruota.stampato.some((r) => ruotate.some((p) => r.includes(p))));

    // secondo aggiornamento che fallisce: il file lo dice, nessuna password a schermo
    chiamate = [];
    fallisceSecondo = true;
    const parziale = await corre(["ruota", fileFuori, "--file", fileCredenziali], base());
    fallisceSecondo = false;
    const testoParziale = fs.readFileSync(fileCredenziali, "utf8");
    atteso("PW16. un aggiornamento fallito: fermo, il file segna «INCOMPLETO» e quale utente non è aggiornato, nessuna password a schermo", parziale.fermato.includes("incompleto") && testoParziale.includes("INCOMPLETO") && testoParziale.includes("NON aggiornata") && !parziale.stampato.some((r) => passwordNelFile().some((p) => r.includes(p))));

    // «ruota --scarta»: password casuali non salvate, file cancellato
    chiamate = [];
    const scarta = await corre(["ruota", fileFuori, "--scarta", "--file", fileCredenziali], base());
    atteso("PW17. «ruota --scarta»: due PUT con password che non si salvano da nessuna parte, file delle credenziali cancellato", scarta.codice === 0 && chiamate.filter((c) => c.metodo === "PUT").length === 2 && !fs.existsSync(fileCredenziali));
    const estraneo = path.join(tmp, "casa", "altro.txt");
    fs.writeFileSync(estraneo, "un file qualunque");
    await corre(["ruota", fileFuori, "--scarta", "--file", estraneo], base());
    atteso("PW18. «--scarta» non cancella un file che non è delle credenziali di questo strumento", fs.existsSync(estraneo));

    // generatore
    const campione = Array.from({ length: 2000 }, () => pw.generaPassword());
    atteso("PW19. password: 24 caratteri, sempre minuscola, maiuscola, cifra e simbolo, nessun doppione su 2.000", campione.every((p: string) => p.length === 24 && /[a-z]/.test(p) && /[A-Z]/.test(p) && /\d/.test(p) && /[-_.!]/.test(p)) && new Set(campione).size === campione.length);
    atteso("PW20. utenti dello strumento: SOLO i due titolari di prova", JSON.stringify(pw.UTENTI_SINTETICI) === JSON.stringify(["ti-titolare@prova.test", "ti-titolare2@prova.test"]));
    atteso("PW21. «dentroUnRepository» riconosce una cartella sotto un .git", pw.dentroUnRepository(path.join(repo, "sotto")) && !pw.dentroUnRepository(path.join(tmp, "casa")));
    const codice = fs.readFileSync(path.join(RADICE, "scripts/password-utenti-sintetici-b3.mjs"), "utf8");
    atteso(
      "PW22. lo script: porta prima della guardia, guardia prima del file, permessi prima dell'elenco degli utenti; l'unico aggiornamento è updateUserById con { password }",
      codice.indexOf("controllaPorta({ script: NOME_SCRIPT })") < codice.indexOf("erroriAmbiente(variabili)") &&
        codice.indexOf("erroriAmbiente(variabili)") < codice.indexOf("restringi(file)") &&
        codice.indexOf("restringi(file)") < codice.indexOf("admin.auth.admin.listUsers(") &&
        (codice.match(/admin\.auth\.admin\.\w+\(/g) ?? []).sort().join(",") === "admin.auth.admin.listUsers(,admin.auth.admin.updateUserById(" &&
        codice.includes("updateUserById(u.id, { password: u.password })") &&
        !/console\.log\([^)]*password/i.test(codice),
    );
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

principale()
  .catch((e) => atteso("prova eseguita", false, e instanceof Error ? e.message : String(e)))
  .finally(() => {
    if (fallimenti.length) {
      console.error(`\n${fallimenti.length} controlli delle password sintetiche NON superati.`);
      process.exit(1);
    }
    console.log("\nTutti i controlli delle password sintetiche sono superati.");
  });
