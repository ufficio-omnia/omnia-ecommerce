// Verifica di C2 (decisione dell'utente del 23/11: elenco dei CPV di ricerca della PVL al 95%, 60 codici; nota 49C, requisiti R1–R6).
// Nessuna rete, nessun database. Avvisi: quelli reali del campione (scripts/dati/radar-pvl-campione.json, solo campi pubblici) con il CPV
// di un lotto cambiato (DATI SINTETICI). Uso: npx tsx scripts/verifica-radar-c2-pvl.ts
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { analizzaCsvRicercaPvl, campiCsv, leggiCsvRicercaPvl } from "./lib/cpv-ricerca-pvl-csv";
import { CPV_RICERCA_PVL } from "../src/lib/radar/cpv-ricerca-pvl-dati";
import { CPV_SETTORI_OMNIA } from "../src/lib/radar/settori-dati";
import { vociCpv } from "../src/lib/radar/settori";
import { attribuzioneRicercaPvl, cpvDaDescrizione, cpvRicercaPvl, descrizioniDaRaccogliere, eCodiceDivisione, leggiAvvisoPvl, LIMITI_PVL_INTERVALLI, LIMITI_PVL_PREDEFINITI, LUNGHEZZA_DESCRIZIONE_RACCOLTA } from "../src/lib/radar/fonti/pvl-calcoli";
import { AVVISI_ANOMALI_PER_GIORNO, MASSIMO_DESCRIZIONI_RACCOLTE, misuraPerCodicePvl, statistichePvlVuote } from "../src/lib/radar/importa-pvl-calcoli";
import { datiGiroPvl, type RisultatoPvlPerRegistro } from "../src/lib/radar/esecuzioni-calcoli";
import { allarmiFonti, SOGLIE_ALLARMI, type RigaEsecuzioneLetta } from "../src/lib/radar/stato-fonti-calcoli";
import { misuraCodiciRicercaPvl } from "../src/lib/radar/ricerca-pvl-calcoli";

const falliti: string[] = [];
let ok = 0;
const atteso = (nome: string, cond: boolean, dettaglio?: unknown) => {
  if (cond) ok++;
  else {
    falliti.push(nome);
    console.log(`FALLITO ${nome}${dettaglio === undefined ? "" : ` → ${JSON.stringify(dettaglio).slice(0, 500)}`}`);
  }
};
const uguale = (nome: string, reale: unknown, previsto: unknown) => atteso(nome, JSON.stringify(reale) === JSON.stringify(previsto), { previsto, reale });
const lancia = (f: () => unknown): string => {
  try {
    f();
    return "";
  } catch (e) {
    return (e as Error).message;
  }
};

const RADICE = path.resolve(__dirname, "..");
const CSV = path.join(RADICE, "src/lib/radar/dati/cpv-ricerca-pvl.csv");
const FILE_56 = CPV_SETTORI_OMNIA.map((r) => r.cpv);

// ───── 1. il file dell'elenco: quello pubblicato con la nota 49C, generato in sincronia, separato dal file di classificazione ─────
uguale("elenco: identico a quello della nota 49C (sha256 99373885…8ba3)", crypto.createHash("sha256").update(fs.readFileSync(CSV)).digest("hex"), "99373885e76721dd3e3b6fe6c73276c5dbeacfdc039a62f06adfd569f49b8ba3");
uguale("file generato (cpv-ricerca-pvl-dati.ts) in sincronia con l'elenco: rilanciare scripts/genera-cpv-ricerca-pvl.ts se cambia", CPV_RICERCA_PVL, leggiCsvRicercaPvl(CSV, FILE_56));
const codici60 = CPV_RICERCA_PVL.map((r) => r.cpv);
uguale("elenco: 60 codici, tutti a 8 cifre, nessuno ripetuto", [codici60.length, new Set(codici60).size, codici60.every((c) => /^\d{8}$/.test(c))], [60, 60, true]);
uguale("R5 a: elenco ∩ file di classificazione = ∅", codici60.filter((c) => FILE_56.includes(c)), []);
uguale("R4: 14 codici ancora senza descrizione (da completare dal vocabolario CPV ufficiale)", CPV_RICERCA_PVL.filter((r) => !r.descrizione).map((r) => r.cpv), ["70330000", "77400000", "90743100", "90460000", "90913200", "98371111", "90915000", "79800000", "50760000", "65130000", "60300000", "92312100", "90640000", "50225000"]);
uguale("R3: i 5 codici di divisione (due cifre e sei zeri) sono quelli segnati nell'elenco", codici60.filter(eCodiceDivisione), CPV_RICERCA_PVL.filter((r) => /codice di divisione/.test(r.nota ?? "")).map((r) => r.cpv));
uguale("R3: i codici di divisione sono 55000000, 85000000, 50000000, 63000000, 79000000", codici60.filter(eCodiceDivisione), ["55000000", "85000000", "50000000", "63000000", "79000000"]);
uguale("campi tra virgolette (con «;» dentro) letti interi", [CPV_RICERCA_PVL.find((r) => r.cpv === "63000000")?.descrizione, CPV_RICERCA_PVL.find((r) => r.cpv === "85000000")?.nota?.endsWith("scelto dall'utente il 23/11")], ["Servizi di supporto e ausiliari nel campo dei trasporti; servizi di agenzie di viaggio", true]);

