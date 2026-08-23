async function loadDebts() {
  const allowed = await requireRecouvra(); if (!allowed) return;
  const params = new URLSearchParams(location.search);
  const factureFilter = params.get("facture") ? Number(params.get("facture")) : null;
  const clientFilter = params.get("client") ? Number(params.get("client")) : null;

  let query = supabaseClient.from("factures").select("id,numero_facture,montant_total,montant_paye,montant_restant,statut_paiement,date_echeance,client_id,clients(nom,telephone)").neq("statut", "ANNULEE").gt("montant_restant", 0).order("date_echeance");
  if (factureFilter) query = query.eq("id", factureFilter);
  else if (clientFilter) query = query.eq("client_id", clientFilter);

  const { data, error } = await query;
  if (error) { debts.innerHTML = `<p>${esc(error.message)}</p>`; return; }

  const filterBanner = (factureFilter || clientFilter)
    ? `<p class="hint">Filtré ${factureFilter ? `sur la facture #${factureFilter}` : "sur ce client"} — <a href="recouvra.html">voir toutes les créances</a></p>`
    : "";

  const today = new Date();
  debts.innerHTML = filterBanner + ((data || []).map(invoice => {
    const percent = Math.min(100, Math.round(Number(invoice.montant_paye || 0) / Math.max(Number(invoice.montant_total || 1), 1) * 100));
    const late = Boolean(invoice.date_echeance && new Date(invoice.date_echeance) < today);
    return `<article class="card"><header><div><strong>${esc(invoice.numero_facture || `Facture #${invoice.id}`)}</strong><br><span>${esc(invoice.clients?.nom || "Client")}</span></div><span class="badge ${late ? "late" : "partial"}">${late ? "EN RETARD" : "PARTIELLE"}</span></header><p>Total ${money(invoice.montant_total)} · Payé ${money(invoice.montant_paye)}</p><strong>Solde ${money(invoice.montant_restant)}</strong><div class="progress"><i style="width:${percent}%"></i></div><small>Échéance : ${date(invoice.date_echeance)}</small><div class="toolbar"><button class="button whatsapp" onclick="relanceWhatsApp(${invoice.id}, '${esc(invoice.clients?.telephone || "")}', '${esc(invoice.numero_facture || invoice.id)}', '${invoice.montant_restant}')">💬 Relancer sur WhatsApp</button><a class="button secondary" href="paiements.html?facture=${invoice.id}">Paiement</a></div></article>`;
  }).join("") || "<p>Aucune créance ouverte.</p>");
}
async function relanceWhatsApp(factureId, phone, number, balance) { const profile = await currentProfile(); const message = `Bonjour, rappel concernant la facture ${number}. Solde restant : ${money(balance)}.`; await supabaseClient.from("relances").insert({ entreprise_id: profile.entreprise_id, facture_id: factureId, client_id: (await supabaseClient.from("factures").select("client_id").eq("id", factureId).single()).data.client_id, canal: "WHATSAPP", message, created_by: profile.id }); const normalized = phone.replace(/[^0-9]/g, ""); window.open(`https://wa.me/${normalized}?text=${encodeURIComponent(message)}`, "_blank"); }
document.addEventListener("DOMContentLoaded", loadDebts);
