-- 0133 — Tender Intelligence: stato «da_verificare» della classificazione di una gara (23/11/2026).
--
-- PROGETTO, MAI APPLICATO. Decisione dell'utente del 23/11 sullo schema S4 del documento 49A (revisione delle gare C) e approvazione della
-- migrazione («Sì, prepara la migrazione»; numero 0133 assegnato dal registro del coordinamento). L'applicazione allo staging è
-- un'autorizzazione SEPARATA dell'utente; la produzione mai senza di lui. Documento: TENDER_INTELLIGENCE_FASE0/49C_REGOLE_S1_S4_PROVA_A_VUOTO.md.
--
-- Che cosa fa: SOLO il vincolo dei valori di radar_classificazioni_stato.stato (0121), che ammette in più 'da_verificare'. Il vincolo della
-- 0121 era scritto nella colonna, quindi Postgres gli ha dato il nome radar_classificazioni_stato_stato_check: si toglie e si ricrea con lo
-- stesso nome, con tutti i valori di prima più quello nuovo.
--
-- Significato (stesso spirito della 0121): «da_verificare» = la classificazione automatica è riuscita, ma la gara è uno dei casi senza
-- descrizione utile (schema S4: concessione di un immobile con un CPV di ristorazione, appalto misto per stabulari, servizi di biblioteca).
-- Né C né B in automatico: come «in_attesa» e «fallita», una gara «da_verificare» non è MAI «non pertinente» e non entra nei suggerimenti
-- (che vogliono «classificata»). Decide a mano un amministratore in console con una riga origine 'amministratore' e la nota obbligatoria (già
-- previste dalla 0121); poi lo stato torna «classificata». Le righe calcolate (C, con la regola e il motivo) restano come spiegazione.
--
-- Regole rispettate:
--   - ADDITIVA e NON distruttiva: nessuna riga toccata (il vincolo nuovo ammette tutti i valori di prima, quindi tutte le righe esistenti lo
--     rispettano); nessuna tabella, colonna, indice, funzione, trigger o regola nuova o tolta; permessi (GRANT) invariati;
--   - IDEMPOTENTE: «drop constraint if exists» più «add constraint» con lo stesso nome; si può rieseguire;
--   - gli altri vincoli della tabella restano: «da_verificare» non ha errore (radar_classificazioni_stato_errore) e ha il tentativo
--     (radar_classificazioni_stato_tentativo).
-- Provata su un Postgres 17.11 isolato (scripts/prova-isolata/esegui-prova-isolata-0133.mjs) con la 0109–0121 applicate prima.

alter table public.radar_classificazioni_stato drop constraint if exists radar_classificazioni_stato_stato_check;
alter table public.radar_classificazioni_stato add constraint radar_classificazioni_stato_stato_check
  check (stato in ('in_attesa', 'classificata', 'fallita', 'da_verificare'));

notify pgrst, 'reload schema';