// ───── 2. R5 b: la ricerca usa l'unione dei 56 e dei 60, senza ripetizioni ─────
const ricerca = cpvRicercaPvl();
uguale("R5 b: ricerca = 56 del file, poi i 60 dell'elenco (116 codici, nessuno ripetuto)", [ricerca.length, new Set(ricerca).size, ricerca.slice(0, 56), ricerca.slice(56)], [116, 116, vociCpv().map((v) => v.cpv), codici60]);

// ───── 3. R5 d: un elenco malformato ferma generazione e prova ─────
const testo = fs.readFileSync(CSV, "utf8");
const righe = testo.split("\n");
const conRiga = (r: string) => [righe[0], r].join("\n");
const errori: [string, string, RegExp][] = [
  ["codice a 7 cifre", conRiga("8531100;Servizi;1;1;2026-11-23;"), /8 cifre/],
  ["codice ripetuto", [righe[0], righe[1], righe[1]].join("\n"), /ripetuto/],
  ["codice già nel file di classificazione", conRiga(`${FILE_56[0]};Già nel file;1;1;2026-11-23;`), /classificazione/],
  ["intestazione sbagliata", ["codice;descrizione;fascia;gare;data;nota", righe[1]].join("\n"), /Intestazione/],
  ["campi in più", conRiga("85311000;Servizi;1;1;2026-11-23;nota;altro"), /campi/],
  ["virgolette non chiuse", conRiga('85311000;"Servizi;1;1;2026-11-23;'), /Virgolette/],
  ["data non valida", conRiga("85311000;Servizi;1;1;23/11/2026;"), /data_aggiunta/],
  ["fascia non valida", conRiga("85311000;Servizi;x;1;2026-11-23;"), /Fascia/],
  ["elenco vuoto", righe[0], /vuoto/],
];
for (const [nome, t, motivo] of errori) {
  const m = lancia(() => analizzaCsvRicercaPvl(t, FILE_56));
  atteso(`R5 d: ${nome} → errore`, motivo.test(m), m);
}
uguale("CSV: virgolette doppie dentro un campo («\"\"»)", campiCsv('a;"b ""c"";d";e'), ["a", 'b "c";d', "e"]);

