"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function AttivaAccountContenuto() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [errore, setErrore] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    const next = searchParams.get("next") || "/dashboard/omnia-ai";

    supabase.auth.getSession().then(({ data }) => {
      if (data.session) {
        router.replace(next);
      } else {
        setErrore(true);
      }
    });
  }, [router, searchParams]);

  if (errore) {
    return (
      <>
        <h1 className="omnia-app-titolo">Link non valido o scaduto</h1>
        <p className="omnia-app-sottotitolo">
          Richiedi un nuovo link di attivazione o accedi se hai già impostato una password.
        </p>
      </>
    );
  }

  return <h1 className="omnia-app-titolo">Accesso in corso…</h1>;
}
