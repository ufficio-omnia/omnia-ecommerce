import type { ReactNode } from "react";
import { MarchioStatoProvider } from "./marchio-stato-context";
import MarchioStatoDriver from "./marchio-stato-driver";
import SidebarNav from "./sidebar-nav";
import Topbar from "./topbar";
import type { VoceMenu } from "@/lib/omnia-ai-account-calcoli";

// Monta il provider di stato del marchio (esisteva già ma non era mai
// stato agganciato dentro la dashboard) attorno a sidebar + contenuto:
// sono fratelli nel DOM, non genitore/figlio, quindi lo stato deve vivere
// sopra entrambi. Gli avvisi (sola lettura/fatturazione/profilo) restano
// fuori da .omnia-content-interno: sono barre a piena larghezza sopra il
// contenuto della pagina, non dentro il suo contenitore centrato.
export default function DashboardShell({
  nomeSaluto,
  email,
  nomeAzienda,
  avvisi,
  voci,
  children,
}: {
  nomeSaluto: string;
  email: string;
  nomeAzienda: string | null;
  avvisi?: ReactNode;
  // voci della barra laterale (se mancano: quelle del titolare)
  voci?: VoceMenu[];
  children: ReactNode;
}) {
  return (
    <MarchioStatoProvider>
      <MarchioStatoDriver />
      <div className="omnia-shell">
        <SidebarNav nomeAzienda={nomeAzienda} voci={voci} />
        <div className="omnia-content">
          {avvisi}
          <div className="omnia-content-interno">
            <Topbar nomeSaluto={nomeSaluto} email={email} />
            {children}
          </div>
        </div>
      </div>
    </MarchioStatoProvider>
  );
}
