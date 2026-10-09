// Costruisce e disegna l'organigramma da una generazione REALE salvata (il file
// "<nome>.input.json" scritto da scripts/prova-ricchezza-visiva.ts: l'input
// dello strumento genera_bozza_sezione), con i fatti certi della gara letti dal
// database (committente, RUP/DEC, sedi, organico, profilo) e la guardia R9.
//
//   npx tsx scripts/prova-organigramma-reale.ts --gara <uuid> --file <x.input.json> [--file ...]
//
// SOLA LETTURA sul DB; scrive solo il PNG in test/diagnostica/organigrammi/
// (ignorato da git). Nessuna chiamata a modelli: gratuito.
import fs from "fs";
import path from "path";
for (const line of fs.readFileSync(path.join(__dirname, "..", ".env.local"), "utf-8").split("\n")) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) process.env[m[1]] = m[2].trim();
}
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { createClient } = require("@supabase/supabase-js");
import { leggiFattiOrganigramma } from "../src/lib/organigramma-fatti";
import { costruisciOrganigramma } from "../src/lib/organigramma-contesto";
import { disegnaOrganigramma } from "../src/lib/organigramma-disegno";
import { caricaEvidenzaDati } from "../src/lib/evidenza-dati";

function argomenti(nome: string): string[] {
  const valori: string[] = [];
  process.argv.forEach((a, i) => {
    if (a === `--${nome}` && process.argv[i + 1]) valori.push(process.argv[i + 1]);
  });
  return valori;
}

async function main() {
  const garaArg = argomenti("gara")[0];
  const files = argomenti("file");
  if (!garaArg || files.length === 0) throw new Error("Servono --gara e almeno un --file");

  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  const { data: gare } = await admin.from("gare").select("id, user_id, titolo");
  const gara = (gare ?? []).find((g: { id: string }) => g.id === garaArg || g.id.startsWith(garaArg));
  if (!gara) throw new Error(`Gara non trovata: ${garaArg}`);

  const fatti = await leggiFattiOrganigramma({ supabase: admin, garaId: gara.id, userId: gara.user_id });
  console.log(`Gara «${gara.titolo}»: committente ${fatti.committente ?? "—"} | interfaccia ${fatti.tipoInterfaccia ?? "nessuna nei documenti"} | sedi ${fatti.sedi.length} | organico ${fatti.organico ?? "ignoto"} | direzione da profilo: ${fatti.funzioniDirezione.length + fatti.ufficiGestione.length} voci`);
  const evidenza = await caricaEvidenzaDati({ garaId: gara.id, userId: gara.user_id, supabase: admin });

  const cartella = path.join(__dirname, "..", "test", "diagnostica", "organigrammi");
  fs.mkdirSync(cartella, { recursive: true });

  for (const file of files) {
    const input = JSON.parse(fs.readFileSync(file, "utf-8")) as { contenuto?: string; organigramma?: unknown };
    const segnaposto = /\[ORGANIGRAMMA\]\s*\[\/ORGANIGRAMMA\]/i.test(input.contenuto ?? "");
    const conOrganigramma = /\[ORGANIGRAMMA\]/i.test(input.contenuto ?? "");
    console.log(`\n${path.basename(file)}: segnaposto vuoto nel testo ${segnaposto ? "sì" : conOrganigramma ? "NO (blocco con contenuto)" : "assente"} | campo strutturato ${input.organigramma ? "presente" : "assente"}`);
    if (!input.organigramma) continue;
    const esito = costruisciOrganigramma(input.organigramma, fatti, { evidenza });
    console.log(`  persone ${esito.persone}${fatti.organico != null ? ` su organico ${fatti.organico}` : ""}`);
    for (const a of esito.avvisi) console.log(`  AVVISO: ${a}`);
    if (!esito.dati) continue;
    const r = await disegnaOrganigramma(esito.dati);
    const out = path.join(cartella, `${path.basename(file).replace(/\.input\.json$/, "")}.png`);
    fs.writeFileSync(out, r.buffer);
    console.log(`  disegnato: ${r.larghezzaPx}x${r.altezzaPx}px → ${out}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
