// PROVA DELLA 0138 (fonte «empulia») E DELLA 0139 (fonte «siaps») SU UN POSTGRES ISOLATO (Fase 2, B2, 27/11/2026). Autorizzata dal
// coordinamento il 27/11 (regola del 23/11: Docker solo per un Postgres usa e getta, poi spento). Immagine postgres:17.11 già sul disco,
// contenitore --rm con nome proprio, --network none, nessuna porta, nessun volume, password casuale mai salvata; nessun dato reale, nessun
// collegamento a staging o produzione. Mai rmi, volume rm o prune.
// Il vincolo di partenza si costruisce come nella storia vera: tabelle ridotte della 0128 (vincolo sulle fonti e sull'esito) e della 0109
// (radar_fonti_stato), poi le migrazioni VERE 0134, 0135 e 0137 lette dal commit; 0138 e 0139 dal commit. Casi, ognuno in un database a parte:
//   A. come lo staging di oggi (0134, 0135, 0137 applicate), con righe del registro per ogni fonte: la 0138 riesce, il vincolo ha i valori di
//      prima più «empulia», il vincolo sull'esito è intatto, la riga è spenta/nascosta/2099; la riesecuzione non cambia nulla; poi la 0139:
//      «empulia» conservato più «siaps»; riesecuzione senza cambiamenti; un valore inventato rifiutato;
//   B. ordine inverso (0139 poi 0138, senza la 0137): entrambe riescono e i valori si sommano; POI la 0137 (elenco scritto a mano) li toglie:
//      prova dell'avvertenza «0137 prima di 0138 e 0139»;
//   C. nessun vincolo sulle fonti: la 0138 FALLISCE, la transazione si annulla (nessuna riga in radar_fonti_stato);
//   D. un valore in più già ammesso (ipotetico «altra_fonte»): la 0138 lo CONSERVA.
// Uso: node scripts/prova-isolata/esegui-prova-0138-0139.mjs postgres:17.11 [commit]
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const QUI = path.dirname(fileURLToPath(import.meta.url));
const RADICE = path.join(QUI, "..", "..");
const immagine = process.argv[2];
const commit = process.argv[3] ?? "HEAD";
if (immagine !== "postgres:17.11") {
  console.error("Uso: node scripts/prova-isolata/esegui-prova-0138-0139.mjs postgres:17.11 [commit] (solo l'immagine già sul disco)");
  process.exit(2);
}
const git = (...a) => spawnSync("git", ["-c", "core.autocrlf=false", ...a], { cwd: RADICE, encoding: "utf8", maxBuffer: 20 * 1024 * 1024 });
const id = git("rev-parse", commit).stdout.trim();
const migrazione = (f) => git("show", `${id}:supabase/migrations/${f}`).stdout;
const M = { m0134: migrazione("0134_radar_fonte_sater.sql"), m0135: migrazione("0135_radar_fonte_tuttogare.sql"), m0137: migrazione("0137_radar_fonte_start.sql"), m0138: migrazione("0138_radar_fonte_empulia.sql"), m0139: migrazione("0139_radar_fonte_siaps.sql") };
if (!/^[0-9a-f]{40}$/.test(id) || Object.values(M).some((x) => !x)) {
  console.error(`migrazioni non trovate nel commit ${commit}`);
  process.exit(2);
}
// tabelle ridotte: le colonne e i vincoli che le migrazioni toccano, come nella 0128 e nella 0109
const tabelle = (valori = "'ted', 'pvl', 'sintel', 'sardegnacat'") => `
create table public.radar_esecuzioni (
  id serial primary key,
  fonte text not null ${valori === null ? "" : `check (fonte in (${valori}))`},
  esito text not null check (esito in ('ok', 'errore', 'sospesa', 'occupata', 'inerte', 'gia_eseguito'))
);
create table public.radar_fonti_stato (
  fonte text primary key check (fonte ~ '^[a-z0-9_]{2,40}$'),
  attiva boolean not null default false,
  nascosta_ai_clienti boolean not null default false,
  blocco_fino_a timestamptz
);
`;

