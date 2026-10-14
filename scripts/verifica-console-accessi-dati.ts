// Autotest del registro degli accessi ai dati dei clienti (console, migrazione 0082).
//
// Il registro è una promessa contrattuale (condizioni art. 10, Allegato A art. 4): ogni
// accesso con data, ora, operatore e motivo; estratto a richiesta del cliente. Qui si prova
// la validazione di una registrazione, il fuso di Roma, la scelta delle righe di un cliente
// (compresi gli accessi generali al database), l'estratto in testo e CSV, la migrazione
// (solo aggiunta, nessun permesso agli utenti) e le guardie di sicurezza di pagine e azione.
// Gratuito, nessun database né rete: gira nel livello 1, quindi in prebuild.
import fs from "fs";
import path from "path";
import {
  CASI_ACCESSO,
  CASI_GENERALI,
  ETICHETTA_CASO,
  LETTERA_CASO,
  costruisciCsvEstratto,
  frasePrincipaleEstratto,
  leggiFiltroAccessi,
  righeDelCliente,
  righeEstratto,
  validaRegistrazione,
  type RegistrazioneInput,
  type RigaAccesso,
} from "../src/lib/console/accessi-dati-calcoli";
import { istanteRoma } from "../src/lib/console/periodo";

const fallimenti: string[] = [];
function atteso(nome: string, ok: boolean, dettaglio = "") {
  console.log(`${ok ? "ok    " : "FALLITO"} ${nome}${ok ? "" : ` — ${dettaglio}`}`);
  if (!ok) fallimenti.push(nome);
}
function uguale<T>(nome: string, ottenuto: T, previsto: T) {
  atteso(nome, JSON.stringify(ottenuto) === JSON.stringify(previsto), `ottenuto ${JSON.stringify(ottenuto)}, previsto ${JSON.stringify(previsto)}`);
}
const leggi = (relativo: string) => fs.readFileSync(path.join(__dirname, "..", relativo), "utf-8").replace(/\r\n/g, "\n");

const ADESSO = new Date("2026-10-14T10:00:00Z");
const base: RegistrazioneInput = {
  caso: "assistenza_tecnica",
  riguarda: "cliente",
  clienteEmail: "Cliente@Esempio.IT",
  motivo: "Il cliente ha segnalato che l'analisi si blocca (richiesta del 12/10).",
  ambito: "Documenti della gara X, dal pannello Supabase",
  data: "",
  ora: "",
  garaId: "",
};
const errore = (campi: Partial<RegistrazioneInput>) => {
  const r = validaRegistrazione({ ...base, ...campi }, ADESSO);
  return r.ok ? null : r.errore;
};

console.log("--- Registrazione valida ---");
const valida = validaRegistrazione(base, ADESSO);
atteso("una registrazione completa è accettata", valida.ok);
if (valida.ok) {
  uguale("l'email del cliente si normalizza in minuscolo", valida.valori.clienteEmail, "cliente@esempio.it");
  uguale("senza giorno e ora vale adesso", valida.valori.accessoIl.toISOString(), ADESSO.toISOString());
  uguale("la gara è facoltativa", valida.valori.garaId, null);
}
const generale = validaRegistrazione({ ...base, caso: "manutenzione_sicurezza", riguarda: "tutti", clienteEmail: "" }, ADESSO);
atteso("manutenzione/sicurezza può riguardare tutti i clienti (nessuna email)", generale.ok && generale.valori.tuttiIClienti && generale.valori.clienteEmail === null);
atteso("obbligo di legge può riguardare tutti i clienti", validaRegistrazione({ ...base, caso: "obbligo_di_legge", riguarda: "tutti", clienteEmail: "" }, ADESSO).ok);
uguale("i casi generali sono solo manutenzione/sicurezza e obbligo di legge", [...CASI_GENERALI], ["manutenzione_sicurezza", "obbligo_di_legge"]);

