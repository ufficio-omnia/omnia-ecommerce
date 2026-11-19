// Prove di mutazione dello script del collaudo con accesso della fase B4 (scripts/collaudo-accesso-b4.mjs). Per ogni mutazione si altera
// UN punto di sicurezza dello script, si lancia scripts/verifica-collaudo-accesso-b4.ts (solo a secco: staging finto, nessuna rete) e deve
// fallire proprio la prova indicata. Il file si ripristina SEMPRE dal buffer letto all'inizio (mai git checkout); prima di partire deve
// essere committato, alla fine si controlla che sia identico (sha256).
// Uso: node scripts/mutazioni-collaudo-accesso-b4.mjs
import path from "node:path";
import { fileURLToPath } from "node:url";
import { eseguiMutazioni } from "./lib/esegui-mutazioni.mjs";

const RADICE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const S = "scripts/collaudo-accesso-b4.mjs";

const MUTAZIONI = [
  // ordine, prerequisiti, un solo tentativo
  { nome: "MC1 ordine del piano non imposto", file: S, cerca: "if (mancante) return testo(409, `Prima va completato", con: "if (false) return testo(409, `Prima va completato", richiede: "CB10." },
  { nome: "MC2 prerequisiti ignorati (passo 1 prima della D3)", file: S, cerca: "      if (!pre.ok) {\n", con: "      if (false) {\n", richiede: "CB12." },
  { nome: "MC3 pulsante consumato anche se mancano i prerequisiti", file: S, cerca: "    stato.inCorso = true;\n    try {\n      let pre;", con: "    stato.inCorso = true;\n    stato.usati.add(percorso);\n    try {\n      let pre;", richiede: "CB12." },
  { nome: "MC4 secondo clic consentito", file: S, cerca: "if (stato.usati.has(percorso)) return testo(410,", con: "if (false) return testo(410,", richiede: "CB22." },
  { nome: "MC5 verifiche finali prima del passo 4", file: S, cerca: "))) return testo(409, \"Le verifiche finali", con: ")) && false) return testo(409, \"Le verifiche finali", richiede: "CB10." },
  { nome: "MC6 preliminare che apre i pulsanti", file: S, cerca: "if (preliminare) return testo(409, \"Modalità preliminare", con: "if (false) return testo(409, \"Modalità preliminare", richiede: "CB55." },
  // fermo
  { nome: "MC7 browser nell'app anche con una VIOLAZIONE", file: S, cerca: "if (!registra(esito.voci)) return html(423,", con: "if (!registra(esito.voci) && false) return html(423,", richiede: "CB28." },
  { nome: "MC8 la VIOLAZIONE non spegne l'app", file: S, cerca: "    alFermo(motivo);\n", con: "", richiede: "CB28." },
  { nome: "MC9 dopo il fermo i pulsanti funzionano ancora", file: S, cerca: "if (stato.fermo) return testo(423,", con: "if (false) return testo(423,", richiede: "CB29." },
  { nome: "MC10 un ERRORE di verifica non ferma", file: S, cerca: 'export const ESITI_FERMO = new Set(["VIOLAZIONE", "ERRORE"]);', con: 'export const ESITI_FERMO = new Set(["VIOLAZIONE"]);', richiede: "CB52." },
  { nome: "MC11 resoconto «ok» anche con violazioni", file: S, cerca: '  for (const e of ["VIOLAZIONE", "ERRORE"]) if (voci.some((v) => v.esito === e)) return e;\n', con: "", richiede: "CB30." },
  // identità, positivi, tentativi di scrittura
  { nome: "MC12 identità della sessione non confrontata", file: S, cerca: "if (!io || io.email !== utente.email) {", con: "if (!io) {", richiede: "CB33." },
  { nome: "MC13 controllo positivo senza uguaglianza", file: S, cerca: '  else if (viste.n !== esistono.n) esito = "ERRORE";\n  return voce(controllo', con: "  return voce(controllo", richiede: "CB34." },
  { nome: "MC14 tentativo di scrittura ammesso tollerato", file: S, cerca: 'STATI_SCRITTURA_RESPINTA.has(stato) ? "ok"', con: 'stato < 500 ? "ok"', richiede: "CB31." },
  { nome: "MC15 tentativo a senza il filtro impossibile", file: S, cerca: "&posizione=eq.0`", con: "`", richiede: "CB17." },
  { nome: "MC16 tentativi con la chiave di servizio invece del token", file: S, cerca: 'headers: { ...diSessione(token), "Content-Type": "application/json", Prefer: "return=minimal" },', con: 'headers: { ...diSessione(token), Authorization: `Bearer ${variabili.SUPABASE_SERVICE_ROLE_KEY}`, "Content-Type": "application/json", Prefer: "return=minimal" },', richiede: "CB16." },
  // isolamento e gara D2
  { nome: "MC17 profilo fuori dall'isolamento", file: S, cerca: '  { tabella: "omnia_ai_radar_profili", colonna: "user_id" },\n', con: "", richiede: "CB28." },
  { nome: "MC18 isolamento da una sola delle altre imprese", file: S, cerca: "IMPRESE.filter((x) => x !== utente.impresa)) {", con: "IMPRESE.filter((x) => x !== utente.impresa).slice(0, 1)) {", richiede: "CB18." },
  { nome: "MC19 risposta 500 presa per accesso negato", file: S, cerca: '  else if (viste.errore !== undefined && !STATI_SCRITTURA_RESPINTA.has(viste.errore)) esito = "ERRORE";\n', con: "", richiede: "CB32." },
  { nome: "MC20 gara D2 dell'impresa 3 non controllata al passo 4", file: S, cerca: "    if (utente.garaD2Invisibile) {", con: "    if (false) {", richiede: "CB21." },
  { nome: "MC21 gara D2 non dichiarata accettata", file: S, cerca: 'if (a.righe.length > 1 || conformi !== a.righe.length || dallUfficio !== a.righe.length) esito = "VIOLAZIONE";', con: 'if (a.righe.length > 1) esito = "VIOLAZIONE";', richiede: "CB43." },
  { nome: "MC22 gara D2 riconosciuta anche fuori da .invalid", file: S, cerca: 'host.endsWith(".invalid")', con: "host.length > 0", richiede: "CB53." },
  // verifiche finali
  { nome: "MC23 «usate» dell'impresa 2 non confrontato alla fine", file: S, cerca: 'usate === 0 && usateIniziali === 0 ? "ok" : "VIOLAZIONE"', con: '"ok"', richiede: "CB39." },
  { nome: "MC24 registro delle gare gratuite ignorato", file: S, cerca: 'registro.n === 0 ? "ok" : "VIOLAZIONE"', con: '"ok"', richiede: "CB40." },
  { nome: "MC25 salvate dell'impresa 2 tollerate", file: S, cerca: "[[id1, 3], [id3, 4], [id2, 0]]", con: "[[id1, 3], [id3, 4], [id2, 9]]", richiede: "CB46." },
  { nome: "MC26 profilo scritto dall'Ufficio Gare ignorato", file: S, cerca: 'daUfficio.n === 0 ? "ok"', con: 'daUfficio.n >= 0 ? "ok"', richiede: "CB48." },
  { nome: "MC27 autore del profilo non controllato", file: S, cerca: "const autoreGiusto = suoi.every((p) => p.aggiornato_da === id);", con: "const autoreGiusto = true;", richiede: "CB68." },
  { nome: "MC28 finestra della verifica nel futuro (margine sbagliato)", file: S, cerca: "export const MARGINE_INIZIO_MS = 5 * 60 * 1000;", con: "export const MARGINE_INIZIO_MS = -60 * 60 * 1000;", richiede: "CB23." },
  // ambiente, segreti
  { nome: "MC29 interruttore «Per te» non controllato", file: S, cerca: 'if (v.RADAR_PER_TE !== "attivo") e.push(', con: "if (false) e.push(", richiede: "CB6." },
  { nome: "MC30 notifiche accese tollerate", file: S, cerca: 'if (!["", "0"].includes(v[k] ?? "")) e.push(', con: "if (false) e.push(", richiede: "CB6." },
  { nome: "MC31 collegamento stampato a schermo", file: S, cerca: "const tokenHash = await generaCollegamento({ variabili, email: utente.email, fetchFn });", con: "const tokenHash = await generaCollegamento({ variabili, email: utente.email, fetchFn });\n      console.log(`collegamento ${tokenHash}`);", richiede: "CB27." },
  // misure (controllo 10) e lettura degli elenchi (controlli 2 e 3)
  { nome: "MC32 segnale di presenza contato come richiesta della pagina", file: S, cerca: "const pagina = staging - presenze - (per.utente ?? 0) - (per.rinnovo ?? 0);", con: "const pagina = staging;", richiede: "CB62." },
  { nome: "MC33 finestra ferma sotto i 60 s accettata", file: S, cerca: "if (durata < 60) problemi.push(", con: "if (durata < 0) problemi.push(", richiede: "CB63." },
  { nome: "MC34 pid del collaudo non escluso", file: S, cerca: ".filter((r) => !escludiPid.includes(r.pid));", con: ";", richiede: "CB62." },
  { nome: "MC35 gare doppie non viste", file: S, cerca: "    if (viste.has(c)) doppie.push(c);", con: "    if (false) doppie.push(c);", richiede: "CB61." },
];

process.exit(eseguiMutazioni({ radice: RADICE, verifica: "scripts/verifica-collaudo-accesso-b4.ts", mutazioni: MUTAZIONI }));