const docker = (args, input) => spawnSync("docker", args, { encoding: "utf8", input, maxBuffer: 20 * 1024 * 1024 });
const nome = `prova-0138-${randomBytes(4).toString("hex")}`;
const avvio = docker(["run", "--rm", "-d", "--name", nome, "--network", "none", "-e", `POSTGRES_PASSWORD=${randomBytes(18).toString("hex")}`, immagine]);
if (avvio.status !== 0) {
  console.error(`avvio del contenitore non riuscito: ${(avvio.stderr ?? "").slice(0, 400)}`);
  process.exit(1);
}
const psql = (db, sql) => docker(["exec", "-i", nome, "psql", "-U", "postgres", "-d", db, "-v", "ON_ERROR_STOP=1", "-q", "-tA", "-f", "-"], sql);
const valore = (db, sql) => psql(db, sql).stdout.trim();
const esiti = [];
const controlla = (n, ok, dettaglio) => esiti.push({ nome: n, ok: !!ok, dettaglio });
const fonti = (db) => valore(db, "select pg_get_constraintdef(oid) from pg_constraint where conrelid = 'public.radar_esecuzioni'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%sardegnacat%';");
const vincoli = (db) => valore(db, "select string_agg(oid::text || ':' || conname || ':' || pg_get_constraintdef(oid), ' | ' order by conname) from pg_constraint where conrelid = 'public.radar_esecuzioni'::regclass and contype = 'c';");
const riga = (db, f) => valore(db, `select fonte || '|' || attiva || '|' || nascosta_ai_clienti || '|' || to_char(blocco_fino_a at time zone 'UTC', 'YYYY-MM-DD') from public.radar_fonti_stato where fonte = '${f}';`);
const valori = (def) => [...def.matchAll(/'([a-z0-9_]+)'::text/g)].map((m) => m[1]);
const ESITO = "CHECK ((esito = ANY (ARRAY['ok'::text, 'errore'::text, 'sospesa'::text, 'occupata'::text, 'inerte'::text, 'gia_eseguito'::text])))";

