// ============================================================================
// PAIEMENTS - Enregistrement et suivi des paiements
// ============================================================================

document.addEventListener('DOMContentLoaded', async () => {
    const session = await requireAuth();
    if (!session) return;

    const profile = await requireRecouvra();
    if (!profile) return;

    // Charger le formulaire
    await loadInvoices();

    // Charger l'historique
    await loadPayments();

    // Écouter la soumission du formulaire
    const form = document.getElementById('payment-form');
    if (form) form.addEventListener('submit', handlePaymentSubmit);
});

// requireAuth() et requireRecouvra() sont définis globalement dans app.js
// (gèrent aussi le statut d'abonnement et le rôle super_admin) : on les
// réutilise ici plutôt que de dupliquer une version locale divergente.

async function loadInvoices() {
    const select = document.getElementById('invoice');
    if (!select) return;

    select.innerHTML = '<option value="">Chargement...</option>';

    try {
        const { data, error } = await supabaseClient
            .from('factures')
            .select('id, numero_facture, montant_restant, montant_total, clients(nom)')
            .eq('statut', 'VALIDEE')
            .gt('montant_restant', 0)
            .order('numero_facture');

        if (error) throw error;

        if (!data || data.length === 0) {
            select.innerHTML = '<option value="">Aucune facture impayée</option>';
            return;
        }

        select.innerHTML = `
            <option value="">Sélectionner une facture...</option>
            ${data.map(f => `
                <option value="${f.id}">
                    ${f.numero_facture} — ${f.clients?.nom || 'Client'} — Reste: ${fmtMoney(f.montant_restant)}
                </option>
            `).join('')}
        `;

    } catch (error) {
        console.error('Erreur chargement factures:', error);
        select.innerHTML = '<option value="">Erreur de chargement</option>';
    }
}

async function handlePaymentSubmit(e) {
    e.preventDefault();

    const factureId = document.getElementById('invoice').value;
    const montant = Number(document.getElementById('amount').value);
    const methode = document.getElementById('method').value;
    const reference = document.getElementById('reference').value.trim();

    if (!factureId || !montant || montant <= 0) {
        showToast('Veuillez remplir tous les champs obligatoires.', 'error');
        return;
    }

    const btn = e.target.querySelector('button[type="submit"]');
    btn.disabled = true;
    btn.textContent = 'Enregistrement...';

    try {
        const { data, error } = await supabaseClient
            .rpc('enregistrer_paiement', {
                p_facture_id: Number(factureId),
                p_montant: montant,
                p_methode: methode,
                p_reference: reference || null,
            });

        if (error) throw error;

        showToast('Paiement enregistré avec succès.', 'success');
        e.target.reset();

        // Recharger
        await loadInvoices();
        await loadPayments();

    } catch (error) {
        showToast(friendlyError(error), 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = 'Enregistrer le paiement';
    }
}

async function loadPayments() {
    const el = document.getElementById('payments-content');
    if (!el) return;

    el.innerHTML = '<div class="empty-state">Chargement...</div>';

    try {
        const { data, error } = await supabaseClient
            .from('paiements')
            .select('*, factures(numero_facture), profiles!created_by(email)')
            .order('created_at', { ascending: false })
            .limit(50);

        if (error) throw error;

        if (!data || data.length === 0) {
            el.innerHTML = '<div class="empty-state">Aucun paiement enregistré.</div>';
            return;
        }

        el.innerHTML = `
            <div class="table-wrapper">
                <table>
                    <thead>
                        <tr>
                            <th>Date</th>
                            <th>Facture</th>
                            <th>Montant</th>
                            <th>Méthode</th>
                            <th>Référence</th>
                            <th>Par</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${data.map(p => `
                            <tr>
                                <td class="hint">${fmtDateTime(p.created_at)}</td>
                                <td class="ref">${esc(p.factures?.numero_facture || '—')}</td>
                                <td class="num"><strong>${fmtMoney(p.montant)}</strong></td>
                                <td><span class="badge badge-info">${esc(p.methode)}</span></td>
                                <td class="hint">${esc(p.reference || '—')}</td>
                                <td class="hint">${esc(p.profiles?.email || '—')}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        `;

    } catch (error) {
        console.error('Erreur chargement paiements:', error);
        el.innerHTML = `<div class="error-msg">${friendlyError(error)}</div>`;
    }
}