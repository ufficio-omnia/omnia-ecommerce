import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { richiediOpportunitaPagina } from "@/lib/radar/guardie-opportunita";
import { dirittoRadarOppure404 } from "@/lib/radar/area-cliente";
import { perTeAttivo } from "@/lib/radar/interruttori-b4";
import { leggiProfiloRadar } from "@/lib/radar/profilo";
import { SETTORI_RADAR } from "@/lib/radar/settori";
import { vociCatalogo } from "@/lib/radar/settori-catalogo";
import { REGIONI } from "@/lib/radar/territorio";
import { PROCEDURE_RICERCA } from "@/lib/radar/ricerca-calcoli";
import TestataOpportunita from "@/components/omnia-ai/opportunita/testata-opportunita";
import ProfiloForm from "@/components/omnia-ai/opportunita/profilo-form";

// Profilo di ricerca dell'impresa (fase B4, grado 1, RADAR_PER_TE acceso solo sullo staging). Un profilo per impresa; lo modifica SOLO il
// titolare (l'azione salvaProfiloRadar parte dalla sua guardia); l'Ufficio Gare, con il grado 2 acceso, lo vede in sola lettura.
// Sottocategorie dal catalogo stabile della PVL (settori-catalogo.ts). 1 lettura per chiave del profilo, con la sessione dell'utente.
export default async function ProfiloRicercaPage() {
  const sessione = await richiediOpportunitaPagina();
  if (!sessione) return null;
  const { contesto } = sessione;
  const { diritto } = await dirittoRadarOppure404(contesto.accountId);
  if (!perTeAttivo(process.env)) notFound();
  const { disponibile, profilo } = await leggiProfiloRadar(await createClient(), contesto.accountId);
  const titolare = contesto.ruolo === "titolare";
  const sottocategorie = Object.fromEntries(SETTORI_RADAR.map((s) => [s.id, vociCatalogo(s.id).map((v) => ({ id: v.id, nome: v.nome }))]));

  return (
    <div className="omnia-app-shell">
      <TestataOpportunita
        attiva="profilo"
        sottotitolo={
          titolare
            ? "Indica che cosa cerca l'impresa: «Per te» mostrerà solo le gare aperte pertinenti a questo profilo."
            : "Il profilo di ricerca dell'impresa, scelto dal titolare: «Per te» mostra le gare aperte pertinenti a questo profilo."
        }
      />
      {!disponibile ? (
        <p className="omnia-messaggio-stato avviso">Il profilo di ricerca non è ancora disponibile.</p>
      ) : (
        <div className="omnia-riquadro">
          {titolare && !diritto.operativo && <p className="omnia-messaggio-stato avviso">{diritto.messaggioSolaLettura}</p>}
          <ProfiloForm
            soloLettura={!titolare || !diritto.operativo}
            valori={{
              settori: profilo?.settori ?? [],
              sottocategorie: profilo?.sottocategorie ?? {},
              regioni: profilo?.regioni ?? [],
              procedure: profilo?.procedure ?? [],
              importoMin: profilo?.importoMin ?? null,
              importoMax: profilo?.importoMax ?? null,
              vedereCorrelate: profilo?.vedereCorrelate ?? false,
            }}
            settori={SETTORI_RADAR.map((s) => ({ id: s.id, nome: s.nome }))}
            sottocategorie={sottocategorie}
            regioni={REGIONI.map((r) => ({ id: r.id, nome: r.nome }))}
            procedure={PROCEDURE_RICERCA.map((p) => ({ id: p.id, nome: p.etichetta }))}
          />
        </div>
      )}
    </div>
  );
}
