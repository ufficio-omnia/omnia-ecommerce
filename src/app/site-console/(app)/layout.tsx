import { richiediAdminPagina } from "@/lib/console/accesso";
import { contaDaFatturare } from "@/lib/console/fatturazione";
import { leggiBonificiInAttesa } from "@/lib/console/ordini";
import BarraLaterale from "../_componenti/barra-laterale";

// Guscio delle pagine riservate. Il controllo qui serve a non disegnare la
// barra a chi non è admin, ma NON sostituisce quello di ogni pagina: un layout
// non si riesegue nelle navigazioni interne, per questo ogni page.tsx chiama
// richiediAdminPagina() per conto proprio.
export default async function GuscioConsole({ children }: { children: React.ReactNode }) {
  const sessione = await richiediAdminPagina();
  // La barra mostra le cose che aspettano un'azione dell'admin: i bonifici da
  // confermare (con una scadenza) e gli incassi da fatturare. Si vedono da
  // qualunque pagina; il conteggio si aggiorna quando il layout si ricarica
  // (dopo ogni azione) o a ogni accesso.
  const [bonifici, daFatturare] = await Promise.all([leggiBonificiInAttesa(), contaDaFatturare()]);

  return (
    <div className="cn-shell">
      <BarraLaterale
        email={sessione.email}
        conteggi={
          bonifici.errore
            ? undefined
            : { bonifici: bonifici.totale, bonificiScaduti: bonifici.scaduti, daFatturare: daFatturare?.n }
        }
      />
      <main className="cn-principale">{children}</main>
    </div>
  );
}
