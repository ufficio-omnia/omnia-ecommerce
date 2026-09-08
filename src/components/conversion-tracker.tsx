"use client";

import { useEffect, useRef } from "react";
import { findOrderForConversion } from "@/app/actions/conversion";

declare global {
  interface Window {
    dataLayer?: unknown[];
  }
}

const SEND_TO = "AW-18422155730/YGI3CPiUmPEcENKTr9BE";
const CONSENT_KEY = "omnia-cookie-consent";
const RETRY_ATTEMPTS = 5;
const RETRY_DELAY_MS = 1500;

function fireConversion(orderId: string, value: number) {
  if (localStorage.getItem(CONSENT_KEY) !== "accepted") return;

  window.dataLayer = window.dataLayer || [];
  window.dataLayer.push([
    "event",
    "conversion",
    {
      send_to: SEND_TO,
      value,
      currency: "EUR",
      transaction_id: orderId,
    },
  ]);
}

// Per il bonifico: id e importo dell'ordine sono già disponibili subito
// (creato in modo sincrono dalla server action, non da un webhook).
export function ConversionTracker({
  orderId,
  value,
}: {
  orderId: string;
  value: number;
}) {
  const fired = useRef(false);

  useEffect(() => {
    if (fired.current) return;
    fired.current = true;
    fireConversion(orderId, value);
  }, [orderId, value]);

  return null;
}

// Per la carta: l'ordine viene creato dal webhook Stripe, asincrono
// rispetto al redirect del browser su questa pagina — un solo tentativo
// rischierebbe di arrivare "troppo presto" e perdere la conversione.
export function ConversionTrackerFromSession({
  sessionId,
}: {
  sessionId: string;
}) {
  const fired = useRef(false);

  useEffect(() => {
    if (fired.current || !sessionId) return;

    let cancelled = false;

    async function poll() {
      for (let attempt = 1; attempt <= RETRY_ATTEMPTS; attempt++) {
        const order = await findOrderForConversion(
          sessionId,
          attempt === RETRY_ATTEMPTS,
        );

        if (cancelled) return;

        if (order) {
          fired.current = true;
          fireConversion(order.id, order.value);
          return;
        }

        if (attempt < RETRY_ATTEMPTS) {
          await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
        }
      }
    }

    poll();

    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  return null;
}
