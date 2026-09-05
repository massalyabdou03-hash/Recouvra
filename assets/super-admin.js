// ============================================================================
// SUPER-ADMIN - Gestion des paiements Recouvra
// ============================================================================

let currentPaymentFilter = 'pending';
let allPayments = [];
let currentPaymentDetail = null;

document.addEventListener('DOMContentLoaded', async () => {
    // Vérifier l'authentification
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (!session) {
        window.location.href = 'login.html';
        return;
    }

    // Vérifier que l'utilisateur est super-admin
    const { data: profile, error: profileError } = await supabaseClient
        .from('profiles')
        .select('role')
        .eq('id', session.user.id)
        .single();

    if (profileError || !profile || profile.role !== 'super_admin') {
        showToast('Accès non autorisé.', 'error');
        window.location.href = 'index.html';
        return;
    }

    // Charger les données
    await loadPayments();

    // Écouter les filtres
    document.querySelectorAll('.filter-chip').forEach(chip => {
        chip.addEventListener('click', () => {
            document.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
            chip.classList.add('active');
            currentPaymentFilter = chip.dataset.filter;
            renderPayments();
        });
    });

    // Écouter les boutons du modal de rejet
    document.getElementById('reject-reason-select')?.addEventListener('change', (e) => {
        document.getElementById('reject-other-wrap').hidden = e.target.value !== 'Autre';
    });

    document.getElementById('reject-final-btn')?.addEventListener('click', submitRejection);
});

async function loadPayments() {
    const tbody = document.getElementById('payments-tbody');
    if (!tbody) {
        console.error('Élément payments-tbody introuvable');
        return;
    }

    tbody.innerHTML = `
        <tr>
            <td colspan="9" class="payments-empty">
                <div class="loading-spinner">Chargement des paiements...</div>
            </td>
        </tr>
    `;

    try {
        const { data, error } = await supabaseClient
            .from('subscription_payments')
            .select(`
                *,
                entreprises(nom, gerant_nom, telephone),
                profiles!submitted_by(email)
            `)
            .order('created_at', { ascending: false });

        if (error) throw error;

        allPayments = data || [];
        renderStats();
        renderPayments();

    } catch (error) {
        console.error('Erreur chargement paiements:', error);
        tbody.innerHTML = `
            <tr>
                <td colspan="9" class="payments-empty">
                    <div class="error-msg">${friendlyError(error)}</div>
                </td>
            </tr>
        `;
    }
}

function renderStats() {
    const pending = allPayments.filter(p => p.status === 'pending');
    const confirmed = allPayments.filter(p => p.status === 'confirmed');
    const rejected = allPayments.filter(p => p.status === 'rejected');

    const pendingAmount = pending.reduce((s, p) => s + Number(p.amount), 0);
    const confirmedAmount = confirmed.reduce((s, p) => s + Number(p.amount), 0);

    const statPendingCount = document.getElementById('stat-pending-count');
    const statPendingAmount = document.getElementById('stat-pending-amount');
    const statConfirmedCount = document.getElementById('stat-confirmed-count');
    const statConfirmedAmount = document.getElementById('stat-confirmed-amount');
    const notice = document.getElementById('payments-notice');

    if (statPendingCount) statPendingCount.textContent = pending.length;
    if (statPendingAmount) statPendingAmount.textContent = fmtMoney(pendingAmount);
    if (statConfirmedCount) statConfirmedCount.textContent = confirmed.length;
    if (statConfirmedAmount) statConfirmedAmount.textContent = fmtMoney(confirmedAmount);

    if (notice) {
        if (pending.length > 0) {
            notice.hidden = false;
            notice.innerHTML = `⚠️ <strong>${pending.length}</strong> paiement(s) en attente de validation (${fmtMoney(pendingAmount)})`;
        } else {
            notice.hidden = true;
        }
    }
}

