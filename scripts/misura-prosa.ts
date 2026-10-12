// Misura la densità di un testo OMNIA: quanta prosa "liscia", quanta ha
// evidenziazioni, quante tabelle, figure e riquadri, per ogni sotto-criterio.
//
//   npx tsx scripts/misura-prosa.ts <x.input.json> [<y.input.json> ...]
//   npx tsx scripts/misura-prosa.ts --gara <uuid> --ordine <n>      (legge una sezione salvata, SOLA LETTURA)
//
// Gratuito: nessuna chiamata a modelli.
import fs from "fs";
import path from "path";
import { descriviProsa, misuraProsa, misuraVisiva } from "../src/lib/ricchezza-visiva";
import { evidenziaProsaMancante } from "../src/lib/evidenziazione-prosa";

async function leggiDaDatabase(garaArg: string, ordine: number): Promise<string> {
  for (const line of fs.readFileSync(path.join(__dirname, "..", ".env.local"), "utf-8").split("\n")) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m) process.env[m[1]] = m[2].trim();
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { createClient } = require("@supabase/supabase-js");
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  const { data: gare } = await admin.from("gare").select("id");
  const id = ((gare ?? []) as { id: string }[]).find((g) => g.id.startsWith(garaArg))?.id;
  if (!id) throw new Error(`Gara non trovata: ${garaArg}`);
  const { data } = await admin.from("gara_relazione_sezioni").select("contenuto").eq("gara_id", id).eq("ordine", ordine).single();
  return (data as { contenuto: string }).contenuto;
}

function riepiloga(nome: string, contenuto: string) {
  console.log(`\n== ${nome}`);
  const paroleTotali = misuraVisiva(contenuto).parole;
  for (const b of contenuto.split(/\n(?=##\s)/)) {
    if (!/^##\s/.test(b)) continue;
    const v = misuraVisiva(b);
    console.log(`${b.split("\n")[0].slice(0, 46).padEnd(46)} | ${descriviProsa(misuraProsa(b), v.parole)} | tab ${v.tabelle} | box ${v.riquadri} | figure ${v.figure + v.organigrammi} | icone ${v.icone}`);
  }
  console.log(`TOTALE: ${descriviProsa(misuraProsa(contenuto), paroleTotali)}`);
}

async function main() {
  const args = process.argv.slice(2);
  const i = args.indexOf("--gara");
  if (i >= 0) {
    const ordine = Number(args[args.indexOf("--ordine") + 1]);
    riepiloga(`${args[i + 1]} ordine ${ordine}`, await leggiDaDatabase(args[i + 1], ordine));
    return;
  }
  const evidenzia = args.includes("--evidenzia");
  for (const f of args.filter((a) => !a.startsWith("--"))) {
    // .md = testo già pronto; .json = input dello strumento di generazione (campo contenuto)
    const grezzo = f.endsWith(".md") ? fs.readFileSync(f, "utf-8") : ((JSON.parse(fs.readFileSync(f, "utf-8")) as { contenuto?: string }).contenuto ?? "");
    // con --evidenzia si applica anche la guardia di produzione sulle evidenziazioni
    riepiloga(`${path.basename(f)}${evidenzia ? " + evidenziazioni" : ""}`, evidenzia ? evidenziaProsaMancante(grezzo).testo : grezzo);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
