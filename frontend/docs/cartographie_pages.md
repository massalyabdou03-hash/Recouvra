# Cartographie des pages — Recouvra

Ce document présente une cartographie page par page (priorité) pour guider la refonte Mobile‑First sans modifier la logique métier.

Pour chaque page : objectif / utilisateur / fichier HTML / CSS / JS / fonctions appelées / tables Supabase utilisées / RPC utilisées / dépendances app.js / offline possible / risques de régression.

---

## 1) login.html
- Objectif : écran de connexion / onboarding initial.
- Utilisateur : tous (utilisateurs non authentifiés).
- Fichier HTML : `frontend/login.html`.
- CSS : `frontend/assets/style.css` + styles inline présents dans login.html.
- JS : `frontend/assets/config.js`, `frontend/assets/app.js` (requireAuth, auth flows), parfois page-specific onboarding JS.
- Fonctions appelées : supabase.auth.signInWithPassword, requireAuth (app.js), applyCompanySettings.
- Tables/RPC : `profiles` (via auth/users), `entreprise_settings` pour branding.
- RPC : aucune RPC métier critique directement depuis login.
- Dépendance app.js : initialisation supabaseClient, création de navigation globale, gestion SW registration.
- Offline : UI statique disponible via SW; authentification requiert réseau.
- Risques : mauvaise gestion du retour d'erreur sur la clé supabase mal configurée ; veiller à ne pas casser le flux de redirection après login.

---

## 2) index.html (Dashboard)
- Objectif : tableau de bord synthétique (CA jour/semaine/mois, créances, alertes stock, graphique ventes 30 jours).
- Utilisateur : vendeurs / admins.
- Fichier HTML : `frontend/index.html`.
- CSS : `frontend/assets/style.css` + styles inline pour spinner.
- JS : `frontend/assets/app.js` + code inline (loadDashboardData, loadSalesChart). Utilise Chart.js via CDN.
- Fonctions appelées : loadWithCache, fetchAllRows, fmtMoney, showToast, requireAuth.
- Tables/RPC : `pieces`, `factures` (select validated), `factures` montant_restant pour créances.
- RPC : pas d'appels RPC spécifiques, mais dépend des champs calculés via RPC (ex: refresh_facture_payment_state) côté DB si utilisés.
- Dépendance app.js : branding, navigation, cache, utilities.
- Offline : cache page + assets ; données peuvent rester en cache via loadWithCache.
- Risques : gros volume de données (factures) → pagination ou limites ; graphique dépend de Chart.js chargé via CDN.

---

## 3) factures.html (Vente)
- Objectif : effectuer une vente (sélection client, recherche produit, panier, paiement, création facture, validation et déclenchement RPC valider_facture).
- Utilisateur : vendeur.
- Fichier HTML : `frontend/factures.html`.
- CSS : `frontend/assets/style.css` + éventuels styles inline.
- JS : code inline (utilise app.js utilities: loadWithCache, fetchAllRows, fmtMoney, esc, showToast, queue for offline).
- Fonctions appelées : supabaseClient.from('factures').insert, supabaseClient.from('factures_lignes').insert, supabaseClient.rpc('valider_facture', ...), create pending queue if offline, syncPendingSales in app.js.
- Tables/RPC : `factures`, `factures_lignes`, `clients`, `pieces`; RPC `valider_facture` pour validation et déstockage.
- Dépendance app.js : gestion session, queuing offline, helpers (fmtMoney, esc, loadWithCache), navigation global-nav.
- Offline : conçu pour fonctionner hors‑ligne via stockage local `recouvra_pending_sales` et synchronisation au retour en ligne.
- Risques : doublons si lock insuffisant (app.js contains saleInProgress lock fixes), vérifier atomicité : création facture, insertion lignes, RPC valider_facture.

---

