-- 0116 — Tender Intelligence, fase B1-bis: limiti di cortesia verso la PVL di ANAC, modificabili dalla console (16/11/2026).
--
-- Valori iniziali (mai sovrascritti) dei limiti del connettore PVL: avvisi per pagina, pausa tra due richieste, tempo massimo per
-- richiesta, tentativi, richieste massime per giro. Il codice accetta solo valori dentro intervalli fissi (pvl-calcoli.ts): la console
-- non può renderli più aggressivi di così. Con un valore mancante vale quello predefinito nel codice.
--
-- ADDITIVA e idempotente: solo righe nuove in console_impostazioni, nessuna modifica di schema. Da eseguire SOLO sullo staging finché la
-- PVL non è autorizzata in produzione.

insert into public.console_impostazioni (chiave, valore) values
  ('radar_pvl_avvisi_per_pagina', '100'),
  ('radar_pvl_pausa_ms', '3000'),
  ('radar_pvl_timeout_ms', '30000'),
  ('radar_pvl_tentativi', '2'),
  ('radar_pvl_richieste_massime', '20')
on conflict (chiave) do nothing;

notify pgrst, 'reload schema';
