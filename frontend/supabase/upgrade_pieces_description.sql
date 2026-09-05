-- Le frontend (catalogue.html) lit/ecrit "description" et "informations_complementaires"
-- sur la table pieces depuis un moment, mais aucun script precedent ne creait ces
-- colonnes en base : d'ou l'erreur "Could not find the 'description' column of
-- 'pieces' in the schema cache" a la creation/edition d'une piece.
-- A executer une seule fois dans le SQL Editor du projet Supabase du SaaS RECOVRA.

alter table pieces add column if not exists description text;
alter table pieces add column if not exists informations_complementaires text;
