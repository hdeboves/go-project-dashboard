export interface AvatarOption {
  id: string;
  label: string;
  vibe: string;
}

export interface AvatarBgOption {
  id: string;
  label: string;
  hex: string;
}

export const AVATAR_OPTIONS: readonly AvatarOption[] = [
  { id: "gamer-cat", label: "Chat Gamer", vibe: "Casque vissé, prêt à carry" },
  { id: "chill-frog", label: "Grenouille Chill", vibe: "Lunettes noires, zéro stress" },
  { id: "happy-axolotl", label: "Axolotl Kawaii", vibe: "Toujours content d'être là" },
  { id: "cozy-capybara", label: "Capybara Zen", vibe: "Mandarine en équilibre parfait" },
  { id: "derpy-shiba", label: "Shiba Joyeux", vibe: "Langue dehors, bonne humeur" },
  { id: "sneaky-fox", label: "Renard Malin", vibe: "A toujours un plan B" },
  { id: "tiny-ghost", label: "Petit Fantôme", vibe: "Bouh ! (mais tout mignon)" },
  { id: "space-alien", label: "Alien Curieux", vibe: "Vient en paix (avec 3 yeux)" },
  { id: "pixel-duck", label: "Canard Debug", vibe: "Résout tous les bugs en silence" },
  { id: "sleepy-panda", label: "Panda Roux", vibe: "Besoin d'un café avant le daily" },
  { id: "boba-bear", label: "Ours Bubble Tea", vibe: "Fan numéro 1 de perles tapioca" },
  { id: "happy-octo", label: "Poulpe Multitâche", vibe: "8 tentacules pour 8 projets" },
  { id: "wizard-owl", label: "Hibou Magicien", vibe: "Transforme les deadlines en magie" },
  { id: "toast-buddy", label: "Tartine Souriante", vibe: "Bien dorée et optimiste" },
  { id: "dino-nugget", label: "Mini Dino", vibe: "Petits bras, grandes ambitions" },
  { id: "cosmic-slime", label: "Slime Étoilé", vibe: "Rebondit sur tous les imprévus" },
] as const;

export const AVATAR_BG_OPTIONS: readonly AvatarBgOption[] = [
  { id: "butter", label: "Citron doux", hex: "#FDE68A" },
  { id: "peach", label: "Pêche", hex: "#FED7AA" },
  { id: "blush", label: "Rose bonbon", hex: "#FBCFE8" },
  { id: "lavender", label: "Lavande", hex: "#DDD6FE" },
  { id: "sky", label: "Ciel clair", hex: "#BAE6FD" },
  { id: "mint", label: "Menthe fraîche", hex: "#A7F3D0" },
  { id: "lime", label: "Pistache", hex: "#D9F99D" },
  { id: "coral", label: "Corail", hex: "#FECDD3" },
  { id: "periwinkle", label: "Pervenche", hex: "#C7D2FE" },
  { id: "cloud", label: "Nuage", hex: "#E2E8F0" },
] as const;

export const DEFAULT_AVATAR_ID = "gamer-cat";
export const DEFAULT_AVATAR_BG = "#FDE68A";

export function isValidAvatarId(id: string): boolean {
  return AVATAR_OPTIONS.some((a) => a.id === id);
}

export function isValidAvatarBg(hex: string): boolean {
  return AVATAR_BG_OPTIONS.some(
    (b) => b.hex.toLowerCase() === hex.trim().toLowerCase()
  );
}

export function getAvatarMeta(id: string | null | undefined): AvatarOption {
  return (
    AVATAR_OPTIONS.find((a) => a.id === id) ?? AVATAR_OPTIONS[0]
  );
}

export function getRandomAvatar(): { avatarId: string; avatarBg: string } {
  const icon =
    AVATAR_OPTIONS[Math.floor(Math.random() * AVATAR_OPTIONS.length)];
  const bg =
    AVATAR_BG_OPTIONS[Math.floor(Math.random() * AVATAR_BG_OPTIONS.length)];
  return { avatarId: icon.id, avatarBg: bg.hex };
}
