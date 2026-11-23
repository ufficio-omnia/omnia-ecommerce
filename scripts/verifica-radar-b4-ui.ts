// Verifica della fase B4, gradi 1 e 2 (B1): «Per te», profilo di ricerca, Opportunità per l'Ufficio Gare, interruttori.
// Decisioni dell'utente del 19/11/2026 (26 e approvazione definitiva). Nessuna rete (trappola come nella verifica B3), nessun database: la
// ricerca vera gira su un client FINTO che registra le richieste e restituisce righe SINTETICHE. Mutazioni: scripts/mutazioni-radar-b4-ui.mjs.
import fs from "node:fs";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cercaGare } from "../src/lib/radar/ricerca";
import { filtriDaParametri } from "../src/lib/radar/ricerca-calcoli";
import { INTERRUTTORI_B4, interruttoreB4, perTeAttivo, preferenzeNotificheAttive, ufficioGareRadarAttivo } from "../src/lib/radar/interruttori-b4";
import {
  POSIZIONE_PROFILO,
  condizioneRegioniOSenzaLuogo,
  filtriDaProfilo,
  garaPerRadarDaRiga,
  importoDaTesto,
  inputProfiloDaModulo,
  motivoPerTe,
  ordinaEPaginaDaParametri,
  parametriPerTe,
  pertinentiPrima,
  profiloDaRiga,
  profiloVuoto,
  rigaDaValori,
  soloSettori,
  validaProfiloRadar,
  type InputProfilo,
} from "../src/lib/radar/profilo-calcoli";
import { chiHaSalvato } from "../src/lib/radar/salvate-calcoli";
import { AZIONI_RADAR, AZIONI_SOLO_STATISTICA } from "../src/lib/radar/diritto-calcoli";
import { percorsoConsentito, RADICE_AREA } from "../src/lib/omnia-ai-account-calcoli";
import type { ProfiloRadar } from "../src/lib/radar/radar-personalizzato-contratto";

const richiesteEsterne: string[] = [];
const fetchVero = globalThis.fetch;
globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
  const host = new URL(url instanceof Request ? url.url : String(url)).hostname;
  if (!["localhost", "127.0.0.1", "[::1]", "::1"].includes(host)) {
    richiesteEsterne.push(host);
    throw new Error(`verifica B4: richiesta di rete vietata verso ${host}`);
  }
  return fetchVero(url, init);
}) as typeof fetch;

const RADICE = path.resolve(__dirname, "..");
const leggi = (p: string) => fs.readFileSync(path.join(RADICE, p), "utf8");
const fallimenti: string[] = [];
function atteso(nome: string, ok: boolean, dettaglio = "") {
  console.log(`${ok ? "ok    " : "FALLITO"} ${nome}${ok || !dettaglio ? "" : ` — ${dettaglio}`}`);
  if (!ok) fallimenti.push(nome);
}
function uguale(nome: string, ottenuto: unknown, atteso_: unknown) {
  atteso(nome, JSON.stringify(ottenuto) === JSON.stringify(atteso_), `ottenuto ${JSON.stringify(ottenuto)}`);
}

const STAGING = "https://ryawdldqiumqsskrnyps.supabase.co";
const PRODUZIONE = "https://bihfrzspqxsrzlbqqvqa.supabase.co";
const IMPRESA = "00000000-0000-4000-a000-00000000a1fa";
const UFFICIO = "00000000-0000-4000-a000-0000000a1fa2";

// ───── I. Interruttori: solo «attivo» e solo con lo staging ─────

