// Identificativo della procedura sulla piattaforma di gara, ricavato da un collegamento ufficiale. Serve a riconoscere la stessa gara
// letta da due fonti quando manca il CIG (documento 09, §6.1, livello 3). Logica pura, nessuna rete, nessun database.
//
// Verificato il 16/11/2026 sullo staging (sola lettura): le gare TED con documenti su SardegnaCAT hanno nel collegamento
// «DettaglioProcedura.asp?ID=<numero>» (11 su 12) e quel numero è l'identificativo «IdMsg» del feed ufficiale (2 su 2 tra le gare
// aperte). Per Sintel il collegamento con «auctionDetail.xhtml?id=<numero>» è raro nei bandi TED (6 su 125): si riconosce, ma non basta
// per l'abbinamento (decisione S9 aperta).
//
// Si riconoscono SOLO le piattaforme elencate qui: un identificativo non si presume mai per somiglianza dell'indirizzo.
import { idTuttoGareDaUrl } from "./tuttogare-istanze";

// Fase 2: «empulia» e «siaps» (piattaforme AF Soluzioni come SardegnaCAT): l'IdMsg del feed è l'identificativo della procedura nei
// collegamenti pubblici (ricognizione del 27/11: EmPULIA 40 su 40 nel link di dettaglio; SIAPS 2 id su 2 uguali ai collegamenti PVL/TED in
// archivio). Solo per i connettori: TED e PVL non riconoscono queste forme (nessun cambio a ciò che scrivono).
export type PiattaformaNota = "sardegnacat" | "sintel" | "sater" | "empulia" | "siaps";

type Regola = { piattaforma: PiattaformaNota; host: RegExp; id: RegExp };

const REGOLE: readonly Regola[] = [
  // SardegnaCAT: SOLO la pagina di dettaglio della procedura, l'unica forma che compare nei collegamenti degli avvisi (13 su 13 sullo
  // staging il 17/11). La forma «bando=» del portale nuovo non compare mai nei collegamenti e non si riconosce (il feed dà l'identificativo
  // direttamente, IdMsg). Numero tecnico della piattaforma: serve SOLO ai suggerimenti, mai a unire in automatico.
  { piattaforma: "sardegnacat", host: /^(www\.)?sardegnacat\.regione\.sardegna\.it$/i, id: /\/DettaglioProcedura\.asp\?(?:[^#]*&)?ID=(\d{1,12})(?:&|$)/ },
  // Sintel (Regione Lombardia, ARIA): dettaglio dell'asta
  { piattaforma: "sintel", host: /^(www\.)?sintel\.regione\.lombardia\.it$/i, id: /auctionDetail\.xhtml\?(?:[^#]*&)?id=(\d{1,12})(?:&|$)/ },
];

// Fase 2 (connettore SATER): forme riconosciute SOLO dai connettori delle piattaforme, NON dagli importatori di TED e PVL (rigaDaBando usa
// idPiattaformaDaUrl). Aggiungerle là cambierebbe ciò che scrivono oggi le fonti online (piattaforma_id delle gare emiliane e proposte di
// collegamento in console): è una decisione a parte.
const REGOLE_CONNETTORI: readonly Regola[] = [
  // Intercent-ER / SATER: collegamento permanente «trovabando» alla procedura (BT-15 degli avvisi PVL e TED; sullo staging il 26/11 sempre
  // nella forma «/trovabando/BANDO_GARA_PORTALE@<numero>»). È anche il collegamento che l'API del portale dà per ogni bando.
  { piattaforma: "sater", host: /^intercenter\.regione\.emilia-romagna\.it$/i, id: /^\/trovabando\/BANDO_GARA_PORTALE@(\d{1,12})\/?(?:\?|$)/ },
];

function idDaRegole(url: string | null | undefined, regole: readonly Regola[]): string | null {
  const s = (url ?? "").trim();
  if (!s) return null;
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  const resto = `${u.pathname}${u.search}`;
  for (const r of regole) {
    if (!r.host.test(u.hostname)) continue;
    const m = resto.match(r.id);
    if (m) return `${r.piattaforma}:${m[1]}`;
  }
  return null;
}

// «https://sardegnacat.regione.sardegna.it/Application/CustomDoc/DettaglioProcedura.asp?ID=1031830» → «sardegnacat:1031830».
export function idPiattaformaDaUrl(url: string | null | undefined): string | null {
  return idDaRegole(url, REGOLE);
}

// Come idPiattaformaDaUrl, più le forme dei soli connettori (REGOLE_CONNETTORI):
// «https://intercenter.regione.emilia-romagna.it/trovabando/BANDO_GARA_PORTALE@17652665» → «sater:17652665».
// TuttoGare (Fase 2, in costruzione): la pagina del dettaglio delle SOLE istanze in anagrafica (tuttogare-istanze.ts), con l'host nella
// chiave perché il codice è dell'istanza: «tuttogare:<host>:<codice>». Anche questa solo nei connettori (stessa decisione a parte di SATER).
// È l'identità (la CHIAVE della gara), non un valore di piattaforma_id: quella forma non rispetta il vincolo della 0120 (decisione (b) del
// coordinamento del 26/11: piattaforma_id vuoto per TuttoGare).
export function idPiattaformaDaUrlConnettore(url: string | null | undefined): string | null {
  return idDaRegole(url, REGOLE) ?? idDaRegole(url, REGOLE_CONNETTORI) ?? idTuttoGareDaUrl(url);
}

export function idPiattaforma(piattaforma: PiattaformaNota, id: string): string | null {
  return /^\d{1,12}$/.test(id) ? `${piattaforma}:${id}` : null;
}
