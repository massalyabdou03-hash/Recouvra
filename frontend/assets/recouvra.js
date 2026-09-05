// ============================================================================
// RECOUVRA - Module de relance des créances (regroupées par client)
// ============================================================================
// NOTE DE CORRECTION (V2) : ce fichier ciblait auparavant un id inexistant
// dans recouvra.html (qui utilise #relance-list, #stat-total, #stat-retard
// et #stat-clients). C'était la cause racine du blocage sur "Chargement...".
// requireRecouvra() était aussi redéfinie localement ici de façon divergente
// par rapport à la version globale de app.js (elle ignorait le rôle
// super_admin) : on réutilise désormais uniquement la version de app.js.

document.addEventListener('DOMContentLoaded', async () => {
    const session = await requireAuth();
    if (!session) return;

    const profile = await requireRecouvra();
    if (!profile) return;

    await loadDebts();
});

async function loadDebts() {
    const el = document.getElementById('relance-list');
    if (!el) return;

    el.innerHTML = '<div class="empty-state"><span class="spinner-small"></span> Chargement...</div>';

    try {
        // Vérifier les promesses en retard (met à jour leur statut côté serveur)
        await supabaseClient.rpc('verifier_promesses');

        // Charger les factures impayées, groupées ensuite par client
        const { data, error } = await supabaseClient
            .from('factures')
            .select(`
                id,
                numero_facture,
                montant_total,
                montant_paye,
                montant_restant,
                date_echeance,
                client_id,
                clients(nom, telephone, email)
            `)
            .eq('statut', 'VALIDEE')
            .gt('montant_restant', 0)
            .order('date_echeance', { ascending: true });

        if (error) throw error;

        renderStats(data || []);

        if (!data || data.length === 0) {
            el.innerHTML = `
                <div class="empty-state">
                    ✅ Aucune créance en cours — tous vos clients sont à jour !
                </div>`;
            return;
        }

        const groups = groupByClient(data);
        el.innerHTML = groups.map(renderClientCard).join('');

    } catch (error) {
        console.error('Erreur chargement créances:', error);
        el.innerHTML = `<div class="error-msg">${friendlyError(error)}</div>`;
        showToast(friendlyError(error), 'error');
    }
}

// ---------- Statistiques (en-tête de page) ----------
function renderStats(factures) {
    const today = new Date();
    const totalDu = factures.reduce((s, f) => s + Number(f.montant_restant || 0), 0);
    const enRetard = factures.filter(f => f.date_echeance && new Date(f.date_echeance) < today);
    const totalRetard = enRetard.reduce((s, f) => s + Number(f.montant_restant || 0), 0);
    const clientsUniques = new Set(factures.map(f => f.client_id)).size;

    const elTotal = document.getElementById('stat-total');
    const elRetard = document.getElementById('stat-retard');
    const elClients = document.getElementById('stat-clients');

    if (elTotal) elTotal.textContent = fmtMoney(totalDu);
    if (elRetard) elRetard.textContent = fmtMoney(totalRetard);
    if (elClients) elClients.textContent = String(clientsUniques);
}

// ---------- Regroupement des factures par client ----------
function groupByClient(factures) {
    const byClient = new Map();
    for (const f of factures) {
        const key = f.client_id;
        if (!byClient.has(key)) {
            byClient.set(key, {
                client_id: key,
                nom: f.clients?.nom || 'Client',
                telephone: f.clients?.telephone || '',
                total: 0,
                factures: [],
            });
        }
        const group = byClient.get(key);
        group.total += Number(f.montant_restant || 0);
        group.factures.push(f);
    }
    // Les clients avec le plus grand solde dû en premier
    return Array.from(byClient.values()).sort((a, b) => b.total - a.total);
}