// ───── 4. R4 e R5 c: la classificazione NON cambia (il file di classificazione è lo stesso) ─────
atteso("R4: il classificatore non riconosce nessuna descrizione dell'elenco (cpvDaDescrizione resta sui 56 codici)", CPV_RICERCA_PVL.filter((r) => r.descrizione).every((r) => cpvDaDescrizione(r.descrizione) === null), CPV_RICERCA_PVL.filter((r) => r.descrizione && cpvDaDescrizione(r.descrizione) !== null).map((r) => r.cpv));
uguale("R5 c: il file di classificazione resta di 56 codici", CPV_SETTORI_OMNIA.length, 56);
const campione = JSON.parse(fs.readFileSync(path.join(RADICE, "scripts/dati/radar-pvl-campione.json"), "utf8")) as { avvisi: Record<string, unknown>[] };
const elementi = (a: Record<string, unknown>) => ((((a.templates as Record<string, unknown>[])[0].template as Record<string, unknown>).sections as Record<string, unknown>[]).find((s) => /^SEZ\.\s*C/.test(String(s.name)))!.items as Record<string, unknown>[]);
const con = (i: number, cambia: (a: Record<string, unknown>) => void) => {
  const a = structuredClone(campione.avvisi[i]);
  cambia(a);
  return a;
};
const nazionaleRistorazione = 5; // P2_16, «Servizi di ristorazione scolastica»
const metadati = (a: Record<string, unknown>) => ((a.templates as Record<string, unknown>[])[0].template as Record<string, unknown>).metadata as Record<string, unknown>;
const assistenza = con(nazionaleRistorazione, (a) => {
  for (const e of elementi(a)) { e.cpv = "Servizi di assistenza sociale con alloggio"; e.descrizione = "Gestione di una comunità alloggio per anziani"; }
  metadati(a).titolo = "Gestione di una comunità alloggio per anziani";
  metadati(a).descrizione = null;
});
const lettaAssistenza = leggiAvvisoPvl(assistenza);
uguale("R5 c: un avviso trovato solo con un codice dell'elenco e senza servizi dei settori resta fuori (decide il classificatore)", lettaAssistenza.tipo === "esclusione" ? lettaAssistenza.motivo : lettaAssistenza.tipo, "fuori_settore");
const assistenzaConMensa = con(nazionaleRistorazione, (a) => { elementi(a)[0].cpv = "Servizi di assistenza sociale con alloggio"; });
const lettaMensa = leggiAvvisoPvl(assistenzaConMensa);
uguale("R5 c: con il servizio di ristorazione nel testo la gara entra, nel suo settore, come prima", lettaMensa.tipo === "bando" ? [lettaMensa.settori, lettaMensa.livello] : lettaMensa, [["ristorazione"], "A"]);

// ───── 5. R2 e R4: attribuzione di un avviso ai codici dell'elenco ─────
uguale("attribuzione: CPV scritto come descrizione di un codice dell'elenco", attribuzioneRicercaPvl(assistenza), { codici: ["85311000"], delFile: false });
uguale("attribuzione: CPV del file di classificazione → nessun codice dell'elenco, «del file»", attribuzioneRicercaPvl(campione.avvisi[nazionaleRistorazione]), { codici: [], delFile: true });
uguale("attribuzione: codice scritto in cifre (anche con la cifra di controllo)", attribuzioneRicercaPvl(con(nazionaleRistorazione, (a) => { elementi(a)[0].cpv = "55000000-0 Servizi alberghieri"; })), { codici: ["55000000"], delFile: false });
uguale("attribuzione: più lotti con codici diversi → tutti, in ordine, senza ripetizioni", attribuzioneRicercaPvl(con(0, (a) => { const e = elementi(a); e[0].cpv = "Servizi cimiteriali"; e[1].cpv = "Servizi di assistenza sociale con alloggio"; e[2].cpv = "Servizi cimiteriali"; })), { codici: ["85311000", "98371110"], delFile: false });
uguale("attribuzione: tre codici in disordine nei lotti → in ordine crescente", attribuzioneRicercaPvl(con(0, (a) => { const e = elementi(a); e[0].cpv = "Servizi di assistenza sociale con alloggio"; e[1].cpv = "Servizi cimiteriali"; e[2].cpv = "Servizi di istruzione prescolastica"; })).codici, ["80110000", "85311000", "98371110"]);
uguale("attribuzione: un codice del FILE scritto in cifre non è un codice dell'elenco, ma è «del file»", attribuzioneRicercaPvl(con(nazionaleRistorazione, (a) => { elementi(a)[0].cpv = `${FILE_56[0]}-8 Servizi`; })), { codici: [], delFile: true });
uguale("attribuzione: descrizione sconosciuta (per esempio uno dei 14 codici senza descrizione) → nessun codice, mai indovinato", attribuzioneRicercaPvl(con(nazionaleRistorazione, (a) => { elementi(a)[0].cpv = "Servizi di sterilizzazione di biancheria"; })), { codici: [], delFile: false });

