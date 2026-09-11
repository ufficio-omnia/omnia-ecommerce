"use client";

import { useRef, useState } from "react";
import { uploadGaraDocumento } from "@/app/actions/gare";

// Limite prudenziale per singolo file, non il limite reale del server:
// next.config.ts fissa bodySizeLimit a 30mb per TUTTE le server action
// dell'app (non solo questa) — alzarlo qui rischierebbe di allentare il
// limite anche altrove. Per questo ogni file viene caricato con una
// richiesta a sé (vedi sotto), invece di mandarli tutti insieme: così la
// dimensione della richiesta non cresce con il numero di file
// selezionati. Questo margine (25MB) lascia spazio all'overhead del
// multipart/form-data prima di toccare il tetto reale.
const LIMITE_DIMENSIONE_FILE = 25 * 1024 * 1024;

type StatoFile = "in_attesa" | "in_corso" | "ok" | "avviso" | "errore";

type FileConStato = {
  file: File;
  chiave: string;
  stato: StatoFile;
  messaggio?: string;
};

function formattaDimensione(byte: number): string {
  if (byte < 1024 * 1024) return `${Math.max(1, Math.round(byte / 1024))} KB`;
  return `${(byte / (1024 * 1024)).toFixed(1)} MB`;
}

function chiaveFile(file: File, indice: number): string {
  return `${file.name}-${file.size}-${file.lastModified}-${indice}`;
}

