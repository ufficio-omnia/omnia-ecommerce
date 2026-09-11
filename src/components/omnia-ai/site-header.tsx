"use client";

import Link from "next/link";
import BrandMark from "./brand-mark";
import { useMarchioStato } from "./marchio-stato-context";

export default function SiteHeader() {
  const { stato } = useMarchioStato();

  return (
    <header className="omnia-header">
      <div className="omnia-bar">
        <Link className="omnia-marchio" href="/">
          <BrandMark stato={stato} />
          OMNIA AI
        </Link>
        <nav className="omnia-nav omnia-principale">
          <Link href="/come-funziona">Come funziona</Link>
          <Link href="/piani">Piani</Link>
          <Link href="/demo">Demo</Link>
          <Link href="/contatti">Contatti</Link>
          <Link href="/login" className="omnia-accedi">
            Accedi
          </Link>
        </nav>
      </div>
    </header>
  );
}