## 4) facture-detail.html
- Objectif : afficher détail d'une facture, imprimer/générer/partager PDF, valider/annuler (selon statut).
- Utilisateur : vendeur / admin.
- Fichier HTML : `frontend/facture-detail.html`.
- CSS : `frontend/assets/style.css`.
- JS : code inline (buildInvoicePdf, telechargerPDF, partagerPDF, validerFacture, annulerFacture, marquerPaye). Utilise jsPDF + autotable via CDN.
- Fonctions appelées : supabaseClient.from('factures').select(...), supabaseClient.from('factures_lignes').select, supabaseClient.rpc('valider_facture'), supabaseClient.rpc('annuler_facture'), supabaseClient.rpc('enregistrer_paiement'). Utilise applyPendingFieldUpdates et queueFieldUpdate (offline).
- Tables/RPC : `factures`, `factures_lignes`, `paiements`; RPCs `valider_facture`, `annuler_facture`, `enregistrer_paiement`.
- Dépendance app.js : cacheCollection/getCachedCollection, applyCompanySettings (logo), utilities (fmtMoney, esc, confirmDialog, showToast), offline queue logic.
- Offline : facture peut être consultée hors‑ligne si cache présente ; validation nécessite connexion (RPC valider_facture).
- Risques : génération PDF dépend de logo fetch (logoDataUrl) — si l'URL de storage nécessite permissions, l'appel peut échouer ; le partage via navigator.share dépend du support navigateur.

---

## 5) stock.html
- Objectif : gérer catalogue (ajout/édition suppression produit), visualiser mouvements et filtres.
- Utilisateur : magasinier / vendeur / admin.
- Fichier HTML : `frontend/stock.html`.
- CSS : `frontend/assets/style.css` + styles inline dans page (grid, product-card, modal styles).
- JS : code inline (loadProducts, renderProducts, saveProduct, deleteProduct, loadMovements). S'appuie sur app.js pour supabaseClient et utilitaires.
- Fonctions appelées : supabaseClient.from('pieces').select/insert/update, supabaseClient.from('mouvements_stock').select, éventuellement rpc `enregistrer_mouvement_stock` via autres actions.
- Tables/RPC : `pieces`, `mouvements_stock`; RPC `enregistrer_mouvement_stock` utilisé par flux de mouvements si existant dans app.js ou pages mouvements.
- Dépendance app.js : loadWithCache, fetchAllRows, fmtMoney, esc, toasts, confirmDialog.
- Offline : listage via cache possible ; opérations d’édition/suppression créent des requêtes réseau ou sont queueées via app.js (vérifier si saveProduct envoie en offline ou requiert connexion). Dans le code actuel, saveProduct apparaît synchrone (insert/update) et nécessite connexion — app.js peut capturer erreur et proposer mise en queue ; vérifier comportement réel.
- Risques : suppression marquée via `actif=false` (soft delete) — vérifier intégration sur pages de ventes pour éviter d’afficher articles inactifs.

---

## 6) rupture-stock.html
- Objectif : lister articles en rupture ou au‑dessus du seuil d'alerte.
- Utilisateur : vendeur/magasinier.
- Fichier HTML : `frontend/rupture-stock.html` (présence confirmée dans sw.js list et repo).
- CSS : `frontend/assets/style.css`.
- JS : probablement code inline ou `assets/rupture-stock.js` (vérifier fichier). Utilise `pieces` view `vue_alertes_stock` ou filter quantite_stock <= seuil_alerte.
- Fonctions appelées : supabaseClient.from('pieces').select(...) with condition quantite_stock <= seuil_alerte ou view `vue_alertes_stock`.
- Tables/RPC : `pieces`, `mouvements_stock` si affichage historique.
- Dépendance app.js : loadWithCache, fmtMoney, esc.
- Offline : lecture via cache possible.
- Risques : queries lourdes si pas limit; vérifier index `idx_pieces_designation_trgm` pour recherche.

---

## 7) clients.html
- Objectif : gestion clients (CRUD), statistiques par client, accès au détail et actions de relance.
- Utilisateur : vendeur/admin.
- Fichier HTML : `frontend/clients.html`.
- CSS : `frontend/assets/style.css` + inline.
- JS : code inline (loadClients, loadClientStats, saveClient, deleteClient, openClientDetail). Utilise app.js utilitaires.
- Fonctions appelées : supabaseClient.from('clients').select/insert/update/delete, supabaseClient.from('factures') pour stats.
- Tables/RPC : `clients`, `factures` (montant_restant), éventuellement `relances` pour relances.
- Dépendance app.js : showToast, confirmDialog, loadWithCache.
- Offline : listage possible via cache; création client nécessite connexion (but can be queued if app.js supports queuing for tables). Code uses direct insert — confirm offline behavior.
- Risques : suppression définitive vs soft delete — current code deletes client (`from('clients').delete()`), risk of data loss; check RLS and referential integrity (factures referencing clients). This is a potential dangerous action — need to ensure it's intended. **Note**: The code deletes client — ensure UI warns (it uses confirmDialog) and RLS/DB constraints may prevent delete if referenced.

