// SOLO SUL RAMO anteprima/tender-intelligence-b3: «postbuild», dopo `next build`. Controlla il codice COMPILATO,
// dove Next ha già inserito i valori delle variabili NEXT_PUBLIC_*:
//   - nel codice che va al browser (.next/static): nessun identificativo del progetto di produzione, nessuna chiave Stripe
//     «live», nessuna chiave secret di Supabase e, in particolare, mai il valore di SUPABASE_SERVICE_ROLE_KEY;
//   - in tutto il codice compilato (.next/server e .next/static): ogni indirizzo «<progetto>.supabase.co» è quello dello
//     staging, e quello dello staging c'è (prova che l'URL inserito al momento della build è lo staging).
// Se qualcosa non torna, esce con errore e il deploy fallisce. Stampa solo nomi e conteggi, mai valori.
import fs from "node:fs";
import path from "node:path";
import { STAGING_REF } from "../src/lib/anteprima-guardia-ambiente";

const PRODUZIONE_REF = "bihfrzspqxsrzlbqqvqa";
const ESTENSIONI = /\.(js|mjs|cjs|json|html|rsc|css|txt|map|body|meta)$/;

function* file(cartella: string): Generator<string> {
  if (!fs.existsSync(cartella)) return;
  for (const voce of fs.readdirSync(cartella, { withFileTypes: true })) {
    const p = path.join(cartella, voce.name);
    if (voce.isDirectory()) {
      if (voce.name !== "cache") yield* file(p);
    } else if (ESTENSIONI.test(voce.name)) yield p;
  }
}

export function erroriCodiceCompilato(cartellaNext: string, chiaveServizio: string): { errori: string[]; fileLetti: number } {
  const errori: string[] = [];
  let fileLetti = 0;
  let stagingTrovato = false;
  const altriHost = new Set<string>();
  const nelBrowser = { produzione: 0, live: 0, secret: 0, chiaveServizio: 0 };

  for (const [sotto, browser] of [["static", true], ["server", false]] as const) {
    for (const f of file(path.join(cartellaNext, sotto))) {
      const testo = fs.readFileSync(f, "utf8");
      fileLetti++;
      for (const h of testo.toLowerCase().match(/[a-z0-9]{20}\.supabase\.(co|in)/g) ?? []) {
        if (h.startsWith(STAGING_REF)) stagingTrovato = true;
        else altriHost.add(h.slice(0, 4) + "…");
      }
      if (browser) {
        if (testo.includes(PRODUZIONE_REF)) nelBrowser.produzione++;
        if (/\b(sk|rk)_live_/.test(testo)) nelBrowser.live++;
        // Una chiave vera è il prefisso seguito da una lunga sequenza; il solo prefisso compare di proposito nella libreria
        // Supabase (riconosce il formato con `startsWith("sb_secret_")`) e non è una chiave.
        if (/sb_secret_[A-Za-z0-9_-]{16,}/.test(testo)) nelBrowser.secret++;
        if (chiaveServizio && testo.includes(chiaveServizio)) nelBrowser.chiaveServizio++;
      }
    }
  }

  if (!fileLetti) errori.push("nessun file compilato trovato in .next (la build non c'è)");
  if (altriHost.size) errori.push(`il codice compilato contiene ${altriHost.size} indirizzi Supabase diversi dallo staging`);
  if (fileLetti && !stagingTrovato) errori.push("il codice compilato non contiene l'indirizzo dello staging");
  if (nelBrowser.produzione) errori.push(`${nelBrowser.produzione} file per il browser contengono l'identificativo del progetto di produzione`);
  if (nelBrowser.live) errori.push(`${nelBrowser.live} file per il browser contengono una chiave Stripe «live»`);
  if (nelBrowser.secret) errori.push(`${nelBrowser.secret} file per il browser contengono una chiave secret di Supabase`);
  if (nelBrowser.chiaveServizio) errori.push(`${nelBrowser.chiaveServizio} file per il browser contengono il valore di SUPABASE_SERVICE_ROLE_KEY`);
  return { errori, fileLetti };
}

if (require.main === module) {
  const { errori, fileLetti } = erroriCodiceCompilato(path.resolve(__dirname, "..", ".next"), (process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim());
  if (errori.length) {
    console.error("BUILD BLOCCATA — il codice compilato non è solo di staging:");
    for (const x of errori) console.error(`  - ${x}`);
    process.exit(1);
  }
  console.log(`Codice compilato controllato (${fileLetti} file): solo indirizzi dello staging, nessuna chiave segreta o di produzione nel codice per il browser.`);
}
