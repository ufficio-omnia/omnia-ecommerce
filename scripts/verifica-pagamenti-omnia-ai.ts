// Autotest di «Pagamenti e fatture» di OMNIA AI: storico dei pagamenti del cliente,
// stato della fattura mostrato, percorso e nome del file, migrazione 0081 (cosa può
// leggere il cliente e cosa no) e collegamenti di sicurezza di pagina, rotte e azione
// della console. Gratuito, nessun database né rete: gira nel livello 1, quindi in prebuild.
import fs from "fs";
import path from "path";
import {
  CHIAVE_PAGAMENTO,
  TABELLA_PER_FONTE,
  UUID,
  costruisciPagamenti,
  descrizioneCrediti,
  descrizioneIncasso,
  nomeFileFattura,
  percorsoFatturaPagamento,
  statoFatturaCliente,
  type AcquistoCrediti,
  type IncassoCliente,
} from "../src/lib/omnia-ai-pagamenti";

const fallimenti: string[] = [];
function atteso(nome: string, ok: boolean, dettaglio = "") {
  console.log(`${ok ? "ok    " : "FALLITO"} ${nome}${ok ? "" : ` — ${dettaglio}`}`);
  if (!ok) fallimenti.push(nome);
}
function uguale<T>(nome: string, ottenuto: T, previsto: T) {
  atteso(nome, JSON.stringify(ottenuto) === JSON.stringify(previsto), `ottenuto ${JSON.stringify(ottenuto)}, previsto ${JSON.stringify(previsto)}`);
}
const leggi = (relativo: string) => fs.readFileSync(path.join(__dirname, "..", relativo), "utf-8").replace(/\r\n/g, "\n");

const ID1 = "11111111-1111-4111-8111-111111111111";
const ID2 = "22222222-2222-4222-8222-222222222222";
const ID3 = "33333333-3333-4333-8333-333333333333";
const ID4 = "44444444-4444-4444-8444-444444444444";

console.log("--- Stato della fattura mostrato al cliente ---");
uguale("fatturata con file: scaricabile", statoFatturaCliente({ stato_fattura: "fatturata", numero_fattura: "2026/045", data_fattura: "2026-10-02", fattura_file_path: "omnia-ai/incassi/x.pdf" }), { tipo: "disponibile", numero: "2026/045", data: "2026-10-02" });
uguale("fatturata senza file: «emessa», niente da scaricare (non si finge)", statoFatturaCliente({ stato_fattura: "fatturata", numero_fattura: "2026/045", data_fattura: "2026-10-02", fattura_file_path: null }), { tipo: "emessa", numero: "2026/045", data: "2026-10-02" });
uguale("fatturata senza numero né file", statoFatturaCliente({ stato_fattura: "fatturata" }), { tipo: "emessa", numero: null, data: null });
uguale("da fatturare: in preparazione", statoFatturaCliente({ stato_fattura: "da_fatturare" }), { tipo: "in_preparazione" });
uguale("non dovuta", statoFatturaCliente({ stato_fattura: "non_dovuta", fattura_file_path: "omnia-ai/incassi/x.pdf" }), { tipo: "non_dovuta" });
uguale("colonna assente (migrazione non eseguita): in preparazione", statoFatturaCliente({}), { tipo: "in_preparazione" });
uguale("valore sconosciuto: in preparazione, mai scaricabile", statoFatturaCliente({ stato_fattura: "boh", fattura_file_path: "omnia-ai/incassi/x.pdf" }), { tipo: "in_preparazione" });
uguale("un file su un pagamento NON fatturato non rende nulla scaricabile", statoFatturaCliente({ stato_fattura: "da_fatturare", fattura_file_path: "omnia-ai/incassi/x.pdf" }), { tipo: "in_preparazione" });

