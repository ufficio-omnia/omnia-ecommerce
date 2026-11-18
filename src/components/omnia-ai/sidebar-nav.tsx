"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "@/app/actions/auth";
import BrandMark from "./brand-mark";
import { useMarchioStato } from "./marchio-stato-context";
import { VOCI_MENU_TITOLARE, type VoceMenu } from "@/lib/omnia-ai-account-calcoli";

// "Dashboard" è l'unica voce il cui href è anche prefisso di ogni altra
// (/dashboard/omnia-ai/gare inizia con /dashboard/omnia-ai): per lei
// serve un confronto esatto, per le altre basta lo startsWith.
function isVoceAttiva(pathname: string, href: string): boolean {
  return href === "/dashboard/omnia-ai" ? pathname === href : pathname.startsWith(href);
}

// Le voci arrivano dal ruolo (omnia-ai-account-calcoli.ts): il titolare le vede tutte, l'Ufficio Gare solo Dashboard e Gare.
// Nascondere una voce è solo cortesia: l'accesso alle pagine lo blocca ogni pagina per conto suo.
//
// prefetch={false} su TUTTI i collegamenti dei menu dell'area riservata (18/11/2026): con il prefetch automatico di Next ogni voce visibile
// veniva precaricata a ogni pagina e di nuovo dopo ogni azione del server (il poller dello stato della dashboard), e ogni precaricamento
// passa dal proxy e disegna il layout (verifica della sessione, stato d'accesso): 30–60 chiamate a Supabase per vista. Ora la pagina si
// carica solo al clic. Sicurezza, sessioni e controlli d'accesso non cambiano (li fa comunque ogni pagina). Regressione:
// scripts/verifica-prefetch-menu-riservati.ts.
export default function SidebarNav({ nomeAzienda, voci = VOCI_MENU_TITOLARE }: { nomeAzienda: string | null; voci?: VoceMenu[] }) {
  const pathname = usePathname();
  const { stato } = useMarchioStato();

  return (
    <nav className="omnia-sidebar" aria-label="Navigazione principale">
      <Link href="/dashboard/omnia-ai" prefetch={false} className="omnia-sidebar-marchio">
        <BrandMark stato={stato} />
        OMNIA AI
      </Link>

      <div className="omnia-sidebar-nav">
        {voci.map((voce) => (
          <Link
            key={voce.href}
            href={voce.href}
            prefetch={false}
            className={`omnia-sidebar-voce${isVoceAttiva(pathname, voce.href) ? " attiva" : ""}`}
          >
            {voce.label}
          </Link>
        ))}
      </div>

      <div className="omnia-sidebar-footer">
        <Link href="/dashboard/omnia-ai/assistenza" prefetch={false}>
          Supporto
        </Link>
        <form action={signOut}>
          <button type="submit" className="omnia-sidebar-esci">
            Esci
          </button>
        </form>
        {nomeAzienda && <div className="omnia-sidebar-azienda">{nomeAzienda}</div>}
      </div>
    </nav>
  );
}
