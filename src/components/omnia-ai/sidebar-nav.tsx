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
export default function SidebarNav({ nomeAzienda, voci = VOCI_MENU_TITOLARE }: { nomeAzienda: string | null; voci?: VoceMenu[] }) {
  const pathname = usePathname();
  const { stato } = useMarchioStato();

  return (
    <nav className="omnia-sidebar" aria-label="Navigazione principale">
      <Link href="/dashboard/omnia-ai" className="omnia-sidebar-marchio">
        <BrandMark stato={stato} />
        OMNIA AI
      </Link>

      <div className="omnia-sidebar-nav">
        {voci.map((voce) => (
          <Link
            key={voce.href}
            href={voce.href}
            className={`omnia-sidebar-voce${isVoceAttiva(pathname, voce.href) ? " attiva" : ""}`}
          >
            {voce.label}
          </Link>
        ))}
      </div>

      <div className="omnia-sidebar-footer">
        <Link href="/dashboard/omnia-ai/assistenza">Supporto</Link>
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
