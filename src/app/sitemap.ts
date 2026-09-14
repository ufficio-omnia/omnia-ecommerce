import type { MetadataRoute } from "next";
import { headers } from "next/headers";
import { BASE_URL, ZONE_HEADER, ZONE_RECOGNIZED_HEADER, isZone } from "@/lib/zone";
import { createClient } from "@/lib/supabase/server";

const STATIC_ROUTES = ["/", "/prodotti", "/condizioni-vendita", "/cookie-policy", "/privacy"];

// Niente `export const revalidate`: la funzione chiama headers(), quindi
// la rotta è già dinamica per Next e l'ISR non si applicherebbe comunque
// — un revalidate qui darebbe la falsa impressione di una cache che non
// esiste.
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

  const staticEntries: MetadataRoute.Sitemap = STATIC_ROUTES.map((route) => ({
    url: `${BASE_URL}${route}`,
    lastModified: new Date(),
  }));

  // Stesso filtro di /prodotti (solo prodotti attivi), stesso client anon
  // server-side. Se Supabase non risponde la sitemap resta valida con le
  // sole pagine statiche — non deve mai rompere la build/response — ma
  // l'errore va comunque loggato, altrimenti un guasto reale passerebbe
  // inosservato dietro un 200 silenzioso.
  let productEntries: MetadataRoute.Sitemap = [];
  try {
    const supabase = await createClient();
    const { data: products, error } = await supabase
      .from("products")
      .select("id, created_at")
      .eq("active", true);

    if (error) {
      console.error("sitemap: query prodotti attivi fallita", error);
    } else {
      productEntries = (products ?? []).map((p) => ({
        url: `${BASE_URL}/prodotti/${p.id}`,
        // updated_at non esiste ancora sulla tabella products (solo
        // created_at): meglio una data reale ma non aggiornata a ogni
        // modifica che new Date(), che farebbe risultare tutto "cambiato
        // adesso" a ogni fetch della sitemap.
        ...(p.created_at ? { lastModified: new Date(p.created_at) } : {}),
      }));
    }
  } catch (err) {
    console.error("sitemap: eccezione durante la query prodotti", err);
  }

  return [...staticEntries, ...productEntries];
}