// ───── 6. R2: misura per codice di un giro ─────
const pagina = [assistenza, assistenzaConMensa, con(nazionaleRistorazione, (a) => { elementi(a)[0].cpv = "Servizi di sterilizzazione di biancheria"; }), campione.avvisi[nazionaleRistorazione], campione.avvisi[9]];
const stat = statistichePvlVuote();
misuraPerCodicePvl(stat.avvisi, pagina, pagina.map(leggiAvvisoPvl));
uguale("R2: per codice letti, ammessi con il livello, fuori settore; i non attribuiti a parte; gli avvisi dei 56 codici non si contano", [stat.avvisi.perCodice, stat.avvisi.nonAttribuiti], [{ "85311000": { letti: 2, bandi: 1, a: 1, b: 0, fuori_settore: 1 } }, 1]);
const giro = datiGiroPvl({ eseguita: true, modo: "incrementale", giroFinito: true, sospesa: false, errore: null, statistiche: { ...stat, db: { richiesteDb: 0, msDb: 0 } }, cursore: {}, letta: { da: "2026-11-21", a: "2026-11-23", pagine: 1 } } as unknown as RisultatoPvlPerRegistro);
uguale("R2: il registro dei giri porta la misura per codice e i non attribuiti", [(giro?.avvisi as Record<string, unknown>)?.per_codice, (giro?.avvisi as Record<string, unknown>)?.non_attribuiti], [stat.avvisi.perCodice, 1]);

// ───── 7. R1 e R3: allarmi ─────
const ADESSO = new Date("2026-11-23T17:30:00Z");
const riga = (oreFa: number, p: { pagine?: number; dichiarati?: number; da?: string; a?: string; perCodice?: Record<string, unknown>; modo?: string } = {}): RigaEsecuzioneLetta => ({
  fonte: "pvl", modo: p.modo ?? "incrementale", iniziato_il: new Date(ADESSO.getTime() - oreFa * 3_600_000).toISOString(), finito_il: new Date(ADESSO.getTime() - oreFa * 3_600_000 + 20_000).toISOString(),
  esito: "ok", finestre: { da: p.da ?? "2026-11-21", a: p.a ?? "2026-11-23", pagine: p.pagine ?? 1, dichiarati: p.dichiarati ?? 60 }, fonte_richieste: 1, db_richieste: 5,
  avvisi: { letti: 60, bandi: 3, per_codice: p.perCodice ?? {} }, gare_nuove: 1, allarmi: [], errore: null,
} as RigaEsecuzioneLetta);
const STATO = [{ fonte: "pvl", attiva: true, ultimo_avvio_il: null, ultimo_successo_il: ADESSO.toISOString(), ultimo_errore_il: null, conteggi: null }];
const codiciAllarme = (righe: RigaEsecuzioneLetta[]) => (allarmiFonti(righe, STATO as never, ADESSO).find((s) => s.fonte === "pvl")?.allarmi ?? []).map((a) => a.codice).filter((c) => ["pagine_oltre_soglia", "pagine_ripetute", "conteggio_alto", "divisione_alta"].includes(c)).sort();
uguale("R1: soglie (2 pagine, 5 giri, 250 al giorno; R3 10 al giorno); sospensione automatica ancora a 400", [SOGLIE_ALLARMI.paginePerGiro, SOGLIE_ALLARMI.giriPagineRipetute, SOGLIE_ALLARMI.avvisiPerGiornoFinestra, SOGLIE_ALLARMI.divisioneAvvisiPerGiorno, AVVISI_ANOMALI_PER_GIORNO], [2, 5, 250, 10, 400]);
uguale("R1: un giro con 3 pagine → «pagine_oltre_soglia»; con 2 → nulla", [codiciAllarme([riga(1, { pagine: 3 })]), codiciAllarme([riga(1, { pagine: 2 })])], [["pagine_oltre_soglia"], []]);
uguale("R1: 5 giri di fila oltre 1 pagina → «pagine_ripetute»; 4 su 5 → nulla", [codiciAllarme([1, 6, 11, 25, 30].map((h) => riga(h, { pagine: 2 }))), codiciAllarme([riga(1, { pagine: 2 }), riga(6, { pagine: 2 }), riga(11, { pagine: 1 }), riga(25, { pagine: 2 }), riga(30, { pagine: 2 })])], [["pagine_ripetute"], []]);
uguale("R1: 760 avvisi dichiarati in 3 giorni (253 al giorno) → «conteggio_alto»; 750 (250) → nulla", [codiciAllarme([riga(1, { dichiarati: 760 })]), codiciAllarme([riga(1, { dichiarati: 750 })])], [["conteggio_alto"], []]);
uguale("R1: i giri di recupero non contano (pagine e conteggio sono quelli del giro normale)", codiciAllarme([riga(1, { modo: "recupero", pagine: 5, dichiarati: 5000 }), riga(6, { pagine: 1 })]), []);
uguale("R3: un codice di divisione con 31 avvisi in 3 giorni → «divisione_alta»; 30 → nulla; un codice normale con 100 → nulla",
  [codiciAllarme([riga(1, { perCodice: { "55000000": { letti: 31 } } })]), codiciAllarme([riga(1, { perCodice: { "55000000": { letti: 30 } } })]), codiciAllarme([riga(1, { perCodice: { "85311000": { letti: 100 } } })])], [["divisione_alta"], [], []]);