function renderClientCard(group) {
    return `
        <div class="relance-client-card">
            <div class="relance-client-header">
                <div class="relance-client-info">
                    <div class="relance-client-name">${esc(group.nom)}</div>
                    <div class="relance-client-phone">${esc(group.telephone || 'Pas de téléphone enregistré')}</div>
                </div>
                <div class="relance-client-total">
                    <span class="relance-total-label">Total dû</span>
                    <span class="relance-total-amount">${fmtMoney(group.total)}</span>
                </div>
            </div>
            <div class="relance-invoices">
                ${group.factures.map(f => `
                    <div class="relance-invoice-row">
                        <div class="relance-invoice-info">
                            <a class="relance-invoice-num" href="recouvra-detail.html?id=${f.id}">${esc(f.numero_facture || `Facture #${f.id}`)}</a>
                            <span class="relance-invoice-date">${f.date_echeance ? 'Échéance : ' + fmtDate(f.date_echeance) : 'Sans échéance'}</span>
                        </div>
                        <div class="relance-invoice-amount">
                            <span class="relance-invoice-montant">${fmtMoney(f.montant_restant)}</span>
                        </div>
                    </div>
                `).join('')}
            </div>
            <div class="relance-actions">
                <button type="button" class="btn-whatsapp" ${group.telephone ? '' : 'disabled title="Pas de numéro de téléphone"'} onclick="relancerClientWhatsApp(${group.client_id})">
                    💬 Relancer sur WhatsApp
                </button>
            </div>
        </div>
    `;
}

// ---------- Relance WhatsApp (toutes les factures impayées d'un client) ----------
async function relancerClientWhatsApp(clientId) {
    try {
        const { data: client, error: errClient } = await supabaseClient
            .from('clients')
            .select('nom, telephone')
            .eq('id', clientId)
            .single();
        if (errClient) throw errClient;

        if (!client?.telephone) {
            showToast("Ce client n'a pas de numéro de téléphone enregistré.", 'error');
            return;
        }

        const { data: factures, error: errFactures } = await supabaseClient
            .from('factures')
            .select('id, numero_facture, montant_restant, date_echeance')
            .eq('client_id', clientId)
            .eq('statut', 'VALIDEE')
            .gt('montant_restant', 0)
            .order('date_echeance', { ascending: true });
        if (errFactures) throw errFactures;

        if (!factures || factures.length === 0) {
            showToast('Aucune facture impayée pour ce client.', 'info');
            return;
        }

        const totalDu = factures.reduce((s, f) => s + Number(f.montant_restant || 0), 0);
        const message = generateRelanceMessage(client, factures, totalDu);

        // Enregistrer une trace de la relance pour chaque facture concernée
        // (la table "relances" impose un facture_id non nul par ligne).
        const { error: errInsert } = await supabaseClient
            .from('relances')
            .insert(factures.map(f => ({
                facture_id: f.id,
                client_id: clientId,
                canal: 'WHATSAPP',
                message,
            })));
        if (errInsert) throw errInsert;

        const phone = client.telephone.replace(/\D/g, '');
        const url = `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
        window.open(url, '_blank');
        showToast('Relance WhatsApp préparée.', 'success');

    } catch (error) {
        console.error('Erreur relance WhatsApp:', error);
        showToast(friendlyError(error), 'error');
    }
}

function generateRelanceMessage(client, factures, totalDu) {
    const settings = JSON.parse(localStorage.getItem('sylla_company_settings') || '{}');
    const companyName = settings.nom_commercial || 'Notre entreprise';

    const lignes = factures
        .map(f => `- ${f.numero_facture || `Facture #${f.id}`} : ${fmtMoney(f.montant_restant)}`)
        .join('\n');

    return `Bonjour ${client.nom || ''},

Nous vous rappelons que ${factures.length > 1 ? 'les factures suivantes sont' : 'la facture suivante est'} en attente de règlement :
${lignes}

Total dû : ${fmtMoney(totalDu)}

Merci de bien vouloir procéder au règlement dès que possible.

Cordialement,
${companyName}`;
}