for (const nome of INTERRUTTORI_B4) {
  atteso(`I1 ${nome}: acceso con «attivo» sullo staging`, interruttoreB4(nome, { [nome]: "attivo", NEXT_PUBLIC_SUPABASE_URL: STAGING }));
  atteso(`I2 ${nome}: spento in produzione anche con «attivo»`, !interruttoreB4(nome, { [nome]: "attivo", NEXT_PUBLIC_SUPABASE_URL: PRODUZIONE }));
  atteso(`I3 ${nome}: spento con un database sconosciuto`, !interruttoreB4(nome, { [nome]: "attivo", NEXT_PUBLIC_SUPABASE_URL: "https://altro.supabase.co" }));
  for (const valore of ["1", "true", "ATTIVO", " attivo", "attivo ", "acceso", ""]) {
    atteso(`I4 ${nome}: spento con «${valore}»`, !interruttoreB4(nome, { [nome]: valore, NEXT_PUBLIC_SUPABASE_URL: STAGING }));
  }
  atteso(`I5 ${nome}: spento di base`, !interruttoreB4(nome, { NEXT_PUBLIC_SUPABASE_URL: STAGING }));
}
atteso("I6 ogni interruttore legge solo il proprio nome", perTeAttivo({ RADAR_PER_TE: "attivo", NEXT_PUBLIC_SUPABASE_URL: STAGING }) && !ufficioGareRadarAttivo({ RADAR_PER_TE: "attivo", NEXT_PUBLIC_SUPABASE_URL: STAGING }) && !preferenzeNotificheAttive({ RADAR_PER_TE: "attivo", NEXT_PUBLIC_SUPABASE_URL: STAGING }));

// ───── P. Profilo: validazione sul catalogo, riga, lettura ─────

