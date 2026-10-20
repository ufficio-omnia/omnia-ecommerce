// Autotest della PRESENZA degli utenti nell'area riservata di OMNIA AI (migrazione 0094): chi è collegato, se sta lavorando o è
// fermo, in quale sezione, quando è uscito. Si prova: la riduzione del percorso a una SEZIONE (mai quale gara), il controllo del
// segnale che arriva dal browser, il calcolo dello stato (collegato / attivo / fermo / offline / mai) con tutti i confini di tempo,
// i filtri della console, la migrazione, e ogni collegamento (rotta, componente nel browser, «Esci», layout, console).
// Gratuito, nessun database né rete: gira nel livello 1, quindi in prebuild.
import fs from "fs";
import path from "path";
import {
  DIMENSIONE_MASSIMA_CORPO,
  ETICHETTE_SEZIONE,
  FINESTRA_ATTIVITA_MS,
  INTERVALLO_SEGNALE_MS,
  SOGLIA_ATTIVO_MS,
  SOGLIA_ONLINE_MS,
  eOnline,
  etichettaSezione,
  leggiSegnale,
  sezioneDaPercorso,
  statoPresenza,
  testoPresenza,
  type PresenzaDb,
} from "../src/lib/omnia-ai-presenza-calcoli";
import { conteggiPerTipo, costruisciRigheUtenti, filtraUtenti, type DatiElencoUtenti } from "../src/lib/console/utenti-calcoli";

const fallimenti: string[] = [];
function atteso(nome: string, ok: boolean, dettaglio = "") {
  console.log(`${ok ? "ok    " : "FALLITO"} ${nome}${ok ? "" : ` — ${dettaglio}`}`);
  if (!ok) fallimenti.push(nome);
}
function uguale<T>(nome: string, ottenuto: T, previsto: T) {
  atteso(nome, JSON.stringify(ottenuto) === JSON.stringify(previsto), `ottenuto ${JSON.stringify(ottenuto)}, previsto ${JSON.stringify(previsto)}`);
}
const leggi = (relativo: string) => fs.readFileSync(path.join(__dirname, "..", relativo), "utf-8").replace(/\r\n/g, "\n");
const senzaCommenti = (t: string) => t.split("\n").filter((r) => !r.trim().startsWith("//")).join("\n");
const primaDi = (sorgente: string, a: string, b: string) => sorgente.indexOf(a) !== -1 && sorgente.indexOf(a) < sorgente.indexOf(b);

const ADESSO = new Date("2026-11-02T10:00:00.000Z");
const fa = (ms: number) => new Date(ADESSO.getTime() - ms).toISOString();

console.log("--- Le soglie ---");
uguale("segnale ogni 45 secondi, «attivo» se nell'ultimo minuto c'è stata attività", [INTERVALLO_SEGNALE_MS, FINESTRA_ATTIVITA_MS], [45_000, 60_000]);
uguale("collegato fino a 2 minuti e mezzo dall'ultimo segnale; attivo fino a 2 minuti dall'ultimo segnale attivo", [SOGLIA_ONLINE_MS, SOGLIA_ATTIVO_MS], [150_000, 120_000]);
atteso("la soglia di collegamento tollera la perdita di due segnali di fila (e non più di tre intervalli)", SOGLIA_ONLINE_MS >= 3 * INTERVALLO_SEGNALE_MS + 15_000 && SOGLIA_ONLINE_MS < 4 * INTERVALLO_SEGNALE_MS);
atteso("la finestra di attività è più lunga di un intervallo (un segnale «attivo» copre fino al prossimo)", FINESTRA_ATTIVITA_MS > INTERVALLO_SEGNALE_MS && SOGLIA_ATTIVO_MS > FINESTRA_ATTIVITA_MS);

