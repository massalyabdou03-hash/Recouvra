document.addEventListener("DOMContentLoaded", async () => {
  const profile = await currentProfile();
  if (!profile) return;
  if (profile?.role !== "super_admin") {
    document.body.innerHTML = "<main class='shell'><section class='panel access-panel'><h1>Accès refusé</h1></section></main>";
    return;
  }

  // ---------------- Ancien système (demandes_abonnement, 15 000 F/mois) — inchangé ----------------
  const { data, error } = await supabaseClient
    .from("demandes_abonnement")
    .select("id,entreprise_id,reference_wave,preuve_paiement_path,montant,status,submitted_by,created_at,entreprises(nom,gerant_nom,telephone)")
    .eq("status", "en_attente")
    .order("created_at");
  if (error) {
    requests.textContent = error.message;
  } else {
    const rows = await Promise.all((data || []).map(async r => {
      let proofUrl = "";
      if (r.preuve_paiement_path) {
        const signed = await supabaseClient.storage.from("payment-proofs").createSignedUrl(r.preuve_paiement_path, 3600);
        proofUrl = signed.data?.signedUrl || "";
      }
      return `<article class="card subscription-request"><header><strong>${esc(r.entreprises?.nom || "Entreprise")}</strong><span>${date(r.created_at)}</span></header><p>Gérant : ${esc(r.entreprises?.gerant_nom || "-")} · ${esc(r.entreprises?.telephone || "-")}</p><p><strong>${money(r.montant)}</strong> · Référence Wave : <span class="mono">${esc(r.reference_wave)}</span></p>${proofUrl ? `<a class="proof-link" href="${esc(proofUrl)}" target="_blank" rel="noopener">Voir la preuve de paiement</a>` : "<p>Aucune preuve jointe.</p>"}<button class="button" onclick="approveSubscription('${r.id}','${r.entreprise_id}')">Valider et activer Recouvra</button></article>`;
    }));
    requests.innerHTML = rows.join("") || "<p>Aucun paiement Wave en attente.</p>";
  }

  // ---------------- Nouveau système (subscription_payments, Wave lien + validation manuelle) ----------------
  await loadPayments();

  document.getElementById("payments-filters").addEventListener("click", (e) => {
    const btn = e.target.closest(".filter-chip");
    if (!btn) return;
    document.querySelectorAll(".filter-chip").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    currentFilter = btn.dataset.filter;
    renderPaymentsTable();
  });

  document.getElementById("confirm-final-btn").addEventListener("click", handleConfirmPayment);
  document.getElementById("reject-final-btn").addEventListener("click", handleRejectPayment);
  document.getElementById("reject-reason-select").addEventListener("change", (e) => {
    document.getElementById("reject-other-wrap").hidden = e.target.value !== "Autre";
  });
});

async function approveSubscription(requestId, entrepriseId) {
  const user = (await supabaseClient.auth.getUser()).data.user;
  const { error: profileError } = await supabaseClient.from("profiles").update({ has_recouvra: true, updated_at: new Date().toISOString() }).eq("entreprise_id", entrepriseId);
  if (profileError) { alert(profileError.message); return; }
  const { error } = await supabaseClient.from("demandes_abonnement").update({ status: "validee", reviewed_by: user.id, reviewed_at: new Date().toISOString() }).eq("id", requestId);
  if (error) alert(error.message); else location.reload();
}

// ==================== Nouveau système : subscription_payments ====================

let allPayments = [];
let currentFilter = "pending";
let activePaymentId = null;

const PAYMENT_TYPE_LABELS = { setup: "Mise en place", subscription: "Abonnement" };
const PAYMENT_STATUS_BADGE = {
  pending: '<span class="badge badge-warn">En attente</span>',
  confirmed: '<span class="badge badge-success">Confirmé</span>',
  rejected: '<span class="badge badge-danger">Rejeté</span>',
};

