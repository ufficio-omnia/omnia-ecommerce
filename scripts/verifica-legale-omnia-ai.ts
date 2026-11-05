// Autotest dei documenti legali di OMNIA AI: condizioni v2 e Allegato A (atto di nomina a
// responsabile del trattamento). Verifica che:
//   - ogni file in legal/ abbia l'impronta SHA-256 registrata nelle migrazioni (e quindi
//     che nessuna versione già pubblicata sia stata toccata);
//   - le condizioni v2 siano la v1 più il solo nuovo art. 10 e la rinumerazione;
//   - i numeri e i titoli delle clausole nella casella di approvazione specifica
//     corrispondano alle intestazioni dei testi, versione per versione;
//   - l'Allegato A abbia la struttura promessa (12 articoli, 4 segnaposto, 6 sottoresponsabili);
//   - l'interprete del markdown non scarti nulla e i segnaposto si compilino come previsto;
//   - le righe di accettazione registrate dal webhook includano l'Allegato A;
//   - tutti i punti di collegamento nel codice (moduli, azione, webhook, pagine) siano a posto.
// Gratuito, nessun database né rete: gira nel livello 1, quindi in prebuild.
import fs from "fs";
import path from "path";
import { createHash } from "crypto";
import { CLAUSOLE_SPECIFICHE, clausoleSpecifiche } from "../src/lib/omnia-ai-clausole";
import { compilaSegnaposto, dataEstesa, interpretaMarkdown, segnapostoRimasti, testoSemplice } from "../src/lib/legal-markdown";
import { recordOmniaAiLegalAcceptances, validateOmniaAiAcceptance } from "../src/lib/omnia-ai-legal";

const fallimenti: string[] = [];
function atteso(nome: string, ok: boolean, dettaglio = "") {
  console.log(`${ok ? "ok    " : "FALLITO"} ${nome}${ok ? "" : ` — ${dettaglio}`}`);
  if (!ok) fallimenti.push(nome);
}
function uguale<T>(nome: string, ottenuto: T, previsto: T) {
  atteso(nome, JSON.stringify(ottenuto) === JSON.stringify(previsto), `ottenuto ${JSON.stringify(ottenuto)}, previsto ${JSON.stringify(previsto)}`);
}
const radice = path.join(__dirname, "..");
const leggi = (relativo: string) => fs.readFileSync(path.join(radice, relativo), "utf-8").replace(/\r\n/g, "\n");
const sha = (testo: string) => createHash("sha256").update(testo).digest("hex");

console.log("--- Impronte: i file in legal/ sono quelli registrati nelle migrazioni ---");
const registrati: { tipo: string; versione: number; file: string; sha: string; migrazione: string }[] = [];
for (const migrazione of ["0052_omnia_ai_legal_documents_v1.sql", "0080_omnia_ai_condizioni_v2_allegato_a.sql", "0100_omnia_ai_privacy_cookie_v2.sql"]) {
  const sql = leggi(`supabase/migrations/${migrazione}`);
  for (const m of sql.matchAll(/\('(omnia_ai_[a-z_]+)',\s*(\d+),\s*.+?,\s*'(legal\/[^']+)',\s*'([0-9a-f]{64})'\)/g)) {
    registrati.push({ tipo: m[1], versione: Number(m[2]), file: m[3], sha: m[4], migrazione });
  }
}
uguale("le migrazioni 0052, 0080 e 0100 registrano sette documenti di OMNIA AI", registrati.map((r) => `${r.tipo} v${r.versione}`).sort(), [
  "omnia_ai_allegato_a v1",
  "omnia_ai_condizioni_abbonamento v1",
  "omnia_ai_condizioni_abbonamento v2",
  "omnia_ai_cookie_policy v1",
  "omnia_ai_cookie_policy v2",
  "omnia_ai_privacy_policy v1",
  "omnia_ai_privacy_policy v2",
]);
for (const r of registrati) {
  const impronta = fs.existsSync(path.join(radice, r.file)) ? sha(leggi(r.file)) : "(file mancante)";
  atteso(`${r.file}: impronta uguale a quella della migrazione ${r.migrazione.slice(0, 4)}`, impronta === r.sha, impronta);
}
atteso("i file hanno il newline finale e fine riga LF nel calcolo (convenzione delle impronte esistenti)", registrati.every((r) => leggi(r.file).endsWith("\n")));