console.log("--- Registrazione rifiutata ---");
atteso("caso sconosciuto", errore({ caso: "curiosita" }) !== null);
atteso("caso vuoto", errore({ caso: "" }) !== null);
atteso("assistenza tecnica su «tutti i clienti»: no, nasce dalla richiesta di uno", (errore({ caso: "assistenza_tecnica", riguarda: "tutti", clienteEmail: "" }) ?? "").includes("richiesta di un cliente"));
atteso("revisione umana su «tutti i clienti»: no", errore({ caso: "revisione_umana", riguarda: "tutti", clienteEmail: "" }) !== null);
atteso("cliente senza email", errore({ clienteEmail: "" }) !== null);
atteso("email non valida", errore({ clienteEmail: "non-una-email" }) !== null);
atteso("motivo troppo corto", errore({ motivo: "boh" }) !== null);
atteso("motivo di soli spazi", errore({ motivo: "                    " }) !== null);
atteso("motivo di 1001 caratteri", errore({ motivo: "x".repeat(1001) }) !== null);
atteso("motivo di 1000 caratteri accettato", errore({ motivo: "x".repeat(1000) }) === null);
atteso("«cosa hai guardato» troppo corto", errore({ ambito: "ab" }) !== null);
atteso("«cosa hai guardato» di 501 caratteri", errore({ ambito: "x".repeat(501) }) !== null);
atteso("id di gara non valido", errore({ garaId: "123" }) !== null);
atteso("id di gara valido accettato", errore({ garaId: "11111111-1111-4111-8111-111111111111" }) === null);

console.log("--- Quando è avvenuto (ora di Roma) ---");
atteso("giorno senza ora: rifiutato", errore({ data: "2026-10-13" }) !== null);
atteso("ora senza giorno: rifiutata", errore({ ora: "10:30" }) !== null);
atteso("ora non valida", errore({ data: "2026-10-13", ora: "25:00" }) !== null);
atteso("giorno inesistente", errore({ data: "2026-02-31", ora: "10:00" }) !== null);
const ieri = validaRegistrazione({ ...base, data: "2026-10-13", ora: "10:30" }, ADESSO);
uguale("13 ottobre 10:30 a Roma (ora legale) = 08:30 UTC", ieri.ok ? ieri.valori.accessoIl.toISOString() : null, "2026-10-13T08:30:00.000Z");
const inverno = validaRegistrazione({ ...base, data: "2026-12-01", ora: "10:30" }, new Date("2026-12-02T10:00:00Z"));
uguale("1 dicembre 10:30 a Roma (ora solare) = 09:30 UTC", inverno.ok ? inverno.valori.accessoIl.toISOString() : null, "2026-12-01T09:30:00.000Z");
atteso("nel futuro: rifiutato", errore({ data: "2026-10-14", ora: "13:00" }) !== null);
atteso("poco prima di adesso (entro la tolleranza di orologio): accettato", errore({ data: "2026-10-14", ora: "12:01" }) === null);
atteso("più di sette giorni fa: rifiutato", errore({ data: "2026-10-06", ora: "09:00" }) !== null);
atteso("sette giorni fa esatti: accettato", errore({ data: "2026-10-07", ora: "13:00" }) === null);
uguale("istanteRoma: giorno del passaggio all'ora legale (29/03/2026), mezzogiorno", istanteRoma("2026-03-29", "12:00").toISOString(), "2026-03-29T10:00:00.000Z");
uguale("istanteRoma: giorno del ritorno all'ora solare (25/10/2026), mezzogiorno", istanteRoma("2026-10-25", "12:00").toISOString(), "2026-10-25T11:00:00.000Z");
uguale("istanteRoma: mezzanotte invernale", istanteRoma("2026-01-15", "00:00").toISOString(), "2026-01-14T23:00:00.000Z");

