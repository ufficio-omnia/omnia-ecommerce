import { richiediAdminPagina } from "@/lib/console/accesso";
import BarraLaterale from "../_componenti/barra-laterale";

// Guscio delle pagine riservate. Il controllo qui serve a non disegnare la
// barra a chi non è admin, ma NON sostituisce quello di ogni pagina: un layout
// non si riesegue nelle navigazioni interne, per questo ogni page.tsx chiama
// richiediAdminPagina() per conto proprio.
export default async function GuscioConsole({ children }: { children: React.ReactNode }) {
  const sessione = await richiediAdminPagina();

  return (
    <div className="cn-shell">
      <BarraLaterale email={sessione.email} />
      <main className="cn-principale">{children}</main>
    </div>
  );
}
