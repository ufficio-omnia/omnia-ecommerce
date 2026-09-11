import type { ReactNode } from "react";
import { MarchioStatoProvider } from "./marchio-stato-context";
import SiteHeader from "./site-header";
import SiteFooter from "./site-footer";

// Per le pagine interne senza il canvas decorativo della home (che deve
// restare fratello di .omnia-wrap, non annidato — vedi hero-demo.tsx):
// qui children può stare tranquillamente dentro .omnia-wrap.
//
// SiteFooter va DENTRO .omnia-wrap, non dopo: .omnia-footer non ha un
// proprio max-width/padding orizzontale, li eredita dal contenitore (è
// così che rende nella home, vedi src/app/site-omnia-ai/page.tsx). Fuori
// da .omnia-wrap il piè di pagina va a filo del bordo, senza margini
// (bug osservato in pratica sulle pagine interne).
export default function PageShell({ children }: { children: ReactNode }) {
  return (
    <MarchioStatoProvider>
      <SiteHeader />
      <div className="omnia-wrap">
        {children}
        <SiteFooter />
      </div>
    </MarchioStatoProvider>
  );
}
