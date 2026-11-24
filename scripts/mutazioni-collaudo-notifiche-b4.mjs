// Prove di mutazione dello script del collaudo del grado 3 della fase B4 (scripts/collaudo-notifiche-b4.mjs, piano 41). Per ogni mutazione si
// altera UN punto di sicurezza dello script, si lancia scripts/verifica-collaudo-notifiche-b4.ts (solo a secco: staging finto, nessuna rete)
// e deve fallire proprio la prova indicata. Motore comune con tempo massimo (scripts/lib/esegui-mutazioni.mjs): il file si ripristina SEMPRE
// dal buffer letto all'inizio (mai git checkout), prima di partire deve essere committato, alla fine si controlla che sia identico (sha256).
// Uso: node scripts/mutazioni-collaudo-notifiche-b4.mjs
import path from "node:path";
import { fileURLToPath } from "node:url";
import { eseguiMutazioni } from "./lib/esegui-mutazioni.mjs";

const RADICE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const S = "scripts/collaudo-notifiche-b4.mjs";

const MUTAZIONI = [
  // ambiente e partenza
  { nome: "MN1 RADAR_NOTIFICHE_PREFERENZE non controllato", file: S, cerca: 'if (v.RADAR_NOTIFICHE_PREFERENZE !== "attivo") e.push(', con: "if (false) e.push(", richiede: "CN5." },
  { nome: "MN2 motore delle email e registro dell'evidenza accesi tollerati", file: S, cerca: 'if (!["", "0"].includes(v[k] ?? "")) e.push(', con: "if (false) e.push(", richiede: "CN5." },
  { nome: "MN3 RADAR_REGISTRO_EVIDENZA fuori dal controllo", file: S, cerca: 'for (const k of ["RADAR_NOTIFICHE_EMAIL", "RADAR_REGISTRO_EVIDENZA"])', con: 'for (const k of ["RADAR_NOTIFICHE_EMAIL"])', richiede: "CN5." },
  { nome: "MN4 RADAR_UFFICIO_GARE non controllato", file: S, cerca: 'if (v.RADAR_UFFICIO_GARE !== "attivo") e.push(', con: "if (false) e.push(", richiede: "CN5." },
  { nome: "MN5 finestra senza sorveglianza della rete", file: S, cerca: "if (!fileRete) throw new Fermo(", con: "if (false) throw new Fermo(", richiede: "CN7." },
  { nome: "MN6 registro dell'osservatore dentro il progetto ammesso", file: S, cerca: "if (dentro(fileRete, cartella)) throw new Fermo(", con: "if (false) throw new Fermo(", richiede: "CN7." },
  // sorveglianza della rete e registro finale
  { nome: "MN7 la sorveglianza non ferma", file: S, cerca: "        alFuori(r.host);\n", con: "", richiede: "CN17." },
  { nome: "MN8 la sorveglianza non riconosce gli host esterni", file: S, cerca: '      if (categoria(r) === "FUORI") {', con: "      if (false) {", richiede: "CN17." },
  { nome: "MN9 la sorveglianza legge anche il registro di prima", file: S, cerca: "    posizione = fs.statSync(file).size;", con: "    posizione = 0;", richiede: "CN17." },
  { nome: "MN10 verifiche finali sul registro di prima della finestra", file: S, cerca: "(r) => r.t >= daQuando && categoria(r)", con: "(r) => categoria(r)", richiede: "CN9." },
  { nome: "MN11 richieste esterne nel registro tollerate alla fine", file: S, cerca: '(attese 0)`, fuori.length === 0 ? "ok" : "VIOLAZIONE"', con: '(attese 0)`, "ok"', richiede: "CN15." },
  { nome: "MN12 la violazione della rete non spegne l'app", file: S, cerca: "      server.ferma(`[10] richiesta del server verso un host esterno (${host})`);\n", con: "", richiede: "CN17." },
  // prerequisiti (409, nessun collegamento)
  { nome: "MN13 0124 non controllata", file: S, cerca: "if (r.errore !== undefined) return { ok: false, motivo: `la 0124 non risulta applicata", con: "if (false) return { ok: false, motivo: `la 0124 non risulta applicata", richiede: "CN11." },
  { nome: "MN14 0125 presente tollerata", file: S, cerca: "if (r.errore !== 404) return { ok: false, motivo:", con: "if (false) return { ok: false, motivo:", richiede: "CN11." },
  { nome: "MN15 Ufficio Gare dell'impresa 3 non controllati", file: S, cerca: "if (tutti.n !== 1 || ufficio.n !== 1) return", con: "if (false) return", richiede: "CN11." },
  { nome: "MN16 membri dell'impresa 1 non controllati", file: S, cerca: "if (r.n !== 0) return { ok: false, motivo: `l'impresa 1 ha membri", con: "if (false) return { ok: false, motivo: `l'impresa 1 ha membri", richiede: "CN11." },
  { nome: "MN17 impresa 3 accesa non controllata", file: S, cerca: "if (r.n !== 1) return { ok: false, motivo: `gli avvisi email dell'impresa 3", con: "if (false) return { ok: false, motivo: `gli avvisi email dell'impresa 3", richiede: "CN11." },
  { nome: "MN18 Radar dell'impresa non controllato", file: S, cerca: "if (r.n !== 1) return { ok: false, motivo: `il Radar dell'impresa di", con: "if (false) return { ok: false, motivo: `il Radar dell'impresa di", richiede: "CN11." },
  // verifiche con il token
  { nome: "MN19 0124 non vuota all'apertura tollerata", file: S, cerca: '(attese 0)`, r.n === 0 ? "ok" : "ERRORE"));', con: '(attese 0)`, "ok"));', richiede: "CN12." },
  { nome: "MN20 tentativo di scrittura ammesso tollerato", file: S, cerca: 'STATI_SCRITTURA_RESPINTA.has(stato) ? "ok"', con: 'stato < 500 ? "ok"', richiede: "CN13." },
  { nome: "MN21 funzione dei destinatari aperta tollerata", file: S, cerca: 'STATI_FUNZIONE_RESPINTA.has(stato) ? "ok"', con: 'stato < 500 ? "ok"', richiede: "CN13." },
  { nome: "MN22 funzione dei destinatari mai chiamata", file: S, cerca: "stato = await lettore.tenta(chiamataDestinatari(idAltra), accessToken);", con: "stato = 404;", richiede: "CN13." },
  { nome: "MN23 risposta 500 presa per accesso negato", file: S, cerca: '  else if (viste.errore !== undefined && !STATI_SCRITTURA_RESPINTA.has(viste.errore)) esito = "ERRORE";\n', con: "", richiede: "CN13." },
  { nome: "MN24 positivo senza uguaglianza", file: S, cerca: '  else if (esistono.n === 0 || viste.n !== esistono.n) esito = "ERRORE";\n', con: "", richiede: "CN13." },
  { nome: "MN25 isolamento senza le tabelle della 0124", file: S, cerca: "[...TABELLE_0124, ...TABELLE_ISOLAMENTO].map(", con: "[...TABELLE_ISOLAMENTO].map(", richiede: "CN14." },
  { nome: "MN26 isolamento da una sola delle altre imprese", file: S, cerca: "for (const altra of IMPRESE.filter((x) => x !== utente.impresa)) {", con: "for (const altra of IMPRESE.filter((x) => x !== utente.impresa).slice(0, 1)) {", richiede: "CN14." },
  { nome: "MN27 l'Ufficio Gare che vede la riga del titolare tollerato", file: S, cerca: '      if (viste.n > 0) esito = "VIOLAZIONE";\n      else if (viste.errore !== undefined || esistono.errore', con: '      if (false) esito = "VIOLAZIONE";\n      else if (viste.errore !== undefined || esistono.errore', richiede: "CN14." },
  { nome: "MN28 tentativo PATCH senza il filtro impossibile", file: S, cerca: "&creato_il=lt.2000-01-01T00:00:00Z`", con: "`", richiede: "CN21." },
  { nome: "MN29 tentativo POST su un'impresa vera", file: S, cerca: "corpo: { impresa_id: ID_IMPOSSIBILE, user_id: idUtente, scadenze: true }", con: "corpo: { impresa_id: idImpresa, user_id: idUtente, scadenze: true }", richiede: "CN21." },
  { nome: "MN30 id della persona dell'impresa 3 nell'uscita", file: S, cerca: "  ricorda({ id3 });\n", con: "  ricorda({ id3 });\n  console.log(`persona dell'impresa 3: ${id3}`);\n", richiede: "CN9." },
  // verifiche finali
  { nome: "MN31 righe delle persone fuori elenco tollerate", file: S, cerca: 'per.righe.length <= TETTO_PERSONE && fuori === 0 ? "ok" : "VIOLAZIONE"', con: '"ok"', richiede: "CN15." },
  { nome: "MN32 imprese fuori elenco tollerate", file: S, cerca: 'imp.righe.length <= TETTO_IMPRESA && fuori === 0 ? "ok" : "VIOLAZIONE"', con: '"ok"', richiede: "CN15." },
  { nome: "MN33 riaccensione dell'Ufficio Gare non vista", file: S, cerca: " || u3.nuove_opportunita === true) esitoU", con: ") esitoU", richiede: "CN15." },
  { nome: "MN34 autore dell'interruttore non controllato", file: S, cerca: 'if (r && r.aggiornato_da !== id) esito = "VIOLAZIONE";', con: 'if (false) esito = "VIOLAZIONE";', richiede: "CN15." },
  { nome: "MN35 utilizzi nella finestra non controllati", file: S, cerca: '      ["omnia_ai_radar_utilizzi", "id", `user_id=${prova}&creato_il=gte.${enc(inizio)}`],\n', con: "", richiede: "CN15." },
  { nome: "MN36 0125 comparsa tollerata alla fine", file: S, cerca: '(attesa assente: 0125 non applicata)`, r.errore === 404 ? "ok" : "VIOLAZIONE"', con: '(attesa assente: 0125 non applicata)`, "ok"', richiede: "CN15." },
  { nome: "MN37 passo mancato dell'Ufficio Gare preso per riuscito", file: S, cerca: 'else if (u3.aggiornato_da !== idUfficio || !uguali(u3, ATTESE_FINALI.ufficio3)) esitoU = "NON RIUSCITO";', con: "", richiede: "CN16." },
  // tempo massimo
  { nome: "MN38 oltre il tempo massimo senza fermo", file: S, cerca: "    } else server.ferma(`finestra oltre ${DURATA_MASSIMA_MIN} minuti senza le verifiche finali`);", con: "    } else fermo.abort();", richiede: "CN18." },
  { nome: "MN39 tempo massimo che ferma anche dopo le verifiche finali", file: S, cerca: 'if (server.stato.finali === "fatte") {', con: "if (false) {", richiede: "CN18." },
  // nel browser
  { nome: "MN40 azione diretta con un identificativo qualsiasi", file: S, cerca: '  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(persona))) return { esito: "identificativo non valido: niente inviato" };\n', con: "", richiede: "CN20." },
  { nome: "MN41 riaccensione provata anche su una casella accesa", file: S, cerca: "  if (casella.checked || !casella.disabled) return", con: "  if (false) return", richiede: "CN20." },
  { nome: "MN42 lettura della pagina che non vede l'avviso mancante", file: S, cerca: 'avviso: t.includes("Gli avvisi email non sono ancora attivi"),', con: "avviso: true,", richiede: "CN20." },
];

process.exit(eseguiMutazioni({ radice: RADICE, verifica: "scripts/verifica-collaudo-notifiche-b4.ts", mutazioni: MUTAZIONI }));
