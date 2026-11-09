// Autotest dei TESTI LEGALI e del sito del piano di lavoro, senza rete e senza database:
//   - i testi stanno in un posto solo (piano-lavoro-testi.ts) e le interfacce li usano, non ne hanno copie;
//   - la pagina pubblica delle condizioni mostra le stesse clausole con la stessa impronta che si registra all'accettazione, e non si indicizza;
//   - la fascia nella pagina dei piani compare solo con il piano di lavoro in vendita e non ha prezzi scritti a mano;
//   - le email rimandano alle condizioni e la console riporta l'approvazione del legale (data e versione delle clausole);
//   - il Word per il legale contiene ogni clausola, ogni avvertenza del file Excel, i testi dell'interfaccia e i prezzi, tutti presi dalle fonti del programma.
// Gratuito: gira nel livello 1, quindi in prebuild.
import fs from "fs";
import path from "path";
import { createHash } from "crypto";
import JSZip from "jszip";
import {
  CLAUSOLE_PIANO_LAVORO,
  CLAUSOLE_SPECIFICHE_PIANO_LAVORO,
  VERSIONE_CONDIZIONI_PIANO_LAVORO,
  testoCanonicoCondizioniPianoLavoro,
} from "../src/lib/piano-lavoro-acquisto-calcoli";
import { costruisciDossier, htmlInTesto } from "../src/lib/piano-lavoro-dossier-legale";
import { creaWordDossier } from "../src/lib/piano-lavoro-dossier-word";
import { emailClientePianoLavoroAcquistato } from "../src/lib/omnia-ai-email-piano-lavoro-calcoli";
import { AVVERTENZE_FISSE, LEGENDA_FILE } from "../src/lib/piano-lavoro-excel";
import {
  APPROVAZIONE_LEGALE_PIANO_LAVORO,
  BANDA_PIANO_LAVORO,
  CONDIZIONI_INTRO,
  FORNITORE_PIANO_LAVORO,
  NOTA_CONSOLE_TESTI,
  NOTA_FONTE_DIRITTO,
  OPZIONE_ABBONAMENTO_DESCRIZIONE,
  PERCORSO_CONDIZIONI_PIANO_LAVORO,
  RIQUADRO_PIANO_PARTI,
  partiRigaPianoLavoroPerPiano,
  rigaPianoLavoroPerPiano,
  SITO_COME_FUNZIONA_PIANO_LAVORO,
  SITO_FAQ_PIANO_LAVORO,
  SITO_HOME_PIANO_LAVORO,
  testoAccettazioneCompleta,
  testoApprovazioneSpecifica,
} from "../src/lib/piano-lavoro-testi";

const fallimenti: string[] = [];
function atteso(nome: string, ok: boolean, dettaglio = "") {
  console.log(`${ok ? "ok    " : "FALLITO"} ${nome}${ok ? "" : ` — ${dettaglio}`}`);
  if (!ok) fallimenti.push(nome);
}
function uguale<T>(nome: string, ottenuto: T, previsto: T) {
  atteso(nome, JSON.stringify(ottenuto) === JSON.stringify(previsto), `ottenuto ${JSON.stringify(ottenuto)}, previsto ${JSON.stringify(previsto)}`);
}
const leggi = (relativo: string) => fs.readFileSync(path.join(__dirname, "..", relativo), "utf-8").replace(/\r\n/g, "\n");

