# Deploiement Recouvra

## 0. Ordre d'execution complet des scripts SQL

Il n'existe pas de fichier schema unique : chaque nouvel environnement (test,
nouveau client) doit rejouer ces scripts dans cet ordre exact, dans le
**SQL Editor** du projet Supabase concerne. Tous sont idempotents (`if not
exists`, `create or replace`) et peuvent etre relances sans risque sur un
environnement qui les a deja recus.

**Generiques — a executer sur tout nouveau projet Supabase, dans cet ordre :**

1. `schema.sql` — tables de base (pieces, clients, factures, mouvements de stock).
2. `migration_recouvra.sql` — multi-entreprise, paiements, promesses, relances, branding, RLS.
3. `upgrade_saas_onboarding_wave.sql` — creation automatique d'entreprise a l'inscription, abonnement Wave.
4. `upgrade_units_mesure.sql` — unites de mesure, vente en lot, echeances de credit.
5. `upgrade_paiements_sync.sql` — synchronisation des deux modeles de suivi de paiement (`paye`/`paye_at` cote Emprunts, `montant_paye`/`montant_restant`/`statut_paiement` cote Recouvra).
6. `upgrade_pieces_description.sql` — champs description libres du catalogue.
7. `secure_sylla_access_codes.sql` — verrouille (RLS) une table d'un ancien mecanisme de connexion, non utilisee par le frontend actuel. A executer sur **tout** projet ayant deja execute `setup_sylla_code_access.sql`.

**Specifiques a une instance client existante — ne jamais lancer sur un nouveau projet :**

- `setup_recouvra_admin.sql` — seed du compte super-admin de `recovra-dev` uniquement.
- `upgrade_sylla_automobile.sql`, `upgrade_sylla_historique_paiements.sql` — corrections ponctuelles deja appliquees a l'instance Sylla Automobile.

**Deprecie — ne plus executer :**

- `setup_sylla_code_access.sql` — ancien mecanisme de connexion par code, remplace par `codeToEmail()` (email technique + vrai compte Supabase Auth). Cree une table avec un mot de passe en clair sans RLS : si elle a deja ete executee quelque part, lancer `secure_sylla_access_codes.sql` dessus immediatement.

## 1. Projet de test `recovra-dev`

1. Creer ou ouvrir le projet Supabase de test `recovra-dev`.
2. Dans **SQL Editor**, executer `schema.sql` en entier. Cette etape cree notamment la table `pieces`.
3. Verifier que les tables `pieces`, `clients` et `factures` existent.
4. Executer ensuite `migration_recouvra.sql` en entier.
5. Creer l utilisateur `massalyabdou03@gmail.com` dans **Authentication > Users**.
6. Executer `setup_recouvra_admin.sql` pour activer ce compte en super-admin de test.
7. Renseigner l URL et la cle publishable/anon de `recovra-dev` dans `frontend/assets/config.js`.
8. Servir le dossier `frontend` avec un serveur statique et tester connexion, activation, paiements, promesses, relances, branding et super-admin.

`migration_recouvra.sql` est une migration complementaire. Si elle est executee avant `schema.sql`, Supabase affiche `42P01: relation "pieces" does not exist`. Dans ce cas, executer `schema.sql`, puis relancer la migration depuis le debut.

Ne jamais utiliser la cle `service_role` dans `config.js`.

## 2. Activation de Sylla Automobile

Ne pas executer `migration_recouvra.sql` sur la base client pour un simple upgrade. Une fois la migration structurelle deja appliquee et validee sur l instance Sylla, executer `upgrade_sylla_automobile.sql` dans le SQL Editor de cette instance.

Avant execution, remplacer `email_du_gerant_sylla` par l email exact du compte present dans **Authentication > Users**. Le script s arrete volontairement si le placeholder est conserve.

Le script :

- active `has_recouvra` pour le compte du gerant ;
- force son role a `admin` ;
- rattache le profil a son entreprise ;
- nomme l entreprise `Sylla Automobile` ;
- initialise les couleurs `#e87516` et `#20252b` uniquement si elles sont absentes ;
- ne modifie pas les lignes des tables `clients`, `pieces` ou `factures`.

## 3. Transition frontend client

1. Sauvegarder l URL et la cle publique actuelles de Sylla.
2. Remplacer les valeurs de `frontend/assets/config.js` par celles du projet Supabase de Sylla, jamais par une cle privee.
3. Publier le contenu du repo sur Vercel (racine du repo, aucun build).
4. Ouvrir l application avec le compte du gerant.
5. Verifier que Recouvra s ouvre directement sans demande d activation.
6. Tester une facture de test, un paiement partiel, une relance et l affichage des parametres entreprise.

## 4. Retour arriere

Avant toute mise en production, exporter la base et tester sur `recovra-dev`. Pour desactiver temporairement Recouvra sans supprimer les donnees :

```sql
update profiles
set has_recouvra = false, updated_at = now()
where id = (select id from auth.users where lower(email) = lower('email_du_gerant_sylla'));
```

Le retour arriere de la migration structurelle doit etre traite par une sauvegarde Supabase, pas par une suppression manuelle des tables.
