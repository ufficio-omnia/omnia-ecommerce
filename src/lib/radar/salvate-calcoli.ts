// Fase B4 (B1), grado 2 — Chi ha salvato una gara della lista comune dell'impresa (omnia_ai_radar_salvate.salvata_da). Logica pura.
// Si mostra il RUOLO, mai il nome o l'email di un'altra persona (public.users non ha nomi; l'email dell'altro non si espone).
// Utile solo quando l'Ufficio Gare lavora sulle Opportunità (RADAR_UFFICIO_GARE acceso): a interruttore spento salva solo il titolare.

export function chiHaSalvato(salvataDa: string | null | undefined, impresaId: string, utenteId: string): string | null {
  if (!salvataDa) return null;
  if (salvataDa === utenteId) return "salvata da te";
  return salvataDa === impresaId ? "salvata dal titolare" : "salvata dall'Ufficio Gare";
}
