// Autotest di macchinari e attrezzature del piano di lavoro (OMNIA AI), senza rete e senza modello vero:
//   - il catalogo: voci coerenti (prezzi, vita utile, regole), ogni prezzo con la sua fonte e la sua data;
//   - le regole di quantità, provate sui quattro piani di lavoro fatti a mano (Milanosport, Scala, Donnafugata, FS Sud-Est): per le
//     voci principali la quantità del codice resta entro un fattore 3 da quella scelta a mano;
//   - quali voci «se_serve» si attivano dai dati della gara (moquette, aree esterne…), e che una quantità minima scritta nei documenti
//     valga più della regola;
//   - la ricerca web del prezzo per le dotazioni fuori catalogo, con un modello FINTO: prezzo IVA inclusa riportato a IVA esclusa,
//     prezzi impossibili o senza indirizzo scartati, riprese su «pause_turn», nessun prezzo inventato quando non si trova;
//   - gli errori: se il modello non risponde valgono le regole di base.
// Gratuito: gira nel livello 1, quindi in prebuild.
import fs from "fs";
import path from "path";
import type Anthropic from "@anthropic-ai/sdk";
import { CATALOGO, voceCatalogo } from "../src/lib/piano-lavoro-catalogo";
import {
  PREZZO_MAX,
  PREZZO_MIN,
  STRUMENTO_SCELTA_DOTAZIONI,
  cercaPrezzoWeb,
  contestoDaDati,
  dimensionaMacchinari,
  quantitaDaRegola,
  validaPrezzoWeb,
  vociAttivate,
  type ContestoDimensionamento,
} from "../src/lib/piano-lavoro-macchinari";
import { normalizzaPianoLavoro } from "../src/lib/piano-lavoro-dati";
import type { UsoModello } from "../src/lib/piano-lavoro-estrazione";

const fallimenti: string[] = [];
function atteso(nome: string, ok: boolean, dettaglio = "") {
  console.log(`${ok ? "ok    " : "FALLITO"} ${nome}${ok ? "" : ` — ${dettaglio}`}`);
  if (!ok) fallimenti.push(nome);
}
function uguale<T>(nome: string, ottenuto: T, previsto: T) {
  atteso(nome, JSON.stringify(ottenuto) === JSON.stringify(previsto), `ottenuto ${JSON.stringify(ottenuto)}, previsto ${JSON.stringify(previsto)}`);
}

// modello finto: risponde in base a quale strumento viene chiesto
type Risposta = { content: unknown[]; stop_reason: string; usage?: Record<string, unknown> };
function modelloFinto(gestore: (params: Record<string, unknown>, n: number) => Risposta) {
  const chiamate: Record<string, unknown>[] = [];
  const client = {
    messages: {
      stream: (params: Record<string, unknown>) => {
        chiamate.push(params);
        const r = gestore(params, chiamate.length);
        return { finalMessage: async () => ({ ...r, usage: { input_tokens: 500, output_tokens: 100, ...(r.usage ?? {}) } }) };
      },
    },
  } as unknown as Anthropic;
  return { client, chiamate };
}
const toolUse = (name: string, input: unknown): Risposta => ({ stop_reason: "tool_use", content: [{ type: "tool_use", name, input }] });
const haRicercaWeb = (p: Record<string, unknown>): boolean => ((p.tools as { type?: string }[]) ?? []).some((t) => t.type === "web_search_20250305");

