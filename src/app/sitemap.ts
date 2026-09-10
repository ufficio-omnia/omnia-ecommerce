import type { MetadataRoute } from "next";
import { headers } from "next/headers";
import { ZONE_HEADER, ZONE_RECOGNIZED_HEADER, isZone } from "@/lib/zone";

const BASE_URL = "https://app.omniaitalia.com";

// Solo le route statiche note in questo passo: niente query Supabase per
// i singoli prodotti (/prodotti/[id]) — si estende quando lavoreremo
// davvero sulle pagine prodotto, questo passo riguarda solo
// l'instradamento.
const STATIC_ROUTES = ["/", "/prodotti", "/condizioni-vendita", "/cookie-policy", "/privacy"];

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  // Stessa fonte di verità di robots.ts: la zona per QUESTA richiesta,
  // già risolta da src/proxy.ts.
  const hdrs = await headers();
  const zoneHeader = hdrs.get(ZONE_HEADER);
  const zone = isZone(zoneHeader) ? zoneHeader : "ecommerce";
  const recognized = hdrs.get(ZONE_RECOGNIZED_HEADER) === "1";

  // Solo l'e-commerce riconosciuto ha oggi qualcosa da elencare: un host
  // sconosciuto che il routing fa comunque funzionare come l'e-commerce
  // (vedi robots.ts) non deve ricevere lo stesso elenco di URL.
  if (zone !== "ecommerce" || !recognized) return [];

  return STATIC_ROUTES.map((route) => ({
    url: `${BASE_URL}${route}`,
    lastModified: new Date(),
  }));
}