---

## 8) credits.html
- Objectif : lister créances / bons (clients qui doivent de l'argent), gérer paiements partiels, promesses.
- Utilisateur : vendeur / service recouvrement.
- Fichier HTML : `frontend/credits.html` (présence probable; referenced in nav).
- CSS : `frontend/assets/style.css`.
- JS : probable inline or `assets/credits.js` (gère requêtes sur factures avec montant_restant > 0, actions pour marquer paiement ou créer promesse).
- Fonctions appelées : supabaseClient.from('factures').select(... montant_restant ...), supabaseClient.rpc('enregistrer_paiement'), insertion promesses_paiement.
- Tables/RPC : `factures`, `paiements`, `promesses_paiement`, `relances`; RPC `enregistrer_paiement`.
- Dépendance app.js : requireRecouvra (vérifier profile.has_recouvra), showToast.
- Offline : lecture en cache possible; enregistrement paiement nécessite connexion.
- Risques : RPC enregistrer_paiement restricted to users who `current_user_has_recouvra()` — ensure UI checks profile.has_recouvra before showing actions (app.js has requireRecouvra helper).

---

## 9) paiements.html
- Objectif : enregistrement et visualisation des paiements (table paiements).
- Utilisateur : admin / recouvra-enabled users.
- Fichier HTML : `frontend/paiements.html`.
- CSS : `frontend/assets/style.css`.
- JS : probable `assets/paiements.js` ou inline ; utilise RPC `enregistrer_paiement` or direct insert into `paiements` followed by refresh_facture_payment_state.
- Fonctions appelées : supabaseClient.rpc('enregistrer_paiement'), supabaseClient.from('paiements').select(...).
- Tables/RPC : `paiements`, `factures`, RPC `enregistrer_paiement`.
- Dépendance app.js : requireRecouvra, showToast.
- Offline : paiements non pris en charge hors ligne (doit être en ligne pour RPC). Possible queueing if app.js supports it.
- Risques : permission errors if user lacks recouvra flag.

---

## 10) promesses.html
- Objectif : gérer promesses de paiement (promesses_paiement) — création, suivi, statut.
- Utilisateur : service recouvra / vendeur.
- Fichier HTML : `frontend/promesses.html`.
- CSS : `frontend/assets/style.css`.
- JS : probable `assets/promesses.js` ; appels select/insert/update sur promesses_paiement, et RPC `verifier_promesses` pour mise à jour automatique.
- Tables/RPC : `promesses_paiement`, `factures`; RPC `verifier_promesses`.
- Dépendance app.js : requireRecouvra.
- Offline : lectures possibles en cache; création promesse nécessite connexion.
- Risques : time-zone/date handling for promises; vérifier UI date formats.

---

## 11) recouvra.html
- Objectif : interface de relance (regroupement par client, envoi WhatsApp, création d'entrées dans relances table).
- Utilisateur : recouvra-enabled users (has_recouvra true).
- Fichier HTML : `frontend/recouvra.html` + `frontend/assets/recouvra.js` (we examined recouvra.js earlier).
- CSS : `frontend/assets/style.css`.
- JS : `assets/recouvra.js` uses requireAuth, requireRecouvra, supabaseClient.rpc('verifier_promesses'), supabaseClient.from('factures').select(...) grouped by client, insert into `relances` and build Whatsapp URL.
- Tables/RPC : `factures`, `clients`, `relances`, RPC `verifier_promesses`.
- Dépendance app.js : requireRecouvra, showToast, fmtMoney, esc.
- Offline : listing can be cached; verifier_promesses RPC must be run online.
- Risques : inserting into relances table requires necessary RLS and has implications for data; ensure permission checks.

---

## 12) recouvra-detail.html
- Objectif : détail d'une relance / conversation client (probable), actions sur une facture.
- Utilisateur : recouvra users.
- Fichier HTML : `frontend/recouvra-detail.html` (présence référencée dans nav and sw.js).
- CSS : `frontend/assets/style.css`.
- JS : likely page-specific script `assets/recouvra-detail.js` or inline; uses factures, relances, paiements.
- Tables/RPC : `relances`, `factures`, `promesses_paiement`.
- Dépendance app.js : requireRecouvra, showToast.
- Offline : consultation possible si cached; actions nécessitent connexion.
- Risques : permissions, linking to WhatsApp relies on valid phone numbers.

---

## 13) parametres.html (Paramètres)
- Objectif : gérer entreprise_settings, branding, logos (upload bucket storage), préférences (dark mode), abonnement.
- Utilisateur : admin / super_admin.
- Fichier HTML : `frontend/parametres.html`.
- CSS : `frontend/assets/style.css`.
- JS : `assets/parametres.js` (upload logo to storage, update entreprise_settings), use storage.createSignedUrl or storage APIs.
- Tables/RPC : `entreprise_settings`; Storage bucket `company-logos` (policies in migration_recouvra.sql).
- Dépendance app.js : applyCompanySettings, supabase storage client via supabaseClient.storage.
- Offline : changements de settings doivent être en ligne.
- Risques : storage policies require correct bucket and permissions; do not relax RLS.

---

## 14) abonnement.html
- Objectif : écran d'abonnement — gestion d'accès aux fonctionnalités PRO (recouvra), liens de paiement/activation.
- Utilisateur : admin/owner.
- Fichier HTML : `frontend/abonnement.html`.
- CSS : `frontend/assets/style.css`.
- JS : `assets/abonnement.js` (gère état de l'abonnement, requêtes vers profiles/recouvra_activation_requests).
- Tables/RPC : `recouvra_activation_requests`, `profiles`.
- Dépendance app.js : requireAuth, showToast.
- Offline : non applicable pour activation.
- Risques : careful with activation requests uniqueness (DB enforces one pending request per user).

---

## 15) onboarding.html
- Objectif : parcours initial setup pour entreprise (branding, parametres, creation comptes éventuels).
- Utilisateur : nouvel admin / super_admin.
- Fichier HTML : `frontend/onboarding.html` (present referenced in sw.js and login flows).
- CSS : `frontend/assets/style.css`.
- JS : `assets/onboarding.js` or inline; fills entreprise_settings and profiles.
- Tables/RPC : `entreprises`, `profiles`, `entreprise_settings`.
- Dépendance app.js : applyCompanySettings, requireAuth flows.
- Offline : not typical; should be online.
- Risques : creation of entreprises/profiles must respect triggers set_entreprise_on_insert and RLS — preserve security.

---

## 16) super-admin.html
- Objectif : outils d'administration (gestion users, approbation recouvra activation, diagnostic).
- Utilisateur : super_admin.
- Fichier HTML : `frontend/super-admin.html` (presence likely; referenced in repo list).
- CSS : `frontend/assets/style.css`.
- JS : page-specific admin scripts; uses profiles, entreprises, recouvra_activation_requests.
- Tables/RPC : `profiles`, `entreprises`, `recouvra_activation_requests`.
- Dépendance app.js : requireAuth and current_user_is_super_admin enforcement in UI.
- Offline : non applicable.
- Risques : admin actions must be strictly protected by RLS and UI checks.

---

### Notes générales & recommandations
- app.js est le cœur : ne pas le réécrire, documenter les fonctions clés (requireAuth, requireRecouvra, syncPendingSales, syncPendingMovements, syncFieldUpdates, loadWithCache, fetchAllRows, queueFieldUpdate). Toute modification UI doit réutiliser ces fonctions.
- RPC critiques (do not change): `valider_facture`, `enregistrer_mouvement_stock`, `enregistrer_paiement`, `verifier_promesses`, `annuler_facture`, `supprimer_mouvement_stock`.
- RLS & multi-entreprise : migration_recouvra.sql met en place fonctions `current_user_entreprise_id()`, `current_user_is_super_admin()` et triggers `set_entreprise_on_insert()` — ne pas modifier sans audit.
- Offline : queues locales `recouvra_pending_sales`, `recouvra_pending_movements`, `recouvra_pending_updates` doivent être conservées; vérifier leur intégration page par page lors de la refonte.
- PDF : facture-detail utilise jsPDF + autotable ; garder les dépendances CDN ou empaqueter localement si souhait d'optimisation.

---

Fichier créé automatiquement par l'assistant sur la branche `feature/redesign-mobile-first`.
