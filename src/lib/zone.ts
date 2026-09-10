// Le tre zone di dominio del progetto: app.omniaitalia.com (e-commerce,
// invariato), omnia-ai.it (vetrina + area riservata AI, non ancora
// costruita) e console.omniaitalia.com (pannello admin futuro). Costanti
// condivise tra src/proxy.ts (risolve la zona e riscrive la richiesta) e
// src/app/robots.ts / sitemap.ts (devono ragionare sulla stessa zona per
// decidere cosa indicizzare).

export type Zone = "ecommerce" | "omnia-ai" | "console";

export const ECOMMERCE_HOST = "app.omniaitalia.com";

// Un host non in questa mappa (dominio tecnico *.vercel.app incluso)
// ricade sulla zona "ecommerce" per il ROUTING (comportamento identico a
// oggi, non deve rompersi nulla) — ma NON per l'indicizzazione: vedere
// isRecognizedHost sotto, che src/app/robots.ts usa per trattare uno
// sconosciuto in modo restrittivo anche se dal punto di vista del
// routing "funziona" come l'e-commerce.
const ZONE_HOSTS: Record<string, Zone> = {
  "omnia-ai.it": "omnia-ai",
  "www.omnia-ai.it": "omnia-ai",
  "console.omniaitalia.com": "console",
};

export const ZONE_PREFIX: Record<Exclude<Zone, "ecommerce">, string> = {
  "omnia-ai": "/site-omnia-ai",
  "console": "/site-console",
};

export const RESERVED_PREFIXES = Object.values(ZONE_PREFIX);

// robots.txt e sitemap.xml DEVONO restare raggiungibili al path canonico
// (è lì che un crawler li cerca, per specifica — un path riscritto sotto
// /site-omnia-ai non verrebbe mai trovato). src/app/robots.ts e
// src/app/sitemap.ts fanno già da soli la propria distinzione per zona
// leggendo host/cookie internamente: qui basta escluderli dal rewrite di
// zona, non dal resto (restano comunque fuori zona "ecommerce" per
// qualunque altro path).
export const ZONE_REWRITE_EXEMPT_PATHS = ["/robots.txt", "/sitemap.xml"];

// Cookie di override SOLO sviluppo (mai letto/scritto in produzione):
// permette di provare le tre zone da localhost, dove l'hostname reale
// non aiuta. Vedi src/proxy.ts.
export const DEV_ZONE_COOKIE = "__omnia_dev_zone";

// Cookie leggero, leggibile da JS, che riflette la zona risolta per la
// richiesta corrente — sia in produzione (hostname reale) sia in
// sviluppo (segue l'override). Serve a componenti client come
// CookieConsent per sapere in che zona si trovano SENZA che il root
// layout condiviso debba leggere headers() (che lo renderebbe dinamico
// ovunque, e-commerce incluso).
export const ZONE_COOKIE = "omnia_zone";

// Header di richiesta (non risposta) che src/proxy.ts imposta SEMPRE con
// la zona appena risolta, prima che la pagina/route venga renderizzata:
// a differenza del cookie sopra (che riflette la richiesta PRECEDENTE,
// perché un Set-Cookie si applica solo alle richieste successive), un
// Server Component nella stessa richiesta — es. src/app/robots.ts,
// sitemap.ts — può leggere la zona corretta e corrente via
// headers().get(ZONE_HEADER), senza il ritardo di un giro del cookie.
export const ZONE_HEADER = "x-omnia-zone";

// Header gemello di ZONE_HEADER: "1" solo se l'host è uno dei tre
// previsti (o, in sviluppo, se è attivo un override esplicito — un dev
// che sceglie deliberatamente una zona la sta simulando, va trattata
// come riconosciuta). Un host sconosciuto risolve comunque zona
// "ecommerce" per il ROUTING (fallback sicuro, non deve rompere nulla),
// ma qui risulta "0": src/app/robots.ts lo usa per non indicizzare un
// dominio tecnico *.vercel.app solo perché instrada come l'e-commerce.
export const ZONE_RECOGNIZED_HEADER = "x-omnia-host-recognized";

export function isZone(value: string | null | undefined): value is Zone {
  return value === "ecommerce" || value === "omnia-ai" || value === "console";
}

export function zoneFromHost(host: string | null | undefined): Zone {
  return ZONE_HOSTS[normalizeHost(host)] ?? "ecommerce";
}

export function isRecognizedHost(host: string | null | undefined): boolean {
  const normalized = normalizeHost(host);
  return normalized === ECOMMERCE_HOST || normalized in ZONE_HOSTS;
}

function normalizeHost(host: string | null | undefined): string {
  return host?.split(":")[0]?.toLowerCase() ?? "";
}
