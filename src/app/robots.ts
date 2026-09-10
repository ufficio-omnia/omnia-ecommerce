import type { MetadataRoute } from "next";
import { headers } from "next/headers";
import { ZONE_HEADER, ZONE_RECOGNIZED_HEADER, isZone } from "@/lib/zone";

export default async function robots(): Promise<MetadataRoute.Robots> {
  // src/proxy.ts risolve già la zona (hostname reale in produzione,
  // override di sviluppo in locale) e la inoltra su questi header per la
  // richiesta CORRENTE — niente da ricalcolare qui.
  const hdrs = await headers();
  const zoneHeader = hdrs.get(ZONE_HEADER);
  const zone = isZone(zoneHeader) ? zoneHeader : "ecommerce";
  const recognized = hdrs.get(ZONE_RECOGNIZED_HEADER) === "1";

  // "ecommerce" copre sia il vero app.omniaitalia.com SIA un host
  // sconosciuto (dominio tecnico *.vercel.app incluso), che il ROUTING
  // fa comunque funzionare come l'e-commerce per non rompere nulla — ma
  // qui, per l'indicizzazione, solo l'host RICONOSCIUTO può avere
  // "allow": altrimenti si indicizzerebbe lo stesso sito su due
  // indirizzi (contenuto duplicato).
  if (zone === "ecommerce" && recognized) {
    return {
      rules: { userAgent: "*", allow: "/" },
      sitemap: "https://app.omniaitalia.com/sitemap.xml",
    };
  }

  if (zone === "omnia-ai") {
    // Vetrina non ancora pubblicata: nessun riferimento all'e-commerce,
    // nessuna sitemap finché non c'è nulla da elencare.
    return { rules: { userAgent: "*", allow: "/" } };
  }

  // Zona "console" e qualunque host non riconosciuto: mai indicizzabili
  // di default. Il default dev'essere restrittivo qui, a differenza del
  // ROUTING.
  return { rules: { userAgent: "*", disallow: "/" } };
}
