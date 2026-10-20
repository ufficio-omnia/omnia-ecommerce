"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// Rilegge la pagina da sola ogni tot secondi, finché la scheda è aperta e visibile: serve alle pagine che mostrano chi è
// collegato (Panoramica ed elenco Utenti) per non dover premere «ricarica». Non si usa nelle pagine con moduli da compilare.
// router.refresh() rilegge i dati del server e lascia com'è lo stato del browser (scorrimento, filtri scritti).
export default function RicaricaAutomatica({ secondi = 30 }: { secondi?: number }) {
  const router = useRouter();
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, secondi * 1000);
    return () => window.clearInterval(timer);
  }, [router, secondi]);
  return null;
}
