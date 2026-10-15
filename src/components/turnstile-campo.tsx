"use client";

import { useEffect, useRef } from "react";
import { CAMPO_TURNSTILE } from "@/lib/turnstile-calcoli";

// Riquadro anti-bot di Cloudflare Turnstile da mettere DENTRO un modulo: scrive il gettone nel campo nascosto
// «cf-turnstile-response», che il server legge con verificaFormUmano (lib/turnstile.ts). Senza la chiave pubblica
// (NEXT_PUBLIC_TURNSTILE_SITE_KEY) non mostra e non carica nulla.
//
// Quasi sempre invisibile (appearance «interaction-only»): il riquadro compare solo se Cloudflare vuole una
// conferma. Un gettone vale per UNA verifica: dopo ogni invio il modulo passa un nuovo «resetKey» (lo stato
// dell'azione) e il riquadro ne chiede uno nuovo, così si può riprovare dopo un errore.

type ApiTurnstile = {
  render: (elemento: HTMLElement, opzioni: Record<string, unknown>) => string;
  reset: (id?: string) => void;
  remove: (id?: string) => void;
};

declare global {
  interface Window {
    turnstile?: ApiTurnstile;
    __caricamentoTurnstile?: Promise<void>;
  }
}

const URL_SCRIPT = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

// Lo script si carica una volta sola per pagina, anche con più moduli.
function caricaScript(): Promise<void> {
  if (window.turnstile) return Promise.resolve();
  if (!window.__caricamentoTurnstile) {
    window.__caricamentoTurnstile = new Promise<void>((risolvi, rifiuta) => {
      const script = document.createElement("script");
      script.src = URL_SCRIPT;
      script.async = true;
      script.onload = () => risolvi();
      script.onerror = () => {
        window.__caricamentoTurnstile = undefined;
        rifiuta(new Error("Script di Turnstile non caricato"));
      };
      document.head.appendChild(script);
    });
  }
  return window.__caricamentoTurnstile;
}

export default function TurnstileCampo({ resetKey, tema = "auto" }: { resetKey?: unknown; tema?: "auto" | "light" | "dark" }) {
  const chiaveSito = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  const contenitore = useRef<HTMLDivElement>(null);
  const campo = useRef<HTMLInputElement>(null);
  const idRiquadro = useRef<string | null>(null);
  const primoGiro = useRef(true);

  useEffect(() => {
    if (!chiaveSito) return;
    let annullato = false;
    caricaScript()
      .then(() => {
        if (annullato || !contenitore.current || !window.turnstile || idRiquadro.current) return;
        idRiquadro.current = window.turnstile.render(contenitore.current, {
          sitekey: chiaveSito,
          theme: tema,
          language: "it",
          appearance: "interaction-only",
          callback: (gettone: string) => {
            if (campo.current) campo.current.value = gettone;
          },
          "expired-callback": () => {
            if (campo.current) campo.current.value = "";
          },
          "error-callback": () => {
            if (campo.current) campo.current.value = "";
          },
        });
      })
      .catch(() => {
        // script non caricato (rete, blocco del browser): il campo resta vuoto e decide il server
      });
    return () => {
      annullato = true;
      if (idRiquadro.current && window.turnstile) window.turnstile.remove(idRiquadro.current);
      idRiquadro.current = null;
    };
  }, [chiaveSito, tema]);

  // Dopo ogni invio il gettone è già stato usato: se ne chiede uno nuovo.
  useEffect(() => {
    if (primoGiro.current) {
      primoGiro.current = false;
      return;
    }
    if (campo.current) campo.current.value = "";
    if (idRiquadro.current && window.turnstile) window.turnstile.reset(idRiquadro.current);
  }, [resetKey]);

  if (!chiaveSito) return null;
  return (
    <>
      <input ref={campo} type="hidden" name={CAMPO_TURNSTILE} defaultValue="" />
      <div ref={contenitore} />
    </>
  );
}
