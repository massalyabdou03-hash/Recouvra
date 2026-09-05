-- Ajoute les 2 champs necessaires a l'onboarding en plusieurs etapes apres inscription
-- (type de commerce + besoins selectionnes) sur la table entreprises existante.
-- Purement additif : aucune colonne existante modifiee, aucune donnee touchee.
-- A executer apres schema.sql et migration_recouvra.sql.

alter table entreprises add column if not exists type_commerce varchar(30);
alter table entreprises drop constraint if exists entreprises_type_commerce_check;
alter table entreprises add constraint entreprises_type_commerce_check
  check (type_commerce is null or type_commerce in ('boutique','quincaillerie','garage','pieces_auto','alimentation','autre'));

-- Liste des besoins coches a l'etape "Quels sont vos besoins ?", ex: ["stock","recouvrement"].
alter table entreprises add column if not exists besoins jsonb not null default '[]'::jsonb;

-- Sert a savoir si l'entreprise a deja vu l'onboarding (evite de le re-afficher a
-- chaque connexion) sans dependre du remplissage de type_commerce/besoins, qui restent
-- modifiables plus tard sans que ca doive rouvrir l'onboarding.
alter table entreprises add column if not exists onboarding_completed_at timestamptz;

-- entreprises n'avait jusqu'ici qu'une policy SELECT (migration_recouvra.sql) : aucun
-- utilisateur authentifie ne peut ecrire dans sa propre entreprise. L'onboarding a
-- justement besoin d'ecrire type_commerce/besoins/onboarding_completed_at depuis le
-- frontend -- sans cette policy, la sauvegarde echoue silencieusement (0 ligne mise a
-- jour a cause de RLS, mais sans erreur renvoyee par PostgREST). Meme perimetre que la
-- policy deja existante sur entreprise_settings (lecture/ecriture scopees a l'entreprise).
drop policy if exists entreprises_self_update on entreprises;
create policy entreprises_self_update on entreprises for update to authenticated
  using (id = current_user_entreprise_id() or current_user_is_super_admin())
  with check (id = current_user_entreprise_id() or current_user_is_super_admin());