async function loadPayments() {
  const { data, error } = await supabaseClient
    .from("subscription_payments")
    .select("id,entreprise_id,payment_type,amount,currency,provider,payment_method,payment_reference,proof_path,status,rejection_reason,submitted_by,validated_at,created_at,entreprises(nom,gerant_nom,telephone)")
    .order("created_at", { ascending: false });
  if (error) {
    document.getElementById("payments-tbody").innerHTML = `<tr><td colspan="9" class="payments-empty">${esc(error.message)}</td></tr>`;
    return;
  }
  allPayments = data || [];
  renderPaymentsStats();
  renderPaymentsNotice();
  renderPaymentsTable();
}

function renderPaymentsStats() {
  const pending = allPayments.filter(p => p.status === "pending");
  const confirmed = allPayments.filter(p => p.status === "confirmed");
  document.getElementById("stat-pending-count").textContent = pending.length;
  document.getElementById("stat-pending-amount").textContent = money(pending.reduce((s, p) => s + Number(p.amount || 0), 0));
  document.getElementById("stat-confirmed-count").textContent = confirmed.length;
  document.getElementById("stat-confirmed-amount").textContent = money(confirmed.reduce((s, p) => s + Number(p.amount || 0), 0));
}

function renderPaymentsNotice() {
  const pendingCount = allPayments.filter(p => p.status === "pending").length;
  const notice = document.getElementById("payments-notice");
  if (pendingCount === 0) { notice.hidden = true; return; }
  notice.hidden = false;
  notice.innerHTML = `🔔 <span>${pendingCount} paiement${pendingCount > 1 ? "s" : ""} à vérifier</span>`;
}

function renderPaymentsTable() {
  const rows = currentFilter === "all" ? allPayments : allPayments.filter(p => p.status === currentFilter);
  const tbody = document.getElementById("payments-tbody");
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="9" class="payments-empty">Aucun paiement dans cette catégorie.</td></tr>`;
    return;
  }
  tbody.innerHTML = rows.map(p => `
    <tr>
      <td>${esc(p.entreprises?.nom || "-")}</td>
      <td>${esc(p.entreprises?.gerant_nom || "-")}</td>
      <td>${esc(p.entreprises?.telephone || "-")}</td>
      <td>${money(p.amount)}</td>
      <td>${esc(PAYMENT_TYPE_LABELS[p.payment_type] || p.payment_type)}</td>
      <td>Wave</td>
      <td>${date(p.created_at)}</td>
      <td>${PAYMENT_STATUS_BADGE[p.status] || esc(p.status)}</td>
      <td><button type="button" class="btn btn-secondary" onclick="openPaymentDetail('${p.id}')">Vérifier</button></td>
    </tr>
  `).join("");
}

function openPaymentDetail(id) {
  const p = allPayments.find(x => x.id === id);
  if (!p) return;
  activePaymentId = id;

  const content = document.getElementById("payment-detail-content");
  content.innerHTML = `
    <div class="detail-row"><span class="k">Client</span><span class="v">${esc(p.entreprises?.gerant_nom || "-")}</span></div>
    <div class="detail-row"><span class="k">Entreprise</span><span class="v">${esc(p.entreprises?.nom || "-")}</span></div>
    <div class="detail-row"><span class="k">Téléphone</span><span class="v">${esc(p.entreprises?.telephone || "-")}</span></div>
    <div class="detail-row"><span class="k">Montant</span><span class="v">${money(p.amount)}</span></div>
    <div class="detail-row"><span class="k">Type</span><span class="v">${esc(PAYMENT_TYPE_LABELS[p.payment_type] || p.payment_type)}</span></div>
    <div class="detail-row"><span class="k">Méthode</span><span class="v">Wave</span></div>
    <div class="detail-row"><span class="k">Date</span><span class="v">${date(p.created_at)}</span></div>
    <div class="detail-row"><span class="k">Référence déclarée</span><span class="v">${esc(p.payment_reference || "-")}</span></div>
    ${p.status === "rejected" ? `<div class="detail-row"><span class="k">Motif de rejet</span><span class="v">${esc(p.rejection_reason || "-")}</span></div>` : ""}
    <div id="proof-line"></div>
  `;

  const proofLine = document.getElementById("proof-line");
  if (p.proof_path) {
    supabaseClient.storage.from("payment-proofs").createSignedUrl(p.proof_path, 3600).then(({ data: signed }) => {
      proofLine.innerHTML = signed?.signedUrl
        ? `<p style="margin-top:12px;"><a class="proof-link" href="${esc(signed.signedUrl)}" target="_blank" rel="noopener">Voir la preuve de paiement</a></p>`
        : "";
    });
  } else {
    proofLine.innerHTML = `<p style="margin-top:12px; color:var(--text-muted);">Aucune capture jointe.</p>`;
  }

  const actions = document.getElementById("payment-detail-actions");
  actions.innerHTML = p.status === "pending"
    ? `<button type="button" class="btn btn-danger" onclick="openRejectModal()">✕ Rejeter</button>
       <button type="button" class="btn" onclick="openConfirmModal()">✓ Confirmer le paiement</button>`
    : "";

  document.getElementById("payment-detail-backdrop").classList.add("open");
}

function closePaymentDetail() {
  document.getElementById("payment-detail-backdrop").classList.remove("open");
}

function openConfirmModal() {
  const p = allPayments.find(x => x.id === activePaymentId);
  if (!p) return;
  document.getElementById("confirm-text").textContent =
    `Confirmer la réception de ${money(p.amount)} pour ${p.entreprises?.nom || "cette entreprise"} ? Cette action activera le compte et l'abonnement du client.`;
  document.getElementById("confirm-msg").textContent = "";
  document.getElementById("confirm-backdrop").classList.add("open");
}

