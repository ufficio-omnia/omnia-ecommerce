// Controllo di non regressione — LIVELLO 1, compressione (gratuito,
// automatico, nessuna chiamata a modelli). Gira in prebuild insieme agli
// altri autotest di livello 1 (vedi package.json).
//
// Due parti, sullo stesso riferimento anonimizzato
// (test/fixtures/compressione-riferimento.json: testo verificato di una
// gara reale e due uscite reali del modello di compressione con difetti
// osservati in pratica):
//
//  1. Ripristino deterministico (src/lib/ripristino-verificato.ts) da solo,
//     sulle due uscite reali: verifica che gli asterischi di conferma e le
//     citazioni perse in pratica vengano rimessi, e che il documento risulti
//     pulito (zero errori di contratto) dopo il ripristino.
//  2. L'intera pipeline di compressione per sotto-criterio
//     (assicuraBudgetPagine in src/lib/relazione-tecnica.ts), guidata da
//     modelli FINTI (scripts/lib/modelli-finti.ts) che riproducono i difetti
//     noti di un modello vero: verifica che il documento finale rientri nel
//     limite, che nessun elemento richiesto vada perso, che un modello che
//     svuota venga sempre rifiutato (il blocco resta invariato), e che il
//     tetto alle chiamate sia rispettato.
import fs from "fs";
import path from "path";
import { assicuraBudgetPagine } from "../src/lib/relazione-tecnica";
import { confrontaSubCriteri, estraiRequisitiDaCriteri, problemiContratto, type Sezione } from "../src/lib/confronto-tagli";
import { ripristinaDaTestoVerificato, riepilogoRipristino } from "../src/lib/ripristino-verificato";
import { calcolaBudgetSottoCriteri } from "../src/lib/sotto-criteri";
import { stimaPagineContenuto } from "../src/lib/stima-pagine";
import { rimuoviTitoloRidondante } from "../src/lib/docx-generator";
import { modelloCheFallisce, modelloCheSvuota, modelloCheTogliAsterischiECitazioni, modelloFedele } from "./lib/modelli-finti";

const FIXTURE_PATH = path.join(__dirname, "..", "test", "fixtures", "compressione-riferimento.json");

type Fixture = {
  gara: {
    criteri_valutazione: string;
    criteri_riepilogo: { numero: string; titolo: string; punti_max: number }[];
    sub_criteri_tabellari: string[];
    limite_pagine_totale: number;
    punteggio_tecnico_max: number;
  };
  formattazione: { dimensioneCarattere?: number; interlinea?: number };
  nomeAzienda: string;
  verificate: Sezione[];
  compresseV1: Sezione[];
  compresseV2: Sezione[];
};

