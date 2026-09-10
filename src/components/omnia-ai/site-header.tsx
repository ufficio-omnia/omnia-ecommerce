"use client";

import BrandMark from "./brand-mark";
import { useMarchioStato } from "./marchio-stato-context";

export default function SiteHeader() {
  const { stato } = useMarchioStato();

  return (
    <header className="omnia-header">
      <div className="omnia-bar">
        <a className="omnia-marchio" href="#">
          <BrandMark stato={stato} />
          OMNIA AI
        </a>
        <nav className="omnia-nav omnia-principale">
          <a href="#funziona">Come funziona</a>
          <a href="#piani">Piani</a>
          <a href="#demo">Demo</a>
          <a href="#contatti">Contatti</a>
          <a href="#" className="omnia-accedi">
            Accedi
          </a>
        </nav>
      </div>
    </header>
  );
}
