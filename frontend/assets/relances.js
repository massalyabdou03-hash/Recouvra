// ============================================================================
// RELANCES - Historique des relances envoyées
// ============================================================================

document.addEventListener('DOMContentLoaded', async () => {
    const session = await requireAuth();
    if (!session) return;

    const hasRecouvra = await requireRecouvra();
    if (!hasRecouvra) return;

    await loadRelances();
});

async function requireAuth() {
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (!session) {
        window.location.href = 'login.html';
        return null;
    }
    return session;
}

async function requireRecouvra() {
    const session = await requireAuth();
    if (!session) return false;

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

async function loadRelances() {
    const el = document.getElementById('relances-content');
    if (!el) return;

    el.innerHTML = '<div class="empty-state">Chargement...</div>';

    try {
        const { data, error } = await supabaseClient
            .from('relances')
            .select('*, clients(nom, telephone), factures(numero_facture)')
            .order('created_at', { ascending: false })
            .limit(100);

        if (error) throw error;

        if (!data || data.length === 0) {
            el.innerHTML = '<div class="empty-state">Aucune relance envoyée.</div>';
            return;
        }

        const canalBadge = {
            'WHATSAPP': '<span class="badge badge-success">💬 WhatsApp</span>',
            'EMAIL': '<span class="badge badge-info">📧 Email</span>',
            'TELEPHONE': '<span class="badge badge-warn">📞 Téléphone</span>',
            'MANUEL': '<span class="badge badge-muted">✍️ Manuel</span>',
        };

        el.innerHTML = `
            <div class="table-wrapper">
                <table>
                    <thead>
                        <tr>
                            <th>Date</th>
                            <th>Client</th>
                            <th>Facture</th>
                            <th>Canal</th>
                            <th>Message</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${data.map(r => `
                            <tr>
                                <td class="hint">${fmtDateTime(r.created_at)}</td>
                                <td>
                                    <strong>${esc(r.clients?.nom || '—')}</strong>
                                    <div class="hint">${esc(r.clients?.telephone || '')}</div>
                                </td>
                                <td class="ref">${esc(r.factures?.numero_facture || '—')}</td>
                                <td>${canalBadge[r.canal] || r.canal}</td>
                                <td class="hint" style="max-width:400px; word-break:break-word;">
                                    ${esc(r.message || '—')}
                                </td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        `;

    } catch (error) {
        console.error('Erreur chargement relances:', error);
        el.innerHTML = `<div class="error-msg">${friendlyError(error)}</div>`;
    }
}