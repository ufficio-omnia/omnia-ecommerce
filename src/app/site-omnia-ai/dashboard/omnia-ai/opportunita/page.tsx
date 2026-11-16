import { redirect } from "next/navigation";
import { richiediTitolarePagina } from "@/lib/omnia-ai-account-guardie";
import { dirittoRadarOppure404, RADICE_OPPORTUNITA } from "@/lib/radar/area-cliente";

// «Opportunità»: in B1 si apre su «Cerca» («Per te», con il radar dell'impresa, arriva in B2 e prenderà questo indirizzo).
export default async function OpportunitaPage() {
  const sessione = await richiediTitolarePagina();
  if (!sessione) return null;
  await dirittoRadarOppure404(sessione.contesto.accountId);
  redirect(`${RADICE_OPPORTUNITA}/cerca`);
}
