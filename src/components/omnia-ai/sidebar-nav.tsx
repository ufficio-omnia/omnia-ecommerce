"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import BrandMark from "./brand-mark";
import { useMarchioStato } from "./marchio-stato-context";

const VOCI = [
  { href: "/dashboard/omnia-ai", label: "Dashboard" },
  { href: "/dashboard/omnia-ai/gare", label: "Gare" },
  { href: "/dashboard/omnia-ai/documenti-aziendali", label: "Documenti aziendali" },
  { href: "/dashboard/omnia-ai/profilo-azienda", label: "Profilo azienda" },
  { href: "/dashboard/omnia-ai/abbonamento", label: "Abbonamento" },
  { href: "/dashboard/omnia-ai/impostazioni", label: "Impostazioni" },
];

// "Dashboard" è l'unica voce il cui href è anche prefisso di ogni altra
// (/dashboard/omnia-ai/gare inizia con /dashboard/omnia-ai): per lei
// serve un confronto esatto, per le altre basta lo startsWith.
function isVoceAttiva(pathname: string, href: string): boolean {
  return href === "/dashboard/omnia-ai" ? pathname === href : pathname.startsWith(href);
}

export default function SidebarNav({ nomeAzienda }: { nomeAzienda: string | null }) {
  const pathname = usePathname();
  const { stato } = useMarchioStato();

  return (
    <nav className="omnia-sidebar" aria-label="Navigazione principale">
      <Link href="/dashboard/omnia-ai" className="omnia-sidebar-marchio">
        <BrandMark stato={stato} />
        OMNIA AI
      </Link>

      <div className="omnia-sidebar-nav">
        {VOCI.map((voce) => (
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
        {nomeAzienda && <div className="omnia-sidebar-azienda">{nomeAzienda}</div>}
      </div>
    </nav>
  );
}
