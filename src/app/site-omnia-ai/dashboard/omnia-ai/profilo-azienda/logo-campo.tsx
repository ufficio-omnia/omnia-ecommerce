"use client";

import { useEffect, useRef, useState } from "react";

// Campo logo del profilo azienda: mostra il logo caricato (anteprima su fondo
// bianco, perché i loghi sono pensati per la carta), permette di sceglierne uno
// nuovo e ne mostra subito l'anteprima. Il file scelto sostituisce quello
// attuale quando si salva il profilo; "Annulla" toglie la scelta e lascia il
// logo com'era.
export default function LogoCampo({
  id,
  name,
  etichetta,
  urlAttuale,
}: {
  id: string;
  name: string;
  etichetta: string;
  urlAttuale: string | null;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [anteprima, setAnteprima] = useState<string | null>(null);
  const [nomeFile, setNomeFile] = useState("");
  const [attualeIllegibile, setAttualeIllegibile] = useState(false);

  // L'anteprima è un URL locale al browser: va rilasciato quando cambia o il campo sparisce.
  useEffect(() => {
    return () => {
      if (anteprima) URL.revokeObjectURL(anteprima);
    };
  }, [anteprima]);

  function allaScelta(file: File | undefined) {
    setAnteprima(file ? URL.createObjectURL(file) : null);
    setNomeFile(file?.name ?? "");
  }

  function annulla() {
    if (inputRef.current) inputRef.current.value = "";
    setAnteprima(null);
    setNomeFile("");
  }

  const mostrato = anteprima ?? (attualeIllegibile ? null : urlAttuale);
  const didascalia = anteprima
    ? `Nuovo logo «${nomeFile}»: sostituirà quello attuale quando salvi il profilo.`
    : urlAttuale
      ? attualeIllegibile
        ? "Logo caricato, ma l'anteprima non è disponibile: puoi comunque sostituirlo."
        : "Logo attuale."
      : "Nessun logo caricato.";

  return (
    <div>
      <label htmlFor={id} className="omnia-etichetta">
        {etichetta}
      </label>
      <div className="omnia-logo-anteprima" aria-live="polite">
        {mostrato ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={mostrato} alt={etichetta} onError={() => (anteprima ? null : setAttualeIllegibile(true))} />
        ) : (
          <span>Nessuna anteprima</span>
        )}
      </div>
      <p className="omnia-riquadro-nota">{didascalia}</p>
      <div className="omnia-form-riga" style={{ marginTop: 8 }}>
        <input
          ref={inputRef}
          id={id}
          name={name}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="omnia-input"
          onChange={(e) => allaScelta(e.target.files?.[0])}
        />
        {anteprima && (
          <button type="button" className="omnia-btn omnia-btn-s omnia-btn-piccolo" onClick={annulla}>
            Annulla sostituzione
          </button>
        )}
      </div>
      <p className="omnia-riquadro-nota">{urlAttuale ? "Sostituisci scegliendo un nuovo file" : "Scegli un file"} (PNG, JPG o WebP, fino a 5 MB).</p>
    </div>
  );
}
