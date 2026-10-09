// Autotest dell'organigramma strutturato: gratuito, nessuna chiamata a modelli
// né al database, gira insieme al livello 1 (npm run verifica:livello1, quindi
// in prebuild).
//
// L'organigramma non è più testo a rientri scritto dal modello ma DATI: il
// modello dichiara figure e relazioni, il codice ricava da fonti certe
// committente, RUP/DEC, impresa, livello di direzione e numero di sedi, e il
// disegnatore decide colori e posizioni con le regole R20. Qui si prova: la
// lettura difensiva di ciò che dichiara il modello; i controlli (nominativi,
// sedi, organico, valori numerici); il layout (niente caselle sovrapposte,
// niente fuori pagina, solo i colori ammessi, contrasto del testo); il
// disegno vero su canvas; che compressione ed espansione non possano toccare
// i dati; e il collegamento ai punti di produzione.
import fs from "fs";
import path from "path";
import {
  contaPersone,
  leggiBloccoOrganigramma,
  leggiDichiarazioneModello,
  leggiVociProfilo,
  haSegnaposto,
  mascheraOrganigrammi,
  organigrammiInvariati,
  ripristinaOrganigrammi,
  serializzaBlocco,
  sostituisciSegnaposto,
} from "../src/lib/organigramma-dati";
import { SCHEMA_ORGANIGRAMMA_STRUMENTO } from "../src/lib/organigramma-schema-strumento";
import { abbinaSede, costruisciOrganigramma, derivaTipoInterfaccia, type FattiOrganigramma } from "../src/lib/organigramma-contesto";
import { calcolaLayout, contrasto, misuraApprossimata, testoSu, type Prim } from "../src/lib/organigramma-layout";
import { disegnaOrganigramma } from "../src/lib/organigramma-disegno";
import { stimaPagineContenuto, stimaPagineOrganigramma } from "../src/lib/stima-pagine";
import { espandiBloccoConGaranzie, type RichiestaEspansione } from "../src/lib/espansione-mirata";
import { COLORE_PIENO, COLORE_PRIMARIO, schiarisciColore } from "../src/lib/colori-semantici";
import { tuttiGliEsempi, esempioComune, esempioOspedale } from "./lib/organigrammi-esempio";

const fallimenti: string[] = [];
function atteso(nome: string, ok: boolean, dettaglio = "") {
  console.log(`${ok ? "ok    " : "FALLITO"} ${nome}${ok ? "" : ` — ${dettaglio}`}`);
  if (!ok) fallimenti.push(nome);
}
const leggiFile = (relativo: string) => fs.readFileSync(path.join(__dirname, "..", relativo), "utf-8").replace(/\r\n/g, "\n");

const FATTI: FattiOrganigramma = {
  impresa: "IMPRESA ESEMPIO",
  committente: "Comune di Esempio",
  tipoInterfaccia: "RUP",
  sedi: ["Sede Centrale", "Sede Nord", "Biblioteca Comunale", "Polizia Locale"],
  organico: 12,
  funzioniDirezione: [],
  ufficiGestione: [],
  softwareNome: null,
  testoProfilo: JSON.stringify({ ragione_sociale: "IMPRESA ESEMPIO", presentazione: "Il Responsabile Acquisti è Mario Bianchi." }),
};

const GREZZO_VALIDO = {
  figura_apicale: { denominazione: "Responsabile di Commessa" },
  staff_governo: [{ denominazione: "RSPP", tipo: "sicurezza" }],
  coordinamento: [{ denominazione: "Coordinatore Operativo", sottolivelli: [{ denominazione: "Caposquadra", addetti: ["Operatori"] }] }],
};

