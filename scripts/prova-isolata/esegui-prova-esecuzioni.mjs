// PROVA DEL REGISTRO DEI GIRI (radar_esecuzioni, 0128; pacchetto K2 del piano 48C, B2, 23/11/2026) SU UN POSTGRES ISOLATO. Docker solo
// per prove su un PostgreSQL usa e getta: immagine postgres:17.11 già sul disco, contenitore --rm con nome proprio, --network none, nessuna
// porta, nessun volume, password casuale mai salvata. Mai rmi, volume rm o prune; nessun database reale.
//   1. la 0128 si legge dal commit indicato (di base HEAD), cioè quella già applicata allo staging;
//   2. le righe VERE calcolate da esecuzioni-calcoli.ts (esportate dalla verifica, dati ostili compresi) entrano TUTTE nella tabella;
//   3. i byte dei jsonb calcolati in JavaScript (byteJsonb) coincidono con octet_length(x::text) di Postgres, riga per riga;
//   4. righe sbagliate apposta vengono RIFIUTATE dai vincoli (il controllo non è vuoto);
//   5. come service_role: insert e la cancellazione oltre i 90 giorni della sola fonte riescono, l'update no (la 0128 non lo concede).
// Uso: node scripts/prova-isolata/esegui-prova-esecuzioni.mjs postgres:17.11 [commit]
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const QUI = path.dirname(fileURLToPath(import.meta.url));
const RADICE = path.join(QUI, "..", "..");
const immagine = process.argv[2];
const commit = process.argv[3] ?? "HEAD";
if (immagine !== "postgres:17.11") {
  console.error("Uso: node scripts/prova-isolata/esegui-prova-esecuzioni.mjs postgres:17.11 [commit] (solo l'immagine già sul disco)");
  process.exit(2);
}
const git = (...a) => spawnSync("git", ["-c", "core.autocrlf=false", ...a], { cwd: RADICE, encoding: "utf8", maxBuffer: 20 * 1024 * 1024 });
const id = git("rev-parse", commit).stdout.trim();
const M0128 = git("show", `${id}:supabase/migrations/0128_radar_esecuzioni.sql`);
if (!/^[0-9a-f]{40}$/.test(id) || M0128.status !== 0) {
  console.error(`0128 non trovata nel commit ${commit}`);
  process.exit(2);
}

// le righe vere, dalla verifica (senza rete)
const lavoro = fs.mkdtempSync(path.join(os.tmpdir(), "k2-righe-"));
const fileRighe = path.join(lavoro, "righe.json");
const batteria = spawnSync("npx tsx scripts/verifica-radar-esecuzioni.ts", { cwd: RADICE, shell: true, encoding: "utf8", env: { ...process.env, RADAR_RIGHE_ESECUZIONI: fileRighe }, maxBuffer: 20 * 1024 * 1024 });
if (batteria.status !== 0 || !fs.existsSync(fileRighe)) {
  console.error(`la verifica non ha esportato le righe (codice ${batteria.status})\n${(batteria.stdout ?? "").slice(-800)}`);
  process.exit(1);
}
const { righe, byte, sbagliate } = JSON.parse(fs.readFileSync(fileRighe, "utf8"));
fs.rmSync(lavoro, { recursive: true, force: true });

const TAG = "$riga_k2_7f3a$";
const json = (o) => {
  const t = JSON.stringify(o);
  if (t.includes(TAG)) throw new Error("etichetta di citazione presente nei dati");
  return `${TAG}${t}${TAG}`;
};
const inserisci = (o) => `insert into public.radar_esecuzioni select * from jsonb_populate_record(null::public.radar_esecuzioni, ${json(o)}::jsonb)`;
const quoto = (s) => `'${String(s).replace(/'/g, "''")}'`;