console.log("--- Condizioni v2 = v1 + art. 10 + rinumerazione ---");
const v1 = leggi("legal/condizioni-abbonamento-v1.md");
const v2 = leggi("legal/condizioni-abbonamento-v2.md");
const dividi = (t: string) => t.split(/(?=^## \d+\. )/m);
const [testaV1, ...articoliV1] = dividi(v1);
const [testaV2, ...articoliV2] = dividi(v2);
uguale("v1: 17 articoli; v2: 18", [articoliV1.length, articoliV2.length], [17, 18]);
uguale("la testa cambia solo nella data di aggiornamento", testaV2.replace("ottobre 2026", "settembre 2026"), testaV1);
{
  // tolto il nuovo art. 10 e riportati i numeri indietro, la v2 deve essere identica alla v1
  const senzaNuovo = articoliV2.filter((a) => !a.startsWith("## 10. Riservatezza, base di conoscenza, accesso e trattamento dei dati"));
  const rinumerati = senzaNuovo.map((a) => a.replace(/^## (\d+)\. /, (_, n) => `## ${Number(n) >= 11 ? Number(n) - 1 : Number(n)}. `));
  uguale("togliendo l'art. 10 e riportando i numeri indietro, il testo è IDENTICO alla v1 (nessun'altra modifica)", rinumerati.join(""), articoliV1.join(""));
}
{
  const numeri = articoliV2.map((a) => Number(a.match(/^## (\d+)\./)?.[1]));
  uguale("la numerazione della v2 è 1…18, senza buchi né «9-bis»", numeri, Array.from({ length: 18 }, (_, i) => i + 1));
  atteso("nessun «9-bis» né riferimento a numeri vecchi nel testo", !/9-bis/.test(v2));
}
{
  const art10 = articoliV2.find((a) => a.startsWith("## 10. "))!;
  atteso("l'art. 10 contiene i cinque paragrafi (base di conoscenza, addestramento, accesso, nomina, titolarità) e il richiamo all'Allegato A", ["**Base di conoscenza.**", "**Addestramento.**", "**Accesso.**", "**Nomina a responsabile del trattamento.**", "**Titolarità dei dati caricati.**", "**Allegato A**"].every((s) => art10.includes(s)));
}

console.log("--- Casella di approvazione specifica: numeri e titoli contro i testi ---");
{
  const titoliV1 = new Map<number, string>();
  for (const m of leggi("src/components/omnia-ai/legal/condizioni-abbonamento-v1.tsx").matchAll(/<h2 id="clausola-(\d+)">\d+\. ([^<]+)<\/h2>/g)) titoliV1.set(Number(m[1]), m[2].replace(/&apos;/g, "'"));
  const titoliV2 = new Map<number, string>();
  for (const m of v2.matchAll(/^## (\d+)\. (.+)$/gm)) titoliV2.set(Number(m[1]), m[2]);
  for (const [versione, titoli] of [[1, titoliV1], [2, titoliV2]] as const) {
    for (const c of CLAUSOLE_SPECIFICHE[versione]) {
      atteso(`v${versione}: la clausola ${c.numero} nella casella si chiama come nel testo («${c.titolo}»)`, titoli.get(c.numero) === c.titolo, `nel testo: ${titoli.get(c.numero)}`);
    }
  }
  uguale("v1: clausole approvate 5, 8, 11, 14 (come prima)", CLAUSOLE_SPECIFICHE[1].map((c) => c.numero), [5, 8, 11, 14]);
  uguale("v2: clausole approvate 5, 8, 10, 12, 15 (Allegato A richiamato dall'art. 10)", CLAUSOLE_SPECIFICHE[2].map((c) => c.numero), [5, 8, 10, 12, 15]);
  const versioniNelleMigrazioni = registrati.filter((r) => r.tipo === "omnia_ai_condizioni_abbonamento").map((r) => r.versione);
  atteso("ogni versione delle condizioni registrata nelle migrazioni ha le sue clausole descritte", versioniNelleMigrazioni.every((v) => v in CLAUSOLE_SPECIFICHE), JSON.stringify(versioniNelleMigrazioni));
  uguale("la funzione sceglie la versione giusta e, per una sconosciuta, l'ultima nota", [clausoleSpecifiche(1).length, clausoleSpecifiche(2).length, clausoleSpecifiche(3).length, clausoleSpecifiche(0).length], [4, 5, 5, 4]);
}

console.log("--- Allegato A: struttura e segnaposto ---");
const allegato = leggi("legal/allegato-a-nomina-responsabile-v1.md");
{
  const doc = interpretaMarkdown(allegato);
  uguale("l'interprete non scarta nulla (nessun avviso)", doc.avvisi, []);
  const articoli = doc.blocchi.filter((b) => b.tipo === "h3" && b.id?.startsWith("art-"));
  uguale("12 articoli numerati 1…12", articoli.map((b) => b.tipo === "h3" ? b.id : null), Array.from({ length: 12 }, (_, i) => `art-${i + 1}`));
  const tabella = doc.blocchi.find((b) => b.tipo === "tabella");
  atteso("tabella dei sottoresponsabili: 4 colonne e i sei fornitori attesi", tabella?.tipo === "tabella" && tabella.intestazione.length === 4 && JSON.stringify(tabella.righe.map((r) => testoSemplice(r[0]))) === JSON.stringify(["Supabase", "Anthropic", "Voyage AI", "Vercel", "Resend", "Stripe"]));
  uguale("titolo e sottotitolo", [doc.blocchi[0].tipo === "h1" ? doc.blocchi[0].testo : null, doc.blocchi[1].tipo === "h2" ? doc.blocchi[1].testo : null], ["Allegato A alle Condizioni Generali di Abbonamento", "Atto di nomina a Responsabile del trattamento"]);
  uguale("segnaposto presenti nel testo versionato", segnapostoRimasti(allegato).sort(), ["[DATA]", "[PARTITA IVA CLIENTE]", "[RAGIONE SOCIALE CLIENTE]", "[SEDE CLIENTE]"].sort());
  atteso("ogni segnaposto dei dati del cliente compare UNA volta (la data anche nel testo)", (allegato.match(/\[RAGIONE SOCIALE CLIENTE\]/g) ?? []).length === 1 && (allegato.match(/\[PARTITA IVA CLIENTE\]/g) ?? []).length === 1 && (allegato.match(/\[SEDE CLIENTE\]/g) ?? []).length === 1 && (allegato.match(/\[DATA\]/g) ?? []).length === 1);
  atteso("art. 4: i quattro casi di accesso del personale e il registro degli accessi", ["su richiesta espressa del Titolare", "servizio di revisione umana", "necessità tecniche di manutenzione o sicurezza", "obbligo di legge o di un provvedimento"].every((s) => allegato.includes(s)) && allegato.includes("Ogni accesso è registrato con data, ora, operatore e motivo"));
}
{
  const doc2 = interpretaMarkdown(v2);
  uguale("l'interprete non scarta nulla nemmeno nelle condizioni v2", doc2.avvisi, []);
  atteso("le condizioni v2 si leggono come 18 titoli di secondo livello", doc2.blocchi.filter((b) => b.tipo === "h2").length === 18);
  uguale("id dei titoli: «clausola-N»", doc2.blocchi.filter((b) => b.tipo === "h2").slice(8, 12).map((b) => (b.tipo === "h2" ? b.id : null)), ["clausola-9", "clausola-10", "clausola-11", "clausola-12"]);
}

console.log("--- Interprete del markdown ---");
{
  const d = interpretaMarkdown("# Titolo\n\n## 3. Clausola\n\nUn **grassetto** e un *corsivo*\nsu due righe.\n\n- uno\n- **due**\n\n| A | B |\n|---|---|\n| 1 | 2 |\n");
  uguale("blocchi: titolo, clausola, paragrafo (righe unite), elenco, tabella", d.blocchi.map((b) => b.tipo), ["h1", "h2", "paragrafo", "elenco", "tabella"]);
  const p = d.blocchi[2];
  uguale("inline: testo, grassetto, testo, corsivo, testo", p.tipo === "paragrafo" ? p.inline.map((s) => s.tipo) : [], ["testo", "grassetto", "testo", "corsivo", "testo"]);
  atteso("le righe di un paragrafo si uniscono con uno spazio", p.tipo === "paragrafo" && testoSemplice(p.inline) === "Un grassetto e un corsivo su due righe.");
  uguale("nessun avviso su un testo ben formato", d.avvisi, []);
  atteso("sintassi non prevista (livello 4, elenco numerato, citazione, asterisco isolato, linea) → avviso, non scarto silenzioso", ["#### x", "1. uno", "> citazione", "testo con * asterisco", "---"].every((riga) => interpretaMarkdown(riga).avvisi.length > 0));
  atteso("fine riga Windows (CRLF) non cambia nulla", JSON.stringify(interpretaMarkdown("## 1. A\r\n\r\nTesto\r\n").blocchi) === JSON.stringify(interpretaMarkdown("## 1. A\n\nTesto\n").blocchi));
}

console.log("--- Compilazione dei segnaposto ---");
{
  const modello = "**[RAGIONE SOCIALE CLIENTE]**, P.IVA [PARTITA IVA CLIENTE], con sede in [SEDE CLIENTE]. Dal [DATA].";
  uguale("tutti i dati: il testo è completo", compilaSegnaposto(modello, { data: "14 ottobre 2026", ragioneSociale: "  Pulizie   Rossi S.r.l. ", partitaIva: "01234567890", sede: "Via Roma 1, Roma" }, "linea"), "**Pulizie Rossi S.r.l.**, P.IVA 01234567890, con sede in Via Roma 1, Roma. Dal 14 ottobre 2026.");
  uguale("senza partita IVA ma con codice fiscale (professionista): «C.F.»", compilaSegnaposto(modello, { data: "14 ottobre 2026", ragioneSociale: "Mario Rossi", codiceFiscale: "RSSMRA80A01H501U", sede: "Roma" }, "linea"), "**Mario Rossi**, C.F. RSSMRA80A01H501U, con sede in Roma. Dal 14 ottobre 2026.");
  uguale("PDF senza dati: righe da compilare a mano, la data resta", compilaSegnaposto(modello, { data: "14 ottobre 2026" }, "linea"), "**__________________**, P.IVA __________________, con sede in __________________. Dal 14 ottobre 2026.");
  uguale("pagina web senza dati: i segnaposto restano (è il modello); senza data resta anche [DATA]", compilaSegnaposto(modello, {}, "mantieni"), modello);
  uguale("senza alcun valore il modello resta identico al file", compilaSegnaposto(allegato, {}, "mantieni"), allegato);
  atteso("i campi vuoti o di soli spazi valgono come assenti", compilaSegnaposto(modello, { ragioneSociale: "   ", partitaIva: "", sede: " " }, "mantieni") === modello);
  uguale("compilato con tutti i dati l'Allegato A non ha più segnaposto", segnapostoRimasti(compilaSegnaposto(allegato, { data: "14 ottobre 2026", ragioneSociale: "X S.r.l.", partitaIva: "1", sede: "Roma" }, "linea")), []);
  uguale("la compilazione non tocca nient'altro: stesse righe, stesso numero di articoli", compilaSegnaposto(allegato, { data: "14 ottobre 2026", ragioneSociale: "X", partitaIva: "1", sede: "Roma" }, "linea").split("\n").length, allegato.split("\n").length);
  uguale("data estesa", [dataEstesa("2026-10-14"), dataEstesa("2026-01-01"), dataEstesa("non una data")], ["14 ottobre 2026", "1 gennaio 2026", "non una data"]);
}

// da qui in poi serve «await»: tsx non lo accetta a livello superiore, quindi tutto in main()
async function main() {
console.log("--- Registrazione delle accettazioni ---");
async function registra(allegatoA: { id: string; version: number } | null) {
  let righe: Record<string, unknown>[] = [];
  const admin = { from: () => ({ insert: async (r: Record<string, unknown>[]) => { righe = r; return { error: null }; } }) };
  await recordOmniaAiLegalAcceptances({
    admin: admin as never,
    subscriptionId: "sub-1",
    userId: "utente-1",
    documents: { condizioniAbbonamento: { id: "doc-cond", version: 2 }, privacyPolicy: { id: "doc-priv", version: 1 }, allegatoA },
    ip: "203.0.113.7",
    userAgent: "Mozilla/5.0",
    acceptedAt: "2026-10-14T10:00:00.000Z",
  });
  return righe.map((r) => `${r.acceptance_type}:${r.legal_document_id}`);
}
{
  uguale("senza Allegato A (checkout di sempre): 3 righe", await registra(null), ["condizioni_e_privacy:doc-cond", "condizioni_e_privacy:doc-priv", "clausole_specifiche:doc-cond"]);
  uguale("con l'Allegato A: 5 righe, due delle quali per l'Allegato (accettato con le condizioni e approvato specificamente)", await registra({ id: "doc-all", version: 1 }), [
    "condizioni_e_privacy:doc-cond",
    "condizioni_e_privacy:doc-priv",
    "clausole_specifiche:doc-cond",
    "condizioni_e_privacy:doc-all",
    "clausole_specifiche:doc-all",
  ]);
  // un evento ripetuto (violazione di unicità) non è un errore
  const adminDuplicato = { from: () => ({ insert: async () => ({ error: { code: "23505", message: "duplicate" } }) }) };
  const esito = await recordOmniaAiLegalAcceptances({ admin: adminDuplicato as never, subscriptionId: "s", userId: "u", documents: { condizioniAbbonamento: { id: "a", version: 2 }, privacyPolicy: { id: "b", version: 1 }, allegatoA: { id: "c", version: 1 } }, ip: null, userAgent: null, acceptedAt: "2026-10-14T10:00:00.000Z" });
  uguale("un evento Stripe ripetuto (23505) non è un errore", esito, {});
  atteso("il messaggio di errore della seconda casella non cita numeri (cambiano con la versione)", !/\d/.test(validateOmniaAiAcceptance({ condizioniEPrivacy: true, clausoleSpecifiche: false }) ?? ""));
}

console.log("--- Collegamenti nel codice ---");
{
  const legale = leggi("src/lib/omnia-ai-legal.ts");
  atteso("i documenti vigenti includono l'Allegato A (e restano validi se manca: null)", /"omnia_ai_allegato_a"\]/.test(legale) && /allegatoA: allegatoA \?/.test(legale) && /allegatoA: OmniaAiLegalDocumentRef \| null/.test(legale));
  const azione = leggi("src/app/actions/omnia-ai-subscription.ts");
  atteso("il checkout porta l'Allegato A nei metadata di Stripe (id e versione visti dal cliente), solo se esiste", /if \(legalDocuments\.allegatoA\) \{\s*metadata\.allegatoADocId = legalDocuments\.allegatoA\.id;\s*metadata\.allegatoAVersion = String\(legalDocuments\.allegatoA\.version\);/.test(azione));
  const webhook = leggi("src/app/api/webhooks/stripe/route.ts");
  atteso("il webhook legge l'Allegato A dai metadata e lo passa alla registrazione (assente nelle sessioni vecchie)", /allegatoADocId,\s*allegatoAVersion,/.test(webhook) && /allegatoA: allegatoADocId && allegatoAVersion \?/.test(webhook));
  const caselle = leggi("src/components/omnia-ai/consensi-abbonamento.tsx");
  atteso("la casella non ha numeri di clausola scritti a mano (li legge dalla versione)", !/clausola-\d/.test(caselle) && /clausoleSpecifiche\(condizioniVersion\)/.test(caselle));
  atteso("la casella dell'Allegato A compare solo se esiste una versione in vigore", /allegatoUrl && \(/.test(caselle) && /allegatoVersion \? `\/documenti-legali\/allegato-a\/\$\{allegatoVersion\}` : null/.test(caselle));
  for (const file of ["src/app/site-omnia-ai/abbonati/[piano]/abbonati-piano-form.tsx", "src/app/site-omnia-ai/dashboard/omnia-ai/activate-subscription-form.tsx"]) {
    const t = leggi(file);
    atteso(`${file.split("/").pop()}: usa le caselle comuni e riceve la versione dell'Allegato A`, /<ConsensiAbbonamento/.test(t) && /allegatoVersion: number \| null/.test(t) && !/#clausola-/.test(t));
  }
  for (const file of ["src/app/site-omnia-ai/abbonati/[piano]/page.tsx", "src/app/site-omnia-ai/dashboard/omnia-ai/abbonamento/page.tsx", "src/app/site-omnia-ai/dashboard/omnia-ai/layout.tsx"]) {
    atteso(`${file.replace("src/app/site-omnia-ai/", "")}: passa la versione dell'Allegato A al modulo`, /allegatoVersion=\{legalDocuments\.allegatoA\?\.version \?\? null\}/.test(leggi(file)));
  }
  atteso("la pagina «Condizioni» segue la versione in vigore (non una versione fissa)", /getCurrentOmniaAiDocumento\("omnia_ai_condizioni_abbonamento"\)/.test(leggi("src/app/site-omnia-ai/condizioni-abbonamento/page.tsx")) && !/CondizioniAbbonamentoV1/.test(leggi("src/app/site-omnia-ai/condizioni-abbonamento/page.tsx")));
  const registro = leggi("src/components/omnia-ai/legal/documento-legale-versionato.tsx");
  atteso("la v1 resta registrata come componente, la v2 e l'Allegato A arrivano dal markdown", /"condizioni-abbonamento": \{ "1": CondizioniAbbonamentoV1 \}/.test(registro) && /"condizioni-abbonamento": \{\s*"2":/.test(leggi("src/lib/legal-documenti.ts")) && /"allegato-a": \{\s*"1":/.test(leggi("src/lib/legal-documenti.ts")));
  atteso("i file legali sono inclusi nel pacchetto di Vercel (si leggono con fs a runtime)", /"\.\/legal\/\*\*"/.test(leggi("next.config.ts")));
  atteso("il nome del file da leggere deve passare da un registro (nessun percorso libero da un indirizzo)", /\^\[a-z0-9-\]\+\\\.md\$/.test(leggi("src/lib/legal-documenti.ts")));
}

console.log("--- Migrazione 0080 ---");
{
  const sql = leggi("supabase/migrations/0080_omnia_ai_condizioni_v2_allegato_a.sql");
  const tipi = ["privacy_policy", "cookie_policy", "condizioni_vendita", "omnia_ai_privacy_policy", "omnia_ai_cookie_policy", "omnia_ai_condizioni_abbonamento", "omnia_ai_allegato_a"];
  atteso("il vincolo sui tipi comprende i sette tipi (i sei esistenti più l'Allegato A)", tipi.every((t) => sql.includes(`'${t}'`)));
  atteso("inserisce l'Allegato A v1 e le condizioni v2, una volta sola (on conflict)", /'omnia_ai_allegato_a', 1,/.test(sql) && /'omnia_ai_condizioni_abbonamento', 2,/.test(sql) && /on conflict \(document_type, version\) do nothing/.test(sql));
  atteso("la data di entrata in vigore è il giorno (a Roma) in cui si esegue", (sql.match(/\(now\(\) at time zone 'Europe\/Rome'\)::date/g) ?? []).length === 2);
  atteso("avverte di eseguirla DOPO il deploy (il database è condiviso con la produzione)", /DOPO il deploy/.test(sql));
  atteso("non tocca dati né tabelle: nessun delete, truncate, update o drop di tabella", !/\b(delete from|truncate|update public|drop table)\b/i.test(sql));
}

console.log("--- Privacy e Cookie policy v2 (migrazione 0100, Google tag con Consent Mode avanzato) ---");
{
  const sql = leggi("supabase/migrations/0100_omnia_ai_privacy_cookie_v2.sql");
  const cookie = leggi("legal/cookie-policy-omnia-ai-v2.md");
  const privacy = leggi("legal/privacy-policy-omnia-ai-v2.md");
  const registro = leggi("src/lib/legal-documenti.ts");
  atteso("la migrazione inserisce cookie policy v2 e privacy policy v2, una volta sola (on conflict), con la data del giorno (a Roma) in cui si esegue", /'omnia_ai_cookie_policy', 2,/.test(sql) && /'omnia_ai_privacy_policy', 2,/.test(sql) && /on conflict \(document_type, version\) do nothing/.test(sql) && (sql.match(/\(now\(\) at time zone 'Europe\/Rome'\)::date/g) ?? []).length === 2);
  atteso("avverte di eseguirla SUBITO DOPO il deploy, dichiara i testi approvati dal titolare (i tre punti tolti per sua decisione) e di ricalcolare l'impronta se un file cambia (dopo l'esecuzione serve una v3)", /SUBITO DOPO il deploy/.test(sql) && /approvati dal titolare/.test(sql) && /ricalcolata/.test(sql) && /serve una versione 3/.test(sql) && !/approvati dal legale/.test(sql));
  atteso("non tocca dati né tabelle e non ricrea il vincolo dei tipi (già ammessi dalla 0080)", !/\b(delete from|truncate|update public|drop table|drop constraint|alter table)\b/i.test(sql));
  atteso("le v1 non si toccano: restano registrate come componenti e le v2 sono file markdown registrati con file, titolo e tipo", /"privacy-policy": \{ "1": PrivacyPolicyV1 \}/.test(leggi("src/components/omnia-ai/legal/documento-legale-versionato.tsx")) && /"cookie-policy": \{ "1": CookiePolicyV1 \}/.test(leggi("src/components/omnia-ai/legal/documento-legale-versionato.tsx")) && /"privacy-policy": \{\s*"2": \{ file: "privacy-policy-omnia-ai-v2\.md", titolo: "Privacy policy", tipoDb: "omnia_ai_privacy_policy", versioneNelTesto: false \}/.test(registro) && /"cookie-policy": \{\s*"2": \{ file: "cookie-policy-omnia-ai-v2\.md", titolo: "Cookie policy", tipoDb: "omnia_ai_cookie_policy", versioneNelTesto: false \}/.test(registro));
  atteso("le pagine /privacy e /cookie-policy seguono la versione in vigore secondo legal_documents (la v2 solo dopo la migrazione), con ricaduta sulla v1", /getCurrentOmniaAiDocumento\("omnia_ai_privacy_policy"\)/.test(leggi("src/app/site-omnia-ai/privacy/page.tsx")) && /getCurrentOmniaAiDocumento\("omnia_ai_cookie_policy"\)/.test(leggi("src/app/site-omnia-ai/cookie-policy/page.tsx")) && /corrente\?\.version \?\? 1/.test(leggi("src/app/site-omnia-ai/privacy/page.tsx")) && /corrente\?\.version \?\? 1/.test(leggi("src/app/site-omnia-ai/cookie-policy/page.tsx")));
  atteso("la cookie policy v2 descrive il comportamento reale: nulla prima del consenso su Analytics, segnale tecnico senza cookie solo sulle pagine di presentazione, indirizzo senza parametri, revoca con cancellazione dei cookie, personalizzazione disattivata, durate dei cookie di Google", /Google Analytics resta spento/.test(cookie) && /senza cookie/.test(cookie) && /senza parametri né frammenti/.test(cookie) && /Home, Come funziona, Piani, Demo, Contatti, Riservatezza/.test(cookie) && /togliamo dal tuo browser i cookie di Google/.test(cookie) && /personalizzazione pubblicitaria resta disattivata/.test(cookie) && /_ga/.test(cookie) && /_gcl_au/.test(cookie) && /Fino a 2 anni/.test(cookie) && /Fino a 90 giorni/.test(cookie));
  atteso("la cookie policy v2 NON ripete l'affermazione della v1 diventata falsa («nessun dato viene inviato a Google»)", !/nessun dato viene inviato a Google/i.test(cookie) && !/non viene caricato finché non premi/i.test(cookie));
  atteso("la privacy v2 contiene Google Analytics 4, Google Ads, finalità, base giuridica, destinatari (Google tra i fornitori), trasferimenti, conservazione, gestione e revoca del consenso, richiesta di demo", /Google Analytics 4 e Google Ads/.test(privacy) && /Se premi "Accetta"/.test(privacy) && /Se rifiuti, o se ignori il banner/.test(privacy) && /\| Consenso \|/.test(privacy) && /\*\*Google\*\* — Google Analytics 4 e Google Ads/.test(privacy) && /Data Privacy Framework/.test(privacy) && /Preferenze cookie/.test(privacy) && /## Richiesta di demo/.test(privacy) && /Le richieste che non portano a una prenotazione sono cancellate dopo 90 giorni/.test(privacy) && /dopo 24 mesi/.test(privacy));
  atteso("la privacy v2 conserva il contenuto della v1 (titolare, documenti caricati, fornitori, diritti, reclamo al Garante): le righe della v1 che non cambiano ci sono ancora", ["## Titolare del trattamento", "## I documenti che carichi", "Non utilizziamo i tuoi documenti né i contenuti generati per addestrare modelli di intelligenza artificiale", "## Fornitori che trattano i dati per nostro conto", "- **Anthropic** — modelli linguistici", "## Diritti dell'interessato", "Garante per la Protezione dei Dati Personali", "P.IVA 02957590819"].every((s) => privacy.includes(s)));
  const segnaposto = [...(cookie + privacy).matchAll(/\[([^\]]{3,})\]/g)].map((m) => m[1]);
  atteso("nei due testi NON resta nessun punto in sospeso: niente parentesi quadre, niente «da confermare», «da definire» o «legale» come rimando (i tre punti sono stati tolti per decisione del titolare il 05/11/2026)", segnaposto.length === 0 && !/[\[\]]/.test(cookie + privacy) && !/da confermare|da definire|da verificare|con il legale|TODO/i.test(cookie + privacy), JSON.stringify(segnaposto));
  atteso("tolti i tre punti, le frasi restano intere: la conservazione parla solo dei cookie, i trasferimenti passano dalle garanzie generali alla copia su richiesta, e nessuna frase è rimasta a metà", /\nI cookie hanno le durate indicate nella Cookie policy\.\n/.test(privacy) && !/conservati per\s*[;.,]/.test(privacy) && /Data Privacy Framework UE-USA\. Puoi chiederci copia delle garanzie adottate\./.test(privacy) && !/ {2,}[.,;]|\.\s+\./.test(privacy));
  atteso("nessuna riga di tabella ha celle vuote (la riga del segnale tecnico è stata tolta insieme al suo segnaposto, non lasciata a metà); il segnale tecnico resta descritto per intero nella sezione su Google", [cookie, privacy].every((t) => t.split("\n").filter((r) => /^\|/.test(r) && !/^\|[-| ]+\|$/.test(r)).every((r) => r.split("|").slice(1, -1).every((c) => c.trim() !== ""))) && !/\| Segnale tecnico senza cookie verso Google Ads/.test(privacy) && /riceve un segnale tecnico senza cookie: l'orario, l'indirizzo della pagina e di quella di provenienza senza parametri né frammenti/.test(privacy) && /\| Dati di uso del sito e delle campagne pubblicitarie, raccolti con Google Analytics 4 e Google Ads \(vedi sotto\) \| Solo se premi "Accetta" sul banner \|[^\n]*\| Consenso \|/.test(privacy));
  atteso("i testi usano solo il markdown che il visualizzatore sa leggere (titoli, elenchi, tabelle, grassetto): nessun collegamento, nessun HTML", !/<[a-z]/i.test(cookie + privacy) && !/\]\(/.test(cookie + privacy));
  atteso("fine riga LF e newline finale (convenzione delle impronte)", !(cookie + privacy).includes("\r") && cookie.endsWith("\n") && privacy.endsWith("\n"));
}

if (fallimenti.length > 0) {
  console.error(`\n${fallimenti.length} controllo/i fallito/i:\n- ${fallimenti.join("\n- ")}`);
  process.exit(1);
}
console.log("\nAutotest dei documenti legali di OMNIA AI: tutti i casi ok.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
