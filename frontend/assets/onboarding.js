// Parcours en 5 étapes affiché une seule fois après l'inscription
let selectedCommerce = null;
const selectedBesoins = new Set();
let selectedPlan = 'simple'; // Par défaut : Simple

// --- Tarification dynamique ---
function getSetupFee() {
  const heavy = ['quincaillerie', 'pieces_auto', 'garage'];
  return heavy.includes(selectedCommerce) ? 25000 : 10000;
}

function getMonthlyFee() {
  return selectedPlan === 'recouvrement' ? 15000 : 10000;
}

function getTotalInitial() {
  return getSetupFee() + getMonthlyFee();
}

function goToStep(n) {
  document.querySelectorAll(".onboarding-step").forEach(s => { s.hidden = Number(s.dataset.step) !== n; });
  document.querySelectorAll(".onboarding-progress i").forEach(i => {
    const step = Number(i.dataset.step);
    i.classList.toggle("active", step === n);
    i.classList.toggle("done", step < n);
  });
  document.querySelector(".onboarding-card").scrollTo?.(0, 0);
  window.scrollTo(0, 0);
}

document.getElementById("commerce-choices").addEventListener("click", (e) => {
  const btn = e.target.closest(".onboarding-choice");
  if (!btn) return;
  document.querySelectorAll("#commerce-choices .onboarding-choice").forEach(b => b.classList.remove("selected"));
  btn.classList.add("selected");
  selectedCommerce = btn.dataset.value;
  document.getElementById("step2-next").disabled = false;
  // Mettre à jour le bouton de paiement dès que le commerce est choisi
  updatePaymentButton();
});

document.getElementById("besoins-choices").addEventListener("click", (e) => {
  const btn = e.target.closest(".onboarding-choice");
  if (!btn) return;
  const value = btn.dataset.value;
  if (selectedBesoins.has(value)) { selectedBesoins.delete(value); btn.classList.remove("selected"); }
  else { selectedBesoins.add(value); btn.classList.add("selected"); }
  document.getElementById("step3-next").disabled = selectedBesoins.size === 0;
});

const VALUE_MESSAGES = {
  stock: "Recouvra vous aide à garder une vision claire de votre stock et à suivre chaque mouvement d'entrée ou de sortie.",
  facturation: "Créez des factures professionnelles en quelques secondes, avec le nom et les couleurs de votre entreprise.",
  paiements: "Suivez précisément qui a payé, combien, et ce qu'il reste à encaisser sur chaque vente.",
  credits: "Gardez une trace claire de chaque vente à crédit et de sa date d'échéance, sans rien noter sur papier.",
  recouvrement: "Recouvra peut vous aider à suivre vos créances et à relancer vos clients plus facilement, directement sur WhatsApp.",
  clients: "Retrouvez l'historique complet de chaque client : achats, paiements et solde dû, en un coup d'œil.",
};

function renderValueStep() {
  const el = document.getElementById("value-blocks");
  el.innerHTML = [...selectedBesoins].map(b => `
    <div class="onboarding-value-block"><p>${VALUE_MESSAGES[b]}</p></div>
  `).join("");
}

// --- Sélection du plan mensuel ---
function selectMonthlyPlan(plan, element) {
  selectedPlan = plan;
  document.querySelectorAll('#plan-choices .pricing-option').forEach(card => {
    card.classList.remove('selected');
  });
  if (element) element.classList.add('selected');
  updatePaymentButton();
}

// --- Mise à jour du bouton Wave avec total dynamique ---
function updatePaymentButton() {
  const total = getTotalInitial();
  const waveBtn = document.getElementById('pay-wave-btn');
  if (waveBtn) {
    waveBtn.textContent = `Payer ${total.toLocaleString('fr-FR')} FCFA avec Wave`;
  }
  // Mettre à jour le texte de détail éventuel
  const detail = document.getElementById('payment-detail');
  if (detail) {
    detail.textContent = `Frais de mise en place : ${getSetupFee().toLocaleString('fr-FR')} FCFA + 1er mois : ${getMonthlyFee().toLocaleString('fr-FR')} FCFA`;
  }
}

// --- Recommandation de plan selon commerce ---
function recommendPlan() {
  const heavy = ['quincaillerie', 'pieces_auto', 'garage'];
  return heavy.includes(selectedCommerce) ? 'recouvrement' : 'simple';
}