console.log("--- Dal percorso alla sezione ---");
const R = "/dashboard/omnia-ai";
const casi: [string, string][] = [
  [R, "dashboard"],
  [`${R}/`, "dashboard"],
  [`${R}/gare`, "gare"],
  [`${R}/gare/`, "gare"],
  [`${R}/gare?x=1`, "gare"],
  [`${R}/gare/3f2a0c9e-1111-2222-3333-444455556666`, "gara"],
  [`${R}/gare/3f2a0c9e-1111-2222-3333-444455556666/revisione`, "gara"],
  [`${R}/gare/3f2a0c9e-1111-2222-3333-444455556666?tab=chat#fine`, "gara"],
  [`${R}/documenti-aziendali`, "documenti-aziendali"],
  [`${R}/profilo-azienda`, "profilo-azienda"],
  [`${R}/abbonamento`, "abbonamento"],
  [`${R}/abbonamento/qualcosa`, "abbonamento"],
  [`${R}/pagamenti`, "pagamenti"],
  [`${R}/pagamenti/fattura/x/y`, "pagamenti"],
  [`${R}/documenti-contrattuali`, "documenti-contrattuali"],
  [`${R}/ufficio-gare`, "ufficio-gare"],
  [`${R}/impostazioni`, "impostazioni"],
  [`${R}/assistenza`, "assistenza"],
  [`${R}/qualcosa-di-nuovo`, "altro"],
  ["/dashboard", "altro"],
  ["/login", "altro"],
  ["/dashboard/omnia-aiX", "altro"],
  [`${R}/../admin`, "altro"],
  ["", "altro"],
];
for (const [percorso, atteseSezione] of casi) uguale(`«${percorso}» → ${atteseSezione}`, sezioneDaPercorso(percorso), atteseSezione);
uguale("valori che non sono testo → altro", [sezioneDaPercorso(undefined), sezioneDaPercorso(null), sezioneDaPercorso(42), sezioneDaPercorso({}), sezioneDaPercorso(["a"])], ["altro", "altro", "altro", "altro", "altro"]);
uguale("un percorso troppo lungo → altro", sezioneDaPercorso(`${R}/gare/${"x".repeat(400)}`), "altro");
atteso("l'identificativo di una gara non esce mai dalla sezione (si vede solo «gara»)", !/3f2a0c9e/.test(sezioneDaPercorso(`${R}/gare/3f2a0c9e-1111`)));
atteso("ogni sezione ha un'etichetta leggibile, e una sezione sconosciuta in console diventa «Altra pagina»", Object.values(ETICHETTE_SEZIONE).every((e) => e.length > 0) && etichettaSezione("inventata") === "Altra pagina" && etichettaSezione(null) === null && etichettaSezione("gara") === "Dentro una gara");

console.log("--- Il segnale che arriva dal browser ---");
uguale("segnale valido: attivo e sezione", leggiSegnale(JSON.stringify({ attivo: true, percorso: `${R}/gare` })), { attivo: true, sezione: "gare" });
uguale("fermo", leggiSegnale(JSON.stringify({ attivo: false, percorso: R })), { attivo: false, sezione: "dashboard" });
uguale("percorso mancante o strano: segnale valido, sezione «altro»", [leggiSegnale('{"attivo":true}'), leggiSegnale('{"attivo":true,"percorso":5}')], [{ attivo: true, sezione: "altro" }, { attivo: true, sezione: "altro" }]);
uguale("campi in più si ignorano: nessuno può scrivere un utente o un testo libero", leggiSegnale(JSON.stringify({ attivo: true, percorso: R, userId: "altro-utente", sezione: "<script>", email: "x@y.it" })), { attivo: true, sezione: "dashboard" });
atteso("attivo non booleano → non valido (anche «\"true\"» scritto come testo, 0, 1, null, un elenco)", ['"true"', '"si"', "1", "0", "null", "[]", "{}"].every((v) => leggiSegnale(`{"attivo":${v}}`) === null));
atteso("senza «attivo» → non valido", leggiSegnale('{"percorso":"/x"}') === null);
atteso("non è un oggetto → non valido", ["[]", "[true]", '"testo"', "42", "null", "true"].every((v) => leggiSegnale(v) === null));
atteso("JSON rotto o vuoto → non valido", leggiSegnale("{") === null && leggiSegnale("") === null && leggiSegnale("attivo=true") === null);
atteso(`più di ${DIMENSIONE_MASSIMA_CORPO} caratteri → non valido`, leggiSegnale(JSON.stringify({ attivo: true, percorso: R, x: "y".repeat(DIMENSIONE_MASSIMA_CORPO) })) === null);
atteso("la sezione registrata è sempre una parola dell'elenco fisso", ["/a", R, `${R}/gare/1`, "https://sito.it/x", "<b>", `${R}/qualcosa`].every((p) => Object.keys(ETICHETTE_SEZIONE).includes(leggiSegnale(JSON.stringify({ attivo: true, percorso: p }))?.sezione ?? "")));

