"use client";

import { useId, useState } from "react";
import Link from "next/link";
import { FOOD_MENU } from "@/lib/gara-settore";
import { BANDA_PIANO_LAVORO, ETICHETTA_LINK_CONDIZIONI, PERCORSO_CONDIZIONI_PIANO_LAVORO } from "@/lib/piano-lavoro-testi";
import { CATEGORIE_SERVIZI, IN_LAVORAZIONE, SEZIONE_SERVIZI, etichettaNelMenu } from "@/lib/servizi-categorie";

// Sezione della pagina dei piani: il visitatore sceglie la sua categoria e legge il servizio che può elaborare DENTRO una gara oltre alla relazione
// tecnica. Questi servizi non si comprano con l'abbonamento, solo nella singola gara: qui non c'è nessun «Abbonati». Il prezzo del piano di lavoro
// viene dalla console (la pagina lo legge e lo passa già scritto). I testi stanno in piano-lavoro-testi.ts, gara-settore.ts e servizi-categorie.ts.
// `categoriaIniziale`: la categoria già scelta all'apertura (per i test e per eventuali collegamenti diretti); un valore che non è nel menu vale «nessuna».
export default function ServiziPerCategoria({ prezzoSingolaGara, categoriaIniziale = "" }: { prezzoSingolaGara: string; categoriaIniziale?: string }) {
  const [scelta, setScelta] = useState(CATEGORIE_SERVIZI.some((c) => c.valore === categoriaIniziale) ? categoriaIniziale : "");
  const idMenu = useId();
  const categoria = CATEGORIE_SERVIZI.find((c) => c.valore === scelta) ?? null;
  const p = BANDA_PIANO_LAVORO.punti;

  return (
    <section className="omnia-revisione" id="servizi" aria-labelledby="omnia-servizi-titolo">
      <p className="omnia-revisione-etichetta">{SEZIONE_SERVIZI.etichetta}</p>
      <h2 id="omnia-servizi-titolo">{SEZIONE_SERVIZI.titolo}</h2>

      <div className="omnia-servizi-menu">
        <label className="omnia-etichetta" htmlFor={idMenu}>
          {SEZIONE_SERVIZI.etichettaMenu}
        </label>
        <select id={idMenu} className="omnia-select" value={scelta} onChange={(e) => setScelta(e.target.value)}>
          <option value="">{SEZIONE_SERVIZI.segnaposto}</option>
          {CATEGORIE_SERVIZI.map((c) => (
            <option key={c.valore} value={c.valore}>
              {etichettaNelMenu(c)}
            </option>
          ))}
        </select>
      </div>

      {/* Il contenuto cambia con la scelta: area «viva» per chi usa un lettore di schermo. */}
      <div className="omnia-servizi-esito" aria-live="polite">
        {categoria?.stato === "disponibile" && (
          <>
            <p className="omnia-revisione-etichetta">{BANDA_PIANO_LAVORO.etichetta}</p>
            <h3>{BANDA_PIANO_LAVORO.titolo}</h3>
            <p className="omnia-revisione-testo">{BANDA_PIANO_LAVORO.testo}</p>
            <ul className="omnia-revisione-punti due">
              <li>
                <b>{p.singola.titolo}</b>
                <span>{p.singola.dettaglio(prezzoSingolaGara)}</span>
              </li>
              <li>
                <b>{p.formule.titolo}</b>
                <span>{p.formule.dettaglio}</span>
              </li>
            </ul>
            <p className="omnia-revisione-nota">
              {BANDA_PIANO_LAVORO.nota}{" "}
              <Link href={PERCORSO_CONDIZIONI_PIANO_LAVORO} style={{ color: "inherit", textDecoration: "underline" }}>
                {ETICHETTA_LINK_CONDIZIONI}
              </Link>
              .
            </p>
          </>
        )}

        {categoria?.stato === "in_arrivo" && (
          <>
            <span className="omnia-servizi-stato">{FOOD_MENU.stato}</span>
            <p className="omnia-revisione-etichetta" style={{ marginTop: 14 }}>
              {FOOD_MENU.nome}
            </p>
            <h3>{FOOD_MENU.titolo}</h3>
            <p className="omnia-revisione-testo">{FOOD_MENU.testo}</p>
            <ul className="omnia-revisione-punti">
              {FOOD_MENU.punti.map((punto) => (
                <li key={punto.titolo}>
                  <b>{punto.titolo}</b>
                  <span>{punto.dettaglio}</span>
                </li>
              ))}
            </ul>
            <p className="omnia-revisione-nota">{FOOD_MENU.nota}</p>
          </>
        )}

        {categoria?.stato === "in_lavorazione" && (
          <>
            <span className="omnia-servizi-stato">{IN_LAVORAZIONE.stato}</span>
            <h3 style={{ marginTop: 14 }}>{IN_LAVORAZIONE.titolo}</h3>
            <p className="omnia-revisione-testo">{IN_LAVORAZIONE.testo}</p>
          </>
        )}
      </div>
    </section>
  );
}
