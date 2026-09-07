-- Ajoute le suivi du guide interactif de la page Vendre (factures.html).
-- Purement additif : aucune colonne existante modifiee, aucune donnee touchee.
-- A executer apres schema.sql et migration_recouvra.sql.

-- Un horodatage (plutot qu'un simple booleen) : permet de savoir quand
-- l'utilisateur a termine/passe le guide, utile si on veut un jour relancer
-- le guide a tous les comptes crees avant une certaine date (ex: apres une
-- refonte de la page Vendre).
alter table profiles add column if not exists tour_vente_vu_at timestamptz;

-- Attention : profiles n'a PAS de policy permettant a un utilisateur de
-- modifier sa propre ligne (seule "profiles_superadmin_update" existe, et
-- elle est reservee au super_admin -- voir migration_recouvra.sql). On
-- n'ouvre donc pas un update generique sur profiles (un utilisateur pourrait
-- alors potentiellement modifier son propre role ou entreprise_id), mais on
-- passe par une fonction dediee, comme le reste du projet (annuler_facture,
-- verifier_promesses, etc.) : elle ne touche qu'a tour_vente_vu_at, et
-- uniquement sur la ligne de l'utilisateur connecte.
create or replace function marquer_tour_vente_vu()
returns void language plpgsql security definer set search_path = public as $$
begin
    if auth.uid() is null then raise exception 'Authentification requise'; end if;
    update profiles set tour_vente_vu_at = now() where id = auth.uid();
end;
$$;

revoke all on function marquer_tour_vente_vu() from public, anon;
grant execute on function marquer_tour_vente_vu() to authenticated;
