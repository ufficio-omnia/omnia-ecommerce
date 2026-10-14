"use client";

import type { ReactNode } from "react";
import { TITOLO_ALLEGATO_A, clausoleSpecifiche } from "@/lib/omnia-ai-clausole";

// Le due caselle di accettazione del checkout di OMNIA AI, in un punto solo: le usano
// sia la pagina di acquisto diretto (/abbonati/<piano>) sia la riattivazione
// dall'area riservata. I nomi dei campi (acceptCondizioniPrivacy,
// acceptClausoleSpecifiche) sono quelli che legge l'azione del server.
//
// I numeri delle clausole NON sono scritti qui: arrivano da omnia-ai-clausole.ts per
// la versione delle condizioni in vigore (nella v2 l'art. 10 è nuovo e le clausole
// successive scorrono di uno). L'Allegato A compare solo se esiste una versione in
// vigore (dopo la migrazione 0080): prima, il checkout è quello di sempre.

function Collegamento({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  );
}

// «a, b, c e d»: l'ultima voce con la «e».
function elencoConE(voci: ReactNode[]): ReactNode[] {
  return voci.flatMap((voce, i) => {
    const separatore = i === 0 ? "" : i === voci.length - 1 ? " e " : ", ";
    return [separatore, voce];
  });
}

export default function ConsensiAbbonamento({
  condizioniVersion,
  privacyVersion,
  allegatoVersion,
  condizioniAccettate,
  onCondizioniChange,
  clausoleApprovate,
  onClausoleChange,
  margineSuperiore,
}: {
  condizioniVersion: number;
  privacyVersion: number;
  // versione in vigore dell'Allegato A; null se non esiste ancora
  allegatoVersion: number | null;
  condizioniAccettate: boolean;
  onCondizioniChange: (valore: boolean) => void;
  clausoleApprovate: boolean;
  onClausoleChange: (valore: boolean) => void;
  margineSuperiore?: number;
}) {
  const condizioniUrl = `/documenti-legali/condizioni-abbonamento/${condizioniVersion}`;
  const allegatoUrl = allegatoVersion ? `/documenti-legali/allegato-a/${allegatoVersion}` : null;
  const clausole = clausoleSpecifiche(condizioniVersion);

  return (
    <div className="omnia-riquadro" style={margineSuperiore ? { marginTop: margineSuperiore } : undefined}>
      <span className="omnia-eyebrow">Condizioni contrattuali</span>

      <div className="omnia-check-riga">
        <input
          id="acceptCondizioniPrivacy"
          name="acceptCondizioniPrivacy"
          type="checkbox"
          checked={condizioniAccettate}
          onChange={(e) => onCondizioniChange(e.target.checked)}
          required
        />
        <label htmlFor="acceptCondizioniPrivacy">
          Dichiaro di aver letto e accettato le{" "}
          <Collegamento href={condizioniUrl}>Condizioni di abbonamento (versione {condizioniVersion})</Collegamento>
          {allegatoUrl && (
            <>
              , comprensive dell&apos;
              <Collegamento href={allegatoUrl}>
                Allegato A — {TITOLO_ALLEGATO_A} (versione {allegatoVersion})
              </Collegamento>{" "}
              (<Collegamento href={`${allegatoUrl}/pdf`}>scarica il PDF</Collegamento>)
            </>
          )}{" "}
          e di aver preso visione della{" "}
          <Collegamento href={`/documenti-legali/privacy-policy/${privacyVersion}`}>Privacy policy (versione {privacyVersion})</Collegamento>.
        </label>
      </div>

      <div className="omnia-check-riga">
        <input
          id="acceptClausoleSpecifiche"
          name="acceptClausoleSpecifiche"
          type="checkbox"
          checked={clausoleApprovate}
          onChange={(e) => onClausoleChange(e.target.checked)}
          required
        />
        <label htmlFor="acceptClausoleSpecifiche">
          Dichiaro di approvare specificamente, ai sensi di legge, le clausole n.{" "}
          {elencoConE(
            clausole.map((c) => (
              <span key={c.numero}>
                <Collegamento href={`${condizioniUrl}#clausola-${c.numero}`}>{c.numero}</Collegamento> ({c.titolo})
              </span>
            )),
          )}{" "}
          delle Condizioni di abbonamento
          {allegatoUrl && (
            <>
              , nonché l&apos;
              <Collegamento href={allegatoUrl}>Allegato A</Collegamento> ({TITOLO_ALLEGATO_A}), che ne costituisce parte integrante
            </>
          )}
          .
        </label>
      </div>
    </div>
  );
}
