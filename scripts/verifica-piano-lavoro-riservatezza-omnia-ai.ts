// Autotest della regola ASSOLUTA: il piano di lavoro di un cliente non parla MAI, da nessuna parte e nemmeno nelle note, di un'altra gara
// (né di un altro cliente, né dei piani di lavoro fatti a mano da cui nascono le rese e i prezzi di riferimento).
//   - il filtro (piano-lavoro-riservatezza.ts): frasi, nomi dei piani di riferimento, il caso della gara «propria», idempotenza, nessun danno a ciò che è legittimo;
//   - le fonti dei dati: tutte e 34 le categorie di resa, il catalogo dei macchinari, i testi del sito e del Word non nominano nessun'altra gara;
//   - l'Excel intero: ogni cella (valori, formule, testi ricchi), i nomi dei fogli, le proprietà del file e ogni file interno dell'archivio;
//   - le garanzie scritte nel codice: l'output non usa la provenienza interna delle rese, il filtro gira in ogni via d'ingresso, i modelli ricevono la regola.
// Gratuito: gira nel livello 1, quindi in prebuild.
import fs from "fs";
import path from "path";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import { CATALOGO } from "../src/lib/piano-lavoro-catalogo";
import { FONTE_PIANI } from "../src/lib/piano-lavoro-catalogo";
import { CATEGORIE_RESA, testoFonteResa } from "../src/lib/piano-lavoro-rese";
import { datiDaRaw, type RawEstrazione } from "../src/lib/piano-lavoro-estrazione";
import { normalizzaPianoLavoro, proteggiPianoDaAltreGare, type PianoLavoroDati } from "../src/lib/piano-lavoro-dati";
import { costruisciExcelPianoLavoro } from "../src/lib/piano-lavoro-excel";
import { FRASI_ALTRE_GARE, RIFERIMENTI_ESTRANEI, contestoDellaGara, ripulisciTestoDaAltreGare, togliRiferimentiAdAltreGare } from "../src/lib/piano-lavoro-riservatezza";
import { costruisciDossier } from "../src/lib/piano-lavoro-dossier-legale";
import * as testi from "../src/lib/piano-lavoro-testi";

const fallimenti: string[] = [];
function atteso(nome: string, ok: boolean, dettaglio = "") {
  console.log(`${ok ? "ok    " : "FALLITO"} ${nome}${ok ? "" : ` — ${dettaglio}`}`);
  if (!ok) fallimenti.push(nome);
}
function uguale<T>(nome: string, ottenuto: T, previsto: T) {
  atteso(nome, JSON.stringify(ottenuto) === JSON.stringify(previsto), `ottenuto ${JSON.stringify(ottenuto)}, previsto ${JSON.stringify(previsto)}`);
}
const leggi = (relativo: string) => fs.readFileSync(path.join(__dirname, "..", relativo), "utf-8").replace(/\r\n/g, "\n");

// quello che NON deve comparire: i nomi dei piani di riferimento e le frasi che rimandano ad altre gare
const trovaRiferimenti = (testo: string): string[] => [...RIFERIMENTI_ESTRANEI, ...FRASI_ALTRE_GARE].flatMap((r) => (r.test(testo) ? [r.source] : []));

const FONTE_VECCHIA = "giornaliera — Capitolato art. 1.9.2 — Resa di riferimento OMNIA AI (Milanosport 250, Scala 220, Donnafugata 320-355, FS Sud-Est 380)";

