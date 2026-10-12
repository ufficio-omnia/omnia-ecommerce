"use client";

import { usePathname } from "next/navigation";
import { esci } from "../azioni/accesso";
import BarraLateraleVista, { type ConteggiBarra } from "./barra-laterale-vista";

// Il pathname del browser è quello pubblico della console ("/", "/bonifici"),
// non quello interno riscritto dal proxy ("/site-console/...").
export default function BarraLaterale({ email, conteggi }: { email: string; conteggi?: ConteggiBarra }) {
  return <BarraLateraleVista email={email} percorso={usePathname()} conteggi={conteggi} azioneEsci={esci} />;
}