console.log("--- Storico dei pagamenti ---");
const incassi: IncassoCliente[] = [
  { id: ID1, tipo: "primo", importo_lordo_centesimi: 69900, pagato_il: "2026-08-01T09:00:00Z", livemode: true, numero_ricevuta: "1234-0001", ricevuta_url: "https://pay.stripe.com/receipts/a", stripe_subscription_id: "sub_1", stato_fattura: "fatturata", numero_fattura: "2026/001", data_fattura: "2026-08-03", fattura_file_path: `omnia-ai/incassi/${ID1}.pdf` },
  { id: ID2, tipo: "rinnovo", importo_lordo_centesimi: 69900, pagato_il: "2026-09-01T09:00:00Z", livemode: true, numero_ricevuta: null, ricevuta_url: null, stripe_subscription_id: "sub_1", stato_fattura: "da_fatturare" },
  { id: ID3, tipo: "conguaglio", importo_lordo_centesimi: 20000, pagato_il: "2026-09-15T09:00:00Z", livemode: false, numero_ricevuta: null, ricevuta_url: null, stripe_subscription_id: "sub_sconosciuta", stato_fattura: "non_dovuta" },
];
const acquisti: AcquistoCrediti[] = [{ id: ID4, pacchetto: "pacchetto5", crediti: 5, importo_centesimi: 120000, created_at: "2026-09-20T09:00:00Z", stato_fattura: "da_fatturare" }];
const elenco = costruisciPagamenti(incassi, acquisti, [{ stripe_subscription_id: "sub_1", plan: "professional" }]);
uguale("quattro pagamenti (incassi + acquisti di crediti), dal più recente", elenco.map((p) => p.chiave), [`crediti:${ID4}`, `incasso:${ID3}`, `incasso:${ID2}`, `incasso:${ID1}`]);
uguale("descrizione del primo pagamento con il piano dell'abbonamento", elenco.find((p) => p.id === ID1)?.descrizione, "Abbonamento OMNIA AI Professional: primo pagamento");
uguale("descrizione del rinnovo", elenco.find((p) => p.id === ID2)?.descrizione, "Abbonamento OMNIA AI Professional: rinnovo mensile");
uguale("abbonamento non trovato: descrizione senza piano, senza errori", elenco.find((p) => p.id === ID3)?.descrizione, "Abbonamento OMNIA AI: conguaglio per cambio piano");
uguale("descrizione acquisto crediti noto", elenco.find((p) => p.id === ID4)?.descrizione, descrizioneCrediti("pacchetto5", 5));
uguale("pacchetto sconosciuto: descrizione con il numero di gare", descrizioneCrediti("xyz", 1), "Crediti aggiuntivi OMNIA AI (1 gara)");
uguale("tipo di incasso sconosciuto: nessuna dicitura inventata", descrizioneIncasso("altro", null), "Abbonamento OMNIA AI");
uguale("importi in centesimi invariati", elenco.map((p) => p.importoCentesimi), [120000, 20000, 69900, 69900]);
uguale("il pagamento di prova è segnato", elenco.map((p) => p.prova), [false, true, false, false]);
uguale("ricevuta Stripe presente solo dove c'è", [elenco[3].ricevutaUrl, elenco[2].ricevutaUrl], ["https://pay.stripe.com/receipts/a", null]);
uguale("solo il primo pagamento ha la fattura scaricabile", elenco.map((p) => p.fattura.tipo), ["in_preparazione", "non_dovuta", "in_preparazione", "disponibile"]);
uguale("nessun pagamento: elenco vuoto", costruisciPagamenti([], [], []), []);
atteso("non si modificano gli elenchi ricevuti", incassi.length === 3 && acquisti.length === 1);

