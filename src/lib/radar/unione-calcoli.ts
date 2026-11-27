// Unione di più fonti nella STESSA gara dell'archivio (TED e PVL, fase B1-bis): quale versione è più recente, quale valore vale per ogni
// campo, che cosa è davvero cambiato (e va registrato) e che cosa è solo la stessa notizia scritta da un'altra fonte. Logica pura, provata
// da scripts/verifica-radar-pvl.ts.
//
// Regole (richiesta del titolare del 16/11/2026 e decisione 04, §6):
//   - una gara, una riga: le fonti si aggiungono come provenienza, mai come gara nuova;
//   - versioni a confronto: con il numero TED su entrambe (la PVL cita l'avviso TED che corrisponde alla sua versione) vale l'ordine dei
//     numeri TED; tra versioni PVL vale l'istante di pubblicazione; altrimenti il giorno. La stessa versione letta da due fonti è «pari»;
//   - campi SOSTANZIALI (scadenza, valore, numero di lotti): vince la versione più recente, da qualunque fonte; a pari versione la fonte con
//     la precedenza più alta (PVL prima di TED); un valore vuoto non cancella mai quello di un'altra fonte;
//   - campi DESCRITTIVI e COMPLEMENTARI (oggetto, ente, documenti, procedura…): vince la fonte con la precedenza più alta che li indica;
//     dentro la stessa fonte vince la versione più recente; una fonte riempie i campi che l'altra non indica;
//   - un cambiamento si REGISTRA (rettifica, proroga, annullamento) solo se arriva da una versione strettamente più recente; la stessa
//     notizia ripubblicata da un'altra fonte non genera né cambiamenti né notifiche;
//   - una gara letta da una sola fonte si comporta esattamente come prima (stesse regole di importa-calcoli.ts), salvo la regola sotto;
//   - ENTE E LUOGO (difetto del giro PVL del 24/11, documento 54; lezione del C8: «l'unione non toglie mai un'informazione»):
//       · la SEDE dell'ente (sa_comune, sa_provincia, sa_regione) è un'unità a sé. TED, Sintel e SardegnaCAT indicano la sede; la PVL solo
//         il luogo di esecuzione del primo lotto (pvl-calcoli.ts). La sede vince sempre sul luogo di esecuzione, in entrambe le direzioni;
//         tra due fonti dello stesso tipo valgono le regole dei dati complementari;
//       · i campi vuoti della sede scelta si riempiono dall'altra fonte (o dalla versione precedente della stessa fonte) solo se è la
//         stessa sede (stesso comune, oppure senza comune con provincia e regione compatibili e una fonte dello stesso tipo): mai
//         indovinati, mai il comune di un luogo con la provincia di un altro;
//       · le regioni del luogo di esecuzione (luogo_regioni) sono un gruppo proprio: chi non le dà non le toglie, chi le dà riempie quelle
//         vuote, tra due fonti che le danno vale la precedenza;
//       · ente (codice fiscale e nome), sede, regioni e codice NUTS: un valore presente non si perde mai, campo per campo, nemmeno con una
//         versione più recente della stessa fonte.
import { ordinePubblicazione } from "./fonti/ted-calcoli";
import { cambiamentiTraVersioni, cambioDiScadenza, cambioDiSospensione, scadenzaDaValore, type Cambiamento, type RigaProcedura, type Scadenza } from "./importa-calcoli";
import { nomeDiConfronto } from "./province";

// Fase B2a: anche Sintel e SardegnaCAT (e le fonti future) passano da QUESTO motore, nessun altro.
// Fase 2: «tuttogare» (in costruzione) come le altre piattaforme. Senza la sua riga in radar_fonti_stato non scrive nessuna gara.
// Fase 2: «start» (START Toscana, in costruzione) allo stesso modo: senza la sua riga in radar_fonti_stato non scrive nessuna gara.
// Fase 2: «empulia» e «siaps» (piattaforme AF Soluzioni, in costruzione) come SardegnaCAT.
export type FonteUnita = "ted" | "pvl" | "sintel" | "sardegnacat" | "sater" | "tuttogare" | "start" | "empulia" | "siaps";

export const FONTI_UNITE: readonly FonteUnita[] = ["ted", "pvl", "sintel", "sardegnacat", "sater", "tuttogare", "start", "empulia", "siaps"];

export function eFonteUnita(x: unknown): x is FonteUnita {
  return typeof x === "string" && (FONTI_UNITE as readonly string[]).includes(x);
}

