import type { Metadata } from "next";
import { richiediAdminPagina } from "@/lib/console/accesso";
import { leggiBonificiInAttesa } from "@/lib/console/ordini";
import { leggiRegistroAccessi } from "@/lib/console/registro-accessi";
import { leggiStatoSistema } from "@/lib/console/stato-sistema";
import PanoramicaVista from "../_componenti/panoramica-vista";
import { msDa } from "../_componenti/formati";

export const metadata: Metadata = { title: "Panoramica" };

export default async function Panoramica() {
  const sessione = await richiediAdminPagina();
  const [bonifici, registro] = await Promise.all([leggiBonificiInAttesa(), leggiRegistroAccessi(15)]);
  const sistema = await leggiStatoSistema({ registroAccessiDisponibile: registro.disponibile });

  return (
    <PanoramicaVista
      scadeIl={sessione.scadeIl}
      scadeTraMs={msDa(sessione.scadeIl)}
      bonifici={bonifici}
      registro={registro}
      sistema={sistema}
    />
  );
}
