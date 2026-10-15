// Autotest della sicurezza dei due siti pubblici:
//   - la verifica anti-bot (Cloudflare Turnstile) sui moduli pubblici: logica di verifica con un Cloudflare
//     finto (gettone mancante, respinto, guasto del servizio, chiave sbagliata), collegamento in ogni azione
//     pubblica e in ogni modulo, nessuna chiave segreta nel codice del browser;
//   - le intestazioni di sicurezza dei siti pubblici e della console.
// Gratuito, nessuna rete: gira nel livello 1, quindi in prebuild.
import fs from "fs";
import path from "path";
import {
  CAMPO_TURNSTILE,
  LUNGHEZZA_MASSIMA_GETTONE,
  MESSAGGIO_VERIFICA_FALLITA,
  TIMEOUT_VERIFICA_MS,
  URL_VERIFICA_TURNSTILE,
  statoTurnstile,
  verificaGettoneTurnstile,
} from "../src/lib/turnstile-calcoli";

const fallimenti: string[] = [];
function atteso(nome: string, ok: boolean, dettaglio = "") {
  console.log(`${ok ? "ok    " : "FALLITO"} ${nome}${ok ? "" : ` — ${dettaglio}`}`);
  if (!ok) fallimenti.push(nome);
}
function uguale<T>(nome: string, ottenuto: T, previsto: T) {
  atteso(nome, JSON.stringify(ottenuto) === JSON.stringify(previsto), `ottenuto ${JSON.stringify(ottenuto)}, previsto ${JSON.stringify(previsto)}`);
}
const radice = path.join(__dirname, "..");
const leggi = (relativo: string) => fs.readFileSync(path.join(radice, relativo), "utf-8").replace(/\r\n/g, "\n");
const primaDi = (sorgente: string, a: string, b: string) => sorgente.indexOf(a) !== -1 && sorgente.indexOf(b) !== -1 && sorgente.indexOf(a) < sorgente.indexOf(b);

async function senzaRumore<T>(f: () => Promise<T>): Promise<T> {
  const originale = console.error;
  console.error = () => {};
  try {
    return await f();
  } finally {
    console.error = originale;
  }
}

// Un Cloudflare finto: registra le chiamate e risponde come gli si dice.
function cloudflareFinto(risposta: () => Promise<Response>) {
  const chiamate: { url: string; metodo: string | undefined; corpo: string }[] = [];
  const fetchFn = ((url: string, init?: RequestInit) => {
    chiamate.push({ url, metodo: init?.method, corpo: String(init?.body ?? "") });
    return risposta();
  }) as unknown as typeof fetch;
  return { fetchFn, chiamate };
}
const json = (corpo: unknown, stato = 200) => Promise.resolve(new Response(JSON.stringify(corpo), { status: stato }));

function* fileSotto(cartella: string): Generator<string> {
  for (const voce of fs.readdirSync(path.join(radice, cartella), { withFileTypes: true })) {
    const rel = `${cartella}/${voce.name}`;
    if (voce.isDirectory()) yield* fileSotto(rel);
    else yield rel;
  }
}

