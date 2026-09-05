// ============================================================================
// ABONNEMENT - Gestion du plan Wave (utilise app.js)
// ============================================================================

let selectedPlan = 'simple';
let setupFee = 0;
let monthlyFee = 10000;
let alreadyHasSubscription = false;

document.addEventListener('DOMContentLoaded', async () => {
    const session = await requireAuth();
    if (!session) return;

    // Gestion des CGU
    const termsModal = document.getElementById('terms-modal');
    document.getElementById('terms-link').onclick = () => { termsModal.hidden = false; };
    document.querySelector('.terms-close').onclick = () => { termsModal.hidden = true; };
    termsModal.onclick = (event) => { if (event.target === termsModal) termsModal.hidden = true; };

    // Récupérer le type de commerce de l'entreprise pour les frais de mise en place
    const commerceType = await getCommerceType();
    setupFee = calculateSetupFee(commerceType);
    document.getElementById('setup-text').textContent = `Frais de mise en place : ${fmtMoney(setupFee)} (selon votre type de commerce)`;

    // Vérifier si l'utilisateur a déjà un abonnement actif
    await checkExistingSubscription();
    updatePaymentUI();
});

// ---------- Récupération du type de commerce ----------
async function getCommerceType() {
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (!session) return null;
    const { data: profile } = await supabaseClient.from('profiles').select('entreprise_id').eq('id', session.user.id).single();
    if (!profile?.entreprise_id) return null;
    const { data: entreprise } = await supabaseClient.from('entreprises').select('type_commerce').eq('id', profile.entreprise_id).single();
    return entreprise?.type_commerce || 'boutique';
}

// ---------- Calcul des frais de mise en place ----------
function calculateSetupFee(commerceType) {
    const heavy = ['quincaillerie', 'pieces_auto', 'garage'];
    return heavy.includes(commerceType) ? 25000 : 10000;
}

// ---------- Mise à jour de l'interface de paiement ----------
function updatePaymentUI() {
    const total = (alreadyHasSubscription ? 0 : setupFee) + monthlyFee;
    document.getElementById('payment-detail').textContent = alreadyHasSubscription
        ? `1er mois d'abonnement : ${fmtMoney(monthlyFee)}`
        : `Frais de mise en place : ${fmtMoney(setupFee)} + 1er mois : ${fmtMoney(monthlyFee)} = ${fmtMoney(total)}`;
    document.getElementById('pay-wave-btn').textContent = `Payer ${fmtMoney(total)} avec Wave`;
}

// ---------- Sélection du plan mensuel ----------
function selectMonthlyPlan(plan, element) {
    selectedPlan = plan;
    monthlyFee = plan === 'recouvrement' ? 15000 : 10000;
    document.querySelectorAll('#plan-choices .pricing-option').forEach(card => card.classList.remove('selected'));
    element.classList.add('selected');
    updatePaymentUI();
}

// ---------- Vérification d'un abonnement existant ----------
async function checkExistingSubscription() {
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (!session) return;
    const { data: profile } = await supabaseClient.from('profiles').select('entreprise_id').eq('id', session.user.id).single();
    if (!profile?.entreprise_id) return;
    const { data: subscription } = await supabaseClient.from('subscriptions').select('*').eq('entreprise_id', profile.entreprise_id).maybeSingle();
    if (subscription && subscription.status === 'active') {
        alreadyHasSubscription = true;
        setupFee = 0;
        const plan = subscription.plan;
        if (plan) {
            selectedPlan = plan === 'recouvra_pro' ? 'recouvrement' : 'simple';
            monthlyFee = selectedPlan === 'recouvrement' ? 15000 : 10000;
            const el = document.querySelector(`#plan-choices [data-plan="${selectedPlan}"]`);
            if (el) el.classList.add('selected');
        }
    }
}

// ---------- Soumission du paiement ----------
async function submitPayment() {
    const msgEl = document.getElementById('subscription-message');
    const reference = document.getElementById('payment-reference').value.trim();
    const proofFile = document.getElementById('payment-proof').files[0];
    const termsChecked = document.getElementById('terms').checked;
    if (!termsChecked) {
        msgEl.textContent = 'Veuillez accepter les conditions générales.';
        msgEl.style.color = 'var(--danger)';
        return;
    }

    const btn = document.getElementById('submit-btn');
    btn.disabled = true;
    btn.textContent = 'Envoi...';
    msgEl.textContent = '';

    try {
        const { data: { session } } = await supabaseClient.auth.getSession();
        if (!session) throw new Error('Session expirée');
        const { data: profile } = await supabaseClient.from('profiles').select('entreprise_id').eq('id', session.user.id).single();
        if (!profile?.entreprise_id) throw new Error('Entreprise non trouvée');

        let proofPath = null;
        if (proofFile) {
            const ext = proofFile.name.split('.').pop();
            proofPath = `${profile.entreprise_id}/preuve-${Date.now()}.${ext}`;
            const { error: uploadError } = await supabaseClient.storage.from('payment-proofs').upload(proofPath, proofFile, { upsert: true, contentType: proofFile.type });
            if (uploadError) throw uploadError;
        }

        const total = (alreadyHasSubscription ? 0 : setupFee) + monthlyFee;
        const { error } = await supabaseClient.from('subscription_payments').insert({
            entreprise_id: profile.entreprise_id,
            submitted_by: session.user.id,
            payment_type: alreadyHasSubscription ? 'subscription' : 'setup',
            payment_tier: selectedPlan,
            monthly_plan: selectedPlan,
            amount: total,
            payment_reference: reference || null,
            proof_path: proofPath,
            status: 'pending'
        });
        if (error) throw error;

        msgEl.textContent = '✅ Demande envoyée ! Notre équipe vérifiera votre paiement et activera votre abonnement.';
        msgEl.style.color = 'var(--success)';
    } catch (error) {
        console.error('Erreur soumission paiement:', error);
        msgEl.textContent = friendlyError(error);
        msgEl.style.color = 'var(--danger)';
    } finally {
        btn.disabled = false;
        btn.textContent = 'J\'ai effectué le paiement';
    }
}