"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  getConteggioNonLette,
  getNotificheRecenti,
  segnaLetta,
  segnaTutteLette,
  type NotificaRow,
} from "@/app/actions/omnia-ai-notifiche";

const INTERVALLO_MS = 6000;

function formattaOrario(iso: string): string {
  const data = new Date(iso);
  const oggi = new Date();
  const stessoGiorno = data.toDateString() === oggi.toDateString();
  return stessoGiorno
    ? data.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" })
    : data.toLocaleDateString("it-IT", { day: "2-digit", month: "2-digit" });
}

export default function NotificationBell() {
  const [nonLette, setNonLette] = useState(0);
  const [notifiche, setNotifiche] = useState<NotificaRow[] | null>(null);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  // Il contatore si aggiorna sempre, in ogni pagina della dashboard —
  // stesso intervallo del marchio a tre stati, ma un timer a sé: sono
  // due segnali indipendenti (elaborazione gare vs notifiche da leggere).
  useEffect(() => {
    let annullato = false;
    async function controlla() {
      const n = await getConteggioNonLette();
      if (!annullato) setNonLette(n);
    }
    controlla();
    const id = setInterval(controlla, INTERVALLO_MS);
    return () => {
      annullato = true;
      clearInterval(id);
    };
  }, []);

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

  async function apri() {
    const nuovoStato = !open;
    setOpen(nuovoStato);
    if (nuovoStato) {
      const elenco = await getNotificheRecenti();
      setNotifiche(elenco);
    }
  }

  async function segna(id: string) {
    setNotifiche((prev) => prev?.map((n) => (n.id === id ? { ...n, letta: true } : n)) ?? null);
    setNonLette((n) => Math.max(0, n - 1));
    await segnaLetta(id);
  }

  async function segnaTutte() {
    setNotifiche((prev) => prev?.map((n) => ({ ...n, letta: true })) ?? null);
    setNonLette(0);
    await segnaTutteLette();
  }

  return (
    <div className="omnia-profilo-menu" ref={ref}>
      <button
        type="button"
        className="omnia-profilo-menu-trigger omnia-campanella"
        onClick={apri}
        aria-label={`Notifiche${nonLette > 0 ? `, ${nonLette} non lette` : ""}`}
      >
        🔔{nonLette > 0 && <span className="omnia-campanella-contatore">{nonLette > 9 ? "9+" : nonLette}</span>}
      </button>

      {open && (
        <div className="omnia-profilo-menu-dropdown omnia-notifiche-dropdown">
          <div className="omnia-notifiche-intestazione">
            <span className="omnia-profilo-menu-email" style={{ border: 0, margin: 0, padding: "9px 12px" }}>
              Notifiche
            </span>
            {nonLette > 0 && (
              <button type="button" className="omnia-notifiche-segna-tutte" onClick={segnaTutte}>
                Segna tutte come lette
              </button>
            )}
          </div>

          {!notifiche ? (
            <p className="omnia-elenco-vuoto" style={{ padding: "12px" }}>
              Caricamento...
            </p>
          ) : notifiche.length === 0 ? (
            <p className="omnia-elenco-vuoto" style={{ padding: "12px" }}>
              Nessuna notifica.
            </p>
          ) : (
            notifiche.map((n) => {
              const contenuto = (
                <>
                  <div className="titolo">{n.titolo}</div>
                  <div className="corpo">{n.corpo}</div>
                  <div className="orario">{formattaOrario(n.created_at)}</div>
                </>
              );
              return n.gara_id ? (
                <Link
                  key={n.id}
                  href={`/dashboard/omnia-ai/gare/${n.gara_id}`}
                  className={`omnia-notifica-riga${n.letta ? "" : " non-letta"}`}
                  onClick={() => {
                    if (!n.letta) segna(n.id);
                    setOpen(false);
                  }}
                >
                  {contenuto}
                </Link>
              ) : (
                <button
                  key={n.id}
                  type="button"
                  className={`omnia-notifica-riga${n.letta ? "" : " non-letta"}`}
                  onClick={() => segna(n.id)}
                >
                  {contenuto}
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
