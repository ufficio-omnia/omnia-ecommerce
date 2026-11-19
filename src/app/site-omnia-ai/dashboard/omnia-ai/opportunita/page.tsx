import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { richiediOpportunitaPagina } from "@/lib/radar/guardie-opportunita";
import { dirittoRadarOppure404, RADICE_OPPORTUNITA } from "@/lib/radar/area-cliente";
import { perTeAttivo } from "@/lib/radar/interruttori-b4";
import { leggiProfiloRadar } from "@/lib/radar/profilo";
import { profiloVuoto } from "@/lib/radar/profilo-calcoli";

// «Opportunità»: si apre su «Cerca». Fase B4 (grado 1): con RADAR_PER_TE acceso (solo staging) e un profilo con almeno un settore, si apre
// su «Per te» (1 lettura per chiave del profilo, con la sessione dell'utente).
export default async function OpportunitaPage() {
  const sessione = await richiediOpportunitaPagina();
  if (!sessione) return null;
  await dirittoRadarOppure404(sessione.contesto.accountId);
  if (perTeAttivo(process.env)) {
    const { profilo } = await leggiProfiloRadar(await createClient(), sessione.contesto.accountId);
    if (!profiloVuoto(profilo)) redirect(`${RADICE_OPPORTUNITA}/per-te`);
  }
  redirect(`${RADICE_OPPORTUNITA}/cerca`);
}
