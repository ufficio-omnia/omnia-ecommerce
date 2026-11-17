// Identificativo della procedura sulla piattaforma di gara, ricavato da un collegamento ufficiale. Serve a riconoscere la stessa gara
// letta da due fonti quando manca il CIG (documento 09, §6.1, livello 3). Logica pura, nessuna rete, nessun database.
//
// Verificato il 16/11/2026 sullo staging (sola lettura): le gare TED con documenti su SardegnaCAT hanno nel collegamento
// «DettaglioProcedura.asp?ID=<numero>» (11 su 12) e quel numero è l'identificativo «IdMsg» del feed ufficiale (2 su 2 tra le gare
// aperte). Per Sintel il collegamento con «auctionDetail.xhtml?id=<numero>» è raro nei bandi TED (6 su 125): si riconosce, ma non basta
// per l'abbinamento (decisione S9 aperta).
//
// Si riconoscono SOLO le piattaforme elencate qui: un identificativo non si presume mai per somiglianza dell'indirizzo.

export type PiattaformaNota = "sardegnacat" | "sintel";

type Regola = { piattaforma: PiattaformaNota; host: RegExp; id: RegExp };

const REGOLE: readonly Regola[] = [
  // SardegnaCAT: SOLO la pagina di dettaglio della procedura, l'unica forma che compare nei collegamenti degli avvisi (13 su 13 sullo
  // staging il 17/11). La forma «bando=» del portale nuovo non compare mai nei collegamenti e non si riconosce (il feed dà l'identificativo
  // direttamente, IdMsg). Numero tecnico della piattaforma: serve SOLO ai suggerimenti, mai a unire in automatico.
  { piattaforma: "sardegnacat", host: /^(www\.)?sardegnacat\.regione\.sardegna\.it$/i, id: /\/DettaglioProcedura\.asp\?(?:[^#]*&)?ID=(\d{1,12})(?:&|$)/ },
  // Sintel (Regione Lombardia, ARIA): dettaglio dell'asta
  { piattaforma: "sintel", host: /^(www\.)?sintel\.regione\.lombardia\.it$/i, id: /auctionDetail\.xhtml\?(?:[^#]*&)?id=(\d{1,12})(?:&|$)/ },
];

// «https://sardegnacat.regione.sardegna.it/Application/CustomDoc/DettaglioProcedura.asp?ID=1031830» → «sardegnacat:1031830».
export function idPiattaformaDaUrl(url: string | null | undefined): string | null {
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
  for (const r of REGOLE) {
    if (!r.host.test(u.hostname)) continue;
    const m = resto.match(r.id);
    if (m) return `${r.piattaforma}:${m[1]}`;
  }
  return null;
}

export function idPiattaforma(piattaforma: PiattaformaNota, id: string): string | null {
  return /^\d{1,12}$/.test(id) ? `${piattaforma}:${id}` : null;
}
