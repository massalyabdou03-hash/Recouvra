// ============================================================================
// RUPTURES DE STOCK - Alertes articles épuisés (utilise app.js)
// ============================================================================

let rupturePieces = [];
let debounceTimer = null;

document.addEventListener('DOMContentLoaded', async () => {
    const session = await requireAuth();
    if (!session) return;

    await loadRuptures();
});

// Debounce pour la recherche
function debouncedFilter() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
        const q = document.getElementById('search').value.trim().toLowerCase();
        renderTable(q);
    }, 300);
}

// ---------- Chargement des ruptures ----------
async function loadRuptures() {
    const { items, offline, savedAt } = await loadWithCache('pieces', () =>
        fetchAllRows(() => supabaseClient.from('pieces').select('*').eq('actif', true).order('designation'))
    );
    rupturePieces = items.filter(p => p.quantite_stock === 0);
    renderTable('');
    if (offline && savedAt) showToast(`Hors ligne : données du ${fmtDateTime(savedAt)}.`, 'info');
}

// ---------- Affichage du tableau ----------
function renderTable(search = '') {
    const el = document.getElementById('table-content');
    document.getElementById('export-btn').disabled = rupturePieces.length === 0;

    if (rupturePieces.length === 0) {
        el.innerHTML = '<div class="empty-state">Aucune pièce en rupture — tout le stock a au moins une unité disponible.</div>';
        return;
    }

    let filtered = rupturePieces;
    if (search) {
        filtered = filtered.filter(p =>
            (p.reference_oem || '').toLowerCase().includes(search) ||
            (p.reference_interne || '').toLowerCase().includes(search) ||
            (p.designation || '').toLowerCase().includes(search) ||
            (p.marque || '').toLowerCase().includes(search) ||
            (p.emplacement || '').toLowerCase().includes(search)
        );
    }

    if (filtered.length === 0) {
        el.innerHTML = '<div class="empty-state">Aucun résultat pour cette recherche.</div>';
        return;
    }

    el.innerHTML = `
        <p class="hint" style="margin-top:0;">${filtered.length} pièce(s) en rupture de stock.</p>
        <div class="table-wrapper">
            <table>
                <thead><tr><th>Référence</th><th>Désignation</th><th>Marque</th><th>Catégorie</th><th>Emplacement</th><th class="num">Prix achat</th><th class="num">Seuil d'alerte</th></tr></thead>
                <tbody>
                    ${filtered.map(p => `<tr>
                        <td><div class="ref">${esc(p.reference_oem)}</div><div class="hint">${esc(p.reference_interne)}</div></td>
                        <td>${esc(p.designation)}</td>
                        <td>${esc(p.marque || '—')}</td>
                        <td>${esc(p.categorie || '—')}</td>
                        <td>${esc(p.emplacement || '—')}</td>
                        <td class="num">${fmtMoney(p.prix_achat)}</td>
                        <td class="num">${p.seuil_alerte}</td>
                    </tr>`).join('')}
                </tbody>
            </table>
        </div>
    `;
}

// ---------- Export Excel ----------
function exportExcel() {
    if (rupturePieces.length === 0) return;
    const rows = rupturePieces.map(p => ({
        "Référence OEM": p.reference_oem,
        "Référence interne": p.reference_interne,
        "Désignation": p.designation,
        "Marque": p.marque || "",
        "Catégorie": p.categorie || "",
        "Emplacement": p.emplacement || "",
        "Prix d'achat": Number(p.prix_achat || 0),
        "Prix de vente": Number(p.prix_vente || 0),
        "Seuil d'alerte": p.seuil_alerte,
        "Quantité à commander": p.seuil_alerte > 0 ? p.seuil_alerte : 1,
    }));
    const sheet = XLSX.utils.json_to_sheet(rows);
    sheet["!cols"] = [{ wch: 18 }, { wch: 18 }, { wch: 32 }, { wch: 16 }, { wch: 16 }, { wch: 14 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 18 }];
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, "Ruptures de stock");
    const today = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(workbook, `ruptures_stock_${today}.xlsx`);
}