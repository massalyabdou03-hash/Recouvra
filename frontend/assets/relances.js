const CANAL_LABELS = { WHATSAPP: "WhatsApp", EMAIL: "Email", TELEPHONE: "Téléphone", MANUEL: "Manuel" };
const CANAL_ICONS = { WHATSAPP: "💬", EMAIL: "✉️", TELEPHONE: "📞", MANUEL: "📝" };

async function loadRelances() {
  const el = document.getElementById("relances-content");
  const { data, error } = await supabaseClient
    .from("relances")
    .select("*,factures(numero_facture),clients(nom,telephone)")
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) { el.innerHTML = `<div class="error-msg">${esc(error.message)}</div>`; return; }
  if (!data || data.length === 0) { el.innerHTML = `<div class="empty-state">Aucune relance envoyée pour le moment.</div>`; return; }

  el.innerHTML = `
    <div class="table-wrapper">
    <table>
      <thead><tr><th>Date</th><th>Client</th><th>Facture</th><th>Canal</th><th>Message</th><th></th></tr></thead>
      <tbody>
        ${data.map(r => `
          <tr>
            <td class="hint">${fmtDateTime(r.created_at)}</td>
            <td>${esc(r.clients?.nom || "Client")}</td>
            <td class="ref">${esc(r.factures?.numero_facture || `Facture #${r.facture_id}`)}</td>
            <td><span class="badge badge-info">${CANAL_ICONS[r.canal] || ""} ${esc(CANAL_LABELS[r.canal] || r.canal)}</span></td>
            <td class="hint" style="max-width:320px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${esc(r.message || "")}">${esc(r.message || "—")}</td>
            <td class="actions-cell"><a class="button secondary btn-sm" href="paiements.html?facture=${r.facture_id}" style="white-space:nowrap;">Voir</a></td>
          </tr>`).join("")}
      </tbody>
    </table>
    </div>`;
}

document.addEventListener("DOMContentLoaded", async () => {
  const profile = await requireRecouvra();
  if (!profile) return;
  await loadRelances();
});