console.log("--- Percorso e nome del file ---");
uguale("percorso di un incasso", percorsoFatturaPagamento("incasso", ID1), `omnia-ai/incassi/${ID1}.pdf`);
uguale("percorso di un acquisto di crediti", percorsoFatturaPagamento("crediti", ID4), `omnia-ai/crediti/${ID4}.pdf`);
atteso("il percorso sta sotto il prefisso omnia-ai/ (le fatture dell'e-commerce non si toccano)", percorsoFatturaPagamento("incasso", ID1).startsWith("omnia-ai/"));
for (const cattivo of ["../../x", "abc", `${ID1}/../${ID2}`, "", `${ID1}.pdf`, `${ID1} `]) {
  let errore = false;
  try {
    percorsoFatturaPagamento("incasso", cattivo);
  } catch {
    errore = true;
  }
  atteso(`identificativo non valido rifiutato: «${cattivo}»`, errore);
}
atteso("la chiave del pagamento accetta solo incasso e crediti", ["incasso", "crediti"].every((f) => CHIAVE_PAGAMENTO.test(f)) && !["ordine", "incassi", "", "incasso/x", "../x"].some((f) => CHIAVE_PAGAMENTO.test(f)));
atteso("l'UUID non accetta nulla di diverso da un UUID", UUID.test(ID1) && !UUID.test(`${ID1}x`) && !UUID.test(`x${ID1}`));
uguale("tabelle per fonte", TABELLA_PER_FONTE, { incasso: "omnia_ai_incassi", crediti: "omnia_ai_credit_purchases" });
uguale("nome del file dal numero di fattura", nomeFileFattura("2026/045", "2026-10-02T09:00:00Z"), "Fattura-OMNIA-AI-2026-045.pdf");
uguale("nome del file senza numero: data del pagamento", nomeFileFattura(null, "2026-10-02T09:00:00Z"), "Fattura-OMNIA-AI-2026-10-02.pdf");
atteso("il nome del file non contiene caratteri pericolosi per un'intestazione HTTP", !/["\r\n\\/;]/.test(nomeFileFattura('a"b\r\nc/d;e\\f', "2026-10-02")), nomeFileFattura('a"b\r\nc/d;e\\f', "2026-10-02"));

console.log("--- Migrazione 0081: cosa legge il cliente ---");
const mig = leggi("supabase/migrations/0081_omnia_ai_fatture_cliente.sql");
const migSenzaCommenti = mig.split("\n").filter((r) => !r.trimStart().startsWith("--")).join("\n");
const grantSelect = (tabella: string): string[] => {
  const m = migSenzaCommenti.match(new RegExp(`grant select \\(([^)]*)\\)\\s+on public\\.${tabella} to authenticated`));
  return m ? m[1].split(",").map((c) => c.trim()).filter(Boolean) : [];
};
const colonneIncassi = grantSelect("omnia_ai_incassi");
const colonneCrediti = grantSelect("omnia_ai_credit_purchases");
atteso("concede al cliente la lettura di colonne precise sugli incassi", colonneIncassi.length > 0);
atteso("concede al cliente la lettura di colonne precise sugli acquisti di crediti", colonneCrediti.length > 0);
const riservate = ["cliente_snapshot", "stripe_invoice_id", "stripe_customer_id", "note_fattura", "fatturazione_aggiornata_il", "fatturazione_aggiornata_da", "stripe_session_id", "fattura_caricata_il"];
for (const c of riservate) atteso(`il cliente non legge «${c}»`, !colonneIncassi.includes(c) && !colonneCrediti.includes(c));
atteso("nessuna lettura dell'intera tabella al cliente (niente «grant select on … to authenticated»)", !/grant select on public\.omnia_ai_(incassi|credit_purchases) to authenticated/.test(migSenzaCommenti));
atteso("ritira la lettura completa degli acquisti di crediti prima di concedere le colonne", /revoke select on public\.omnia_ai_credit_purchases from authenticated/.test(migSenzaCommenti) && migSenzaCommenti.indexOf("revoke select") < migSenzaCommenti.indexOf("on public.omnia_ai_credit_purchases to authenticated"));
atteso("policy «solo le mie righe» sugli incassi", /create policy "omnia_ai_incassi_select_own" on public\.omnia_ai_incassi\s+for select using \(user_id = auth\.uid\(\)\)/.test(migSenzaCommenti));
atteso("aggiunge il file e la data di caricamento a entrambe le tabelle, in modo idempotente", (migSenzaCommenti.match(/add column if not exists fattura_file_path text/g) ?? []).length === 2 && (migSenzaCommenti.match(/add column if not exists fattura_caricata_il timestamptz/g) ?? []).length === 2);
atteso("nessuna cancellazione di dati né di colonne", !/\b(drop\s+(table|column)|delete\s+from|truncate)\b/i.test(migSenzaCommenti));
atteso("nessun grant al ruolo anonimo", !/to anon/.test(migSenzaCommenti));
atteso("il service_role può aggiornare il file sugli acquisti di crediti", /grant update \(fattura_file_path, fattura_caricata_il\) on public\.omnia_ai_credit_purchases to service_role/.test(migSenzaCommenti));

console.log("--- Le pagine del cliente leggono solo colonne concesse ---");
const colonneDa = (sorgente: string, costante?: string): string[] => {
  const re = costante ? new RegExp(`${costante}\\s*=\\s*"([^"]*)"`) : /./;
  const m = sorgente.match(re);
  return m && costante ? m[1].split(",").map((c) => c.trim()).filter(Boolean) : [];
};
const paginaPagamenti = leggi("src/app/site-omnia-ai/dashboard/omnia-ai/pagamenti/page.tsx");
const paginaAbbonamento = leggi("src/app/site-omnia-ai/dashboard/omnia-ai/abbonamento/page.tsx");
const lettePagamentiIncassi = [...colonneDa(paginaPagamenti, "COLONNE_INCASSO_BASE"), "fattura_file_path"];
const lettePagamentiCrediti = [...colonneDa(paginaPagamenti, "COLONNE_CREDITI_BASE"), "fattura_file_path"];
atteso("pagina Pagamenti: ogni colonna letta sugli incassi è concessa", lettePagamentiIncassi.every((c) => colonneIncassi.includes(c)), lettePagamentiIncassi.filter((c) => !colonneIncassi.includes(c)).join(", "));
atteso("pagina Pagamenti: ogni colonna letta sugli acquisti di crediti è concessa", lettePagamentiCrediti.every((c) => colonneCrediti.includes(c)), lettePagamentiCrediti.filter((c) => !colonneCrediti.includes(c)).join(", "));
const selectAbbonamento = paginaAbbonamento.match(/from\("omnia_ai_credit_purchases"\)\s*\.select\("([^"]*)"\)/);
atteso("pagina Abbonamento: legge gli acquisti di crediti con colonne esplicite", Boolean(selectAbbonamento));
atteso("pagina Abbonamento: ogni colonna letta è concessa", selectAbbonamento !== null && selectAbbonamento[1].split(",").map((c) => c.trim()).every((c) => colonneCrediti.includes(c)));
atteso("nessun «select *» sulle due tabelle con la sessione del cliente", !/omnia_ai_(incassi|credit_purchases"?\))[\s\S]{0,40}select\("\*"\)/.test(paginaPagamenti + paginaAbbonamento));
atteso("la pagina Pagamenti usa solo la sessione del cliente (nessun client di servizio)", !/createAdminClient|supabase\/admin/.test(paginaPagamenti));
atteso("la pagina Pagamenti filtra sempre per il cliente", (paginaPagamenti.match(/\.eq\("user_id", user\.id\)/g) ?? []).length >= 3);

// Nessun'altra lettura con la sessione del cliente di quelle due tabelle (la revoca della
// lettura completa romperebbe una lettura non elencata): ogni uso fuori da console, webhook
// e librerie di calcolo deve essere in una delle due pagine controllate sopra.
const cartelleDaControllare = ["src/app/site-omnia-ai", "src/app/(ecommerce)", "src/components", "src/app/actions"];
const letture: string[] = [];
function visita(dir: string) {
  for (const voce of fs.readdirSync(path.join(__dirname, "..", dir), { withFileTypes: true })) {
    const relativo = `${dir}/${voce.name}`;
    if (voce.isDirectory()) visita(relativo);
    else if (/\.(ts|tsx)$/.test(voce.name) && /omnia_ai_(incassi|credit_purchases)/.test(leggi(relativo))) letture.push(relativo);
  }
}
for (const c of cartelleDaControllare) if (fs.existsSync(path.join(__dirname, "..", c))) visita(c);
uguale(
  "solo due file dei siti pubblici toccano le tabelle dei pagamenti (e usano colonne concesse)",
  letture.sort(),
  ["src/app/site-omnia-ai/dashboard/omnia-ai/abbonamento/page.tsx", "src/app/site-omnia-ai/dashboard/omnia-ai/pagamenti/page.tsx"],
);

console.log("--- Rotta di download del cliente ---");
const rottaCliente = leggi("src/app/site-omnia-ai/dashboard/omnia-ai/pagamenti/fattura/[fonte]/[id]/route.ts");
const posizione = (testo: string, pezzo: string) => testo.indexOf(pezzo);
atteso("controlla il formato di fonte e id prima di tutto", posizione(rottaCliente, "CHIAVE_PAGAMENTO.test(fonte)") !== -1 && posizione(rottaCliente, "CHIAVE_PAGAMENTO.test(fonte)") < posizione(rottaCliente, "createClient()"));
atteso("senza sessione rimanda al login", /if \(!user\) return NextResponse\.redirect\(new URL\("\/login"/.test(rottaCliente));
atteso("legge la riga con la sessione del cliente e il filtro sul suo id", /await createClient\(\)/.test(rottaCliente) && /\.eq\("user_id", user\.id\)/.test(rottaCliente));
atteso("il client di servizio entra solo dopo aver letto la riga del cliente", posizione(rottaCliente, "createAdminClient()") > posizione(rottaCliente, '.eq("user_id", user.id)'));
atteso("la fattura si scarica solo se «fatturata» e con un file", /stato_fattura !== "fatturata" \|\| !riga\.fattura_file_path/.test(rottaCliente));
atteso("il percorso nel database deve essere quello previsto per quel pagamento", /riga\.fattura_file_path !== percorsoFatturaPagamento\(origine, id\)/.test(rottaCliente));
atteso("collegamento firmato di 60 secondi, mai un indirizzo permanente", /createSignedUrl\(riga\.fattura_file_path, 60/.test(rottaCliente) && !/getPublicUrl/.test(rottaCliente));
atteso("risposta mai in cache", /Cache-Control", "no-store"/.test(rottaCliente));

console.log("--- Console: rotta di apertura del PDF ---");
const rottaConsole = leggi("src/app/site-console/(app)/fatturazione/fattura/[fonte]/[id]/route.ts");
const corpoGet = rottaConsole.slice(rottaConsole.indexOf("export async function GET"));
const posAdmin = corpoGet.indexOf("await richiediAdminPagina();");
atteso(
  "il controllo admin precede ogni altra istruzione (parametri, formato, database)",
  posAdmin !== -1 && posAdmin < corpoGet.indexOf("await params") && posAdmin < corpoGet.indexOf("createAdminClient()") && posAdmin < corpoGet.indexOf("CHIAVE_PAGAMENTO.test"),
);
atteso("controlla il formato di fonte e id", /CHIAVE_PAGAMENTO\.test\(fonte\)/.test(rottaConsole) && /UUID\.test\(id\)/.test(rottaConsole));
atteso("collegamento firmato di 60 secondi", /createSignedUrl\(riga\.fattura_file_path, 60/.test(rottaConsole) && !/getPublicUrl/.test(rottaConsole));
atteso("percorso nel database verificato", /riga\.fattura_file_path !== percorsoFatturaPagamento\(origine, id\)/.test(rottaConsole));

console.log("--- Console: azione di caricamento ---");
const azione = leggi("src/app/site-console/azioni/fatturazione.ts");
const corpoAggiorna = azione.slice(azione.indexOf("export async function aggiornaStatoFattura("), azione.indexOf("export async function aggiornaStatoFatturaMultiplo"));
atteso("aggiornaStatoFattura parte dal controllo admin", /aggiornaStatoFattura\([^)]*\)[^{]*\{\s*const sessione = await richiediAdminAzione\(\);\s*if \(!sessione\) return/.test(corpoAggiorna));
const corpoCarica = azione.slice(azione.indexOf("async function caricaPdfFattura"), azione.indexOf("async function avvisaClienteFattura"));
atteso("il PDF si carica solo su una fattura segnata «fatturata»", /if \(stato !== "fatturata"\) return \{ errore/.test(corpoCarica));
atteso("limite di 15 MB", /LIMITE_BYTE_FATTURA = 15 \* 1024 \* 1024/.test(azione) && /file\.size > LIMITE_BYTE_FATTURA/.test(corpoCarica));
atteso("controllo del contenuto: un PDF vero comincia con «%PDF»", /startsWith\("%PDF"\)/.test(corpoCarica));
atteso("percorso fisso per pagamento, ricaricare sostituisce", /percorsoFatturaPagamento\(fonte, id\)/.test(corpoCarica) && /upsert: true/.test(corpoCarica) && /contentType: "application\/pdf"/.test(corpoCarica));
atteso("il file va nel bucket privato «invoices»", /storage\.from\("invoices"\)/.test(corpoCarica));
atteso("la data del primo caricamento si conserva nei caricamenti successivi", /attuale\.fattura_caricata_il \?\? new Date\(\)\.toISOString\(\)/.test(corpoCarica));
atteso("l'email al cliente parte solo al primo caricamento", /pdf\?\.primoCaricamento \? await avvisaClienteFattura/.test(corpoAggiorna));
atteso("l'azione multipla non tocca i file", !/extra|file/.test(azione.slice(azione.indexOf("export async function aggiornaStatoFatturaMultiplo"))));
atteso("l'esito dell'email si riporta in pagina (inviata o no)", /parametri\.set\("email", email \? "1" : "0"\)/.test(azione));
const corpoEmail = azione.slice(azione.indexOf("async function avvisaClienteFattura"), azione.indexOf("export async function aggiornaStatoFattura("));
atteso("l'email rimanda all'area riservata di OMNIA AI, non alla console", /OMNIA_AI_BASE_URL\}\/dashboard\/omnia-ai\/pagamenti/.test(corpoEmail) && !/CONSOLE_BASE_URL|console\.omniaitalia/.test(corpoEmail));
atteso("senza cliente collegato non si invia nulla", /if \(!userId\) return false/.test(corpoEmail));
atteso("il testo dell'email non contiene dati del cliente oltre alla data", !/\$\{[^}]*(email|nome|ragione)/i.test(corpoEmail.split("html:")[1] ?? ""));
atteso("l'email ricorda che la ricevuta di Stripe non è la fattura", /non è la fattura/.test(corpoEmail));

console.log("--- Pagina e navigazione del cliente ---");
const vista = leggi("src/components/omnia-ai/pagamenti-vista.tsx");
atteso("la pagina dice che la ricevuta di Stripe non è la fattura", /La ricevuta di Stripe non è la fattura/.test(vista));
atteso("la pagina dice che la fattura arriva separatamente", /ti arriva separatamente/.test(vista));
atteso("il link di download passa dalla rotta del cliente", /\/dashboard\/omnia-ai\/pagamenti\/fattura\/\$\{p\.fonte\}\/\$\{p\.id\}/.test(vista));
atteso("nessun indirizzo diretto del bucket nella vista", !/storage|supabase\.co|signedUrl|invoices/.test(vista));
atteso("la tabella ha data, descrizione, importo, stato, documento Stripe e fattura", ["Data", "Descrizione", "Importo (IVA inclusa)", "Stato", "Documento Stripe", "Fattura"].every((t) => vista.includes(`<th`) && vista.includes(t)));
// Il «numero ricevuta» salvato dal webhook è in realtà il numero della fattura INTERNA di Stripe
// (invoice.number) e il link porta alla sua pagina «Fattura pagata»: sotto la voce «ricevuta»
// un cliente lo scambierebbe per un numero di fattura. Al cliente non si mostra, e si spiega.
atteso("il numero interno di Stripe non è mostrato al cliente (si scambierebbe per un numero di fattura)", !/\{p\.numeroRicevuta\}/.test(vista) && !/n\. \{/.test(vista));
atteso("la pagina spiega che su Stripe compare una «fattura» con un numero che non è la nostra fattura", /compare anche una voce «fattura» con un numero/.test(vista) && /numerazione interna di Stripe, non la nostra fattura/.test(vista));
atteso("il collegamento a Stripe è dichiarato come documento non fiscale", /Documento Stripe, non fiscale/.test(vista) && !/Apri la ricevuta/.test(vista));
atteso("anche in console il link a Stripe è dichiarato non fiscale", /documento Stripe \(non fiscale\)/.test(leggi("src/app/site-console/_componenti/fatturazione-vista.tsx")) && /documento Stripe \(non fiscale\)/.test(leggi("src/app/site-console/_componenti/ricavi-vista.tsx")));
atteso("voce «Pagamenti e fatture» nella barra laterale", /Pagamenti e fatture/.test(leggi("src/components/omnia-ai/sidebar-nav.tsx")) && /\/dashboard\/omnia-ai\/pagamenti/.test(leggi("src/components/omnia-ai/sidebar-nav.tsx")));
atteso("la pagina Abbonamento rimanda ai pagamenti", /\/dashboard\/omnia-ai\/pagamenti/.test(paginaAbbonamento));
atteso("l'area del cliente non rimanda alla console", ![vista, paginaPagamenti, rottaCliente].some((t) => /console\.omniaitalia\.com|CONSOLE_BASE_URL|site-console|lib\/console/.test(t)));

console.log("");
if (fallimenti.length > 0) {
  console.error(`${fallimenti.length} controlli falliti:\n - ${fallimenti.join("\n - ")}`);
  process.exit(1);
}
console.log("Tutti i controlli sono andati a buon fine.");
