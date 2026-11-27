import type { StatoEdizione } from "@/lib/newsletter/tipi";
import type { Tono } from "./elementi";

export const TONO_STATO: Record<StatoEdizione, Tono> = {
  bozza: "neutro",
  in_revisione: "avviso",
  approvata: "accento",
  programmata: "accento",
  in_invio: "avviso",
  inviata: "ok",
  invio_parziale: "errore",
  annullata: "neutro",
};
