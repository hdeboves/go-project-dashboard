import { ModulePlaceholder } from "@/components/ModulePlaceholder";

export default function ReportingPage() {
  return (
    <ModulePlaceholder
      title="Reporting Fin de Jeu Fortnite & Influence"
      milestoneBadge="Jalon 3 · M4"
      description="Consolidation des données Portail Créateur Fortnite + captures Influence Gemini Vision."
      features={[
        "Import CSV/Excel Portail Créateur Fortnite dans 006.1 Données Brutes",
        "Extraction Gemini Vision des captures WhatsApp Influence avec écran de contrôle côte à côte",
        "Consolidation Sheet/Excel 4 onglets (006.2) + export .xlsx en 1 clic",
        "Générateur Google Slides charté (006.3) & publication vers [EXT]/04. Reporting Final sur validation",
      ]}
    />
  );
}