// Precedenza per i dati descrittivi e, a pari versione, per quelli sostanziali. Tra TED e PVL resta quella della B1-bis (PVL prima di TED).
// Le piattaforme stanno tra le due: ordine PROVVISORIO, finché l'utente non decide la S8 (documento 10, §8).
// SATER (Fase 2) come SardegnaCAT, l'altra piattaforma con la scadenza all'ora: le due non si incontrano sulla stessa gara (regioni diverse).
// TuttoGare (Fase 2, in costruzione) come le altre piattaforme con la scadenza all'ora (la piattaforma dell'ente è la fonte primaria).
// START (Fase 2, in costruzione) come le altre piattaforme. Non dà MAI la scadenza: per la scadenza la precedenza non conta (un valore vuoto
// non cancella mai quello di un'altra fonte); vale per oggetto, ente e procedura, dove la PVL resta prima.
// EmPULIA e SIAPS (Fase 2, in costruzione) come SardegnaCAT, l'altra istanza dello stesso software.
// Le fonti che dichiarano la sospensione di una procedura (feed AF: statoFunzionale «Sospeso» / «Procedura Sospesa»; correzione del 27/11).
// Solo queste portano una gara a «sospesa» o la riportano «aperta». Sintel ha uno stato «Sospesa» ma la tratta come in corso: non cambia.
export const FONTI_CON_SOSPENSIONE: ReadonlySet<FonteUnita> = new Set<FonteUnita>(["sardegnacat", "empulia", "siaps"]);

export const PRECEDENZA_FONTI: Record<FonteUnita, number> = { pvl: 4, sardegnacat: 3, sater: 3, tuttogare: 3, start: 3, empulia: 3, siaps: 3, sintel: 2, ted: 1 };

// Quali fonti indicano la SEDE dell'ente (comune, provincia e regione dell'amministrazione): TED (buyer-city, buyer-country-sub), Sintel e
// SardegnaCAT («Comune di …» e la regione della piattaforma). La PVL no: il suo comune e la sua provincia sono quelli del luogo di esecuzione
// del primo lotto, e valgono come sede solo finché nessun'altra fonte la indica. Una fonte sconosciuta vale come sede (regole di sempre).
// START no: l'elenco dà solo il nome dell'ente (il comune solo per «Comune di …») e la regione della piattaforma; vale come la PVL (riempie i
// campi vuoti, non toglie il comune e la provincia di un'altra fonte).
// EmPULIA e SIAPS come SardegnaCAT (stesso feed: ente e regione della piattaforma, «Comune di …»).
export const SEDE_DELL_ENTE: Record<FonteUnita, boolean> = { ted: true, sintel: true, sardegnacat: true, sater: true, tuttogare: true, start: false, empulia: true, siaps: true, pvl: false };

export function indicaLaSede(fonte: string): boolean {
  return SEDE_DELL_ENTE[fonte as FonteUnita] !== false;
}

export type VersioneFonte = {
  fonte: FonteUnita;
  // identificativo dell'avviso nella fonte (numero TED, idAvviso PVL)
  id: string;
  // giorno di pubblicazione (AAAA-MM-GG) e, se la fonte lo dà, l'istante
  giorno: string;
  istante: string | null;
  // numero dell'avviso TED a cui corrisponde questa versione (il proprio per TED, quello citato per la PVL)
  ted: string | null;
};

// Come si conserva nella colonna provenienza_campi (chiavi corte: la colonna sta su ogni gara).
export type ProvenienzaCampo = { f: FonteUnita; id: string; g: string; t: string | null; ted: string | null };
export type ProvenienzaCampi = Record<string, ProvenienzaCampo>;

export function provenienzaDa(v: VersioneFonte): ProvenienzaCampo {
  return { f: v.fonte, id: v.id, g: v.giorno, t: v.istante, ted: v.ted };
}

export function versioneDa(p: ProvenienzaCampo): VersioneFonte {
  return { fonte: p.f, id: p.id, giorno: p.g, istante: p.t, ted: p.ted };
}

// Le gare importate prima della provenienza per campo (solo TED, o solo PVL): tutto viene dall'ultima versione applicata.
export function provenienzaImplicita(r: Pick<RigaProcedura, "chiave" | "ultima_versione_il" | "ultima_versione_id">): ProvenienzaCampo {
  const pvl = r.chiave.startsWith("pvl:") || r.ultima_versione_id.startsWith("pvl:");
  const id = r.ultima_versione_id.replace(/^pvl:/, "");
  return { f: pvl ? "pvl" : "ted", id, g: r.ultima_versione_il, t: null, ted: pvl ? null : ordinePubblicazione(id) ? id : null };
}

function confrontaNumeri(a: number, b: number): number {
  return a === b ? 0 : a > b ? 1 : -1;
}

// > 0: a è più recente di b; 0: pari (la stessa versione, o non distinguibili); < 0: a è più vecchia.
export function confrontaVersioni(a: VersioneFonte, b: VersioneFonte): number {
  if (a.ted && b.ted) {
    const oa = ordinePubblicazione(a.ted);
    const ob = ordinePubblicazione(b.ted);
    if (oa && ob) return oa[0] !== ob[0] ? confrontaNumeri(oa[0], ob[0]) : confrontaNumeri(oa[1], ob[1]);
  }
  // dentro la stessa fonte vale l'istante, se la fonte lo dà (PVL: pubblicazione; SardegnaCAT: ultima modifica)
  if (a.fonte === b.fonte && a.fonte !== "ted" && a.istante && b.istante && a.istante !== b.istante) return a.istante.localeCompare(b.istante);
  if (a.fonte === b.fonte && a.id === b.id) return 0;
  return a.giorno.localeCompare(b.giorno);
}

