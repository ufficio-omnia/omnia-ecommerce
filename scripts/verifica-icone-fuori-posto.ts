// Autotest dei tag icona «[ICONA:nome]» nel Word.
//
// Difetto reale (relazione dell'Istituto Romano San Michele, 27/10/2026): il generatore riconosceva il tag SOLO all'inizio della
// riga o della cella. Quando il modello lo scriveva dopo l'etichetta («Caposquadra Area Sanitaria: [ICONA:comunicazione]
// concorda…») o a metà frase, il tag non era riconosciuto e restava stampato nel documento, senza icona. Qui si controlla che:
//   - NIENTE di ciò che già funzionava cambi: per i casi corretti (tag in testa in celle, elenchi, paragrafi, intestazioni, in
//     tutte le forme con grassetto, colori, sigle, riquadri, e i testi che NON sono tag) l'impronta del Word (document.xml e
//     immagini) è identica a quella prodotta dal generatore PRIMA della correzione (impronte fissate nel test);
//   - ogni variante del difetto produca l'icona in testa e nessun tag stampato, con un Word identico a quello della stessa riga
//     scritta con il tag in testa;
//   - i tag in più e quelli con un nome che non esiste si tolgano invece di restare stampati.
// Gratuito, nessun database né rete: gira nel livello 1, quindi in prebuild.
//
// Per rifare le impronte (solo se il generatore cambia di proposito): npx tsx scripts/verifica-icone-fuori-posto.ts --cattura
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { buildDocxBuffer } from "../src/lib/docx-generator";
import { estraiTestiPerNodo } from "./lib/xml-word";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const JSZip = require("jszip");

const fallimenti: string[] = [];
function atteso(nome: string, ok: boolean, dettaglio = "") {
  console.log(`${ok ? "ok    " : "FALLITO"} ${nome}${ok ? "" : ` — ${dettaglio}`}`);
  if (!ok) fallimenti.push(nome);
}
const leggi = (relativo: string) => fs.readFileSync(path.join(__dirname, "..", relativo), "utf-8").replace(/\r\n/g, "\n");
const sha = (dati: string | Buffer) => crypto.createHash("sha256").update(dati).digest("hex").slice(0, 16);

type Documento = { xml: string; nodi: string[]; icone: string[]; firma: string };

async function documento(markdown: string): Promise<Documento> {
  const buffer = await buildDocxBuffer("Prova", markdown, { font: "Calibri", dimensioneCarattere: 12 }, undefined, undefined, {});
  const zip = await JSZip.loadAsync(buffer);
  const xml: string = (await zip.file("word/document.xml")?.async("string")) ?? "";
  // anche le immagini (le icone): se il colore o il disegno cambiassero, l'impronta cambierebbe
  const media: string[] = [];
  const nomiMedia = Object.keys(zip.files).filter((n) => n.startsWith("word/media/") && !zip.files[n].dir).sort();
  for (const n of nomiMedia) media.push(`${n}:${sha(await zip.file(n).async("nodebuffer"))}`);
  return {
    xml,
    nodi: estraiTestiPerNodo(xml),
    icone: [...xml.matchAll(/name="icona:([a-z]+)"/g)].map((m) => m[1]),
    firma: `${sha(xml)}+${sha(media.join("|"))}`,
  };
}

