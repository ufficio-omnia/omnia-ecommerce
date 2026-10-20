// Autotest del LAVORO dell'Ufficio Gare di OMNIA AI (blocco 3):
//   - ogni azione e ogni pagina ha la sua guardia: quelle amministrative sono del solo titolare, quelle del lavoro
//     di gara lavorano sull'account effettivo (il titolare) e non su chi è loggato;
//   - nessuna azione nuova e nessuna pagina nuova può restare senza classificazione (il test si rompe);
//   - il profilo azienda, nella pipeline, si legge sempre con la chiave di servizio per il titolare;
//   - le email al titolare: una al giorno, anche con richieste contemporanee; un invio fallito non consuma il giorno;
//   - cosa vede l'Ufficio Gare: niente prezzi, niente link di acquisto, niente voci amministrative.
// Gratuito, nessun database né rete: gira nel livello 1, quindi in prebuild.
import fs from "fs";
import path from "path";
import { avvisaTitolareQuotaFinita, avvisaTitolareRevisione } from "../src/lib/omnia-ai-ufficio-gare-avvisi";
import { RADICE_AREA, motivoAvvisoTitolare, percorsoConsentito, testoBloccoPerRuolo, MESSAGGIO_UFFICIO_GARE_GARE_FINITE, MESSAGGIO_UFFICIO_GARE_ABBONAMENTO_NON_ATTIVO } from "../src/lib/omnia-ai-account-calcoli";
import { gareRimanenti } from "../src/lib/gara-diritto-calcoli";

const fallimenti: string[] = [];
function atteso(nome: string, ok: boolean, dettaglio = "") {
  console.log(`${ok ? "ok    " : "FALLITO"} ${nome}${ok ? "" : ` — ${dettaglio}`}`);
  if (!ok) fallimenti.push(nome);
}
function uguale<T>(nome: string, ottenuto: T, previsto: T) {
  atteso(nome, JSON.stringify(ottenuto) === JSON.stringify(previsto), `ottenuto ${JSON.stringify(ottenuto)}, previsto ${JSON.stringify(previsto)}`);
}
const RADICE = path.join(__dirname, "..");
const leggi = (relativo: string) => fs.readFileSync(path.join(RADICE, relativo), "utf-8").replace(/\r\n/g, "\n");

// ───── lettura dei sorgenti ─────

