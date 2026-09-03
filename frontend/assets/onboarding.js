// ============================================================
// ONBOARDING — Script complet avec animations
// ============================================================

document.addEventListener('DOMContentLoaded', () => {
    initOnboarding();
});

function initOnboarding() {
    // Éléments DOM
    const steps = document.querySelectorAll('.onboarding-step');
    const progressDots = document.querySelectorAll('.onboarding-progress i');
    const choices = document.querySelectorAll('.onboarding-choice');
    const planOptions = document.querySelectorAll('.pricing-option');
    const finishBtn = document.getElementById('finish-btn');
    const msgEl = document.getElementById('onboarding-msg');

    let currentStep = 1;
    let selectedCommerce = null;
    let selectedBesoins = [];
    let selectedPlan = null;

    // ---------- Fonction pour changer d'étape avec animation ----------
    window.goToStep = function(step) {
        if (step < 1 || step > steps.length) return;
        // Validation : étape 2 nécessite un commerce
        if (step === 3 && !selectedCommerce) {
            showMessage('Veuillez sélectionner votre type de commerce.', 'warning');
            return;
        }
        // Animation de sortie
        const currentEl = document.querySelector(`.onboarding-step[data-step="${currentStep}"]`);
        if (currentEl) {
            currentEl.style.transition = 'opacity 0.25s ease, transform 0.3s ease';
            currentEl.style.opacity = '0';
            currentEl.style.transform = 'translateX(-20px)';
        }

        // Mise à jour de la progression
        progressDots.forEach((dot, idx) => {
            dot.className = '';
            if (idx + 1 === step) dot.classList.add('active');
            else if (idx + 1 < step) dot.classList.add('done');
        });

        // Afficher la nouvelle étape après un court délai
        setTimeout(() => {
            steps.forEach(s => s.hidden = true);
            const newEl = document.querySelector(`.onboarding-step[data-step="${step}"]`);
            if (newEl) {
                newEl.hidden = false;
                newEl.style.opacity = '0';
                newEl.style.transform = 'translateX(20px)';
                requestAnimationFrame(() => {
                    newEl.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
                    newEl.style.opacity = '1';
                    newEl.style.transform = 'translateX(0)';
                });
            }
            currentStep = step;
        }, 300);
    };

    // ---------- Gestion des choix (type de commerce) ----------
    document.querySelectorAll('#commerce-choices .onboarding-choice').forEach(btn => {
        btn.addEventListener('click', function() {
            document.querySelectorAll('#commerce-choices .onboarding-choice').forEach(b => b.classList.remove('selected'));
            this.classList.add('selected');
            selectedCommerce = this.dataset.value;
            document.getElementById('step2-next').disabled = false;
            // Animation : ajout d'un check
            this.style.transition = 'background 0.2s';
            this.style.background = 'var(--accent-dim)';
            setTimeout(() => this.style.background = '', 300);
        });
    });

    // ---------- Gestion des choix multiples (besoins) ----------
    document.querySelectorAll('#besoins-choices .onboarding-choice').forEach(btn => {
        btn.addEventListener('click', function() {
            this.classList.toggle('selected');
            const val = this.dataset.value;
            if (this.classList.contains('selected')) {
                if (!selectedBesoins.includes(val)) selectedBesoins.push(val);
                // Animation
                this.style.transition = 'transform 0.15s';
                this.style.transform = 'scale(0.95)';
                setTimeout(() => this.style.transform = '', 150);
            } else {
                selectedBesoins = selectedBesoins.filter(v => v !== val);
            }
            updateValueBlocks();
        });
    });

    // ---------- Sélection du plan ----------
    window.selectPlan = function(plan, element) {
        document.querySelectorAll('.pricing-option').forEach(el => el.classList.remove('selected'));
        element.classList.add('selected');
        selectedPlan = plan;
        // Animation : effet d'échelle
        element.style.transition = 'transform 0.2s';
        element.style.transform = 'scale(1.02)';
        setTimeout(() => element.style.transform = '', 200);
    };

    // ---------- Affichage des besoins sélectionnés (étape 3) ----------
    function updateValueBlocks() {
        const container = document.getElementById('value-blocks');
        if (selectedBesoins.length === 0) {
            container.innerHTML = '';
            return;
        }
        const labels = {
            stock: '📦 Gestion de stock',
            facturation: '🧾 Facturation',
            paiements: '💳 Paiements',
            credits: '🤝 Crédits clients',
            recouvrement: '📣 Recouvrement',
            clients: '👥 Gestion clients'
        };
        container.innerHTML = `
            <div style="display:flex; flex-wrap:wrap; gap:6px; margin:6px 0 12px;">
                ${selectedBesoins.map(b => `<span class="badge" style="background:var(--accent-dim);color:var(--accent-hi);padding:4px 12px;border-radius:20px;font-size:0.8rem;font-weight:600;">${labels[b] || b}</span>`).join('')}
            </div>
        `;
        // Animation d'apparition
        container.style.transition = 'opacity 0.2s';
        container.style.opacity = '0';
        requestAnimationFrame(() => {
            container.style.opacity = '1';
        });
    }

    // ---------- Gestion du message ----------
    function showMessage(text, type = 'info') {
        if (!msgEl) return;
        msgEl.textContent = text;
        msgEl.style.color = type === 'error' ? 'var(--danger)' : 'var(--info)';
        msgEl.style.transition = 'opacity 0.2s';
        msgEl.style.opacity = '0';
        requestAnimationFrame(() => msgEl.style.opacity = '1');
    }

    function clearMessage() {
        if (msgEl) msgEl.textContent = '';
    }

    // ---------- Démarrer l'essai gratuit ----------
    window.startTrial = async function() {
        clearMessage();
        if (!selectedCommerce) {
            showMessage('Veuillez sélectionner votre type de commerce.', 'error');
            return;
        }
        if (!selectedPlan) {
            showMessage('Veuillez choisir un plan mensuel.', 'error');
            return;
        }

        const btn = document.getElementById('finish-btn');
        const originalText = btn.textContent;
        btn.disabled = true;
        btn.textContent = '⏳ Activation...';

        try {
            // Vérification de la session
            const { data: { session } } = await supabaseClient.auth.getSession();
            if (!session) {
                window.location.href = 'login.html';
                return;
            }

            // Mise à jour du profil utilisateur
            const { error: profileError } = await supabaseClient
                .from('profiles')
                .update({
                    type_commerce: selectedCommerce,
                    besoins: selectedBesoins,
                    plan_choisi: selectedPlan,
                    onboarding_complete: true,
                    updated_at: new Date().toISOString()
                })
                .eq('id', session.user.id);

            if (profileError) throw profileError;

            // Créer un paiement en attente pour l'abonnement
            const { error: paymentError } = await supabaseClient
                .from('subscription_payments')
                .insert({
                    entreprise_id: session.user.entreprise_id, // à vérifier
                    status: 'pending',
                    amount: selectedPlan === 'recouvrement' ? 15000 : 10000,
                    payment_type: 'subscription',
                    submitted_by: session.user.id,
                });
            // Si erreur, on log mais on ne bloque pas (peut-être pas de table)
            if (paymentError) console.warn('Erreur paiement (non bloquante) :', paymentError);

            // Animation de succès
            btn.textContent = '✅ C\'est parti !';
            btn.style.background = 'var(--success)';
            btn.style.color = '#fff';

            // Redirection vers la page d'accueil après 1.5s
            setTimeout(() => {
                window.location.href = 'index.html';
            }, 1500);

        } catch (error) {
            console.error('Erreur startTrial :', error);
            showMessage('Erreur : ' + (error.message || 'Veuillez réessayer.'), 'error');
            btn.disabled = false;
            btn.textContent = originalText;
        }
    };

    // ---------- Initialisation : première étape ----------
    // S'assurer que seule l'étape 1 est visible au départ
    steps.forEach((s, idx) => {
        if (idx === 0) {
            s.hidden = false;
            s.style.opacity = '1';
            s.style.transform = 'translateX(0)';
        } else {
            s.hidden = true;
        }
    });
    // Progression
    progressDots.forEach((dot, idx) => {
        dot.className = idx === 0 ? 'active' : '';
    });

    // Écouter les événements de changement d'étape (pour désactiver le bouton "Continuer" si besoin)
    // Le bouton "Continuer" de l'étape 2 est désactivé tant qu'un choix n'est pas fait
    // déjà géré plus haut
}