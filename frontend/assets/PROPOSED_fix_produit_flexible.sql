-- ============================================================================
-- PROPOSITION DE CORRECTION — NON APPLIQUÉE, À VALIDER AVANT EXÉCUTION
-- ============================================================================
-- Contexte (suite de l'audit sur le formulaire produit, stock.html) :
--
-- 1. `pieces.reference_oem` est NOT NULL en base, mais le formulaire ne
--    l'indique pas comme obligatoire (pas d'astérisque) et envoie `null`
--    si le champ est laissé vide. Un commerçant qui n'utilise pas de codes
--    articles (boutique, alimentation...) ne peut pas enregistrer de
--    produit et obtient une erreur incompréhensible.
--    -> On rend la colonne nullable : le code article redevient ce que
--       l'interface promet déjà, un champ optionnel.
--
-- 2. Même bug, plus grave, sur `pieces.reference_interne` : NOT NULL UNIQUE
--    en base, mais le champ affiche "Auto-généré" comme placeholder alors
--    que RIEN ne le génère automatiquement nulle part (ni trigger, ni
--    code JS). Le laisser vide envoie `null` -> échec systématique à la
--    création si l'utilisateur ne saisit rien, ce qui contredit le
--    placeholder. On ajoute un vrai générateur côté base (trigger +
--    séquence), pour que "Auto-généré" soit vrai.
-- ============================================================================

alter table pieces alter column reference_oem drop not null;

create sequence if not exists pieces_reference_interne_seq;

create or replace function generate_reference_interne()
returns trigger
language plpgsql
as $$
begin
    if new.reference_interne is null or btrim(new.reference_interne) = '' then
        new.reference_interne := 'REF-' || lpad(nextval('pieces_reference_interne_seq')::text, 6, '0');
    end if;
    return new;
end;
$$;

drop trigger if exists trg_pieces_reference_interne on pieces;
create trigger trg_pieces_reference_interne
before insert on pieces
for each row execute function generate_reference_interne();

-- ============================================================================
-- Rien à faire côté RLS ou côté colonne `categorie` : c'est un varchar(100)
-- libre, sans contrainte check en base. La liste "Cosmétiques / Parfums /
-- Soins / Quincaillerie / Autre" était donc purement une limitation du
-- formulaire (frontend/stock.html), corrigée séparément côté JS pour
-- s'adapter au type_commerce de l'entreprise (boutique / quincaillerie /
-- garage / pieces_auto / alimentation / autre).
-- ============================================================================