// ───── gruppi di campi ─────

type Gruppo = { nome: string; colonne: readonly (keyof RigaProcedura)[]; tipo: "sostanziale" | "descrittivo" | "complementare" | "unione" };

export const GRUPPI_CAMPI: readonly Gruppo[] = [
  { nome: "scadenza", colonne: ["scadenza_giorno", "scadenza_offerte", "scadenza_ora_indicata", "scadenza_fonte"], tipo: "sostanziale" },
  { nome: "valore_stimato", colonne: ["valore_stimato"], tipo: "sostanziale" },
  // base d'asta (solo Sintel e SardegnaCAT): per TED e PVL è sempre vuota, quindi le loro gare non cambiano
  { nome: "valore_base", colonne: ["valore_base"], tipo: "sostanziale" },
  { nome: "n_lotti", colonne: ["n_lotti"], tipo: "sostanziale" },
  { nome: "oggetto", colonne: ["oggetto", "oggetto_breve"], tipo: "descrittivo" },
  { nome: "descrizione", colonne: ["descrizione"], tipo: "descrittivo" },
  { nome: "url_documenti", colonne: ["url_documenti", "piattaforma_host"], tipo: "descrittivo" },
  { nome: "url_avviso", colonne: ["url_avviso"], tipo: "descrittivo" },
  { nome: "ente", colonne: ["sa_codice_fiscale", "sa_denominazione"], tipo: "complementare" },
  // «luogo» è la SEDE dell'ente (il nome resta per la provenienza già scritta); le regioni del luogo di esecuzione hanno un gruppo proprio.
  // Le gare scritte prima del 24/11 hanno un'unica provenienza «luogo» per entrambi: per le regioni vale quella finché non ne hanno una.
  { nome: "luogo", colonne: ["sa_comune", "sa_provincia", "sa_regione"], tipo: "complementare" },
  { nome: "luogo_regioni", colonne: ["luogo_regioni"], tipo: "complementare" },
  { nome: "codice_nuts", colonne: ["codice_nuts"], tipo: "complementare" },
  { nome: "ente_tipo", colonne: ["ente_tipo"], tipo: "complementare" },
  { nome: "tipo_avviso", colonne: ["tipo_avviso"], tipo: "complementare" },
  { nome: "tipo_procedura", colonne: ["tipo_procedura"], tipo: "complementare" },
  { nome: "criterio_aggiudicazione", colonne: ["criterio_aggiudicazione"], tipo: "complementare" },
  { nome: "natura_contratto", colonne: ["natura_contratto"], tipo: "complementare" },
  { nome: "settori_speciali", colonne: ["settori_speciali"], tipo: "complementare" },
  { nome: "durata_mesi", colonne: ["durata_mesi"], tipo: "complementare" },
  { nome: "cpv_principale", colonne: ["cpv_principale"], tipo: "complementare" },
  { nome: "cpv_tutti", colonne: ["cpv_tutti"], tipo: "unione" },
  { nome: "settori", colonne: ["settori", "metodo_settore"], tipo: "unione" },
];

// Il campo del registro dei cambiamenti → gruppo.
const GRUPPO_DEL_CAMBIAMENTO: Record<string, string> = { scadenza_offerte: "scadenza", valore_stimato: "valore_stimato", n_lotti: "n_lotti", oggetto: "oggetto", url_documenti: "url_documenti" };

// Gruppi in cui un valore presente non si perde mai, campo per campo, nemmeno con una versione più recente della stessa fonte (24/11).
const MAI_SVUOTATI: ReadonlySet<string> = new Set(["ente", "luogo", "luogo_regioni", "codice_nuts"]);

const COLONNE_SEDE = ["sa_comune", "sa_provincia", "sa_regione"] as const;

function vuoto(v: unknown): boolean {
  return v === null || v === undefined || v === "" || (Array.isArray(v) && v.length === 0);
}

/**
 * Riempie i campi VUOTI della sede scelta («r») con quelli dell'altra («altra»), solo se è la stessa sede: stesso comune; oppure, se uno dei
 * due comuni manca, «altra» è dello stesso tipo (una sede, o la versione precedente della STESSA fonte) e provincia e regione sono compatibili
 * (uguali o una delle due vuota). Mai il comune di un luogo con la provincia o la regione di un altro. Restituisce true se ha cambiato qualcosa.
 */
export function completaSede(r: Pick<RigaProcedura, (typeof COLONNE_SEDE)[number]>, altra: Pick<RigaProcedura, (typeof COLONNE_SEDE)[number]>, altraIndicaLaSede: boolean): boolean {
  const compatibili = (a: string | null, b: string | null) => vuoto(a) || vuoto(b) || a === b;
  const stessaSede =
    !vuoto(r.sa_comune) && !vuoto(altra.sa_comune)
      ? nomeDiConfronto(r.sa_comune) === nomeDiConfronto(altra.sa_comune)
      : altraIndicaLaSede && compatibili(r.sa_provincia, altra.sa_provincia) && compatibili(r.sa_regione, altra.sa_regione);
  if (!stessaSede) return false;
  let cambiato = false;
  for (const c of COLONNE_SEDE) {
    if (vuoto(r[c]) && !vuoto(altra[c])) {
      r[c] = altra[c];
      cambiato = true;
    }
  }
  return cambiato;
}