// ───── Casi che funzionavano e NON devono cambiare ─────
const T = "# Prova\n\n";
const CASI_CORRETTI: Record<string, string> = {
  "tabella: tag in testa nelle celle (tutte le forme)": `${T}| Ruolo | Compito | Frequenza |\n|---|---|---|\n| [C][ICONA:personale] **Caposquadra** | [G]Coordina gli interventi | [C]Giornaliera |\n| [ICONA:tempistiche][C] **Orari** | [G]Fasce !!concordate!! con il referente | [C]Mensile * |\n| **[ICONA:sicurezza]** Sicurezza | [G]Verifica **DPI** | [C]Settimanale |\n| **[ICONA:ambiente] Ambiente** | [G]Raccolta differenziata | [C]Giornaliera |\n| [RIGA:AMBIENTE][C][ICONA:ambiente] Rifiuti | [G]Gestione dei rifiuti | [C]Giornaliera |\n`,
  "elenco: tag in testa (tutte le forme)": `${T}- [ICONA:comunicazione] !!Caposquadra Area Sanitaria!!: concorda con il **referente di sede**\n- [G][ICONA:tempistiche] Orari e frequenze concordati\n- **[ICONA:monitoraggio]** Controlli periodici\n- **[ICONA:qualita] Qualità del servizio** verificata\n- Voce senza icona con !!ruolo!! e *corsivo*\n`,
  "paragrafo: tag in testa e paragrafi normali": `${T}[ICONA:formazione] Paragrafo che inizia con un'icona e prosegue con del testo **in grassetto**.\n\n[C]Paragrafo centrato senza icona.\n\nParagrafo normale con !!colore!! e *corsivo*.\n`,
  "intestazione: tag in testa nelle celle di intestazione": `${T}| [ICONA:personale] Ruolo | [C][ICONA:tempistiche]Ore | [G]Incidenza |\n|---|---|---|\n| a | b | c |\n`,
  "nome di icona inventato in testa (tolto in silenzio)": `${T}- [ICONA:supervisione] Voce con un'icona che non esiste\n\n| [ICONA:inesistente] Etichetta | Valore |\n|---|---|\n| [ICONA:inventata] Riga | x |\n`,
  "nessun tag: prosa, grassetto, colori, tabella, riquadro": `${T}Paragrafo con **grassetto**, !!colore!! e *corsivo*.\n\n- Elenco con **grassetto** e !!ruolo!!\n\n| A | B |\n|---|---|\n| [C]**x** | [G]y |\n\n[BOX:SICUREZZA]\nImpegno **chiave** sulla sicurezza.\n[/BOX]\n`,
  "testi che NON sono un tag icona (restano com'erano)": `${T}- Testo con [ICONA] senza due punti\n- Testo [ICONA:qualità] con accento\n- Testo [ICONA: sicurezza] con uno spazio\n- Testo [icona:sicurezza] in minuscolo\n- Testo [ICONA:] vuoto\n`,
  "riquadro con elenco e icone in testa": `${T}[BOX:AMBIENTE]\n- [ICONA:ambiente] Raccolta **differenziata** in ogni sede\n- [ICONA:certificazione] Prodotti !!Ecolabel!!\n[/BOX]\n`,
  "documento misto": `${T}## 2.1 Titolo\n\n[ICONA:documentazione] Premessa.\n\n| Ruolo | Compito |\n|---|---|\n| [C][ICONA:personale] **Caposquadra** | [G]Coordina |\n\n- [ICONA:tempistiche] Orari concordati\n- Voce semplice\n\n### Sottosezione\n\nTesto con **grassetto**.\n`,
};

// Impronte del Word prodotto dal generatore PRIMA della correzione (rifare con --cattura solo se cambia di proposito).
const IMPRONTE_ATTESE: Record<string, string> = {
  "tabella: tag in testa nelle celle (tutte le forme)": "10c2558e15a03b96+5157541076783b21",
  "elenco: tag in testa (tutte le forme)": "a87e753c0986dca4+8d152537c36a57ee",
  "paragrafo: tag in testa e paragrafi normali": "822c939e44de9ae2+a1ecebfdeb17bb6a",
  "intestazione: tag in testa nelle celle di intestazione": "12c5772e4a64e670+d91f81f37fd04fb5",
  "nome di icona inventato in testa (tolto in silenzio)": "b8aea12bbf58b300+e3b0c44298fc1c14",
  "nessun tag: prosa, grassetto, colori, tabella, riquadro": "8c435ef6d319794f+e3b0c44298fc1c14",
  "testi che NON sono un tag icona (restano com'erano)": "d50fdd583b8c045a+e3b0c44298fc1c14",
  "riquadro con elenco e icone in testa": "c9cf493cdfd17c72+e3b0c44298fc1c14",
  "documento misto": "2ab5c0c9dc3be581+de5af3060395f789",
};

