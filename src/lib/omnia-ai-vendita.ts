import { createAdminClient } from "@/lib/supabase/admin";

// Vendita degli abbonamenti dal sito (pulsante «Abbonati» su /piani).
//
// Due condizioni, entrambe necessarie, perché il pulsante compaia:
//   1) l'interruttore in console («Piani e prezzi → Messa in vendita») è acceso: scelta dell'admin,
//      spenta finché non decide (anche per fermare la vendita in un attimo);
//   2) la chiave Stripe che QUESTO ambiente usa per OMNIA AI è quella REALE: con una chiave di prova
//      nessun visitatore deve arrivare a un pagamento che non può davvero completare. Il database è
//      condiviso tra locale e produzione, quindi non basta l'interruttore.
// L'interruttore sta in console_impostazioni (chiave/valore, già usata per cambio e IVA): niente migrazione.

export const CHIAVE_VENDITA = "vendita_abbonamenti_attiva";

export type ModalitaStripe = "reale" | "prova" | "sconosciuta";

export function modalitaChiaveStripe(chiave: string | undefined | null): ModalitaStripe {
  if (!chiave) return "sconosciuta";
  if (/^(sk|rk)_live_/.test(chiave)) return "reale";
  if (/^(sk|rk)_test_/.test(chiave)) return "prova";
  return "sconosciuta";
}

// Il valore salvato: solo «1» vale acceso. Assente, vuoto o qualunque altra cosa = spento.
export function interpretaInterruttoreVendita(valore: string | null | undefined): boolean {
  return valore === "1";
}

export function venditaVisibile(condizioni: { interruttore: boolean; modalita: ModalitaStripe }): boolean {
  return condizioni.interruttore && condizioni.modalita === "reale";
}

type LetturaImpostazione = {
  from: (tabella: string) => {
    select: (colonne: string) => {
      eq: (colonna: string, valore: string) => {
        maybeSingle: () => PromiseLike<{ data: { valore: string } | null; error: { message: string } | null }>;
      };
    };
  };
};

// Qualunque errore (tabella assente, rete) = spento: nel dubbio non si vende.
export async function leggiInterruttoreVendita(client?: LetturaImpostazione): Promise<boolean> {
  try {
    const db = client ?? (createAdminClient() as unknown as LetturaImpostazione);
    const { data, error } = await db.from("console_impostazioni").select("valore").eq("chiave", CHIAVE_VENDITA).maybeSingle();
    if (error) return false;
    return interpretaInterruttoreVendita(data?.valore);
  } catch {
    return false;
  }
}

// Per la pagina /piani: se la chiave non è reale non si legge nemmeno il database.
export async function venditaAbbonamentiVisibile(): Promise<boolean> {
  const modalita = modalitaChiaveStripe(process.env.STRIPE_SECRET_KEY_OMNIA_AI);
  if (modalita !== "reale") return false;
  return venditaVisibile({ interruttore: await leggiInterruttoreVendita(), modalita });
}