// Ente: un codice fiscale o un nome presente non si perde mai (campo per campo).
function completaColonne(r: RigaProcedura, altra: RigaProcedura, g: Gruppo): boolean {
  let cambiato = false;
  for (const c of g.colonne) {
    if (vuoto(r[c]) && !vuoto(altra[c])) {
      (r as Record<string, unknown>)[c] = altra[c];
      cambiato = true;
    }
  }
  return cambiato;
}

// Il valore «principale» del gruppo, per dire se è vuoto (la scadenza conta per il giorno, la sede per uno qualunque dei suoi campi).
function valoreGruppo(r: RigaProcedura, g: Gruppo): unknown {
  if (g.nome === "scadenza") return r.scadenza_giorno;
  if (g.nome === "luogo") return COLONNE_SEDE.map((c) => r[c]).find((v) => !vuoto(v)) ?? null;
  if (g.nome === "ente") return r.sa_denominazione ?? r.sa_codice_fiscale;
  if (g.nome === "settori") return r.settori;
  if (g.nome === "n_lotti") return r.n_lotti > 0 ? r.n_lotti : null;
  return r[g.colonne[0]];
}

function copia(da: RigaProcedura, a: RigaProcedura, g: Gruppo): void {
  for (const c of g.colonne) (a as Record<string, unknown>)[c] = da[c];
}

export type EsitoUnione = {
  riga: RigaProcedura;
  provenienza: ProvenienzaCampi;
  // la versione nuova è diventata l'ultima applicata alla gara
  ultima: boolean;
  // la versione nuova è STRETTAMENTE più recente dell'ultima applicata (non la stessa notizia riletta o ripubblicata da un'altra fonte):
  // solo così le scadenze dei lotti si confrontano (cambiamentiDeiLotti)
  piuRecente: boolean;
  // gruppi presi dalla versione nuova (per le statistiche e la scheda)
  campiPresi: string[];
  cambiamenti: Cambiamento[];
};

/**
 * La gara dopo aver letto una versione di una fonte. «nuova» è la riga costruita SOLO da quella versione (rigaDaBando o rigaDaBandoPvl),
 * «precedente» quella in archivio con la sua provenienza per campo (vuota per le gare importate prima della B1-bis).
 */
/** Opzioni dell'unione. ripristino: la versione nuova dichiara «Procedura Ripristinata» (solo SardegnaCAT; 23/11, scelta (a) dell'utente). */
export type OpzioniUnione = { ripristino?: boolean };

