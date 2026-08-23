document.addEventListener("DOMContentLoaded", async () => {
	const profile = await currentProfile();
	if (!profile) return;
	const { data } = await supabaseClient.from("entreprise_settings").select("*").eq("entreprise_id", profile.entreprise_id).maybeSingle();
	if (data) {
		name.value = data.nom_commercial || "";
		phone.value = data.telephone || "";
		email.value = data.email || "";
		address.value = data.adresse || "";
		tax.value = data.identifiant_fiscal || "";
		logo.value = data.logo_path?.startsWith("http") ? data.logo_path : "";
		primary.value = data.primary_color || "#e87516";
		secondary.value = data.secondary_color || "#20252b";
	}
	document.querySelector("#settings-form").onsubmit = async e => {
		e.preventDefault();
		const file = document.getElementById("logo-file").files[0];
		let logoPath = logo.value.trim() || null;
		if (file) {
			const extension = file.name.split(".").pop().toLowerCase();
			logoPath = `${profile.entreprise_id}/logo-${Date.now()}.${extension}`;
			const upload = await supabaseClient.storage.from("company-logos").upload(logoPath, file, { upsert: true, contentType: file.type });
			if (upload.error) { message.textContent = upload.error.message; return; }
		}
		const payload = { entreprise_id: profile.entreprise_id, nom_commercial: name.value, telephone: phone.value, email: email.value, adresse: address.value, identifiant_fiscal: tax.value.trim() || null, logo_path: logoPath, primary_color: primary.value, secondary_color: secondary.value, updated_at: new Date().toISOString() };
		const { error } = await supabaseClient.from("entreprise_settings").upsert(payload);
		message.textContent = error ? error.message : "Paramètres enregistrés.";
		if (!error) {
			let logoUrl = logoPath;
			if (logoPath && !logoPath.startsWith("http")) {
				const { data: signed } = await supabaseClient.storage.from("company-logos").createSignedUrl(logoPath, 3600);
				logoUrl = signed?.signedUrl || null;
			}
			companySettingsPromise = Promise.resolve({ ...payload, logo_url: logoUrl });
			await applyCompanySettings();
		}
	};
});