const dettagliDivisione = allarmiFonti([riga(1, { perCodice: { "85000000": { letti: 40 }, "55000000": { letti: 50 } } })], STATO as never, ADESSO).find((s) => s.fonte === "pvl")?.allarmi.find((a) => a.codice === "divisione_alta")?.dettagli;
uguale("R3: l'allarme elenca i codici di divisione oltre soglia, in ordine", dettagliDivisione, { codici: ["55000000", "85000000"] });

// ───── 8. R2: misura su 4 settimane per la potatura (la decide l'utente, mai automatica) ─────
const rigaMisura = (giorniFa: number, perCodice: Record<string, unknown>, nonAttribuiti = 0) => ({ fonte: "pvl", esito: "ok", iniziato_il: new Date(ADESSO.getTime() - giorniFa * 86_400_000).toISOString(), avvisi: { per_codice: perCodice, non_attribuiti: nonAttribuiti } });
const misura = misuraCodiciRicercaPvl([
  rigaMisura(29, { "98371110": { letti: 40 } }), // più vecchia di 4 settimane: rende la misura completa, ma non si somma
  rigaMisura(20, { "98371110": { letti: 30 }, "80110000": { letti: 51 }, "85311000": { letti: 60, bandi: 1, a: 0, b: 1 }, "75251110": { letti: 50 } }, 2),
  rigaMisura(5, { "98371110": { letti: 21 }, "99999999": { letti: 500 } }, 1),
  { fonte: "ted", esito: "ok", iniziato_il: ADESSO.toISOString(), avvisi: { per_codice: { "80110000": { letti: 999 } } } },
], ADESSO);
const di = (c: string) => misura.codici.find((x) => x.cpv === c);
uguale("R2: somme degli ultimi 28 giorni, solo PVL, solo codici dell'elenco; tutti i 60 codici nella tabella", [misura.completa, misura.giri, misura.nonAttribuiti, misura.codici.length, di("98371110")?.letti, di("80110000")?.letti, di("85311000")?.b], [true, 2, 3, 60, 51, 51, 1]);
uguale("R2: da valutare SOLO i codici con 0 gare A o B e PIÙ di 50 avvisi letti (50 esatti no)", [misura.daValutare, di("75251110")?.letti], [["80110000", "98371110"], 50]);
uguale("R3: i codici di divisione sono segnati a parte nella tabella", misura.codici.filter((c) => c.divisione).map((c) => c.cpv), ["55000000", "85000000", "50000000", "63000000", "79000000"]);
const incompleta = misuraCodiciRicercaPvl([rigaMisura(10, { "80110000": { letti: 300 } })], ADESSO);
uguale("R2: prima delle 4 settimane nessun codice da valutare", [incompleta.completa, incompleta.daValutare, incompleta.codici.find((c) => c.cpv === "80110000")?.letti], [false, [], 300]);