export function unisciVersione(precedente: RigaProcedura | null, provenienzaPrecedente: ProvenienzaCampi | null, nuova: RigaProcedura, versione: VersioneFonte, adessoIso: string, opzioni: OpzioniUnione = {}): EsitoUnione {
  const pv = provenienzaDa(versione);
  if (!precedente) {
    const provenienza: ProvenienzaCampi = { _versione: pv };
    for (const g of GRUPPI_CAMPI) if (!vuoto(valoreGruppo(nuova, g))) provenienza[g.nome] = pv;
    return { riga: { ...nuova, ultima_versione_id: idVersione(versione) }, provenienza, ultima: true, piuRecente: false, campiPresi: Object.keys(provenienza).filter((k) => k !== "_versione"), cambiamenti: [] };
  }

  const implicita = provenienzaImplicita(precedente);
  const prov: ProvenienzaCampi = { ...(provenienzaPrecedente ?? {}) };
  // gara importata prima della 0115 (provenienza vuota): la provenienza implicita diventa esplicita per ogni dato presente, prima di
  // qualunque unione, così i dati che restano della prima fonte non vengono poi attribuiti all'altra
  if (Object.keys(prov).length === 0) {
    prov._versione = implicita;
    for (const g of GRUPPI_CAMPI) if (!vuoto(valoreGruppo(precedente, g))) prov[g.nome] = implicita;
  }
  const ultimaPrecedente = prov._versione ?? implicita;
  const confrontoUltima = confrontaVersioni(versione, versioneDa(ultimaPrecedente));
  const unaSolaFonte = [ultimaPrecedente, ...Object.values(prov)].every((p) => p.f === versione.fonte);

  const riga: RigaProcedura = { ...precedente };
  const presi: string[] = [];
  // la provenienza del vecchio gruppo «luogo» PRIMA di questa versione (il ciclo la aggiorna per la sede prima di arrivare alle regioni)
  const luogoPrima = prov.luogo;
  const conCambio = new Set<string>();

  for (const g of GRUPPI_CAMPI) {
    const vecchio = valoreGruppo(precedente, g);
    const nuovo = valoreGruppo(nuova, g);
    // le regioni delle gare scritte prima del 24/11 hanno la provenienza del vecchio gruppo «luogo» (erano copiate insieme alla sede)
    const ereditata = g.nome === "luogo_regioni" && !vuoto(vecchio) ? luogoPrima : undefined;
    const cur = prov[g.nome] ?? ereditata ?? (vuoto(vecchio) ? null : implicita);
    let prendi = false;
    let cambio = false;
    if (g.tipo === "unione") {
      // CPV e settori: l'unione delle fonti (una fonte non toglie ciò che l'altra ha riconosciuto); stessa fonte più recente = sostituzione
      if (cur && cur.f === versione.fonte && confrontaVersioni(versione, versioneDa(cur)) > 0 && unaSolaFonte) prendi = true;
      else if (!vuoto(nuovo)) {
        if (g.nome === "cpv_tutti") {
          const u = [...new Set([...precedente.cpv_tutti, ...nuova.cpv_tutti])];
          if (u.length !== precedente.cpv_tutti.length) {
            riga.cpv_tutti = u;
            presi.push(g.nome);
            prov[g.nome] = PRECEDENZA_FONTI[versione.fonte] >= PRECEDENZA_FONTI[cur?.f ?? versione.fonte] ? pv : (cur ?? pv);
          }
        } else {
          const u = [...new Set([...precedente.settori, ...nuova.settori])];
          const metodo = precedente.metodo_settore === "cpv" || nuova.metodo_settore === "cpv" ? "cpv" : "parole_chiave";
          if (u.length !== precedente.settori.length || metodo !== precedente.metodo_settore) {
            riga.settori = u;
            riga.metodo_settore = metodo;
            presi.push(g.nome);
            prov[g.nome] = pv;
          }
        }
        continue;
      }
    } else if (vuoto(vecchio) && vuoto(nuovo)) {
      continue;
    } else if (!cur) {
      // con una sola fonte una versione più vecchia non tocca nulla (come prima della B1-bis); con due, riempie ciò che manca
      prendi = !vuoto(nuovo) && !(unaSolaFonte && confrontoUltima < 0);
      // con una sola fonte un dato che compare in una versione più recente si registra, come prima della B1-bis
      cambio = prendi && unaSolaFonte && confrontoUltima > 0;
    } else if (cur.f === versione.fonte) {
      const c = confrontaVersioni(versione, versioneDa(cur));
      // stessa fonte: come prima della B1-bis (la versione più recente sostituisce; una più vecchia non tocca nulla)
      prendi = c > 0 || (c === 0 && !vuoto(nuovo));
      // con una sola fonte si registra come prima (anche un dato che compare o sparisce); con due, solo il cambio di un dato presente
      cambio = c > 0 && (unaSolaFonte || (!vuoto(vecchio) && !vuoto(nuovo)));
      // una fonte che smette di indicare un dato non cancella quello dell'altra (che resta registrato solo per questa); ente, sede, regioni
      // e NUTS non si svuotano nemmeno con una sola fonte (24/11)
      if (prendi && vuoto(nuovo) && (!unaSolaFonte || MAI_SVUOTATI.has(g.nome))) prendi = false;
    } else if (vuoto(vecchio)) {
      prendi = true;
    } else if (vuoto(nuovo)) {
      prendi = false;
    } else if (g.tipo === "sostanziale") {
      const c = confrontaVersioni(versione, versioneDa(cur));
      prendi = c > 0 || (c === 0 && PRECEDENZA_FONTI[versione.fonte] > PRECEDENZA_FONTI[cur.f]);
      cambio = c > 0;
      // fonti diverse, stesso giorno di scadenza: una fonte che non indica l'ora (Sintel) non toglie l'ora indicata dall'altra. Non è un'ora
      // presunta: è l'ora scritta da una fonte ufficiale per quello stesso giorno. Un giorno DIVERSO (proroga) vale sempre, anche senza ora.
      if (g.nome === "scadenza" && precedente.scadenza_giorno === nuova.scadenza_giorno && precedente.scadenza_ora_indicata && !nuova.scadenza_ora_indicata) {
        prendi = false;
        cambio = false;
      }
    } else {
      prendi = PRECEDENZA_FONTI[versione.fonte] > PRECEDENZA_FONTI[cur.f];
    }
    // la sede dell'ente vince sempre sul luogo di esecuzione (PVL), in entrambe le direzioni; tra fonti dello stesso tipo, le regole sopra
    if (g.nome === "luogo" && cur && !vuoto(vecchio) && !vuoto(nuovo) && indicaLaSede(cur.f) !== indicaLaSede(versione.fonte)) prendi = indicaLaSede(versione.fonte);
    if (prendi) {
      copia(nuova, riga, g);
      // dentro il gruppo, un campo vuoto della versione nuova non toglie quello di prima (sede: solo se è la stessa sede)
      // la sede di prima vale come «stesso tipo» se indica la sede o se è della STESSA fonte (rilievo 2 di B2, 24/11: una versione PVL più
      // recente senza comune non toglie il comune della versione PVL precedente con la stessa provincia e regione)
      if (g.nome === "luogo") completaSede(riga, precedente, cur ? cur.f === versione.fonte || indicaLaSede(cur.f) : true);
      else if (g.nome === "ente") completaColonne(riga, precedente, g);
      presi.push(g.nome);
      if (vuoto(nuovo)) delete prov[g.nome];
      else prov[g.nome] = pv;
      if (cambio) conCambio.add(g.nome);
    } else if (cur && cur.f !== versione.fonte && !vuoto(vecchio) && !vuoto(nuovo) && (g.nome === "luogo" || g.nome === "ente")) {
      // resta il dato di prima: un'altra fonte riempie solo i suoi campi vuoti (sede: solo se è la stessa sede); la provenienza resta
      const riempito = g.nome === "luogo" ? completaSede(riga, nuova, indicaLaSede(versione.fonte)) : completaColonne(riga, nuova, g);
      if (riempito) presi.push(g.nome);
    }
    // ente, sede e regioni: la provenienza di un dato rimasto diventa esplicita (una provenienza implicita cambia con l'ultima versione)
    if (!prendi && cur && !vuoto(vecchio) && !prov[g.nome] && MAI_SVUOTATI.has(g.nome)) prov[g.nome] = cur;
  }

  // stato: l'annullamento vale se arriva da una versione non più vecchia dell'ultima applicata; gli esiti già registrati non tornano «aperta»
  if (nuova.stato === "annullata" && precedente.stato !== "annullata" && confrontoUltima >= 0) {
    riga.stato = "annullata";
    conCambio.add("stato");
  }
  // «Procedura Ripristinata» di SardegnaCAT (decisione dell'utente del 23/11, scelta (a)): una versione STRETTAMENTE più recente della stessa
  // gara, che dichiara il ripristino e non è revocata, riporta la gara dallo stato «annullata» allo stato della versione nuova. Solo se la
  // gara viene SOLO da SardegnaCAT: l'annullamento di un'altra fonte non si scavalca. Senza il segnale esplicito resta annullata (come prima)
  if (opzioni.ripristino && versione.fonte === "sardegnacat" && precedente.stato === "annullata" && nuova.stato !== "annullata" && confrontoUltima > 0 && unaSolaFonte) {
    riga.stato = nuova.stato;
    conCambio.add("stato");
  }
  // sospensione e ripresa (correzione «Sospeso», 27/11): le dichiarano SOLO i feed AF (FONTI_CON_SOSPENSIONE). Una loro versione non più
  // vecchia dell'ultima applicata porta la gara «aperta» a «sospesa», e la riporta «aperta» quando la fonte non la dice più sospesa. Una
  // fonte che non conosce la sospensione (TED, PVL, …) non la toglie mai; esiti e annullamenti non si toccano.
  if (FONTI_CON_SOSPENSIONE.has(versione.fonte) && confrontoUltima >= 0) {
    const verso = precedente.stato === "aperta" && nuova.stato === "sospesa" ? "sospesa" : precedente.stato === "sospesa" && nuova.stato === "aperta" ? "aperta" : null;
    if (verso && riga.stato === precedente.stato) {
      riga.stato = verso;
      conCambio.add("stato");
    }
  }
  // la data di pubblicazione della gara resta quella del primo avviso, da qualunque fonte
  if (nuova.data_pubblicazione && (!precedente.data_pubblicazione || nuova.data_pubblicazione < precedente.data_pubblicazione)) riga.data_pubblicazione = nuova.data_pubblicazione;
  // identificativo della piattaforma e tipo di opportunità (0120): si riempiono se mancano, non si sovrascrivono (nessun cambio per TED e PVL)
  if (!precedente.piattaforma_id && nuova.piattaforma_id) riga.piattaforma_id = nuova.piattaforma_id;
  if (!precedente.tipo_opportunita && nuova.tipo_opportunita) {
    riga.tipo_opportunita = nuova.tipo_opportunita;
    riga.partecipazione = nuova.partecipazione;
  }

  const ultima = confrontoUltima > 0 || (confrontoUltima === 0 && PRECEDENZA_FONTI[versione.fonte] >= PRECEDENZA_FONTI[ultimaPrecedente.f]);
  if (ultima) {
    riga.ultima_versione_il = versione.giorno;
    riga.ultima_versione_id = idVersione(versione);
    prov._versione = pv;
  } else {
    prov._versione = ultimaPrecedente;
  }
  riga.chiave = precedente.chiave;

  const cambiamenti = cambiamentiTraVersioni(precedente, riga).filter((c) => (c.campo === "stato" ? conCambio.has("stato") : conCambio.has(GRUPPO_DEL_CAMBIAMENTO[c.campo ?? ""] ?? "")));
  // una sospensione o una ripresa non è una rettifica del bando: non accende «rettificata»
  riga.rettificata = precedente.rettificata || cambiamenti.some((c) => !cambioDiSospensione(c));
  if (presi.length > 0 || ultima) {
    riga.ultima_rilevazione_il = adessoIso;
    riga.aggiornata_il = adessoIso;
  }
  return { riga, provenienza: prov, ultima, piuRecente: confrontoUltima > 0, campiPresi: presi, cambiamenti };
}

