// ============================================================================
// RECOUVRA - Module de recouvrement des créances
// ============================================================================

document.addEventListener('DOMContentLoaded', async () => {
    await requireAuth();
    await requireRecouvra();
    await loadDebts();
});

async function requireRecouvra() {
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (!session) {
        window.location.href = 'login.html';
        return false;
    }

    const { data: profile, error } = await supabaseClient
        .from('profiles')
        .select('has_recouvra')
        .eq('id', session.user.id)
        .single();

    if (error || !profile?.has_recouvra) {
        window.location.href = 'abonnement.html';
        return false;
    }
    return true;
}

async function loadDebts() {
    const el = document.getElementById('debts-content');
    el.innerHTML = '<div class="empty-state">Chargement des créances...</div>';
    
    try {
        // Vérifier les promesses en retard
        await supabaseClient.rpc('verifier_promesses');
        
        // Charger les factures impayées
        const { data, error } = await supabaseClient
            .from('factures')
            .select(`
                *,
                clients(nom, telephone, email),
                paiements(montant, methode, date_paiement, reference),
                promesses_paiement(montant_promis, date_promise, statut)
            `)
            .eq('statut', 'VALIDEE')
            .gt('montant_restant', 0)
            .order('date_echeance', { ascending: true });
            
        if (error) throw error;
        
        if (!data || data.length === 0) {
            el.innerHTML = `
                <div class="empty-state">
                    ✅ Aucune créance en cours — tous vos clients sont à jour !
                </div>`;
            return;
        }
        
        // Calculer les totaux
        const totalDu = data.reduce((s, f) => s + Number(f.montant_restant), 0);
        const enRetard = data.filter(f => f.date_echeance && new Date(f.date_echeance) < new Date());
        const totalRetard = enRetard.reduce((s, f) => s + Number(f.montant_restant), 0);
        
        el.innerHTML = `
            <div class="grid-stats" style="margin-bottom:20px;">
                <div class="stat-card danger">
                    <div class="stat-body">
                        <div class="label">Total dû</div>
                        <div class="value">${fmtMoney(totalDu)}</div>
                    </div>
                </div>
                <div class="stat-card warn">
                    <div class="stat-body">
                        <div class="label">En retard</div>
                        <div class="value">${enRetard.length} facture(s)</div>
                    </div>
                </div>
            </div>
            
            <div class="table-wrapper">
                <table>
                    <thead>
                        <tr>
                            <th>Client</th>
                            <th>N° Facture</th>
                            <th>Montant</th>
                            <th>Payé</th>
                            <th>Reste</th>
                            <th>Échéance</th>
                            <th>Statut</th>
                            <th>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${data.map(f => {
                            const today = new Date();
                            const echDate = f.date_echeance ? new Date(f.date_echeance) : null;
                            let statut = 'À venir';
                            let statutClass = 'badge-info';
                            
                            if (echDate && echDate < today) {
                                statut = 'En retard';
                                statutClass = 'badge-danger';
                            } else if (f.montant_paye > 0) {
                                statut = 'Partiel';
                                statutClass = 'badge-warn';
                            }
                            
                            return `
                                <tr>
                                    <td>
                                        <strong>${esc(f.clients?.nom || '—')}</strong>
                                        <div class="hint">${esc(f.clients?.telephone || '')}</div>
                                    </td>
                                    <td class="ref">${esc(f.numero_facture || '—')}</td>
                                    <td class="num">${fmtMoney(f.montant_total)}</td>
                                    <td class="num">${fmtMoney(f.montant_paye)}</td>
                                    <td class="num"><strong>${fmtMoney(f.montant_restant)}</strong></td>
                                    <td class="hint">${fmtDate(f.date_echeance)}</td>
                                    <td><span class="badge ${statutClass}">${statut}</span></td>
                                    <td class="actions-cell">
                                        <button class="btn btn-sm" onclick="window.location.href='recouvra-detail.html?id=${f.id}'">
                                            Gérer
                                        </button>
                                        <button class="btn btn-sm btn-secondary" onclick="relancerWhatsApp(${f.id})">
                                            💬 WhatsApp
                                        </button>
                                    </td>
                                </tr>
                            `;
                        }).join('')}
                    </tbody>
                </table>
            </div>
        `;
        
    } catch (error) {
        console.error('Erreur chargement créances:', error);
        el.innerHTML = `<div class="error-msg">${friendlyError(error)}</div>`;
    }
}

async function relancerWhatsApp(factureId) {
    try {
        const { data: facture } = await supabaseClient
            .from('factures')
            .select('*, clients(nom, telephone)')
            .eq('id', factureId)
            .single();
            
        if (!facture?.clients?.telephone) {
            showToast('Ce client n\'a pas de numéro de téléphone enregistré.', 'error');
            return;
        }
        
        // Enregistrer la relance
        await supabaseClient
            .from('relances')
            .insert({
                facture_id: factureId,
                client_id: facture.client_id,
                canal: 'WHATSAPP',
                message: generateRelanceMessage(facture),
            });
        
        // Construire le message WhatsApp
        const message = generateRelanceMessage(facture);
        const phone = facture.clients.telephone.replace(/\D/g, '');
        const url = `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
        
        window.open(url, '_blank');
        showToast('Relance WhatsApp préparée.', 'success');
        
    } catch (error) {
        showToast(friendlyError(error), 'error');
    }
}

function generateRelanceMessage(facture) {
    const settings = JSON.parse(localStorage.getItem('sylla_company_settings') || '{}');
    const companyName = settings.nom_commercial || 'Notre entreprise';
    
    const montant = fmtMoney(facture.montant_restant);
    const numero = facture.numero_facture || `#${facture.id}`;
    
    return `Bonjour ${facture.clients?.nom || ''}, 
    
Nous vous rappelons que la facture ${numero} d'un montant de ${montant} est arrivée à échéance.

Merci de bien vouloir procéder au règlement dès que possible.

Cordialement,
${companyName}`;
}