async function main() {
  console.log("--- Quando la verifica è attiva ---");
  uguale(
    "attiva solo con ENTRAMBE le chiavi; senza nessuna è spenta; con una sola è «incompleta» (e resta spenta)",
    [
      statoTurnstile({ chiaveSito: "1x", chiaveSegreta: "2x" }),
      statoTurnstile({ chiaveSito: undefined, chiaveSegreta: undefined }),
      statoTurnstile({ chiaveSito: "", chiaveSegreta: "  " }),
      statoTurnstile({ chiaveSito: "1x", chiaveSegreta: undefined }),
      statoTurnstile({ chiaveSito: undefined, chiaveSegreta: "2x" }),
    ],
    ["attiva", "spenta", "spenta", "incompleta", "incompleta"],
  );

  console.log("--- Verifica del gettone (Cloudflare finto) ---");
  // Valori fissati da Cloudflare: scritti qui in chiaro, non letti dalle costanti (un confronto con se stesse non scopre nulla).
  uguale("limiti e indirizzo di Cloudflare: gettone al massimo 2048 caratteri, verifica su challenges.cloudflare.com, 5 secondi di attesa", [LUNGHEZZA_MASSIMA_GETTONE, URL_VERIFICA_TURNSTILE, TIMEOUT_VERIFICA_MS], [2048, "https://challenges.cloudflare.com/turnstile/v0/siteverify", 5000]);
  const opzioni = (fetchFn: typeof fetch, extra: { ip?: string | null; timeoutMs?: number } = {}) => ({ chiaveSegreta: "segreta-di-prova", fetchFn, ...extra });

  const ok = cloudflareFinto(() => json({ success: true }));
  uguale("gettone valido: superata; chiamata POST all'indirizzo di Cloudflare con chiave segreta, gettone e indirizzo di chi scrive", [await verificaGettoneTurnstile("  gettone-1  ", opzioni(ok.fetchFn, { ip: "203.0.113.7" })), ok.chiamate.length, ok.chiamate[0]?.url, ok.chiamate[0]?.metodo, ok.chiamate[0]?.corpo], [
    { ok: true, motivo: "superata" },
    1,
    URL_VERIFICA_TURNSTILE,
    "POST",
    "secret=segreta-di-prova&response=gettone-1&remoteip=203.0.113.7",
  ]);
  const senzaIp = cloudflareFinto(() => json({ success: true }));
  await verificaGettoneTurnstile("g", opzioni(senzaIp.fetchFn));
  uguale("senza indirizzo non si manda «remoteip»", senzaIp.chiamate[0]?.corpo, "secret=segreta-di-prova&response=g");

  for (const [nome, gettone] of [["assente", undefined], ["nullo", null], ["vuoto", ""], ["solo spazi", "   "], ["non è testo", 123], ["è un file", new Blob(["x"])]] as const) {
    const f = cloudflareFinto(() => json({ success: true }));
    uguale(`gettone ${nome}: respinto senza nemmeno chiamare Cloudflare`, [await verificaGettoneTurnstile(gettone, opzioni(f.fetchFn)), f.chiamate.length], [{ ok: false, motivo: "gettone_mancante" }, 0]);
  }
  const lungo = cloudflareFinto(() => json({ success: true }));
  uguale("gettone più lungo di 2048 caratteri: respinto senza chiamare Cloudflare", [await verificaGettoneTurnstile("x".repeat(LUNGHEZZA_MASSIMA_GETTONE + 1), opzioni(lungo.fetchFn)), lungo.chiamate.length], [{ ok: false, motivo: "gettone_non_valido" }, 0]);
  const alLimite = cloudflareFinto(() => json({ success: true }));
  uguale("gettone di esattamente 2048 caratteri: si verifica", (await verificaGettoneTurnstile("x".repeat(LUNGHEZZA_MASSIMA_GETTONE), opzioni(alLimite.fetchFn))).ok, true);

  uguale("Cloudflare dice no (bot, gettone già usato, scaduto): respinta", [
    await verificaGettoneTurnstile("g", opzioni(cloudflareFinto(() => json({ success: false, "error-codes": ["invalid-input-response"] })).fetchFn)),
    await verificaGettoneTurnstile("g", opzioni(cloudflareFinto(() => json({ success: false, "error-codes": ["timeout-or-duplicate"] })).fetchFn)),
    await verificaGettoneTurnstile("g", opzioni(cloudflareFinto(() => json({ success: false })).fetchFn)),
  ], [{ ok: false, motivo: "respinta" }, { ok: false, motivo: "respinta" }, { ok: false, motivo: "respinta" }]);
  uguale("«success» che non è esattamente true non vale (stringa, numero)", [
    await verificaGettoneTurnstile("g", opzioni(cloudflareFinto(() => json({ success: "true" })).fetchFn)),
    await verificaGettoneTurnstile("g", opzioni(cloudflareFinto(() => json({ success: 1 })).fetchFn)),
  ], [{ ok: false, motivo: "respinta" }, { ok: false, motivo: "respinta" }]);

  uguale("chiave segreta sbagliata (errore di configurazione): NON si chiude fuori nessuno, si segnala nel registro", [
    await senzaRumore(() => verificaGettoneTurnstile("g", opzioni(cloudflareFinto(() => json({ success: false, "error-codes": ["invalid-input-secret"] })).fetchFn))),
    await senzaRumore(() => verificaGettoneTurnstile("g", opzioni(cloudflareFinto(() => json({ success: false, "error-codes": ["missing-input-secret"] })).fetchFn))),
  ], [{ ok: true, motivo: "chiave_segreta_non_valida" }, { ok: true, motivo: "chiave_segreta_non_valida" }]);
  const errori: string[] = [];
  const consoleOriginale = console.error;
  console.error = (...a: unknown[]) => errori.push(a.join(" "));
  await verificaGettoneTurnstile("g", opzioni(cloudflareFinto(() => json({ success: false, "error-codes": ["invalid-input-secret"] })).fetchFn));
  console.error = consoleOriginale;
  atteso("la chiave sbagliata lascia una riga nel registro del server che dice cosa correggere", errori.some((e) => /TURNSTILE_SECRET_KEY/.test(e)));

  uguale("Cloudflare non raggiungibile, in errore (500) o con risposta illeggibile: non si chiude fuori nessuno", [
    await senzaRumore(() => verificaGettoneTurnstile("g", opzioni((() => Promise.reject(new Error("rete caduta"))) as unknown as typeof fetch))),
    await senzaRumore(() => verificaGettoneTurnstile("g", opzioni(cloudflareFinto(() => json({}, 500)).fetchFn))),
    await senzaRumore(() => verificaGettoneTurnstile("g", opzioni(cloudflareFinto(() => Promise.resolve(new Response("non è json", { status: 200 }))).fetchFn))),
  ], [{ ok: true, motivo: "servizio_non_raggiungibile" }, { ok: true, motivo: "servizio_non_raggiungibile" }, { ok: true, motivo: "servizio_non_raggiungibile" }]);
  const lento = ((_url: string, init?: RequestInit) => new Promise<Response>((_risolvi, rifiuta) => init?.signal?.addEventListener("abort", () => rifiuta(new Error("interrotta"))))) as unknown as typeof fetch;
  const inizio = Date.now();
  // Un guasto che blocca per sempre non deve far «passare» il test in silenzio (un'attesa senza fine non dà errori):
  // si corre contro un limite di 1,5 secondi.
  const esitoLento = await Promise.race([
    senzaRumore(() => verificaGettoneTurnstile("g", opzioni(lento, { timeoutMs: 40 }))),
    new Promise<string>((risolvi) => setTimeout(() => risolvi("BLOCCATO: nessun tempo massimo"), 1500)),
  ]);
  uguale("Cloudflare che non risponde mai: dopo il tempo massimo si va avanti (qui 40 ms)", esitoLento, { ok: true, motivo: "servizio_non_raggiungibile" });
  atteso("e non si aspetta di più del tempo massimo", Date.now() - inizio < 1500, `${Date.now() - inizio} ms`);

  console.log("--- Azioni pubbliche ---");
  const tutteLeAzioni = [...fileSotto("src/app/actions")].filter((f) => f.endsWith(".ts"));
  let protette = 0;
  const scoperte: string[] = [];
  for (const file of tutteLeAzioni) {
    const sorgente = leggi(file);
    for (const pezzo of sorgente.split(/\nexport async function /).slice(1)) {
      const nome = pezzo.slice(0, pezzo.indexOf("("));
      if (!/\bsupabase\.auth\.(signInWithPassword|signInWithOtp|signUp|resetPasswordForEmail)\(/.test(pezzo)) continue;
      const posizioneChiamata = pezzo.search(/\bsupabase\.auth\.(signInWithPassword|signInWithOtp|signUp|resetPasswordForEmail)\(/);
      const posizioneVerifica = pezzo.indexOf("await verificaFormUmano(formData)");
      if (posizioneVerifica !== -1 && posizioneVerifica < posizioneChiamata && /if \(!verifica\.ok\) return \{ error: verifica\.errore \};/.test(pezzo)) protette++;
      else scoperte.push(`${file}:${nome}`);
    }
  }
  atteso("ogni azione che accede, registra o rimanda la password con il client pubblico verifica l'anti-bot PRIMA di chiamare Supabase", scoperte.length === 0 && protette === 5, `protette ${protette}, scoperte: ${scoperte.join(", ")}`);
  const demo = leggi("src/app/actions/omnia-ai-demo.ts");
  atteso("la richiesta demo verifica l'anti-bot dopo i controlli sui campi e PRIMA di mandare l'email", primaDi(demo, "Inserisci un indirizzo email valido", "await verificaFormUmano(formData)") && primaDi(demo, "await verificaFormUmano(formData)", "await sendEmail(") && /if \(!verifica\.ok\) return \{ error: verifica\.errore \};/.test(demo));
  for (const [file, funzione] of [["src/app/actions/auth.ts", "registerWithEmail"], ["src/app/actions/auth.ts", "loginWithPassword"], ["src/app/actions/auth.ts", "requestPasswordReset"], ["src/app/actions/omnia-ai-auth.ts", "loginOmniaAi"], ["src/app/actions/omnia-ai-auth.ts", "registerOmniaAi"]] as const) {
    const sorgente = leggi(file);
    const pezzo = sorgente.slice(sorgente.indexOf(`export async function ${funzione}`)).split(/\nexport async function /)[0];
    atteso(`${funzione}: la verifica viene dopo il controllo dei campi e prima del client Supabase`, primaDi(pezzo, "return { error: \"Inserisci", "await verificaFormUmano(formData)") && primaDi(pezzo, "await verificaFormUmano(formData)", "await createClient()"));
  }

  console.log("--- Moduli ---");
  const moduli: [string, "dark" | "light"][] = [
    ["src/components/omnia-ai/login-form.tsx", "dark"],
    ["src/app/site-omnia-ai/registrati/registrati-form.tsx", "dark"],
    ["src/components/omnia-ai/demo-form.tsx", "dark"],
    ["src/app/(ecommerce)/login/login-form.tsx", "light"],
    ["src/app/(ecommerce)/registrati/registrati-form.tsx", "light"],
    ["src/app/(ecommerce)/password-dimenticata/password-dimenticata-form.tsx", "light"],
  ];
  for (const [file, tema] of moduli) {
    const s = leggi(file);
    atteso(`${file.replace("src/app/", "").replace("src/", "")}: ha il riquadro anti-bot dentro il modulo, riparte dopo ogni invio, prima del pulsante`, /import TurnstileCampo from "@\/components\/turnstile-campo";/.test(s) && new RegExp(`<TurnstileCampo resetKey=\\{state\\} tema="${tema}" />`).test(s) && primaDi(s, "<TurnstileCampo", 'type="submit"') && primaDi(s, "<form", "<TurnstileCampo"));
  }

  console.log("--- Riquadro nel browser ---");
  const campo = leggi("src/components/turnstile-campo.tsx");
  atteso("senza la chiave pubblica non mostra e non carica niente", /if \(!chiaveSito\) return;/.test(campo) && /if \(!chiaveSito\) return null;/.test(campo));
  atteso("il campo nascosto ha il nome standard e il server legge lo stesso", new RegExp(`name="\\$\\{?CAMPO_TURNSTILE\\}?"|name=\\{CAMPO_TURNSTILE\\}`).test(campo) && CAMPO_TURNSTILE === "cf-turnstile-response" && /formData\.get\(CAMPO_TURNSTILE\)/.test(leggi("src/lib/turnstile.ts")));
  atteso("lo script si carica solo dal dominio di Cloudflare, una volta sola per pagina, in modo esplicito", /https:\/\/challenges\.cloudflare\.com\/turnstile\/v0\/api\.js\?render=explicit/.test(campo) && /if \(window\.turnstile\) return Promise\.resolve\(\);/.test(campo) && /if \(!window\.__caricamentoTurnstile\)/.test(campo) && (campo.match(/https?:\/\//g) ?? []).length === 1);
  atteso("quasi sempre invisibile, in italiano, con tema scelto dal modulo", /appearance: "interaction-only"/.test(campo) && /language: "it"/.test(campo) && /theme: tema/.test(campo));
  atteso("dopo ogni invio il gettone (già usato) si azzera e se ne chiede uno nuovo", /\[resetKey\]/.test(campo) && /window\.turnstile\.reset\(idRiquadro\.current\)/.test(campo) && /campo\.current\.value = ""/.test(campo));
  atteso("alla chiusura del modulo il riquadro si rimuove (nessun riquadro doppio)", /window\.turnstile\.remove\(idRiquadro\.current\)/.test(campo));

  console.log("--- Chiavi ---");
  const sorgentiClient = [...fileSotto("src")].filter((f) => /\.(tsx?|jsx?)$/.test(f)).filter((f) => /^\s*["']use client["']/.test(leggi(f)));
  atteso("la chiave SEGRETA non compare in nessun file del browser («use client»)", sorgentiClient.length > 20 && sorgentiClient.every((f) => !/TURNSTILE_SECRET_KEY/.test(leggi(f))), sorgentiClient.find((f) => /TURNSTILE_SECRET_KEY/.test(leggi(f))));
  atteso("la chiave segreta non ha il prefisso NEXT_PUBLIC (che la manderebbe al browser)", ![...fileSotto("src"), ...fileSotto("scripts")].some((f) => /NEXT_PUBLIC_TURNSTILE_SECRET|NEXT_PUBLIC_TURNSTILE_SECRET_KEY/.test(leggi(f)) && !f.endsWith("verifica-antibot-omnia-ai.ts")));
  const lato = leggi("src/lib/turnstile.ts");
  atteso("lato server: con la verifica non attiva non si chiede nulla; attiva, si usa la chiave segreta e l'indirizzo di chi scrive", /!== "attiva" \|\| !chiaveSegreta\) return \{ ok: true \}/.test(lato) && /x-forwarded-for/.test(lato) && /\{ ok: false, errore: MESSAGGIO_VERIFICA_FALLITA \}/.test(lato) && MESSAGGIO_VERIFICA_FALLITA.length > 20);
  const esempio = leggi(".env.example");
  atteso(".env.example elenca le due variabili (vuote)", /^NEXT_PUBLIC_TURNSTILE_SITE_KEY=\s*$/m.test(esempio) && /^TURNSTILE_SECRET_KEY=\s*$/m.test(esempio));
  const stato = leggi("src/lib/console/stato-sistema.ts");
  atteso("la console mostra se la verifica anti-bot è attiva, incompleta o spenta", /voce: "Verifica anti-bot \(Turnstile\)"/.test(stato) && /statoTurnstile\(\{ chiaveSito: process\.env\.NEXT_PUBLIC_TURNSTILE_SITE_KEY, chiaveSegreta: process\.env\.TURNSTILE_SECRET_KEY \}\)/.test(stato) && /antibot === "incompleta"/.test(stato));
  atteso("i moduli pubblici non rimandano alla console", ![...moduli.map((m) => m[0]), "src/components/turnstile-campo.tsx", "src/lib/turnstile.ts", "src/lib/turnstile-calcoli.ts"].some((f) => /console\.omniaitalia\.com|CONSOLE_BASE_URL|site-console|lib\/console/.test(leggi(f))));

  console.log("--- Intestazioni di sicurezza ---");
  const config = leggi("next.config.ts");
  const regole = [...config.matchAll(/\{\s*source: "\/:path\*",\s*(has: \[[^\]]*\],\s*)?headers: \[([\s\S]*?)\],\s*\}/g)].map((m) => ({ perHost: Boolean(m[1]), intestazioni: [...m[2].matchAll(/key: "([^"]+)", value: "([^"]+)"/g)].map((x) => [x[1], x[2]]) }));
  atteso("due regole di intestazioni: una per tutti gli host e, DOPO, quella della console (la documentazione di Next: se due regole impostano la stessa intestazione vince l'ultima)", regole.length === 2 && !regole[0].perHost && regole[1].perHost && /has: \[\{ type: "host", value: "console\.omniaitalia\.com" \}\]/.test(config));
  uguale("siti pubblici: anti-incorniciamento (SAMEORIGIN), nessuno sniffing dei tipi, indirizzo ridotto ai siti esterni", regole[0]?.intestazioni, [["X-Frame-Options", "SAMEORIGIN"], ["X-Content-Type-Options", "nosniff"], ["Referrer-Policy", "strict-origin-when-cross-origin"]]);
  uguale("console: invariata e più severa (non indicizzabile, mai incorniciata, nessun referrer)", regole[1]?.intestazioni, [["X-Robots-Tag", "noindex, nofollow, noarchive, nosnippet"], ["X-Frame-Options", "DENY"], ["Referrer-Policy", "no-referrer"], ["X-Content-Type-Options", "nosniff"]]);
  atteso("nessuna intestazione di indicizzazione sui siti pubblici (non devono sparire dai motori di ricerca)", !regole[0]?.intestazioni.some(([k]) => /robots/i.test(k)));

  console.log("");
  if (fallimenti.length > 0) {
    console.error(`${fallimenti.length} controlli falliti:\n - ${fallimenti.join("\n - ")}`);
    process.exit(1);
  }
  console.log("Tutti i controlli sono andati a buon fine.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