// L'identificativo dell'ultima versione come si conserva nella gara: il numero TED così com'è (compatibile con le gare di B1), le altre fonti
// con il loro prefisso («pvl:», «sintel:», «sardegnacat:»).
export function idVersione(v: VersioneFonte): string {
  return v.fonte === "ted" ? v.id : `${v.fonte}:${v.id}`;
}

// ───── lotti ─────

export type LottoUnito = {
  numero_lotto: string;
  cig: string | null;
  oggetto: string | null;
  cpv_principale: string | null;
  cpv_tutti: string[];
  valore_stimato: number | null;
  durata_mesi: number | null;
  scadenza_giorno: string | null;
  scadenza_offerte: string | null;
  scadenza_ora_indicata: boolean;
  scadenza_fonte: string | null;
  url_documenti: string | null;
};

export type EsitoLotti = { lotti: LottoUnito[]; cigScartati: number; allineati: boolean };

function stessoImporto(a: number | null, b: number | null): boolean {
  if (a === null || b === null) return true;
  return Math.abs(a - b) <= Math.max(1, Math.abs(a) * 0.005);
}

/**
 * Identificativo di lotto STABILE della fonte, lo stesso in ogni lettura: Sintel «SINTEL-<id_lotto>» (sintel-calcoli.ts). I numeri d'ordine
 * («LOT-0001»…) non lo sono: quando un lotto esce dall'elenco gli altri possono cambiare numero.
 */