function funzioniEsportate(sorgente: string): { nome: string; corpo: string }[] {
  const trovate = [...sorgente.matchAll(/export async function (\w+)\(/g)].map((m) => ({ nome: m[1], inizio: m.index ?? 0 }));
  return trovate.map((f, i) => ({ nome: f.nome, corpo: sorgente.slice(f.inizio, i + 1 < trovate.length ? trovate[i + 1].inizio : sorgente.length) }));
}

function elencoFile(cartella: string, filtro: (nome: string) => boolean): string[] {
  const risultato: string[] = [];
  const percorri = (dir: string) => {
    for (const voce of fs.readdirSync(path.join(RADICE, dir), { withFileTypes: true })) {
      const relativo = `${dir}/${voce.name}`;
      if (voce.isDirectory()) percorri(relativo);
      else if (filtro(voce.name)) risultato.push(relativo);
    }
  };
  percorri(cartella);
  return risultato.sort();
}

async function main() {
  console.log("--- Azioni: ognuna è classificata e ha la sua guardia ---");
  const TITOLARE: Record<string, string[]> = {
    "company-profile.ts": ["saveCompanyProfile"],
    "omnia-ai-credits.ts": ["startOmniaAiCreditsCheckout"],
    "omnia-ai-subscription.ts": ["startOmniaAiSubscriptionCheckout", "cancelOmniaAiSubscription", "openOmniaAiBillingPortal"],
    "omnia-ai-plan-change.ts": ["previewOmniaAiPlanChange", "confirmOmniaAiPlanChange", "cancelOmniaAiScheduledPlanChange"],
    "omnia-ai-account-settings.ts": ["updateAccountEmail", "updateAccountPassword"],
    "omnia-ai-revisione.ts": ["avviaRevisioneUmana"],
    "omnia-ai-ufficio-gare.ts": ["creaUfficioGare", "rinviaLinkUfficioGare", "sospendiUfficioGare", "riattivaUfficioGare", "rimuoviUfficioGare"],
  };
  const LAVORO: Record<string, string[]> = {
    "gare.ts": ["createGara", "renameGara", "deleteGara", "uploadGaraDocumento", "removeGaraDocumento", "uploadGaraLogoCliente"],
    "gara-extraction.ts": ["extractGaraData"],
    "gara-chat.ts": ["sendGaraMessage"],
    "download.ts": ["downloadGaraDocumento", "downloadGaraMessaggioFile", "downloadAllegatoMessaggio"],
    "assistenza-chat.ts": ["sendAssistenzaMessage", "richiediEscalationAssistenza"],
    "omnia-ai-stato-sistema.ts": ["getStatoElaborazioneGare"],
    "omnia-ai-revisione.ts": ["avvisaAmministratoreRevisione"],
  };
  // Fuori da questa regola, con la ragione: o non toccano dati dell'azienda, o sono dell'e-commerce, o l'Ufficio Gare deve poterle usare per entrare.
  const ESTERNE_FILE: Record<string, string> = {
    "auth.ts": "autenticazione e account dell'e-commerce",
    "omnia-ai-auth.ts": "accesso, registrazione e scelta della password: l'Ufficio Gare deve poter entrare",
    "omnia-ai-demo.ts": "richiesta demo pubblica",
    "omnia-ai-notifiche.ts": "notifiche: solo le righe proprie (regole di accesso); l'Ufficio Gare non ne ha",
    "checkout.ts": "acquisto dell'e-commerce",
    "conversion.ts": "e-commerce",
    "messages.ts": "messaggi dell'e-commerce",
    "anteprima-download.ts": "e-commerce",
  };
  const ESTERNE_FUNZIONI = ["downloadDocument", "downloadInvoice"]; // e-commerce, dentro download.ts

  const fileAzioni = elencoFile("src/app/actions", (n) => n.endsWith(".ts"));
  for (const relativo of fileAzioni) {
    const nomeFile = path.basename(relativo);
    const funzioni = funzioniEsportate(leggi(relativo)).map((f) => f.nome);
    if (ESTERNE_FILE[nomeFile]) {
      atteso(`${nomeFile}: fuori dalla regola (${ESTERNE_FILE[nomeFile]})`, true);
      continue;
    }
    const classificate = [...(TITOLARE[nomeFile] ?? []), ...(LAVORO[nomeFile] ?? []), ...(nomeFile === "download.ts" ? ESTERNE_FUNZIONI : [])];
    const nonClassificate = funzioni.filter((f) => !classificate.includes(f));
    const inesistenti = classificate.filter((f) => !funzioni.includes(f));
    atteso(`${nomeFile}: ogni azione esportata è classificata (titolare, lavoro di gara o e-commerce)`, nonClassificate.length === 0 && inesistenti.length === 0, `non classificate: ${nonClassificate.join(", ")} | classificate ma assenti: ${inesistenti.join(", ")}`);
  }
  atteso("ogni file di azioni è nella classificazione", fileAzioni.every((r) => { const n = path.basename(r); return !!(TITOLARE[n] || LAVORO[n] || ESTERNE_FILE[n]); }), fileAzioni.filter((r) => { const n = path.basename(r); return !(TITOLARE[n] || LAVORO[n] || ESTERNE_FILE[n]); }).join(", "));

  for (const [nomeFile, nomi] of Object.entries(TITOLARE)) {
    const funzioni = funzioniEsportate(leggi(`src/app/actions/${nomeFile}`));
    for (const nome of nomi) {
      const corpo = funzioni.find((f) => f.nome === nome)?.corpo ?? "";
      atteso(`${nomeFile} › ${nome}: parte dalla guardia del titolare`, corpo.includes("await richiediTitolareAzione()"));
      atteso(`${nomeFile} › ${nome}: non rilegge la sessione per conto suo senza passare dalla guardia`, nome === "startOmniaAiSubscriptionCheckout" ? corpo.indexOf("richiediTitolareAzione") > corpo.indexOf("auth.getUser()") && /if \(user\) \{\n\s*const guardia = await richiediTitolareAzione\(\);\n\s*if \(!guardia\.ok\) return \{ error: guardia\.errore \};/.test(corpo) : !corpo.includes("auth.getUser()"));
    }
  }
  for (const [nomeFile, nomi] of Object.entries(LAVORO)) {
    const funzioni = funzioniEsportate(leggi(`src/app/actions/${nomeFile}`));
    for (const nome of nomi) {
      const corpo = funzioni.find((f) => f.nome === nome)?.corpo ?? "";
      atteso(`${nomeFile} › ${nome}: parte dalla guardia dell'account (titolare o Ufficio Gare)`, corpo.includes("await richiediAccountAzione()"));
      atteso(`${nomeFile} › ${nome}: non legge la sessione per conto suo`, !corpo.includes("auth.getUser()"));
      atteso(`${nomeFile} › ${nome}: non controlla abbonamento e diritto sull'utente loggato`, !/requireOmniaAiWriteAccess\(/.test(corpo) && !/verificaDirittoGara\(/.test(corpo) && !/getOmniaAiAccessState\(/.test(corpo));
      if (nomeFile === "assistenza-chat.ts") {
        // la conversazione col supporto è di CHI SCRIVE: user.id è voluto, ma solo per la riga propria; i costi e i dati dell'azienda sono del titolare
        const usi = [...corpo.matchAll(/^.*user\.id.*$/gm)].map((m) => m[0].trim()).filter((riga) => !riga.startsWith("//"));
        atteso(`${nomeFile} › ${nome}: user.id solo per la conversazione propria`, usi.every((r) => /user_id: user\.id|\.eq\("user_id", user\.id\)|userId: user\.id,/.test(r)), usi.join(" | "));
        // la riga della conversazione è SEMPRE di chi scrive: mai del titolare (altrimenti i due vedrebbero la stessa chat)
        atteso(`${nomeFile} › ${nome}: le righe della conversazione sono di chi scrive, non del titolare`, !/user_id: contesto\.accountId/.test(corpo) && (corpo.match(/user_id: user\.id/g) ?? []).length >= (nome === "sendAssistenzaMessage" ? 2 : 1));
        atteso(`${nomeFile} › ${nome}: i dati dell'azienda e i costi sono del titolare`, !/logAiUsage\(\{\s*userId: user\.id/.test(corpo) && (nome === "sendAssistenzaMessage" ? corpo.includes("userId: contesto.accountId,\n        garaId: null") : true) && (!corpo.includes("inviaEmailAssistenza(") || corpo.includes("titolareId: contesto.accountId")));
      } else {
        atteso(`${nomeFile} › ${nome}: i dati sono dell'account effettivo, mai dell'utente loggato`, !/\buser\.id\b/.test(corpo), (corpo.match(/^.*\buser\.id\b.*$/gm) ?? []).join(" | "));
      }
    }
  }
  {
    const corpo = funzioniEsportate(leggi("src/app/actions/omnia-ai-revisione.ts")).find((f) => f.nome === "avvisaAmministratoreRevisione")?.corpo ?? "";
    atteso("avvisaAmministratoreRevisione: solo l'Ufficio Gare; il titolare compra dal suo flusso", corpo.includes('contesto.ruolo !== "ufficio_gare") return { error:'));
    atteso("avvisaAmministratoreRevisione: non apre mai un pagamento", !/stripe|checkout|redirect\(/i.test(corpo));
    atteso(
      "avvisaAmministratoreRevisione: controlla abbonamento, relazione finale, richiesta già pagata e fattibilità prima di avvisare",
      [
        "if (accessoNegato) return { error: accessoNegato };",
        "if (!dati.relazione) return { error:",
        "if (dati.pagata) return { error:",
        "if (!esito.ok) return { error: esito.messaggio };",
        "if (!dati) return { error: \"Gara non trovata.\" };",
      ].every((s) => corpo.includes(s)) &&
        corpo.indexOf("if (!esito.ok) return") < corpo.indexOf("avvisaTitolareRevisione(") &&
        corpo.indexOf("if (dati.pagata) return") < corpo.indexOf("avvisaTitolareRevisione("),
    );
    atteso("avvisaAmministratoreRevisione: gli errori dell'avviso non vengono presentati come successo", corpo.includes('if (avviso === "non_riuscito") return { error:'));
    atteso("avvisaAmministratoreRevisione: la gara e la relazione si leggono per l'account effettivo (il titolare)", corpo.includes("userId: contesto.accountId, garaId })") && !/contesto\.userId, garaId/.test(corpo));
    atteso("avvisaAmministratoreRevisione: una email al giorno per gara (chiave = gara) e il testo di conferma per chi l'ha già fatto oggi", corpo.includes("garaId: dati.gara.id") && corpo.includes("MESSAGGIO_UFFICIO_GARE_REVISIONE_GIA_AVVISATO"));
  }
  {
    const gare = leggi("src/app/actions/gare.ts");
    atteso("gare.ts: ogni scrittura porta il titolare come proprietario", (gare.match(/user_id: contesto\.accountId/g) ?? []).length === 2 && (gare.match(/userId: contesto\.accountId/g) ?? []).length === 1);
    const chat = leggi("src/app/actions/gara-chat.ts");
    atteso("gara-chat.ts: ogni scrittura e ogni costo hanno il titolare come proprietario", (chat.match(/contesto\.accountId/g) ?? []).length >= 12 && !/\buser\.(id|email)\b/.test(chat));
    const estrazione = leggi("src/app/actions/gara-extraction.ts");
    atteso("gara-extraction.ts: a gare finite l'Ufficio Gare non riceve i testi di acquisto e il titolare riceve l'email", estrazione.includes('if (contesto.ruolo === "ufficio_gare") {') && estrazione.includes('messaggioPerUfficioGare("gare_finite")') && estrazione.lastIndexOf("consumeGaraQuotaIfNeeded({") < estrazione.lastIndexOf('avvisaTitolareDopoLaRisposta({ contesto, emailUfficioGare: user.email, motivo: "gare_finite" });') && estrazione.includes('avvisaTitolareDopoLaRisposta({ contesto, emailUfficioGare: user.email, motivo: "gare_finite" });\n      return { error: messaggioPerUfficioGare("gare_finite"), quotaEsaurita: true };'));
    const download = leggi("src/app/actions/download.ts");
    atteso("download.ts: l'Ufficio Gare non vede il profilo azienda, riceve il promemoria", download.includes("MESSAGGIO_UFFICIO_GARE_FATTURAZIONE_INCOMPLETA") && /contesto\.ruolo === "ufficio_gare"\s*\?\s*MESSAGGIO_UFFICIO_GARE_FATTURAZIONE_INCOMPLETA/.test(download));
  }

  console.log("--- Pagine e percorsi dell'area riservata ---");
  const base = "src/app/site-omnia-ai/dashboard/omnia-ai";
  const pagine = elencoFile(base, (n) => n === "page.tsx" || n === "route.ts");
  const routeDi = (file: string) => `${RADICE_AREA}${path.dirname(file).slice(base.length).replace(/\\/g, "/")}`.replace(/\/\.$/, "");
  uguale(
    "le pagine e le route dell'area sono quelle previste (una nuova va classificata)",
    pagine.map((p) => routeDi(p).slice(RADICE_AREA.length)).sort(),
    ["", "/abbonamento", "/assistenza", "/documenti-aziendali", "/documenti-contrattuali", "/gare", "/gare/[id]", "/gare/[id]/revisione", "/impostazioni", "/pagamenti", "/pagamenti/fattura/[fonte]/[id]", "/profilo-azienda", "/ufficio-gare"].sort(),
  );
  for (const file of pagine) {
    const route = routeDi(file);
    const sorgente = leggi(file);
    const aperta = percorsoConsentito("ufficio_gare", route);
    const eRoute = file.endsWith("route.ts");
    if (aperta) {
      atteso(`${route}: aperta all'Ufficio Gare, parte dalla guardia dell'account`, sorgente.includes("await richiediAccountPagina()") && !sorgente.includes("auth.getUser()"));
      atteso(`${route}: i dati sono dell'account effettivo, mai dell'utente loggato`, !/\buser\.id\b/.test(sorgente), (sorgente.match(/^.*\buser\.id\b.*$/gm) ?? []).join(" | "));
    } else {
      atteso(`${route}: riservata al titolare, parte dalla guardia del titolare`, (eRoute ? sorgente.includes("await richiediTitolareAzione()") : sorgente.includes("await richiediTitolarePagina()")) && !sorgente.includes("auth.getUser()"));
    }
  }
  atteso("acquisto diretto /abbonati/[piano]: chi ha una sessione deve essere un titolare", /if \(user\) \{\n\s*const sessione = await richiediTitolarePagina\(\);\n\s*if \(!sessione\) return null;/.test(leggi("src/app/site-omnia-ai/abbonati/[piano]/page.tsx")));

  console.log("--- Layout dell'area riservata ---");
  const layout = leggi(`${base}/layout.tsx`);
  const vista = layout.slice(layout.indexOf("async function VistaUfficioGare"), layout.indexOf("async function LayoutInterno"));
  atteso("il layout capisce chi è e un errore nel capirlo NON è «titolare»", layout.includes("leggiSessioneAccount()") && /catch \(e\) \{\s*if \(e instanceof ErroreContestoAccount\) \{\s*return <SchermataFermo/.test(layout));
  atteso("il layout manda l'Ufficio Gare alla sua vista, prima di qualunque lettura da titolare", layout.indexOf('contesto.ruolo === "ufficio_gare"') !== -1 && layout.indexOf('contesto.ruolo === "ufficio_gare"') < layout.indexOf("getOmniaAiAccessState(user.id, supabase)"));
  atteso("vista Ufficio Gare: sospeso e cessato fermano con il perché, l'abbonamento si legge sul titolare", vista.includes("if (contesto.sospeso)") && vista.includes('stato.stato === "cessato"') && vista.includes("getOmniaAiAccessState(contesto.accountId, admin)") && vista.includes("MESSAGGIO_UFFICIO_GARE_SOSPESO"));
  atteso("vista Ufficio Gare: nessun avviso amministrativo (profilo, fatturazione, pilot, link all'abbonamento)", !/ProfiloAziendaAvviso|FatturazioneAvviso|PilotAvviso|ActivateSubscriptionForm|leggiPilot|\/abbonamento|profilo-azienda/.test(vista));
  atteso("vista Ufficio Gare: menu ridotto, senza campanella né menu del profilo", vista.includes("voci={VOCI_MENU_UFFICIO_GARE}") && vista.includes("ufficioGare"));
  atteso("vista Ufficio Gare: al titolare parte l'email quando l'abbonamento è cessato", vista.includes('motivo: "abbonamento_non_attivo"') && vista.indexOf("avvisaTitolareDopoLaRisposta") < vista.indexOf("SchermataFermo email={email} titolo=\"Abbonamento non attivo\""));
  atteso("sola lettura e prova: avviso senza link né prezzi, con la data di cancellazione", vista.includes("MESSAGGIO_UFFICIO_GARE_ABBONAMENTO_NON_ATTIVO") && vista.includes("dataCancellazioneContenuti") && vista.includes("MESSAGGIO_UFFICIO_GARE_GARE_FINITE"));
  const topbar = leggi("src/components/omnia-ai/topbar.tsx");
  atteso("barra superiore: l'Ufficio Gare non ha campanella né menu del profilo", topbar.includes("{!ufficioGare && <NotificationBell />}") && topbar.includes("{!ufficioGare && <ProfiloMenu email={email} />}"));
  const schede = leggi("src/components/omnia-ai/status-cards.tsx");
  const vistaSchede = schede.slice(schede.indexOf("if (ufficioGare) {"), schede.indexOf("  return (\n    <div className=\"omnia-riquadri-stato\">\n      <div className=\"omnia-riquadro-stato\">\n        <div className=\"omnia-riquadro-stato-etichetta\">Gare attive</div>\n        <div className=\"omnia-riquadro-stato-valore\">{gareAttive}</div>\n      </div>\n\n      <div className=\"omnia-riquadro-stato\">\n        <div className=\"omnia-riquadro-stato-etichetta\">Gare completate</div>\n        <div className=\"omnia-riquadro-stato-valore\">{gareCompletate}</div>\n      </div>\n\n      <div className=\"omnia-riquadro-stato omnia-riquadro-stato-filigrana\">\n        <BrandMark />\n        {gareGratuite"));
  atteso("riquadri di stato dell'Ufficio Gare: gare a disposizione, senza crediti, piano né rinnovo", vistaSchede.length > 100 && vistaSchede.includes("Gare a disposizione") && !/Crediti aggiuntivi|Gare del piano|Rinnovo|saldoCrediti|dataRinnovo|consumatePiano/.test(vistaSchede));
  const scorciatoie = leggi("src/components/omnia-ai/cosa-vuoi-fare-oggi.tsx");
  const blocco = scorciatoie.slice(scorciatoie.indexOf("const SCORCIATOIE_UFFICIO_GARE"), scorciatoie.indexOf("// Occupa da sola"));
  atteso("scorciatoie dell'Ufficio Gare: solo nuova gara e supporto", blocco.includes("/gare") && blocco.includes("/assistenza") && !/abbonamento|profilo-azienda|documenti-aziendali|pagamenti|impostazioni/.test(blocco));
  const home = leggi(`${base}/page.tsx`);
  atteso("home: abbonamento, piano e crediti si leggono sul titolare con il client giusto per ruolo", home.includes("clientePerAccount(contesto, supabase)") && home.includes("getConsumoPeriodoCorrente(accountId, clienteAbbonamento)") && home.includes("getOmniaAiAccessState(accountId, clienteAbbonamento)"));
  atteso("home: con zero gare a disposizione l'Ufficio Gare fa partire l'avviso al titolare", home.includes("gareDisponibili === 0") && home.includes('motivo: "gare_finite"'));
  const paginaGara = leggi(`${base}/gare/[id]/page.tsx`);
  atteso("pagina gara: piano e abbonamento letti sul titolare, diritto verificato per l'account", /clienteAbbonamento\s*\.from\("subscriptions"\)/.test(paginaGara) && paginaGara.includes("dirittoGaraPerAccount({ contesto, user, garaId: gara.id })") && paginaGara.includes("userId: contesto.accountId, garaId: gara.id"));
  atteso("pagina gara: all'Ufficio Gare non si offrono acquisti né revisione a pagamento", paginaGara.includes("ufficioGare={ufficioGare}") && (paginaGara.match(/ufficioGare=\{ufficioGare\}/g) ?? []).length === 3);

  console.log("--- Componenti della gara per l'Ufficio Gare ---");
  const avviso = leggi(`${base}/gare/[id]/gara-bloccata-avviso.tsx`);
  atteso("avviso gara bloccata: per l'Ufficio Gare niente link all'abbonamento né confronto di prezzi", avviso.includes("{!ufficioGare && motivo === \"gratuite_esaurite\" && (") && avviso.includes("{!ufficioGare && motivo === \"quota_esaurita\" && <QuotaEsauritaConfronto"));
  const estrazione = leggi(`${base}/gare/[id]/extraction-section.tsx`);
  atteso("sezione di estrazione: per l'Ufficio Gare niente link all'abbonamento né confronto di prezzi", estrazione.includes("state.quotaEsaurita && !ufficioGare && inProva") && estrazione.includes("state.quotaEsaurita && !ufficioGare && !inProva"));
  const pannello = leggi(`${base}/gare/[id]/revisione-panel.tsx`);
  const iFormAvviso = pannello.indexOf("<RevisioneAvvisoForm garaId={garaId} />");
  const iPrezzo = pannello.indexOf("Prezzo per questa gara");
  atteso("pannello della revisione: all'Ufficio Gare il pulsante che avvisa, prima e senza il blocco del prezzo", pannello.includes(") : ufficioGare ? (") && iFormAvviso !== -1 && iFormAvviso < iPrezzo && iPrezzo !== -1);
  const formAvviso = leggi(`${base}/gare/[id]/revisione-avviso-form.tsx`);
  atteso("pulsante della revisione per l'Ufficio Gare: chiama solo l'azione che avvisa e non porta alla pagina di pagamento", formAvviso.includes("avvisaAmministratoreRevisione") && !/href|Link|revisione\?|avviaRevisioneUmana/.test(formAvviso));

  console.log("--- Il profilo azienda nella pipeline: sempre del titolare ---");
  for (const file of ["src/lib/relazione-tecnica.ts", "src/lib/organigramma-fatti.ts", "src/lib/figure-fatti.ts", "src/lib/org-chart-loghi.ts", "src/lib/evidenza-dati.ts", "src/app/actions/gara-chat.ts", "src/app/actions/download.ts"]) {
    const sorgente = leggi(file);
    const letture = [...sorgente.matchAll(/from\("companies"\)/g)].map((m) => m.index ?? 0);
    const tutteConChiave = letture.every((i) => /createAdminClient|profili\b/.test(sorgente.slice(Math.max(0, i - 220), i)));
    atteso(`${path.basename(file)}: ogni lettura del profilo azienda usa la chiave di servizio (${letture.length})`, letture.length > 0 && tutteConChiave);
  }
  atteso("organigramma e figure: il profilo si legge dal client di servizio creato nella funzione, non da quello ricevuto", leggi("src/lib/organigramma-fatti.ts").includes("const profili = createAdminClient();") && leggi("src/lib/figure-fatti.ts").includes("const supabase = createAdminClient();") && !/params\.supabase|\{ supabase, userId \}/.test(leggi("src/lib/figure-fatti.ts")));
  atteso("nessuna libreria legge la sessione per conto suo (solo guardie, middleware e console)", elencoFile("src/lib", (n) => n.endsWith(".ts")).filter((f) => leggi(f).includes("auth.getUser()")).every((f) => ["src/lib/omnia-ai-account-guardie.ts", "src/lib/supabase/middleware.ts", "src/lib/console/accesso.ts"].includes(f)), elencoFile("src/lib", (n) => n.endsWith(".ts")).filter((f) => leggi(f).includes("auth.getUser()")).join(", "));
  atteso("il logo dell'organigramma è del titolare (identificativo passato dal chiamante)", leggi("src/lib/org-chart-loghi.ts").includes("recuperaLoghiOrganigramma(garaId: string, userId: string)") && (leggi("src/lib/relazione-tecnica.ts").match(/recuperaLoghiOrganigramma\(garaId, userId\)/g) ?? []).length === 2);

  console.log("--- Aiuti per l'account effettivo ---");
  const lavoro = leggi("src/lib/omnia-ai-account-lavoro.ts");
  atteso("l'Ufficio Gare legge abbonamento e crediti con la chiave di servizio, il titolare con la propria sessione", /return contesto\.ruolo === "ufficio_gare" \? createAdminClient\(\) : supabase;/.test(lavoro));
  atteso("abbonamento non attivo: l'Ufficio Gare riceve il promemoria e il titolare l'email", lavoro.includes("MESSAGGIO_UFFICIO_GARE_ABBONAMENTO_NON_ATTIVO") && lavoro.includes('motivo: "abbonamento_non_attivo"') && lavoro.includes("requireOmniaAiWriteAccess(contesto.accountId,") && lavoro.includes("    return MESSAGGIO_UFFICIO_GARE_ABBONAMENTO_NON_ATTIVO;\n  }\n  return negato;"));
  atteso("gare finite: il diritto si verifica sul titolare, il promemoria sostituisce i testi di acquisto, una verifica non riuscita non avvisa nessuno", lavoro.includes("verificaDirittoGara({ garaId, userId: contesto.accountId })") && lavoro.includes('if (diritto.motivo === "verifica_non_riuscita") return diritto;') && lavoro.indexOf('verifica_non_riuscita") return diritto') < lavoro.lastIndexOf("avvisaTitolareDopoLaRisposta(") && lavoro.includes('messaggioPerUfficioGare("gare_finite")'));
  const quota = leggi("src/lib/omnia-ai-ufficio-gare-quota.ts");
  atteso("l'avviso dopo la risposta salta il titolare e l'Ufficio Gare sospeso, e non rompe mai la pagina", quota.includes('if (contesto.ruolo !== "ufficio_gare" || contesto.sospeso || !emailUfficioGare) return;') && quota.includes("after(async () => {") && /catch \(e\) \{\s*console\.error/.test(quota) && quota.includes("titolareId: contesto.accountId") && quota.includes("membroId: contesto.userId"));
  const guardie = leggi("src/lib/omnia-ai-account-guardie.ts");
  atteso("guardia del lavoro di gara: l'Ufficio Gare sospeso non lavora, un errore di verifica non apre nulla", guardie.includes("if (sessione.contesto.sospeso) return { ok: false, errore: MESSAGGIO_UFFICIO_GARE_SOSPESO };") && guardie.includes("if (sessione.contesto.sospeso) return null;"));

  console.log("--- Quando e come avvisare il titolare ---");
  uguale("abbonamento in sola lettura o cessato: «abbonamento non attivo»", [motivoAvvisoTitolare({ stato: "sola_lettura", diritto: null }), motivoAvvisoTitolare({ stato: "cessato", diritto: "quota_esaurita" })], ["abbonamento_non_attivo", "abbonamento_non_attivo"]);
  uguale("abbonamento attivo o prova con quota o gare gratuite finite: «gare finite»", [motivoAvvisoTitolare({ stato: "attivo", diritto: "quota_esaurita" }), motivoAvvisoTitolare({ stato: "prova", diritto: "gratuite_esaurite" })], ["gare_finite", "gare_finite"]);
  uguale("una verifica non riuscita o un diritto concesso non avvisano nessuno", [motivoAvvisoTitolare({ stato: "attivo", diritto: "verifica_non_riuscita" }), motivoAvvisoTitolare({ stato: "attivo", diritto: "quota_disponibile" }), motivoAvvisoTitolare({ stato: "attivo", diritto: "gia_consumata" }), motivoAvvisoTitolare({ stato: "prova", diritto: null })], [null, null, null, null]);
  uguale("testi di blocco: il titolare riceve i suoi, l'Ufficio Gare il promemoria per l'amministratore", [testoBloccoPerRuolo("titolare", "gare_finite", "TESTO DEL TITOLARE"), testoBloccoPerRuolo("ufficio_gare", "gare_finite", "TESTO DEL TITOLARE"), testoBloccoPerRuolo("ufficio_gare", "abbonamento_non_attivo", "x")], ["TESTO DEL TITOLARE", MESSAGGIO_UFFICIO_GARE_GARE_FINITE, MESSAGGIO_UFFICIO_GARE_ABBONAMENTO_NON_ATTIVO]);
  uguale(
    "gare rimanenti: piano non usato + crediti + gare gratuite; mai negative",
    [
      gareRimanenti({ piano: { gareIncluse: 5, consumate: 3 }, crediti: 2, gratuite: null }),
      gareRimanenti({ piano: { gareIncluse: 5, consumate: 5 }, crediti: 0, gratuite: null }),
      gareRimanenti({ piano: { gareIncluse: 5, consumate: 9 }, crediti: -3, gratuite: null }),
      gareRimanenti({ piano: null, crediti: 0, gratuite: { rimanenti: 4 } }),
      gareRimanenti({ piano: null, crediti: 1, gratuite: { rimanenti: -2 } }),
    ],
    [4, 0, 0, 4, 1],
  );

  // database finto con il vincolo di unicità (titolare, tipo, chiave, giorno) e controllo-e-scrittura atomico, come un vero indice unico
  type Riga = { id: string; titolare_id: string; membro_id: string; tipo: string; chiave: string };
  function fintoDb(opzioni: { emailTitolare?: string | null; erroreInserimento?: { code: string } } = {}) {
    const righe: Riga[] = [];
    let n = 0;
    const admin = {
      from: (tabella: string) => {
        if (tabella === "omnia_ai_membri_avvisi") {
          return {
            insert: (riga: Omit<Riga, "id">) => ({
              select: () => ({
                single: async () => {
                  if (opzioni.erroreInserimento) return { data: null, error: { ...opzioni.erroreInserimento, message: "errore" } };
                  if (righe.some((r) => r.titolare_id === riga.titolare_id && r.tipo === riga.tipo && r.chiave === riga.chiave)) return { data: null, error: { code: "23505", message: "duplicato" } };
                  const id = `r${++n}`;
                  righe.push({ id, ...riga });
                  return { data: { id }, error: null };
                },
              }),
            }),
            delete: () => ({
              eq: async (_colonna: string, id: string) => {
                const i = righe.findIndex((r) => r.id === id);
                if (i >= 0) righe.splice(i, 1);
                return { error: null };
              },
            }),
          };
        }
        if (tabella === "users") {
          return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: opzioni.emailTitolare === null ? null : { email: opzioni.emailTitolare ?? "titolare@azienda.it" }, error: null }) }) }) };
        }
        throw new Error(`tabella inattesa: ${tabella}`);
      },
    };
    return { righe, admin: admin as unknown as Parameters<typeof avvisaTitolareQuotaFinita>[0]["admin"] };
  }

  const vecchioFetch = globalThis.fetch;
  const vecchiaChiave = process.env.RESEND_API_KEY;
  const vecchioErrore = console.error;
  const inviati: { to: string[]; subject: string; html: string }[] = [];
  let rispostaOk = true;
  let lancia = false;
  process.env.RESEND_API_KEY = "chiave-di-prova";
  console.error = () => {};
  globalThis.fetch = (async (_url: string, init: { body: string }) => {
    if (lancia) throw new Error("rete caduta");
    inviati.push(JSON.parse(init.body));
    return { ok: rispostaOk, text: async () => "risposta" };
  }) as unknown as typeof fetch;
  try {
    const quotaDi = (db: ReturnType<typeof fintoDb>, motivo: "gare_finite" | "abbonamento_non_attivo" = "gare_finite") =>
      avvisaTitolareQuotaFinita({ admin: db.admin, titolareId: "T1", membroId: "M1", emailUfficioGare: "gare@azienda.it", motivo });
    const revisioneDi = (db: ReturnType<typeof fintoDb>, garaId: string) =>
      avvisaTitolareRevisione({ admin: db.admin, titolareId: "T1", membroId: "M1", emailUfficioGare: "gare@azienda.it", garaId, titoloGara: `Gara ${garaId}` });

    {
      const db = fintoDb();
      inviati.length = 0;
      uguale("gare finite: la prima volta l'email parte", await quotaDi(db), "inviato");
      atteso("l'email va al TITOLARE, dice chi è l'Ufficio Gare e non contiene prezzi", inviati.length === 1 && inviati[0].to[0] === "titolare@azienda.it" && inviati[0].html.includes("gare@azienda.it") && !/€/.test(inviati[0].html));
      uguale("la riga registrata ha titolare, membro, tipo e chiave vuota", db.righe.map((r) => [r.titolare_id, r.membro_id, r.tipo, r.chiave]), [["T1", "M1", "quota_esaurita", ""]]);
      uguale("la seconda volta nello stesso giorno non parte nulla", await quotaDi(db), "gia_inviato_oggi");
      uguale("nemmeno con un motivo diverso: una al giorno in tutto", await quotaDi(db, "abbonamento_non_attivo"), "gia_inviato_oggi");
      atteso("in totale una sola email", inviati.length === 1);
    }
    {
      const db = fintoDb();
      inviati.length = 0;
      uguale("revisione per la gara A: parte", await revisioneDi(db, "A"), "inviato");
      uguale("revisione per la gara A di nuovo: già avvisato oggi", await revisioneDi(db, "A"), "gia_inviato_oggi");
      uguale("revisione per un'altra gara: parte (una al giorno PER GARA)", await revisioneDi(db, "B"), "inviato");
      uguale("la quota e la revisione non si bloccano a vicenda", await quotaDi(db), "inviato");
      atteso("tre email in tutto, e quella della revisione nomina la gara", inviati.length === 3 && inviati[0].html.includes("Gara A") && inviati[0].subject.includes("Gara A"));
      uguale("le chiavi registrate", db.righe.map((r) => `${r.tipo}:${r.chiave}`), ["revisione_richiesta:A", "revisione_richiesta:B", "quota_esaurita:"]);
    }
    {
      const db = fintoDb();
      inviati.length = 0;
      rispostaOk = false;
      uguale("il servizio di posta rifiuta l'invio: «non riuscito»", await quotaDi(db), "non_riuscito");
      uguale("l'invio fallito NON consuma il giorno (la riga viene tolta)", db.righe.length, 0);
      rispostaOk = true;
      uguale("il tentativo successivo riprova e parte", await quotaDi(db), "inviato");
      uguale("e dopo di nuovo non parte", await quotaDi(db), "gia_inviato_oggi");
      lancia = true;
      const db2 = fintoDb();
      uguale("la rete cade durante l'invio: «non riuscito», nessuna eccezione verso chi chiama", await quotaDi(db2), "non_riuscito");
      uguale("e la riga viene tolta anche in questo caso", db2.righe.length, 0);
      lancia = false;
    }
    {
      inviati.length = 0;
      const db = fintoDb({ erroreInserimento: { code: "42501" } });
      uguale("errore del database diverso da «già inviato»: «non riuscito», e nessuna email", [await quotaDi(db), inviati.length], ["non_riuscito", 0]);
      const senzaEmail = fintoDb({ emailTitolare: null });
      uguale("email del titolare mancante: «non riuscito», riga tolta, nessuna email", [await quotaDi(senzaEmail), senzaEmail.righe.length, inviati.length], ["non_riuscito", 0, 0]);
    }
    {
      // cinque richieste contemporanee (cinque pagine aperte insieme): l'email parte UNA volta
      const db = fintoDb();
      inviati.length = 0;
      const esiti = await Promise.all([1, 2, 3, 4, 5].map(() => quotaDi(db)));
      uguale("cinque richieste contemporanee: una sola email", [esiti.filter((e) => e === "inviato").length, esiti.filter((e) => e === "gia_inviato_oggi").length, inviati.length], [1, 4, 1]);
    }
  } finally {
    globalThis.fetch = vecchioFetch;
    console.error = vecchioErrore;
    if (vecchiaChiave === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = vecchiaChiave;
  }
  const avvisi = leggi("src/lib/omnia-ai-ufficio-gare-avvisi.ts");
  atteso("l'avviso si scrive PRIMA di mandare l'email e si toglie se l'invio fallisce", avvisi.indexOf(".insert({ titolare_id: titolareId") < avvisi.indexOf("sendEmail(") && (avvisi.match(/await rilascia\(\)/g) ?? []).length === 2);
  atteso("nessuna email parte mai senza una riga registrata (il limite sta nel database)", !/sendEmail\(/.test(avvisi.slice(0, avvisi.indexOf(".insert({ titolare_id: titolareId"))));

  if (fallimenti.length > 0) {
    console.log(`\n${fallimenti.length} controlli falliti:\n- ${fallimenti.join("\n- ")}`);
    process.exit(1);
  }
  console.log("\nTutti i controlli sono andati a buon fine.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
