import { Suspense } from "react";
import AttivaAccountContenuto from "./attiva-account-contenuto";

// Ponte lato client per i link di attivazione generati dal SERVER
// (il webhook Stripe dell'abbonamento anonimo, admin.auth.signInWithOtp):
// senza un browser che ha avviato la richiesta non esiste un code_verifier
// PKCE da abbinare, quindi Supabase consegna la sessione in un frammento
// URL (#access_token=...), leggibile solo lato client — mai da
// /auth/callback (route SERVER, usata invece dai flussi avviati dal
// browser: registrazione libera, reset password, entrambi funzionanti
// col meccanismo a codice e lasciati invariati).
//
// useSearchParams() in AttivaAccountContenuto richiede un confine
// Suspense esplicito per il prerendering statico di Next.js.
export default function AttivaAccountPage() {
  return (
    <div className="omnia-app-shell" style={{ textAlign: "center" }}>
      <Suspense fallback={<h1 className="omnia-app-titolo">Accesso in corso…</h1>}>
        <AttivaAccountContenuto />
      </Suspense>
    </div>
  );
}