function closeConfirmModal() {
  document.getElementById("confirm-backdrop").classList.remove("open");
}

async function handleConfirmPayment() {
  const btn = document.getElementById("confirm-final-btn");
  const msgEl = document.getElementById("confirm-msg");
  btn.disabled = true; btn.textContent = "Confirmation...";

  const { error } = await supabaseClient.rpc("confirm_subscription_payment", {
    p_payment_id: activePaymentId,
    p_decision: "confirmed",
  });

  btn.disabled = false; btn.textContent = "Confirmer définitivement";

  if (error) { msgEl.textContent = friendlyError(error); return; }

  closeConfirmModal();
  closePaymentDetail();
  showToast("Compte activé avec succès.", "success");
  await loadPayments();
}

function openRejectModal() {
  document.getElementById("reject-reason-select").value = "Paiement introuvable";
  document.getElementById("reject-other-wrap").hidden = true;
  document.getElementById("reject-other-text").value = "";
  document.getElementById("reject-msg").textContent = "";
  document.getElementById("reject-backdrop").classList.add("open");
}

function closeRejectModal() {
  document.getElementById("reject-backdrop").classList.remove("open");
}

async function handleRejectPayment() {
  const select = document.getElementById("reject-reason-select");
  const otherText = document.getElementById("reject-other-text").value.trim();
  const msgEl = document.getElementById("reject-msg");
  const reason = select.value === "Autre" ? otherText : select.value;

  if (!reason) { msgEl.textContent = "Merci de préciser un motif."; return; }

  const btn = document.getElementById("reject-final-btn");
  btn.disabled = true; btn.textContent = "Rejet...";

  const { error } = await supabaseClient.rpc("confirm_subscription_payment", {
    p_payment_id: activePaymentId,
    p_decision: "rejected",
    p_rejection_reason: reason,
  });

  btn.disabled = false; btn.textContent = "Rejeter";

  if (error) { msgEl.textContent = friendlyError(error); return; }

  closeRejectModal();
  closePaymentDetail();
  showToast("Paiement rejeté.", "info");
  await loadPayments();
}
