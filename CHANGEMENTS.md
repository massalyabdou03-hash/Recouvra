# Changements apportés (7 septembre 2026)

## 1. Correction du logo cassé

**Cause du bug :** sur la page de détail de facture, quand le logo signé
(URL privée Supabase) ne se chargeait pas, le code retombait sur le chemin
brut de stockage (`logo_path`), qui n'est pas une URL valide → le
navigateur affichait l'icône "image cassée" avec le texte alternatif qui
débordait par-dessus le nom de l'entreprise.

**Fichiers modifiés :**
- `frontend/assets/app.js` — nouvelle fonction `companyLogoFallback()` qui
  génère un avatar (initiale de l'entreprise sur fond coloré) ; `onerror`
  ajouté sur toutes les images `[data-company-logo]` (sidebar, etc.).
- `frontend/facture-detail.html` — suppression du mauvais repli
  (`logo_path` brut), remplacé par l'avatar généré + `onerror`.
- `frontend/assets/style.css` — `overflow:hidden` en renfort sur `.brand-logo`
  et `.ih-logo img`.
- `frontend/parametres.html` — aperçu en direct du logo avec message
  d'erreur/succès, pour repérer un logo cassé avant qu'un client ne le voie
  sur une facture (réutilise `getStorageUrl()` déjà présent dans `app.js`).

Résultat : un logo cassé (lien mort, fichier supprimé, URL expirée...) ne
montrera plus jamais l'icône cassée du navigateur — juste un avatar propre.

## 2. Guide de vente interactif (page "Vendre")

**Nouveau fichier :** `frontend/assets/tour.js` — moteur générique de
visite guidée (spotlight + infobulle), sans dépendance externe.

**`frontend/factures.html`** — 4 étapes configurées (Bienvenue → Qui
achète ? → Quels articles ? → Encaisser), qui se déclenchent automatiquement
au premier jour d'un vendeur (une seule fois, mémorisé en base), plus un
bouton "🧭 Revoir le guide" pour le relancer à tout moment.

**`frontend/aide.html`** *(nouveau)* — page de mode d'emploi écrite,
couvrant chaque section de l'app, avec un raccourci vers le guide
interactif. Accessible via un lien "❓ Aide" ajouté automatiquement dans la
sidebar et la barre mobile (injecté par `app.js`, aucune autre page à
modifier).

## ⚠️ Action requise côté Supabase

Exécuter le nouveau fichier **`supabase/upgrade_tour_vente.sql`** dans
l'éditeur SQL de votre projet Supabase (après `schema.sql` et
`migration_recouvra.sql`, comme les autres fichiers `upgrade_*.sql`).

Il ajoute la colonne `profiles.tour_vente_vu_at` et une fonction
`marquer_tour_vente_vu()` (accessible uniquement à l'utilisateur connecté,
sur sa propre ligne — `profiles` n'ayant pas de policy d'auto-modification,
un simple `update` direct depuis le frontend aurait échoué silencieusement).

Sans cette migration, le guide fonctionne quand même (bouton "Revoir le
guide", `?guide=1`) mais se réaffichera à chaque visite au lieu de ne se
déclencher qu'une fois.

## Service worker

`CACHE_VERSION` passé à `v30` et `aide.html` / `assets/tour.js` ajoutés à
la liste des fichiers mis en cache (sinon les utilisateurs déjà installés
en PWA ne verraient pas les nouveaux fichiers avant un vidage de cache).