export function identificativoLottoStabile(numero: string): boolean {
  return /^SINTEL-\d{1,12}$/.test(numero);
}

/**
 * I lotti di una versione uniti a quelli già in archivio per la stessa gara. I lotti si abbinano per numero (TED e PVL usano «LOT-0001»…
 * nello stesso ordine); se i valori stimati di due lotti abbinati non coincidono l'abbinamento non è sicuro: i lotti già presenti restano
 * come sono e il CIG della nuova fonte NON si assegna (mai un CIG sul lotto sbagliato).
 * Fase B4 (26B §6.2 punto 4, difetto «modifiche Sintel», 20/11): con identificativi STABILI su tutti i lotti, e nessun lotto nuovo, i lotti
 * si abbinano per identificativo anche se il loro numero cambia: un lotto chiuso esce dall'elenco di Sintel e resta in archivio com'era (non
 * è una proroga), gli altri si aggiornano. Prima, con un lotto in meno, nessun lotto si aggiornava più.
 */
export function unisciLotti(esistenti: readonly LottoUnito[], nuovi: readonly LottoUnito[], fonteNuova: FonteUnita, versioneNuovaPiuRecente: boolean): EsitoLotti {
  if (esistenti.length === 0) return { lotti: nuovi.map((l) => ({ ...l })), cigScartati: 0, allineati: true };
  const perNumero = new Map(esistenti.map((l) => [l.numero_lotto, l]));
  const perIdentificativo =
    nuovi.length > 0 && [...esistenti, ...nuovi].every((l) => identificativoLottoStabile(l.numero_lotto)) && nuovi.every((n) => perNumero.has(n.numero_lotto));
  const allineati =
    perIdentificativo ||
    (esistenti.length === nuovi.length &&
      nuovi.every((n) => {
        const e = perNumero.get(n.numero_lotto);
        return !!e && stessoImporto(e.valore_stimato, n.valore_stimato);
      }));
  if (!allineati) {
    return { lotti: esistenti.map((l) => ({ ...l })), cigScartati: nuovi.filter((l) => l.cig && !esistenti.some((e) => e.cig === l.cig)).length, allineati: false };
  }
  let cigScartati = 0;
  const lotti = esistenti.map((e) => {
    const n = nuovi.find((x) => x.numero_lotto === e.numero_lotto);
    // solo per identificativo: il lotto che la versione nuova non elenca più resta com'era
    if (!n) return { ...e };
    const pvl = fonteNuova === "pvl";
    const out: LottoUnito = { ...e };
    if (n.cig) {
      if (!e.cig) out.cig = n.cig;
      else if (e.cig !== n.cig) cigScartati++;
    }
    // testi e documenti: precedenza alla PVL; gli altri dati riempiono i vuoti, o sostituiscono se la versione è più recente
    const sostituisci = <K extends keyof LottoUnito>(k: K, precede: boolean) => {
      if (vuoto(n[k])) return;
      if (vuoto(e[k]) || precede) out[k] = n[k];
    };
    sostituisci("oggetto", pvl);
    sostituisci("url_documenti", pvl);
    sostituisci("cpv_principale", false);
    sostituisci("valore_stimato", versioneNuovaPiuRecente);
    sostituisci("durata_mesi", versioneNuovaPiuRecente);
    // difetto del C8 (23/11/2026, 5 gare dello staging): una scadenza SOLO GIORNO (Sintel) non sostituisce una scadenza con l'ora dello
    // STESSO giorno: l'ora scritta da una fonte ufficiale per quel giorno resta, come per la gara (unisciVersione). Un giorno DIVERSO
    // (proroga o rettifica) vale sempre, anche senza ora
    const perderebbeOra = n.scadenza_giorno === e.scadenza_giorno && e.scadenza_ora_indicata && !!e.scadenza_offerte && !n.scadenza_ora_indicata;
    if (n.scadenza_giorno && !perderebbeOra && (!e.scadenza_giorno || versioneNuovaPiuRecente || (pvl && !e.scadenza_offerte && n.scadenza_offerte))) {
      out.scadenza_giorno = n.scadenza_giorno;
      out.scadenza_offerte = n.scadenza_offerte;
      out.scadenza_ora_indicata = n.scadenza_ora_indicata;
      out.scadenza_fonte = n.scadenza_fonte;
    }
    out.cpv_tutti = [...new Set([...e.cpv_tutti, ...n.cpv_tutti])];
    return out;
  });
  return { lotti, cigScartati, allineati: true };
}