async function main() {
  // ═════ 1. il filtro ═════
  {
    const altra = contestoDellaGara(["Servizio di pulizia della sede di Torino", "Comune di Torino"]);
    const esito = (t: string, contesto = altra) => ripulisciTestoDaAltreGare(t, contesto)?.testo ?? t;

    uguale("il caso visto nel piano: la parte «Resa di riferimento (Milanosport…, Scala…, Donnafugata…, FS Sud-Est…)» sparisce, il resto della fonte resta", esito(FONTE_VECCHIA), "giornaliera — Capitolato art. 1.9.2");
    uguale(
      "tutti e quattro i piani di riferimento si riconoscono, con le sigle e i numeri accanto",
      ["Milanosport 250", "Teatro alla Scala", "Castello Donnafugata", "Ferrovie del Sud-Est", "FS Sud-Est 380", "Scala 220", "SUD EST 70"].map((t) => ripulisciTestoDaAltreGare(`Nota — ${t} — Altro`, altra)?.testo),
      Array(7).fill("Nota — Altro"),
    );
    uguale(
      "le frasi che rimandano ad altre gare si tolgono sempre",
      ["Nota — come nelle altre gare — fine", "Nota — appalti precedenti — fine", "Nota — secondo i piani di riferimento — fine", "Nota — gare precedenti dell'ente — fine", "Nota — in un altro cliente — fine"].map((t) => ripulisciTestoDaAltreGare(t, altra)?.testo),
      Array(5).fill("Nota — fine"),
    );
    uguale("un testo di una parte sola perde il riferimento e non le parole attorno", esito("Lavorazione come a Donnafugata (Donnafugata 225) con prodotti neutri"), "Lavorazione come a con prodotti neutri");
    atteso("se tutto il testo è un riferimento, resta vuoto (mai una frase mozzata a metà con il nome)", esito("Milanosport 250 — Scala 220") === "" && !/milanosport|scala/i.test(esito("Resa Milanosport 250")));

    // ciò che è legittimo non si tocca
    uguale(
      "parole comuni e testi legittimi non si toccano (le scale, il sud-est di un edificio, «Scala» come cognome senza numero, i riferimenti del bando)",
      ["Pulizia delle scale antincendio", "Ingresso lato sud-est dell'edificio", "Referente: Mario Scala", "Capitolato art. 1.9.2 — Allegato 3", "Servizio come da Capitolato — giornaliera", "FS Italiane S.p.A. (stazione appaltante)"].map((t) => ripulisciTestoDaAltreGare(t, altra)),
      Array(6).fill(null),
    );
    // la gara propria: il suo nome è legittimo
    const propria = contestoDellaGara(["Servizio di pulizia impianti Milanosport S.S.D.", "Milanosport S.p.A."]);
    uguale("se la gara di cui si fa il piano È quella di Milanosport il suo nome resta, ma gli ALTRI nomi no", [ripulisciTestoDaAltreGare("Sede Milanosport 3", propria), ripulisciTestoDaAltreGare("Nota — Milanosport — fine", propria), ripulisciTestoDaAltreGare("Nota — Donnafugata 225 — fine", propria)?.testo], [null, null, "Nota — fine"]);
    uguale("il nome «proprio» vale anche scritto con spazi o trattini diversi", ripulisciTestoDaAltreGare("Nota — Ferrovie del Sud Est — fine", contestoDellaGara(["Ferrovie del Sud-Est e Servizi Automobilistici"])), null);
    atteso("le frasi su altre gare si tolgono ANCHE nella gara propria (non ammettono eccezioni)", ripulisciTestoDaAltreGare("Nota — come nelle altre gare — fine", propria)?.testo === "Nota — fine");

    // il percorso su strutture
    const dato = { a: "Nota — Milanosport 250 — ok", b: ["x", { c: "Donnafugata 225" }], n: 42, vuoto: null, documenti: { letti: ["Capitolato Milanosport.pdf"], nonLetti: [{ nome: "Altre gare.pdf", motivo: "Scala 220" }] } };
    const protetto = togliRiferimentiAdAltreGare(dato, altra, ["documenti"]);
    uguale("percorre oggetti e liste, non tocca numeri, null né i nomi dei documenti del cliente", protetto.valore, { a: "Nota — ok", b: ["x", { c: "" }], n: 42, vuoto: null, documenti: dato.documenti });
    uguale("dice cosa ha tolto (per il registro), e rieseguito non cambia nulla (idempotente)", [protetto.rimossi.length, togliRiferimentiAdAltreGare(protetto.valore, altra, ["documenti"]).rimossi.length], [2, 0]);
  }

  // ═════ 2. le fonti dei dati ═════
  {
    for (const c of CATEGORIE_RESA) if (trovaRiferimenti(testoFonteResa(c)).length > 0) atteso(`fonte della resa «${c.chiave}» senza nomi`, false, testoFonteResa(c));
    atteso("la fonte di una resa è anonima per tutte le 34 categorie: intervallo usuale e «da validare», nessun nome", CATEGORIE_RESA.length === 34 && CATEGORIE_RESA.every((c) => trovaRiferimenti(testoFonteResa(c)).length === 0 && /^Resa di riferimento OMNIA AI per questa categoria \(intervallo usuale/.test(testoFonteResa(c)) && /da validare in sopralluogo$/.test(testoFonteResa(c))));

    // l'output vero di ogni categoria, passando dalla stessa strada del modello
    const gara = (chiave: string): RawEstrazione => ({
      appalto: { titolo: "Servizio di pulizia della sede di Torino", stazione_appaltante: "Comune di Torino" },
      tipologie: [{ nome: "Ambiente", lavorazioni: [{ nome: "Lavorazione", frequenza_tipo: "giornaliera", categoria_rese: chiave, fonte: "Capitolato art. 1" }] }],
      sedi: [{ nome: "Sede Torino", superfici: [{ tipologia: "Ambiente", mq: 100 }] }],
    });
    const tutte = CATEGORIE_RESA.map((c) => JSON.stringify(datiDaRaw(gara(c.chiave), ["capitolato.pdf"], []).dati));
    const conFonteResa = tutte.filter((t) => /Resa di riferimento OMNIA AI per questa categoria/.test(t)).length;
    atteso("passando dalla vera lettura dei dati, per OGNUNA delle 34 categorie nessun testo nomina un'altra gara", conFonteResa === 34 && tutte.every((t) => trovaRiferimenti(t).length === 0), `${conFonteResa} con fonte; ${tutte.filter((t) => trovaRiferimenti(t).length > 0).length} con riferimenti`);

    atteso("il catalogo dei macchinari (fonti, riferimenti, usi, note) non nomina nessun'altra gara e la fonte dei prezzi di prassi è anonima", trovaRiferimenti(JSON.stringify(CATALOGO)).length === 0 && trovaRiferimenti(FONTE_PIANI).length === 0 && FONTE_PIANI === "Prezzo standard di riferimento OMNIA AI");

    const testiCliente = JSON.stringify({ ...testi, dossier: costruisciDossier(new Date("2026-11-06T10:00:00Z")) }, (_k, v) => (typeof v === "function" ? v.toString() : v));
    atteso("i testi dell'interfaccia, del sito e le condizioni (e il Word per il legale) non nominano nessun'altra gara", trovaRiferimenti(testiCliente).length === 0, trovaRiferimenti(testiCliente).join(","));
  }

  // ═════ 3. l'Excel intero ═════
  {
    const fixture = JSON.parse(leggi("test/fixtures/piano-lavoro-milanosport.json")) as { dati: unknown };
    const normalizzato = normalizzaPianoLavoro(fixture.dati).dati;
    // lo stesso piano, ma di una gara qualunque (non Milanosport): così nessun nome è «proprio»
    const neutro: PianoLavoroDati = JSON.parse(JSON.stringify(normalizzato).replace(/Milanosport/gi, "Comune di Torino"));
    // …con ogni punto dove un riferimento potrebbe infilarsi: fonte di una lavorazione, note, parametri, sedi, macchinari, avvertenze, titoli
    const inquinato: PianoLavoroDati = JSON.parse(JSON.stringify(neutro));
    // (il titolo, la stazione appaltante e le sedi sono il «contesto» della gara: un nome lì è suo, per definizione; i riferimenti si mettono altrove)
    inquinato.tipologie[0].lavorazioni[0].fonte = FONTE_VECCHIA;
    inquinato.tipologie[0].lavorazioni[0].notaFrequenza = "7/7 gg — come nelle altre gare";
    inquinato.tipologie[0].nome = "Impianti (Scala 220)";
    inquinato.parametri[0].fonte = "Bando — Teatro alla Scala";
    if (inquinato.macchinari[0]) {
      inquinato.macchinari[0].nota = "Prezzo di prassi dei piani di lavoro di riferimento (Milanosport, Scala, Donnafugata, FS Sud-Est)";
      inquinato.macchinari[0].fontePrezzo = FONTE_VECCHIA;
    }
    inquinato.avvertenze = ["Rese come negli appalti precedenti", "Verificare le superfici in sopralluogo", "Milanosport 250 e Scala 220"];

    atteso("controllo del controllo: i dati inquinati di prova CONTENGONO davvero i riferimenti (altrimenti il test non proverebbe nulla)", trovaRiferimenti(JSON.stringify(inquinato)).length >= 5, String(trovaRiferimenti(JSON.stringify(inquinato)).length));
    const protetto = proteggiPianoDaAltreGare(inquinato);
    atteso("la protezione dei dati toglie tutti i riferimenti da tutti i campi e lascia ciò che è legittimo (le altre parti delle fonti, le avvertenze vere)", trovaRiferimenti(JSON.stringify(protetto)).length === 0 && /Capitolato art\. 1\.9\.2/.test(JSON.stringify(protetto)) && protetto.avvertenze.includes("Verificare le superfici in sopralluogo") && protetto.tipologie.length === inquinato.tipologie.length && protetto.sedi.length === inquinato.sedi.length, JSON.stringify(trovaRiferimenti(JSON.stringify(protetto))));

    // il file vero, costruito dai dati INQUINATI: ogni parte dell'archivio dev'essere pulita
    const buffer = (await costruisciExcelPianoLavoro(inquinato, { generatoIl: new Date("2026-11-06T10:00:00Z") })).buffer;
    const zip = await JSZip.loadAsync(buffer);
    const interni: { file: string; trovati: string[] }[] = [];
    for (const nome of Object.keys(zip.files)) {
      if (zip.files[nome].dir) continue;
      const contenuto = await zip.file(nome)!.async("string");
      const trovati = trovaRiferimenti(contenuto);
      if (trovati.length > 0) interni.push({ file: nome, trovati });
    }
    atteso("l'Excel costruito da dati inquinati: NESSUN file interno dell'archivio (stringhe condivise, fogli, formule, proprietà, commenti) contiene riferimenti ad altre gare", interni.length === 0 && Object.keys(zip.files).length > 8, JSON.stringify(interni));

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as unknown as ArrayBuffer);
    const testiCelle: string[] = [wb.title ?? "", wb.subject ?? "", wb.description ?? "", wb.keywords ?? "", wb.creator ?? "", wb.company ?? ""];
    let celle = 0;
    wb.eachSheet((ws) => {
      testiCelle.push(ws.name);
      ws.eachRow((riga) =>
        riga.eachCell((c) => {
          celle++;
          const v = c.value as unknown;
          testiCelle.push(typeof v === "object" && v !== null ? JSON.stringify(v) : String(v ?? ""));
          if (c.note) testiCelle.push(JSON.stringify(c.note));
        }),
      );
    });
    atteso("lettura cella per cella: valori, formule, testi ricchi, note, nomi dei fogli e proprietà del file senza riferimenti ad altre gare", celle > 500 && testiCelle.every((t) => trovaRiferimenti(t).length === 0), `${celle} celle; ${testiCelle.filter((t) => trovaRiferimenti(t).length > 0).slice(0, 2).join(" | ")}`);

    // la gara propria resta riconoscibile: l'Excel di Milanosport può dire «Milanosport» ma non nominare gli altri
    const propria = (await costruisciExcelPianoLavoro(proteggiPianoDaAltreGare({ ...normalizzato, tipologie: inquinato.tipologie.map((t, i) => (i === 0 ? { ...t, lavorazioni: t.lavorazioni.map((l, j) => (j === 0 ? { ...l, fonte: FONTE_VECCHIA } : l)) } : t)) }), { generatoIl: new Date("2026-11-06T10:00:00Z") })).buffer;
    const zipPropria = await JSZip.loadAsync(propria);
    const testoPropria = (await Promise.all(Object.keys(zipPropria.files).filter((n) => !zipPropria.files[n].dir).map((n) => zipPropria.file(n)!.async("string")))).join("\n");
    atteso("l'Excel di una gara che ha davvero «Milanosport» nel titolo lo dice (è suo), ma non nomina Donnafugata, Scala o Sud-Est", /Milanosport/.test(testoPropria) && !/donnafugata|teatro alla scala|\bscala\s+\d|sud[\s-]?est\s+\d|FS\s+sud/i.test(testoPropria));
  }

  // ═════ 4. le garanzie scritte nel codice ═════
  {
    const rese = leggi("src/lib/piano-lavoro-rese.ts");
    atteso("la provenienza interna delle rese resta in piano-lavoro-rese.ts: nessun altro file di src la usa (quindi non può arrivare nell'output)", (rese.match(/provenienzaInterna:/g) ?? []).length >= 34 && !/\.fonti\b|fonti:/.test(rese) && fs.readdirSync(path.join(__dirname, "..", "src", "lib")).filter((f) => f.endsWith(".ts") && f !== "piano-lavoro-rese.ts").every((f) => !/provenienzaInterna/.test(fs.readFileSync(path.join(__dirname, "..", "src", "lib", f), "utf-8"))));
    atteso("la fonte di una resa nell'output viene SOLO da testoFonteResa()", /testoFonteResa\(categoria\)/.test(leggi("src/lib/piano-lavoro-estrazione.ts")) && !/Resa di riferimento OMNIA AI \(/.test(leggi("src/lib/piano-lavoro-estrazione.ts")));
    const dati = leggi("src/lib/piano-lavoro-dati.ts");
    atteso("il filtro gira in OGNI via d'ingresso: alla normalizzazione dei dati (modello, prove, dati riletti) e prima di scrivere l'Excel", /return \{ dati: proteggiPianoDaAltreGare\(dati\), avvisi \}/.test(dati) && /const dati = proteggiPianoDaAltreGare\(datiIn\)/.test(leggi("src/lib/piano-lavoro-excel.ts")) && /togliRiferimentiAdAltreGare\(dati, contesto, \["documenti"\]\)/.test(dati));
    atteso("il filtro non importa nulla del server (nessun database, nessuna chiave)", !/supabase|createAdminClient|anthropic|stripe/i.test(leggi("src/lib/piano-lavoro-riservatezza.ts").replace(/\/\/.*$/gm, "")));
    atteso("i tre modelli ricevono la regola (estrazione, scelta dei macchinari, ricerca dei prezzi): niente altre gare, altri appalti o altri clienti", /6\. Ogni testo che scrivi[\s\S]{0,200}MAI altre gare/.test(leggi("src/lib/piano-lavoro-estrazione.ts")) && /Ogni testo che scrivi riguarda solo questa gara/.test(leggi("src/lib/piano-lavoro-macchinari.ts")) && /mai riferimenti ad altre gare, altri appalti o altri clienti/.test(leggi("src/lib/piano-lavoro-macchinari.ts")));
    atteso("questi controlli sono nella batteria prima della build", /verifica-piano-lavoro-riservatezza-omnia-ai\.ts/.test(leggi("package.json")));
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