console.log("--- Lo stato: collegato, attivo, fermo, offline, mai ---");
const riga = (extra: Partial<PresenzaDb> = {}): PresenzaDb => ({
  user_id: "u1",
  ultimo_segnale: fa(10_000),
  ultima_attivita: fa(10_000),
  sezione: "gare",
  ingresso_il: fa(20 * 60_000),
  uscita_il: null,
  ...extra,
});
const stato = (extra: Partial<PresenzaDb> = {}) => statoPresenza(riga(extra), ADESSO);
uguale("nessuna riga: «mai»", statoPresenza(null, ADESSO).stato, "mai");
uguale("riga assente (undefined): «mai»", statoPresenza(undefined, ADESSO).stato, "mai");
uguale("segnale di 10 secondi fa, attività di 10 secondi fa: attivo", stato().stato, "attivo");
uguale("segnale di 10 secondi fa, ultima attività 5 minuti fa: fermo", stato({ ultima_attivita: fa(5 * 60_000) }).stato, "fermo");
uguale("segnale recente ma mai un segnale «attivo»: fermo", stato({ ultima_attivita: null }).stato, "fermo");
uguale("confine del collegamento: esattamente 150 secondi è ancora online, 150,001 no", [stato({ ultimo_segnale: fa(150_000), ultima_attivita: fa(150_000) }).stato !== "offline", stato({ ultimo_segnale: fa(150_001), ultima_attivita: fa(150_001) }).stato], [true, "offline"]);
uguale("confine dell'attività: 120 secondi è ancora «attivo», 120,001 «fermo»", [stato({ ultima_attivita: fa(120_000) }).stato, stato({ ultima_attivita: fa(120_001) }).stato], ["attivo", "fermo"]);
uguale("segnale di 3 minuti fa: offline", stato({ ultimo_segnale: fa(3 * 60_000) }).stato, "offline");
uguale("segnale di ieri: offline", stato({ ultimo_segnale: fa(24 * 3_600_000) }).stato, "offline");
uguale("offline anche con un'attività recente (conta il segnale)", stato({ ultimo_segnale: fa(10 * 60_000), ultima_attivita: fa(10_000) }).stato, "offline");
uguale("uscito con «Esci» dopo l'ultimo segnale: offline anche se il segnale è di 5 secondi fa", stato({ ultimo_segnale: fa(5_000), uscita_il: fa(2_000) }).stato, "offline");
uguale("uscito con «Esci» nello stesso istante dell'ultimo segnale: offline", stato({ ultimo_segnale: fa(5_000), uscita_il: fa(5_000) }).stato, "offline");
uguale("rientrato dopo l'uscita (segnale più recente dell'uscita): di nuovo online", stato({ uscita_il: fa(60_000), ultimo_segnale: fa(5_000) }).stato, "attivo");
atteso("un orario nel futuro oltre la finestra (orologi sballati) non risulta collegato", stato({ ultimo_segnale: new Date(ADESSO.getTime() + 10 * 60_000).toISOString() }).stato === "offline");
atteso("date illeggibili: offline, nessun errore", stato({ ultimo_segnale: "boh", ultima_attivita: "boh" }).stato === "offline");
const online = stato();
uguale("collegato: sezione e etichetta, da quando è in linea, nessuna uscita", [online.sezione, online.etichettaSezione, online.inSessioneDa, online.uscitoConEsciIl], ["gare", "Elenco gare", fa(20 * 60_000), null]);
const offlineEsci = stato({ ultimo_segnale: fa(10 * 60_000), uscita_il: fa(9 * 60_000) });
uguale("offline dopo «Esci»: uscitoConEsciIl valorizzato, non «in sessione»", [offlineEsci.uscitoConEsciIl, offlineEsci.inSessioneDa, offlineEsci.ultimaUscitaEsciIl], [fa(9 * 60_000), null, fa(9 * 60_000)]);
const offlineChiuso = stato({ ultimo_segnale: fa(10 * 60_000), uscita_il: fa(3 * 3_600_000) });
uguale("offline senza «Esci» (ha chiuso la scheda): uscitoConEsciIl vuoto; l'uscita di ore fa resta come «ultima uscita»", [offlineChiuso.uscitoConEsciIl, offlineChiuso.ultimaUscitaEsciIl, offlineChiuso.ultimoSegnale], [null, fa(3 * 3_600_000), fa(10 * 60_000)]);
const formatta = (iso: string) => `[${iso.slice(11, 16)}]`;
uguale("testo: attivo con la sezione", testoPresenza(online, formatta), "Online · attivo ora · Elenco gare");
uguale("testo: fermo", testoPresenza(stato({ ultima_attivita: null, sezione: "abbonamento" }), formatta), "Online · fermo · Abbonamento");
uguale("testo: offline dopo «Esci»", testoPresenza(offlineEsci, formatta), "Offline · uscito con «Esci» il [09:51]");
uguale("testo: offline senza «Esci»", testoPresenza(offlineChiuso, formatta), "Offline · ultimo segnale [09:50]");
uguale("testo: mai", testoPresenza(statoPresenza(null, ADESSO), formatta), "Mai visto in linea");
atteso("eOnline: attivo e fermo sì, offline e mai no", eOnline(online) && eOnline(stato({ ultima_attivita: null })) && !eOnline(offlineEsci) && !eOnline(statoPresenza(null, ADESSO)) && !eOnline(null));

