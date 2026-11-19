// Modelli delle email delle notifiche di Tender Intelligence (fase B4): solo funzioni pure, nessun database, nessuna rete.
// Il motore di B2 (src/lib/radar/notifiche/**) importa da qui; l'invio passa dal suo adattatore, mai da src/lib/email.ts direttamente.
export { componiEmailRadar, AVVERTENZA_EMAIL, NON_RISPONDERE } from "./componi";
export { CATEGORIA_EMAIL, MASSIMO_GARE_RIEPILOGO } from "./contratto";
export type {
  CategoriaEmailRadar,
  DestinatarioEmailRadar,
  DocumentoEmail,
  EmailRadar,
  EventoEmailRadar,
  EvidenzaEmail,
  GaraEmailRadar,
  ModificaEmail,
  ScadenzaEmail,
  TipoEmailRadar,
} from "./contratto";
