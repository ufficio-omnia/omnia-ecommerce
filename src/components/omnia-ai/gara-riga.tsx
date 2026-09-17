import Link from "next/link";
import BrandMark from "./brand-mark";
import ProgressBarGara from "./progress-bar-gara";

export type GaraRigaProps = {
  id: string;
  titolo: string;
  stazioneAppaltante: string | null;
  scadenza: string | null;
  estrazioneStato: string;
  documentiCaricati: boolean;
  relazioneGenerata: boolean;
};

export function giorniAllaScadenza(scadenza: string | null): number | null {
  if (!scadenza) return null;
  const oggi = new Date();
  oggi.setHours(0, 0, 0, 0);
  const data = new Date(`${scadenza}T00:00:00`);
  return Math.round((data.getTime() - oggi.getTime()) / 86_400_000);
}

function testoScadenza(giorni: number | null): string {
  if (giorni === null) return "—";
  if (giorni < 0) return "Scaduta";
  if (giorni === 0) return "Oggi";
  if (giorni === 1) return "Domani";
  return `${giorni} giorni`;
}

// Riga condivisa tra la lista gare della dashboard home e la pagina
// "Gare": stesso identico markup, non duplicato. Il piccolo marchio a
// tre stati compare SOLO per elaborazione/pronto (mai per gli altri
// stati) — nessun'altra icona di stato, il marchio è l'unico
// linguaggio visivo per questo.
export default function GaraRiga({
  id,
  titolo,
  stazioneAppaltante,
  scadenza,
  estrazioneStato,
  documentiCaricati,
  relazioneGenerata,
}: GaraRigaProps) {
  const giorni = giorniAllaScadenza(scadenza);
  const inElaborazione = estrazioneStato === "in_corso";

  let badge: { classe: string; testo: string } | null = null;
  if (relazioneGenerata) badge = { classe: "verde", testo: "Relazione pronta" };
  else if (estrazioneStato === "completata") badge = { classe: "verde", testo: "Analizzata" };
  else if (inElaborazione) badge = { classe: "ambra", testo: "In elaborazione" };
  else if (estrazioneStato === "errore") badge = { classe: "rosso", testo: "Errore analisi" };

  return (
    <Link href={`/dashboard/omnia-ai/gare/${id}`} className="omnia-gara-riga">
      <div>
        <div className="titolo">{titolo}</div>
        <div className="stazione">{stazioneAppaltante ?? "—"}</div>
      </div>

      <span className={`omnia-gara-scadenza${giorni !== null && giorni >= 0 && giorni <= 7 ? " ambra" : ""}`}>
        {testoScadenza(giorni)}
      </span>

      <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
        {badge ? (
          <span className={`omnia-badge ${badge.classe}`}>{badge.testo}</span>
        ) : (
          <span className="omnia-badge">Da analizzare</span>
        )}
        {(inElaborazione || relazioneGenerata) && (
          <span className="omnia-gara-indicatore">
            <BrandMark stato={inElaborazione ? "elaborazione" : "pronto"} />
          </span>
        )}
      </span>

      <ProgressBarGara
        documentiCaricati={documentiCaricati}
        analisiConclusa={estrazioneStato === "completata"}
        relazioneGenerata={relazioneGenerata}
      />
    </Link>
  );
}
