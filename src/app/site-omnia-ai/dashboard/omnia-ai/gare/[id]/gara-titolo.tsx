"use client";

import { useState } from "react";
import { renameGara } from "@/app/actions/gare";

// Unico modo oggi per correggere un titolo sbagliato era cancellare la
// gara e rifarla — dalla Tappa 3 (gate di consumo) in poi rifarla
// costerebbe una gara della quota. La chiamata alla server action è
// diretta (non useActionState): serve sapere con certezza quando il
// salvataggio è riuscito per uscire dalla modalità di modifica, cosa
// che uno stato sempre "{}" al primo giro non permette di distinguere.
export default function GaraTitolo({ garaId, titolo }: { garaId: string; titolo: string }) {
  const [modifica, setModifica] = useState(false);
  const [valore, setValore] = useState(titolo);
  const [errore, setErrore] = useState<string | null>(null);
  const [salvataggio, setSalvataggio] = useState(false);

  async function salva() {
    const nuovoTitolo = valore.trim();
    if (!nuovoTitolo) {
      setErrore("Il titolo non può essere vuoto.");
      return;
    }
    setSalvataggio(true);
    setErrore(null);

    const formData = new FormData();
    formData.set("garaId", garaId);
    formData.set("titolo", nuovoTitolo);
    const risultato = await renameGara({}, formData);

    setSalvataggio(false);
    if (risultato.error) {
      setErrore(risultato.error);
    } else {
      setModifica(false);
    }
  }

  if (!modifica) {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <h1 className="omnia-app-titolo" style={{ marginTop: 0 }}>
          {titolo}
        </h1>
        <button
          type="button"
          onClick={() => {
            setValore(titolo);
            setErrore(null);
            setModifica(true);
          }}
          className="omnia-btn omnia-btn-s omnia-btn-piccolo"
        >
          Rinomina
        </button>
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <input
          type="text"
          value={valore}
          onChange={(e) => setValore(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              salva();
            }
          }}
          autoFocus
          className="omnia-input"
          style={{ maxWidth: 420 }}
        />
        <button
          type="button"
          onClick={salva}
          disabled={salvataggio}
          className="omnia-btn omnia-btn-p omnia-btn-piccolo"
        >
          {salvataggio ? "Salvataggio..." : "Salva"}
        </button>
        <button
          type="button"
          onClick={() => {
            setModifica(false);
            setErrore(null);
          }}
          disabled={salvataggio}
          className="omnia-btn omnia-btn-s omnia-btn-piccolo"
        >
          Annulla
        </button>
      </div>
      {errore && (
        <p className="omnia-messaggio-stato errore" style={{ marginTop: 8 }}>
          {errore}
        </p>
      )}
    </div>
  );
}
