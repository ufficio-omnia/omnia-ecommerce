// SOLO SUL RAMO D'ANTEPRIMA (mai in master). Osservatore di rete per il collaudo: con NODE_OPTIONS=--import=file:///<percorso di questo file> e
// OSSERVA_RETE_FILE=<file fuori dal repository> registra, per ogni richiesta in uscita del processo Node (fetch/undici e http/https), SOLO
// l'ora, il metodo, l'host e il percorso: MAI i parametri dell'indirizzo, le intestazioni, i contenuti, i token o le chiavi. Serve a contare
// le richieste a Supabase per vista e a dimostrare che vanno solo allo staging. Senza OSSERVA_RETE_FILE non fa nulla.
import dc from "node:diagnostics_channel";
import fs from "node:fs";

const file = process.env.OSSERVA_RETE_FILE;
if (file) {
  const scrivi = (metodo, origine, percorso) => {
    try {
      fs.appendFileSync(file, `${new Date().toISOString()} ${process.pid} ${String(metodo).toUpperCase()} ${origine}${String(percorso).split("?")[0]}\n`);
    } catch {
      // l'osservazione non deve mai disturbare il server
    }
  };
  dc.subscribe("undici:request:create", ({ request }) => scrivi(request.method, request.origin, request.path));
  dc.subscribe("http.client.request.start", ({ request }) => {
    const host = typeof request.getHeader === "function" ? request.getHeader("host") : request.host;
    scrivi(request.method, `${request.protocol ?? "http:"}//${host}`, request.path ?? "");
  });
}