const vuotoInput: InputProfilo = { settori: [], sottocategorie: [], regioni: [], procedure: [], importoMin: "", importoMax: "", vedereCorrelate: false };
const valido = validaProfiloRadar({
  ...vuotoInput,
  settori: ["ristorazione", "pulizia", "pulizia"],
  sottocategorie: ["pulizia:sanificazione", "pulizia:pulizia_edifici", "pulizia:sanificazione"],
  regioni: ["veneto", "lombardia"],
  procedure: ["negoziata", "aperta"],
  importoMin: "1.250.000",
  importoMax: "€ 5 000 000",
  vedereCorrelate: true,
});
uguale(
  "P1 profilo valido: ordine stabile del catalogo, niente doppioni, importi in cifre",
  valido,
  {
    ok: true,
    valori: { settori: ["pulizia", "ristorazione"], sottocategorie: { pulizia: ["pulizia_edifici", "sanificazione"] }, regioni: ["lombardia", "veneto"], procedure: ["aperta", "negoziata"], importoMin: 1250000, importoMax: 5000000, vedereCorrelate: true },
    avvisi: [],
  },
);
const errore = (i: Partial<InputProfilo>) => {
  const e = validaProfiloRadar({ ...vuotoInput, ...i });
  return e.ok ? "" : e.errore;
};
atteso("P2 settore fuori catalogo: errore", errore({ settori: ["edilizia"] }) === "Settore non valido.");
atteso("P2 regione fuori catalogo: errore", errore({ settori: ["pulizia"], regioni: ["atlantide"] }) === "Regione non valida.");
atteso("P2 procedura fuori catalogo: errore", errore({ settori: ["pulizia"], procedure: ["segreta"] }) === "Procedura non valida.");
atteso("P2 sottocategoria malformata: errore", errore({ settori: ["pulizia"], sottocategorie: ["sanificazione"] }) === "Sottocategoria non valida." && errore({ settori: ["pulizia"], sottocategorie: ["pulizia:a:b"] }) === "Sottocategoria non valida.");
atteso("P2 sottocategoria fuori catalogo: errore", errore({ settori: ["pulizia"], sottocategorie: ["pulizia:inventata"] }) === "Sottocategoria non valida.");
atteso("P2 settore sconosciuto nelle sottocategorie: errore", errore({ settori: ["pulizia"], sottocategorie: ["edilizia:x"] }) === "Sottocategoria non valida.");
const settoreTolto = validaProfiloRadar({ ...vuotoInput, settori: ["pulizia"], sottocategorie: ["ristorazione:mense", "pulizia:sanificazione"] });
atteso("P3 sottocategorie di un settore non scelto: lasciate cadere con un avviso", settoreTolto.ok && JSON.stringify(settoreTolto.valori.sottocategorie) === '{"pulizia":["sanificazione"]}' && settoreTolto.avvisi.length === 1);
atteso("P4 importo non valido: errore", errore({ settori: ["pulizia"], importoMin: "dieci" }).startsWith("Importo non valido") && errore({ settori: ["pulizia"], importoMin: "-5" }).startsWith("Importo non valido"));
atteso("P4 minimo oltre il massimo: errore", errore({ settori: ["pulizia"], importoMin: "500000", importoMax: "100000" }) === "L'importo minimo supera il massimo.");
uguale("P5 importoDaTesto", ["", "150000", "1.250.000,50", "12a", "1e9"].map(importoDaTesto), [null, 150000, 1250000.5, undefined, undefined]);
atteso("P6 profilo senza settori ammesso (profilo vuoto = nessuna ricerca)", validaProfiloRadar(vuotoInput).ok && profiloVuoto({ settori: [] }) && profiloVuoto(null) && !profiloVuoto({ settori: ["pulizia"] }));
if (valido.ok) {
  const riga = rigaDaValori(valido.valori, IMPRESA, UFFICIO, "2026-11-19T10:00:00.000Z");
  atteso("P7 la riga porta impresa e autore passati dal server, posizione 1", riga.user_id === IMPRESA && riga.aggiornato_da === UFFICIO && riga.posizione === POSIZIONE_PROFILO && riga.aggiornato_il === "2026-11-19T10:00:00.000Z");
  uguale("P7 la riga ha solo le colonne della 0122", Object.keys(riga).sort(), ["aggiornato_da", "aggiornato_il", "importo_max", "importo_min", "posizione", "regioni", "settori", "sottocategorie", "tipi_procedura", "user_id", "vedere_correlate"]);
}
const fd = new FormData();
for (const [k, v] of [["settore", "pulizia"], ["sottocategoria", "pulizia:sanificazione"], ["regione", "lombardia"], ["procedura", "aperta"], ["min", "100"], ["max", ""], ["correlate", "si"], ["impresa", "ALTRA"], ["user_id", "ALTRO"]]) fd.append(k, v);
uguale("P8 dal modulo: solo i campi del profilo (impresa e utente del modulo ignorati)", inputProfiloDaModulo(fd), { settori: ["pulizia"], sottocategorie: ["pulizia:sanificazione"], regioni: ["lombardia"], procedure: ["aperta"], importoMin: "100", importoMax: "", vedereCorrelate: true });
const letto = profiloDaRiga(
  { user_id: IMPRESA, posizione: 1, settori: ["pulizia", "edilizia"], sottocategorie: { pulizia: ["sanificazione", "inventata"], ristorazione: ["mense"] }, regioni: ["lombardia", "atlantide"], tipi_procedura: ["aperta", "segreta"], importo_min: "200000", importo_max: "100000", vedere_correlate: null, aggiornato_il: null },
  IMPRESA,
);
uguale(
  "P9 in lettura il profilo si ripulisce sul catalogo (e un massimo sotto il minimo non restringe)",
  letto,
  { impresaId: IMPRESA, settori: ["pulizia"], sottocategorie: { pulizia: ["sanificazione"] }, regioni: ["lombardia"], procedure: ["aperta"], importoMin: 200000, importoMax: null, vedereCorrelate: false, aggiornatoIl: null },
);
atteso("P10 la riga di un'altra impresa non diventa il profilo di questa", profiloDaRiga({ user_id: UFFICIO, posizione: 1, settori: ["pulizia"], sottocategorie: {}, regioni: [], tipi_procedura: [], importo_min: null, importo_max: null, vedere_correlate: false, aggiornato_il: null }, IMPRESA) === null);

// ───── F. Profilo → filtri della ricerca ─────