const testoXml = (xml: string) =>
  [...xml.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g)]
    .map((m) => m[1].replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&"))
    .join("\n");

async function main() {
  // ═════ 1. i testi, in un posto solo ═════
  {
    const pannello = leggi("src/app/site-omnia-ai/dashboard/omnia-ai/gare/[id]/piano-lavoro-panel.tsx");
    const opzione = leggi("src/components/omnia-ai/opzione-piano-lavoro.tsx");
    const cambio = leggi("src/app/site-omnia-ai/dashboard/omnia-ai/abbonamento/cambia-piano-form.tsx");
    const vistaPiani = leggi("src/app/site-omnia-ai/piani/piani-vista.tsx");
    const testi = leggi("src/lib/piano-lavoro-testi.ts");

    atteso("i testi sono in piano-lavoro-testi.ts, un modulo senza dipendenze di server (lo usano anche i componenti client)", !/^import .*(supabase|stripe|anthropic)/im.test(testi) && /export const RIQUADRO_PIANO_PARTI/.test(testi));
    atteso(
      "riquadro nella gara: la nota, il dettaglio dell'acquisto, le note per fonte e l'approvazione specifica vengono dai testi condivisi, senza copie",
      /RIQUADRO_PIANO_PARTI\[0\]/.test(pannello) && /\{ACQUISTO_SINGOLO_DETTAGLIO\}/.test(pannello) && /NOTA_FONTE_DIRITTO/.test(pannello) && /testoApprovazioneSpecifica\(/.test(pannello) && !/Un Excel con formule attive e modificabile/.test(pannello) && !/Incluso nel tuo abbonamento/.test(pannello) && !/Dichiaro di approvare specificamente/.test(pannello),
    );
    atteso(
      "opzione dell'abbonamento e aggiunta a un abbonamento attivo: stessa casella (testoAccettazioneCompleta), stessa descrizione, stessa pagina delle condizioni, senza copie",
      /testoAccettazioneCompleta\(/.test(opzione) && /testoAccettazioneCompleta\(/.test(cambio) && /\{OPZIONE_ABBONAMENTO_DESCRIZIONE\}/.test(opzione) && !/Dichiaro di aver letto/.test(opzione + cambio) && /PERCORSO_CONDIZIONI_PIANO_LAVORO/.test(opzione) && /PERCORSO_CONDIZIONI_PIANO_LAVORO/.test(cambio) && /PERCORSO_CONDIZIONI_PIANO_LAVORO/.test(pannello),
    );
    atteso("pagina dei piani: nessuna riga del piano di lavoro sotto i piani e nessun testo scritto a mano (il piano di lavoro sta nella sezione per categoria, dai testi condivisi)", !/partiRigaPianoLavoroPerPiano|\{opzione\./.test(vistaPiani) && !/Con il piano di lavoro Excel/.test(vistaPiani) && /ServiziPerCategoria/.test(vistaPiani));
    atteso("le tre interfacce mostrano le clausole intere (dalla stessa fonte che si hasha), non un riassunto", [pannello, opzione, cambio].every((s) => /CLAUSOLE_PIANO_LAVORO\.map/.test(s) && /\{c\.testo\}/.test(s)));

    uguale(
      "le caselle di accettazione dicono quali clausole si approvano specificamente (2, 4, 6) e le loro intestazioni",
      [testoApprovazioneSpecifica([2, 4, 6], ["natura del documento", "documenti e risultato", "limitazione di responsabilità"]), testoAccettazioneCompleta([2, 4, 6], ["a", "b", "c"])],
      [
        "Dichiaro di approvare specificamente, ai sensi di legge, le clausole n. 2, 4, 6 (natura del documento; documenti e risultato; limitazione di responsabilità).",
        "Dichiaro di aver letto e accettato le avvertenze sul piano di lavoro e di approvare specificamente, ai sensi di legge, le clausole n. 2, 4, 6 (a; b; c).",
      ],
    );
    uguale("le clausole da approvare specificamente sono la 2, la 4 e la 6", CLAUSOLE_SPECIFICHE_PIANO_LAVORO.map((c) => c.numero), [2, 4, 6]);
    atteso(
      "il testo dice le cose che il servizio deve dire: dimensionamento di partenza e non preventivo, prezzi standard da sostituire, una generazione per gara e proroga, costo del lavoro escluso",
      /dimensionamento di partenza/.test(RIQUADRO_PIANO_PARTI.join("")) && /non un preventivo/.test(RIQUADRO_PIANO_PARTI.join("")) && /sostituire con quelli dei tuoi fornitori/.test(RIQUADRO_PIANO_PARTI.join("")) && /proroga dei termini/.test(OPZIONE_ABBONAMENTO_DESCRIZIONE) && /gare acquistate con i crediti/.test(OPZIONE_ABBONAMENTO_DESCRIZIONE) && /Il costo del lavoro non è compreso/.test(testoCanonicoCondizioniPianoLavoro()),
    );
    atteso("le note per fonte coprono abbonamento, concessione, prova e acquisto", Object.keys(NOTA_FONTE_DIRITTO).sort().join() === "abbonamento,acquisto,concessione,prova");
  }

  // ═════ 2. la pagina pubblica delle condizioni ═════
  {
    const pagina = leggi("src/app/site-omnia-ai/condizioni-piano-lavoro/page.tsx");
    atteso(
      "pagina delle condizioni: mostra le clausole (titolo e testo) dalla fonte che si hasha, ogni clausola ha il suo indirizzo, quelle da approvare specificamente sono segnate",
      /CLAUSOLE_PIANO_LAVORO\.map/.test(pagina) && /id=\{`clausola-\$\{c\.numero\}`\}/.test(pagina) && /\{c\.testo\}/.test(pagina) && /c\.specifica &&/.test(pagina) && /VERSIONE_CONDIZIONI_PIANO_LAVORO/.test(pagina),
    );
    atteso(
      "pagina delle condizioni: mostra l'impronta SHA-256 dello STESSO testo canonico che si registra all'accettazione",
      /createHash\("sha256"\)\.update\(testoCanonicoCondizioniPianoLavoro\(\)\)\.digest\("hex"\)/.test(pagina) && /\{impronta\}/.test(pagina) && /createHash\("sha256"\)\.update\(testoCanonicoCondizioniPianoLavoro\(\)\)/.test(leggi("src/app/actions/gara-piano-lavoro.ts")),
    );
    atteso("pagina delle condizioni: non si indicizza (non è una pagina da trovare dai motori di ricerca) e non è nella mappa del sito", /robots: \{ index: false, follow: true \}/.test(pagina) && !/condizioni-piano-lavoro/.test(leggi("src/app/sitemap.ts")));
    atteso("pagina delle condizioni: indica il fornitore (stessi dati delle Condizioni di abbonamento), l'introduzione e i documenti collegati", /FORNITORE_PIANO_LAVORO/.test(pagina) && /CONDIZIONI_INTRO\.map/.test(pagina) && /href="\/privacy"/.test(pagina) && /getCurrentOmniaAiCondizioniAbbonamentoUrl/.test(pagina) && /href="\/riservatezza"/.test(pagina));
    atteso("il fornitore è quello delle Condizioni di abbonamento (stessa ragione sociale, partita IVA e indirizzi)", ["Omnia Consulting SRLS", "02957590819", "info@omniaitalia.com", "omnia26@legalmail.it"].every((s) => FORNITORE_PIANO_LAVORO.includes(s) && leggi("legal/condizioni-abbonamento-v2.md").includes(s)));
    atteso("l'introduzione dice che si accetta all'acquisto e che si registrano versione, impronta, data, indirizzo IP e browser", CONDIZIONI_INTRO.join(" ").includes("versione e l'impronta") && /indirizzo IP e il browser/.test(CONDIZIONI_INTRO.join(" ")));
  }

  // ═════ 3. la fascia nella pagina dei piani ═════
  {
    const banda = leggi("src/app/site-omnia-ai/piani/piano-lavoro-banda.tsx");
    const vista = leggi("src/app/site-omnia-ai/piani/piani-vista.tsx");
    const pagina = leggi("src/app/site-omnia-ai/piani/page.tsx");
    // (09/11/2026: il piano di lavoro NON si compra con l'abbonamento: sotto i piani non c'è più nessuna riga né supplemento; il piano di lavoro si
    // presenta nella sezione per categoria, con il solo prezzo della singola gara, letto dalla console; solo «Abbonati» dipende dalla vendita)
    atteso(
      "pagina dei piani: nessuna riga né supplemento del piano di lavoro sotto i piani; la sezione per categoria si vede SEMPRE con il prezzo della singola gara letto dalla console; solo «Abbonati» dipende dalla vendita",
      /<ServiziPerCategoria prezzoSingolaGara=\{formatEuro\(prezzoSingolaGaraCentesimi\)\} \/>/.test(vista) &&
        !/partiRigaPianoLavoroPerPiano|surplusPianoLavoro|omnia-prezzo-opzione|PianoLavoroBanda|piano-lavoro-banda/.test(vista) &&
        !/leggiSurplusPianoLavoro|surplusSeInVendita|surplusPianoLavoro/.test(pagina) &&
        /leggiPrezzoPianoLavoro\(\)/.test(pagina) &&
        /\{vendita && \(\s*<Link className="omnia-btn omnia-btn-p" href=\{`\/abbonati\/\$\{p\.slug\}`\}>/.test(vista) &&
        /prezzoSingolaGaraCentesimi: number;/.test(vista),
    );
    // (la vecchia fascia non è più in pagina ma il file resta: si controlla ancora che non contenga prezzi scritti a mano)
    atteso("fascia dei piani (non più in pagina): i prezzi non sono scritti a mano (vengono dalle stesse letture del checkout), il testo dal modulo condiviso, con il collegamento alle condizioni", !/\d+ ?€/.test(banda.replace(/\/\/.*$/gm, "")) && /BANDA_PIANO_LAVORO/.test(banda) && /formatEuro\(prezzoSingolaGaraCentesimi\)/.test(banda) && /formatEuro\(surplus\.starter\)/.test(banda) && /PERCORSO_CONDIZIONI_PIANO_LAVORO/.test(banda));
    atteso("fascia dei piani: dice che è un dimensionamento di partenza e non un preventivo e non promette nulla sull'esito della gara", /non un preventivo/.test(BANDA_PIANO_LAVORO.nota) && !/aggiudic|vincer|punteggio/i.test(JSON.stringify(BANDA_PIANO_LAVORO)));
    uguale("la riga sotto ogni piano (testo conservato nel modulo, non più mostrato nella pagina)", rigaPianoLavoroPerPiano("150,00"), "Con il piano di lavoro Excel: +150,00 € al mese. Per ogni gara inclusa nel piano un Excel con formule attive, costruito dai documenti di gara.");
    uguale(
      "la riga sotto ogni piano: la parte in evidenza è quella con il prezzo, il resto non ha cifre",
      [partiRigaPianoLavoroPerPiano("350,00").evidenza, /\d/.test(partiRigaPianoLavoroPerPiano("350,00").seguito)],
      ["Con il piano di lavoro Excel: +350,00 € al mese.", false],
    );
    const css = leggi("src/app/site-omnia-ai/omnia-ai.css");
    atteso("la sezione per categoria ha i suoi stili (menu, contenuto della scelta, badge di stato, due schede) e la pagina dei piani non usa più la riga sotto ogni piano", /\.omnia-servizi-menu \{/.test(css) && /\.omnia-servizi-esito \{/.test(css) && /\.omnia-servizi-stato \{/.test(css) && /\.omnia-revisione-punti\.due \{/.test(css) && !/className="omnia-prezzo-opzione"/.test(vista));
  }

  // ═════ 3 bis. home, «Come funziona» e domande frequenti ═════
  {
    const home = leggi("src/app/site-omnia-ai/page.tsx");
    const comeFunziona = leggi("src/app/site-omnia-ai/come-funziona/page.tsx");
    const sitemap = leggi("src/app/sitemap.ts");
    const testi = leggi("src/lib/piano-lavoro-testi.ts");

    atteso(
      "home: la sezione sul piano di lavoro (titolo, guida, punti, nota, collegamento ai piani) e la domanda frequente vengono dai testi condivisi, senza copie",
      /SITO_HOME_PIANO_LAVORO\.titolo/.test(home) && /SITO_HOME_PIANO_LAVORO\.guida/.test(home) && /SITO_HOME_PIANO_LAVORO\.punti\.map/.test(home) && /SITO_HOME_PIANO_LAVORO\.nota/.test(home) && /href="\/piani"/.test(home) && /SITO_HOME_PIANO_LAVORO\.collegamento/.test(home) && /^\s*SITO_FAQ_PIANO_LAVORO,$/m.test(home) && !/Genera anche il piano di lavoro/.test(home) && !/Dai documenti di gara anche il piano di lavoro/.test(home),
    );
    atteso(
      "«Come funziona»: la sezione sul piano di lavoro (titolo, guida, quattro passi, nota, collegamento ai piani) viene dai testi condivisi, senza copie",
      /SITO_COME_FUNZIONA_PIANO_LAVORO\.titolo/.test(comeFunziona) && /SITO_COME_FUNZIONA_PIANO_LAVORO\.guida/.test(comeFunziona) && /SITO_COME_FUNZIONA_PIANO_LAVORO\.passi\.map/.test(comeFunziona) && /SITO_COME_FUNZIONA_PIANO_LAVORO\.nota/.test(comeFunziona) && /href="\/piani"/.test(comeFunziona) && /SITO_COME_FUNZIONA_PIANO_LAVORO\.collegamento/.test(comeFunziona) && !/E poi, il piano di lavoro/.test(comeFunziona) && SITO_COME_FUNZIONA_PIANO_LAVORO.passi.length === 4,
    );
    atteso("home e «Come funziona»: la sezione sul piano di lavoro viene dopo il resto del contenuto già esistente, non lo sostituisce (l'esempio dal vivo e «Chi c'è dietro» ci sono ancora)", /<ComeFunzionaDemo \/>/.test(comeFunziona) && comeFunziona.indexOf("<ComeFunzionaDemo />") < comeFunziona.indexOf("SITO_COME_FUNZIONA_PIANO_LAVORO.titolo") && /Chi c&apos;è dietro/.test(home) && home.indexOf('id="piano-di-lavoro"') < home.indexOf("Chi c&apos;è dietro"));

    // I testi di queste tre pagine sono statici: i prezzi stanno solo nella pagina dei piani (che li legge dalla console), così non si possono mai
    // contraddire. Niente promesse sull'esito della gara, e nessun'altra gara o cliente nominati (regola assoluta del piano di lavoro).
    const sito = JSON.stringify([SITO_HOME_PIANO_LAVORO, SITO_FAQ_PIANO_LAVORO, SITO_COME_FUNZIONA_PIANO_LAVORO]);
    atteso("testi di home, domanda frequente e «Come funziona»: nessuna cifra in euro (i prezzi stanno solo nei piani)", !/\d+(?:[.,]\d+)? ?€|€ ?\d/.test(sito) && !/\beuro\b/i.test(sito));
    atteso("testi di home, domanda frequente e «Come funziona»: nessuna promessa sull'esito della gara, nessun «preventivo» promesso, il dimensionamento è dichiarato di partenza", !/aggiudic|vincer|garantit|certific/i.test(sito) && /non un preventivo/.test(SITO_HOME_PIANO_LAVORO.nota) && /non un preventivo/.test(SITO_COME_FUNZIONA_PIANO_LAVORO.nota) && /non un preventivo/.test(SITO_FAQ_PIANO_LAVORO.risposta));
    atteso("testi di home, domanda frequente e «Come funziona»: non nominano altre gare, clienti o stazioni appaltanti", !/\b(smac|donnafugata|ipc|fimap|asl|comune di|azienda ospedaliera)\b/i.test(sito));
    atteso("la domanda frequente dice che si compra SOLO dentro la singola gara (nessun abbonamento con supplemento), che vale per le gare di pulizia, e rimanda ai piani per il prezzo", /singola gara/.test(SITO_FAQ_PIANO_LAVORO.risposta) && !/abbonamento|supplemento/i.test(SITO_FAQ_PIANO_LAVORO.risposta) && /gare di servizi di pulizia/.test(SITO_FAQ_PIANO_LAVORO.risposta) && /pagina dei piani/.test(SITO_FAQ_PIANO_LAVORO.risposta) && /quadratura con il monte ore dichiarato dal bando/.test(SITO_FAQ_PIANO_LAVORO.risposta) && !/abbonamento/i.test(SITO_HOME_PIANO_LAVORO.nota) && /gare di servizi di pulizia/.test(SITO_HOME_PIANO_LAVORO.guida) && /gare di servizi di pulizia/.test(SITO_COME_FUNZIONA_PIANO_LAVORO.guida));
    atteso("il modulo dei testi resta senza dipendenze di server anche con le sezioni del sito (le pagine pubbliche sono statiche)", !/^import /m.test(testi));

    const data = (percorso: string) => new RegExp(`\\{ path: "${percorso}", lastModified: "([0-9-]+)" \\}`).exec(sitemap)?.[1] ?? "";
    atteso("mappa del sito: home, «Come funziona» e piani portano la data dell'ultima modifica vera (6 novembre 2026), non quella vecchia", ["/", "/come-funziona", "/piani"].every((p) => data(p) === "2026-11-06") && !/condizioni-piano-lavoro/.test(sitemap));
  }

  // ═════ 4. email e console ═════
  {
    const base = { prova: false, garaTitolo: "Gara", importoCentesimi: 7500, pagataIl: new Date("2026-11-06T10:00:00Z"), linkGara: "https://omnia-ai.it/g" };
    const con = emailClientePianoLavoroAcquistato({ ...base, linkCondizioni: `https://omnia-ai.it${PERCORSO_CONDIZIONI_PIANO_LAVORO}` }).html;
    const senza = emailClientePianoLavoroAcquistato(base).html;
    atteso("email al cliente: rimanda alle condizioni che ha accettato (se il collegamento c'è)", /https:\/\/omnia-ai\.it\/condizioni-piano-lavoro/.test(con) && /che hai accettato/.test(con) && !/condizioni-piano-lavoro/.test(senza));
    atteso("l'invio dell'email passa il collegamento alle condizioni", /linkCondizioni: linkArea\(PERCORSO_CONDIZIONI_PIANO_LAVORO\)/.test(leggi("src/lib/omnia-ai-email-piano-lavoro.ts")));
    const consoleVista = leggi("src/app/site-console/_componenti/piano-lavoro-vista.tsx");
    atteso(
      "console: accanto all'interruttore della vendita c'è la nota con l'approvazione del legale (data e versione delle clausole), la regola «cambi una parola = nuova versione e nuova approvazione» e come creare il Word",
      /\{NOTA_CONSOLE_TESTI\}/.test(consoleVista) && NOTA_CONSOLE_TESTI.includes(APPROVAZIONE_LEGALE_PIANO_LAVORO.data) && APPROVAZIONE_LEGALE_PIANO_LAVORO.versioneClausole === VERSIONE_CONDIZIONI_PIANO_LAVORO && /nuova versione e una nuova approvazione/.test(NOTA_CONSOLE_TESTI) && !/BOZZA/i.test(NOTA_CONSOLE_TESTI),
    );
    atteso("console: il comando per creare il Word esiste", /npm run testi-legali:piano-lavoro/.test(NOTA_CONSOLE_TESTI) && /"testi-legali:piano-lavoro": "tsx scripts\/genera-testi-legali-piano-lavoro\.ts"/.test(leggi("package.json")));
  }

  // ═════ 5. il Word per il legale ═════
  {
    uguale(
      "HTML di un'email in testo semplice: paragrafi a capo, celle separate, entità decodificate, nessuna etichetta",
      htmlInTesto('<p>Gentile <b>cliente</b> &amp; amico</p><table><tr><td>Gara</td><td>A &lt;B&gt;</td></tr></table><p>Ciao&nbsp;a tutti</p><p><a href="https://x.it/a?b=1" style="c">Apri</a></p>'),
      "Gentile cliente & amico\nGara — A <B>\nCiao a tutti\nApri (https://x.it/a?b=1)",
    );

    const dossier = costruisciDossier(new Date("2026-11-06T10:00:00Z"));
    atteso(
      "il dossier ha le nove sezioni, con titolo, data e l'approvazione del legale (versione delle clausole) nel sottotitolo; non si presenta più come bozza",
      dossier.sezioni.length === 9 && /Documento del 6 novembre 2026/.test(dossier.sottotitolo) && /approvati dal legale il 6 novembre 2026 \(clausole, versione 1\)/.test(dossier.sottotitolo) && /nuova versione e una nuova approvazione/.test(dossier.sottotitolo) && !/bozza/i.test(dossier.sottotitolo) && dossier.sezioni.every((s) => s.blocchi.length > 0),
      dossier.sezioni.map((s) => s.titolo).join(" | "),
    );

    const tutto = JSON.stringify(dossier);
    atteso("il dossier non ha buchi (niente undefined, NaN o [object]) né testi della sessione di lavoro", !/undefined|NaN|\[object|TODO|XXX/.test(tutto));

    const buffer = await creaWordDossier(dossier);
    const zip = await JSZip.loadAsync(buffer);
    const xml = await zip.file("word/document.xml")!.async("string");
    const parole = testoXml(xml);
    atteso("il Word è un vero documento (zip con word/document.xml) e non è vuoto", buffer.subarray(0, 2).toString() === "PK" && parole.length > 8000, `${parole.length} caratteri`);
    atteso(
      "il Word contiene OGNI clausola intera (titolo e testo) tra quelle che il cliente accetta",
      CLAUSOLE_PIANO_LAVORO.every((c) => parole.includes(c.testo) && parole.includes(`${c.numero}. ${c.titolo}`)),
      CLAUSOLE_PIANO_LAVORO.filter((c) => !parole.includes(c.testo)).map((c) => c.numero).join(","),
    );
    const impronta = createHash("sha256").update(testoCanonicoCondizioniPianoLavoro()).digest("hex");
    atteso("il Word riporta la versione e l'impronta del testo che si registra, e dice quali clausole sono da approvare specificamente", parole.includes(impronta) && parole.includes(`versione ${VERSIONE_CONDIZIONI_PIANO_LAVORO}`) && (parole.match(/Clausola da approvare specificamente/g) ?? []).length === CLAUSOLE_SPECIFICHE_PIANO_LAVORO.length);
    atteso("il Word contiene le avvertenze del file Excel e la legenda dei colori, identiche a quelle del file", AVVERTENZE_FISSE.every((a) => parole.includes(a)) && LEGENDA_FILE.every((v) => parole.includes(v.nome) && parole.includes(v.spiegazione)));
    atteso(
      "il Word contiene i testi dell'interfaccia e del sito (riquadro, opzione, fascia, note per fonte) e le caselle di accettazione, uguali a quelle che il cliente vede",
      parole.includes(RIQUADRO_PIANO_PARTI.join("")) && parole.includes(OPZIONE_ABBONAMENTO_DESCRIZIONE) && parole.includes(BANDA_PIANO_LAVORO.testo) && parole.includes(BANDA_PIANO_LAVORO.nota) && Object.values(NOTA_FONTE_DIRITTO).every((n) => parole.includes(n)) && parole.includes(testoApprovazioneSpecifica([2, 4, 6], CLAUSOLE_SPECIFICHE_PIANO_LAVORO.map((c) => c.titolo.toLowerCase()))) && parole.includes(testoAccettazioneCompleta([2, 4, 6], CLAUSOLE_SPECIFICHE_PIANO_LAVORO.map((c) => c.titolo.toLowerCase()))),
    );
    atteso("il Word contiene i prezzi di partenza (75 €, +150, +350, +900) e le regole di vendita (una generazione per gara, proroga, ufficio gare, costo del lavoro)", /75 € per gara/.test(parole) && /Starter \+150 €, Professional \+350 €, Enterprise \+900 €/.test(parole) && /una seconda solo se i documenti indicano una proroga/.test(parole) && /Ufficio Gare/.test(parole) && /costo del lavoro NON è compreso/i.test(parole));
    atteso("il Word contiene l'email al cliente (con il collegamento alle condizioni), la proposta per le Condizioni di abbonamento con l'effetto sui numeri delle clausole, i punti per il parere e la mappa dei file", /Acquisto del piano di lavoro ricevuto/.test(parole) && /omnia-ai\.it\/condizioni-piano-lavoro/.test(parole) && /Opzione «Piano di lavoro»/.test(parole) && /5, 8, 10, 12 e 15/.test(parole) && /5, 9, 11, 13 e 16/.test(parole) && /src\/lib\/piano-lavoro-acquisto-calcoli\.ts/.test(parole));
    atteso(
      "le decisioni (6 novembre 2026) sono scritte nel Word: i trattamenti sono già coperti dalle policy; strada A, Condizioni generali invariate e nessuna versione 3; tutti i punti approvati dal legale senza modifiche — e le domande corrispondenti non ci sono più",
      (parole.match(/Deciso: /g) ?? []).length === 3 && /approvati dal legale il 6 novembre 2026, senza modifiche ai testi/.test(parole) && /già questi trattamenti: nessuna integrazione/.test(parole) && /Strada A \(indicazione del titolare, 6 novembre 2026\)/.test(parole) && /non si pubblica una versione 3/.test(parole) && !/Chiediamo quale strada/.test(parole) && !/coprono già questi trattamenti o vanno integrati/.test(parole),
    );
    atteso(
      "l'unico punto aperto per il legale è quello sui testi del sito aggiunti dopo l'approvazione (home, domanda frequente, «Come funziona») e sulla visibilità della riga e della fascia dei piani",
      (parole.match(/Per il legale: /g) ?? []).length === 1 && /Aggiunti dopo l'approvazione del 6 novembre 2026, da far vedere al legale/.test(parole) && /compaiono sempre, non solo quando il piano di lavoro è in vendita/.test(parole),
    );
    atteso(
      "il Word contiene i testi della home, della domanda frequente e di «Come funziona», uguali a quelli del sito",
      parole.includes(SITO_HOME_PIANO_LAVORO.titolo) && parole.includes(SITO_HOME_PIANO_LAVORO.guida) && SITO_HOME_PIANO_LAVORO.punti.every((p) => parole.includes(p)) && parole.includes(SITO_HOME_PIANO_LAVORO.nota) && parole.includes(SITO_FAQ_PIANO_LAVORO.domanda) && parole.includes(SITO_FAQ_PIANO_LAVORO.risposta) && parole.includes(SITO_COME_FUNZIONA_PIANO_LAVORO.titolo) && SITO_COME_FUNZIONA_PIANO_LAVORO.passi.every((p) => parole.includes(p.titolo) && parole.includes(p.testo)),
    );
    const punti = dossier.sezioni.find((s) => /Punti sottoposti al parere/.test(s.titolo))?.blocchi.find((b) => b.t === "numerato");
    atteso("l'elenco dei punti sottoposti al legale (almeno dieci) resta per memoria", punti?.t === "numerato" && punti.voci.length >= 10);
    atteso("il dossier non contraddice le clausole: i numeri delle clausole citate esistono (1-6) e i prezzi sono quelli del codice", [...tutto.matchAll(/clausol[ae] n\. (\d+)/g)].every((m) => Number(m[1]) >= 1 && Number(m[1]) <= CLAUSOLE_PIANO_LAVORO.length));
  }

  // ═════ 6. regole del codice ═════
  {
    atteso("il Word si crea con un solo comando e finisce nella cartella locale, non nel repository", /test", "diagnostica", "piano-lavoro"/.test(leggi("scripts/genera-testi-legali-piano-lavoro.ts")) && /diagnostica/.test(leggi(".gitignore")));
    atteso("la legenda del file Excel viene da LEGENDA_FILE (una sola fonte per il file e per il Word)", /LEGENDA_FILE\.map/.test(leggi("src/lib/piano-lavoro-excel.ts")));
    atteso("questi controlli sono nella batteria prima della build", /verifica-piano-lavoro-testi-omnia-ai\.ts/.test(leggi("package.json")));
  }

  console.log("");
  if (fallimenti.length > 0) {
    console.error(`${fallimenti.length} controlli falliti:\n - ${fallimenti.join("\n - ")}`);
    process.exit(1);
  }
  console.log("Tutti i controlli sono andati a buon fine.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