// ───── Il difetto: tag non in testa ─────
// [descrizione, riga con il tag fuori posto, la stessa riga con il tag in testa]
const VARIANTI_ELENCO: [string, string, string][] = [
  ["dopo l'etichetta colorata e i due punti (il caso reale)", "- !!Caposquadra Area Sanitaria!!: [ICONA:comunicazione] concorda con il referente di sede", "- [ICONA:comunicazione] !!Caposquadra Area Sanitaria!!: concorda con il referente di sede"],
  ["dopo l'etichetta in grassetto", "- **Flessibilità su richiesta**: [ICONA:monitoraggio] qualora l'Ente riscontri uno scarso stato di pulizia", "- [ICONA:monitoraggio] **Flessibilità su richiesta**: qualora l'Ente riscontri uno scarso stato di pulizia"],
  ["dopo l'etichetta senza spazi", "- !!Coordinatore dei Servizi!!:[ICONA:tempistiche]riprogramma gli interventi", "- [ICONA:tempistiche] !!Coordinatore dei Servizi!!:riprogramma gli interventi"],
  ["a metà frase", "- Il coordinatore riprogramma [ICONA:tempistiche] gli interventi periodici", "- [ICONA:tempistiche] Il coordinatore riprogramma gli interventi periodici"],
  ["in fondo alla riga", "- Il coordinatore riprogramma gli interventi periodici [ICONA:tempistiche]", "- [ICONA:tempistiche] Il coordinatore riprogramma gli interventi periodici"],
  ["due tag: resta il primo, il secondo si toglie", "- !!Responsabile!!: [ICONA:comunicazione] coordina [ICONA:tempistiche] gli interventi", "- [ICONA:comunicazione] !!Responsabile!!: coordina gli interventi"],
  ["nome inesistente e poi uno valido: resta il valido", "- !!Responsabile!!: [ICONA:supervisione] coordina [ICONA:monitoraggio] gli interventi", "- [ICONA:monitoraggio] !!Responsabile!!: coordina gli interventi"],
  ["il nome in maiuscolo/minuscolo misto è valido", "- !!Responsabile!!: [ICONA:Comunicazione] coordina gli interventi", "- [ICONA:comunicazione] !!Responsabile!!: coordina gli interventi"],
  ["tag in testa e un secondo a metà: il secondo si toglie", "- [ICONA:comunicazione] !!Responsabile!!: coordina [ICONA:tempistiche] gli interventi", "- [ICONA:comunicazione] !!Responsabile!!: coordina gli interventi"],
  ["dentro il grassetto dell'etichetta", "- **Flessibilità [ICONA:monitoraggio]**: qualora l'Ente riscontri", "- [ICONA:monitoraggio] **Flessibilità**: qualora l'Ente riscontri"],
  ["con l'allineamento [G] davanti", "- [G]!!Responsabile!!: [ICONA:comunicazione] coordina gli interventi", "- [G][ICONA:comunicazione] !!Responsabile!!: coordina gli interventi"],
];