const PROFILO: ProfiloRadar = { impresaId: IMPRESA, settori: ["pulizia"], sottocategorie: { pulizia: ["sanificazione"] }, procedure: ["aperta"], regioni: ["lombardia"], importoMin: 100000, importoMax: null, vedereCorrelate: false };
uguale("F1 filtri dal profilo: solo aperte, nessun testo né date", filtriDaProfilo(PROFILO, "scadenza", 2), { q: "", settori: ["pulizia"], regioni: ["lombardia"], importoMin: 100000, importoMax: null, scadenzaEntroGiorni: null, pubblicataNegliUltimiGiorni: null, procedure: ["aperta"], tipi: [], stato: "aperte", ordina: "scadenza", pagina: 2 });
uguale("F2 regioni: del profilo OPPURE luogo non indicato", condizioneRegioniOSenzaLuogo(["lombardia", "veneto"]), "luogo_regioni.ov.{lombardia,veneto},luogo_regioni.eq.{}");
uguale("F2 regioni non valide (anche tentativi di iniezione) non entrano nella condizione", condizioneRegioniOSenzaLuogo(["lombardia}),stato.eq.chiusa", "lombardia"]), "luogo_regioni.ov.{lombardia},luogo_regioni.eq.{}");
uguale("F3 in memoria solo settori e sottocategorie (regioni, procedure, importi li fa il database)", soloSettori(PROFILO), { ...PROFILO, regioni: [], procedure: [], importoMin: null, importoMax: null });
uguale("F4 ordinamento e pagina dall'indirizzo, con i limiti", [ordinaEPaginaDaParametri({ ordina: "importo", pagina: "3" }), ordinaEPaginaDaParametri({ ordina: "x", pagina: "999" }), ordinaEPaginaDaParametri({})], [{ ordina: "importo", pagina: 3 }, { ordina: "rilevanza", pagina: 1 }, { ordina: "rilevanza", pagina: 1 }]);
uguale("F5 indirizzo di «Per te»", [parametriPerTe("rilevanza", 1), parametriPerTe("recenti", 2)], ["", "?ordina=recenti&pagina=2"]);

// ───── R. Comportamento della ricerca vera su un client finto con righe sintetiche ─────

type Chiamata = { tabella: string; passi: { metodo: string; argomenti: unknown[] }[] };
function clienteFinto(chiamate: Chiamata[], righe: unknown[]): SupabaseClient {
  const costruttore = (c: Chiamata): unknown =>
    new Proxy(
      {},
      {
        get(_t, nome: string) {
          if (nome === "then") return (risolvi: (v: unknown) => void) => risolvi({ data: righe, error: null });
          return (...argomenti: unknown[]) => {
            c.passi.push({ metodo: nome, argomenti });
            return costruttore(c);
          };
        },
      },
    );
  return {
    from(tabella: string) {
      const c: Chiamata = { tabella, passi: [] };
      chiamate.push(c);
      return costruttore(c);
    },
  } as unknown as SupabaseClient;
}
const fontiNascoste = async () => ["sardegnacat"];
const adesso = new Date("2026-11-19T10:00:00Z");

type RigaFinta = Record<string, unknown>;
let progressivo = 0;
function riga(campi: { settore?: string; rilevanza?: "A" | "B" | "C"; sotto?: string[]; regioni?: string[]; stato?: "classificata" | "in_attesa" | "fallita" | null; attiva?: boolean; unitaA?: string | null; pubblicata?: string; altre?: { settore: string; rilevanza: "A" | "B" | "C"; sotto?: string[] }[] }): RigaFinta {
  progressivo++;
  const id = `00000000-0000-4000-b000-${String(progressivo).padStart(12, "0")}`;
  const settore = campi.settore ?? "pulizia";
  return {
    id,
    oggetto: `Gara sintetica ${progressivo}`,
    oggetto_breve: null,
    sa_denominazione: "Ente sintetico",
    sa_comune: null,
    sa_provincia: null,
    settori: [settore],
    metodo_settore: "cpv",
    scadenza_giorno: "2026-12-10",
    scadenza_offerte: null,
    scadenza_ora_indicata: false,
    data_pubblicazione: campi.pubblicata ?? `2026-11-${String(1 + (progressivo % 18)).padStart(2, "0")}`,
    valore_stimato: "200000",
    durata_mesi: null,
    n_lotti: 1,
    stato: "aperta",
    rettificata: false,
    luogo_regioni: campi.regioni ?? ["lombardia"],
    tipo_procedura: "Procedura aperta",
    ultima_rilevazione_il: "2026-11-19T07:00:00Z",
    cpv_principale: null,
    unita_a: campi.unitaA ?? null,
    classificazione_stato: campi.stato === null ? null : { stato: campi.stato ?? "classificata" },
    classificazioni: [
      { settore, rilevanza: campi.rilevanza ?? "A", sottocategorie: campi.sotto ?? ["sanificazione"], attiva: campi.attiva ?? true },
      ...(campi.altre ?? []).map((a) => ({ settore: a.settore, rilevanza: a.rilevanza, sottocategorie: a.sotto ?? [], attiva: true })),
    ],
  };
}