// ───── 10. R4 (decisione dell'utente del 23/11, «Dagli avvisi PVL nel collaudo»): raccolta delle descrizioni mancanti, solo testo del CPV ─────
const conCpv = (...cpv: string[]) => con(0, (a) => { const e = elementi(a); cpv.forEach((c, i) => { e[i].cpv = c; }); for (let i = cpv.length; i < e.length; i++) e[i].cpv = cpv[0]; });
uguale("R4: «codice_descrizione» di un codice ancora senza descrizione → coppia certa; l'avviso si attribuisce al codice",
  [descrizioniDaRaccogliere(conCpv("90460000_Servizi di pulizia di pozzi neri")), attribuzioneRicercaPvl(conCpv("90460000_Servizi di pulizia di pozzi neri")).codici], [{ coppie: { "90460000": "Servizi di pulizia di pozzi neri" }, sconosciute: [] }, ["90460000"]]);
uguale("R4: anche «codice-cifra testo» e «codice - testo»",
  [descrizioniDaRaccogliere(conCpv("90460000-6 Servizi di pulizia di pozzi neri")).coppie, descrizioniDaRaccogliere(conCpv("90460000 - Servizi di pulizia di pozzi neri")).coppie], [{ "90460000": "Servizi di pulizia di pozzi neri" }, { "90460000": "Servizi di pulizia di pozzi neri" }]);
uguale("R4: nessuna coppia per un codice che ha già la descrizione, per un codice del file, per il solo codice senza testo",
  [descrizioniDaRaccogliere(conCpv("85311000_Servizi di assistenza sociale con alloggio")), descrizioniDaRaccogliere(conCpv("90911200_Servizi di pulizia di edifici")), descrizioniDaRaccogliere(conCpv("90460000"))],
  [{ coppie: {}, sconosciute: [] }, { coppie: {}, sconosciute: [] }, { coppie: {}, sconosciute: [] }]);
uguale("R4: descrizione non riconosciuta → sconosciuta (il codice non si indovina); descrizioni note del file o dell'elenco → niente",
  [descrizioniDaRaccogliere(conCpv("Servizi di sgombero neve")).sconosciute, descrizioniDaRaccogliere(conCpv("Servizi di pulizia di edifici")).sconosciute, descrizioniDaRaccogliere(conCpv("Servizi cimiteriali")).sconosciute], [["Servizi di sgombero neve"], [], []]);
const statR4 = statistichePvlVuote();
const paginaR4 = [conCpv("90460000_Servizi di pulizia di pozzi neri"), conCpv("Servizi di sgombero neve"), conCpv("Servizi di sgombero neve"), conCpv("Servizi cimiteriali", "Servizi di sgombero neve")];
misuraPerCodicePvl(statR4.avvisi, paginaR4, paginaR4.map(leggiAvvisoPvl));
uguale("R4: nel giro le coppie da qualunque avviso, le sconosciute SOLO dagli avvisi non attribuiti (con quante volte)",
  [statR4.avvisi.descrizioniDaCompletare, statR4.avvisi.descrizioniSconosciute, statR4.avvisi.nonAttribuiti, statR4.avvisi.perCodice["90460000"]?.letti, statR4.avvisi.perCodice["98371110"]?.letti],
  [{ "90460000": "Servizi di pulizia di pozzi neri" }, { "Servizi di sgombero neve": 2 }, 2, 1, 1]);
