import Link from "next/link";
import { signOut } from "@/app/actions/auth";
import ProfiloMenu from "./profilo-menu";
import NotificationBell from "./notification-bell";

export default function Topbar({ nomeSaluto, email }: { nomeSaluto: string; email: string }) {
  return (
    <div className="omnia-topbar">
      <div className="omnia-topbar-saluto">
        Ciao, {nomeSaluto}
        <span className="sotto">Ecco lo stato delle tue gare.</span>
      </div>

      <div className="omnia-topbar-azioni">
        <Link href="/dashboard/omnia-ai/gare" className="omnia-btn omnia-btn-nuova-gara">
          Nuova gara
        </Link>
        <NotificationBell />
        <ProfiloMenu email={email} />
        {/* «Esci» sta anche dentro il menu del profilo, ma nascosto dietro un clic sull'email:
            un cliente non lo trova. Qui è sempre visibile. */}
        <form action={signOut}>
          <button type="submit" className="omnia-btn omnia-btn-s omnia-btn-esci">
            Esci
          </button>
        </form>
      </div>
    </div>
  );
}