/**
 * Fonti la cui scadenza della GARA non dice se una scadenza è cambiata davvero: Sintel (è la minima dei lotti ancora aperti, e salta in
 * avanti quando il primo lotto si chiude). Per queste le righe dei lotti si scrivono sempre, anche con un solo lotto, e solo quelle possono
 * portare un'email (importa-evidenza.ts, affidabilitaDi).
 */
export const FONTI_SCADENZA_PER_LOTTO: readonly FonteUnita[] = ["sintel"];

function stessoValoreDiScadenza(a: Scadenza, b: Scadenza): boolean {
  if (a.giorno !== b.giorno) return false;
  if (a.iso && b.iso) return Date.parse(a.iso) === Date.parse(b.iso);
  return !a.iso && !b.iso;
}

/**
 * Fase B4 (difetto «proroga di un solo lotto», 20/11/2026): le scadenze dei LOTTI cambiate tra i lotti in archivio e quelli che si
 * scrivono, come righe del registro con il lotto nel campo: «scadenza_offerte@<CIG, altrimenti numero del lotto>» (26B A.2, stesso campo del
 * rilevamento PVL). Chi chiama la usa SOLO con una versione strettamente più recente e SOLO se i lotti si scrivono davvero.
 *   - si confrontano solo i lotti presenti prima e dopo, con una scadenza in entrambe: un lotto che esce dall'elenco, o una scadenza che
 *     compare o sparisce, non è una proroga; stessa regola della gara (cambioDiScadenza: istante, ora che sparisce nello stesso giorno);
 *   - un solo lotto: la riga della gara dice già tutto (salvo FONTI_SCADENZA_PER_LOTTO);
 *   - più lotti: le righe si omettono solo se TUTTI i lotti cambiano esattamente come la gara (la riga della gara lo dice già); altrimenti
 *     ogni lotto cambiato ha la sua riga, anche quello che coincide con la gara (stessa regola di modifiche-pvl.ts).
 */
export function cambiamentiDeiLotti(
  prima: readonly LottoUnito[],
  dopo: readonly LottoUnito[],
  fonte: FonteUnita,
  // i cambiamenti della gara nella stessa versione: servono solo campo, prima e dopo (gli importatori li tengono con il tipo come testo)
  cambiamentiGara: readonly Pick<Cambiamento, "campo" | "prima" | "dopo">[],
): Cambiamento[] {
  const perNumero = new Map(prima.map((l) => [l.numero_lotto, l]));
  const scadenza = (l: LottoUnito): Scadenza => ({ giorno: l.scadenza_giorno, iso: l.scadenza_offerte });
  let comuni = 0;
  const righe: { cambio: Cambiamento; prima: Scadenza; dopo: Scadenza }[] = [];
  for (const d of dopo) {
    const p = perNumero.get(d.numero_lotto);
    if (!p || !p.scadenza_giorno || !d.scadenza_giorno) continue;
    comuni++;
    const cambio = cambioDiScadenza(scadenza(p), scadenza(d), `scadenza_offerte@${d.cig ?? d.numero_lotto}`.slice(0, 60));
    if (cambio) righe.push({ cambio, prima: scadenza(p), dopo: scadenza(d) });
  }
  if (righe.length === 0) return [];
  if (!FONTI_SCADENZA_PER_LOTTO.includes(fonte)) {
    if (Math.max(prima.length, dopo.length) <= 1) return [];
    const gara = cambiamentiGara.find((c) => c.campo === "scadenza_offerte");
    const comeLaGara = !!gara && righe.length === comuni && righe.every((r) => stessoValoreDiScadenza(r.prima, scadenzaDaValore(gara.prima)) && stessoValoreDiScadenza(r.dopo, scadenzaDaValore(gara.dopo)));
    if (comeLaGara) return [];
  }
  return righe.map((r) => r.cambio);
}