let codice = 0;
try {
  let pronto = false;
  for (let i = 0; i < 60 && !pronto; i++) {
    pronto = docker(["exec", nome, "pg_isready", "-U", "postgres", "-q"]).status === 0 && docker(["exec", nome, "psql", "-U", "postgres", "-tAc", "select 1"]).stdout.trim() === "1";
    if (!pronto) spawnSync(process.execPath, ["-e", "setTimeout(() => {}, 1000)"]);
  }
  console.log(`Contenitore ${nome}: ${valore("postgres", "select version();").slice(0, 60)}; migrazioni dal commit ${id.slice(0, 7)}`);
  for (const db of ["caso_a", "caso_b", "caso_c", "caso_d"]) psql("postgres", `create database ${db};`);

  // ── A: come lo staging di oggi
  const prep = psql("caso_a", `${tabelle()}${M.m0134}${M.m0135}${M.m0137}\ninsert into public.radar_esecuzioni (fonte, esito) select f, 'ok' from unnest(array['ted','pvl','sintel','sardegnacat','sater','tuttogare','start']) f;`);
  const oggi = valori(fonti("caso_a"));
  controlla("A0. preparazione come lo staging: 0134, 0135, 0137 vere; vincolo con le 7 fonti; 7 righe del registro", prep.status === 0 && JSON.stringify(oggi) === JSON.stringify(["ted", "pvl", "sintel", "sardegnacat", "sater", "tuttogare", "start"]), { err: prep.stderr, oggi });
  const a1 = psql("caso_a", M.m0138);
  const dopo8 = valori(fonti("caso_a"));
  controlla("A1. la 0138 riesce: le 7 fonti di prima più «empulia», nello stesso ordine", a1.status === 0 && JSON.stringify(dopo8) === JSON.stringify([...oggi, "empulia"]), { err: a1.stderr, dopo8 });
  controlla("A2. riga «empulia» spenta, nascosta, semaforo 2099; vincolo sull'esito intatto; le 7 righe del registro restano", riga("caso_a", "empulia") === "empulia|false|true|2099-01-01" && vincoli("caso_a").includes(ESITO) && valore("caso_a", "select count(*) from public.radar_esecuzioni;") === "7", { riga: riga("caso_a", "empulia") });
  const prima = vincoli("caso_a");
  const a3 = psql("caso_a", M.m0138);
  controlla("A3. riesecuzione della 0138: riesce e non cambia nulla (stessi vincoli e oid)", a3.status === 0 && vincoli("caso_a") === prima, a3.stderr);
  const a4 = psql("caso_a", M.m0139);
  const dopo9 = valori(fonti("caso_a"));
  controlla("A4. poi la 0139: «empulia» conservato più «siaps»; riga «siaps» spenta, nascosta, 2099", a4.status === 0 && JSON.stringify(dopo9) === JSON.stringify([...oggi, "empulia", "siaps"]) && riga("caso_a", "siaps") === "siaps|false|true|2099-01-01", { err: a4.stderr, dopo9 });
  const prima9 = vincoli("caso_a");
  const a5 = psql("caso_a", `${M.m0139}${M.m0138}`);
  controlla("A5. riesecuzione di entrambe: nessun cambiamento", a5.status === 0 && vincoli("caso_a") === prima9, a5.stderr);
  const nuove = psql("caso_a", "insert into public.radar_esecuzioni (fonte, esito) values ('empulia', 'ok'), ('siaps', 'inerte');");
  const inventata = psql("caso_a", "insert into public.radar_esecuzioni (fonte, esito) values ('inventata', 'ok');");
  controlla("A6. le righe delle fonti nuove si scrivono; una fonte inventata no", nuove.status === 0 && inventata.status !== 0 && /check constraint/i.test(inventata.stderr ?? ""), { nuove: nuove.stderr, inventata: (inventata.stderr ?? "").slice(0, 160) });

  // ── B: ordine inverso, poi la 0137 scritta a mano
  psql("caso_b", `${tabelle()}${M.m0134}${M.m0135}`);
  const b1 = psql("caso_b", `${M.m0139}${M.m0138}`);
  const bv = valori(fonti("caso_b"));
  controlla("B1. ordine inverso (0139 poi 0138, senza la 0137): entrambe riescono, i valori si sommano", b1.status === 0 && JSON.stringify(bv) === JSON.stringify(["ted", "pvl", "sintel", "sardegnacat", "sater", "tuttogare", "siaps", "empulia"]), { err: b1.stderr, bv });
  const b2 = psql("caso_b", M.m0137);
  const bv2 = valori(fonti("caso_b"));
  controlla("B2. AVVERTENZA confermata: la 0137 applicata DOPO (elenco scritto a mano) toglie «empulia» e «siaps» → in produzione la 0137 va applicata PRIMA", b2.status === 0 && !bv2.includes("empulia") && !bv2.includes("siaps") && bv2.includes("start"), { err: b2.stderr, bv2 });

  // ── C: nessun vincolo sulle fonti → fallisce e si annulla
  psql("caso_c", tabelle(null));
  const c = psql("caso_c", M.m0138);
  controlla("C. nessun vincolo sulle fonti: la 0138 FALLISCE con il suo messaggio; nessuna riga in radar_fonti_stato, nessun vincolo creato", c.status !== 0 && /0138: nessun vincolo sulle fonti/.test(c.stderr ?? "") && valore("caso_c", "select count(*) from public.radar_fonti_stato;") === "0" && fonti("caso_c") === "", (c.stderr ?? "").slice(0, 300));

  // ── D: un valore in più già ammesso → conservato
  psql("caso_d", `${tabelle("'ted', 'pvl', 'sintel', 'sardegnacat', 'altra_fonte'")}insert into public.radar_esecuzioni (fonte, esito) values ('altra_fonte', 'ok');`);
  const d = psql("caso_d", M.m0138);
  const dv = valori(fonti("caso_d"));
  controlla("D. un valore già ammesso (ipotetico «altra_fonte») si CONSERVA, più «empulia»; la riga che lo usa resta valida", d.status === 0 && JSON.stringify(dv) === JSON.stringify(["ted", "pvl", "sintel", "sardegnacat", "altra_fonte", "empulia"]), { err: d.stderr, dv });
} catch (x) {
  controlla("eccezione nella prova", false, x instanceof Error ? x.message : String(x));
} finally {
  docker(["stop", nome]);
}
for (const r of esiti) console.log(`${r.ok ? "ok     " : "FALLITO"} ${r.nome}${r.ok || r.dettaglio === undefined ? "" : ` → ${JSON.stringify(r.dettaglio).slice(0, 500)}`}`);
const falliti = esiti.filter((r) => !r.ok).length;
console.log(`Prova della 0138 e della 0139 su Postgres isolato: ${esiti.length - falliti} ok, ${falliti} falliti`);
codice = falliti ? 1 : 0;
process.exit(codice);
