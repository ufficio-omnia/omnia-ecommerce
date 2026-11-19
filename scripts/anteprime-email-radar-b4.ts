// Genera le anteprime delle email di Tender Intelligence (fase B4) con DATI SINTETICI, per far vedere la grafica all'utente.
// Uso: npx tsx scripts/anteprime-email-radar-b4.ts <cartella di destinazione>
// Scrive, per ogni caso: <nome>.html (l'email com'è), <nome>.txt (versione di solo testo) e un indice.html con la vista da computer
// (600 px) e da telefono (375 px) affiancate. Nessuna rete, nessun database, nessun invio.
import fs from "node:fs";
import path from "node:path";
import { componiEmailRadar } from "../src/lib/radar/email-modelli";
import { esc } from "../src/lib/radar/email-modelli/formato";
import { ANTEPRIME } from "./dati-sintetici-email-radar-b4";

const cartella = process.argv[2];
if (!cartella) {
  console.error("Uso: npx tsx scripts/anteprime-email-radar-b4.ts <cartella di destinazione>");
  process.exit(2);
}
fs.mkdirSync(cartella, { recursive: true });

const voci: string[] = [];
for (const a of ANTEPRIME) {
  const email = componiEmailRadar(a.evento, a.destinatario);
  fs.writeFileSync(path.join(cartella, `${a.file}.html`), email.html, "utf8");
  fs.writeFileSync(path.join(cartella, `${a.file}.txt`), `Oggetto: ${email.oggetto}\n\n${email.testo}`, "utf8");
  const chi = a.destinatario.ruolo === "titolare" ? "titolare dell'impresa" : "Ufficio Gare";
  voci.push(`<section>
<h2>${esc(a.titolo)}</h2>
<p class="meta"><strong>Oggetto:</strong> ${esc(email.oggetto)} · <strong>Destinatario:</strong> ${esc(chi)} · <a href="${esc(a.file)}.html">apri l'email</a> · <a href="${esc(a.file)}.txt">versione di solo testo</a></p>
<div class="viste">
<figure><figcaption>Computer</figcaption><iframe src="${esc(a.file)}.html" width="640" height="900" title="${esc(a.titolo)} — computer" loading="lazy"></iframe></figure>
<figure><figcaption>Telefono</figcaption><iframe src="${esc(a.file)}.html" width="375" height="900" title="${esc(a.titolo)} — telefono" loading="lazy"></iframe></figure>
</div>
</section>`);
}

fs.writeFileSync(
  path.join(cartella, "indice.html"),
  `<!DOCTYPE html>
<html lang="it">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<title>Anteprime email B4</title>
<style>
:root { color-scheme: light; }
body { margin: 0; padding: 24px; background: #eceef5; color: #1f2430; font-family: Arial, Helvetica, sans-serif; }
header { max-width: 1100px; margin: 0 auto 24px; }
h1 { font-size: 22px; margin: 0 0 8px; }
.avviso { background: #fff4d6; border: 1px solid #f0d58a; border-radius: 8px; padding: 10px 14px; font-size: 14px; }
section { max-width: 1100px; margin: 0 auto 36px; background: #fff; border: 1px solid #dfe2ea; border-radius: 12px; padding: 18px 20px; }
h2 { font-size: 17px; margin: 0 0 6px; }
.meta { font-size: 13px; color: #4b5563; margin: 0 0 14px; }
.viste { display: flex; gap: 20px; flex-wrap: wrap; align-items: flex-start; }
figure { margin: 0; }
figcaption { font-size: 12px; color: #6b7280; text-transform: uppercase; letter-spacing: .4px; margin-bottom: 6px; }
iframe { border: 1px solid #d1d5db; border-radius: 8px; background: #f4f5fb; max-width: 100%; }
a { color: #4f46e5; }
</style>
</head>
<body>
<header>
<h1>OMNIA Tender Intelligence — anteprime delle email della fase B4</h1>
<p class="avviso"><strong>Dati sintetici.</strong> Imprese, stazioni appaltanti, CIG, persone e collegamenti sono inventati (le fonti usano domini <code>.example</code>). Nessuna email è stata inviata: sono i file prodotti dalla funzione pura <code>componiEmailRadar</code>. Tema chiaro; a sinistra la vista da computer, a destra quella da telefono (375 px).</p>
</header>
${voci.join("\n")}
</body>
</html>
`,
  "utf8",
);
console.log(`Anteprime scritte in ${cartella}: ${ANTEPRIME.length} email (html + txt) e indice.html`);