async function provaRicerca() {
  progressivo = 0;
  const A = riga({});
  const senzaLuogo = riga({ regioni: [] });
  const C = riga({ rilevanza: "C", sotto: [] });
  const B = riga({ rilevanza: "B", sotto: ["sanificazione"], pubblicata: "2026-11-30" });
  const altraSottocategoria = riga({ sotto: ["disinfestazione"] });
  const nonClassificata = riga({ stato: null });
  const inAttesa = riga({ stato: "in_attesa" });
  const rigaSpenta = riga({ attiva: false });
  const copia = riga({ unitaA: "00000000-0000-4000-b000-000000009999" });
  const pertinenteAltroSettore = riga({ settore: "pulizia", rilevanza: "C", sotto: [], altre: [{ settore: "ristorazione", rilevanza: "A", sotto: ["mense"] }] });
  const tutte = [A, senzaLuogo, C, B, altraSottocategoria, nonClassificata, inAttesa, rigaSpenta, copia, pertinenteAltroSettore];

  const chiamate: Chiamata[] = [];
  const r = await cercaGare(clienteFinto(chiamate, tutte), filtriDaProfilo(PROFILO, "rilevanza", 1), adesso, { classificazioni: true, fontiNascoste, perTe: PROFILO });
  uguale("R1 «Per te»: UNA sola richiesta (radar_procedure)", chiamate.map((c) => c.tabella), ["radar_procedure"]);
  const passi = chiamate[0]?.passi ?? [];
  atteso("R2 regioni nella STESSA richiesta: del profilo oppure luogo non indicato", passi.some((p) => p.metodo === "or" && p.argomenti[0] === "luogo_regioni.ov.{lombardia},luogo_regioni.eq.{}") && !passi.some((p) => p.metodo === "overlaps" && p.argomenti[0] === "luogo_regioni"));
  atteso("R2 settori, importo minimo e procedure filtrati dal database", passi.some((p) => p.metodo === "overlaps" && p.argomenti[0] === "settori") && passi.some((p) => p.metodo === "gte" && p.argomenti[0] === "valore_stimato" && p.argomenti[1] === 100000) && passi.some((p) => p.metodo === "in" && p.argomenti[0] === "tipo_procedura"));
  atteso("R2 classificazioni incorporate e righe attive, copie collegate escluse", String(passi.find((p) => p.metodo === "select")?.argomenti[0]).includes("radar_classificazioni(") && passi.some((p) => p.metodo === "eq" && p.argomenti[0] === "classificazioni.attiva") && passi.some((p) => p.metodo === "is" && p.argomenti[0] === "unita_a"));
  const ids = r.righe.map((x) => x.id);
  uguale("R3 solo pertinenti (A) del settore e della sottocategoria del profilo, anche senza luogo", [...ids].sort(), [A.id, senzaLuogo.id].sort());
  atteso("R3 mai: non pertinenti (C), correlate non richieste, altre sottocategorie, non classificate, in attesa, righe spente, copie, A di un settore fuori profilo", [C, B, altraSottocategoria, nonClassificata, inAttesa, rigaSpenta, copia, pertinenteAltroSettore].every((x) => !ids.includes(x.id as string)));
  atteso("R4 per ogni riga l'opportunità del profilo (tipo e settori)", r.perTe?.[A.id as string]?.tipo === "pertinente" && r.perTe?.[A.id as string]?.settori[0]?.settore === "pulizia");

  const conCorrelate = { ...PROFILO, vedereCorrelate: true };
  const r2 = await cercaGare(clienteFinto([], tutte), filtriDaProfilo(conCorrelate, "recenti", 1), adesso, { classificazioni: true, fontiNascoste, perTe: conCorrelate });
  const ids2 = r2.righe.map((x) => x.id);
  atteso("R5 con «mostra le correlate»: anche B, ma DOPO le pertinenti anche se più recente", ids2.includes(B.id as string) && ids2.indexOf(B.id as string) > ids2.indexOf(A.id as string) && ids2.indexOf(B.id as string) > ids2.indexOf(senzaLuogo.id as string) && r2.perTe?.[B.id as string]?.tipo === "correlata");
  atteso("R5 mai le C neanche con le correlate", !ids2.includes(C.id as string));

  const r3 = await cercaGare(clienteFinto([], tutte), filtriDaProfilo(PROFILO, "rilevanza", 1), adesso, { classificazioni: false, fontiNascoste, perTe: PROFILO });
  atteso("R6 senza classificazioni lette «Per te» non propone nulla", r3.righe.length === 0 && r3.candidati === 0 && JSON.stringify(r3.perTe) === "{}");

  progressivo = 100;
  const molte = Array.from({ length: 30 }, () => riga({}));
  const p2 = await cercaGare(clienteFinto([], [...molte, C]), filtriDaProfilo(PROFILO, "rilevanza", 2), adesso, { classificazioni: true, fontiNascoste, perTe: PROFILO });
  atteso("R7 paginazione DOPO il filtro del profilo: 30 pertinenti, pagina 2 con 5", p2.candidati === 30 && p2.pagine === 2 && p2.righe.length === 5);

  const chiamateCerca: Chiamata[] = [];
  const cerca = await cercaGare(clienteFinto(chiamateCerca, tutte), filtriDaParametri({ regione: "lombardia" }), adesso, { classificazioni: true, fontiNascoste });
  const passiCerca = chiamateCerca[0]?.passi ?? [];
  atteso("R8 «Cerca» invariata: regioni con overlaps, nessuna gara senza luogo aggiunta, nessun filtro del profilo", passiCerca.some((p) => p.metodo === "overlaps" && p.argomenti[0] === "luogo_regioni") && !passiCerca.some((p) => p.metodo === "or" && String(p.argomenti[0]).includes("luogo_regioni")) && cerca.perTe === null && cerca.righe.length > 2);
  uguale("R9 nessuna richiesta di rete verso l'esterno", richiesteEsterne, []);
}

