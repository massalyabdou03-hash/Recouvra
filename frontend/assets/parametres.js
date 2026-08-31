// ============================================================================
// PARAMÈTRES - Configuration de l'entreprise
// ============================================================================

document.addEventListener('DOMContentLoaded', async () => {
    const session = await requireAuth();
    if (!session) return;

    await loadSettings();

    const form = document.getElementById('settings-form');
    if (form) form.addEventListener('submit', saveSettings);

    const logoFile = document.getElementById('logo-file');
    if (logoFile) logoFile.addEventListener('change', handleLogoUpload);
});

async function requireAuth() {
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (!session) {
        window.location.href = 'login.html';
        return null;
    }
    return session;
}

async function loadSettings() {
    try {
        const { data, error } = await supabaseClient
            .from('entreprise_settings')
            .select('*')
            .single();

        if (error) throw error;

        if (data) {
            if (document.getElementById('name')) document.getElementById('name').value = data.nom_commercial || '';
            if (document.getElementById('phone')) document.getElementById('phone').value = data.telephone || '';
            if (document.getElementById('email')) document.getElementById('email').value = data.email || '';
            if (document.getElementById('address')) document.getElementById('address').value = data.adresse || '';
            if (document.getElementById('tax')) document.getElementById('tax').value = data.identifiant_fiscal || '';
            if (document.getElementById('logo')) document.getElementById('logo').value = data.logo_path || '';
            if (document.getElementById('primary')) document.getElementById('primary').value = data.primary_color || '#4F46E5';
            if (document.getElementById('secondary')) document.getElementById('secondary').value = data.secondary_color || '#20252b';
        }
    } catch (error) {
        console.error('Erreur chargement paramètres:', error);
        showToast(friendlyError(error), 'error');
    }
}

async function handleLogoUpload(e) {
    const file = e.target.files[0];
    if (!file) return;

    if (file.size > 2 * 1024 * 1024) {
        showToast('Le logo ne doit pas dépasser 2 Mo.', 'error');
        return;
    }

    const { data: { session } } = await supabaseClient.auth.getSession();
    if (!session) return;

    const fileExt = file.name.split('.').pop();
    const filePath = `${session.user.id}/logo-${Date.now()}.${fileExt}`;

    try {
        const { error } = await supabaseClient.storage
            .from('company-logos')
            .upload(filePath, file, {
                cacheControl: '3600',
                upsert: true,
            });

        if (error) throw error;

        // Obtenir l'URL publique
        const { data: urlData } = supabaseClient.storage
            .from('company-logos')
            .getPublicUrl(filePath);

        if (document.getElementById('logo')) {
            document.getElementById('logo').value = urlData.publicUrl;
        }
        showToast('Logo téléchargé avec succès.', 'success');

    } catch (error) {
        console.error('Erreur upload logo:', error);
        showToast(friendlyError(error), 'error');
    }
}

async function saveSettings(e) {
    e.preventDefault();
    
    const btn = e.target.querySelector('button[type="submit"]');
    const msgEl = document.getElementById('message');
    
    if (btn) btn.disabled = true;
    if (msgEl) {
        msgEl.textContent = 'Enregistrement...';
        msgEl.className = 'settings-message';
    }

    const payload = {
        nom_commercial: document.getElementById('name').value.trim(),
        telephone: document.getElementById('phone').value.trim() || null,
        email: document.getElementById('email').value.trim() || null,
        adresse: document.getElementById('address').value.trim() || null,
        identifiant_fiscal: document.getElementById('tax').value.trim() || null,
        logo_path: document.getElementById('logo').value.trim() || null,
        primary_color: document.getElementById('primary').value,
        secondary_color: document.getElementById('secondary').value,
        updated_at: new Date().toISOString(),
    };

    try {
        // Vérifier si une ligne existe déjà
        const { data: existing, error: checkError } = await supabaseClient
            .from('entreprise_settings')
            .select('entreprise_id')
            .single();

        if (checkError && checkError.code !== 'PGRST116') {
            throw checkError;
        }

        let error;
        if (existing) {
            // Mise à jour
            const { error: updateError } = await supabaseClient
                .from('entreprise_settings')
                .update(payload)
                .eq('entreprise_id', existing.entreprise_id);
            error = updateError;
        } else {
            // Insertion (récupérer l'entreprise_id depuis le profil)
            const { data: { session } } = await supabaseClient.auth.getSession();
            if (!session) throw new Error('Session expirée');

            const { data: profile } = await supabaseClient
                .from('profiles')
                .select('entreprise_id')
                .eq('id', session.user.id)
                .single();

            if (!profile?.entreprise_id) throw new Error('Entreprise non trouvée');

            const { error: insertError } = await supabaseClient
                .from('entreprise_settings')
                .insert({
                    ...payload,
                    entreprise_id: profile.entreprise_id,
                });
            error = insertError;
        }

        if (error) throw error;

        // Mettre à jour le cache local
        const settings = { ...payload };
        localStorage.setItem('sylla_company_settings', JSON.stringify(settings));

        showToast('Paramètres enregistrés avec succès.', 'success');
        if (msgEl) {
            msgEl.textContent = '✓ Paramètres enregistrés';
            msgEl.className = 'settings-message success';
        }

    } catch (error) {
        console.error('Erreur sauvegarde paramètres:', error);
        showToast(friendlyError(error), 'error');
        if (msgEl) {
            msgEl.textContent = 'Erreur lors de l\'enregistrement';
            msgEl.className = 'settings-message error';
        }
    } finally {
        if (btn) btn.disabled = false;
        if (msgEl) {
            setTimeout(() => { msgEl.textContent = ''; }, 3000);
        }
    }
}