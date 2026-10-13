"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { richiediAdminAzione } from "@/lib/console/accesso";
import {
  ERRORE_IMPORTO,
  LUNGHEZZA_DESCRIZIONE,
  LUNGHEZZA_ETICHETTA_FILE,
  PESO_MASSIMO_FILE_PRODOTTO,
  erroreSconto,
  errorePrezzoConSconto,
  giudicaAnteprima,
  leggiDatiNuovoProdotto,
  leggiImporto,
  leggiOrdineFile,
  nomeFileSicuro,
  riordinaVoci,
} from "@/lib/console/prodotti-calcoli";

// Azioni su prodotti, sconti, file e anteprime (spostate dal vecchio pannello admin
// dell'e-commerce). Ognuna parte da richiediAdminAzione(). A differenza delle
// vecchie, nessuna tace davanti a un errore: l'esito (o il motivo del rifiuto)
// torna alla pagina e si legge accanto al pulsante.

export type StatoProdotto = { errore?: string; ok?: boolean; avviso?: string; url?: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Il catalogo pubblico (/prodotti) sta nell'e-commerce: va invalidato col suo
// percorso reale, oltre alle pagine della console.
function ricarica() {
  revalidatePath("/site-console", "layout");
  revalidatePath("/prodotti");
}

type Prodotto = { id: string; price: number | string; discount_active: boolean; discount_price: number | string | null };

async function leggiProdotto(productId: string): Promise<Prodotto | null> {
  const { data } = await createAdminClient()
    .from("products")
    .select("id, price, discount_active, discount_price")
    .eq("id", productId)
    .maybeSingle<Prodotto>();
  return data;
}

// ───── Prodotto ─────

export async function creaProdotto(_stato: StatoProdotto, formData: FormData): Promise<StatoProdotto> {
  const sessione = await richiediAdminAzione();
  if (!sessione) return { errore: "Non autorizzato." };

  const letto = leggiDatiNuovoProdotto({
    titolo: formData.get("title"),
    categoria: formData.get("category"),
    prezzo: formData.get("price"),
    descrizione: formData.get("description"),
  });
  if ("errore" in letto) return { errore: letto.errore };

  const { error } = await createAdminClient()
    .from("products")
    .insert({ title: letto.dati.titolo, category: letto.dati.categoria, price: letto.dati.prezzo, description: letto.dati.descrizione });
  if (error) {
    console.error("Console: creazione prodotto fallita", error.message);
    return { errore: "Errore nella creazione del prodotto." };
  }

  ricarica();
  return { ok: true };
}

export async function aggiornaProdotto(_stato: StatoProdotto, formData: FormData): Promise<StatoProdotto> {
  const sessione = await richiediAdminAzione();
  if (!sessione) return { errore: "Non autorizzato." };

  const productId = String(formData.get("productId") ?? "");
  const prezzo = leggiImporto(formData.get("price"));
  const descrizione = String(formData.get("description") ?? "").trim();
  if (!UUID.test(productId)) return { errore: "Prodotto non valido." };
  if (prezzo === null) return { errore: ERRORE_IMPORTO };
  if (descrizione.length > LUNGHEZZA_DESCRIZIONE) return { errore: `La descrizione è troppo lunga (massimo ${LUNGHEZZA_DESCRIZIONE} caratteri).` };

  const prodotto = await leggiProdotto(productId);
  if (!prodotto) return { errore: "Prodotto non trovato." };
  const conflitto = errorePrezzoConSconto(prezzo, prodotto.discount_active, prodotto.discount_price === null ? null : Number(prodotto.discount_price));
  if (conflitto) return { errore: conflitto };

  const { error } = await createAdminClient().from("products").update({ price: prezzo, description: descrizione || null }).eq("id", productId);
  if (error) {
    console.error("Console: aggiornamento prodotto fallito", error.message);
    return { errore: "Errore nel salvataggio del prodotto." };
  }

  ricarica();
  return { ok: true };
}

// Lo stato voluto arriva dal modulo («attivo» = vero/falso), non si deduce da quello
// attuale: premere due volte lo stesso pulsante non lo fa rimbalzare.
export async function impostaAttivo(_stato: StatoProdotto, formData: FormData): Promise<StatoProdotto> {
  const sessione = await richiediAdminAzione();
  if (!sessione) return { errore: "Non autorizzato." };

  const productId = String(formData.get("productId") ?? "");
  const attivo = formData.get("attivo");
  if (!UUID.test(productId) || (attivo !== "true" && attivo !== "false")) return { errore: "Richiesta non valida." };

  const { data, error } = await createAdminClient().from("products").update({ active: attivo === "true" }).eq("id", productId).select("id");
  if (error) {
    console.error("Console: cambio di stato del prodotto fallito", error.message);
    return { errore: "Errore nel cambio di stato del prodotto." };
  }
  if (!data || data.length === 0) return { errore: "Prodotto non trovato." };

  ricarica();
  return { ok: true };
}

// Un prodotto già acquistato non si elimina (storico ordini, vincolo del database):
// si disattiva. I file e le anteprime nello storage invece vanno tolti a mano,
// perché la cascata del database non li raggiunge.
export async function eliminaProdotto(_stato: StatoProdotto, formData: FormData): Promise<StatoProdotto> {
  const sessione = await richiediAdminAzione();
  if (!sessione) return { errore: "Non autorizzato." };

  const productId = String(formData.get("productId") ?? "");
  if (!UUID.test(productId)) return { errore: "Prodotto non valido." };

  const admin = createAdminClient();
  const { count, error: erroreOrdini } = await admin.from("orders").select("id", { count: "exact", head: true }).eq("product_id", productId);
  if (erroreOrdini) return { errore: "Controllo degli ordini non riuscito: il prodotto non è stato toccato." };
  if ((count ?? 0) > 0) return { errore: `Impossibile eliminare: il prodotto ha ${count} ${count === 1 ? "ordine" : "ordini"} associati. Disattivalo invece di eliminarlo.` };

  const { data: file } = await admin.from("product_files").select("file_path, product_file_previews(image_path)").eq("product_id", productId);
  const righe = (file ?? []) as unknown as { file_path: string; product_file_previews: { image_path: string }[] | null }[];

  const { error } = await admin.from("products").delete().eq("id", productId);
  if (error) {
    if (error.code === "23503") return { errore: "Impossibile eliminare: il prodotto ha ordini associati. Disattivalo invece di eliminarlo." };
    console.error("Console: eliminazione prodotto fallita", error.message);
    return { errore: "Errore nell'eliminazione del prodotto." };
  }

  const documenti = righe.map((r) => r.file_path);
  const anteprime = righe.flatMap((r) => (r.product_file_previews ?? []).map((a) => a.image_path));
  if (documenti.length > 0) await admin.storage.from("documents").remove(documenti);
  if (anteprime.length > 0) await admin.storage.from("product-previews").remove(anteprime);

  ricarica();
  return { ok: true };
}

// ───── Sconto ─────

export async function attivaSconto(_stato: StatoProdotto, formData: FormData): Promise<StatoProdotto> {
  const sessione = await richiediAdminAzione();
  if (!sessione) return { errore: "Non autorizzato." };

  const productId = String(formData.get("productId") ?? "");
  const scontato = leggiImporto(formData.get("discountPrice"));
  if (!UUID.test(productId)) return { errore: "Prodotto non valido." };
  if (scontato === null) return { errore: ERRORE_IMPORTO };

  const prodotto = await leggiProdotto(productId);
  if (!prodotto) return { errore: "Prodotto non trovato." };
  const conflitto = erroreSconto(Number(prodotto.price), scontato);
  if (conflitto) return { errore: conflitto };

  const { error } = await createAdminClient().from("products").update({ discount_active: true, discount_price: scontato }).eq("id", productId);
  if (error) {
    console.error("Console: attivazione sconto fallita", error.message);
    return { errore: "Errore nell'attivazione dello sconto." };
  }

  ricarica();
  return { ok: true };
}

export async function disattivaSconto(_stato: StatoProdotto, formData: FormData): Promise<StatoProdotto> {
  const sessione = await richiediAdminAzione();
  if (!sessione) return { errore: "Non autorizzato." };

  const productId = String(formData.get("productId") ?? "");
  if (!UUID.test(productId)) return { errore: "Prodotto non valido." };

  const { data, error } = await createAdminClient().from("products").update({ discount_active: false }).eq("id", productId).select("id");
  if (error) {
    console.error("Console: disattivazione sconto fallita", error.message);
    return { errore: "Errore nella disattivazione dello sconto." };
  }
  if (!data || data.length === 0) return { errore: "Prodotto non trovato." };

  ricarica();
  return { ok: true };
}

// ───── File del prodotto ─────

export async function aggiungiFile(_stato: StatoProdotto, formData: FormData): Promise<StatoProdotto> {
  const sessione = await richiediAdminAzione();
  if (!sessione) return { errore: "Non autorizzato." };

  const productId = String(formData.get("productId") ?? "");
  const etichetta = String(formData.get("label") ?? "").trim();
  const file = formData.get("file");
  if (!UUID.test(productId)) return { errore: "Prodotto non valido." };
  if (!etichetta) return { errore: "Scrivi l'etichetta del file (es. «Piano di lavoro (Excel)»)." };
  if (etichetta.length > LUNGHEZZA_ETICHETTA_FILE) return { errore: `L'etichetta è troppo lunga (massimo ${LUNGHEZZA_ETICHETTA_FILE} caratteri).` };
  if (!(file instanceof File) || file.size === 0) return { errore: "Scegli il file da caricare." };
  if (file.size > PESO_MASSIMO_FILE_PRODOTTO) return { errore: `Il file supera i ${PESO_MASSIMO_FILE_PRODOTTO / 1024 / 1024} MB.` };

  if (!(await leggiProdotto(productId))) return { errore: "Prodotto non trovato." };

  // Service role: l'upload con la sessione dell'utente falliva sulla RLS dello
  // storage per motivi non chiari (vedi la nota nel vecchio pannello admin).
  const admin = createAdminClient();
  const percorso = `${productId}/${Date.now()}-${nomeFileSicuro(file.name)}`;
  const { error: erroreUpload } = await admin.storage.from("documents").upload(percorso, file);
  if (erroreUpload) {
    console.error("Console: upload del file prodotto fallito", erroreUpload.message);
    return { errore: "Caricamento del file non riuscito." };
  }

  const { error: erroreRiga } = await admin
    .from("product_files")
    .insert({ product_id: productId, label: etichetta, file_path: percorso, sort_order: leggiOrdineFile(formData.get("sortOrder"), 0) });
  if (erroreRiga) {
    console.error("Console: salvataggio del file prodotto fallito", erroreRiga.message);
    // il file appena caricato non ha una riga che lo usa: non si lascia nello storage
    await admin.storage.from("documents").remove([percorso]);
    return { errore: "Il file è stato caricato ma non registrato: riprova." };
  }

  ricarica();
  return { ok: true };
}

// I clienti che hanno già pagato il prodotto perdono questo file: lo dice la conferma nella pagina.
export async function rimuoviFile(_stato: StatoProdotto, formData: FormData): Promise<StatoProdotto> {
  const sessione = await richiediAdminAzione();
  if (!sessione) return { errore: "Non autorizzato." };

  const fileId = String(formData.get("fileId") ?? "");
  if (!UUID.test(fileId)) return { errore: "File non valido." };

  const admin = createAdminClient();
  const { data: file } = await admin
    .from("product_files")
    .select("file_path, product_file_previews(image_path)")
    .eq("id", fileId)
    .maybeSingle<{ file_path: string; product_file_previews: { image_path: string }[] | null }>();
  if (!file) return { errore: "File non trovato." };

  const { error } = await admin.from("product_files").delete().eq("id", fileId);
  if (error) {
    console.error("Console: rimozione del file prodotto fallita", error.message);
    return { errore: "Errore nella rimozione del file." };
  }

  await admin.storage.from("documents").remove([file.file_path]);
  const anteprime = (file.product_file_previews ?? []).map((a) => a.image_path);
  if (anteprime.length > 0) await admin.storage.from("product-previews").remove(anteprime);

  ricarica();
  return { ok: true };
}

// Link firmato (60 secondi) per scaricare un file del prodotto e controllarlo.
// Il nome va passato a { download }: senza, alcuni browser salvano il file come .txt.
export async function ottieniLinkFileProdotto(_stato: StatoProdotto, formData: FormData): Promise<StatoProdotto> {
  const sessione = await richiediAdminAzione();
  if (!sessione) return { errore: "Non autorizzato." };

  const fileId = String(formData.get("fileId") ?? "");
  if (!UUID.test(fileId)) return { errore: "File non valido." };

  const admin = createAdminClient();
  const { data: file } = await admin.from("product_files").select("file_path").eq("id", fileId).maybeSingle<{ file_path: string }>();
  if (!file) return { errore: "File non trovato." };

  const nome = (file.file_path.split("/").pop() ?? "file").replace(/^\d+-/, "");
  const { data: firmato, error } = await admin.storage.from("documents").createSignedUrl(file.file_path, 60, { download: nome });
  if (error || !firmato) return { errore: "Errore nella generazione del link di download." };
  return { url: firmato.signedUrl };
}

// ───── Anteprime di un file ─────

export async function aggiungiAnteprime(_stato: StatoProdotto, formData: FormData): Promise<StatoProdotto> {
  const sessione = await richiediAdminAzione();
  if (!sessione) return { errore: "Non autorizzato." };

  const productFileId = String(formData.get("productFileId") ?? "");
  if (!UUID.test(productFileId)) return { errore: "File non valido." };

  const scelti = formData.getAll("images").filter((f): f is File => f instanceof File && f.name !== "");
  if (scelti.length === 0) return { errore: "Scegli almeno un'immagine." };

  const scartati: string[] = [];
  const validi: File[] = [];
  for (const f of scelti) {
    const motivo = giudicaAnteprima(f);
    if (motivo) scartati.push(`${f.name}: ${motivo}`);
    else validi.push(f);
  }
  if (validi.length === 0) return { errore: `Nessuna immagine caricata. ${scartati.join("; ")}.` };

  const admin = createAdminClient();
  const { data: esistenti } = await admin
    .from("product_file_previews")
    .select("sort_order")
    .eq("product_file_id", productFileId)
    .order("sort_order", { ascending: false })
    .limit(1);
  let prossimo = ((esistenti?.[0] as { sort_order: number } | undefined)?.sort_order ?? -1) + 1;

  let caricate = 0;
  for (const [indice, immagine] of validi.entries()) {
    const percorso = `${productFileId}/${Date.now()}-${indice}-${nomeFileSicuro(immagine.name)}`;
    const { error: erroreUpload } = await admin.storage.from("product-previews").upload(percorso, immagine);
    if (erroreUpload) {
      console.error("Console: upload dell'anteprima fallito", erroreUpload.message);
      scartati.push(`${immagine.name}: caricamento non riuscito`);
      continue;
    }
    const { error: erroreRiga } = await admin.from("product_file_previews").insert({ product_file_id: productFileId, image_path: percorso, sort_order: prossimo });
    if (erroreRiga) {
      console.error("Console: salvataggio dell'anteprima fallito", erroreRiga.message);
      await admin.storage.from("product-previews").remove([percorso]);
      scartati.push(`${immagine.name}: salvataggio non riuscito`);
      continue;
    }
    prossimo += 1;
    caricate += 1;
  }

  if (caricate === 0) return { errore: `Nessuna immagine caricata. ${scartati.join("; ")}.` };

  ricarica();
  return scartati.length > 0 ? { ok: true, avviso: `Caricate ${caricate}. Non caricate: ${scartati.join("; ")}.` } : { ok: true };
}

export async function rimuoviAnteprima(_stato: StatoProdotto, formData: FormData): Promise<StatoProdotto> {
  const sessione = await richiediAdminAzione();
  if (!sessione) return { errore: "Non autorizzato." };

  const previewId = String(formData.get("previewId") ?? "");
  if (!UUID.test(previewId)) return { errore: "Anteprima non valida." };

  const admin = createAdminClient();
  const { data: anteprima } = await admin.from("product_file_previews").select("image_path").eq("id", previewId).maybeSingle<{ image_path: string }>();
  if (!anteprima) return { errore: "Anteprima non trovata." };

  const { error } = await admin.from("product_file_previews").delete().eq("id", previewId);
  if (error) {
    console.error("Console: rimozione dell'anteprima fallita", error.message);
    return { errore: "Errore nella rimozione dell'anteprima." };
  }
  await admin.storage.from("product-previews").remove([anteprima.image_path]);

  ricarica();
  return { ok: true };
}

export async function spostaAnteprima(_stato: StatoProdotto, formData: FormData): Promise<StatoProdotto> {
  const sessione = await richiediAdminAzione();
  if (!sessione) return { errore: "Non autorizzato." };

  const previewId = String(formData.get("previewId") ?? "");
  const productFileId = String(formData.get("productFileId") ?? "");
  const direzione = String(formData.get("direction") ?? "");
  if (!UUID.test(previewId) || !UUID.test(productFileId) || (direzione !== "up" && direzione !== "down")) return { errore: "Richiesta non valida." };

  const admin = createAdminClient();
  const { data, error: erroreLettura } = await admin.from("product_file_previews").select("id, sort_order").eq("product_file_id", productFileId);
  if (erroreLettura) return { errore: "Lettura delle anteprime non riuscita." };

  const cambi = riordinaVoci((data ?? []) as { id: string; sort_order: number }[], previewId, direzione);
  if (!cambi) return { errore: "L'anteprima non si può spostare in quella direzione." };

  for (const c of cambi) {
    const { error } = await admin.from("product_file_previews").update({ sort_order: c.sort_order }).eq("id", c.id);
    if (error) {
      console.error("Console: spostamento dell'anteprima fallito", error.message);
      return { errore: "Errore nello spostamento dell'anteprima." };
    }
  }

  ricarica();
  return { ok: true };
}
