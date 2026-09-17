"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { signOut } from "@/app/actions/auth";

export default function ProfiloMenu({ email }: { email: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;

    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }

    window.addEventListener("mousedown", handleClick);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("mousedown", handleClick);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  return (
    <div className="omnia-profilo-menu" ref={ref}>
      <button type="button" className="omnia-profilo-menu-trigger" onClick={() => setOpen((v) => !v)}>
        {email}
      </button>

      {open && (
        <div className="omnia-profilo-menu-dropdown">
          <div className="omnia-profilo-menu-email">{email}</div>
          <Link href="/dashboard/omnia-ai/impostazioni" onClick={() => setOpen(false)}>
            Impostazioni
          </Link>
          <form action={signOut}>
            <button type="submit">Esci</button>
          </form>
        </div>
      )}
    </div>
  );
}