const sql = `\\set ON_ERROR_STOP on
${fs.readFileSync(path.join(QUI, "00_prerequisiti.sql"), "utf8")}
${M0128.stdout}
create schema prova_k2;
create table prova_k2.esiti (n serial, nome text, ok boolean);
-- security definer: i controlli si registrano anche mentre la prova agisce come service_role o authenticated (che non hanno altri permessi)
create function prova_k2.verifica(nome text, ok boolean) returns void language sql security definer as $$ insert into prova_k2.esiti (nome, ok) values (nome, coalesce(ok, false)) $$;
grant usage on schema prova_k2 to service_role, authenticated;
grant execute on function prova_k2.verifica(text, boolean) to service_role, authenticated;

-- 2. le righe vere entrano tutte
${righe
  .map(
    (r, i) => `do $p$ begin ${inserisci(r)}; perform prova_k2.verifica(${quoto(`riga vera ${i + 1} (${r.fonte}, ${r.esito}) accettata`)}, true);
exception when others then perform prova_k2.verifica(${quoto(`riga vera ${i + 1} (${r.fonte}, ${r.esito}) accettata`)} || ': ' || sqlerrm, false); end $p$;`,
  )
  .join("\n")}
select prova_k2.verifica('tutte le ${righe.length} righe vere nella tabella', (select count(*) from public.radar_esecuzioni) = ${righe.length});

-- 3. byte dei jsonb: JavaScript = Postgres, riga per riga
${byte
  .map(
    (b) => `select prova_k2.verifica(${quoto(`byte ${b.id.slice(-4)}: finestre ${b.finestre}, avvisi ${b.avvisi}, risposte ${b.risposte} uguali a Postgres`)},
  (select octet_length(finestre::text) = ${b.finestre} and octet_length(avvisi::text) = ${b.avvisi} and octet_length(fonte_risposte::text) = ${b.risposte} from public.radar_esecuzioni where id = ${quoto(b.id)}));`,
  )
  .join("\n")}

-- 4. righe sbagliate apposta: RIFIUTATE
${[
  ...sbagliate.map((s) => [s.nome, inserisci(s.riga)]),
  ["finestre oltre 20.000 byte", inserisci({ ...righe[0], id: "00000000-0000-4000-a000-000000000001", finestre: { x: "z".repeat(20_100) } })],
  ["errore di 501 caratteri", inserisci({ ...righe[0], id: "00000000-0000-4000-a000-000000000002", esito: "errore", errore: "e".repeat(501) })],
  ["allarme con una virgola", inserisci({ ...righe[0], id: "00000000-0000-4000-a000-000000000003", allarmi: ["a,b"] })],
  ["21 allarmi", inserisci({ ...righe[0], id: "00000000-0000-4000-a000-000000000004", allarmi: Array.from({ length: 21 }, (_, i) => `al_${"abcdefghijklmnopqrstu"[i]}`) })],
  ["risposte oltre 2.000 byte", inserisci({ ...righe[0], id: "00000000-0000-4000-a000-000000000005", fonte_risposte: Object.fromEntries(Array.from({ length: 200 }, (_, i) => [`codice_${i}`, i])) })],
]
  .map(([nome, ins]) => `do $p$ begin ${ins}; perform prova_k2.verifica(${quoto(`sbagliata «${nome}» rifiutata`)}, false);
