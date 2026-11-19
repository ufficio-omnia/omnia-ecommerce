// Prove di mutazione dei gradi 1-2 della fase B4 («Per te», profilo, Ufficio Gare, interruttori). Per ogni mutazione si altera UN punto dei
// sorgenti, si lancia scripts/verifica-radar-b4-ui.ts e la verifica DEVE fallire. Ogni file si ripristina SEMPRE dal buffer letto all'inizio
// (mai git checkout); prima di partire i file devono essere committati, alla fine si controlla che siano identici (sha256).
// Uso: node scripts/mutazioni-radar-b4-ui.mjs
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RADICE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const VERIFICA = "scripts/verifica-radar-b4-ui.ts";
const TSX = path.join(RADICE, "node_modules/tsx/dist/cli.mjs");
const F = {
  interruttori: "src/lib/radar/interruttori-b4.ts",
  profilo: "src/lib/radar/profilo-calcoli.ts",
  ricerca: "src/lib/radar/ricerca.ts",
  guardie: "src/lib/radar/guardie-opportunita.ts",
  azione: "src/app/actions/radar-profilo.ts",
  salvate: "src/lib/radar/salvate-calcoli.ts",
  account: "src/lib/omnia-ai-account-calcoli.ts",
  perTe: "src/app/site-omnia-ai/dashboard/omnia-ai/opportunita/per-te/page.tsx",
  layout: "src/app/site-omnia-ai/dashboard/omnia-ai/layout.tsx",
};

const MUTAZIONI = [
  { nome: "M1 interruttore acceso con qualunque valore", file: F.interruttori, cerca: 'return env[nome] === "attivo" && ambienteDb', con: "return !!env[nome] && ambienteDb" },
  { nome: "M2 interruttore valido anche fuori dallo staging", file: F.interruttori, cerca: ' && ambienteDb(env.NEXT_PUBLIC_SUPABASE_URL) === "staging";', con: ";" },
  { nome: "M3 pagine di Opportunità aperte all'Ufficio Gare a interruttore spento", file: F.guardie, cerca: "? richiediAccountPagina() : richiediTitolarePagina();", con: "? richiediAccountPagina() : richiediAccountPagina();" },
  { nome: "M4 azioni di Opportunità aperte all'Ufficio Gare a interruttore spento", file: F.guardie, cerca: "? richiediAccountAzione() : richiediTitolareAzione();", con: "? richiediAccountAzione() : richiediAccountAzione();" },
  { nome: "M5 gare senza luogo escluse da «Per te»", file: F.profilo, cerca: "},luogo_regioni.eq.{}`;", con: "}`;" },
  { nome: "M6 regioni rifiltrate in memoria (perde le gare senza luogo)", file: F.profilo, cerca: "return { ...p, regioni: [], procedure: [], importoMin: null, importoMax: null };", con: "return { ...p, procedure: [], importoMin: null, importoMax: null };" },
  { nome: "M7 regole del contratto non applicate", file: F.ricerca, cerca: "const primi = opportunita ? coerenti.filter((r) => opportunita.has(r.id)) : coerenti;", con: "const primi = coerenti;" },
  { nome: "M8 correlate mescolate alle pertinenti", file: F.ricerca, cerca: "const ordinati = opportunita ? pertinentiPrima(ordinatiTutti, opportunita) : ordinatiTutti;", con: "const ordinati = ordinatiTutti;" },
  { nome: "M9 settore fuori catalogo accettato", file: F.profilo, cerca: 'if (settoriTesto.some((s) => !eSettore(s))) return { ok: false, errore: "Settore non valido." };', con: "" },
  { nome: "M10 sottocategoria fuori catalogo tollerata", file: F.profilo, cerca: 'if (scartate.some((s) => s.motivo !== "settore_non_scelto")) return { ok: false, errore: "Sottocategoria non valida." };', con: "" },
  { nome: "M11 minimo oltre il massimo accettato", file: F.profilo, cerca: 'if (importoMin !== null && importoMax !== null && importoMin > importoMax) return { ok: false, errore: "L\'importo minimo supera il massimo." };', con: "" },
  { nome: "M12 profilo intestato all'autore invece che all'impresa", file: F.profilo, cerca: "    user_id: impresaId,\n    posizione: POSIZIONE_PROFILO,", con: "    user_id: autoreId,\n    posizione: POSIZIONE_PROFILO," },
  { nome: "M13 salvataggio del profilo senza interruttore", file: F.azione, cerca: "  if (!perTeAttivo(process.env)) return { errore: MESSAGGIO_RADAR_NON_DISPONIBILE };\n", con: "" },
  { nome: "M14 «Per te» calcolato senza classificazioni lette", file: F.ricerca, cerca: "const grezze = classificazioni ? (data ?? []).slice(0, CANDIDATI_MASSIMI) : [];", con: "const grezze = (data ?? []).slice(0, CANDIDATI_MASSIMI);" },
  { nome: "M15 ruoli di «salvata da» scambiati", file: F.salvate, cerca: 'return salvataDa === impresaId ? "salvata dal titolare" : "salvata dall\'Ufficio Gare";', con: 'return salvataDa === impresaId ? "salvata dall\'Ufficio Gare" : "salvata dal titolare";' },
  { nome: "M16 Opportunità sempre aperta all'Ufficio Gare nei percorsi", file: F.account, cerca: "opzioni.opportunita === true ? SEZIONI_UFFICIO_GARE_CON_RADAR", con: "true ? SEZIONI_UFFICIO_GARE_CON_RADAR" },
  { nome: "M17 righe di classificazione spente considerate attive", file: F.profilo, cerca: "attiva: x.attiva !== false }))", con: "attiva: true }))" },
  { nome: "M18 profilo di un'altra impresa accettato in lettura", file: F.profilo, cerca: "if (!r || r.user_id !== impresaId) return null;", con: "if (!r) return null;" },
  { nome: "M19 regioni non validate nella condizione", file: F.profilo, cerca: "const valide = regioni.filter(isRegione);", con: "const valide = [...regioni];" },
  { nome: "M20 «luogo non indicato» tolto dal perché", file: F.profilo, cerca: 'regioniGara.length === 0 ? "luogo non indicato dalla fonte" :', con: 'regioniGara.length === 0 ? "" :' },
  { nome: "M21 «Per te» contato come ricerca", file: F.perTe, cerca: 'contaUtilizziRadar(admin, contesto.accountId, "per_te"', con: 'contaUtilizziRadar(admin, contesto.accountId, "ricerca"' },
  { nome: "M22 «Per te» senza 404 a interruttore spento", file: F.perTe, cerca: "  if (!perTeAttivo(process.env)) notFound();\n", con: "" },
  { nome: "M23 menu dell'Ufficio Gare con lettura anche a interruttore spento", file: F.layout, cerca: "ufficioGareRadarAttivo(process.env) ? radarNelMenu(contesto.accountId) : Promise.resolve(false)", con: "radarNelMenu(contesto.accountId)" },
  { nome: "M24 importo negativo o non numerico accettato", file: F.profilo, cerca: "if (!/^\\d{1,13}(\\.\\d{1,2})?$/.test(t)) return undefined;", con: "" },
];