// ───── G. Calcoli dell'opportunità ─────

{
  const g = garaPerRadarDaRiga({ id: "x", unita_a: null, tipo_procedura: null, luogo_regioni: null, valore_stimato: "1000", classificazione_stato: [{ stato: "classificata" }], classificazioni: [{ settore: "pulizia", rilevanza: "A", sottocategorie: null, attiva: null }] });
  uguale("G1 dalla riga alla gara del contratto (stato in elenco, sottocategorie e luogo mancanti)", g, { id: "x", unitaA: null, statoClassificazione: "classificata", righe: [{ settore: "pulizia", rilevanza: "A", sottocategorie: [], attiva: true }], tipoProcedura: null, regioni: [], valore: 1000, aperta: true });
  const op = new Map([
    ["b", { proceduraId: "b", tipo: "correlata" as const, settori: [] }],
    ["a", { proceduraId: "a", tipo: "pertinente" as const, settori: [] }],
  ]);
  uguale("G2 pertinenti prima, ordine interno mantenuto, righe fuori profilo tolte", pertinentiPrima([{ id: "b" }, { id: "z" }, { id: "a" }], op).map((x) => x.id), ["a", "b"]);
  const motivo = motivoPerTe({ proceduraId: "a", tipo: "pertinente", settori: [{ settore: "pulizia", sottocategorie: ["sanificazione", "disinfestazione"] }] }, PROFILO, ["lombardia", "veneto"]);
  atteso("G3 «perché compare»: settore, sottocategoria del profilo, regione del profilo", motivo.startsWith("Nel profilo: Pulizia e sanificazione › ") && motivo.endsWith(" · Lombardia") && !motivo.includes("Veneto") && !/disinfestazione/i.test(motivo));
  atteso("G3 gara senza luogo: «luogo non indicato dalla fonte»", motivoPerTe({ proceduraId: "a", tipo: "pertinente", settori: [{ settore: "pulizia", sottocategorie: [] }] }, PROFILO, []).endsWith("luogo non indicato dalla fonte"));
  atteso("G3 correlata detta tale", motivoPerTe({ proceduraId: "b", tipo: "correlata", settori: [{ settore: "pulizia", sottocategorie: [] }] }, { ...PROFILO, sottocategorie: {} }, ["lombardia"]).startsWith("Nel profilo: correlata, Pulizia e sanificazione"));
  uguale("G4 chi ha salvato: il ruolo, mai nomi o email", [chiHaSalvato(IMPRESA, IMPRESA, UFFICIO), chiHaSalvato(UFFICIO, IMPRESA, IMPRESA), chiHaSalvato(UFFICIO, IMPRESA, UFFICIO), chiHaSalvato(null, IMPRESA, IMPRESA)], ["salvata dal titolare", "salvata dall'Ufficio Gare", "salvata da te", null]);
}

