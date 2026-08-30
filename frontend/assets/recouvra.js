async function loadDebts() {
  const allowed = await requireRecouvra(); if (!allowed) return;
  const params = new URLSearchParams(location.search);
  const factureFilter = params.get("facture") ? Number(params.get("facture")) : null;
  const clientFilter = params.get("client") ? Number(params.get("client")) : null;

  let query = supabaseClient.from("factures").select("id,numero_facture,montant_total,montant_paye,montant_restant,statut_paiement,date_echeance,created_at,client_id,clients(nom,telephone)").neq("statut", "ANNULEE").gt("montant_restant", 0).order("date_echeance");
  if (factureFilter) query = query.eq("id", factureFilter);
  else if (clientFilter) query = query.eq("client_id", clientFilter);

  const { data, error } = await query;
  const el = document.getElementById("debts-content");
  if (error) { el.innerHTML = `<div class="error-msg">${esc(error.message)}</div>`; return; }

  const filterBanner = (factureFilter || clientFilter)
    ? `<p class="hint">Filtré ${factureFilter ? `sur la facture #${factureFilter}` : "sur ce client"} — <a href="recouvra.html">voir toutes les créances</a></p>`
    : "";

  if (!data || data.length === 0) {
    el.innerHTML = filterBanner + `<div class="empty-state">Aucune créance ouverte.</div>`;
    return;
  }

  const today = new Date();
  el.innerHTML = filterBanner + `
    <div style="overflow-x:auto;">
    <table>
      <thead><tr><th>N° Facture / Date</th><th>Client</th><th class="num col-optional-mobile">Montant total</th><th class="num">Reste à payer</th><th>Statut</th><th></th></tr></thead>
      <tbody>
        ${data.map(invoice => {
          const late = Boolean(invoice.date_echeance && new Date(invoice.date_echeance) < today);
          return `
          <tr>
            <td><span class="ref">${esc(invoice.numero_facture || `Facture #${invoice.id}`)}</span><br><span class="hint">${date(invoice.created_at)}</span></td>
            <td>${esc(invoice.clients?.nom || "Client")}</td>
            <td class="num col-optional-mobile">${money(invoice.montant_total)}</td>
            <td class="num"><strong>${money(invoice.montant_restant)}</strong></td>
            <td><span class="badge ${late ? "badge-danger" : "badge-warn"}">${late ? "En retard" : "Partielle"}</span></td>
            <td class="actions-cell">
              <button type="button" class="button whatsapp btn-sm" onclick="relanceWhatsApp(${invoice.id}, '${esc(invoice.clients?.telephone || "")}', '${esc(invoice.clients?.nom || "Client")}', '${esc(invoice.numero_facture || invoice.id)}', ${Number(invoice.montant_restant)})">💬 Relancer WhatsApp</button>
              <a class="button secondary btn-sm" href="paiements.html?facture=${invoice.id}">Paiement</a>
            </td>
          </tr>`;
        }).join("")}
      </tbody>
    </table>
    </div>`;
}

async function relanceWhatsApp(factureId, phone, nomClient, numero, resteAPayer) {
  const profile = await currentProfile();
  const message = `Bonjour ${nomClient}, sauf erreur de notre part, votre facture N°${numero} présente un solde de ${money(resteAPayer)}. Merci de procéder au règlement dans les meilleurs délais.`;
  const { data: facture } = await supabaseClient.from("factures").select("client_id").eq("id", factureId).single();
  await supabaseClient.from("relances").insert({ entreprise_id: profile.entreprise_id, facture_id: factureId, client_id: facture?.client_id, canal: "WHATSAPP", message, created_by: profile.id });
  const normalized = (phone || "").replace(/[^0-9]/g, "");
  window.open(`https://wa.me/${normalized}?text=${encodeURIComponent(message)}`, "_blank");
}

document.addEventListener("DOMContentLoaded", loadDebts);