async function main() {
  // ═════ 1. catalogo ═════
  {
    const chiavi = CATALOGO.map((v) => v.chiave);
    atteso("catalogo: chiavi uniche", new Set(chiavi).size === chiavi.length);
    atteso("catalogo: prezzo tra minimo e massimo, tutti positivi; vita utile e quantità ragionevoli", CATALOGO.every((v) => v.prezzoMin > 0 && v.prezzoMin <= v.prezzo && v.prezzo <= v.prezzoMax && v.vitaUtileMesi >= 12 && v.regola.min >= 1 && v.regola.min <= v.regola.max), CATALOGO.filter((v) => !(v.prezzoMin <= v.prezzo && v.prezzo <= v.prezzoMax)).map((v) => v.chiave).join(","));
    atteso("catalogo: ogni voce ha la fonte del prezzo e la data di rilevazione", CATALOGO.every((v) => v.fonte.length > 10 && /^\d{4}-\d{2}-\d{2}$/.test(v.rilevatoIl)));
    atteso("catalogo: le voci «sempre» hanno una regola con almeno una base (la quantità cresce con la gara)", CATALOGO.filter((v) => v.quando === "sempre").every((v) => v.regola.basi.length > 0));
    atteso("catalogo: lo strumento della scelta elenca tutte e solo le voci del catalogo", JSON.stringify((STRUMENTO_SCELTA_DOTAZIONI.input_schema as { properties: { voci: { items: { properties: { chiave: { enum: string[] } } } } } }).properties.voci.items.properties.chiave.enum) === JSON.stringify(chiavi));
    atteso("catalogo: le macchine IPC/FIMAP hanno un modello di riferimento e una fonte web con la data", CATALOGO.filter((v) => /IPC|FIMAP|Fimap/.test(v.riferimento)).every((v) => /^https?:\/\//.test(v.fonte) || /https?:\/\//.test(v.fonte)), CATALOGO.filter((v) => /IPC|FIMAP|Fimap/.test(v.riferimento) && !/https?:\/\//.test(v.fonte)).map((v) => v.chiave).join(","));
  }

  // ═════ 2. regole di quantità ═════
  {
    const c: ContestoDimensionamento = { fte: 43.6, sedi: 27, mq: 212774, mqEsterni: 123000 };
    uguale("regola: carrelli 0,9 per addetto equivalente (43,6 → 40)", quantitaDaRegola(voceCatalogo("carrello_multiuso")!.regola, c), 40);
    uguale("regola: il valore più grande tra le basi (aspiratori: 0,25×FTE = 11 contro 0,5×sedi = 14 → 14)", quantitaDaRegola(voceCatalogo("aspiratore_professionale")!.regola, c), 14);
    uguale("regola: si riporta tra minimo e massimo (0 addetti → minimo 1; 1000 addetti → massimo 80)", [quantitaDaRegola(voceCatalogo("carrello_multiuso")!.regola, { fte: 0, sedi: 0, mq: 0, mqEsterni: 0 }), quantitaDaRegola(voceCatalogo("carrello_multiuso")!.regola, { ...c, fte: 1000 })], [1, 80]);
    uguale("regola senza basi (luminometro ATP): sempre il minimo, 2", quantitaDaRegola(voceCatalogo("luminometro_atp")!.regola, c), 2);
    uguale("regola «ogni»: una lavasciuga ogni 30.000 mq (212.774 → 8)", quantitaDaRegola(voceCatalogo("lavasciuga_spinta")!.regola, c), 8);
  }

  // ═════ 3. le regole contro i quattro piani fatti a mano ═════
  {
    // contesto di ogni piano (addetti equivalenti = ore ÷ 1.573; metrature dai piani) e quantità scelte a mano
    const piani: { nome: string; c: ContestoDimensionamento; mano: Record<string, number> }[] = [
      { nome: "Milanosport", c: { fte: 43.6, sedi: 27, mq: 212774, mqEsterni: 123000 }, mano: { carrello_multiuso: 40, kit_attrezzi_manuali: 28, secchio_strizzatore: 40, canne_lavaggio: 28, lavasciuga_spinta: 7, monospazzola: 6, aspiratore_professionale: 10, scale_alluminio: 15 } },
      { nome: "Teatro alla Scala", c: { fte: 41.6, sedi: 9, mq: 111500, mqEsterni: 5000 }, mano: { carrello_multiuso: 40, lavasciuga_spinta: 6, monospazzola: 5, aspiratore_professionale: 15, scale_alluminio: 15 } },
      { nome: "Donnafugata", c: { fte: 16.8, sedi: 55, mq: 44163, mqEsterni: 2700 }, mano: { carrello_multiuso: 15, kit_attrezzi_manuali: 30, lavasciuga_spinta: 2, monospazzola: 31, aspiratore_professionale: 31 } },
      { nome: "FS Sud-Est", c: { fte: 53.8, sedi: 7, mq: 219000, mqEsterni: 197000 }, mano: { lavasciuga_spinta: 7, spazzatrice_semovente: 2 } },
    ];
    const fuori: string[] = [];
    let confrontate = 0;
    for (const p of piani) {
      for (const [chiave, qMano] of Object.entries(p.mano)) {
        const q = quantitaDaRegola(voceCatalogo(chiave)!.regola, p.c);
        confrontate++;
        if (q > qMano * 3 || q < qMano / 3) fuori.push(`${p.nome} ${chiave}: codice ${q}, a mano ${qMano}`);
      }
    }
    atteso(`calibrazione: ${confrontate} quantità dei quattro piani a mano, la regola resta entro un fattore 3`, fuori.length === 0, fuori.join(" | "));
  }

  // ═════ 4. voci attivate dai dati ═════
  const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "test", "fixtures", "piano-lavoro-milanosport.json"), "utf-8")) as { dati: unknown };
  const datiMilano = normalizzaPianoLavoro(fixture.dati).dati;
  {
    const c = contestoDaDati(datiMilano);
    atteso("contesto da dati (Milanosport): 27 sedi a canone, addetti equivalenti dal monte ore dichiarato (68.627 ÷ 1.440), aree esterne riconosciute dai nomi delle tipologie", c.sedi === 27 && Math.abs(c.fte - 68627 / 1440) < 1e-6 && c.mqEsterni > 100000 && c.mqEsterni < c.mq, JSON.stringify(c));
    const base = normalizzaPianoLavoro({ tipologie: [{ nome: "Uffici", lavorazioni: [{ nome: "Pulizia giornaliera", resa: 300, frequenza: 365 }] }], sedi: [{ nome: "A", mq: { Uffici: 1000 } }] }).dati;
    const cb = contestoDaDati(base);
    const soloBase = vociAttivate(base, [], cb).map((a) => a.chiave);
    atteso("senza indizi si attivano solo le voci «sempre»", soloBase.every((k) => voceCatalogo(k)!.quando === "sempre") && soloBase.includes("carrello_multiuso") && !soloBase.includes("lavamoquette") && !soloBase.includes("spazzatrice_semovente"), soloBase.join(","));
    const conMoquette = vociAttivate(base, [{ descrizione: "Lavamoquette ad iniezione-estrazione per le sale prova", quantita: 2 }, { descrizione: "Lavasciuga uomo a bordo per i magazzini" }], cb).map((a) => a.chiave);
    atteso("una moquette e una lavasciuga «uomo a bordo» nei requisiti attivano lavamoquette, battitappeto e lavasciuga a bordo", ["lavamoquette", "battitappeto", "lavasciuga_bordo"].every((k) => conMoquette.includes(k)), conMoquette.join(","));
    const grande = vociAttivate(base, [], { fte: 40, sedi: 5, mq: 300000, mqEsterni: 150000 }).map((a) => a.chiave);
    atteso("150.000 mq di aree esterne attivano spazzatrici e soffiatori", ["spazzatrice_semovente", "spazzatrice_spinta", "soffiatore"].every((k) => grande.includes(k)), grande.join(","));
    const lavorazioni = normalizzaPianoLavoro({ tipologie: [{ nome: "Aree monumentali", lavorazioni: [{ nome: "Pulizia vetrate esterne e lampadari in quota", resa: 100, frequenza: 12 }, { nome: "Lucidatura pavimenti", resa: 100, frequenza: 4 }] }] }).dati;
    const dalleLavorazioni = vociAttivate(lavorazioni, [], cb).map((a) => a.chiave);
    atteso("le parole delle lavorazioni (lampadari, vetrate esterne, lucidatura) attivano trabattello, aste e lucidatrice", ["piattaforma_trabattello", "aste_telescopiche_vetri", "lucidatrice_alta_velocita"].every((k) => dalleLavorazioni.includes(k)), dalleLavorazioni.join(","));
  }

  // ═════ 5. prezzo dal web: validazione ═════
  {
    const ok = validaPrezzoWeb({ trovato: true, marca: "Marca", modello: "X1", prezzo: 1220, iva_sul_sito: "inclusa", url: "https://www.esempio-pulizie.it/prodotto/x1", vita_utile_mesi: 60 });
    atteso("prezzo web: IVA inclusa riportata a IVA esclusa (1.220 → 1.000), con marca, modello, indirizzo e vita utile", ok?.prezzo === 1000 && ok.marca === "Marca" && ok.vitaUtileMesi === 60 && /^https:/.test(ok.url), JSON.stringify(ok));
    uguale("prezzo web: IVA esclusa resta com'è; «non indicata» si tratta come inclusa (prezzi al pubblico)", [validaPrezzoWeb({ trovato: true, prezzo: 500, iva_sul_sito: "esclusa", url: "https://a.it/x" })?.prezzo, validaPrezzoWeb({ trovato: true, prezzo: 610, iva_sul_sito: "non_indicata", url: "https://a.it/x" })?.prezzo], [500, 500]);
    uguale("prezzo web: non trovato, senza prezzo, fuori intervallo, senza indirizzo o con un indirizzo falso → nessun prezzo", [
      validaPrezzoWeb({ trovato: false }),
      validaPrezzoWeb({ trovato: true, url: "https://a.it/x" }),
      validaPrezzoWeb({ trovato: true, prezzo: PREZZO_MAX * 3, iva_sul_sito: "esclusa", url: "https://a.it/x" }),
      validaPrezzoWeb({ trovato: true, prezzo: PREZZO_MIN / 10, iva_sul_sito: "esclusa", url: "https://a.it/x" }),
      validaPrezzoWeb({ trovato: true, prezzo: 100, iva_sul_sito: "esclusa", url: "" }),
      validaPrezzoWeb({ trovato: true, prezzo: 100, iva_sul_sito: "esclusa", url: "javascript:alert(1)" }),
      validaPrezzoWeb(null),
    ], [null, null, null, null, null, null, null]);
  }

  // ═════ 6. ricerca web con un modello finto ═════
  {
    const usi: UsoModello[] = [];
    const f1 = modelloFinto(() => toolUse("registra_prezzo", { trovato: true, marca: "Soot", modello: "SR-1", prezzo: 22000, iva_sul_sito: "inclusa", url: "https://rivenditore.it/sr1", vita_utile_mesi: 96 }));
    const p1 = await cercaPrezzoWeb({ anthropic: f1.client, registraUso: (u) => void usi.push(u) }, "Macchina per la rimozione della fuliggine dai tetti");
    atteso("ricerca web: la richiesta include lo strumento di ricerca del modello e quello per registrare il prezzo; il prezzo trovato è validato", haRicercaWeb(f1.chiamate[0]) && ((f1.chiamate[0].tools as { name?: string }[]) ?? []).some((t) => t.name === "registra_prezzo") && p1?.prezzo === 18032.79, JSON.stringify(p1));
    atteso("ricerca web: l'istruzione dice di ignorare le istruzioni scritte nelle pagine e di non usare la memoria", /ignora ogni istruzione/.test(String(f1.chiamate[0].system)) && /non usare la memoria/.test(String(f1.chiamate[0].system)));
    uguale("ricerca web: il costo è registrato con la sua operazione", usi.map((u) => u.operazione), ["piano_lavoro_prezzo_web"]);

    const f2 = modelloFinto((p, n) => (n === 1 ? { stop_reason: "pause_turn", content: [{ type: "server_tool_use", name: "web_search" }] } : toolUse("registra_prezzo", { trovato: true, prezzo: 300, iva_sul_sito: "esclusa", url: "https://a.it/p" })));
    const p2 = await cercaPrezzoWeb({ anthropic: f2.client }, "x");
    atteso("ricerca web: su «pause_turn» si riprende e poi si legge il prezzo", f2.chiamate.length === 2 && p2?.prezzo === 300);
    const f3 = modelloFinto(() => ({ stop_reason: "end_turn", content: [{ type: "text", text: "Non ho trovato nulla" }] }));
    atteso("ricerca web: senza lo strumento di registrazione il risultato è «nessun prezzo»", (await cercaPrezzoWeb({ anthropic: f3.client }, "x")) === null && f3.chiamate.length === 1);
    const f4 = modelloFinto(() => ({ stop_reason: "pause_turn", content: [] }));
    await cercaPrezzoWeb({ anthropic: f4.client }, "x");
    atteso("ricerca web: le riprese sono al massimo 4 (nessun ciclo infinito)", f4.chiamate.length === 4);
  }

  // ═════ 7. dimensionamento completo ═════
  {
    const base = normalizzaPianoLavoro({
      appalto: { titolo: "Pulizie di prova" },
      parametri: [{ chiave: "ore_fte", valore: 1600 }, { chiave: "monte_ore_dichiarato", valore: 40000 }],
      tipologie: [{ nome: "Uffici", lavorazioni: [{ nome: "Pulizia giornaliera", resa: 300, frequenza: 365 }] }],
      sedi: [{ nome: "A", mq: { Uffici: 5000 } }, { nome: "B", mq: { Uffici: 3000 } }],
    }).dati;

    // senza requisiti: nessuna chiamata al modello
    const f0 = modelloFinto(() => toolUse("scegli_dotazioni", {}));
    const r0 = await dimensionaMacchinari(base, [], { anthropic: f0.client });
    atteso("senza requisiti dei documenti il modello non viene chiamato e restano le voci di base, tutte «catalogo» con fonte e data", f0.chiamate.length === 0 && r0.macchinari.length > 5 && r0.macchinari.every((m) => m.origine === "catalogo" && m.fontePrezzo.length > 10 && m.prezzoUnitario !== null && (m.quantita ?? 0) >= 1), JSON.stringify(r0.macchinari.map((m) => m.descrizione.slice(0, 20))));
    const carr = r0.macchinari.find((m) => /Carrello/.test(m.descrizione))!;
    atteso("la quantità viene dalla regola (25 addetti equivalenti × 0,9 → 23 carrelli) e il prezzo dal catalogo", carr.quantita === 23 && carr.prezzoUnitario === voceCatalogo("carrello_multiuso")!.prezzo && carr.categoria === "Attrezzature", JSON.stringify(carr));

    // con requisiti: il modello alza una quantità minima e indica una dotazione fuori catalogo, che si cerca sul web
    const usi: UsoModello[] = [];
    const f1 = modelloFinto((p) => {
      if (haRicercaWeb(p)) return toolUse("registra_prezzo", { trovato: true, marca: "Soot", modello: "SR-1", prezzo: 24400, iva_sul_sito: "inclusa", url: "https://rivenditore.it/sr1", vita_utile_mesi: 96 });
      return toolUse("scegli_dotazioni", {
        voci: [{ chiave: "luminometro_atp", motivo: "Controllo della sanificazione richiesto", quantita_minima: 3, fonte: "CSA art. 11" }, { chiave: "voce_che_non_esiste", motivo: "x" }, { chiave: "carrello_multiuso", motivo: "già attiva" }],
        non_in_catalogo: [{ descrizione: "Macchina per la rimozione della fuliggine dai tetti", quantita: 1, motivo: "Richiesta per le coperture delle stazioni", fonte: "CSA art. 8" }],
      });
    });
    const r1 = await dimensionaMacchinari(base, [{ descrizione: "Luminometro ATP per il controllo", quantita: 3, fonte: "CSA art. 11" }, { descrizione: "Macchina rimozione fuliggine" }], { anthropic: f1.client, registraUso: (u) => void usi.push(u) });
    const atp = r1.macchinari.find((m) => /Luminometro/.test(m.descrizione))!;
    atteso("una quantità minima scritta nei documenti (3) vale più della regola (2), con la fonte nella nota", atp.quantita === 3 && /Quantità minima richiesta dai documenti \(CSA art\. 11\)/.test(atp.nota), JSON.stringify(atp));
    atteso("una voce che non è nel catalogo, indicata dal modello, viene ignorata", !r1.macchinari.some((m) => /voce_che_non_esiste/.test(m.descrizione)));
    const fuliggine = r1.macchinari.find((m) => /fuliggine/.test(m.descrizione))!;
    atteso("la dotazione fuori catalogo ha il prezzo trovato sul web (24.400 IVA inclusa → 20.000), la marca, l'indirizzo come fonte, la vita utile e la categoria dedicata", fuliggine.prezzoUnitario === 20000 && fuliggine.origine === "ricerca_web" && /rivenditore\.it/.test(fuliggine.fontePrezzo) && fuliggine.riferimento === "Soot SR-1" && fuliggine.vitaUtileMesi === 96 && fuliggine.categoria === "Dotazioni richieste dai documenti" && fuliggine.quantita === 1, JSON.stringify(fuliggine));
    uguale("i costi registrati: la scelta delle voci e la ricerca web", usi.map((u) => u.operazione), ["piano_lavoro_macchinari", "piano_lavoro_prezzo_web"]);
    atteso("le voci già attive non si duplicano", r1.macchinari.filter((m) => /Carrello/.test(m.descrizione)).length === 1);

    // prezzo non trovato: riga da compilare, mai un prezzo inventato
    const f2 = modelloFinto((p) => (haRicercaWeb(p) ? toolUse("registra_prezzo", { trovato: false }) : toolUse("scegli_dotazioni", { non_in_catalogo: [{ descrizione: "Robot lavapavimenti autonomo", quantita: 2, motivo: "Richiesto" }] })));
    const r2 = await dimensionaMacchinari(base, [{ descrizione: "Robot lavapavimenti" }], { anthropic: f2.client });
    const robot = r2.macchinari.find((m) => /Robot/.test(m.descrizione))!;
    atteso("prezzo non trovato sul web: cella da compilare (nessun prezzo), origine «ipotesi», e un avviso", robot.prezzoUnitario === null && robot.origine === "ipotesi" && robot.fontePrezzo === "" && r2.avvisi.some((a) => /Prezzo non trovato per «Robot lavapavimenti autonomo»/.test(a)), JSON.stringify(robot));

    // quantità non indicata dai documenti: se ne conta una, dichiarandolo
    const f2b = modelloFinto((p) => (haRicercaWeb(p) ? toolUse("registra_prezzo", { trovato: true, prezzo: 1220, iva_sul_sito: "inclusa", url: "https://a.it/x" }) : toolUse("scegli_dotazioni", { non_in_catalogo: [{ descrizione: "Idrosabbiatrice per graffiti", motivo: "Richiesta", fonte: "CSA A" }] })));
    const r2b = await dimensionaMacchinari(base, [{ descrizione: "Rimozione graffiti" }], { anthropic: f2b.client });
    const graffiti = r2b.macchinari.find((m) => /graffiti/.test(m.descrizione))!;
    atteso("quantità non indicata nei documenti: 1, con la nota «ipotesi»", graffiti.quantita === 1 && /Quantità 1: ipotesi/.test(graffiti.nota) && graffiti.prezzoUnitario === 1000, JSON.stringify(graffiti));

    // un prezzo molto alto trovato sul web si inserisce ma si segnala da verificare
    const f2c = modelloFinto((p) => (haRicercaWeb(p) ? toolUse("registra_prezzo", { trovato: true, prezzo: 79200, iva_sul_sito: "esclusa", url: "https://a.it/x", marca: "IPC", modello: "195" }) : toolUse("scegli_dotazioni", { non_in_catalogo: [{ descrizione: "Macchina industriale", quantita: 1, motivo: "Richiesta" }] })));
    const r2c = await dimensionaMacchinari(base, [{ descrizione: "Macchina industriale" }], { anthropic: f2c.client });
    const cara = r2c.macchinari.find((m) => /industriale/.test(m.descrizione))!;
    atteso("un prezzo web sopra 30.000 € resta inserito ma con nota e avviso «prezzo elevato: verificare»", cara.prezzoUnitario === 79200 && /Prezzo elevato: verificare/.test(cara.nota) && r2c.avvisi.some((a) => /Prezzo elevato \(79\.200 €\)/.test(a)), JSON.stringify(cara) + r2c.avvisi.join("|"));

    // ricerca web spenta
    const f3 = modelloFinto(() => toolUse("scegli_dotazioni", { non_in_catalogo: [{ descrizione: "Macchina speciale", motivo: "Richiesta" }] }));
    const r3 = await dimensionaMacchinari(base, [{ descrizione: "Macchina speciale" }], { anthropic: f3.client, cercaWeb: false });
    atteso("con la ricerca web spenta la dotazione fuori catalogo resta da compilare e il modello non cerca", f3.chiamate.length === 1 && !f3.chiamate.some(haRicercaWeb) && r3.macchinari.find((m) => /speciale/.test(m.descrizione))?.prezzoUnitario === null);

    // troppe dotazioni fuori catalogo: ricerche limitate
    const molte = Array.from({ length: 9 }, (_, i) => ({ descrizione: `Dotazione speciale numero ${i + 1}`, motivo: "Richiesta" }));
    const f4 = modelloFinto((p) => (haRicercaWeb(p) ? toolUse("registra_prezzo", { trovato: false }) : toolUse("scegli_dotazioni", { non_in_catalogo: molte })));
    const r4 = await dimensionaMacchinari(base, [{ descrizione: "Dotazioni" }], { anthropic: f4.client });
    atteso("le ricerche web sono limitate a 6 per gara; le altre sono righe da compilare e lo dice un avviso", f4.chiamate.filter(haRicercaWeb).length === 6 && r4.macchinari.filter((m) => m.categoria === "Dotazioni richieste dai documenti").length === 9 && r4.avvisi.some((a) => /limitate a 6/.test(a)));

    // il modello non risponde: valgono le regole di base
    const f5 = { messages: { stream: () => { throw new Error("rete assente"); } } } as unknown as Anthropic;
    const r5 = await dimensionaMacchinari(base, [{ descrizione: "Qualcosa" }], { anthropic: f5 });
    atteso("se la scelta col modello fallisce si va avanti con le regole di base e lo si segnala", r5.macchinari.length === r0.macchinari.length && r5.avvisi.some((a) => /scelta delle dotazioni .* non è riuscita \(rete assente\)/.test(a)), r5.avvisi.join(" | "));

    // una ricerca web che fallisce non butta via il resto
    const f6 = modelloFinto((p) => {
      if (haRicercaWeb(p)) throw new Error("timeout");
      return toolUse("scegli_dotazioni", { non_in_catalogo: [{ descrizione: "Macchina X", motivo: "Richiesta" }] });
    });
    const r6 = await dimensionaMacchinari(base, [{ descrizione: "Macchina X" }], { anthropic: f6.client });
    atteso("se la ricerca web di una dotazione fallisce, la riga resta da compilare e il resto del dimensionamento c'è", r6.macchinari.some((m) => /Macchina X/.test(m.descrizione) && m.prezzoUnitario === null) && r6.macchinari.length > 5 && r6.avvisi.some((a) => /Ricerca del prezzo di «Macchina X» non riuscita \(timeout\)/.test(a)), r6.avvisi.join(" | "));
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
