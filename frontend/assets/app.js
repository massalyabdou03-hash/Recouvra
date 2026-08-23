async function requireAuth() {
  const { data } = await supabaseClient.auth.getSession();
  if (!data.session) { window.location.href = "login.html"; return null; }
  return data.session;
}

async function currentProfile() {
  const { data: userData } = await supabaseClient.auth.getUser();
  if (!userData.user) return null;
  const { data } = await supabaseClient.from("profiles").select("*, entreprises(nom)").eq("id", userData.user.id).single();
  return data;
}

async function requireRecouvra() {
  const profile = await currentProfile();
  if (!profile?.has_recouvra && profile?.role !== "super_admin") {
    document.body.innerHTML = `<main class="shell"><section class="panel access-panel"><span class="eyebrow">Module Premium</span><h1>Recouvra</h1><p>Le suivi des paiements et des relances n'est pas encore active pour ce compte.</p><button class="button" onclick="requestRecouvra()">Demander l'activation</button></section></main>`;
    return null;
  }
  return profile;
}

async function requestRecouvra() {
  const profile = await currentProfile();
  if (!profile) return;
  const { error } = await supabaseClient.from("recouvra_activation_requests").insert({ entreprise_id: profile.entreprise_id, requested_by: profile.id });
  alert(error ? error.message : "Demande envoyee.");
}

function money(value) { return `${Number(value || 0).toLocaleString("fr-FR")} F`; }
function date(value) { return value ? new Date(value).toLocaleDateString("fr-FR") : "-"; }
function esc(value) { return String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c])); }
async function logout() { await supabaseClient.auth.signOut(); location.href = "login.html"; }

(async () => {
  if (!document.body.dataset.public) await requireAuth();
  const profile = await currentProfile();
  if (profile?.entreprise_id) {
    const { data: settings } = await supabaseClient.from("entreprise_settings").select("*").eq("entreprise_id", profile.entreprise_id).single();
    if (settings) {
      document.documentElement.style.setProperty("--primary", settings.primary_color);
      document.documentElement.style.setProperty("--secondary", settings.secondary_color);
      if (settings.dark_mode_enabled) document.documentElement.dataset.theme = "dark";
      document.querySelectorAll("[data-company-name]").forEach(el => el.textContent = settings.nom_commercial || profile.entreprises?.nom || "Entreprise");
    }
  }
})();
