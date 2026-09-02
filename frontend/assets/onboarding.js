// Parcours en 3 étapes (simplifié) + essai gratuit

let selectedCommerce = null;
const selectedBesoins = new Set();
let selectedPlan = 'simple';

function goToStep(n) {
  document.querySelectorAll(".onboarding-step").forEach(s => { s.hidden = Number(s.dataset.step) !== n; });
  document.querySelectorAll(".onboarding-progress i").forEach(i => {
    const step = Number(i.dataset.step);
    i.classList.toggle("active", step === n);
    i.classList.toggle("done", step < n);
  });
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
});

const VALUE_MESSAGES = {
  stock: "Gérez votre stock en temps réel",
  facturation: "Créez des factures professionnelles",
  paiements: "Suivez qui a payé et qui doit",
  credits: "Gérez les ventes à crédit",
  recouvrement: "Relancez vos clients via WhatsApp",
  clients: "Gardez l'historique de chaque client",
};

function renderValueStep() {
  const el = document.getElementById("value-blocks");
  el.innerHTML = [...selectedBesoins].map(b => `<div class="onboarding-value-block"><p>${VALUE_MESSAGES[b]}</p></div>`).join("");
}

function selectPlan(plan, element) {
  selectedPlan = plan;
  document.querySelectorAll('#plan-choices .pricing-option').forEach(card => card.classList.remove('selected'));
  element.classList.add('selected');
}

async function startTrial() {
  const btn = document.getElementById("finish-btn");
  const msgEl = document.getElementById("onboarding-msg");
  btn.disabled = true;
  btn.textContent = "Création de votre espace...";
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
    btn.textContent = "Commencer mon essai gratuit";
    return;
  }

  // Mettre à jour l'entreprise
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
    btn.textContent = "Commencer mon essai gratuit";
    return;
  }

  // Mettre à jour l'abonnement en mode TRIAL (si pas déjà fait par le trigger)
  const { data: sub } = await supabaseClient
    .from("subscriptions")
    .select("id, status")
    .eq("entreprise_id", profile.entreprise_id)
    .maybeSingle();

  if (!sub) {
    const { data: planData } = await supabaseClient
      .from("plans")
      .select("id")
      .eq("code", selectedPlan)
      .single();
    await supabaseClient.from("subscriptions").insert({
      entreprise_id: profile.entreprise_id,
      plan_id: planData?.id || null,
      status: 'trial',
      trial_ends_at: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
      current_period_end: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
    });
  } else {
    await supabaseClient
      .from("subscriptions")
      .update({
        status: 'trial',
        trial_ends_at: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
        current_period_end: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
      })
      .eq("id", sub.id);
  }

  // Enregistrer le plan en cache
  const { data: plan } = await supabaseClient
    .from("plans")
    .select("*")
    .eq("code", selectedPlan)
    .single();
  if (plan) localStorage.setItem('recouvra_plan', JSON.stringify(plan));

  showMsg(msgEl, "🎉 Votre essai gratuit de 14 jours a commencé !", "success");
  setTimeout(() => { window.location.href = "index.html"; }, 1500);
}

document.addEventListener('DOMContentLoaded', async () => {
  const session = await requireAuth();
  if (!session) return;
});