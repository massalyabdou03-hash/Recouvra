// ============================================================================
// GUIDE INTERACTIF — moteur générique de visite guidée, sans dépendance
// externe. Utilisé pour l'instant par le guide de vente (factures.html),
// mais réutilisable tel quel pour guider n'importe quelle autre page : il
// suffit de lui donner une liste d'étapes.
//
// Une étape peut :
// - pointer sur un élément réel de la page via `selector` (l'élément est
//   mis en évidence par une "découpe" dans le voile sombre, avec une
//   infobulle à côté) ;
// - ou, si `selector` est absent, s'afficher comme une carte centrée sans
//   rien découper (utile pour une étape de bienvenue ou de conclusion, ou
//   quand l'élément concerné n'est pas visible à cet instant — ex: le
//   récapitulatif de vente qui n'apparaît qu'une fois un article ajouté).
//
// Usage :
//   startGuidedTour([
//     { title: "Bienvenue", text: "..." },
//     { selector: "#mon-bouton", title: "...", text: "..." },
//   ], { onFinish: (reason) => { ... } }); // reason: "completed" | "skipped"
// ============================================================================
function startGuidedTour(steps, options = {}) {
  if (!steps || steps.length === 0) return;

  let index = 0;
  let overlay, spotlight, tooltip;
  let finished = false;

  function onKeydown(e) {
    if (e.key === "Escape") finish("skipped");
  }
  function onReflow() {
    positionCurrentStep();
  }

  function finish(reason) {
    if (finished) return;
    finished = true;
    document.removeEventListener("keydown", onKeydown);
    window.removeEventListener("resize", onReflow);
    window.removeEventListener("scroll", onReflow, true);
    overlay?.remove();
    if (typeof options.onFinish === "function") options.onFinish(reason);
  }

  function build() {
    overlay = document.createElement("div");
    overlay.className = "tour-overlay";
    spotlight = document.createElement("div");
    spotlight.className = "tour-spotlight";
    tooltip = document.createElement("div");
    tooltip.className = "tour-tooltip";
    tooltip.style.visibility = "hidden";
    overlay.appendChild(spotlight);
    overlay.appendChild(tooltip);
    document.body.appendChild(overlay);
    document.addEventListener("keydown", onKeydown);
    window.addEventListener("resize", onReflow);
    window.addEventListener("scroll", onReflow, true);
  }

  function currentTarget() {
    const step = steps[index];
    return step.selector ? document.querySelector(step.selector) : null;
  }

  function positionCurrentStep() {
    const target = currentTarget();
    if (!target) {
      spotlight.style.display = "none";
      tooltip.classList.add("tour-tooltip-center");
      tooltip.style.visibility = "visible";
      return;
    }
    spotlight.style.display = "block";
    tooltip.classList.remove("tour-tooltip-center");

    const rect = target.getBoundingClientRect();
    const pad = 8;
    spotlight.style.top = `${rect.top - pad}px`;
    spotlight.style.left = `${rect.left - pad}px`;
    spotlight.style.width = `${rect.width + pad * 2}px`;
    spotlight.style.height = `${rect.height + pad * 2}px`;

    const tRect = tooltip.getBoundingClientRect();
    let top = rect.bottom + 16;
    if (top + tRect.height > window.innerHeight - 12) top = rect.top - tRect.height - 16;
    if (top < 12) top = 12;
    let left = rect.left;
    if (left + tRect.width > window.innerWidth - 12) left = window.innerWidth - tRect.width - 12;
    if (left < 12) left = 12;
    tooltip.style.top = `${top}px`;
    tooltip.style.left = `${left}px`;
    tooltip.style.visibility = "visible";
  }

  function renderStep() {
    const step = steps[index];
    tooltip.style.visibility = "hidden";
    tooltip.innerHTML = `
      <div class="tour-tooltip-title">${step.title}</div>
      <div class="tour-tooltip-text">${step.text}</div>
      <div class="tour-dots">${steps
        .map((_, i) => `<span class="tour-dot ${i === index ? "active" : ""}"></span>`)
        .join("")}</div>
      <div class="tour-tooltip-actions">
        <button type="button" class="tour-skip">Passer</button>
        <button type="button" class="btn btn-sm tour-next">${index === steps.length - 1 ? "Terminer" : "Suivant"}</button>
      </div>
    `;
    tooltip.querySelector(".tour-skip").onclick = () => finish("skipped");
    tooltip.querySelector(".tour-next").onclick = () => {
      if (index === steps.length - 1) { finish("completed"); return; }
      index += 1;
      renderStep();
    };

    const target = currentTarget();
    if (target) {
      target.scrollIntoView({ block: "center", behavior: "smooth" });
      requestAnimationFrame(() => requestAnimationFrame(positionCurrentStep));
    } else {
      positionCurrentStep();
    }
  }

  build();
  renderStep();
}
window.startGuidedTour = startGuidedTour;
