import Link from "next/link";
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
      </div>
    </div>
  );
}
