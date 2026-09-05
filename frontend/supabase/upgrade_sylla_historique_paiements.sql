-- Correction historique des ventes deja validees sur la base Sylla Automobile.
-- A executer APRES schema.sql, migration_recouvra.sql, upgrade_units_mesure.sql,
-- upgrade_paiements_sync.sql et upgrade_sylla_automobile.sql.
--
-- Pourquoi ce script est necessaire : migration_recouvra.sql initialise
-- montant_paye/montant_restant/statut_paiement a 0/montant_total/NON_PAYEE pour
-- TOUTES les factures existantes (la colonne montant_paye n'existait pas avant),
-- sans distinguer le mode de paiement. Resultat sur des donnees reelles : une
-- vente comptant (ESPECES/CARTE/VIREMENT/WAVE/OM/CHEQUE) deja encaissee il y a
-- des mois apparaitrait comme une creance ouverte dans Recouvra, alors qu'elle
-- est deja payee. upgrade_paiements_sync.sql corrige bien le flag paye/paye_at
-- pour ces ventes, mais son trigger de synchronisation n'existe pas encore au
-- moment de son propre backfill, donc montant_paye/montant_restant/
-- statut_paiement restent incorrects pour l'historique. Ce script cible
-- precisement les factures encore mal marquees et les corrige une seule fois
-- (la clause montant_restant > 0 rend le script sans effet si on le relance).

update factures
set montant_paye = montant_total,
    montant_restant = 0,
    statut_paiement = 'PAYEE',
    paye = true,
    paye_at = coalesce(paye_at, validated_at, now()),
    updated_at = now()
where statut = 'VALIDEE'
  and mode_paiement <> 'CREDIT'
  and montant_restant > 0;

-- Controle : doit renvoyer 0 lignes une fois la correction appliquee.
select id, numero_facture, mode_paiement, montant_total, montant_paye, montant_restant, statut_paiement, paye
from factures
where statut = 'VALIDEE' and mode_paiement <> 'CREDIT' and montant_restant > 0;

-- Pour verification manuelle : les seules factures qui doivent rester avec un
-- montant_restant > 0 sont les ventes a credit reellement impayees.
select mode_paiement, statut_paiement, count(*), sum(montant_restant) as total_du
from factures
where statut = 'VALIDEE'
group by mode_paiement, statut_paiement
order by mode_paiement, statut_paiement;