// --- Initialiser l'étape 5 ---
function initPlanRecommendation() {
  const rec = recommendPlan();
  const recCard = document.getElementById('recommendation-text');
  if (recCard) {
    recCard.textContent = rec === 'recouvrement'
      ? "Pour votre type de commerce, le plan Recouvrement est fortement recommandé (articles illimités, relances WhatsApp)."
      : "Le plan Simple est généralement suffisant pour votre activité.";
  }
  const planEl = document.querySelector(`#plan-choices [data-plan="${rec}"]`);
  if (planEl && !planEl.classList.contains('selected')) {
    selectMonthlyPlan(rec, planEl);
  } else {
    updatePaymentButton();
  }
}

async function finishOnboarding() {
  const btn = document.getElementById("finish-btn");
  const msgEl = document.getElementById("onboarding-msg");
  btn.disabled = true;
  btn.textContent = "Enregistrement...";
  clearMsg(msgEl);

  const { data: userData } = await supabaseClient.auth.getUser();
  const { data: profile } = await supabaseClient
    .from("profiles")
    .select("entreprise_id")
    .eq("id", userData.user.id)
    .maybeSingle();

  if (!profile?.entreprise_id) {
    showMsg(msgEl, "Entreprise non trouvée.", "error");
    btn.disabled = false;
    btn.textContent = "J'ai effectué le paiement";
    return;
  }

  // Mettre à jour l'entreprise avec le type de commerce et besoins
  const { error: updateError } = await supabaseClient
    .from("entreprises")
    .update({
      type_commerce: selectedCommerce,
      besoins: [...selectedBesoins],
      onboarding_completed_at: new Date().toISOString(),
    })
    .eq("id", profile.entreprise_id);

  if (updateError) {
    showMsg(msgEl, friendlyError(updateError), "error");
    btn.disabled = false;
    btn.textContent = "J'ai effectué le paiement";
    return;
  }

  // Upload de la preuve de paiement (si fournie)
  let proofPath = null;
  const proofFile = document.getElementById("payment-proof")?.files?.[0];
  if (proofFile) {
    const extension = proofFile.name.split(".").pop().toLowerCase();
    proofPath = `${profile.entreprise_id}/setup-${Date.now()}.${extension}`;
    const upload = await supabaseClient.storage
      .from("payment-proofs")
      .upload(proofPath, proofFile, { upsert: false, contentType: proofFile.type });
    if (upload.error) {
      showMsg(msgEl, upload.error.message, "error");
      btn.disabled = false;
      btn.textContent = "J'ai effectué le paiement";
      return;
    }
  }

  // Montant total = Frais de mise en place + 1er mois
  const amount = getTotalInitial();
  const reference = document.getElementById("payment-reference")?.value.trim() || null;

  // Insérer le paiement initial
  const { error: paymentError } = await supabaseClient
    .from("subscription_payments")
    .insert({
      entreprise_id: profile.entreprise_id,
      submitted_by: userData.user.id,
      payment_type: 'setup',                // ou 'initial'
      payment_tier: selectedCommerce,       // on peut stocker le type de commerce
      monthly_plan: selectedPlan,           // 'simple' ou 'recouvrement'
      amount: amount,
      payment_reference: reference,
      proof_path: proofPath,
      status: 'pending'
    });

  btn.disabled = false;
  btn.textContent = "J'ai effectué le paiement";

  if (paymentError) {
    if (proofPath) await supabaseClient.storage.from("payment-proofs").remove([proofPath]);
    showMsg(msgEl, paymentError.code === "23505" ? "Une demande est déjà en attente." : friendlyError(paymentError), "error");
    return;
  }

  document.getElementById("payment-section").hidden = true;
  document.getElementById("payment-step-pending").hidden = false;

  pollSubscriptionActivation(profile.entreprise_id);
}

function pollSubscriptionActivation(entrepriseId) {
  const interval = setInterval(async () => {
    const { data } = await supabaseClient
      .from("subscriptions")
      .select("status, plan_id, plans(code, nom, prix_mensuel, max_articles, max_users, has_recouvra)")
      .eq("entreprise_id", entrepriseId)
      .maybeSingle();
    if (data?.status === "active") {
      clearInterval(interval);
      // Enregistrer le plan dans le localStorage (clé mise à jour)
      localStorage.setItem('recouvra_plan', JSON.stringify(data.plans));
      window.location.href = "index.html";
    }
  }, 4000);
}

// Initialisation du parcours
document.addEventListener('DOMContentLoaded', async () => {
  const session = await requireAuth();
  if (!session) return;

  // Observer l'étape 5 pour initialiser la recommandation
  document.querySelectorAll('.onboarding-step[data-step="5"]').forEach(step => {
    const observer = new MutationObserver(() => {
      if (!step.hidden) initPlanRecommendation();
    });
    observer.observe(step, { attributes: true, attributeFilter: ['hidden'] });
  });
});