function renderPayments() {
    const tbody = document.getElementById('payments-tbody');
    if (!tbody) return;

    let filtered = allPayments;
    if (currentPaymentFilter !== 'all') {
        filtered = allPayments.filter(p => p.status === currentPaymentFilter);
    }

    if (filtered.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="9" class="payments-empty">
                    Aucun paiement ${currentPaymentFilter !== 'all' ? currentPaymentFilter : ''}
                </td>
            </tr>`;
        return;
    }

    const statusBadge = {
        pending: '<span class="badge badge-warn">En attente</span>',
        confirmed: '<span class="badge badge-success">Confirmé</span>',
        rejected: '<span class="badge badge-danger">Rejeté</span>',
    };

    tbody.innerHTML = filtered.map(p => `
        <tr>
            <td><strong>${esc(p.entreprises?.nom || '—')}</strong></td>
            <td>${esc(p.entreprises?.gerant_nom || '—')}</td>
            <td>${esc(p.entreprises?.telephone || '—')}</td>
            <td><strong>${fmtMoney(p.amount)}</strong></td>
            <td>${esc(p.payment_type || '—')}</td>
            <td>${esc(p.payment_method || '—')}</td>
            <td>${fmtDate(p.created_at)}</td>
            <td>${statusBadge[p.status] || p.status}</td>
            <td>
                ${p.status === 'pending' ? `
                    <button class="btn btn-sm btn-secondary" onclick="openPaymentDetail('${p.id}')">
                        Vérifier
                    </button>
                ` : ''}
            </td>
        </tr>
    `).join('');
}

function openPaymentDetail(paymentId) {
    const payment = allPayments.find(p => p.id === paymentId);
    if (!payment) return;

    currentPaymentDetail = payment;

    const content = document.getElementById('payment-detail-content');
    if (!content) return;

    content.innerHTML = `
        <div class="detail-row">
            <span class="k">Entreprise</span>
            <span class="v">${esc(payment.entreprises?.nom || '—')}</span>
        </div>
        <div class="detail-row">
            <span class="k">Gérant</span>
            <span class="v">${esc(payment.entreprises?.gerant_nom || '—')}</span>
        </div>
        <div class="detail-row">
            <span class="k">Téléphone</span>
            <span class="v">${esc(payment.entreprises?.telephone || '—')}</span>
        </div>
        <div class="detail-row">
            <span class="k">Type</span>
            <span class="v">${esc(payment.payment_type)}</span>
        </div>
        <div class="detail-row">
            <span class="k">Montant</span>
            <span class="v">${fmtMoney(payment.amount)} ${esc(payment.currency)}</span>
        </div>
        <div class="detail-row">
            <span class="k">Référence</span>
            <span class="v">${esc(payment.payment_reference || '—')}</span>
        </div>
        <div class="detail-row">
            <span class="k">Date</span>
            <span class="v">${fmtDateTime(payment.created_at)}</span>
        </div>
        ${payment.proof_path ? `
            <div class="detail-row">
                <span class="k">Preuve</span>
                <span class="v">
                    <a href="${getStorageUrl(payment.proof_path)}" target="_blank" class="btn btn-secondary btn-sm">
                        Voir la preuve
                    </a>
                </span>
            </div>
        ` : ''}
    `;

    // Actions
    const actions = document.getElementById('payment-detail-actions');
    if (actions) {
        actions.innerHTML = `
            <button class="btn btn-secondary" onclick="closePaymentDetail()">Fermer</button>
            <button class="btn btn-danger" onclick="rejectPayment('${payment.id}')">Rejeter</button>
            <button class="btn" onclick="confirmPayment('${payment.id}')">Confirmer</button>
        `;
    }

    const backdrop = document.getElementById('payment-detail-backdrop');
    if (backdrop) backdrop.classList.add('open');
}

function closePaymentDetail() {
    const backdrop = document.getElementById('payment-detail-backdrop');
    if (backdrop) backdrop.classList.remove('open');
}

async function confirmPayment(paymentId) {
    const ok = await confirmDialog(
        'Confirmer ce paiement ? L\'entreprise sera activée immédiatement.',
        { title: 'Confirmer le paiement', confirmLabel: 'Confirmer', danger: false }
    );
    if (!ok) return;

    try {
        const { error } = await supabaseClient
            .rpc('confirm_subscription_payment', {
                p_payment_id: paymentId,
                p_decision: 'confirmed',
            });

        if (error) throw error;

        showToast('Paiement confirmé — entreprise activée.', 'success');
        closePaymentDetail();
        await loadPayments();

    } catch (error) {
        showToast(friendlyError(error), 'error');
    }
}

function rejectPayment(paymentId) {
    // Ouvrir modal de rejet
    const backdrop = document.getElementById('reject-backdrop');
    if (backdrop) backdrop.classList.add('open');
    
    const reasonSelect = document.getElementById('reject-reason-select');
    const otherText = document.getElementById('reject-other-text');
    const otherWrap = document.getElementById('reject-other-wrap');
    
    if (reasonSelect) reasonSelect.value = 'Paiement introuvable';
    if (otherText) otherText.value = '';
    if (otherWrap) otherWrap.hidden = true;
}

async function submitRejection() {
    const reason = document.getElementById('reject-reason-select').value;
    const otherReason = document.getElementById('reject-other-text').value.trim();
    const finalReason = reason === 'Autre' ? otherReason : reason;

    if (!finalReason) {
        showToast('Un motif est obligatoire pour rejeter.', 'error');
        return;
    }

    try {
        const { error } = await supabaseClient
            .rpc('confirm_subscription_payment', {
                p_payment_id: currentPaymentDetail.id,
                p_decision: 'rejected',
                p_rejection_reason: finalReason,
            });

        if (error) throw error;

        showToast('Paiement rejeté.', 'info');
        closeRejectModal();
        closePaymentDetail();
        await loadPayments();

    } catch (error) {
        showToast(friendlyError(error), 'error');
    }
}

function closeRejectModal() {
    const backdrop = document.getElementById('reject-backdrop');
    if (backdrop) backdrop.classList.remove('open');
}