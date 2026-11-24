import { ModulePlaceholder } from "@/components/ModulePlaceholder";

export default function BudgetPage() {
  return (
    <ModulePlaceholder
      title="Budget 3-Blocs & Pipeline Factures"
      milestoneBadge="Jalon 1 · M2"
      description="Suivi financier temps réel (Prix de vente, Coûts pré-op, Coûts post-op) et ingestion factures PDF."
      features={[
        "Import .xlsx ou copie contrôlée du Sheet Budget (001.1) dans le bac à sable",
        "Calcul automatique des marges prévues vs réelles et alertes seuils à 85% et 100%",
        "Scan Gmail + glisser-déposer PDF avec extraction IA Gemini & blocage CP conflictuel",
        "Validation en 1 clic : dépôt 001.3 Factures + cumul HT & note Sheet + brouillon Gmail Pennylane",
      ]}
    />
  );
}
