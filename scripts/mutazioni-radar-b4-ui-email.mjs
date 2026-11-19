// Prove di mutazione dei modelli delle email B4: per ogni mutazione si altera UN punto dei sorgenti, si lancia
// scripts/verifica-radar-b4-ui-email.ts e la verifica DEVE fallire. Il file originale si ripristina SEMPRE dal buffer letto all'inizio
// (mai git checkout); prima di partire i sorgenti devono essere già committati, e alla fine si controlla che siano identici.
// Uso: node scripts/mutazioni-radar-b4-ui-email.mjs
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RADICE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const COMPONI = "src/lib/radar/email-modelli/componi.ts";
const FORMATO = "src/lib/radar/email-modelli/formato.ts";
const VERIFICA = "scripts/verifica-radar-b4-ui-email.ts";
const TSX = path.join(RADICE, "node_modules/tsx/dist/cli.mjs");

const MUTAZIONI = [
  { nome: "M1 ora accettata senza controllo", file: FORMATO, cerca: 'return /^([01]\\d|2[0-3]):[0-5]\\d$/.test(String(ora ?? "")) ? String(ora) : null;', con: 'return ora ? String(ora) : null;' },
  { nome: "M2 ora presunta quando manca", file: FORMATO, cerca: "return ora ? `${giorno}, ore ${ora}` : `${giorno} · ${TESTO_ORA_NON_INDICATA}`;", con: "return `${giorno}, ore ${ora ?? \"23:\" + \"59\"}`;" },
  { nome: "M3 denominazione senza escape", file: COMPONI, cerca: 'campo("Gara", esc(riga(gara.oggetto) || "senza denominazione"))', con: 'campo("Gara", riga(gara.oggetto) || "senza denominazione")' },
  { nome: "M4 collegamenti di qualunque schema", file: FORMATO, cerca: "return /^https?:\\/\\/[^\\s<>\"'\\u0000-\\u001f]+$/i.test(u) ? u : null;", con: "return u || null;" },
  { nome: "M5 avvertenza tolta dall'HTML", file: COMPONI, cerca: '<strong style="color:${TESTO};">Avvertenza.</strong> ${esc(AVVERTENZA_EMAIL)}', con: '<strong style="color:${TESTO};">Avvertenza.</strong>' },
  { nome: "M6 nessun controllo dell'impresa", file: COMPONI, cerca: "destinatario.impresaId !== evento.impresaId", con: "false" },
  { nome: "M7 riepilogo senza tetto di 20", file: COMPONI, cerca: "    const mostrate = evento.gare.slice(0, MASSIMO_GARE_RIEPILOGO);\n    const altre = altreGare(evento);\n    return (", con: "    const mostrate = evento.gare;\n    const altre = altreGare(evento);\n    return (" },
  { nome: "M8 riga CIG anche senza CIG", file: COMPONI, cerca: 'if (cig.length) righe.push(campo(cig.length === 1 ? "CIG" : "CIG dei lotti", esc(cig.join(", "))));', con: 'righe.push(campo(cig.length === 1 ? "CIG" : "CIG dei lotti", esc(cig.join(", ") || "-")));' },
  { nome: "M9 rettifica senza dettaglio taciuta", file: COMPONI, cerca: "  const valide = modifiche.filter((m) => riga(m.campo));\n  if (!valide.length) {", con: "  const valide = modifiche.filter((m) => riga(m.campo));\n  if (false) {" },
  { nome: "M10 caratteri di controllo nell'oggetto", file: FORMATO, cerca: 'return String(testo ?? "").replace(/[\\u0000-\\u001f\\u007f]+/g, " ").replace(/\\s+/g, " ").trim();', con: 'return String(testo ?? "").trim();' },
  { nome: "M11 ogni modifica della scadenza detta «prorogata»", file: COMPONI, cerca: 'return dopo > prima ? "prorogata" : "anticipata";', con: 'return "prorogata";' },
  { nome: "M12 preferenze tolte dal testo semplice", file: COMPONI, cerca: "preferenze ? `Preferenze delle notifiche: ${preferenze}` :", con: "false ? `${preferenze}` :" },
  { nome: "M13 Ufficio Gare chiamato titolare", file: COMPONI, cerca: 'return destinatario.ruolo === "titolare"', con: 'return true' },
  { nome: "M14 avvertenza tolta dal testo semplice", file: COMPONI, cerca: "    `AVVERTENZA. ${AVVERTENZA_EMAIL}`,", con: "    `AVVERTENZA.`," },
  { nome: "M15 giorno della settimana nel fuso sbagliato", file: FORMATO, cerca: 'new Intl.DateTimeFormat("it-IT", { timeZone: "UTC", weekday: "long"', con: 'new Intl.DateTimeFormat("it-IT", { timeZone: "Pacific/Kiritimati", weekday: "long"' },
  { nome: "M16 «altre» del motore ignorate", file: COMPONI, cerca: "const fuori = Number.isInteger(evento.altre) && evento.altre > 0 ? evento.altre : 0;", con: "const fuori = 0;" },
];

function impronta(testo) {
  return createHash("sha256").update(testo).digest("hex");
}

const sporchi = spawnSync("git", ["-c", "core.autocrlf=false", "status", "--porcelain", "--", COMPONI, FORMATO, VERIFICA], { cwd: RADICE, encoding: "utf8" });
if (sporchi.status !== 0 || sporchi.stdout.trim()) {
  console.error("FERMO: i sorgenti dei modelli o la verifica hanno modifiche non committate. Committare prima delle mutazioni.\n" + sporchi.stdout);
  process.exit(2);
}

const originali = new Map([COMPONI, FORMATO].map((f) => [f, fs.readFileSync(path.join(RADICE, f), "utf8")]));
const impronteIniziali = new Map([...originali].map(([f, t]) => [f, impronta(t)]));

// controllo di partenza: senza mutazioni la verifica passa
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