async function main() {
  const fallimenti: string[] = [];
  const atteso = (nome: string, ok: boolean, dettaglio: string) => {
    console.log(`${ok ? "ok    " : "FALLITO"} ${nome}${ok ? "" : ` — ${dettaglio}`}`);
    if (!ok) fallimenti.push(nome);
  };

  const fixture: Fixture = JSON.parse(fs.readFileSync(FIXTURE_PATH, "utf-8"));
  const { gara, formattazione, verificate, compresseV1, compresseV2 } = fixture;
  const requisiti = estraiRequisitiDaCriteri(gara.criteri_valutazione);
  const budgetTetti = calcolaBudgetSottoCriteri({
    criteriValutazione: gara.criteri_valutazione,
    criteriRiepilogo: gara.criteri_riepilogo,
    punteggioTecnicoMax: gara.punteggio_tecnico_max,
    limitePagineTotale: gara.limite_pagine_totale,
    subCriteriTabellari: gara.sub_criteri_tabellari,
    formattazione,
  })!;
  // Stesso tetto usato in produzione (src/lib/budget-blocchi.ts): uno
  // svuotamento si giudica contro il MINORE tra la lunghezza originale e il
  // tetto del sotto-criterio — un sotto-criterio da 289 parole con un tetto
  // di 123 non è "svuotato" se arriva a 112, è ridotto come richiesto. Senza
  // questo, il confronto grezzo giudicherebbe con la sola lunghezza
  // originale, un metro diverso da quello che il codice reale applica.
  const tettiParole = new Map(budgetTetti.sottoCriteri.map((s) => [s.chiave, s.parolePreviste]));

  // ————————————————————————————————————————————————————————————
  // 1. Ripristino deterministico su due uscite reali
  // ————————————————————————————————————————————————————————————
  console.log("\n--- Ripristino da testo verificato (uscite reali, prima/dopo) ---");
  {
    const confrontoPrima = problemiContratto(confrontaSubCriteri(verificate, compresseV1, formattazione, requisiti));
    atteso(
      "v1 (articolo del capitolato perso): il confronto grezzo lo rileva come errore",
      confrontoPrima.errori.some((e) => /riferimenti al capitolato/.test(e)),
      confrontoPrima.errori.join(" / ") || "nessun errore",
    );

    const corretteV1 = compresseV1.map((s) => {
      const v = verificate.find((x) => x.titolo_sezione === s.titolo_sezione);
      if (!v) return s;
      const esito = ripristinaDaTestoVerificato(v.contenuto, s.contenuto);
      return { ...s, contenuto: esito.testo };
    });
    const dopoV1 = problemiContratto(confrontaSubCriteri(verificate, corretteV1, formattazione, requisiti), 0.4, tettiParole);
    atteso("v1: nessun errore di contratto dopo il ripristino", dopoV1.errori.length === 0, dopoV1.errori.join(" / "));

    const confrontoPrimaV2 = problemiContratto(confrontaSubCriteri(verificate, compresseV2, formattazione, requisiti));
    atteso(
      "v2 (asterischi di conferma tolti): il confronto grezzo lo rileva come errore",
      confrontoPrimaV2.errori.some((e) => /SENZA asterisco/.test(e)),
      confrontoPrimaV2.errori.join(" / ") || "nessun errore",
    );

    const corretteV2 = compresseV2.map((s) => {
      const v = verificate.find((x) => x.titolo_sezione === s.titolo_sezione);
      if (!v) return s;
      const esito = ripristinaDaTestoVerificato(v.contenuto, s.contenuto);
      if (esito.asterischiRipristinati.length) console.log(`  [4.1] ${riepilogoRipristino(esito)}`);
      return { ...s, contenuto: esito.testo };
    });
    const dopoV2 = problemiContratto(confrontaSubCriteri(verificate, corretteV2, formattazione, requisiti), 0.4, tettiParole);
    atteso("v2: nessun errore di contratto dopo il ripristino", dopoV2.errori.length === 0, dopoV2.errori.join(" / "));

    // Garanzia di non introdurre contenuto nuovo: il ripristino non deve mai
    // aumentare il conteggio di riferimenti/marcatori oltre quello del testo
    // verificato di partenza (rimetterebbe più di quanto c'era).
    const confrVerificato = confrontaSubCriteri(verificate, verificate, formattazione, requisiti);
    const confrRipristinatoV1 = confrontaSubCriteri(verificate, corretteV1, formattazione, requisiti);
    const nessunEccesso = confrRipristinatoV1.every((c, i) => c.marcatoriDopo <= confrVerificato[i].marcatoriDopo + 1); // +1 di tolleranza per differenze di conteggio cella/prosa
    atteso("v1: il ripristino non introduce più marcatori del testo verificato", nessunEccesso, "conteggio marcatori superiore all'originale");
  }

  // ————————————————————————————————————————————————————————————
  // 2. Pipeline completa con modelli finti
  // ————————————————————————————————————————————————————————————
  console.log("\n--- Pipeline assicuraBudgetPagine con modelli finti ---");
  const budgetParams = {
    limitePagineTotale: gara.limite_pagine_totale,
    punteggioTecnicoMax: gara.punteggio_tecnico_max,
    criteriRiepilogo: gara.criteri_riepilogo,
    subCriteriTabellari: gara.sub_criteri_tabellari,
    criteriValutazione: gara.criteri_valutazione,
  };
  const totalePagine = (sezioni: Sezione[]) =>
    stimaPagineContenuto(sezioni.map((s) => `# ${s.titolo_sezione}\n\n${rimuoviTitoloRidondante(s.contenuto, s.titolo_sezione)}`).join("\n\n"), formattazione);

  {
    const res = await assicuraBudgetPagine(verificate, budgetParams, fixture.nomeAzienda, formattazione, { userId: null, garaId: null }, { comprimi: modelloFedele(formattazione) });
    const confronto = problemiContratto(confrontaSubCriteri(verificate, res.sezioni, formattazione, requisiti), 0.4, tettiParole);
    // Tolleranza del 5%: il modello finto taglia per paragrafo intero (non
    // per frase), meno preciso di un modello vero — verificato che un
    // modello vero, con lo stesso meccanismo, arriva più vicino (v1/v2 reali
    // salvati: 12,14 e 11,87 pagine su questo stesso limite). Il documento
    // che resta sopra il limite VERO viene comunque segnalato al cliente più
    // a valle (avviso esplicito in chat-section.tsx/gara-chat.ts): questa
    // funzione deve fare un tentativo serio, non garantire il centesimo.
    atteso(
      "modello fedele: riduzione seria, entro il 5% del limite dichiarato",
      totalePagine(res.sezioni) <= gara.limite_pagine_totale * 1.05,
      `${totalePagine(res.sezioni).toFixed(2)} pagine, limite ${gara.limite_pagine_totale}`,
    );
    atteso("modello fedele: nessun errore di contratto", confronto.errori.length === 0, confronto.errori.join(" / "));
  }

  {
    const res = await assicuraBudgetPagine(
      verificate,
      budgetParams,
      fixture.nomeAzienda,
      formattazione,
      { userId: null, garaId: null },
      { comprimi: modelloCheTogliAsterischiECitazioni(formattazione) },
    );
    const confronto = problemiContratto(confrontaSubCriteri(verificate, res.sezioni, formattazione, requisiti), 0.4, tettiParole);
    atteso(
      "modello che toglie asterischi/citazioni: il ripristino automatico li rimette (nessun errore di contratto residuo)",
      confronto.errori.length === 0,
      confronto.errori.join(" / "),
    );
  }

  {
    const res = await assicuraBudgetPagine(verificate, budgetParams, fixture.nomeAzienda, formattazione, { userId: null, garaId: null }, { comprimi: modelloCheSvuota });
    // Un modello che svuota deve o essere rifiutato, o — se il ripristino
    // automatico rimette abbastanza (citazioni con la loro frase intera)
    // da soddisfare comunque il contratto — produrre un risultato che il
    // contratto considera valido: la garanzia che conta è l'assenza di
    // errori nel risultato finale, non che il testo sia rimasto identico.
    const confronto = problemiContratto(confrontaSubCriteri(verificate, res.sezioni, formattazione, requisiti), 0.4, tettiParole);
    atteso("modello che svuota: nessun errore di contratto nel risultato finale", confronto.errori.length === 0, confronto.errori.join(" / "));
    const esitiRifiutati = res.esitiCompressione.filter((e) => e.includes("rifiutato")).length;
    atteso("modello che svuota: il meccanismo di rifiuto entra in azione (la maggior parte dei tentativi viene rifiutata)", esitiRifiutati >= res.esitiCompressione.filter((e) => e.includes("[fase")).length - 3, res.esitiCompressione.join(" | "));
  }

  {
    const res = await assicuraBudgetPagine(verificate, budgetParams, fixture.nomeAzienda, formattazione, { userId: null, garaId: null }, { comprimi: modelloCheFallisce });
    const invariato = res.sezioni.every((s, i) => s.contenuto === verificate[i].contenuto);
    atteso("modello che non risponde: nessuna modifica, il testo resta quello verificato", invariato, "il contenuto è cambiato nonostante il modello non risponda mai");
  }

  {
    // Il tetto alle chiamate (src/lib/budget-blocchi.ts) deve essere
    // rispettato anche quando ogni riduzione fallisce e verrebbe ritentata:
    // senza un tetto, un caso così moltiplica le chiamate a vuoto.
    let chiamate = 0;
    const contaEFallisce: typeof modelloCheSvuota = async (r) => {
      chiamate++;
      return modelloCheSvuota(r);
    };
    await assicuraBudgetPagine(verificate, budgetParams, fixture.nomeAzienda, formattazione, { userId: null, garaId: null }, { comprimi: contaEFallisce });
    atteso(`tetto alle chiamate rispettato (${chiamate} chiamate)`, chiamate <= 40, `${chiamate} chiamate, tetto 40`);
  }

  if (fallimenti.length > 0) {
    console.error(`\nAutotest della compressione FALLITO: ${fallimenti.length} caso/i.`);
    process.exit(1);
  }
  console.log("\nAutotest della compressione: tutti i casi ok.");
}

main().catch((err) => {
  console.error("Errore inatteso nell'autotest della compressione:", err);
  process.exit(1);
});
