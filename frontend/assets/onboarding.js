// ============================================================
// ONBOARDING - Logique améliorée
// ============================================================

document.addEventListener('DOMContentLoaded', async () => {
    // Vérifier si l'utilisateur a déjà complété l'onboarding.
    // Correction (audit V2) : `profiles.onboarding_complete` n'existe pas
    // dans le schéma — le vrai champ est `entreprises.onboarding_completed_at`.
    // Voir supabase/PROPOSED_fix_onboarding_rls.sql.
    try {
        const { data: { session } } = await supabaseClient.auth.getSession();
        if (session) {
            const { data: profile } = await supabaseClient
                .from('profiles')
                .select('entreprise_id, entreprises(onboarding_completed_at)')
                .eq('id', session.user.id)
                .single();
            if (profile?.entreprises?.onboarding_completed_at) {
                window.location.href = 'index.html';
                return;
            }
        }
    } catch (e) {
        console.warn('Erreur vérification onboarding:', e);
    }

    initOnboarding();
});

function initOnboarding() {
    const steps = document.querySelectorAll('.onboarding-step');
    const progressDots = document.querySelectorAll('.onboarding-progress i');
    const finishBtn = document.getElementById('finish-btn');
    const msgEl = document.getElementById('onboarding-msg');

    let currentStep = 1;
    let selectedCommerce = null;
    let selectedBesoins = [];
    let selectedPlan = null;

    window.goToStep = function(step) {
        if (step < 1 || step > steps.length) return;
        if (step === 3 && !selectedCommerce) {
            showMessage('Veuillez sélectionner votre type de commerce.', 'warning');
            return;
        }
        const currentEl = document.querySelector(`.onboarding-step[data-step="${currentStep}"]`);
        if (currentEl) {
            currentEl.style.transition = 'opacity 0.25s ease, transform 0.3s ease';
            currentEl.style.opacity = '0';
            currentEl.style.transform = 'translateX(-20px)';
        }

        progressDots.forEach((dot, idx) => {
            dot.className = '';
            if (idx + 1 === step) dot.classList.add('active');
            else if (idx + 1 < step) dot.classList.add('done');
        });

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

    document.querySelectorAll('#commerce-choices .onboarding-choice').forEach(btn => {
        btn.addEventListener('click', function() {
            document.querySelectorAll('#commerce-choices .onboarding-choice').forEach(b => b.classList.remove('selected'));
            this.classList.add('selected');
            selectedCommerce = this.dataset.value;
            document.getElementById('step2-next').disabled = false;
        });
    });

    document.querySelectorAll('#besoins-choices .onboarding-choice').forEach(btn => {
        btn.addEventListener('click', function() {
            this.classList.toggle('selected');
            const val = this.dataset.value;
            if (this.classList.contains('selected')) {
                if (!selectedBesoins.includes(val)) selectedBesoins.push(val);
            } else {
                selectedBesoins = selectedBesoins.filter(v => v !== val);
            }
            updateValueBlocks();
        });
    });

    window.selectPlan = function(plan, element) {
        document.querySelectorAll('.pricing-option').forEach(el => el.classList.remove('selected'));
        element.classList.add('selected');
        selectedPlan = plan;
    };

    function updateValueBlocks() {
        const container = document.getElementById('value-blocks');
        if (!container) return;
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
                ${selectedBesoins.map(b => `<span class="badge besoin-badge">${labels[b] || b}</span>`).join('')}
            </div>
        `;
    }

    function showMessage(text, type = 'info') {
        if (!msgEl) return;
        msgEl.textContent = text;
        msgEl.style.color = type === 'error' ? 'var(--danger)' : 'var(--info)';
    }

    window.startTrial = async function() {
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
            const { data: { session } } = await supabaseClient.auth.getSession();
            if (!session) {
                window.location.href = 'login.html';
                return;
            }

            // Correction (audit V2) : l'ancien code faisait un UPDATE direct
            // sur `profiles` avec des colonnes inexistantes (plan_choisi,
            // onboarding_complete) ou situées sur la mauvaise table
            // (type_commerce/besoins appartiennent à `entreprises`), et de
            // toute façon bloqué par la policy RLS (seul super_admin peut
            // modifier `profiles`). Tout est désormais fait côté serveur par
            // une fonction dédiée qui ne touche que les champs autorisés
            // pour l'entreprise de l'utilisateur courant.
            // -> Nécessite l'application de supabase/PROPOSED_fix_onboarding_rls.sql
            const { error } = await supabaseClient.rpc('complete_onboarding', {
                p_type_commerce: selectedCommerce,
                p_besoins: selectedBesoins,
                p_plan_choisi: selectedPlan,
            });
            if (error) throw error;

            btn.textContent = '✅ C\'est parti !';
            btn.style.background = 'var(--success)';
            btn.style.color = '#fff';

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

    steps.forEach((s, idx) => {
        if (idx === 0) {
            s.hidden = false;
            s.style.opacity = '1';
            s.style.transform = 'translateX(0)';
        } else {
            s.hidden = true;
        }
    });
    progressDots.forEach((dot, idx) => {
        dot.className = idx === 0 ? 'active' : '';
    });
}