// Minimal UI helpers: toasts and confirm dialog.
// Only define if not already present in the global scope to avoid conflicts with existing app.js.
(function(){
  if (typeof window === 'undefined') return;
  // Toasts
  if (!window.__recouvra_toasts_initialized){
    window.__recouvra_toasts_initialized = true;
    const container = document.createElement('div');
    container.className = 'toasts-container';
    document.body.appendChild(container);

    window.showToast = window.showToast || function(message, type='info', ttl=3500){
      const t = document.createElement('div');
      t.className = 'toast ' + (type||'info');
      t.innerHTML = `<div class="msg">${String(message)}</div>`;
      container.appendChild(t);
      setTimeout(()=>{ t.style.opacity='0'; t.style.transform='translateY(-6px)'; }, ttl-300);
      setTimeout(()=>{ try{ container.removeChild(t);}catch(e){} }, ttl);
    };

    // Confirm dialog (promise-based)
    window.confirmDialog = window.confirmDialog || function(message, opts={}){
      return new Promise((resolve)=>{
        // basic implementation using window.confirm if no modal system is present
        if (!document.querySelector('.modal-backdrop')){
          const ok = window.confirm(message);
          resolve(ok);
          return;
        }
        // else create a modal
        const backdrop = document.createElement('div'); backdrop.className='modal-backdrop open';
        const box = document.createElement('div'); box.className='modal-box';
        const head = document.createElement('div'); head.className='modal-head';
        const h = document.createElement('h3'); h.textContent = opts.title || 'Confirmer'; head.appendChild(h);
        const closeBtn = document.createElement('button'); closeBtn.className='modal-close'; closeBtn.textContent='×'; head.appendChild(closeBtn);
        box.appendChild(head);
        const p = document.createElement('p'); p.textContent = message; box.appendChild(p);
        const actions = document.createElement('div'); actions.style.display='flex'; actions.style.justifyContent='flex-end'; actions.style.gap='8px'; actions.style.marginTop='12px';
        const cancel = document.createElement('button'); cancel.className='btn btn-secondary'; cancel.textContent = opts.cancelLabel || 'Annuler';
        const confirm = document.createElement('button'); confirm.className='btn btn-danger'; confirm.textContent = opts.confirmLabel || 'Confirmer';
        actions.appendChild(cancel); actions.appendChild(confirm); box.appendChild(actions);
        backdrop.appendChild(box); document.body.appendChild(backdrop);
        closeBtn.onclick = cancel.onclick = ()=>{ document.body.removeChild(backdrop); resolve(false); };
        confirm.onclick = ()=>{ document.body.removeChild(backdrop); resolve(true); };
      });
    };
  }
})();