// ───── U. Ufficio Gare: percorsi, guardie, menu ─────

for (const p of ["/opportunita", "/opportunita/per-te", "/opportunita/profilo", "/opportunita/cerca", "/opportunita/gara/x"]) {
  atteso(`U1 ${p}: chiusa all'Ufficio Gare di base, aperta con il grado 2, sempre aperta al titolare`, !percorsoConsentito("ufficio_gare", `${RADICE_AREA}${p}`) && percorsoConsentito("ufficio_gare", `${RADICE_AREA}${p}`, { opportunita: true }) && percorsoConsentito("titolare", `${RADICE_AREA}${p}`));
}
atteso("U2 il grado 2 non apre altro (impostazioni, abbonamento, profilo azienda, revisione)", ["/impostazioni", "/abbonamento", "/profilo-azienda", "/gare/x/revisione", "/opportunita/../impostazioni"].every((p) => !percorsoConsentito("ufficio_gare", `${RADICE_AREA}${p}`, { opportunita: true })));
const guardie = leggi("src/lib/radar/guardie-opportunita.ts");
atteso("U3 guardie di Opportunità: a interruttore spento quelle del titolare", guardie.includes("ufficioGareRadarAttivo(process.env) ? richiediAccountPagina() : richiediTitolarePagina()") && guardie.includes("ufficioGareRadarAttivo(process.env) ? richiediAccountAzione() : richiediTitolareAzione()"));

// ───── T. Sorgenti: profilo solo del titolare, «per_te» come statistica, niente polling, testi ─────

