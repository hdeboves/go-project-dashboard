import { ModulePlaceholder } from "@/components/ModulePlaceholder";

export default function WeeklysPage() {
  return (
    <ModulePlaceholder
      title="Générateur de Weeklys Clients (Slides + Gmail)"
      milestoneBadge="Jalon 2 · M3"
      description="Production hebdomadaire en 1 clic dans 003.2 Weeklys Clients et brouillon Gmail récapitulatif."
      features={[
        "Collecte automatique J-7 → J des tâches, livrables et visuels récents depuis 004. Production",
        "Duplication du template Slides client et injection des prochaines étapes (Côté Client vs Côté GO)",
        "Création du brouillon Gmail récapitulatif (Draft-First, jamais d'envoi automatique)",
      ]}
    />
  );
}
