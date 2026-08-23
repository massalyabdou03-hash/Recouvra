# Deploiement Recouvra

## 1. Projet de test `recovra-dev`

1. Creer ou ouvrir le projet Supabase de test `recovra-dev`.
2. Dans **SQL Editor**, executer `schema.sql` en entier. Cette etape cree notamment la table `pieces`.
3. Verifier que les tables `pieces`, `clients` et `factures` existent.
4. Executer ensuite `migration_recouvra.sql` en entier.
4. Creer un utilisateur de test dans **Authentication > Users**.
5. Renseigner l URL et la cle publishable/anon de `recovra-dev` dans `frontend/assets/config.js`.
7. Servir le dossier `frontend` avec un serveur statique et tester connexion, activation, paiements, promesses, relances, branding et super-admin.

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
3. Publier le contenu de `frontend` sur Netlify.
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
