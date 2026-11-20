// PROVA DELLA SOLA MIGRAZIONE 0125 (dossier Z4, documento 44, 20/11/2026) SU UN POSTGRES ISOLATO. Docker autorizzato dall'utente SOLO per
// prove su un PostgreSQL isolato: immagine postgres:17.11 già sul disco, contenitore temporaneo --rm con nome proprio, --network none, nessuna
// porta, nessun volume, password casuale mai salvata. Mai rmi, volume rm o prune; mai il Supabase locale; nessun database reale.
//
// Le migrazioni si leggono dal COMMIT DEDICATO (git show), cioè esattamente ciò che si applicherebbe allo staging dopo Z2: l'insieme del Radar
// fino alla 0122, la 0124 (SENZA la 0123, che non esiste in quel commit), 5 righe sintetiche delle preferenze (come le 5 rimaste sullo staging
// dopo Z3), una fotografia di oggetti, righe e preferenze, poi la 0125 DUE volte (idempotenza), poi i controlli di 60_prova_b4_0125.sql e di
// 55_prova_o2.sql (O2).
// Uso: node scripts/prova-isolata/esegui-prova-isolata-b4-0125.mjs postgres:17.11 [commit, di base il ramo migrazione/tender-intelligence-0125]
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const QUI = path.dirname(fileURLToPath(import.meta.url));
const RADICE = path.join(QUI, "..", "..");
const immagine = process.argv[2];
const commit = process.argv[3] ?? "migrazione/tender-intelligence-0125";
if (immagine !== "postgres:17.11") {
  console.error("Uso: node scripts/prova-isolata/esegui-prova-isolata-b4-0125.mjs postgres:17.11 [commit] (solo l'immagine già sul disco)");
  process.exit(2);
}
const git = (...a) => spawnSync("git", ["-c", "core.autocrlf=false", ...a], { cwd: RADICE, encoding: "utf8", maxBuffer: 20 * 1024 * 1024 });
const id = git("rev-parse", commit).stdout.trim();
if (!/^[0-9a-f]{40}$/.test(id)) {
  console.error(`Commit non trovato: ${commit}`);
  process.exit(2);
}
const elenco = git("ls-tree", "--name-only", id, "supabase/migrations/").stdout.split("\n").filter(Boolean);
if (elenco.some((f) => path.basename(f).startsWith("0123_"))) {
  console.error(`FERMO: il commit ${id} contiene la 0123: non è l'albero dello staging dopo Z2 più la sola 0125`);
  process.exit(2);
}
const dalCommit = (v) => {
  const f = elenco.find((n) => path.basename(n).startsWith(`${v}_`));
  if (!f) throw new Error(`migrazione ${v} assente dal commit ${id}`);
  const r = git("show", `${id}:${f}`);
  if (r.status !== 0) throw new Error(`lettura di ${f} non riuscita`);
  return { etichetta: `${v} (dal commit)`, testo: r.stdout };
};
const daFile = (etichetta, nome) => ({ etichetta, testo: fs.readFileSync(path.join(QUI, nome), "utf8") });
const T1 = "11111111-1111-4111-8111-111111111111", T2 = "22222222-2222-4222-8222-222222222222", M1 = "33333333-3333-4333-8333-333333333333";
const passi = [
  daFile("prerequisiti minimi", "00_prerequisiti.sql"),
  ...["0109", "0110", "0111", "0112", "0113", "0114", "0115", "0116", "0117", "0120", "0121"].map(dalCommit),
  daFile("prerequisiti B4 (auth, Ufficio Gare)", "30_prerequisiti_b4.sql"),
  daFile("dati sintetici B4", "35_dati_b4.sql"),
  dalCommit("0122"),
  dalCommit("0124"),
  {
    etichetta: "5 righe sintetiche delle preferenze (come lo staging dopo Z3)",
    testo: `insert into public.omnia_ai_radar_notifiche_impresa (impresa_id, email_attive) values ('${T1}', true), ('${T2}', false);
insert into public.omnia_ai_radar_notifiche_persone (impresa_id, user_id, nuove_opportunita, scadenze, rettifiche) values ('${T1}', '${T1}', true, true, true), ('${T1}', '${M1}', false, true, false), ('${T2}', '${T2}', false, false, false);`,
  },
  {
    etichetta: "fotografia di oggetti, righe e preferenze prima della 0125",
    testo: `create table prova.oggetti_prima_0125 as select * from prova.oggetti_ora();
create or replace function prova.righe() returns table (tabella text, n bigint) language plpgsql as $f$
declare r record;
begin
  for r in select c.relname from pg_class c join pg_namespace s on s.oid = c.relnamespace where s.nspname = 'public' and c.relkind = 'r' order by 1 loop
    tabella := r.relname;
    execute format('select count(*) from public.%I', r.relname) into n;
    return next;
  end loop;
end $f$;
create table prova.righe_prima_0125 as select * from prova.righe();
create table prova.preferenze_prima_0125 as
  select md5(coalesce((select string_agg(t::text, '|' order by t::text) from public.omnia_ai_radar_notifiche_impresa t), '') || '#' ||
             coalesce((select string_agg(t::text, '|' order by t::text) from public.omnia_ai_radar_notifiche_persone t), '')) as impronta;`,
  },
  dalCommit("0125"),
  { ...dalCommit("0125"), etichetta: "0125 di nuovo (idempotenza)" },
  daFile("controlli della 0125", "60_prova_b4_0125.sql"),
  daFile("controlli O2", "55_prova_o2.sql"),
];
const nome = `omnia-prova-b4-0125-${randomBytes(4).toString("hex")}`;
const docker = (args, input) => spawnSync("docker", args, { encoding: "utf8", input, maxBuffer: 50 * 1024 * 1024 });
const avvio = docker(["run", "--rm", "-d", "--name", nome, "--network", "none", "-e", `POSTGRES_PASSWORD=${randomBytes(18).toString("hex")}`, immagine]);
if (avvio.status !== 0) {
  console.error(`Contenitore non avviato: ${avvio.stderr.trim()}`);
  process.exit(2);
}
console.log(`Commit provato: ${id} (${elenco.length} migrazioni nell'albero; nessuna 0123)`);
let codice = 0;
let ok = 0;
try {
  let pronto = false;
  for (let i = 0; i < 60 && !pronto; i++) {
    pronto = docker(["exec", nome, "pg_isready", "-U", "postgres", "-q"]).status === 0 && docker(["exec", nome, "psql", "-U", "postgres", "-tAc", "select 1"]).stdout.trim() === "1";
    if (!pronto) spawnSync(process.execPath, ["-e", "setTimeout(() => {}, 1000)"]);
  }
  if (!pronto) throw new Error("Postgres non è pronto");
  console.log(`Contenitore ${nome}: ${docker(["exec", nome, "psql", "-U", "postgres", "-tAc", "select version()"]).stdout.trim().slice(0, 60)}`);
  for (const { etichetta, testo } of passi) {
    const r = docker(["exec", "-i", nome, "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-q", "-f", "-"], testo);
    const righe = `${r.stdout}\n${r.stderr}`.split("\n").map((x) => x.replace(/^psql:[^:]*:\d+:\s*/, "").replace(/^(NOTICE|AVVISO):\s*/, "")).filter((x) => /^(ok|FALLITO|piano)\s/.test(x) || /ERROR|ERRORE/.test(x));
    for (const x of righe) {
      console.log(`  ${x}`);
      if (/^ok\s/.test(x)) ok++;
    }
    if (r.status !== 0) {
      console.log(`FALLITO ${etichetta}: psql ha chiuso con codice ${r.status}`);
      codice = 1;
      break;
    }
    console.log(`passo superato: ${etichetta}`);
  }
} catch (e) {
  console.log(`FALLITO: ${e instanceof Error ? e.message : String(e)}`);
  codice = 1;
} finally {
  docker(["stop", nome]);
}
console.log(codice === 0 ? `Prova isolata della 0125: TUTTO SUPERATO (${ok} controlli ok)` : `Prova isolata della 0125: FALLITA (${ok} controlli ok prima dell'errore)`);
process.exit(codice);
