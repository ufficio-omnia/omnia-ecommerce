import type { Metadata } from "next";
import Link from "next/link";
import { richiediAdminPagina } from "@/lib/console/accesso";
import FormNuovoUtente from "../../../_componenti/form-nuovo-utente";
import { Pannello } from "../../../_componenti/elementi";

export const metadata: Metadata = { title: "Nuovo utente" };

// Il controllo admin è la prima istruzione (il layout non si riesegue nelle navigazioni interne).
export default async function PaginaNuovoUtente() {
  await richiediAdminPagina();

  return (
    <>
      <Link href="/utenti" className="cn-indietro">
        ← Utenti
      </Link>
      <div className="cn-testata">
        <div>
          <h1>Nuovo utente</h1>
          <p>Crea un cliente di OMNIA AI con una password iniziale e un numero di gare gratuite</p>
        </div>
      </div>

      <div className="cn-colonne cn-colonne-pari">
        <Pannello titolo="Dati del cliente">
          <div className="cn-pannello-corpo">
            <FormNuovoUtente />
          </div>
        </Pannello>
        <Pannello titolo="Come funziona">
          <div className="cn-pannello-corpo">
            <ul className="cn-elenco-regola">
              <li>Il cliente entra con l&apos;email e la password che gli comunichi, senza alcuna conferma per email.</li>
              <li>Finché ha gare gratuite lavora come un abbonato. Quando le ha usate tutte vede un avviso in cima a ogni pagina e il pulsante verso la pagina Abbonamento, dove i piani sono spiegati.</li>
              <li>Le condizioni, la privacy e l&apos;Allegato A le accetta quando sottoscrive il primo abbonamento.</li>
              <li>Dalla sua scheda puoi aggiungere o togliere gare gratuite e, quando vuoi, azzerare la password iniziale perché ne scelga una sua.</li>
            </ul>
          </div>
        </Pannello>
      </div>
    </>
  );
}