const azioneProfilo = leggi("src/app/actions/radar-profilo.ts");
const corpoProfilo = azioneProfilo.slice(azioneProfilo.indexOf("export async function salvaProfiloRadar"));
const ordine = ["await richiediTitolareAzione()", "if (!guardia.ok)", "perTeAttivo(process.env)", "leggiDirittoRadar(guardia.contesto.accountId)", "validaProfiloRadar(", "scriviProfiloRadar(createAdminClient(), esito.valori, guardia.contesto.accountId, guardia.contesto.userId"].map((s) => corpoProfilo.indexOf(s));
atteso("T1 salvaProfiloRadar: guardia del TITOLARE, interruttore, diritto, validazione, poi scrittura con impresa e autore della sessione", ordine.every((x, i) => x >= 0 && (i === 0 || x > ordine[i - 1])), ordine.join(","));
atteso("T1 salvaProfiloRadar: nessuna guardia dell'account, nessuna impresa presa dal modulo, nessuna scrittura con la sessione", !azioneProfilo.includes("richiediAccountAzione") && !azioneProfilo.includes("richiediOpportunitaAzione") && !/formData\.get\(/.test(azioneProfilo) && !azioneProfilo.includes("createClient("));
atteso("T2 scrittura del profilo: upsert sulla coppia impresa e posizione", leggi("src/lib/radar/profilo.ts").includes('upsert(rigaDaValori(valori, impresaId, autoreId, adesso.toISOString()), { onConflict: "user_id,posizione" })'));
const perTe = leggi("src/app/site-omnia-ai/dashboard/omnia-ai/opportunita/per-te/page.tsx");
atteso("T3 «Per te»: 404 a interruttore spento, profilo letto con la sessione, ricerca con il profilo", perTe.includes("if (!perTeAttivo(process.env)) notFound();") && perTe.includes("leggiProfiloRadar(supabase, contesto.accountId)") && perTe.includes("const supabase = await createClient();") && perTe.includes("perTe: profilo"));
atteso("T3 «Per te» si registra e si conta come «per_te», mai come «ricerca»", perTe.includes('azione: "per_te"') && perTe.includes('contaUtilizziRadar(admin, contesto.accountId, "per_te"') && !perTe.includes('"ricerca"'));
atteso("T4 «per_te» è solo statistica: non entra tra le azioni con costo della console", !(AZIONI_RADAR as readonly string[]).includes("per_te") && JSON.stringify(AZIONI_SOLO_STATISTICA) === '["per_te"]');
const profiloPagina = leggi("src/app/site-omnia-ai/dashboard/omnia-ai/opportunita/profilo/page.tsx");
atteso("T5 pagina del profilo: 404 a interruttore spento, sola lettura per chi non è titolare", profiloPagina.includes("if (!perTeAttivo(process.env)) notFound();") && profiloPagina.includes("soloLettura={!titolare || !diritto.operativo}"));
const modulo = leggi("src/components/omnia-ai/opportunita/profilo-form.tsx");
atteso("T6 modulo del profilo: nel browser nessun catalogo, nessuna ricerca, nessun accesso ai dati", /^"use client";/.test(modulo) && [...modulo.matchAll(/from "([^"]+)"/g)].map((m) => m[1]).every((i) => i === "react" || i === "@/app/actions/radar-profilo"));
atteso("T6 modulo in sola lettura: campi disattivati e nessun pulsante", modulo.includes("const spento = soloLettura || inCorso;") && /\{soloLettura \? \(/.test(modulo));
const radice = leggi("src/app/site-omnia-ai/dashboard/omnia-ai/opportunita/page.tsx");
atteso("T7 radice di Opportunità: il profilo si legge solo con «Per te» acceso", radice.indexOf("if (perTeAttivo(process.env)) {") >= 0 && radice.indexOf("leggiProfiloRadar(") > radice.indexOf("if (perTeAttivo(process.env)) {"));
const layout = leggi("src/app/site-omnia-ai/dashboard/omnia-ai/layout.tsx");
atteso("T8 menu dell'Ufficio Gare: nessuna lettura in più a interruttore spento", layout.includes("ufficioGareRadarAttivo(process.env) ? radarNelMenu(contesto.accountId) : Promise.resolve(false)"));
const nuovi = [
  "src/lib/radar/profilo-calcoli.ts",
  "src/lib/radar/profilo.ts",
  "src/lib/radar/interruttori-b4.ts",
  "src/lib/radar/guardie-opportunita.ts",
  "src/lib/radar/salvate-calcoli.ts",
  "src/app/actions/radar-profilo.ts",
  "src/components/omnia-ai/opportunita/profilo-form.tsx",
  "src/app/site-omnia-ai/dashboard/omnia-ai/opportunita/per-te/page.tsx",
  "src/app/site-omnia-ai/dashboard/omnia-ai/opportunita/profilo/page.tsx",
  "src/app/site-omnia-ai/dashboard/omnia-ai/opportunita/page.tsx",
];
const testoNuovo = nuovi.map(leggi).join("\n");
atteso("T9 nessun aggiornamento periodico nel browser", !/setInterval|setTimeout|router\.refresh|useEffect\(|revalidate\s*=/.test(testoNuovo));
atteso("T10 nessun «amministratore» nei testi per i clienti", !/amministrator/i.test(testoNuovo));
const codiceNuovo = testoNuovo.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
atteso("T11 i dati sono dell'impresa, mai dell'utente loggato", !/\buser\.id\b/.test(codiceNuovo));
for (const f of nuovi.filter((f) => f.endsWith(".tsx"))) {
  const tag = [...leggi(f).matchAll(/<Link\b[^>]*>/g)].map((m) => m[0]);
  atteso(`T12 ${path.basename(path.dirname(f))}/${path.basename(f)}: ogni collegamento con prefetch={false}`, tag.every((t) => t.includes("prefetch={false}")), `${tag.length} collegamenti`);
}
atteso("T13 righe LF nei file nuovi", nuovi.every((f) => !leggi(f).includes("\r\n")));

provaRicerca()
  .catch((e) => atteso("R0 la ricerca finta non deve sollevare errori", false, String(e)))
  .finally(() => {
    console.log(fallimenti.length ? `\n${fallimenti.length} controlli FALLITI` : "\nTutti i controlli dei gradi 1-2 della fase B4 sono passati.");
    process.exit(fallimenti.length ? 1 : 0);
  });
