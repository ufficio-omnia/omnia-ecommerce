import { Suspense } from "react";
import AttivaAccountContenuto from "./attiva-account-contenuto";

// Ponte lato client per i link di attivazione generati dal SERVER (il
// webhook Stripe dell'abbonamento anonimo): riceve token_hash+type come
// parametri di query (generati con admin.auth.admin.generateLink, mai
// action_link/signInWithOtp — quelli passano dal redirect di GoTrue e
// da lì in poi dipendono dal flowType del client, causa di due bug
// osservati in pratica: prima l'email nativa di Supabase su un dominio
// fisso, poi un frammento URL scartato dal client browser condiviso,
// configurato "pkce" per gli altri flussi) e li verifica direttamente
// con verifyOtp — nessuna dipendenza da PKCE o frammenti URL. Diversa da
// /auth/callback (route SERVER, usata dai flussi avviati DAL browser:
// registrazione libera, reset password — quelli sì hanno un
// code_verifier salvato dallo stesso browser, restano invariati).
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
