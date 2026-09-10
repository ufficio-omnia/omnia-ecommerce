import type { ReactNode } from "react";
import { MarchioStatoProvider } from "./marchio-stato-context";
import SiteHeader from "./site-header";
import SiteFooter from "./site-footer";

// Per le pagine interne senza il canvas decorativo della home (che deve
// restare fratello di .omnia-wrap, non annidato — vedi hero-demo.tsx):
// qui children può stare tranquillamente dentro .omnia-wrap.
export default function PageShell({ children }: { children: ReactNode }) {
  return (
    <MarchioStatoProvider>
      <SiteHeader />
      <div className="omnia-wrap">{children}</div>
      <SiteFooter />
    </MarchioStatoProvider>
  );
}