console.log("--- Righe di un cliente ---");
const riga = (id: string, extra: Partial<RigaAccesso>): RigaAccesso => ({
  id,
  creatoIl: "2026-10-10T10:00:00Z",
  accessoIl: "2026-10-10T10:00:00Z",
  operatoreEmail: "admin@omniaitalia.com",
  clienteId: null,
  clienteEmail: null,
  tuttiIClienti: false,
  caso: "assistenza_tecnica",
  motivo: "motivo di prova",
  ambito: "ambito di prova",
  garaId: null,
  ...extra,
});
const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const tutte = [
  riga("1", { clienteId: A, clienteEmail: "a@x.it", accessoIl: "2026-10-01T10:00:00Z" }),
  riga("2", { clienteId: B, clienteEmail: "b@x.it" }),
  riga("3", { tuttiIClienti: true, caso: "manutenzione_sicurezza", accessoIl: "2026-10-05T10:00:00Z" }),
  riga("4", { clienteId: null, clienteEmail: "a@x.it", accessoIl: "2026-10-09T10:00:00Z" }),
  riga("5", { clienteId: null, clienteEmail: "altro@x.it" }),
];
uguale("per il cliente A: le sue righe, l'accesso generale e quella senza id con la sua email, dal più recente", righeDelCliente(tutte, { id: A, email: "a@x.it" }).map((r) => r.id), ["4", "3", "1"]);
uguale("per il cliente B: la sua riga e l'accesso generale (non quelle di A)", righeDelCliente(tutte, { id: B, email: "b@x.it" }).map((r) => r.id), ["2", "3"]);
uguale("un cliente senza accessi propri vede comunque quelli generali", righeDelCliente(tutte, { id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", email: "c@x.it" }).map((r) => r.id), ["3"]);
uguale("senza email non si agganciano le righe «per email»", righeDelCliente(tutte, { id: A, email: null }).map((r) => r.id), ["3", "1"]);
uguale("l'email si confronta senza badare alle maiuscole", righeDelCliente(tutte, { id: A, email: "A@X.IT" }).map((r) => r.id), ["4", "3", "1"]);

console.log("--- Frase e CSV dell'estratto ---");
const nessuno = { da: null, a: null };
atteso("zero accessi: lo dice esplicitamente", frasePrincipaleEstratto(0, 0, nessuno).includes("non risulta alcun accesso"));
atteso("un accesso", frasePrincipaleEstratto(1, 0, nessuno).includes("risulta 1 accesso"));
atteso("più accessi", frasePrincipaleEstratto(3, 0, nessuno).includes("risultano 3 accessi"));
atteso("gli accessi generali sono dichiarati", frasePrincipaleEstratto(3, 2, nessuno).includes("di cui 2 generali al database"));
atteso("il periodo compare nella frase", frasePrincipaleEstratto(0, 0, { da: "01/10/2026", a: "31/10/2026" }).includes("dal 01/10/2026 al 31/10/2026"));
const csv = costruisciCsvEstratto(
  righeEstratto([
    riga("1", { clienteId: A, clienteEmail: "a@x.it", motivo: "=HYPERLINK(\"http://x\")", ambito: "tabella gare; campo note", garaId: B }),
    riga("2", { tuttiIClienti: true, caso: "obbligo_di_legge" }),
  ]),
);
atteso("CSV con BOM UTF-8 e righe CRLF", csv.startsWith("﻿") && csv.includes("\r\n"));
uguale("intestazione e due righe", csv.trim().split("\r\n").length, 3);
atteso("la formula nel motivo è neutralizzata (CSV injection)", csv.includes("'=HYPERLINK") && !/;=HYPERLINK/.test(csv));
atteso("una cella con punto e virgola è tra virgolette", csv.includes("\"tabella gare; campo note\""));
atteso("il caso compare con la sua lettera dell'Allegato A", csv.includes("a) Assistenza tecnica richiesta dal cliente") && csv.includes("d) Obbligo di legge"));
atteso("l'accesso generale è dichiarato come tale", csv.includes("Accesso generale al database"));
atteso("data e ora in fuso di Roma, con i secondi", /10\/10\/2026,? 12:00:00/.test(csv), csv.split("\r\n")[1]);
uguale("nessun accesso: solo l'intestazione", costruisciCsvEstratto([]).trim().split("\r\n").length, 1);

console.log("--- Filtri della pagina ---");
uguale("caso sconosciuto ignorato, email in minuscolo", leggiFiltroAccessi({ caso: "boh", cliente: "  Mario@X.IT " }), { cliente: "mario@x.it", caso: "" });
uguale("caso noto accettato", leggiFiltroAccessi({ caso: "revisione_umana" }).caso, "revisione_umana");
atteso("filtro cliente limitato a 200 caratteri", leggiFiltroAccessi({ cliente: "x".repeat(500) }).cliente.length === 200);

console.log("--- I quattro casi sono quelli dell'Allegato A ---");
const allegato = leggi("legal/allegato-a-nomina-responsabile-v1.md");
const condizioni = leggi("legal/condizioni-abbonamento-v2.md");
uguale("quattro casi, lettere a-d", CASI_ACCESSO.map((c) => LETTERA_CASO[c]), ["a", "b", "c", "d"]);
for (const [caso, parola] of [
  ["assistenza_tecnica", "assistenza tecnica"],
  ["revisione_umana", "revisione umana"],
  ["manutenzione_sicurezza", "manutenzione o sicurezza"],
  ["obbligo_di_legge", "di legge"],
] as const) {
  const lettera = LETTERA_CASO[caso];
  atteso(`caso ${lettera}) «${ETICHETTA_CASO[caso]}»: stesso tema della lettera ${lettera}) dell'Allegato A e delle condizioni`, new RegExp(`^${lettera}\\) .*${parola}`, "m").test(allegato) && condizioni.includes(parola), parola);
}
atteso("il registro promesso: data, ora, operatore e motivo (Allegato A art. 4 e condizioni)", /Ogni accesso è registrato con data, ora, operatore e motivo/.test(allegato) && /Ogni accesso è registrato con data, ora, operatore e motivo/.test(condizioni));

console.log("--- Migrazione 0082 ---");
const mig = leggi("supabase/migrations/0082_omnia_ai_accessi_dati.sql");
const sql = mig.split("\n").filter((r) => !r.trimStart().startsWith("--")).join("\n");
atteso("crea la tabella in modo idempotente", /create table if not exists public\.omnia_ai_accessi_dati/.test(sql));
for (const colonna of ["created_at", "accesso_il", "operatore_id", "operatore_email", "cliente_id", "cliente_email", "tutti_i_clienti", "caso", "motivo", "ambito", "gara_id"]) {
  atteso(`colonna «${colonna}»`, new RegExp(`\\b${colonna}\\b`).test(sql));
}
for (const caso of CASI_ACCESSO) atteso(`il vincolo ammette il caso «${caso}»`, sql.includes(`'${caso}'`));
uguale("il vincolo ammette esattamente i quattro casi", (sql.match(/caso in \(([^)]*)\)/)?.[1] ?? "").split(",").map((s) => s.trim().replace(/'/g, "")).filter(Boolean).sort(), [...CASI_ACCESSO].sort());
atteso("la RLS è attiva e non ci sono policy", /enable row level security/.test(sql) && !/create policy/i.test(sql));
atteso("alla chiave di servizio solo SELECT e INSERT", /grant select, insert on public\.omnia_ai_accessi_dati to service_role/.test(sql));
atteso("nessun permesso di modifica o cancellazione a nessuno", !/grant[^;]*\b(update|delete|truncate|all)\b[^;]*omnia_ai_accessi_dati/i.test(sql));
atteso("nessun permesso agli utenti (anon, authenticated)", !/to (anon|authenticated)/i.test(sql));
atteso("un trigger rifiuta update e delete anche a chi avesse i permessi", /before update or delete on public\.omnia_ai_accessi_dati/.test(sql) && /raise exception/.test(sql));
atteso("nessuna chiave esterna su operatore e cliente (il registro sopravvive agli utenti)", !/references/i.test(sql));
atteso("motivo e ambito hanno lunghezza minima e massima", /char_length\(btrim\(motivo\)\) between 10 and 1000/.test(sql) && /char_length\(btrim\(ambito\)\) between 3 and 500/.test(sql));
atteso("un accesso è o su un cliente o generale; assistenza e revisione mai generali", /omnia_ai_accessi_dati_riguarda/.test(sql) && /omnia_ai_accessi_dati_caso_cliente/.test(sql));
atteso("nessuna cancellazione di dati altrui", !/\b(drop\s+table|delete\s+from|truncate)\b/i.test(sql));
atteso("limiti del codice e della migrazione coincidono (motivo 10-1000, ambito 3-500)", /MOTIVO_MIN = 10/.test(leggi("src/lib/console/accessi-dati-calcoli.ts")) && /MOTIVO_MAX = 1000/.test(leggi("src/lib/console/accessi-dati-calcoli.ts")) && /AMBITO_MIN = 3/.test(leggi("src/lib/console/accessi-dati-calcoli.ts")) && /AMBITO_MAX = 500/.test(leggi("src/lib/console/accessi-dati-calcoli.ts")));

console.log("--- Sicurezza: pagine, route e azione ---");
const primaDi = (sorgente: string, a: string, b: string) => sorgente.indexOf(a) !== -1 && sorgente.indexOf(a) < sorgente.indexOf(b);
const pagina = leggi("src/app/site-console/(app)/accessi-dati/page.tsx");
atteso("pagina del registro: controllo admin prima di leggere i dati", primaDi(pagina, "await richiediAdminPagina()", "leggiAccessi("));
const paginaEstratto = leggi("src/app/site-console/(app)/accessi-dati/estratto/[cliente]/page.tsx");
atteso("pagina dell'estratto: controllo admin prima di tutto", primaDi(paginaEstratto, "await richiediAdminPagina()", "await params") && primaDi(paginaEstratto, "await richiediAdminPagina()", "leggiEstratto("));
const rottaCsv = leggi("src/app/site-console/(app)/accessi-dati/estratto/[cliente]/csv/route.ts");
atteso("CSV dell'estratto: controllo admin prima di tutto", primaDi(rottaCsv, "await richiediAdminPagina()", "await params") && primaDi(rottaCsv, "await richiediAdminPagina()", "leggiEstratto("));
atteso("CSV mai in cache, scaricato come allegato", /"cache-control": "no-store"/.test(rottaCsv) && /attachment/.test(rottaCsv));
const azione = leggi("src/app/site-console/azioni/accessi-dati.ts");
atteso("l'azione parte dal controllo admin", primaDi(azione, "await richiediAdminAzione()", "validaRegistrazione("));
atteso("l'operatore è la sessione, mai un campo del modulo", /operatore_id: sessione\.userId/.test(azione) && /operatore_email: sessione\.email/.test(azione) && !/campo\("operatore/.test(azione) && !/formData\.get\("operatore/.test(azione));
atteso("l'azione solo inserisce: nessun update né delete sul registro", /\.insert\(/.test(azione) && !/\.(update|delete|upsert)\(/.test(azione));
atteso("se la tabella manca l'azione dice che l'accesso NON è stato registrato", /NON è stato registrato/.test(azione));

const toccano: string[] = [];
const visita = (dir: string) => {
  for (const voce of fs.readdirSync(path.join(__dirname, "..", dir), { withFileTypes: true })) {
    const relativo = `${dir}/${voce.name}`;
    if (voce.isDirectory()) visita(relativo);
    else if (/\.(ts|tsx)$/.test(voce.name) && /omnia_ai_accessi_dati/.test(leggi(relativo))) toccano.push(relativo);
  }
};
visita("src");
uguale("solo il codice della console tocca il registro (nessun sito pubblico)", toccano.sort(), ["src/app/site-console/azioni/accessi-dati.ts", "src/lib/console/accessi-dati.ts"]);
const lib = leggi("src/lib/console/accessi-dati.ts");
atteso("le letture non scrivono mai", !/\.(insert|update|delete|upsert)\(/.test(lib));

console.log("--- Pagine e navigazione ---");
const nav = leggi("src/app/site-console/_componenti/navigazione.ts");
atteso("voce «Accessi ai dati» nella barra laterale", /href: "\/accessi-dati", etichetta: "Accessi ai dati", pronto: true/.test(nav));
const scheda = leggi("src/app/site-console/_componenti/scheda-cliente-vista.tsx");
atteso("la scheda cliente mostra il riassunto degli accessi, l'estratto e «registra un accesso»", /Accessi del personale ai suoi dati/.test(scheda) && /accessi-dati\/estratto\/\$\{s\.utente\.id\}/.test(scheda) && /accessi-dati\?cliente=/.test(scheda));
atteso("la pagina della scheda passa il riassunto alla vista", /riassuntoAccessiCliente\(/.test(leggi("src/app/site-console/(app)/utenti/[id]/page.tsx")));
const vistaRegistro = leggi("src/app/site-console/_componenti/accessi-dati-vista.tsx");
atteso("la pagina dichiara la regola: ogni accesso si registra, anche da Supabase", /registralo qui/.test(vistaRegistro) && /Supabase/.test(vistaRegistro));
atteso("il modulo non chiede l'operatore (lo dice: è chi ha fatto l'accesso)", !/name="operatore"/.test(vistaRegistro) && /L&apos;operatore è chi ha effettuato l&apos;accesso/.test(vistaRegistro));
const vistaEstratto = leggi("src/app/site-console/_componenti/estratto-accessi-vista.tsx");
atteso("l'estratto ha il CSV, la stampa e la frase «nessun accesso» (da frasePrincipaleEstratto)", /Scarica CSV/.test(vistaEstratto) && /PulsanteStampa/.test(vistaEstratto) && /frasePrincipaleEstratto\(/.test(vistaEstratto));
const css = leggi("src/app/site-console/console.css");
atteso("la stampa dell'estratto nasconde barra laterale e comandi", /@media print/.test(css) && /\.cn-nascondi-stampa/.test(css) && /\.cn-barra,\s*\.cn-nascondi-stampa\s*\{\s*display: none !important;/.test(css));
atteso("la pagina pubblica «Riservatezza» promette l'estratto e la console lo produce", /puoi chiederne l'estratto/.test(leggi("src/lib/omnia-ai-riservatezza.ts")) && fs.existsSync(path.join(__dirname, "..", "src/app/site-console/(app)/accessi-dati/estratto/[cliente]/page.tsx")));
atteso("nessun sito pubblico rimanda al registro della console", !/accessi-dati/.test(leggi("src/lib/omnia-ai-riservatezza.ts")));

console.log("");
if (fallimenti.length > 0) {
  console.error(`${fallimenti.length} controlli falliti:\n - ${fallimenti.join("\n - ")}`);
  process.exit(1);
}
console.log("Tutti i controlli sono andati a buon fine.");