exception when check_violation or not_null_violation or invalid_text_representation then perform prova_k2.verifica(${quoto(`sbagliata «${nome}» rifiutata`)}, true); end $p$;`)
  .join("\n")}

-- 5. come service_role: insert, cancellazione oltre i 90 giorni della sola fonte, update rifiutato
insert into public.radar_esecuzioni (id, fonte, modo, iniziato_il, finito_il, esito) values
  ('00000000-0000-4000-b000-000000000001', 'ted', 'incrementale', now() - interval '100 days', now() - interval '100 days', 'ok'),
  ('00000000-0000-4000-b000-000000000002', 'pvl', 'incrementale', now() - interval '100 days', now() - interval '100 days', 'ok'),
  ('00000000-0000-4000-b000-000000000003', 'ted', 'incrementale', now() - interval '89 days', now() - interval '89 days', 'ok');
set role service_role;
do $p$ begin insert into public.radar_esecuzioni (id, fonte, modo, iniziato_il, finito_il, esito) values ('00000000-0000-4000-b000-000000000004', 'ted', 'incrementale', now(), now(), 'ok');
  perform prova_k2.verifica('service_role: insert riuscito', true);
exception when others then perform prova_k2.verifica('service_role: insert riuscito: ' || sqlerrm, false); end $p$;
do $p$ declare n int; begin
  with x as (delete from public.radar_esecuzioni where fonte = 'ted' and iniziato_il < now() - interval '90 days' returning id) select count(*) into n from x;
  perform prova_k2.verifica('service_role: la cancellazione oltre i 90 giorni toglie SOLO la riga TED di 100 giorni (' || n || ')', n = 1);
exception when others then perform prova_k2.verifica('service_role: cancellazione: ' || sqlerrm, false); end $p$;
do $p$ begin update public.radar_esecuzioni set esito = 'errore', errore = 'x' where fonte = 'ted';
  perform prova_k2.verifica('service_role: update RIFIUTATO (la 0128 non lo concede)', false);
exception when insufficient_privilege then perform prova_k2.verifica('service_role: update RIFIUTATO (la 0128 non lo concede)', true); end $p$;
reset role;
select prova_k2.verifica('restano la riga PVL di 100 giorni e la TED di 89', (select count(*) from public.radar_esecuzioni where id in ('00000000-0000-4000-b000-000000000002', '00000000-0000-4000-b000-000000000003')) = 2);
set role authenticated;
do $p$ begin perform 1 from public.radar_esecuzioni limit 1; perform prova_k2.verifica('authenticated: lettura RIFIUTATA', false);
exception when insufficient_privilege then perform prova_k2.verifica('authenticated: lettura RIFIUTATA', true); end $p$;
reset role;

select case when ok then 'ok       ' else 'FALLITO  ' end || nome from prova_k2.esiti order by n;
select 'piano ' || count(*) filter (where ok) || ' ok, ' || count(*) filter (where not ok) || ' falliti' from prova_k2.esiti;
`;

const nome = `prova-k2-${randomBytes(4).toString("hex")}`;
const docker = (args, input) => spawnSync("docker", args, { encoding: "utf8", input, maxBuffer: 80 * 1024 * 1024 });
const avvio = docker(["run", "--rm", "-d", "--name", nome, "--network", "none", "-e", `POSTGRES_PASSWORD=${randomBytes(18).toString("hex")}`, immagine]);
if (avvio.status !== 0) {
  console.error(`avvio del contenitore non riuscito: ${avvio.stderr}`);
  process.exit(1);
}
let codice = 1;
try {
  let pronto = false;
  for (let i = 0; i < 60 && !pronto; i++) {
    pronto = docker(["exec", nome, "pg_isready", "-U", "postgres", "-q"]).status === 0 && docker(["exec", nome, "psql", "-U", "postgres", "-tAc", "select 1"]).stdout.trim() === "1";
    if (!pronto) spawnSync(process.execPath, ["-e", "setTimeout(() => {}, 1000)"]);
  }
  if (!pronto) throw new Error("Postgres non pronto");
  console.log(`Contenitore ${nome}: ${docker(["exec", nome, "psql", "-U", "postgres", "-tAc", "select version()"]).stdout.trim().slice(0, 60)}; 0128 dal commit ${id.slice(0, 7)}; ${righe.length} righe vere, ${sbagliate.length + 5} sbagliate`);
  const r = docker(["exec", "-i", nome, "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-q", "-tA", "-f", "-"], sql);
  const uscita = `${r.stdout ?? ""}\n${r.stderr ?? ""}`;
  const righeUtili = uscita.split("\n").filter((x) => /^(ok|FALLITO|piano)\s/.test(x) || /ERROR|ERRORE/.test(x));
  for (const x of righeUtili) console.log(x);
  const piano = righeUtili.find((x) => x.startsWith("piano"));
  codice = r.status === 0 && piano && / 0 falliti$/.test(piano) ? 0 : 1;
} catch (e) {
  console.error(e instanceof Error ? e.message : String(e));
} finally {
  docker(["stop", nome]);
}
console.log(codice === 0 ? "PROVA ISOLATA DEL REGISTRO DEI GIRI (K2): superata" : "PROVA ISOLATA DEL REGISTRO DEI GIRI (K2): NON superata");
process.exit(codice);
