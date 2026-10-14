"use client";

// Apre la finestra di stampa del browser (anche «Salva come PDF»): serve all'estratto
// del registro degli accessi, che si manda al cliente.
export default function PulsanteStampa() {
  return (
    <button type="button" className="cn-btn" onClick={() => window.print()}>
      Stampa / salva PDF
    </button>
  );
}
