// Parcours en 5 étapes affiché une seule fois après l'inscription (voir
// redirectAfterAuth() dans login.html, basé sur entreprises.onboarding_completed_at).

let selectedCommerce = null;
const selectedBesoins = new Set();

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

// Un message par besoin coché — pas de generation dynamique compliquee, juste
// un texte prepare par cas, comme demande.
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

async function finishOnboarding() {
  const btn = document.getElementById("finish-btn");
  const msgEl = document.getElementById("onboarding-msg");
  btn.disabled = true; btn.textContent = "Enregistrement...";

  const { data: userData } = await supabaseClient.auth.getUser();
  const { data: profile } = await supabaseClient.from("profiles").select("entreprise_id").eq("id", userData.user.id).maybeSingle();

  const { error } = await supabaseClient.from("entreprises").update({
    type_commerce: selectedCommerce,
    besoins: [...selectedBesoins],
    onboarding_completed_at: new Date().toISOString(),
  }).eq("id", profile.entreprise_id);

  btn.disabled = false; btn.textContent = "Démarrer ma mise en place — 50 000 FCFA";

  if (error) { showMsg(msgEl, friendlyError(error)); return; }

  // Le paiement PayDunya (Edge Function + webhook) n'est pas encore branché a ce jour :
  // en attendant, on active l'acces normalement plutot que de bloquer l'utilisateur sur
  // un bouton qui ne mene nulle part. A remplacer par la redirection vers la creation de
  // facture PayDunya des que ce systeme est en place (voir architecture d'abonnement).
  showToast("Compte activé. L'équipe Recouvra vous contactera pour finaliser le paiement de la mise en place.", "info", 6000);
  window.location.href = "index.html";
}

(async () => {
  const session = await requireAuth();
  if (!session) return;
})();