function impronta(testo) {
  return createHash("sha256").update(testo).digest("hex");
}

const coinvolti = [...new Set(MUTAZIONI.map((m) => m.file))];
const sporchi = spawnSync("git", ["-c", "core.autocrlf=false", "status", "--porcelain", "--", ...coinvolti, VERIFICA], { cwd: RADICE, encoding: "utf8" });
if (sporchi.status !== 0 || sporchi.stdout.trim()) {
  console.error("FERMO: i sorgenti o la verifica hanno modifiche non committate. Committare prima delle mutazioni.\n" + sporchi.stdout);
  process.exit(2);
}
const originali = new Map(coinvolti.map((f) => [f, fs.readFileSync(path.join(RADICE, f), "utf8")]));
const impronteIniziali = new Map([...originali].map(([f, t]) => [f, impronta(t)]));

const base = spawnSync(process.execPath, [TSX, VERIFICA], { cwd: RADICE, encoding: "utf8" });
if (base.status !== 0) {
  console.error("FERMO: la verifica fallisce già senza mutazioni.\n" + base.stdout.split("\n").filter((r) => r.startsWith("FALLITO")).join("\n"));
  process.exit(2);
}

let uccise = 0;
const sopravvissute = [];
for (const m of MUTAZIONI) {
  const originale = originali.get(m.file);
  const volte = originale.split(m.cerca).length - 1;
  if (volte !== 1) {
    console.log(`NON APPLICABILE ${m.nome} — il punto da mutare compare ${volte} volte`);
    sopravvissute.push(`${m.nome} (non applicabile)`);
    continue;
  }
  try {
    fs.writeFileSync(path.join(RADICE, m.file), originale.replace(m.cerca, m.con), "utf8");
    const esito = spawnSync(process.execPath, [TSX, VERIFICA], { cwd: RADICE, encoding: "utf8" });
    const falliti = (esito.stdout ?? "").split("\n").filter((r) => r.startsWith("FALLITO"));
    if (esito.status !== 0) {
      uccise++;
      console.log(`uccisa   ${m.nome} — ${falliti.length} controlli falliti (es. ${(falliti[0] ?? esito.stderr.split("\n")[0] ?? "").replace(/^FALLITO /, "").slice(0, 90)})`);
    } else {
      sopravvissute.push(m.nome);
      console.log(`SOPRAVVISSUTA ${m.nome}`);
    }
  } finally {
    fs.writeFileSync(path.join(RADICE, m.file), originale, "utf8");
  }
}

for (const [f, h] of impronteIniziali) {
  const ora = impronta(fs.readFileSync(path.join(RADICE, f), "utf8"));
  if (ora !== h) {
    console.error(`ATTENZIONE: ${f} non è tornato identico (${ora} ≠ ${h})`);
    process.exit(3);
  }
}
console.log(`\nMutazioni uccise: ${uccise}/${MUTAZIONI.length}. Sorgenti ripristinati e identici (sha256 verificato).`);
process.exit(sopravvissute.length ? 1 : 0);