async function main() {
  // --- 1. Lettura difensiva di ciò che dichiara il modello ---
  {
    const brutto = leggiDichiarazioneModello("non un oggetto");
    atteso("input non oggetto: nessun errore, niente figura apicale", !brutto.figuraApicale && brutto.coordinamento.length === 0);
    const nullo = leggiDichiarazioneModello(null);
    atteso("input nullo: nessun errore", !nullo.figuraApicale && nullo.staffGoverno.length === 0);
    const sporco = leggiDichiarazioneModello({
      figura_apicale: { denominazione: "  Responsabile [di]\nCommessa  ", nominativo: 42 },
      staff_governo: [{ denominazione: "RSPP", tipo: "inventato" }, { tipo: "sicurezza" }, "stringa", { denominazione: "QM", tipo: "qualita" }],
      coordinamento: [{ denominazione: "Zona", sottolivelli: [{ denominazione: "Cs", addetti: ["A", 5, "", "B"] }, null] }, { sottolivelli: [] }],
    });
    atteso("denominazione ripulita da parentesi quadre, a capo e spazi", sporco.figuraApicale?.denominazione === "Responsabile di Commessa", String(sporco.figuraApicale?.denominazione));
    atteso("nominativo di tipo sbagliato scartato", sporco.figuraApicale?.nominativo === undefined);
    atteso("tipo di staff sconosciuto → supporto; voci senza denominazione scartate", sporco.staffGoverno.length === 2 && sporco.staffGoverno[0].tipo === "supporto" && sporco.staffGoverno[1].tipo === "qualita", JSON.stringify(sporco.staffGoverno));
    atteso("zone senza denominazione scartate, addetti non stringa scartati", sporco.coordinamento.length === 1 && JSON.stringify(sporco.coordinamento[0].sottolivelli[0].addetti) === JSON.stringify(["A", "B"]), JSON.stringify(sporco.coordinamento));
    const troppi = leggiDichiarazioneModello({
      figura_apicale: { denominazione: "R" },
      staff_governo: Array.from({ length: 9 }, (_, i) => ({ denominazione: `S${i}`, tipo: "supporto" })),
      coordinamento: Array.from({ length: 15 }, (_, i) => ({ denominazione: `Z${i}`, sottolivelli: [] })),
    });
    atteso("oltre i limiti: staff e zone troncati con un avviso", troppi.staffGoverno.length === 6 && troppi.coordinamento.length === 12 && troppi.avvisi.length === 2);
    const lungo = leggiDichiarazioneModello({ figura_apicale: { denominazione: "x".repeat(300) } });
    atteso("testo troppo lungo troncato con i puntini", (lungo.figuraApicale?.denominazione.length ?? 0) <= 70 && lungo.figuraApicale?.denominazione.endsWith("…") === true);
  }

  // --- 2. Campi del profilo, blocco, segnaposto, maschera ---
  {
    const voci = leggiVociProfilo("• Direzione Generale\n  Responsabile Acquisti (Mario Bianchi)\n\n- Ufficio Gare\r\n* Amministrazione");
    atteso("profilo: voci per riga, punto elenco e nominativo fra parentesi", voci.length === 4 && voci[1].funzione === "Responsabile Acquisti" && voci[1].nominativo === "Mario Bianchi" && voci[0].nominativo === undefined, JSON.stringify(voci));
    atteso("profilo vuoto o nullo: nessuna voce", leggiVociProfilo("").length === 0 && leggiVociProfilo(null).length === 0 && leggiVociProfilo("  \n \n").length === 0);
    atteso("profilo: al massimo 6 voci", leggiVociProfilo(Array.from({ length: 10 }, (_, i) => `Voce ${i}`).join("\n")).length === 6);

    const blocco = serializzaBlocco(esempioOspedale);
    const dentro = blocco.replace(/^\[ORGANIGRAMMA\]\n/, "").replace(/\n\[\/ORGANIGRAMMA\]$/, "");
    atteso("blocco: una sola riga JSON tra i tag", !dentro.includes("\n") && blocco.startsWith("[ORGANIGRAMMA]\n") && blocco.endsWith("\n[/ORGANIGRAMMA]"));
    atteso("blocco: lettura identica ai dati di partenza", JSON.stringify(leggiBloccoOrganigramma(dentro)) === JSON.stringify(esempioOspedale));
    atteso("blocco vecchio a rientri non è letto come strutturato", leggiBloccoOrganigramma("Responsabile di Commessa {LIVELLO:Governo}\n  Caposquadra") === null);
    atteso("blocco JSON incompleto o rotto → null", leggiBloccoOrganigramma('{"v":2}') === null && leggiBloccoOrganigramma("{rotto") === null && leggiBloccoOrganigramma("") === null);

    const testo = "Intro.\n\n[ORGANIGRAMMA]\n[/ORGANIGRAMMA]\n\nFine.";
    atteso("segnaposto vuoto riconosciuto", haSegnaposto(testo));
    atteso("un blocco con contenuto non è un segnaposto", !haSegnaposto(`Intro.\n\n${blocco}\n`) && !haSegnaposto("[ORGANIGRAMMA]\nResponsabile\n[/ORGANIGRAMMA]"));
    const sostituito = sostituisciSegnaposto(`${testo}\n\n[ORGANIGRAMMA][/ORGANIGRAMMA]`, blocco);
    atteso("sostituzione: il primo segnaposto riceve il blocco, un secondo è tolto", sostituito.includes('"v":2') && (sostituito.match(/\[ORGANIGRAMMA\]/g) || []).length === 1);

    const m = mascheraOrganigrammi(`Prima.\n\n${blocco}\n\nDopo.\n\n[ORGANIGRAMMA]\nVecchio {LIVELLO:X}\n[/ORGANIGRAMMA]`);
    atteso("maschera: il modello non vede i dati, il blocco vecchio resta", !m.testo.includes('"v":2') && m.blocchi.length === 1 && m.testo.includes("Vecchio {LIVELLO:X}"));
    atteso("maschera: ripristino identico", ripristinaOrganigrammi(m.testo, m.blocchi).includes(blocco));
    atteso("invarianza: stesso testo = invariato; dati cambiati = non invariato", organigrammiInvariati(`A\n\n${blocco}`, `B diverso\n\n${blocco}`) && !organigrammiInvariati(`A\n\n${blocco}`, "A\n\n[ORGANIGRAMMA]\n[/ORGANIGRAMMA]") && !organigrammiInvariati(`A\n\n${blocco}`, `A\n\n${blocco.replace("Responsabile", "Altro")}`));
  }

  // --- 3. Fatti certi: interfaccia, sedi ---
  {
    atteso("interfaccia: solo RUP", derivaTipoInterfaccia(["Il RUP è il dott. X.", "altro"]) === "RUP");
    atteso("interfaccia: solo DEC", derivaTipoInterfaccia(["Il Direttore dell’esecuzione del contratto verifica."]) === "DEC");
    atteso("interfaccia: RUP e DEC → RUP/DEC", derivaTipoInterfaccia(["Responsabile unico del progetto", "L'A.O. nominerà il DEC"]) === "RUP/DEC");
    atteso("interfaccia: nessuna menzione → null (mai deciso dal modello)", derivaTipoInterfaccia(["Pulizia ordinaria, corruzione, interruzione del servizio"]) === null);
    atteso("sede: stessa scrittura a meno di maiuscole e accenti", abbinaSede("biblioteca  COMUNALE", FATTI.sedi) === "Biblioteca Comunale");
    atteso("sede: nome contenuto nell'altro", abbinaSede("Sede Nord (plesso A)", FATTI.sedi) === "Sede Nord");
    atteso("sede: sconosciuta o troppo corta → null", abbinaSede("Palazzo Fantasma", FATTI.sedi) === null && abbinaSede("Se", FATTI.sedi) === null);
  }

  // --- 4. Costruzione dei dati con i controlli ---
  {
    const senza = costruisciOrganigramma({ coordinamento: GREZZO_VALIDO.coordinamento }, FATTI);
    atteso("senza figura apicale: nessun organigramma e avviso esplicito", senza.dati === null && senza.blocco === null && senza.avvisi.some((a) => /figura apicale/.test(a)));
    const senzaZone = costruisciOrganigramma({ figura_apicale: GREZZO_VALIDO.figura_apicale }, FATTI);
    atteso("senza zone di coordinamento: nessun organigramma e avviso", senzaZone.dati === null && senzaZone.avvisi.some((a) => /coordinamento/.test(a)));
    atteso("input mancante: nessun organigramma, nessun errore", costruisciOrganigramma(undefined, FATTI).dati === null);

    const ok = costruisciOrganigramma(GREZZO_VALIDO, FATTI);
    atteso("input valido: dati e blocco costruiti", ok.dati !== null && ok.blocco !== null && ok.dati.v === 2 && ok.persone === contaPersone(ok.dati));
    atteso("committente e interfaccia vengono dai fatti", ok.dati?.committente?.denominazione === "Comune di Esempio" && ok.dati?.committente?.tipoInterfaccia === "RUP");
    const provaInganno = costruisciOrganigramma({ ...GREZZO_VALIDO, committente: { denominazione: "Inventato", tipo_interfaccia: "DEC" }, imprese: [{ denominazione: "Falsa" }] }, FATTI);
    atteso("committente/impresa/interfaccia scritti dal modello sono ignorati", provaInganno.dati?.committente?.denominazione === "Comune di Esempio" && provaInganno.dati?.imprese[0].denominazione === "IMPRESA ESEMPIO");
    atteso("senza committente nei fatti: nessuna linea di interfaccia", costruisciOrganigramma(GREZZO_VALIDO, { ...FATTI, committente: null }).dati?.committente === undefined);

    // nominativi
    const nomi = costruisciOrganigramma({ ...GREZZO_VALIDO, figura_apicale: { denominazione: "Responsabile Acquisti", nominativo: "Mario Bianchi" }, vice: { denominazione: "Vice", nominativo: "Luigi Inventato" } }, FATTI);
    atteso("nominativo presente nel profilo tenuto, quello inventato scartato con avviso", nomi.dati?.figuraApicale.nominativo === "Mario Bianchi" && nomi.dati?.vice?.nominativo === undefined && nomi.avvisi.some((a) => /nominativo/.test(a)));

    // sedi
    const unaZona = costruisciOrganigramma(GREZZO_VALIDO, FATTI);
    atteso("sedi con una sola zona: tutte assegnate a quella zona", unaZona.dati?.coordinamento[0].numeroSedi === 4 && (unaZona.dati?.coordinamento[0].sedi ?? []).length === 4);
    const dueZone = costruisciOrganigramma({
      ...GREZZO_VALIDO,
      coordinamento: [
        { denominazione: "Zona A", sedi: ["Sede Centrale", "sede nord", "Palazzo Fantasma"], sottolivelli: [] },
        { denominazione: "Zona B", sedi: ["Biblioteca Comunale"], sottolivelli: [] },
      ],
    }, FATTI);
    atteso("sedi: nome non in elenco scartato con avviso, numero calcolato dal codice", dueZone.dati?.coordinamento[0].numeroSedi === 2 && dueZone.avvisi.some((a) => /Palazzo Fantasma/.test(a)), JSON.stringify(dueZone.dati?.coordinamento.map((z) => z.sedi)));
    atteso("sedi non assegnate con più zone: avviso con l'elenco", dueZone.avvisi.some((a) => /non assegnate/.test(a) && /Polizia Locale/.test(a)));
    atteso("gara senza sedi: nessun numero di sedi", costruisciOrganigramma({ ...GREZZO_VALIDO, coordinamento: [{ denominazione: "Z", sedi: ["X"], sottolivelli: [] }] }, { ...FATTI, sedi: [] }).dati?.coordinamento[0].numeroSedi === undefined);

    // organico
    const grande = {
      figura_apicale: { denominazione: "R" },
      coordinamento: [{ denominazione: "Z", sottolivelli: [{ denominazione: "C1", addetti: ["a", "b", "c", "d", "e"] }, { denominazione: "C2", addetti: ["a", "b", "c", "d", "e"] }] }],
    };
    const sopra = costruisciOrganigramma(grande, { ...FATTI, organico: 8 });
    atteso("organico superato: avviso con i numeri", sopra.persone === 14 && sopra.avvisi.some((a) => /14 caselle/.test(a) && /8/.test(a)), JSON.stringify(sopra.avvisi));
    atteso("organico rispettato o ignoto: nessun avviso", !costruisciOrganigramma(grande, { ...FATTI, organico: 14 }).avvisi.some((a) => /organico/.test(a)) && !costruisciOrganigramma(grande, { ...FATTI, organico: null }).avvisi.some((a) => /organico/.test(a)));

    // direzione e strumenti dal profilo
    const conProfilo = costruisciOrganigramma(
      { ...GREZZO_VALIDO, strumenti_esterni: [{ denominazione: "Call center dedicato", tipo: "call_center" }, { denominazione: "Gestionale Esempio", tipo: "piattaforma" }] },
      { ...FATTI, funzioniDirezione: [{ funzione: "Direzione Generale" }], ufficiGestione: [{ funzione: "Ufficio Gare" }], softwareNome: "Gestionale Esempio" },
    );
    atteso("livello di direzione: i riquadri compaiono se il profilo è compilato", conProfilo.dati?.riquadriElenco?.length === 2 && conProfilo.dati.riquadriElenco[0].posizione === "sinistra" && conProfilo.dati.riquadriElenco[1].voci[0].funzione === "Ufficio Gare");
    atteso("livello di direzione: omesso se il profilo è vuoto", ok.dati?.riquadriElenco === undefined);
    atteso("strumenti: piattaforma del profilo + call center, senza doppioni", conProfilo.dati?.strumentiEsterni?.length === 2, JSON.stringify(conProfilo.dati?.strumentiEsterni));

    // R9 sui testi dell'organigramma
    const evidenzaVuota = { dipendenti: 8, uscente: [], fatti: [], testi: [] };
    const conValore = costruisciOrganigramma({ ...GREZZO_VALIDO, banda_conclusiva: { titolo: "Pool sostitutivo", descrizione: "Squadra di 12 addetti disponibile per assenze improvvise" } }, FATTI, { evidenza: evidenzaVuota });
    atteso("R9: un valore numerico senza riscontro nella banda riceve l'asterisco", /12 addetti \*/.test(conValore.dati?.bandaConclusiva?.descrizione ?? ""), conValore.dati?.bandaConclusiva?.descrizione);
    const conRiscontro = costruisciOrganigramma({ ...GREZZO_VALIDO, banda_conclusiva: { titolo: "Pool sostitutivo", descrizione: "Squadra di 12 addetti disponibile per assenze improvvise" } }, FATTI, { evidenza: { ...evidenzaVuota, testi: ["La squadra di sostituzione è composta da 12 addetti."] } });
    atteso("R9: con riscontro nei documenti nessun asterisco", !/\*/.test(conRiscontro.dati?.bandaConclusiva?.descrizione ?? ""), conRiscontro.dati?.bandaConclusiva?.descrizione);
  }

  // --- 5. Layout: geometria, colori, contrasto ---
  const COLORI_AMMESSI = new Set(
    [
      "#FFFFFF", "#1B4F72", "#1B2631", "#154360", "#1F618D", "#8A97A3", "#5D6D7E", "#F3F6F9", "#DDE4EA", "#EEF1F4", "#E5E8EB",
      `#${COLORE_PRIMARIO}`, `#${COLORE_PIENO.SICUREZZA}`, `#${COLORE_PIENO.AMBIENTE}`,
    ].map((c) => c.toUpperCase()),
  );
  const tinteDelPrimario = (hex: string) => /^#[0-9A-F]{6}$/.test(hex); // le tinte (schiarite) del blu primario sono ammesse: si verificano a parte
  for (const [nome, dati] of Object.entries(tuttiGliEsempi)) {
    const layout = calcolaLayout(dati, { misura: misuraApprossimata });
    const fuori: string[] = [];
    const rettangoli = layout.prims.filter((p): p is Extract<Prim, { t: "rect" }> => p.t === "rect");
    for (const r of rettangoli) {
      if (r.x < -0.5 || r.y < -0.5 || r.x + r.w > layout.larghezza + 0.5 || r.y + r.h > layout.altezza + 0.5) fuori.push(`rect ${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.w)}x${Math.round(r.h)}`);
    }
    for (const p of layout.prims) {
      if (p.t === "testo") {
        const w = misuraApprossimata(p.testo, p.size, p.bold);
        const x0 = p.ancora === "centro" ? p.x - w / 2 : p.x;
        if (x0 < 2 || x0 + w > layout.larghezza - 2) fuori.push(`testo «${p.testo.slice(0, 25)}»`);
      }
      if (p.t === "linea") for (const [x, y] of p.punti) if (x < 0 || y < 0 || x > layout.larghezza || y > layout.altezza) fuori.push("linea fuori");
    }
    atteso(`layout «${nome}»: nulla fuori dal disegno`, fuori.length === 0, fuori.slice(0, 4).join("; "));

    // Caselle di contenuto = rettangoli arrotondati NON contenitori: due caselle non si sovrappongono.
    const caselle = rettangoli.filter((r) => (r.r ?? 0) >= 6 && r.w < 540);
    const contiene = (a: typeof caselle[number], b: typeof caselle[number]) => a.x <= b.x + 0.5 && a.y <= b.y + 0.5 && a.x + a.w >= b.x + b.w - 0.5 && a.y + a.h >= b.y + b.h - 0.5;
    const sovrapposte: string[] = [];
    for (let i = 0; i < caselle.length; i++) {
      for (let j = i + 1; j < caselle.length; j++) {
        const a = caselle[i];
        const b = caselle[j];
        const dx = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
        const dy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
        if (dx > 1 && dy > 1 && !contiene(a, b) && !contiene(b, a)) sovrapposte.push(`${Math.round(a.x)},${Math.round(a.y)} × ${Math.round(b.x)},${Math.round(b.y)}`);
      }
    }
    atteso(`layout «${nome}»: nessuna casella sovrapposta a un'altra`, sovrapposte.length === 0, sovrapposte.slice(0, 3).join("; "));

    const coloriUsati = new Set<string>();
    for (const p of layout.prims) {
      if (p.t === "rect") [p.fill, p.stroke].forEach((c) => c && coloriUsati.add(c.toUpperCase()));
      if (p.t === "testo") coloriUsati.add(p.colore.toUpperCase());
      if (p.t === "linea") coloriUsati.add(p.colore.toUpperCase());
    }
    const estranei = [...coloriUsati].filter((c) => !COLORI_AMMESSI.has(c) && !tinteDelPrimario(c));
    atteso(`layout «${nome}»: solo colori della palette (R20, neutri, tinte del primario)`, estranei.length === 0, estranei.join(","));
    const pagine = stimaPagineOrganigramma(dati);
    atteso(`layout «${nome}»: stima delle pagine plausibile (${pagine.toFixed(2)})`, pagine > 0.2 && pagine < 1.2);
  }
  {
    const layout = calcolaLayout(tuttiGliEsempi.completo, { misura: misuraApprossimata });
    const arancioPieno = layout.prims.filter((p) => p.t === "rect" && p.fill?.toUpperCase() === `#${COLORE_PIENO.SICUREZZA}`).length;
    const verdePieno = layout.prims.filter((p) => p.t === "rect" && p.fill?.toUpperCase() === `#${COLORE_PIENO.AMBIENTE}`).length;
    atteso("R20: arancio solo per la sicurezza (una casella), verde solo per ambiente/CAM (una casella)", arancioPieno === 1 && verdePieno === 1, `${arancioPieno} arancio, ${verdePieno} verde`);
    const rosso = layout.prims.some((p) => (p.t === "rect" && [p.fill, p.stroke].some((c) => c?.toUpperCase() === "#C0392B")) || (p.t === "linea" && p.colore.toUpperCase() === "#C0392B"));
    atteso("il rosso (riservato a «da compilare») non compare nell'organigramma", !rosso);
    const dashGrigio = layout.prims.some((p) => p.t === "linea" && p.dash && p.colore.toUpperCase() === "#8A97A3");
    atteso("linea RUP/DEC e collegamenti esterni tratteggiati in grigio neutro", dashGrigio);
    const pieni = [`#${COLORE_PRIMARIO}`, `#${COLORE_PIENO.SICUREZZA}`, `#${COLORE_PIENO.AMBIENTE}`];
    const contrastiBassi = pieni.filter((f) => contrasto(testoSu(f), f) < 3);
    atteso("contrasto del testo sui colori pieni di R20 ≥ 3:1 (con testo scuro sull'arancio)", contrastiBassi.length === 0 && testoSu(`#${COLORE_PIENO.SICUREZZA}`) === "#1B2631", contrastiBassi.join(","));
    const nodiTesto = layout.prims.filter((p) => p.t === "testo" && p.colore.toUpperCase() === "#FFFFFF").length;
    atteso("testo bianco usato (sul blu primario)", nodiTesto > 0);
  }
  {
    // Adattamento: con più di sei zone si dispongono su due file e il disegno non esce dal foglio.
    const una = calcolaLayout({ ...esempioComune, coordinamento: [1, 2, 3, 4].map((n) => ({ denominazione: `Zona ${n}`, sottolivelli: [] })) }, { misura: misuraApprossimata });
    const sette = calcolaLayout(tuttiGliEsempi.setteZone, { misura: misuraApprossimata });
    const fillCoordinatore = `#${schiarisciColore(COLORE_PRIMARIO, 0.45)}`;
    const coord = (l: typeof una) => new Set(l.prims.filter((p) => p.t === "rect" && p.fill?.toUpperCase() === fillCoordinatore).map((p) => (p as Extract<Prim, { t: "rect" }>).y)).size;
    atteso("con 4 zone una fila di coordinatori, con 7 zone due file", coord(una) === 1 && coord(sette) === 2, `${coord(una)} / ${coord(sette)} file`);
  }
  {
    const lunghi = calcolaLayout({
      ...esempioComune,
      figuraApicale: { denominazione: "Responsabile Generale del Contratto di Servizio per le Sedi Comunali e Periferiche del Territorio" },
      coordinamento: [{ denominazione: "Coordinatore ".repeat(12), sottolivelli: [{ denominazione: "Caposquadra Parola".repeat(10), dettaglio: "Dettaglio ".repeat(30), addetti: ["Operatore".repeat(12)] }] }],
    }, { misura: misuraApprossimata });
    const fuori = lunghi.prims.filter((p) => p.t === "rect" && (p.x < 0 || p.x + p.w > lunghi.larghezza)).length;
    atteso("testi lunghissimi: il layout regge e resta nel foglio", fuori === 0 && lunghi.altezza < 1500, `${fuori} fuori, altezza ${lunghi.altezza}`);
  }

  // --- 6. Disegno vero su canvas ---
  {
    const r = await disegnaOrganigramma(esempioComune);
    const png = r.buffer;
    const firma = png.subarray(0, 8).toString("hex") === "89504e470d0a1a0a";
    const larghezzaPng = png.readUInt32BE(16);
    const altezzaPng = png.readUInt32BE(20);
    atteso("disegno: PNG valido largo 2400 px", firma && larghezzaPng === 2400 && altezzaPng === r.altezzaPx, `${larghezzaPng}x${altezzaPng}`);
    atteso("disegno: dimensioni nel documento 600 px di larghezza, altezza proporzionale", r.width === 600 && Math.abs(r.height - (600 * altezzaPng) / 2400) <= 1);
    for (const [nome, dati] of Object.entries(tuttiGliEsempi)) {
      let errore = "";
      try {
        const d = await disegnaOrganigramma(dati);
        if (d.buffer.length < 5000) errore = "immagine troppo piccola";
      } catch (e) {
        errore = String(e);
      }
      atteso(`disegno «${nome}»: nessun errore`, errore === "", errore);
    }
    const stimaDisegno = (r.altezzaPx / 2400) * 680;
    const stimaLayout = calcolaLayout(esempioComune, { misura: misuraApprossimata }).altezza;
    atteso("la stima delle pagine (misura approssimata) è vicina al disegno vero (±12%)", Math.abs(stimaDisegno - stimaLayout) / stimaDisegno < 0.12, `${stimaDisegno.toFixed(0)} vs ${stimaLayout.toFixed(0)}`);
  }

  // --- 7. Stima pagine del documento ---
  {
    const blocco = serializzaBlocco(esempioComune);
    const conBlocco = stimaPagineContenuto(`## 1.1 Struttura\n\nTesto breve.\n\n${blocco}\n`, {});
    const senzaBlocco = stimaPagineContenuto("## 1.1 Struttura\n\nTesto breve.\n", {});
    atteso("pagine: il blocco strutturato costa quanto il suo disegno, non come una riga di JSON", Math.abs(conBlocco - senzaBlocco - stimaPagineOrganigramma(esempioComune)) < 0.02, `${(conBlocco - senzaBlocco).toFixed(3)} vs ${stimaPagineOrganigramma(esempioComune).toFixed(3)}`);
    const vecchio = stimaPagineContenuto("## 1.1 Struttura\n\nTesto breve.\n\n[ORGANIGRAMMA]\nResponsabile {LIVELLO:Governo}\n  Caposquadra\n[/ORGANIGRAMMA]\n", {});
    atteso("pagine: un blocco vecchio a rientri si stima come prima", vecchio > senzaBlocco + 0.5);
  }

  // --- 8. Compressione/espansione non toccano i dati ---
  {
    const blocco = serializzaBlocco(esempioOspedale);
    const FRASI = ["Il responsabile coordina le attività quotidiane presso ogni sede del servizio.", "Gli operatori seguono procedure scritte e aggiornate durante tutto l'anno.", "Ogni intervento viene registrato e riportato al referente.", "Le attrezzature sono controllate prima dell'avvio del turno."];
    const prosa = Array.from({ length: 6 }, (_, i) => FRASI[i % FRASI.length]).join(" ");
    const testo = `## 1.1 Struttura\n\n${prosa}\n\n${blocco}\n\n| Ruolo | Compito |\n|---|---|\n| [G]**Responsabile** | [G]Coordina il servizio |\n| [G]**Ispettore** | [G]Verifica gli interventi |`;
    const richieste: RichiestaEspansione[] = [];
    const ampia = (r: RichiestaEspansione) => `${r.testo}\n\n${Array.from({ length: 10 }, (_, i) => `${FRASI[i % FRASI.length].replace(/\.$/, "")} nel contesto ${"abcdefghij"[i]}.`).join(" ")}`;
    const espansione = await espandiBloccoConGaranzie({
      chiave: "1.1", titoloBlocco: "1. Struttura", blocco: testo, pagineTarget: 1.6, paroleXPagina: 450, formattazione: {}, context: { userId: null, garaId: null },
      espandi: async (r) => { richieste.push(r); return ampia(r); },
    });
    atteso("espansione: il modello non riceve i dati dell'organigramma, solo il segnaposto", richieste.length > 0 && richieste.every((r) => !r.testo.includes('"v":2')) && richieste[0].testo.includes("[ORGANIGRAMMA]"));
    atteso("espansione: il blocco nel risultato è identico all'originale", espansione.esito === "espanso" && espansione.testo.includes(blocco), `${espansione.esito} ${espansione.motivo ?? ""}`);
    const senzaSegnaposto = await espandiBloccoConGaranzie({
      chiave: "1.1", titoloBlocco: "1. Struttura", blocco: testo, pagineTarget: 1.6, paroleXPagina: 450, formattazione: {}, context: { userId: null, garaId: null },
      espandi: async (r) => ampia(r).replace("[ORGANIGRAMMA][/ORGANIGRAMMA]", ""),
    });
    atteso("espansione: se il modello butta via il segnaposto l'ampliamento è rifiutato", senzaSegnaposto.esito === "rifiutato", senzaSegnaposto.esito);
  }

  // --- 9. Schema dello strumento e collegamento ai punti di produzione ---
  {
    const prop = SCHEMA_ORGANIGRAMMA_STRUMENTO.properties;
    const campi = Object.keys(prop);
    atteso("schema: nessun campo di colore, coordinate o dimensioni, né committente/interfaccia/impresa", !campi.some((c) => /color|coordin(?!amento)|dimension|committente|interfaccia|impresa|riquadri/i.test(c)), campi.join(","));
    atteso("schema: figura apicale e coordinamento obbligatori; tipo di staff enumerato", SCHEMA_ORGANIGRAMMA_STRUMENTO.required.join() === "figura_apicale,coordinamento" && prop.staff_governo.items.properties.tipo.enum.includes("sicurezza"));
    atteso("schema: la descrizione vieta nominativi inventati e chiede sedi con denominazione esatta", /ESATTA/.test(JSON.stringify(SCHEMA_ORGANIGRAMMA_STRUMENTO)) && /non inventare nomi/.test(JSON.stringify(SCHEMA_ORGANIGRAMMA_STRUMENTO)));

    const promptStrumento = leggiFile("src/lib/gara-chat-prompt.ts");
    atteso("strumento di generazione: campo 'organigramma' con lo schema e istruzione del segnaposto", /organigramma: SCHEMA_ORGANIGRAMMA_STRUMENTO/.test(promptStrumento) && /\[ORGANIGRAMMA\]\[\/ORGANIGRAMMA\]/.test(promptStrumento));
    atteso("strumento di generazione: l'istruzione vecchia a rientri è stata tolta", !/con un elenco a rientri \(2 spazi per livello\)/.test(promptStrumento) && !/\{LIVELLO:Nome\}/.test(promptStrumento));

    const docx = leggiFile("src/lib/docx-generator.ts");
    atteso("Word: l'organigramma strutturato usa il nuovo disegnatore, il vecchio resta per le bozze salvate", /leggiBloccoOrganigramma\(segment\.contenuto\)/.test(docx) && /disegnaOrganigramma\(datiOrganigramma/.test(docx) && /generateOrgChartPng\(segment\.contenuto/.test(docx));

    const relazione = leggiFile("src/lib/relazione-tecnica.ts");
    const iIcone = relazione.indexOf("const contenutoSenzaOrganigramma = assegnaIconeMancanti");
    const iBlocco = relazione.indexOf("costruisciOrganigramma(organigrammaDichiarato");
    const iDocx = relazione.indexOf("const buffer = await buildDocxBuffer(\n    titoloSezione");
    atteso("bozza: il blocco si costruisce DOPO ogni riscrittura (icone incluse) e prima del Word", iIcone > 0 && iBlocco > iIcone && iDocx > iBlocco);
    atteso("Word: lo stile vecchio (chiamata al modello) si chiede solo per i blocchi vecchi", (relazione.match(/serveStileVecchio \? ricavaStileOrganigramma/g) || []).length === 2);

    const chat = leggiFile("src/app/actions/gara-chat.ts");
    atteso("chat: i dati dell'organigramma arrivano alla generazione e gli avvisi al modello", /organigramma: input\.organigramma/.test(chat) && /testoAvvisiOrganigramma\(avvisiOrganigramma\)/.test(chat));

    const compressione = leggiFile("src/lib/compressione-mirata.ts");
    const espansioneSrc = leggiFile("src/lib/espansione-mirata.ts");
    atteso("compressione ed espansione mascherano l'organigramma e ne verificano l'invarianza", /mascheraOrganigrammi/.test(compressione) && /organigrammiInvariati/.test(compressione) && /mascheraOrganigrammi/.test(espansioneSrc) && /organigrammiInvariati/.test(espansioneSrc));

    const migrazione = leggiFile("supabase/migrations/0071_companies_organigramma_direzione.sql");
    atteso("migrazione: due colonne di testo facoltative, idempotente", /add column if not exists funzioni_direzione text/.test(migrazione) && /add column if not exists uffici_gestione text/.test(migrazione));
    const azione = leggiFile("src/app/actions/company-profile.ts");
    atteso("profilo: il salvataggio non fallisce se la migrazione non è ancora stata eseguita", /funzioni_direzione\|uffici_gestione/.test(azione));
    atteso("profilo: i due campi nel modulo", /name="funzioniDirezione"/.test(leggiFile("src/app/site-omnia-ai/dashboard/omnia-ai/profilo-azienda/company-profile-form.tsx")) && /name="ufficiGestione"/.test(leggiFile("src/app/site-omnia-ai/dashboard/omnia-ai/profilo-azienda/company-profile-form.tsx")));
  }

  if (fallimenti.length > 0) {
    console.log(`\n${fallimenti.length} verifiche fallite`);
    process.exit(1);
  }
  console.log("\nAutotest dell'organigramma strutturato: tutti i casi ok.");
}

main().catch((err) => {
  console.error("Errore inatteso nell'autotest dell'organigramma:", err);
  process.exit(1);
});
