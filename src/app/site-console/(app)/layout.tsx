import { richiediAdminPagina } from "@/lib/console/accesso";
import { leggiBonificiInAttesa } from "@/lib/console/ordini";
import BarraLaterale from "../_componenti/barra-laterale";

// Guscio delle pagine riservate. Il controllo qui serve a non disegnare la
// barra a chi non è admin, ma NON sostituisce quello di ogni pagina: un layout
// non si riesegue nelle navigazioni interne, per questo ogni page.tsx chiama
// richiediAdminPagina() per conto proprio.
export default async function GuscioConsole({ children }: { children: React.ReactNode }) {
  const sessione = await richiediAdminPagina();
  // La barra mostra quanti bonifici aspettano: l'unica cosa che richiede
  // un'azione con una scadenza deve vedersi da qualunque pagina. Il conteggio
  // si aggiorna quando il layout si ricarica (dopo ogni azione) o a ogni accesso.
  const bonifici = await leggiBonificiInAttesa();

  return (
    <div className="cn-shell">
      <BarraLaterale
        email={sessione.email}
        conteggi={bonifici.errore ? undefined : { bonifici: bonifici.totale, bonificiScaduti: bonifici.scaduti }}
      />
      <main className="cn-principale">{children}</main>
    </div>
  );
}
