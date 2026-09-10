"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

// SiteHeader/SiteFooter sono Server Component (fanno query Supabase) e
// non possono essere importati direttamente in un file "use client":
// il layout (server) li istanzia e li passa qui già pronti come props,
// questo componente si limita a scegliere quale mostrare in base al
// percorso — nessuna logica di dati qui dentro.
export default function SiteChrome({
  header,
  checkoutHeader,
  footer,
  children,
}: {
  header: ReactNode;
  checkoutHeader: ReactNode;
  footer: ReactNode;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const isCheckout = pathname?.startsWith("/checkout") ?? false;

  if (isCheckout) {
    return (
      <>
        {checkoutHeader}
        {children}
      </>
    );
  }

  return (
    <>
      {header}
      {children}
      {footer}
    </>
  );
}