console.log("--- La console: elenco utenti e filtro «Online ora» ---");
const dati = (presenze: PresenzaDb[]): DatiElencoUtenti => ({
  utenti: [
    { id: "T", email: "titolare@azienda.it", role: "cliente", created_at: "2026-09-01T00:00:00Z" },
    { id: "M", email: "ufficio@azienda.it", role: "cliente", created_at: "2026-09-02T00:00:00Z" },
    { id: "A", email: "admin@omniaitalia.com", role: "admin", created_at: "2026-08-01T00:00:00Z" },
    { id: "X", email: "altro@azienda.it", role: "cliente", created_at: "2026-09-03T00:00:00Z" },
  ],
  aziende: [],
  ordini: [],
  ordiniConAccettazioni: new Set(),
  abbonamenti: [],
  abbonamentiConAccettazioni: new Set(),
  crediti: [],
  messaggi: [],
  accessi: new Map(),
  membri: [{ membro_id: "M", titolare_id: "T", attivo: true }],
  presenze: new Map(presenze.map((p) => [p.user_id, p])),
});
const presenze = [riga({ user_id: "T" }), riga({ user_id: "M", ultima_attivita: null, sezione: "gara" }), riga({ user_id: "A" }), riga({ user_id: "X", ultimo_segnale: fa(3_600_000), uscita_il: fa(3_500_000) })];
const righe = costruisciRigheUtenti(dati(presenze), ADESSO);
const perId = (id: string) => righe.find((r) => r.id === id)!;
uguale("ogni riga porta la sua presenza (collegato attivo / fermo / offline)", [perId("T").presenza.stato, perId("M").presenza.stato, perId("X").presenza.stato], ["attivo", "fermo", "offline"]);
uguale("l'Ufficio Gare ha la sua presenza, separata da quella del titolare", [perId("M").presenza.etichettaSezione, perId("T").presenza.etichettaSezione, perId("M").ufficioGareDi?.titolareId], ["Dentro una gara", "Elenco gare", "T"]);
uguale("chi non ha mai dato un segnale: «mai»; senza tabella (presenze assenti): «mai» per tutti", [costruisciRigheUtenti(dati([]), ADESSO).every((r) => r.presenza.stato === "mai"), costruisciRigheUtenti({ ...dati([]), presenze: undefined }, ADESSO).every((r) => r.presenza.stato === "mai")], [true, true]);
uguale("filtro «Online ora»: titolare e Ufficio Gare, NON l'amministratore né chi è offline", filtraUtenti(righe, "online", "").map((r) => r.id).sort(), ["M", "T"]);
uguale("conteggio «Online ora»", conteggiPerTipo(righe).online, 2);
uguale("il filtro «Online ora» si combina con la ricerca", filtraUtenti(righe, "online", "ufficio@").map((r) => r.id), ["M"]);
uguale("il filtro «Tutti» non cambia", filtraUtenti(righe, "tutti", "").length, 4);

