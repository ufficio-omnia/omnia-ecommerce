// Badge di Stripe Climate («Climate Commitments» dell'account Stripe di OMNIA AI): l'1% degli acquisti contribuisce alla
// rimozione di CO₂. È una pagina STATICA ospitata da Stripe (solo HTML e CSS: nessuno script, nessun cookie), incorporata
// con l'iframe fornito da Stripe nel Dashboard (sezione Climate). Il testo del badge lo scrive Stripe («1% di acquisti ha
// contribuito a Stripe Climate»): qui non si aggiunge nessuna affermazione.
//
// Accorgimenti, perché è un contenuto di terzi in ogni pagina del sito:
//   - sandbox="" (nessun permesso: la pagina non ne ha bisogno);
//   - referrerPolicy="no-referrer": a Stripe non si dice da quale pagina arriva il visitatore;
//   - loading="lazy": il piè di pagina sta in fondo, il badge si carica solo quando ci si avvicina;
//   - max-width 100%: sul telefono non esce dallo schermo.
// Se il programma si disattiva sull'account Stripe o cambia la percentuale, va aggiornato anche il testo della pagina
// dei piani (src/app/site-omnia-ai/piani/piani-vista.tsx).
export const URL_BADGE_CLIMATE = "https://climate.stripe.com/badge/mE76Pa";

// I due temi di Stripe: «dark» (blu notte, testo chiaro) per il tema scuro del sito, «light» (barra chiara) per quello chiaro.
// Si disegnano entrambi, ma il CSS (omnia-ai.css) ne mostra UNO solo secondo il tema scelto dal visitatore, di base quello
// scuro; l'altro resta con display:none e, essendo «lazy», non si carica finché non serve. Così il componente resta lato server
// e il badge cambia insieme al tema, senza lampi.
const TEMI_BADGE = ["dark", "light"] as const;

export default function ClimateBadge() {
  return (
    <>
      {TEMI_BADGE.map((tema) => (
        <iframe
          key={tema}
          src={`${URL_BADGE_CLIMATE}?theme=${tema}&size=small&locale=it-IT`}
          title="Stripe Climate: l'1% degli acquisti contribuisce alla rimozione di CO₂ dall'atmosfera"
          width={380}
          height={38}
          className={`omnia-climate-badge omnia-climate-${tema}`}
          loading="lazy"
          referrerPolicy="no-referrer"
          sandbox=""
          style={{ border: 0, maxWidth: "100%" }}
        />
      ))}
    </>
  );
}
