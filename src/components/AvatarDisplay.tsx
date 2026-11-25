"use client";

import { DEFAULT_AVATAR_BG, DEFAULT_AVATAR_ID } from "@/lib/avatars";

interface AvatarDisplayProps {
  avatarId?: string | null;
  avatarBg?: string | null;
  size?: "xs" | "sm" | "md" | "lg" | "xl";
  className?: string;
  title?: string;
}

const SIZE_CLASSES: Record<NonNullable<AvatarDisplayProps["size"]>, string> = {
  xs: "h-6 w-6",
  sm: "h-8 w-8",
  md: "h-10 w-10",
  lg: "h-14 w-14",
  xl: "h-24 w-24",
};

function renderCuteSvg(avatarId: string) {
  switch (avatarId) {
    case "chill-frog":
      return (
        <svg viewBox="0 0 64 64" className="h-full w-full" aria-hidden="true">
          {/* Frog ears/eyes bumps */}
          <circle cx="21" cy="22" r="9" fill="#4ADE80" stroke="#166534" strokeWidth="2.2" />
          <circle cx="43" cy="22" r="9" fill="#4ADE80" stroke="#166534" strokeWidth="2.2" />
          {/* Face */}
          <ellipse cx="32" cy="37" rx="20" ry="15" fill="#4ADE80" stroke="#166534" strokeWidth="2.2" />
          {/* Cheeks */}
          <ellipse cx="18" cy="40" rx="3.8" ry="2.2" fill="#FDA4AF" opacity="0.8" />
          <ellipse cx="46" cy="40" rx="3.8" ry="2.2" fill="#FDA4AF" opacity="0.8" />
          {/* Cool sunglasses */}
          <rect x="13" y="21" width="16" height="9" rx="3" fill="#0F172A" />
          <rect x="35" y="21" width="16" height="9" rx="3" fill="#0F172A" />
          <line x1="29" y1="25" x2="35" y2="25" stroke="#0F172A" strokeWidth="2.5" />
          <line x1="16" y1="24" x2="21" y2="24" stroke="#38BDF8" strokeWidth="1.6" strokeLinecap="round" />
          <line x1="38" y1="24" x2="43" y2="24" stroke="#38BDF8" strokeWidth="1.6" strokeLinecap="round" />
          {/* Chill smile */}
          <path d="M24 41 Q32 46 40 41" fill="none" stroke="#166534" strokeWidth="2.4" strokeLinecap="round" />
        </svg>
      );

    case "happy-axolotl":
      return (
        <svg viewBox="0 0 64 64" className="h-full w-full" aria-hidden="true">
          {/* Gills */}
          <path d="M14 27 L6 22 M13 33 L5 33 M15 39 L8 43" stroke="#EC4899" strokeWidth="4" strokeLinecap="round" />
          <path d="M50 27 L58 22 M51 33 L59 33 M49 39 L56 43" stroke="#EC4899" strokeWidth="4" strokeLinecap="round" />
          {/* Head */}
          <ellipse cx="32" cy="35" rx="19" ry="16" fill="#FBCFE8" stroke="#DB2777" strokeWidth="2.2" />
          {/* Cute eyes */}
          <circle cx="24" cy="33" r="3" fill="#1E293B" />
          <circle cx="40" cy="33" r="3" fill="#1E293B" />
          <circle cx="23" cy="32" r="1" fill="#FFFFFF" />
          <circle cx="39" cy="32" r="1" fill="#FFFFFF" />
          {/* Rosy cheeks */}
          <ellipse cx="19" cy="38" rx="3.2" ry="2" fill="#F472B6" opacity="0.65" />
          <ellipse cx="45" cy="38" rx="3.2" ry="2" fill="#F472B6" opacity="0.65" />
          {/* Big happy smile */}
          <path d="M26 39 Q32 45 38 39" fill="none" stroke="#9D174D" strokeWidth="2.4" strokeLinecap="round" />
        </svg>
      );

    case "cozy-capybara":
      return (
        <svg viewBox="0 0 64 64" className="h-full w-full" aria-hidden="true">
          {/* Ears */}
          <circle cx="17" cy="27" r="5" fill="#A16207" stroke="#713F12" strokeWidth="2" />
          <circle cx="47" cy="27" r="5" fill="#A16207" stroke="#713F12" strokeWidth="2" />
          {/* Head */}
          <rect x="14" y="23" width="36" height="28" rx="14" fill="#CA8A04" stroke="#713F12" strokeWidth="2.2" />
          {/* Snout */}
          <ellipse cx="32" cy="41" rx="11" ry="7.5" fill="#A16207" />
          {/* Tangerine on head! */}
          <circle cx="32" cy="17" r="6.5" fill="#FB923C" stroke="#C2410C" strokeWidth="1.8" />
          <path d="M32 10 Q36 8 37 11 Q34 12 32 10 Z" fill="#22C55E" />
          {/* Zen closed eyes */}
          <path d="M20 33 Q23 31 26 33" fill="none" stroke="#422006" strokeWidth="2.2" strokeLinecap="round" />
          <path d="M38 33 Q41 31 44 33" fill="none" stroke="#422006" strokeWidth="2.2" strokeLinecap="round" />
          {/* Nose & mouth */}
          <circle cx="29" cy="39" r="1.4" fill="#422006" />
          <circle cx="35" cy="39" r="1.4" fill="#422006" />
          <path d="M29 43 Q32 45 35 43" fill="none" stroke="#422006" strokeWidth="2" strokeLinecap="round" />
        </svg>
      );

    case "derpy-shiba":
      return (
        <svg viewBox="0 0 64 64" className="h-full w-full" aria-hidden="true">
          {/* Pointy ears */}
          <polygon points="15,28 19,12 29,22" fill="#F59E0B" stroke="#92400E" strokeWidth="2.2" strokeLinejoin="round" />
          <polygon points="49,28 45,12 35,22" fill="#F59E0B" stroke="#92400E" strokeWidth="2.2" strokeLinejoin="round" />
          {/* Head */}
          <ellipse cx="32" cy="36" rx="19" ry="16" fill="#F59E0B" stroke="#92400E" strokeWidth="2.2" />
          {/* Cream cheeks/face */}
          <path d="M16 39 Q24 31 32 36 Q40 31 48 39 Q45 51 32 51 Q19 51 16 39 Z" fill="#FEF3C7" />
          {/* Eyebrows */}
          <ellipse cx="24" cy="27" rx="2.8" ry="1.6" fill="#FEF3C7" />
          <ellipse cx="40" cy="27" rx="2.8" ry="1.6" fill="#FEF3C7" />
          {/* Eyes */}
          <circle cx="24" cy="33" r="2.8" fill="#1E293B" />
          <circle cx="40" cy="33" r="2.8" fill="#1E293B" />
          <circle cx="23.2" cy="32.2" r="1" fill="#FFFFFF" />
          <circle cx="39.2" cy="32.2" r="1" fill="#FFFFFF" />
          {/* Nose & blep tongue */}
          <ellipse cx="32" cy="38" rx="3.2" ry="2.3" fill="#1E293B" />
          <path d="M29 43 Q32 45 35 43" fill="none" stroke="#78350F" strokeWidth="2" strokeLinecap="round" />
          <path d="M30 43.5 Q32 50 35.5 44" fill="#FB7185" stroke="#BE123C" strokeWidth="1.4" />
        </svg>
      );

    case "sneaky-fox":
      return (
        <svg viewBox="0 0 64 64" className="h-full w-full" aria-hidden="true">
          <polygon points="14,29 16,11 29,21" fill="#F97316" stroke="#9A3412" strokeWidth="2.2" strokeLinejoin="round" />
          <polygon points="50,29 48,11 35,21" fill="#F97316" stroke="#9A3412" strokeWidth="2.2" strokeLinejoin="round" />
          <polygon points="17,24 18,16 25,21" fill="#FFF7ED" />
          <polygon points="47,24 46,16 39,21" fill="#FFF7ED" />
          <path d="M13 33 Q32 16 51 33 Q48 48 32 52 Q16 48 13 33 Z" fill="#F97316" stroke="#9A3412" strokeWidth="2.2" />
          <path d="M14 36 Q24 38 32 51 Q40 38 50 36 Q47 48 32 52 Q17 48 14 36 Z" fill="#FFF7ED" />
          {/* Sly eyes */}
          <path d="M21 32 L27 34 L21 35" fill="none" stroke="#1E293B" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M43 32 L37 34 L43 35" fill="none" stroke="#1E293B" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
          <circle cx="32" cy="43" r="3" fill="#1E293B" />
        </svg>
      );

    case "tiny-ghost":
      return (
        <svg viewBox="0 0 64 64" className="h-full w-full" aria-hidden="true">
          <path
            d="M17 50 L17 29 A15 15 0 0 1 47 29 L47 50 L41 45 L36 50 L32 45 L28 50 L23 45 Z"
            fill="#FFFFFF"
            stroke="#64748B"
            strokeWidth="2.2"
            strokeLinejoin="round"
          />
          <circle cx="26" cy="30" r="3" fill="#0F172A" />
          <circle cx="38" cy="30" r="3" fill="#0F172A" />
          <circle cx="25" cy="29" r="1" fill="#FFFFFF" />
          <circle cx="37" cy="29" r="1" fill="#FFFFFF" />
          <ellipse cx="21" cy="35" rx="3" ry="1.8" fill="#FDA4AF" />
          <ellipse cx="43" cy="35" rx="3" ry="1.8" fill="#FDA4AF" />
          <ellipse cx="32" cy="36" rx="2.5" ry="3.2" fill="#0F172A" />
        </svg>
      );

    case "space-alien":
      return (
        <svg viewBox="0 0 64 64" className="h-full w-full" aria-hidden="true">
          <line x1="32" y1="20" x2="32" y2="11" stroke="#059669" strokeWidth="2.5" strokeLinecap="round" />
          <circle cx="32" cy="10" r="3.5" fill="#FDE047" stroke="#059669" strokeWidth="1.8" />
          <ellipse cx="32" cy="36" rx="19" ry="16" fill="#34D399" stroke="#065F46" strokeWidth="2.2" />
          {/* 3 cute eyes */}
          <circle cx="22" cy="33" r="4" fill="#FFFFFF" stroke="#065F46" strokeWidth="1.6" />
          <circle cx="32" cy="29" r="4.2" fill="#FFFFFF" stroke="#065F46" strokeWidth="1.6" />
          <circle cx="42" cy="33" r="4" fill="#FFFFFF" stroke="#065F46" strokeWidth="1.6" />
          <circle cx="22" cy="33" r="2" fill="#0F172A" />
          <circle cx="32" cy="29" r="2.1" fill="#0F172A" />
          <circle cx="42" cy="33" r="2" fill="#0F172A" />
          <path d="M25 43 Q32 48 39 43" fill="none" stroke="#065F46" strokeWidth="2.4" strokeLinecap="round" />
        </svg>
      );

    case "pixel-duck":
      return (
        <svg viewBox="0 0 64 64" className="h-full w-full" aria-hidden="true">
          <path d="M28 16 Q32 10 36 16" fill="none" stroke="#CA8A04" strokeWidth="3" strokeLinecap="round" />
          <circle cx="32" cy="35" r="18" fill="#FACC15" stroke="#A16207" strokeWidth="2.2" />
          <circle cx="25" cy="31" r="2.8" fill="#0F172A" />
          <circle cx="39" cy="31" r="2.8" fill="#0F172A" />
          <circle cx="24.2" cy="30.2" r="1" fill="#FFFFFF" />
          <circle cx="38.2" cy="30.2" r="1" fill="#FFFFFF" />
          <ellipse cx="32" cy="39" rx="8" ry="4.5" fill="#F97316" stroke="#9A3412" strokeWidth="1.8" />
          <ellipse cx="19" cy="36" rx="2.8" ry="1.8" fill="#FDA4AF" />
          <ellipse cx="45" cy="36" rx="2.8" ry="1.8" fill="#FDA4AF" />
        </svg>
      );

    case "sleepy-panda":
      return (
        <svg viewBox="0 0 64 64" className="h-full w-full" aria-hidden="true">
          <circle cx="18" cy="21" r="7" fill="#9A3412" stroke="#7C2D12" strokeWidth="2" />
          <circle cx="46" cy="21" r="7" fill="#9A3412" stroke="#7C2D12" strokeWidth="2" />
          <circle cx="18" cy="21" r="3.5" fill="#FFF7ED" />
          <circle cx="46" cy="21" r="3.5" fill="#FFF7ED" />
          <ellipse cx="32" cy="36" rx="19" ry="16" fill="#EA580C" stroke="#7C2D12" strokeWidth="2.2" />
          <ellipse cx="23" cy="35" rx="5.5" ry="4.5" fill="#7C2D12" />
          <ellipse cx="41" cy="35" rx="5.5" ry="4.5" fill="#7C2D12" />
          <ellipse cx="32" cy="42" rx="9" ry="6" fill="#FFF7ED" />
          <circle cx="23" cy="34" r="2.2" fill="#FFFFFF" />
          <circle cx="41" cy="34" r="2.2" fill="#FFFFFF" />
          <circle cx="23" cy="34" r="1.2" fill="#0F172A" />
          <circle cx="41" cy="34" r="1.2" fill="#0F172A" />
          <ellipse cx="32" cy="40" rx="2.8" ry="2" fill="#0F172A" />
          <path d="M29 44 Q32 46 35 44" fill="none" stroke="#7C2D12" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      );

    case "boba-bear":
      return (
        <svg viewBox="0 0 64 64" className="h-full w-full" aria-hidden="true">
          <circle cx="19" cy="21" r="6.5" fill="#B45309" stroke="#78350F" strokeWidth="2.2" />
          <circle cx="45" cy="21" r="6.5" fill="#B45309" stroke="#78350F" strokeWidth="2.2" />
          <circle cx="19" cy="21" r="3" fill="#FDE68A" />
          <circle cx="45" cy="21" r="3" fill="#FDE68A" />
          <circle cx="32" cy="36" r="17" fill="#D97706" stroke="#78350F" strokeWidth="2.2" />
          <ellipse cx="32" cy="41" rx="8" ry="6" fill="#FEF3C7" />
          <circle cx="24" cy="33" r="2.6" fill="#1E293B" />
          <circle cx="40" cy="33" r="2.6" fill="#1E293B" />
          <ellipse cx="32" cy="39" rx="2.6" ry="1.8" fill="#451A03" />
          <path d="M29 43 Q32 45.5 35 43" fill="none" stroke="#451A03" strokeWidth="2" strokeLinecap="round" />
          {/* Little boba straw */}
          <rect x="44" y="34" width="10" height="14" rx="2.5" fill="#FEF9C3" stroke="#78350F" strokeWidth="1.6" />
          <line x1="49" y1="28" x2="49" y2="35" stroke="#EC4899" strokeWidth="2.4" strokeLinecap="round" />
          <circle cx="47" cy="45" r="1.3" fill="#1E293B" />
          <circle cx="51" cy="45" r="1.3" fill="#1E293B" />
        </svg>
      );

    case "happy-octo":
      return (
        <svg viewBox="0 0 64 64" className="h-full w-full" aria-hidden="true">
          {/* Tentacles */}
          <path d="M18 45 Q13 52 19 54 M26 47 Q24 54 29 54 M38 47 Q40 54 35 54 M46 45 Q51 52 45 54" fill="none" stroke="#A855F7" strokeWidth="4.5" strokeLinecap="round" />
          <ellipse cx="32" cy="32" rx="18" ry="16" fill="#C084FC" stroke="#7E22CE" strokeWidth="2.2" />
          <circle cx="25" cy="32" r="3" fill="#0F172A" />
          <circle cx="39" cy="32" r="3" fill="#0F172A" />
          <circle cx="24.2" cy="31" r="1" fill="#FFFFFF" />
          <circle cx="38.2" cy="31" r="1" fill="#FFFFFF" />
          <ellipse cx="20" cy="37" rx="3" ry="1.8" fill="#F472B6" opacity="0.7" />
          <ellipse cx="44" cy="37" rx="3" ry="1.8" fill="#F472B6" opacity="0.7" />
          <path d="M27 38 Q32 43 37 38" fill="none" stroke="#581C87" strokeWidth="2.2" strokeLinecap="round" />
        </svg>
      );

    case "wizard-owl":
      return (
        <svg viewBox="0 0 64 64" className="h-full w-full" aria-hidden="true">
          {/* Wizard hat */}
          <polygon points="32,7 19,24 45,24" fill="#4F46E5" stroke="#312E81" strokeWidth="2" strokeLinejoin="round" />
          <ellipse cx="32" cy="24" rx="17" ry="3.5" fill="#4F46E5" stroke="#312E81" strokeWidth="1.8" />
          <circle cx="32" cy="17" r="1.8" fill="#FDE047" />
          {/* Owl face */}
          <ellipse cx="32" cy="39" rx="17" ry="14" fill="#94A3B8" stroke="#334155" strokeWidth="2.2" />
          <circle cx="25" cy="37" r="6" fill="#FFFFFF" stroke="#334155" strokeWidth="1.8" />
          <circle cx="39" cy="37" r="6" fill="#FFFFFF" stroke="#334155" strokeWidth="1.8" />
          <circle cx="25" cy="37" r="2.8" fill="#0F172A" />
          <circle cx="39" cy="37" r="2.8" fill="#0F172A" />
          <polygon points="32,40 29,45 35,45" fill="#F59E0B" stroke="#92400E" strokeWidth="1.5" strokeLinejoin="round" />
        </svg>
      );

    case "toast-buddy":
      return (
        <svg viewBox="0 0 64 64" className="h-full w-full" aria-hidden="true">
          <path
            d="M17 26 C13 20 18 14 26 15 C30 13 34 13 38 15 C46 14 51 20 47 26 L47 48 C47 51 45 53 42 53 L22 53 C19 53 17 51 17 48 Z"
            fill="#FDE68A"
            stroke="#B45309"
            strokeWidth="3.5"
            strokeLinejoin="round"
          />
          <circle cx="26" cy="33" r="2.8" fill="#451A03" />
          <circle cx="38" cy="33" r="2.8" fill="#451A03" />
          <ellipse cx="21" cy="38" rx="3" ry="1.8" fill="#FB7185" opacity="0.7" />
          <ellipse cx="43" cy="38" rx="3" ry="1.8" fill="#FB7185" opacity="0.7" />
          <path d="M27 39 Q32 44 37 39" fill="none" stroke="#451A03" strokeWidth="2.2" strokeLinecap="round" />
          {/* Melting butter pat */}
          <rect x="28" y="21" width="8" height="6" rx="1.5" fill="#FACC15" stroke="#CA8A04" strokeWidth="1.2" transform="rotate(-8 32 24)" />
        </svg>
      );

    case "dino-nugget":
      return (
        <svg viewBox="0 0 64 64" className="h-full w-full" aria-hidden="true">
          {/* Spikes */}
          <polygon points="22,16 26,11 29,17" fill="#F59E0B" />
          <polygon points="30,15 35,10 38,17" fill="#F59E0B" />
          <polygon points="39,17 44,13 45,20" fill="#F59E0B" />
          {/* Head */}
          <rect x="15" y="18" width="34" height="31" rx="14" fill="#22C55E" stroke="#15803D" strokeWidth="2.2" />
          <ellipse cx="32" cy="43" rx="12" ry="6" fill="#BBF7D0" />
          <circle cx="24" cy="30" r="3" fill="#0F172A" />
          <circle cx="40" cy="30" r="3" fill="#0F172A" />
          <circle cx="23.2" cy="29.2" r="1" fill="#FFFFFF" />
          <circle cx="39.2" cy="29.2" r="1" fill="#FFFFFF" />
          <path d="M26 38 Q32 43 38 38" fill="none" stroke="#14532D" strokeWidth="2.4" strokeLinecap="round" />
        </svg>
      );

    case "cosmic-slime":
      return (
        <svg viewBox="0 0 64 64" className="h-full w-full" aria-hidden="true">
          <path
            d="M14 44 C14 26 22 18 32 18 C42 18 50 26 50 44 C50 50 44 52 32 52 C20 52 14 50 14 44 Z"
            fill="#38BDF8"
            stroke="#0369A1"
            strokeWidth="2.2"
          />
          <ellipse cx="25" cy="25" rx="4" ry="2.2" fill="#E0F2FE" transform="rotate(-20 25 25)" />
          <circle cx="25" cy="36" r="2.8" fill="#0F172A" />
          <circle cx="39" cy="36" r="2.8" fill="#0F172A" />
          <path d="M28 41 Q32 45 36 41" fill="none" stroke="#0C4A6E" strokeWidth="2.2" strokeLinecap="round" />
          {/* Sparkle */}
          <path d="M47 16 L48.5 20 L52.5 21.5 L48.5 23 L47 27 L45.5 23 L41.5 21.5 L45.5 20 Z" fill="#FDE047" />
        </svg>
      );

    case "gamer-cat":
    default:
      return (
        <svg viewBox="0 0 64 64" className="h-full w-full" aria-hidden="true">
          {/* Headset band */}
          <path d="M13 34 A19 19 0 0 1 51 34" fill="none" stroke="#E11D48" strokeWidth="4" strokeLinecap="round" />
          {/* Cat ears */}
          <polygon points="18,27 20,14 29,22" fill="#FFFFFF" stroke="#334155" strokeWidth="2.2" strokeLinejoin="round" />
          <polygon points="46,27 44,14 35,22" fill="#FFFFFF" stroke="#334155" strokeWidth="2.2" strokeLinejoin="round" />
          <polygon points="20,24 21,18 26,22" fill="#FDA4AF" />
          <polygon points="44,24 43,18 38,22" fill="#FDA4AF" />
          {/* Cat head */}
          <ellipse cx="32" cy="37" rx="17" ry="15" fill="#FFFFFF" stroke="#334155" strokeWidth="2.2" />
          {/* Earcups */}
          <rect x="10" y="30" width="7" height="13" rx="3.5" fill="#E11D48" stroke="#881337" strokeWidth="1.8" />
          <rect x="47" y="30" width="7" height="13" rx="3.5" fill="#E11D48" stroke="#881337" strokeWidth="1.8" />
          {/* Eyes */}
          <circle cx="25" cy="35" r="2.8" fill="#0F172A" />
          <circle cx="39" cy="35" r="2.8" fill="#0F172A" />
          <circle cx="24.2" cy="34.2" r="1" fill="#FFFFFF" />
          <circle cx="38.2" cy="34.2" r="1" fill="#FFFFFF" />
          {/* Whiskers & cute cat mouth */}
          <polygon points="32,38 29.8,40.8 34.2,40.8" fill="#FB7185" />
          <path d="M27.5 43 Q30 45.5 32 42.5 Q34 45.5 36.5 43" fill="none" stroke="#334155" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      );
  }
}

export function AvatarDisplay({
  avatarId,
  avatarBg,
  size = "md",
  className = "",
  title,
}: AvatarDisplayProps) {
  const safeId = avatarId || DEFAULT_AVATAR_ID;
  const safeBg = avatarBg || DEFAULT_AVATAR_BG;

  const ringClass =
    size === "xs" || size === "sm"
      ? "ring-1 ring-black/10 dark:ring-white/15"
      : "ring-2 ring-white/85 dark:ring-slate-800";

  return (
    <span
      title={title}
      style={{ backgroundColor: safeBg }}
      className={`inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full shadow-2xs ${ringClass} ${SIZE_CLASSES[size]} ${className}`}
    >
      {renderCuteSvg(safeId)}
    </span>
  );
}
