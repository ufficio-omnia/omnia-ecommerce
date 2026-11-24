// Modelli delle email delle notifiche di Tender Intelligence (fase B4): solo funzioni pure, nessun database, nessuna rete.
// Il motore di B2 (src/lib/radar/notifiche/**) importa componiEmailRadar da qui; l'invio passa dal suo adattatore, mai da src/lib/email.ts.
// I tipi sono quelli del contratto di B2 (src/lib/radar/notifiche/tipi.ts), ripresi qui solo per comodità di chi importa i modelli.
export { componiEmailRadar, AVVERTENZA_EMAIL, DETTAGLIO_NON_DISPONIBILE, NON_RISPONDERE, NOTA_AGGIUNTA_A_MANO, RIMANDO_AVVISO_UFFICIALE } from "./componi";
export * from "@/lib/radar/notifiche/tipi";
