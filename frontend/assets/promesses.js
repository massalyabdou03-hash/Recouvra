let unpaidInvoices = [];

const PROMISE_STATUT_LABELS = { EN_ATTENTE: "En attente", RESPECTEE: "Respectée", NON_RESPECTEE: "En retard" };
const PROMISE_STATUT_BADGES = { EN_ATTENTE: "badge-warn", RESPECTEE: "badge-success", NON_RESPECTEE: "badge-danger" };

async function loadUnpaidInvoices() {
  const { data, error } = await supabaseClient
    .from("factures")
    .select("id,numero_facture,montant_restant,client_id,clients(nom)")
    .neq("statut", "ANNULEE")
    .gt("montant_restant", 0)
    .order("date_echeance");
  unpaidInvoices = error ? [] : (data || []);
  invoice.innerHTML = `<option value="">Sélectionner une facture...</option>` +
    unpaidInvoices.map(i => `<option value="${i.id}">${esc(i.numero_facture || `Facture #${i.id}`)} - ${esc(i.clients?.nom || "Client")} (${money(i.montant_restant)})</option>`).join("");
}

function fillClientFromInvoice() {
  const selected = unpaidInvoices.find(i => i.id === Number(invoice.value));
  if (!selected) {
    client.value = "";
    document.getElementById("client-display").textContent = "—";
    amount.value = "";
    return;
  }
  client.value = selected.client_id;
  document.getElementById("client-display").textContent = selected.clients?.nom || "Client";
  amount.value = selected.montant_restant;
}

async function relancerPromesse(factureId, phone, factureLabel, montant) {
  const profile = await currentProfile();
  const msg = `Bonjour, pour rappel vous vous étiez engagé(e) à régler ${money(montant)} concernant la facture ${factureLabel}. Merci de nous confirmer votre règlement.`;
  const { data: facture } = await supabaseClient.from("factures").select("client_id").eq("id", factureId).single();
  await supabaseClient.from("relances").insert({ entreprise_id: profile.entreprise_id, facture_id: factureId, client_id: facture?.client_id, canal: "WHATSAPP", message: msg, created_by: profile.id });
  const normalized = (phone || "").replace(/[^0-9]/g, "");
  window.open(`https://wa.me/${normalized}?text=${encodeURIComponent(msg)}`, "_blank");
}

async function loadPromises() {
  await supabaseClient.rpc("verifier_promesses");
  const { data, error } = await supabaseClient
    .from("promesses_paiement")
    .select("*,factures(numero_facture),clients(nom,telephone)")
    .order("date_promise");

  const el = document.getElementById("promises-content");
  if (error) { el.innerHTML = `<div class="error-msg">${esc(error.message)}</div>`; return; }
  if (!data || data.length === 0) { el.innerHTML = `<div class="empty-state">Aucune promesse de règlement en cours.</div>`; return; }

  el.innerHTML = `
    <div class="table-wrapper">
    <table>
      <thead><tr><th>Client</th><th>Facture liée</th><th class="num">Montant promis</th><th>Date d'échéance</th><th>Statut</th><th></th></tr></thead>
      <tbody>
        ${data.map(p => `
          <tr>
            <td>${esc(p.clients?.nom || "Client")}</td>
            <td class="ref">${esc(p.factures?.numero_facture || `Facture #${p.facture_id}`)}</td>
            <td class="num">${money(p.montant_promis)}</td>
            <td>${date(p.date_promise)}</td>
            <td><span class="badge ${PROMISE_STATUT_BADGES[p.statut] || "badge-muted"}">${esc(PROMISE_STATUT_LABELS[p.statut] || p.statut)}</span></td>
            <td class="actions-cell">
              <button type="button" class="button whatsapp btn-sm" onclick="relancerPromesse(${p.facture_id}, '${esc(p.clients?.telephone || "")}', '${esc(p.factures?.numero_facture || p.facture_id)}', ${Number(p.montant_promis)})">💬 Relancer WhatsApp</button>
            </td>
          </tr>`).join("")}
      </tbody>
    </table>
    </div>`;
}

document.addEventListener("DOMContentLoaded", async () => {
  const profile = await requireRecouvra();
  if (!profile) return;

  await loadUnpaidInvoices();
  await loadPromises();
  invoice.addEventListener("change", fillClientFromInvoice);

  document.querySelector("#promise-form").onsubmit = async e => {
    e.preventDefault();
    const msgEl = document.getElementById("message");
    clearMsg(msgEl);
    if (!invoice.value || !client.value) { showMsg(msgEl, "Sélectionnez une facture impayée."); return; }

    const { error } = await supabaseClient.from("promesses_paiement").insert({
      entreprise_id: profile.entreprise_id,
      facture_id: Number(invoice.value),
      client_id: Number(client.value),
      montant_promis: Number(amount.value),
      date_promise: new Date(due.value).toISOString(),
      created_by: profile.id,
    });

    if (error) { showMsg(msgEl, friendlyError(error)); return; }
    showToast("Promesse de règlement enregistrée.", "success");
    e.target.reset();
    document.getElementById("client-display").textContent = "—";
    await loadPromises();
  };
});
