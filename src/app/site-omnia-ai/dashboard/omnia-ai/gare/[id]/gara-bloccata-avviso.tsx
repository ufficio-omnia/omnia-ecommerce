"use client";

import Link from "next/link";
import QuotaEsauritaConfronto from "./quota-esaurita-confronto";

// Avviso in cima alla gara che non spetta al cliente (gare del piano, crediti o gare gratuite
// finite): spiega che chat e caricamento documenti sono spenti e porta a riattivarli. Un solo
// avviso per pagina; il modulo di caricamento e la chat dicono solo «disattivato».
export default function GaraBloccataAvviso({
  messaggio,
  motivo,
  pianoAttuale,
}: {
  messaggio: string;
  motivo: "quota_esaurita" | "gratuite_esaurite" | "verifica_non_riuscita";
  pianoAttuale: string | null;
}) {
  return (
    <div className="omnia-messaggio-stato avviso" role="status" style={{ marginTop: 24 }}>
      <p style={{ margin: 0 }}>
        <strong>Chat e caricamento documenti disattivati per questa gara.</strong>
      </p>
      <p style={{ margin: "8px 0 0" }}>{messaggio}</p>
      {motivo === "gratuite_esaurite" && (
        <p style={{ margin: "12px 0 0" }}>
          <Link href="/dashboard/omnia-ai/abbonamento" className="omnia-btn omnia-btn-p">
            Scegli un abbonamento
          </Link>
        </p>
      )}
      {motivo === "quota_esaurita" && <QuotaEsauritaConfronto pianoAttuale={pianoAttuale} />}
    </div>
  );
}
