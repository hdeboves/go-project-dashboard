import { ModulePlaceholder } from "@/components/ModulePlaceholder";

export default function RetroplanningPage() {
  return (
    <ModulePlaceholder
      title="Rétroplanning Gantt, Veille IA & Historique 14j"
      milestoneBadge="Jalon 2 · M3"
      description="Pilotage bidirectionnel de 002.1 Rétroplanning Actif (strictement interne par défaut)."
      features={[
        "Vue Gantt synchronisée avec 002.1 Rétroplanning Actif (PHASES / ÉTAPES / TÂCHES)",
        "Veille IA Gemini sur Gmail & 004. Production avec propositions validables en 1 clic",
        "Archivage automatique tous les 14 jours dans 002.2 + comparateur visuel des dérives (+X jours)",
        "Verrou permanent : 002.1 n'est jamais synchronisé vers [EXT] (export ponctuel manuel uniquement)",
      ]}
    />
  );
}
