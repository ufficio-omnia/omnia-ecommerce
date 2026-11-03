import type { CSSProperties } from "react";
import { LINK_PRENOTA_DEMO } from "@/lib/omnia-ai-demo-link";

// Il pulsante o la voce di menu che porta a prenotare la demo direttamente nel calendario (src/lib/omnia-ai-demo-link.ts).
// Si apre in una NUOVA scheda, così il visitatore non perde il sito; «noopener noreferrer» perché la pagina aperta non deve avere
// accesso a questa (è un sito esterno). Chi usa uno screen reader sente che si apre una nuova scheda.
export default function LinkDemo({
  testo,
  className,
  style,
  onClick,
}: {
  testo: string;
  className?: string;
  style?: CSSProperties;
  onClick?: () => void;
}) {
  return (
    <a
      href={LINK_PRENOTA_DEMO}
      target="_blank"
      rel="noopener noreferrer"
      className={className}
      style={style}
      onClick={onClick}
      aria-label={`${testo} (si apre in una nuova scheda)`}
    >
      {testo}
    </a>
  );
}