export default function UploadDocumentoForm({ garaId }: { garaId: string }) {
  const [voci, setVoci] = useState<FileConStato[]>([]);
  const [inCorso, setInCorso] = useState(false);
  const [trascinamento, setTrascinamento] = useState(false);
  const [riepilogo, setRiepilogo] = useState<{ testo: string; tipo: "successo" | "avviso" | "errore" } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const inAttesa = voci.filter((v) => v.stato === "in_attesa");

  function aggiungiFile(nuoviFile: FileList | File[]) {
    const partenza = voci.length;
    const nuoveVoci: FileConStato[] = Array.from(nuoviFile).map((file, i) => ({
      file,
      chiave: chiaveFile(file, partenza + i),
      stato: "in_attesa",
    }));
    setVoci((v) => [...v, ...nuoveVoci]);
    setRiepilogo(null);
  }

  function rimuoviVoce(chiave: string) {
    setVoci((v) => v.filter((voce) => voce.chiave !== chiave));
  }

  function handleInputChange(event: React.ChangeEvent<HTMLInputElement>) {
    if (event.target.files?.length) {
      aggiungiFile(event.target.files);
    }
    event.target.value = "";
  }

  function handleDrop(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setTrascinamento(false);
    if (event.dataTransfer.files?.length) {
      aggiungiFile(event.dataTransfer.files);
    }
  }

  async function avviaCaricamento() {
    if (inAttesa.length === 0 || inCorso) return;
    setInCorso(true);
    setRiepilogo(null);

    let ok = 0;
    let avvisi = 0;
    let errori = 0;

    // Un file alla volta, in sequenza: ogni richiesta resta piccola (vedi
    // LIMITE_DIMENSIONE_FILE sopra) e un file che fallisce non annulla né
    // rallenta gli altri — ognuno riceve subito il proprio esito.
    for (const voce of inAttesa) {
      setVoci((v) => v.map((x) => (x.chiave === voce.chiave ? { ...x, stato: "in_corso" } : x)));

      if (voce.file.size > LIMITE_DIMENSIONE_FILE) {
        errori++;
        setVoci((v) =>
          v.map((x) =>
            x.chiave === voce.chiave
              ? { ...x, stato: "errore", messaggio: `Troppo grande (max ${formattaDimensione(LIMITE_DIMENSIONE_FILE)}).` }
              : x,
          ),
        );
        continue;
      }

      try {
        const formData = new FormData();
        formData.set("garaId", garaId);
        formData.set("file", voce.file);
        const risultato = await uploadGaraDocumento({}, formData);

        if (risultato.error) {
          errori++;
          setVoci((v) =>
            v.map((x) => (x.chiave === voce.chiave ? { ...x, stato: "errore", messaggio: risultato.error } : x)),
          );
        } else if (risultato.warning) {
          avvisi++;
          setVoci((v) =>
            v.map((x) => (x.chiave === voce.chiave ? { ...x, stato: "avviso", messaggio: risultato.warning } : x)),
          );
        } else {
          ok++;
          setVoci((v) => v.map((x) => (x.chiave === voce.chiave ? { ...x, stato: "ok" } : x)));
        }
      } catch (err) {
        console.error("Errore caricamento documento:", err);
        errori++;
        setVoci((v) =>
          v.map((x) =>
            x.chiave === voce.chiave ? { ...x, stato: "errore", messaggio: "Errore imprevisto durante il caricamento." } : x,
          ),
        );
      }
    }

    setInCorso(false);
    const parti = [];
    if (ok) parti.push(`${ok} caricat${ok === 1 ? "o" : "i"}`);
    if (avvisi) parti.push(`${avvisi} con avviso`);
    if (errori) parti.push(`${errori} con errore`);
    const tipo = errori > 0 ? "errore" : avvisi > 0 ? "avviso" : "successo";
    setRiepilogo(parti.length ? { testo: parti.join(", ") + ".", tipo } : null);

    // Le voci andate a buon fine si tolgono dall'elenco (sono già
    // visibili nella lista documenti sopra, aggiornata da revalidatePath
    // dentro l'azione); quelle con avviso/errore restano, per poterle
    // vedere e riprovare senza doverle riselezionare.
    setVoci((v) => v.filter((x) => x.stato !== "ok"));
  }

  return (
    <div>
      <div
        className={`omnia-dropzone${trascinamento ? " attivo" : ""}`}
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setTrascinamento(true);
        }}
        onDragLeave={() => setTrascinamento(false)}
        onDrop={handleDrop}
      >
        <p className="titolo">Trascina qui i documenti della gara, o clicca per selezionarli</p>
        <p className="nota">Puoi selezionare più file insieme</p>
        <input ref={inputRef} type="file" multiple onChange={handleInputChange} />
      </div>

      {voci.length > 0 && (
        <div className="omnia-file-elenco">
          {voci.map((voce) => (
            <div key={voce.chiave} className={`omnia-file-riga ${voce.stato}`}>
              <span className="nome">{voce.file.name}</span>
              <span className="dimensione">{formattaDimensione(voce.file.size)}</span>
              {voce.stato === "in_attesa" && (
                <button type="button" className="rimuovi" onClick={() => rimuoviVoce(voce.chiave)} aria-label={`Rimuovi ${voce.file.name}`}>
                  ✕
                </button>
              )}
              {voce.stato === "in_corso" && <span className="omnia-badge ambra">In corso...</span>}
              {voce.stato === "ok" && <span className="omnia-badge verde">Caricato</span>}
              {voce.stato === "avviso" && <span className="omnia-badge ambra">Avviso</span>}
              {voce.stato === "errore" && <span className="omnia-badge rosso">Errore</span>}
              {voce.messaggio && <span className="messaggio">{voce.messaggio}</span>}
            </div>
          ))}
        </div>
      )}

      {inAttesa.length > 0 && (
        <button
          type="button"
          onClick={avviaCaricamento}
          disabled={inCorso}
          className="omnia-btn omnia-btn-s omnia-btn-piccolo"
          style={{ marginTop: 12 }}
        >
          {inCorso ? "Caricamento in corso..." : `Carica ${inAttesa.length} document${inAttesa.length === 1 ? "o" : "i"}`}
        </button>
      )}

      {riepilogo && (
        <p className={`omnia-messaggio-stato ${riepilogo.tipo}`} style={{ marginTop: 12 }}>
          {riepilogo.testo}
        </p>
      )}
    </div>
  );
}
