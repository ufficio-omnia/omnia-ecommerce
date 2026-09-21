import type { MetadataRoute } from "next";
import { headers } from "next/headers";
import { BASE_URL, OMNIA_AI_BASE_URL, ZONE_HEADER, ZONE_RECOGNIZED_HEADER, isZone } from "@/lib/zone";
import { createClient } from "@/lib/supabase/server";

// Pagine pubbliche di omnia-ai.it. Restano fuori di proposito: login,
// registrazione, attivazione account, impostazione password, checkout
// diretto (/abbonati/*), conferma pagamento, dashboard, /api, /auth e
// le versioni archiviate /documenti-legali/* (duplicano le pagine legali
// qui sotto).
//
// lastModified è una data FISSA, quella dell'ultima modifica reale dei
// contenuti (dalla storia git): con new Date() ogni fetch direbbe "cambiato
// adesso" e Google imparerebbe a ignorare il campo. Va aggiornata a mano
// quando cambia il contenuto della pagina corrispondente.
const OMNIA_AI_ROUTES: { path: string; lastModified: string }[] = [
  { path: "/", lastModified: "2026-09-10" },
  { path: "/come-funziona", lastModified: "2026-09-15" },
  { path: "/piani", lastModified: "2026-09-15" },
  { path: "/demo", lastModified: "2026-09-10" },
  { path: "/contatti", lastModified: "2026-09-10" },
  { path: "/privacy", lastModified: "2026-09-11" },
  { path: "/cookie-policy", lastModified: "2026-09-11" },
  { path: "/condizioni-abbonamento", lastModified: "2026-09-11" },
];

const STATIC_ROUTES = [
  "/",
  "/prodotti",
  "/condizioni-vendita",
  "/cookie-policy",
  "/privacy",
  "/offerta-tecnica-gare-appalto-pulizia",
];

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

  // omnia-ai.it: elenco statico, nessuna query — risponde anche se
  // Supabase non è raggiungibile.
  if (zone === "omnia-ai") {
    return OMNIA_AI_ROUTES.map(({ path, lastModified }) => ({
      url: `${OMNIA_AI_BASE_URL}${path}`,
      lastModified,
    }));
  }

  // Per le altre zone solo l'e-commerce riconosciuto ha qualcosa da
  // elencare: un host sconosciuto che il routing fa comunque funzionare
  // come l'e-commerce (vedi robots.ts) non deve ricevere lo stesso
  // elenco di URL.
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