const testoRegistro = JSON.stringify([statR4.avvisi.descrizioniDaCompletare, statR4.avvisi.descrizioniSconosciute]);
const datiGara = paginaR4.flatMap((a) => [...elementi(a).map((e) => String(e.cig ?? "")), String(metadati(a).titolo ?? ""), String(metadati(a).descrizione ?? "")]).filter((x) => x.length > 5);
atteso("R4: nel registro solo il testo del CPV, nessun dato della gara (CIG, titolo, descrizione)", datiGara.length > 0 && datiGara.every((x) => !testoRegistro.includes(x)), testoRegistro);
const statLimiti = statistichePvlVuote();
const tante = Array.from({ length: 60 }, (_, i) => conCpv(`Servizio sconosciuto numero ${i} ${"x".repeat(i === 0 ? 300 : 0)}`));
misuraPerCodicePvl(statLimiti.avvisi, tante, tante.map(leggiAvvisoPvl));
uguale("R4: al più 50 descrizioni per giro, ciascuna al più di 200 caratteri", [Object.keys(statLimiti.avvisi.descrizioniSconosciute).length, Math.max(...Object.keys(statLimiti.avvisi.descrizioniSconosciute).map((t) => t.length)), MASSIMO_DESCRIZIONI_RACCOLTE, LUNGHEZZA_DESCRIZIONE_RACCOLTA], [50, 200, 50, 200]);
const giroR4 = datiGiroPvl({ eseguita: true, modo: "incrementale", giroFinito: true, sospesa: false, errore: null, statistiche: { ...statR4, db: { richiesteDb: 0, msDb: 0 } }, cursore: {}, letta: { da: "2026-11-21", a: "2026-11-23", pagine: 1 } } as unknown as RisultatoPvlPerRegistro);
const avvisiGiro = (g: unknown) => (g as { avvisi: Record<string, unknown> }).avvisi;
const giroVuoto = datiGiroPvl({ eseguita: true, modo: "incrementale", giroFinito: true, sospesa: false, errore: null, statistiche: { ...statistichePvlVuote(), db: { richiesteDb: 0, msDb: 0 } }, cursore: {}, letta: { da: "2026-11-21", a: "2026-11-23", pagine: 1 } } as unknown as RisultatoPvlPerRegistro);
uguale("R4: il registro dei giri porta le due raccolte solo se ci sono", [avvisiGiro(giroR4).descrizioni_da_completare, avvisiGiro(giroR4).descrizioni_sconosciute, "descrizioni_da_completare" in avvisiGiro(giroVuoto), "descrizioni_sconosciute" in avvisiGiro(giroVuoto)],
  [{ "90460000": "Servizi di pulizia di pozzi neri" }, { "Servizi di sgombero neve": 2 }, false, false]);
const misuraR4 = misuraCodiciRicercaPvl([
  { fonte: "pvl", esito: "ok", iniziato_il: "2026-11-20T08:00:00Z", avvisi: { per_codice: {}, descrizioni_da_completare: { "90460000": "Prima vista", "85311000": "Già nel file" }, descrizioni_sconosciute: { "Servizi di sgombero neve": 1, "Altro": 3 } } },
  { fonte: "pvl", esito: "ok", iniziato_il: "2026-11-22T08:00:00Z", avvisi: { per_codice: {}, descrizioni_da_completare: { "90460000": "Vista dopo", "50225000": "Servizi di manutenzione" }, descrizioni_sconosciute: { "Servizi di sgombero neve": 4 } } },
], ADESSO);
uguale("R4: per la console la prima coppia vista per ogni codice ancora senza descrizione; le sconosciute sommate, dalla più frequente",
  [misuraR4.descrizioniDaCompletare, misuraR4.descrizioniSconosciute], [{ "90460000": "Prima vista", "50225000": "Servizi di manutenzione" }, [{ testo: "Servizi di sgombero neve", volte: 5 }, { testo: "Altro", volte: 3 }]]);

// ───── 9. R6: regole verso la fonte invariate ─────
uguale("R6: limiti predefiniti della PVL invariati (100 avvisi per pagina, pausa 3 s, 30 s, 2 tentativi, tetto 20 richieste per giro)", LIMITI_PVL_PREDEFINITI, { avvisiPerPagina: 100, pausaMs: 3_000, timeoutMs: 30_000, tentativi: 2, richiesteMassime: 20 });
uguale("R6: intervalli della console invariati", LIMITI_PVL_INTERVALLI, { avvisiPerPagina: { min: 10, max: 100 }, pausaMs: { min: 2_000, max: 60_000 }, timeoutMs: { min: 5_000, max: 60_000 }, tentativi: { min: 1, max: 3 }, richiesteMassime: { min: 1, max: 60 } });

console.log(`Verifica C2 PVL (elenco dei CPV di ricerca): ${ok} ok, ${falliti.length} falliti`);
process.exit(falliti.length ? 1 : 0);