console.log("--- Migrazione 0094 ---");
const mig = leggi("supabase/migrations/0094_omnia_ai_presenza.sql");
const sql = mig.split("\n").filter((r) => !r.trimStart().startsWith("--")).join("\n");
atteso("tabella a UNA riga per utente (chiave = utente), cancellata con l'utente", /create table if not exists public\.omnia_ai_presenza \(\s*user_id uuid primary key references public\.users \(id\) on delete cascade/.test(sql));
atteso("solo orari e il nome della sezione (nessun indirizzo, nessun contenuto, nessun dato personale)", ["ultimo_segnale", "ultima_attivita", "sezione", "ingresso_il", "uscita_il"].every((c) => sql.includes(c)) && !/\b(ip|user_agent|email|percorso|path|url|gara_id|titolo|testo|contenuto)\b/i.test(sql.slice(sql.indexOf("create table"), sql.indexOf(");", sql.indexOf("create table")))));
atteso("la sezione è corta (massimo 40 caratteri)", /char_length\(sezione\) <= 40/.test(sql));
atteso("RLS attiva, nessuna policy, nessun permesso ai ruoli utente; solo la chiave di servizio", /alter table public\.omnia_ai_presenza enable row level security/.test(sql) && !/create policy/i.test(sql) && /revoke all on public\.omnia_ai_presenza from anon, authenticated/.test(sql) && /grant select, insert, update on public\.omnia_ai_presenza to service_role/.test(sql) && !/grant [^;]*\b(anon|authenticated)\b/i.test(sql));
atteso("le due funzioni si possono chiamare solo con la chiave di servizio", /revoke all on function public\.omnia_ai_presenza_segnale\(uuid, boolean, text\) from public, anon, authenticated/.test(sql) && /revoke all on function public\.omnia_ai_presenza_uscita\(uuid\) from public, anon, authenticated/.test(sql) && /grant execute on function public\.omnia_ai_presenza_segnale\(uuid, boolean, text\) to service_role/.test(sql) && /grant execute on function public\.omnia_ai_presenza_uscita\(uuid\) to service_role/.test(sql));
atteso("il segnale è un'unica istruzione (inserisce o aggiorna, senza leggere prima)", /insert into public\.omnia_ai_presenza as p[\s\S]*?on conflict \(user_id\) do update set/.test(sql));
atteso("la visita riparte dopo 10 minuti di silenzio o dopo un'uscita", /when p\.ultimo_segnale < now\(\) - interval '10 minutes' then now\(\)/.test(sql) && /when p\.uscita_il is not null and p\.uscita_il >= p\.ultimo_segnale then now\(\)/.test(sql));
atteso("l'attività avanza solo con un segnale «attivo»", /ultima_attivita = case when p_attivo then now\(\) else p\.ultima_attivita end/.test(sql));
atteso("entro 15 secondi da un'uscita con «Esci» il segnale si ignora (un battito in ritardo non fa risultare collegato chi è uscito)", /where p\.uscita_il is null or p\.uscita_il <= now\(\) - interval '15 seconds'/.test(sql));
atteso("la sezione è troncata a 40 caratteri anche nella funzione (difesa in più)", conta(sql, /left\(p_sezione, 40\)/g) >= 2);
atteso("l'uscita aggiorna solo chi ha già una riga (nessuna riga nuova per chi non è mai stato tracciato)", /update public\.omnia_ai_presenza set uscita_il = now\(\) where user_id = p_user/.test(sql) && !/insert/.test(sql.slice(sql.indexOf("omnia_ai_presenza_uscita"))));
atteso("nessuna cancellazione di dati, nessuna colonna tolta", !/\b(delete\s+from|truncate|drop\s+(table|column))\b/i.test(sql));
function conta(testo: string, re: RegExp): number {
  return (testo.match(re) ?? []).length;
}

console.log("--- La rotta del segnale ---");
const rotta = leggi("src/app/site-omnia-ai/api/presenza/route.ts");
const codiceRotta = senzaCommenti(rotta);
atteso("sta nella zona di OMNIA AI (omnia-ai.it/api/presenza viene riscritta lì), non tra le rotte condivise", fs.existsSync(path.join(__dirname, "..", "src/app/site-omnia-ai/api/presenza/route.ts")) && !fs.existsSync(path.join(__dirname, "..", "src/app/api/presenza")));
atteso("solo POST (nessun altro metodo esposto)", /export async function POST\(/.test(codiceRotta) && !/export (async )?function (GET|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/.test(codiceRotta));
atteso("chi è lo decide la sessione: prima si legge l'utente, senza sessione 401 e non si guarda nemmeno il corpo", primaDi(codiceRotta, "supabase.auth.getUser()", "request.headers.get(\"content-length\")") && /if \(!user\) return new Response\(null, \{ status: 401, headers: INTESTAZIONI \}\);/.test(codiceRotta) && primaDi(codiceRotta, "status: 401", "leggiCorpoLimitato(request, DIMENSIONE_MASSIMA_CORPO)"));
atteso("l'utente registrato è QUELLO DELLA SESSIONE: l'identificativo non viene mai dal corpo", /registraSegnale\(user\.id, segnale\)/.test(codiceRotta) && !/segnale\.(user|id|utente)/i.test(codiceRotta) && !/JSON\.parse/.test(codiceRotta));
atteso("il corpo ha un tetto (intestazione dichiarata e lettura a pezzi) → 413", /dichiarata > DIMENSIONE_MASSIMA_CORPO\) return new Response\(null, \{ status: 413/.test(codiceRotta) && /leggiCorpoLimitato\(request, DIMENSIONE_MASSIMA_CORPO\)/.test(codiceRotta) && /if \(totale > max\) \{\s*await lettore\.cancel\(\);\s*return null;/.test(codiceRotta));
atteso("corpo non valido → 400; valido → 204 senza contenuto; mai in cache", /if \(!segnale\) return new Response\(null, \{ status: 400/.test(codiceRotta) && /status: 204/.test(codiceRotta) && /"Cache-Control": "no-store"/.test(codiceRotta) && /export const dynamic = "force-dynamic"/.test(codiceRotta));
atteso("la rotta non scrive nel registro dei log il corpo né l'utente", !/console\.(log|error|info|warn)/.test(codiceRotta));
atteso("la scrittura passa dalla funzione del server (chiave di servizio), non dal client dell'utente", /from "@\/lib\/omnia-ai-presenza"/.test(codiceRotta) && !/\.from\("omnia_ai_presenza"\)/.test(codiceRotta));

console.log("--- La scrittura sul database ---");
const lib = leggi("src/lib/omnia-ai-presenza.ts");
const codiceLib = senzaCommenti(lib);
atteso("due sole operazioni: il segnale e l'uscita, tramite le due funzioni del database con parametri chiamati per nome", /rpc\("omnia_ai_presenza_segnale", \{ p_user: userId, p_attivo: segnale\.attivo, p_sezione: segnale\.sezione \}\)/.test(codiceLib) && /rpc\("omnia_ai_presenza_uscita", \{ p_user: userId \}\)/.test(codiceLib));
atteso("mai un errore per chi lavora: ogni funzione ha try/catch e restituisce true/false", conta(codiceLib, /try \{/g) === 2 && conta(codiceLib, /catch \(e\)/g) === 2 && conta(codiceLib, /return false;/g) >= 4);
atteso("prima della migrazione (funzione o tabella assenti) si ignora senza rumore", /PGRST202/.test(codiceLib) && /42883/.test(codiceLib) && /schemaAssente\(errore\)/.test(codiceLib) && /if \(!funzioneAssente\(error\)\) console\.error/.test(codiceLib));
atteso("la sezione registrata viene dal segnale già ridotto a parola dell'elenco (tipo SegnaleValido), mai da un testo libero", /import type \{ SegnaleValido \} from "@\/lib\/omnia-ai-presenza-calcoli"/.test(codiceLib));

console.log("--- Il componente nel browser ---");
const comp = leggi("src/components/omnia-ai/presenza-battito.tsx");
const codiceComp = senzaCommenti(comp);
atteso("è un componente del browser che non mostra niente", /^"use client";/.test(comp) && /return null;/.test(codiceComp));
atteso("manda il segnale con POST a /api/presenza, solo {attivo, percorso}, con la sessione del sito e senza cache", /fetch\("\/api\/presenza", \{\s*method: "POST"/.test(codiceComp) && /JSON\.stringify\(\{ attivo: adesso - ultimaAttivita < FINESTRA_ATTIVITA_MS, percorso: percorsoRef\.current \}\)/.test(codiceComp) && /credentials: "same-origin"/.test(codiceComp) && /cache: "no-store"/.test(codiceComp) && /keepalive: true/.test(codiceComp));
atteso("ritmo e finestra vengono dalle costanti provate sopra (non numeri scritti due volte)", /INTERVALLO_SEGNALE_MS/.test(codiceComp) && /FINESTRA_ATTIVITA_MS/.test(codiceComp) && /from "@\/lib\/omnia-ai-presenza-calcoli"/.test(codiceComp));
atteso("nessun segnale se la scheda non è visibile; quando torna visibile ne parte uno subito", /document\.visibilityState !== "visible"\) return;/.test(codiceComp) && /addEventListener\("visibilitychange", alCambioDiVisibilita\)/.test(codiceComp) && /if \(document\.visibilityState === "visible"\) invia\(true\);/.test(codiceComp));
atteso("l'attività si riconosce da mouse, tastiera, scorrimento e tocco", ["pointerdown", "pointermove", "keydown", "wheel", "touchstart", "scroll"].every((e) => codiceComp.includes(`"${e}"`)));
atteso("con 401 (sessione finita) smette; ogni errore di rete si ignora", /risposta\.status === 401\) fermato = true/.test(codiceComp) && /\.catch\(\(\) => \{\}\)/.test(codiceComp));
atteso("al cambio pagina il segnale riparte subito, ma non più di uno ogni 10 secondi", /INTERVALLO_MINIMO_MS = 10_000/.test(codiceComp) && /conMinimo && adesso - ultimoInvio < INTERVALLO_MINIMO_MS\) return;/.test(codiceComp) && /inviaRef\.current\?\.\(true\)/.test(codiceComp));
atteso("nessun cookie e nessun dato salvato nel browser", !/localStorage|sessionStorage|document\.cookie|indexedDB/.test(codiceComp));
atteso("si ripulisce da solo (timer e ascoltatori tolti allo smontaggio)", /window\.clearInterval\(timer\)/.test(codiceComp) && /removeEventListener\("visibilitychange"/.test(codiceComp) && /window\.removeEventListener\(evento, registraAttivita/.test(codiceComp));
atteso("legge dal browser solo il percorso della pagina (usePathname): niente titolo, testo, campi, indirizzo completo", /usePathname\(\)/.test(codiceComp) && !/document\.(title|body|location|referrer)|window\.location|innerText|textContent|\.value\b/.test(codiceComp));

console.log("--- Il layout e «Esci» ---");
const layout = leggi("src/app/site-omnia-ai/dashboard/omnia-ai/layout.tsx");
atteso("UN solo punto per tutte le schermate: il layout esportato mette il segnale e avvolge il layout vero", conta(layout, /<PresenzaBattito \/>/g) === 1 && /export default function OmniaAiLayout\(\{ children \}: \{ children: React\.ReactNode \}\) \{\s*return \(\s*<>\s*<PresenzaBattito \/>\s*<LayoutInterno>\{children\}<\/LayoutInterno>\s*<\/>\s*\);\s*\}/.test(layout) && conta(layout, /export default/g) === 1);
atteso("il layout vero (titolare, Ufficio Gare, attivazione, schermate «ferme») sta dentro, invariato nelle sue schermate", /async function LayoutInterno\(/.test(layout) && ["VistaUfficioGare", "SchermataFermo", "ActivateSubscriptionForm", "DashboardShell"].every((n) => layout.includes(n)));
const auth = leggi("src/app/actions/auth.ts");
const corpoSignOut = auth.slice(auth.indexOf("export async function signOut"));
atteso("«Esci» annota l'uscita PRIMA di chiudere la sessione, con l'utente della sessione", primaDi(corpoSignOut, "registraUscita(user.id)", "supabase.auth.signOut()") && /supabase\.auth\.getUser\(\)/.test(corpoSignOut));
atteso("«Esci» non può essere impedito dalla presenza: try/catch, e poi esce e rimanda al login comunque", /try \{[\s\S]*?registraUscita\(user\.id\)[\s\S]*?\} catch \(e\) \{[\s\S]*?\}\s*await supabase\.auth\.signOut\(\);\s*redirect\("\/login"\);/.test(corpoSignOut));

console.log("--- La console ---");
const presConsole = leggi("src/lib/console/presenza.ts");
const codicePresConsole = senzaCommenti(presConsole);
atteso("la console LEGGE soltanto (nessuna scrittura, nessuna funzione del database), con la chiave di servizio", !/\.(insert|update|delete|upsert|rpc)\(/.test(codicePresConsole) && /createAdminClient\(\)/.test(codicePresConsole));
atteso("senza tabella: «non disponibile», non un errore", /schemaAssente\(error\)/.test(codicePresConsole) && /disponibile: false/.test(codicePresConsole));
atteso("«Online adesso» esclude gli amministratori e mette prima gli attivi", /u\.role === "admin"\) continue/.test(codicePresConsole) && /p\.stato === "attivo" \? 0 : 1/.test(codicePresConsole));
atteso("«Online adesso» dice di chi è un Ufficio Gare (azienda del titolare o la sua email)", /omnia_ai_membri/.test(codicePresConsole) && /ufficioGareDi: titolareId/.test(codicePresConsole));
const pannPagina = leggi("src/app/site-console/(app)/page.tsx");
atteso("la Panoramica: pagina riservata agli amministratori, poi legge chi è online e lo passa alla vista", primaDi(pannPagina, "richiediAdminPagina()", "leggiOnlineAdesso()") && /online=\{online\}/.test(pannPagina));
const schedaPagina = leggi("src/app/site-console/(app)/utenti/[id]/page.tsx");
atteso("la scheda cliente: pagina riservata, presenza dell'utente e dell'Ufficio Gare (se è il titolare)", primaDi(schedaPagina, "richiediAdminPagina()", "leggiPresenzaUtente(id)") && /legameUfficioGare\?\.ruolo === "titolare" \? await leggiPresenzaUtente\(scheda\.legameUfficioGare\.ufficioGare\.id\)/.test(schedaPagina) && /presenza=\{presenza\} presenzaUfficioGare=\{presenzaUfficioGare\}/.test(schedaPagina));
const utentiLib = leggi("src/lib/console/utenti.ts");
atteso("l'elenco utenti legge la presenza insieme al resto e funziona anche senza", /leggiPresenze\(\),\s*\]\);/.test(utentiLib) && /presenze: presenze\.righe/.test(utentiLib) && /presenzaDisponibile: presenze\.disponibile/.test(utentiLib));
const utentiVista = leggi("src/app/site-console/_componenti/utenti-vista.tsx");
atteso("elenco utenti: colonna «Presenza», tessera e filtro «Online ora», nota se la migrazione manca, spiegazione, aggiornamento automatico", /etichetta: "Presenza"/.test(utentiVista) && /<CellaPresenza p=\{r\.presenza\} \/>/.test(utentiVista) && /etichetta="Online ora"/.test(utentiVista) && /migrazione 0094/.test(utentiVista) && /<strong>Presenza:<\/strong>/.test(utentiVista) && /<RicaricaAutomatica secondi=\{30\} \/>/.test(utentiVista));
const pannVista = leggi("src/app/site-console/_componenti/panoramica-vista.tsx");
atteso("Panoramica: tessera «Online adesso», tabella con ruolo, stato, sezione, in linea da, ultima attività; si aggiorna da sola", /etichetta="Online adesso"/.test(pannVista) && /<th>Dove si trova<\/th>/.test(pannVista) && /<th>In linea da<\/th>/.test(pannVista) && /<RicaricaAutomatica secondi=\{30\} \/>/.test(pannVista) && /Ufficio Gare di \{u\.ufficioGareDi\}/.test(pannVista));
const schedaVista = leggi("src/app/site-console/_componenti/scheda-cliente-vista.tsx");
atteso("scheda cliente: riquadro Presenza per chi non è amministratore, e la presenza dell'Ufficio Gare nel suo riquadro", /\{s\.utente\.ruolo !== "admin" && \(\s*<div className="cn-sezione">\s*<PannelloPresenza presenza=\{presenza\} \/>/.test(schedaVista) && /<dt>Presenza<\/dt>/.test(schedaVista) && /presenzaUfficioGare\?\.disponibile/.test(schedaVista));
atteso("la scheda cliente NON si ricarica da sola (ha dei moduli da compilare: si perderebbe ciò che si sta scrivendo)", !/RicaricaAutomatica/.test(schedaVista));
const ricarica = senzaCommenti(leggi("src/app/site-console/_componenti/ricarica-automatica.tsx"));
atteso("l'aggiornamento automatico rilegge solo a scheda visibile, ogni 30 secondi di default, e si ferma allo smontaggio", /secondi = 30/.test(ricarica) && /document\.visibilityState === "visible"\) router\.refresh\(\)/.test(ricarica) && /window\.clearInterval\(timer\)/.test(ricarica));
const pannelloVista = leggi("src/app/site-console/_componenti/presenza-vista.tsx");
atteso("il riquadro della scheda spiega la differenza tra «Esci» e chiusura della scheda, e che si registra solo la sezione", /È uscito senza premere «Esci»/.test(pannelloVista) && /Si registra solo la sezione, mai quale gara/.test(pannelloVista) && /Ultima uscita con «Esci»/.test(pannelloVista));

console.log("--- Nessun cambiamento ai testi legali (decisione dell'utente) ---");
atteso("l'informativa privacy e i documenti legali non sono toccati da questa funzione (nessuna parola «presenza» nei testi in vigore)", ["legal/privacy-policy-omnia-ai-v1.md", "legal/cookie-policy-omnia-ai-v1.md", "legal/condizioni-abbonamento-v2.md", "legal/allegato-a-nomina-responsabile-v1.md"].every((f) => !/presenza|segnale di presenza|online adesso/i.test(leggi(f))));

console.log("");
if (fallimenti.length > 0) {
  console.error(`${fallimenti.length} controlli falliti:\n - ${fallimenti.join("\n - ")}`);
  process.exit(1);
}
console.log("Tutti i controlli sono andati a buon fine.");
