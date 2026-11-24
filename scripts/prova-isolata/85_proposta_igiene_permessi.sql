-- PROPOSTA del dossier Z5 (documento 45, B2, 21/11/2026). NON è una migrazione e NON va applicata: è il testo che diventerebbe una
-- migrazione NUOVA (numero da assegnare dal coordinamento, ≥ 0132) se l'utente la approva. Non tocca la 0124 né la 0125 già applicate:
-- toglie soltanto permessi, è idempotente e non cambia dati, tabelle, funzioni o trigger.
--
-- A) EXECUTE delle due funzioni dei trigger del Radar solo al server, come già per radar_aggiungi_fonte_alla_gara (0120/0121). Oggi, per i
--    permessi predefiniti di Supabase, le eseguono PUBLIC, anon e authenticated. Postgres controlla EXECUTE solo quando si CREA un trigger,
--    non quando il trigger scatta: i due trigger continuano a funzionare per qualunque scrittura (provato su Postgres isolato).
revoke all on function public.radar_notifiche_persona_dell_impresa() from public, anon, authenticated;
grant execute on function public.radar_notifiche_persona_dell_impresa() to service_role;
revoke all on function public.radar_consegna_separazione() from public, anon, authenticated;
grant execute on function public.radar_consegna_separazione() to service_role;

-- B) (facoltativa, consigliata) le due tabelle che i clienti scrivono (0112) hanno per authenticated anche TRUNCATE, REFERENCES e TRIGGER,
--    arrivati dai permessi predefiniti (la 0112 ha tolto tutto solo ad anon). I clienti usano solo select, insert, update e delete (con le
--    regole RLS), che restano. MAINTAIN (Postgres 17) non si nomina: il testo resta valido anche su una versione precedente.
revoke truncate, references, trigger on public.omnia_ai_radar_gare_aggiunte from anon, authenticated;
revoke truncate, references, trigger on public.omnia_ai_radar_salvate from anon, authenticated;