async function main() {
  const cattura = process.argv.includes("--cattura");

  console.log("--- Nulla di ciò che funzionava è cambiato ---");
  {
    const firme: Record<string, string> = {};
    for (const [nome, md] of Object.entries(CASI_CORRETTI)) {
      const d = await documento(md);
      firme[nome] = d.firma;
      if (!cattura) atteso(`${nome}: Word identico a quello di prima`, IMPRONTE_ATTESE[nome] === d.firma, `atteso ${IMPRONTE_ATTESE[nome]}, ottenuto ${d.firma}`);
    }
    if (cattura) {
      console.log("const IMPRONTE_ATTESE: Record<string, string> = {");
      for (const [nome, f] of Object.entries(firme)) console.log(`  ${JSON.stringify(nome)}: ${JSON.stringify(f)},`);
      console.log("};");
      return;
    }
    atteso("ogni caso corretto ha la sua impronta fissata", Object.keys(CASI_CORRETTI).every((n) => Boolean(IMPRONTE_ATTESE[n])));

    // controlli di merito sulle impronte: i casi corretti disegnano le icone attese e non stampano tag
    const elenco = await documento(CASI_CORRETTI["elenco: tag in testa (tutte le forme)"]);
    atteso("elenco con tag in testa: 4 icone disegnate e nessun tag stampato", elenco.icone.length === 4 && !elenco.nodi.join("").includes("[ICONA"), elenco.icone.join());
    const letterali = await documento(CASI_CORRETTI["testi che NON sono un tag icona (restano com'erano)"]);
    atteso("i testi che non sono un tag icona restano stampati come prima (nessuna icona)", letterali.icone.length === 0 && letterali.nodi.join(" ").includes("[ICONA]") && letterali.nodi.join(" ").includes("[ICONA:qualità]"), letterali.nodi.join(" | "));
  }

  console.log("--- Il difetto: tag dopo l'etichetta o a metà frase (elenchi) ---");
  for (const [descrizione, fuori, inTesta] of VARIANTI_ELENCO) {
    const a = await documento(`${T}${fuori}\n`);
    const b = await documento(`${T}${inTesta}\n`);
    atteso(`${descrizione}: nessun tag stampato`, !a.nodi.join("").includes("[ICONA"), a.nodi.join(" | "));
    atteso(`${descrizione}: l'icona è disegnata`, a.icone.length === 1, a.icone.join());
    atteso(`${descrizione}: Word identico a quello della stessa riga con il tag in testa`, a.xml === b.xml);
  }

  console.log("--- Il difetto in celle di tabella, intestazioni e paragrafi ---");
  {
    const cellaFuori = await documento(`${T}| Ruolo | Compito |\n|---|---|\n| **Caposquadra** | [G]Coordina [ICONA:comunicazione] gli interventi |\n`);
    const cellaTesta = await documento(`${T}| Ruolo | Compito |\n|---|---|\n| **Caposquadra** | [G][ICONA:comunicazione] Coordina gli interventi |\n`);
    atteso("cella del corpo con tag a metà: nessun tag stampato, icona disegnata, Word identico a quello con il tag in testa", !cellaFuori.nodi.join("").includes("[ICONA") && cellaFuori.icone.length === 1 && cellaFuori.xml === cellaTesta.xml, cellaFuori.nodi.join(" | "));

    const etichettaFuori = await documento(`${T}| Ruolo | Compito |\n|---|---|\n| **Caposquadra**: [ICONA:personale] coordinatore | x |\n`);
    const etichettaTesta = await documento(`${T}| Ruolo | Compito |\n|---|---|\n| [ICONA:personale] **Caposquadra**: coordinatore | x |\n`);
    atteso("cella con il tag dopo l'etichetta: icona in testa, Word identico a quello con il tag in testa", !etichettaFuori.nodi.join("").includes("[ICONA") && etichettaFuori.icone.length === 1 && etichettaFuori.xml === etichettaTesta.xml);

    const intestFuori = await documento(`${T}| Ruolo [ICONA:personale] | [C]Ore | Incidenza |\n|---|---|---|\n| a | b | c |\n`);
    const intestTesta = await documento(`${T}| [ICONA:personale] Ruolo | [C]Ore | Incidenza |\n|---|---|---|\n| a | b | c |\n`);
    atteso("intestazione con il tag dopo il testo: nessun tag stampato, icona disegnata, Word identico a quello con il tag in testa", !intestFuori.nodi.join("").includes("[ICONA") && intestFuori.icone.length === 1 && intestFuori.xml === intestTesta.xml, intestFuori.nodi.join(" | "));
    const intestSigla = await documento(`${T}| [G]Ruolo [ICONA:personale] | [C]Ore | Incidenza |\n|---|---|---|\n| a | b | c |\n`);
    atteso("intestazione con sigla e tag a metà: sigla tolta, icona in testa, Word identico", intestSigla.xml === intestTesta.xml && !intestSigla.nodi.join("").includes("[G]"));

    const parFuori = await documento(`${T}Il referente verifica [ICONA:monitoraggio] ogni intervento.\n`);
    const parTesta = await documento(`${T}[ICONA:monitoraggio] Il referente verifica ogni intervento.\n`);
    atteso("paragrafo con il tag a metà: come i paragrafi con il tag in testa (icona in testa, nessun tag stampato)", !parFuori.nodi.join("").includes("[ICONA") && parFuori.icone.length === 1 && parFuori.xml === parTesta.xml);

    const solo = await documento(`${T}- !!Responsabile!!: [ICONA:supervisione] coordina gli interventi\n`);
    const senza = await documento(`${T}- !!Responsabile!!: coordina gli interventi\n`);
    atteso("un nome di icona inesistente a metà riga si toglie: nessuna icona, nessun tag stampato, Word identico alla riga senza tag", solo.icone.length === 0 && !solo.nodi.join("").includes("[ICONA") && solo.xml === senza.xml, solo.nodi.join(" | "));

    const tagMisto = await documento(`${T}- [ICONA:comunicazione] Prima voce\n- Seconda voce [ICONA:tempistiche]\n- !!Terza!!: [ICONA:monitoraggio] voce\n`);
    atteso("più righe nello stesso elenco: ognuna ha la sua icona (3) e nessun tag resta", tagMisto.icone.join() === "comunicazione,tempistiche,monitoraggio" && !tagMisto.nodi.join("").includes("[ICONA"), tagMisto.icone.join());
  }

  console.log("--- Il testo della riga non cambia (solo il tag si sposta) ---");
  {
    const d = await documento(`${T}- !!Caposquadra Area Sanitaria!!: [ICONA:comunicazione] concorda con il **referente di sede** del Villino Crespi gli orari\n`);
    const testo = d.nodi.join("");
    atteso("etichetta, due punti, grassetto e il resto del testo ci sono tutti, nell'ordine", /Caposquadra Area Sanitaria.*concorda con il.*referente di sede.*del Villino Crespi gli orari/.test(testo), testo);
    atteso("il colore dell'etichetta e il grassetto restano", /<w:color w:val="[0-9A-F]{6}"\/>/.test(d.xml) && /<w:b\/>/.test(d.xml));
    atteso("l'elenco resta un elenco puntato giustificato", /<w:numPr>/.test(d.xml) && /<w:jc w:val="both"\/>/.test(d.xml));
  }

  console.log("--- Il collegamento nel generatore (controlli sul sorgente) ---");
  {
    const g = leggi("src/lib/docx-generator.ts");
    atteso("esiste la funzione che porta l'icona in testa", g.includes("function portaIconaInTesta(testo: string): string {"));
    atteso("righe, celle e paragrafi la usano (costruisciRunConIcona)", /const testo = rimuoviGrassettoRidondante\(portaIconaInTesta\(testoGrezzo\)\);\s*if \(eMarcatoreTabellare\(testo\)\)/.test(g));
    atteso("le intestazioni la usano (costruisciRunIntestazione), dopo la pulizia delle sigle", /const testo = rimuoviGrassettoRidondante\(portaIconaInTesta\(pulisciSigleAllineamentoCella\(testoGrezzo\)\)\);/.test(g));
    atteso("la funzione cerca solo tag nella stessa forma che il generatore già riconosce in testa ([ICONA:lettere])", g.includes("const TAG_ICONA_REGEX_GLOBALE = /\\s*\\[ICONA:([a-zA-Z]+)\\]/g;") && g.includes("const TAG_ICONA_IN_TESTA_REGEX = /^(?:\\*\\*)?\\[ICONA:[a-zA-Z]+\\]/;"));
    atteso("il peso delle colonne toglie solo i tag fuori posto (quello in testa si conta come prima)", g.includes("Un tag in testa (anche avvolto nel grassetto) si conta come sempre") && g.includes('resto.replace(TAG_ICONA_REGEX_GLOBALE, "")'));
  }

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
