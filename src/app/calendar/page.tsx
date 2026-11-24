import { ModulePlaceholder } from "@/components/ModulePlaceholder";

export default function CalendarPage() {
  return (
    <ModulePlaceholder
      title="Google Agenda Projet & Tâches en Cascade"
      milestoneBadge="Jalon 2 · M3"
      description="Calendrier secondaire dédié par projet et recalcul automatique des échéances."
      features={[
        "Création d'un agenda secondaire dédié [<CP>] <Client> - <Jeu> (jamais 'primary')",
        "Cascades automatiques : Influence (J-10 / J-3 / J / J+7), Map Fortnite (J-14 / J-5 / J-2 / J), Weekly (J-1 / J)",
        "Décalage automatique de toute la chaîne Google Calendar dès modification d'un jalon",
      ]}
    />
  );
}
