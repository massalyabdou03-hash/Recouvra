document.addEventListener("DOMContentLoaded", async () => {
  const profile = await currentProfile();
  if (!profile) return;
  if (profile.has_recouvra || profile.role === "super_admin") {
    window.location.href = "recouvra.html";
    return;
  }

  const form = document.getElementById("subscription-form");
  const fileInput = document.getElementById("payment-proof");
  const message = document.getElementById("subscription-message");
  const submit = document.getElementById("subscription-submit");
  const maxSize = 5 * 1024 * 1024;
  const allowedTypes = ["image/jpeg", "image/png", "application/pdf"];

  form.addEventListener("submit", async event => {
    event.preventDefault();
    const file = fileInput.files[0];
    if (!file || !allowedTypes.includes(file.type)) { message.textContent = "Importez un fichier JPG, PNG ou PDF."; return; }
    if (file.size > maxSize) { message.textContent = "Le fichier ne doit pas dépasser 5 Mo."; return; }
    submit.disabled = true;
    message.textContent = "Envoi de la preuve...";
    const extension = file.name.split(".").pop().toLowerCase();
    const path = `${profile.entreprise_id}/payment-${Date.now()}.${extension}`;
    const upload = await supabaseClient.storage.from("payment-proofs").upload(path, file, { upsert: false, contentType: file.type });
    if (upload.error) { message.textContent = upload.error.message; submit.disabled = false; return; }
    const { error } = await supabaseClient.from("demandes_abonnement").insert({ entreprise_id: profile.entreprise_id, submitted_by: profile.id, reference_wave: document.getElementById("wave-reference").value.trim(), preuve_paiement_path: path, montant: 15000 });
    if (error) {
      await supabaseClient.storage.from("payment-proofs").remove([path]);
      message.textContent = error.code === "23505" ? "Une demande est déjà en attente." : error.message;
      submit.disabled = false;
      return;
    }
    message.textContent = "Preuve envoyée. L'activation sera faite après vérification du paiement.";
    form.reset();
    submit.disabled = false;
  });

  const termsModal = document.getElementById("terms-modal");
  document.getElementById("terms-link").onclick = () => { termsModal.hidden = false; };
  document.querySelector(".terms-close").onclick = () => { termsModal.hidden = true; };
  termsModal.onclick = event => { if (event.target === termsModal) termsModal.hidden = true; };
});
