-- Uffici Gare: da UNO a TRE per titolare (richiesta del 2026-11-26).
--
-- La 0092 permetteva un solo Ufficio Gare per titolare con un indice unico (titolare_id, ruolo). Qui l'indice
-- unico esce e al suo posto un trigger rifiuta il quarto: al massimo 3 Uffici Gare per titolare, deciso dal
-- database e non solo dal codice. Tutto il resto della 0092 (regole di accesso, titolare effettivo, niente
-- catene, avvisi «uno al giorno» per titolare) resta com'è: ogni Ufficio Gare vede le gare del suo titolare.
--
-- Ordine: prima si crea il trigger, POI si toglie l'indice unico: nessun momento senza limite.
-- Idempotente: si può rieseguire. Si può eseguire PRIMA del deploy del codice: il codice vecchio continua a
-- vedere al massimo un Ufficio Gare per titolare finché nessuno ne crea un secondo (e il codice vecchio non
-- può crearlo: controlla da solo che non ce ne sia già uno).

create or replace function public.omnia_ai_membri_massimo_tre()
returns trigger
language plpgsql
as $$
begin
  -- due inserimenti contemporanei per lo stesso titolare si mettono in fila: il conteggio non può sbagliare
  perform pg_advisory_xact_lock(hashtext('omnia_ai_membri:' || new.titolare_id::text));
  if (
    select count(*) from public.omnia_ai_membri m
    where m.titolare_id = new.titolare_id
      and m.ruolo = new.ruolo
      and m.membro_id is distinct from new.membro_id
  ) >= 3 then
    raise exception 'Il titolare % ha già 3 Uffici Gare', new.titolare_id using errcode = '23505';
  end if;
  return new;
end
$$;

drop trigger if exists omnia_ai_membri_massimo_tre on public.omnia_ai_membri;
create trigger omnia_ai_membri_massimo_tre
  before insert or update of titolare_id, ruolo on public.omnia_ai_membri
  for each row execute function public.omnia_ai_membri_massimo_tre();

drop index if exists public.omnia_ai_membri_un_ruolo_per_titolare;
-- resta omnia_ai_membri_titolare_idx (0092) per leggere gli Uffici Gare di un titolare
