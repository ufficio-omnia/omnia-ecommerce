"use client";

import { useState, useTransition } from "react";

type OpenState = { error?: string; url?: string };

export default function OpenInNewTabButton({
  action,
  hiddenFields,
  label,
  pendingLabel,
  className,
}: {
  action: (prevState: OpenState, formData: FormData) => Promise<OpenState>;
  hiddenFields: Record<string, string>;
  label: string;
  pendingLabel?: string;
  className: string;
}) {
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleClick() {
    // Va aperta subito, in modo sincrono nel click, altrimenti i browser
    // bloccano window.open() se arriva dopo l'attesa della risposta server.
    const tab = window.open("about:blank", "_blank");
    setError(null);

    startTransition(async () => {
      const formData = new FormData();
      Object.entries(hiddenFields).forEach(([key, value]) =>
        formData.append(key, value),
      );

      const result = await action({}, formData);

      if (result.url) {
        if (tab) {
          tab.location.href = result.url;
        } else {
          window.open(result.url, "_blank", "noopener,noreferrer");
        }
      } else {
        tab?.close();
        setError(result.error ?? "Errore imprevisto.");
      }
    });
  }

  return (
    <div>
      <button
        type="button"
        onClick={handleClick}
        disabled={isPending}
        className={className}
      >
        {isPending && pendingLabel ? pendingLabel : label}
      </button>
      {error && <p className="mt-1 text-xs text-red-700">{error}</p>}
    </div>
  );
}
