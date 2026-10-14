// Autotest dell'area riservata di OMNIA AI: pulsante «Esci» sempre raggiungibile e notifiche.
// (Nei blocchi successivi vi si aggiungono gare gratuite, prezzi e pilot.)
// Gratuito, nessun database né rete: gira nel livello 1, quindi in prebuild.
import fs from "fs";
import path from "path";

const fallimenti: string[] = [];
function atteso(nome: string, ok: boolean, dettaglio = "") {
  console.log(`${ok ? "ok    " : "FALLITO"} ${nome}${ok ? "" : ` — ${dettaglio}`}`);
  if (!ok) fallimenti.push(nome);
}
const leggi = (relativo: string) => fs.readFileSync(path.join(__dirname, "..", relativo), "utf-8").replace(/\r\n/g, "\n");

console.log("--- «Esci» ---");
const topbar = leggi("src/components/omnia-ai/topbar.tsx");
const sidebar = leggi("src/components/omnia-ai/sidebar-nav.tsx");
const layout = leggi("src/app/site-omnia-ai/dashboard/omnia-ai/layout.tsx");
atteso("barra in alto: «Esci» sempre visibile (non solo nel menu dell'email)", /<form action=\{signOut\}>[\s\S]*?Esci[\s\S]*?<\/form>/.test(topbar));
atteso("barra laterale: «Esci» in fondo", /<form action=\{signOut\}>[\s\S]*?omnia-sidebar-esci[\s\S]*?Esci/.test(sidebar));
atteso("pagina di attivazione (cliente senza abbonamento, senza barre): «Esci» presente", /stato\.stato === "cessato"[\s\S]*?<form action=\{signOut\}[^>]*>[\s\S]*?Esci/.test(layout));
atteso("«Esci» usa l'azione che chiude la sessione e porta al login", /await supabase\.auth\.signOut\(\);\s*redirect\("\/login"\)/.test(leggi("src/app/actions/auth.ts")));
atteso("il menu del profilo ha ancora il suo «Esci»", /<form action=\{signOut\}>/.test(leggi("src/components/omnia-ai/profilo-menu.tsx")));

console.log("--- Notifiche ---");
const tipi = [...leggi("src/lib/omnia-ai-notifiche.ts").matchAll(/\| "([a-z0-9_]+)"/g)].map((m) => m[1]);
const migrazioni = fs.readdirSync(path.join(__dirname, "..", "supabase/migrations")).filter((f) => /notifiche/.test(f)).sort();
const ultima = leggi(`supabase/migrations/${migrazioni[migrazioni.length - 1]}`);
const ammessi = [...(ultima.match(/tipo in \(([\s\S]*?)\)\s*\)/)?.[1] ?? "").matchAll(/'([a-z0-9_]+)'/g)].map((m) => m[1]);
atteso("ogni tipo di notifica del codice è ammesso dall'ultimo vincolo del database (altrimenti l'insert è rifiutato)", tipi.length > 0 && tipi.every((t) => ammessi.includes(t)), tipi.filter((t) => !ammessi.includes(t)).join(", "));
atteso("l'ultimo vincolo conserva i tipi di prima", ["analisi_conclusa", "relazione_generata", "gara_scadenza_7gg", "gara_scadenza_2gg", "gare_piano_esaurite", "rinnovo_3gg", "pagamento_fallito"].every((t) => ammessi.includes(t)));
atteso("la migrazione non cancella dati (solo il vincolo CHECK)", !/\b(delete\s+from|truncate|drop\s+table|drop\s+column)\b/i.test(ultima));
const campanello = leggi("src/components/omnia-ai/notification-bell.tsx");
atteso("ogni notifica senza gara ha una destinazione (la fattura porta a «Pagamenti e fatture»)", /fattura_disponibile: "\/dashboard\/omnia-ai\/pagamenti"/.test(campanello) && /DESTINAZIONE_PER_TIPO\[n\.tipo\]/.test(campanello));
atteso("tutti i tipi senza gara hanno una destinazione", tipi.filter((t) => !["analisi_conclusa", "relazione_generata", "gara_scadenza_7gg", "gara_scadenza_2gg"].includes(t)).every((t) => new RegExp(`${t}: "/dashboard`).test(campanello)));
const azioneFatture = leggi("src/app/site-console/azioni/fatturazione.ts");
atteso("caricando la fattura (solo la prima volta) si crea la notifica al cliente", /pdf\?\.primoCaricamento && pdf\.userId\) await notificaFatturaDisponibile\(/.test(azioneFatture));
atteso("la notifica è unica per pagamento (chiave di deduplica = la riga)", /tipo: "fattura_disponibile"[\s\S]*?chiaveDedup: riga/.test(azioneFatture));
atteso("la notifica non dipende dall'esito dell'email (si crea comunque)", !/emailInviata[^\n]*notificaFatturaDisponibile|if \(emailInviata[^\n]*\)[^\n]*notificaFatturaDisponibile/.test(azioneFatture));

console.log("");
if (fallimenti.length > 0) {
  console.error(`${fallimenti.length} controlli falliti:\n - ${fallimenti.join("\n - ")}`);
  process.exit(1);
}
console.log("Tutti i controlli sono andati a buon fine.");
