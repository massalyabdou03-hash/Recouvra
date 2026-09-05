// ============================================================================
// PROMESSES - Gestion des promesses de règlement (utilise app.js)
// ============================================================================

document.addEventListener('DOMContentLoaded', async () => {
    const session = await requireAuth();
    if (!session) return;

    const hasRecouvra = await requireRecouvra();
    if (!hasRecouvra) return;

    await loadInvoices();
    await loadPromises();

    const form = document.getElementById('promise-form');
    if (form) form.addEventListener('submit', handlePromiseSubmit);

    const invoiceSelect = document.getElementById('invoice');
    if (invoiceSelect) invoiceSelect.addEventListener('change', updateClientDisplay);
});

// ---------- Chargement des factures impayées ----------
async function loadInvoices() {
    const select = document.getElementById('invoice');
    if (!select) return;
    select.innerHTML = '<option value="">Chargement...</option>';
    try {
        const { data, error } = await supabaseClient
            .from('factures')
            .select('id, numero_facture, montant_restant, client_id, clients(nom)')
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
                <option value="${f.id}" 
                        data-client="${f.client_id}" 
                        data-client-name="${esc(f.clients?.nom || '')}" 
                        data-montant="${f.montant_restant}">
                    ${f.numero_facture} — ${f.clients?.nom || 'Client'} — ${fmtMoney(f.montant_restant)}
                </option>
            `).join('')}
        `;
    } catch (error) {
        console.error('Erreur chargement factures:', error);
        select.innerHTML = '<option value="">Erreur de chargement</option>';
        showToast(friendlyError(error), 'error');
    }
}

// ---------- Mise à jour de l'affichage client ----------
function updateClientDisplay() {
    const select = document.getElementById('invoice');
    const option = select.selectedOptions[0];
    const clientDisplay = document.getElementById('client-display');
    const clientHidden = document.getElementById('client-id');
    const amount = document.getElementById('amount');

    if (clientDisplay) clientDisplay.value = option?.dataset.clientName || '';
    if (clientHidden) clientHidden.value = option?.dataset.client || '';
    if (amount) amount.value = option?.dataset.montant || '';
}

// ---------- Soumission du formulaire ----------
async function handlePromiseSubmit(e) {
    e.preventDefault();
    const factureId = document.getElementById('invoice').value;
    const clientId = document.getElementById('client-id').value;
    const montant = Number(document.getElementById('amount').value);
    const datePromise = document.getElementById('due').value;

    if (!factureId || !clientId || !montant || !datePromise) {
        showToast('Veuillez remplir tous les champs obligatoires.', 'error');
        return;
    }

    const btn = e.target.querySelector('button[type="submit"]');
    btn.disabled = true;
    btn.textContent = 'Enregistrement...';

    try {
        const { error } = await supabaseClient
            .from('promesses_paiement')
            .insert({
                facture_id: Number(factureId),
                client_id: Number(clientId),
                montant_promis: montant,
                date_promise: new Date(datePromise).toISOString(),
            });
        if (error) throw error;

        showToast('✅ Promesse de règlement enregistrée.', 'success');
        e.target.reset();
        updateClientDisplay();
        await loadPromises();
    } catch (error) {
        showToast(friendlyError(error), 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = 'Enregistrer l\'engagement';
    }
}

// ---------- Chargement des promesses ----------
async function loadPromises() {
    const el = document.getElementById('promises-content');
    if (!el) return;
    el.innerHTML = '<div class="empty-state"><span class="spinner-small"></span> Chargement...</div>';

    try {
        await supabaseClient.rpc('verifier_promesses');

        const { data, error } = await supabaseClient
            .from('promesses_paiement')
            .select('*, clients(nom), factures(numero_facture)')
            .order('created_at', { ascending: false });
        if (error) throw error;

        if (!data || data.length === 0) {
            el.innerHTML = '<div class="empty-state">Aucune promesse enregistrée.</div>';
            return;
        }

        const statusBadge = {
            'EN_ATTENTE': '<span class="badge badge-warn">En attente</span>',
            'RESPECTEE': '<span class="badge badge-success">Respectée</span>',
            'NON_RESPECTEE': '<span class="badge badge-danger">Non respectée</span>',
            'ANNULEE': '<span class="badge badge-muted">Annulée</span>',
        };

        el.innerHTML = `
            <div class="table-wrapper">
                <table>
                    <thead>
                        <tr>
                            <th>Client</th>
                            <th>Facture</th>
                            <th>Montant promis</th>
                            <th>Date promise</th>
                            <th>Statut</th>
                            <th>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${data.map(p => `
                            <tr>
                                <td>${esc(p.clients?.nom || '—')}</td>
                                <td class="ref">${esc(p.factures?.numero_facture || '—')}</td>
                                <td class="num"><strong>${fmtMoney(p.montant_promis)}</strong></td>
                                <td class="hint">${fmtDate(p.date_promise)}</td>
                                <td>${statusBadge[p.statut] || p.statut}</td>
                                <td class="actions-cell">
                                    ${p.statut === 'EN_ATTENTE' ? `
                                        <button class="btn btn-sm btn-secondary" onclick="markPromiseRespected('${p.id}')">✓ Respectée</button>
                                        <button class="btn btn-sm btn-secondary" onclick="markPromiseNotRespected('${p.id}')">✗ Non respectée</button>
                                    ` : ''}
                                </td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        `;
    } catch (error) {
        console.error('Erreur chargement promesses:', error);
        el.innerHTML = `<div class="error-msg">${friendlyError(error)}</div>`;
        showToast(friendlyError(error), 'error');
    }
}

// ---------- Marquer comme respectée ----------
async function markPromiseRespected(id) {
    try {
        const { error } = await supabaseClient
            .from('promesses_paiement')
            .update({ statut: 'RESPECTEE', updated_at: new Date().toISOString() })
            .eq('id', id);
        if (error) throw error;
        showToast('Promesse marquée comme respectée.', 'success');
        await loadPromises();
    } catch (error) {
        showToast(friendlyError(error), 'error');
    }
}

// ---------- Marquer comme non respectée ----------
async function markPromiseNotRespected(id) {
    try {
        const { error } = await supabaseClient
            .from('promesses_paiement')
            .update({ statut: 'NON_RESPECTEE', updated_at: new Date().toISOString() })
            .eq('id', id);
        if (error) throw error;
        showToast('Promesse marquée comme non respectée.', 'info');
        await loadPromises();
    } catch (error) {
        showToast(friendlyError(error), 'error');
    }
}