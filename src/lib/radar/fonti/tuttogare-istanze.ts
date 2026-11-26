// TuttoGare (Fase 2, seconda priorità del documento 60): ANAGRAFICA delle istanze lette dall'unica fonte «tuttogare» (un adattatore per
// molti enti, decisione del coordinamento del 26/11). Solo dati di configurazione e il riconoscimento dei collegamenti: nessuna rete, nessun
// database, nessun import (la usano piattaforme-calcoli.ts e tuttogare-calcoli.ts).
//
// Da dove vengono le istanze del pilota:
//   - ricognizione R4 del 26/11 (allegati/60/R4_tuttogare_portaleappalti.md): Roma Capitale, Università di Bari, Regione Siciliana, con lo
//     stesso formato verificato sulle tre;
//   - collegamenti già presenti nell'archivio (D3 del 26/11, allegati/60/D3_risultato_26nov.csv): i domini «*.tuttogare.it» con più gare.
//
// DA CONFERMARE sul campione (prima del collaudo): nome esatto degli enti, regione delle centrali di committenza, beneficiari delle istanze a
// più enti. I CODICI FISCALI NON si scrivono qui finché non vengono dall'anagrafica ufficiale (IPA) o dal CIG tramite la PVL: mai indovinati.
// La scoperta automatica di altre istanze è un tema a parte (non ora).
import type { IdRegione } from "../territorio";

export type EnteTuttoGare = { denominazione: string; codiceFiscale: string | null; comune: string | null; provincia: string | null };

export type IstanzaTuttoGare = {
  // host canonico (minuscolo): l'identità delle gare è «tuttogare:<host>:<codice>»
  host: string;
  // host che reindirizzano a quello canonico (R4: romacapitale.tuttogare.it → 301 → appalti.comune.roma.it); un collegamento verso un alias
  // dà la stessa identità. Il lettore usa SOLO l'host canonico
  alias: readonly string[];
  nome: string;
  // regione delle gare (sede dell'ente); null = da confermare (la gara resta senza regione, mai una regione presunta)
  regione: IdRegione | null;
  // l'ente titolare dell'istanza. In un'istanza a più enti (centrale di committenza) è la centrale: l'ente della gara è il beneficiario
  ente: EnteTuttoGare;
  multiEnte: boolean;
  // beneficiario (come lo scrive la fonte, ridotto con chiaveBeneficiario) → ente. Vuota finché il campione non la riempie: un beneficiario
  // fuori mappa si scrive com'è, senza codice fiscale (mancante «codice_fiscale_ente»)
  beneficiari: Readonly<Record<string, EnteTuttoGare>>;
  // l'istanza si legge (oltre alle guardie della fonte: canale confermato, staging, riga accesa)
  attiva: boolean;
  // tetto di richieste per giro su questa istanza, home compresa (le altre gare si leggono ai giri seguenti)
  richiesteMassime: number;
  scoperta: "R4" | "D3";
};

export const ISTANZE_TUTTOGARE: readonly IstanzaTuttoGare[] = [
  {
    host: "appalti.comune.roma.it",
    alias: ["romacapitale.tuttogare.it"],
    nome: "Roma Capitale",
    regione: "lazio",
    ente: { denominazione: "Roma Capitale", codiceFiscale: null, comune: "Roma", provincia: "RM" },
    multiEnte: false,
    beneficiari: {},
    attiva: true,
    richiesteMassime: 12,
    scoperta: "R4",
  },
  {
    host: "gareappalti.uniba.it",
    alias: [],
    nome: "Università degli Studi di Bari Aldo Moro",
    regione: "puglia",
    ente: { denominazione: "Università degli Studi di Bari Aldo Moro", codiceFiscale: null, comune: "Bari", provincia: "BA" },
    // R4: un avviso con beneficiario Uniba ma sedi di un liceo fiorentino. Un beneficiario diverso dall'ente si scrive com'è e si segnala
    // («ente_da_verificare»), mai attribuito all'università
    multiEnte: false,
    beneficiari: {},
    attiva: true,
    richiesteMassime: 12,
    scoperta: "R4",
  },
  {
    host: "appalti.regionesiciliana.lavoripubblici.sicilia.it",
    alias: [],
    nome: "Regione Siciliana – centrale di committenza dei lavori pubblici",
    regione: "sicilia",
    ente: { denominazione: "Regione Siciliana", codiceFiscale: null, comune: null, provincia: null },
    multiEnte: true,
    beneficiari: {},
    attiva: true,
    richiesteMassime: 12,
    scoperta: "R4",
  },
  {
    host: "cuccastellidellasapienza.tuttogare.it",
    alias: [],
    nome: "Centrale unica di committenza «Castelli della Sapienza»",
    // regione da confermare sul campione
    regione: null,
    ente: { denominazione: "Centrale unica di committenza Castelli della Sapienza", codiceFiscale: null, comune: null, provincia: null },
    multiEnte: true,
    beneficiari: {},
    attiva: true,
    richiesteMassime: 8,
    scoperta: "D3",
  },
  {
    host: "cucterradileuca.tuttogare.it",
    alias: [],
    nome: "Centrale unica di committenza «Terra di Leuca»",
    regione: "puglia",
    ente: { denominazione: "Centrale unica di committenza Terra di Leuca", codiceFiscale: null, comune: null, provincia: "LE" },
    multiEnte: true,
    beneficiari: {},
    attiva: true,
    richiesteMassime: 8,
    scoperta: "D3",
  },
];

// Le altre istanze trovate nei collegamenti dell'archivio (D3), NON nel pilota: anagrafica da costruire quando si estende.
export const ISTANZE_CANDIDATE_TUTTOGARE: readonly string[] = [
  "atmspa.tuttogare.it",
  "usrc.tuttogare.it",
  "cucunion3.tuttogare.it",
  "cucentroterraidruntino.tuttogare.it",
  "cuccasarano.tuttogare.it",
];

const HOST_VALIDO = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/;

/** L'istanza dell'anagrafica per un host (canonico o alias); null se l'host non è in anagrafica (mai riconosciuto per somiglianza). */
export function istanzaDaHost(host: string | null | undefined): IstanzaTuttoGare | null {
  const h = (host ?? "").trim().toLowerCase().replace(/\.$/, "");
  if (!HOST_VALIDO.test(h)) return null;
  return ISTANZE_TUTTOGARE.find((i) => i.host === h || i.alias.includes(h)) ?? null;
}

// il codice della gara nel collegamento del dettaglio (R4: «/gare/dettaglio.php?codice=N», confermato su 3 istanze): il codice dell'URL, NON
// il «Gara #» mostrato nella pagina
export const PERCORSO_DETTAGLIO_TUTTOGARE = "/gare/dettaglio.php";

/**
 * «https://romacapitale.tuttogare.it/gare/dettaglio.php?codice=4321» → «tuttogare:appalti.comune.roma.it:4321». SOLO istanze in anagrafica,
 * SOLO la pagina del dettaglio con il parametro «codice» numerico; altrimenti null.
 */
export function idTuttoGareDaUrl(url: string | null | undefined): string | null {
  const s = (url ?? "").trim().replace(/&amp;/g, "&");
  if (!s || s.length > 2000) return null;
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  const istanza = istanzaDaHost(u.hostname);
  if (!istanza || u.pathname !== PERCORSO_DETTAGLIO_TUTTOGARE) return null;
  const codici = u.searchParams.getAll("codice");
  if (codici.length !== 1 || !/^\d{1,12}$/.test(codici[0])) return null;
  return `tuttogare:${istanza.host}:${codici[0]}`;
}
