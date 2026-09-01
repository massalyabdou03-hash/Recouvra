// Parcours en 5 étapes affiché une seule fois après l'inscription
let selectedCommerce = null;
const selectedBesoins = new Set();
let selectedPlan = 'standard'; // Par défaut : Pack Standard

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

function selectPlan(plan, element) {
  selectedPlan = plan;
  document.querySelectorAll('#offer-choices .pricing-option').forEach(card => {
    card.classList.remove('selected');
  });
  element.classList.add('selected');
  
  const amounts = {
    simple: "10 000 FCFA",
    standard: "50 000 FCFA",
    premium: "100 000 FCFA"
  };
  document.getElementById('selected-amount').textContent = amounts[plan];
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

  const montants = { simple: 10000, standard: 50000, premium: 100000 };
  const reference = document.getElementById("payment-reference")?.value.trim() || null;
  
  const { error: paymentError } = await supabaseClient
    .from("subscription_payments")
    .insert({
      entreprise_id: profile.entreprise_id,
      submitted_by: userData.user.id,
      payment_type: selectedPlan,
      amount: montants[selectedPlan],
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
      .select("status")
      .eq("entreprise_id", entrepriseId)
      .maybeSingle();
    if (data?.status === "active") {
      clearInterval(interval);
      window.location.href = "index.html";
    }
  }, 4000);
}

(async () => {
  const session = await requireAuth();
  if (!session) return;
})();