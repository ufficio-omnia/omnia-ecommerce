import { FOOD_MENU } from "@/lib/gara-settore";
import ServizioRichiudibile from "./servizio-richiudibile";

// Riquadro «OMNIA FOOD MENU» dentro la gara: compare SOLO quando l'analisi dei documenti ha riconosciuto una gara di ristorazione collettiva
// (le regole stanno in src/lib/gara-settore.ts). Per ora il servizio «sta arrivando»: nessun pulsante, nessun acquisto, nessuna promessa
// di data. Il testo è lo stesso della pagina dei piani (un solo posto: FOOD_MENU). Come gli altri servizi aggiuntivi si può ridurre a una riga.
export default function FoodMenuPanel() {
  return (
    <ServizioRichiudibile id="food_menu" titoloId="food-menu-titolo" titolo={`${FOOD_MENU.nome} · ${FOOD_MENU.stato.toLowerCase()}`}>
      <h2 style={{ margin: "8px 0 4px", fontSize: 20 }}>{FOOD_MENU.titolo}</h2>
      <p className="omnia-riquadro-nota" style={{ marginTop: 4 }}>
        {FOOD_MENU.testo}
      </p>
      <ul style={{ margin: "12px 0", paddingLeft: 20, lineHeight: 1.6 }}>
        {FOOD_MENU.punti.map((p) => (
          <li key={p.titolo}>
            <strong>{p.titolo}</strong>: {p.dettaglio}
          </li>
        ))}
      </ul>
      <p className="omnia-riquadro-nota">{FOOD_MENU.nota}</p>
    </ServizioRichiudibile>
  );
}
