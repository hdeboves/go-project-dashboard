# Design System — Project Hub (`GamersOrigin` & `L'Intrus`)

> **Statut :** `Audit V2 Consolidé (Standard Pennylane / PayFit / Asana)`  
> **Dernière mise à jour :** 2026-11-26  
> **Accessibilité cible :** WCAG 2.1 AA strict (≥ 4.5:1 texte normal, ≥ 3.0:1 texte large & UI, focus clavier visible partout, cibles tactiles ≥ 44px sur mobile).

---

## 1. Direction visuelle & Principes ergonomiques
- **Ton & style :** Outil SaaS de production & finance rapide, dense mais aéré, neutre et lisible 8 heures par jour — à l'intersection de **Pennylane** (rigueur financière, tableaux tabulaires, split-screen PDF), **PayFit** (clarté absolue, micro-copy pédagogique zéro jargon, états vides guidés) et **Asana** (vitesse au clavier, complétion 1 clic avec Undo, actions inline sans changement d'écran).
- **Règle d'or chromatique (fin de la guerre Rose vs Indigo vs Sky) :**
  - **1 seule couleur d'action primaire :** **Indigo** (`#4F46E5` clair / `#6366F1` sombre) pour les CTA principaux, liens, états actifs de navigation et anneaux de focus.
  - **Le Rouge / Rose est exclusivement sémantique Danger** (erreurs, retards, dépassements budgétaires, suppressions) — jamais pour un bouton « Valider » !
  - **Identité bi-agence dissociée :** badge **GamersOrigin** en Rose Marque (`#E11D48`), badge **L'Intrus** en Violet (`#7C3AED`) ou Ardoise contrastée.

---

## 2. Tokens de couleurs (`src/app/globals.css` → `@theme inline`)

| Token CSS | Mode Clair | Mode Sombre | Contraste AA vérifié | Usage strict |
| :--- | :--- | :--- | :--- | :--- |
| `--color-bg` | `#F8FAFC` | `#0B0F17` | — | Fond global de l'application |
| `--color-surface` | `#FFFFFF` | `#111827` | — | Cartes, tableaux, modales, topbar, sidebar |
| `--color-surface-subtle` | `#F1F5F9` | `#1E293B` | — | Fonds de champs, survols légers, en-têtes tableaux |
| `--color-border` | `#E2E8F0` | `#1F2937` | — | Bordures 1px de cartes et séparateurs |
| `--color-text-primary` | `#0F172A` | `#F8FAFC` | **17.8:1 / 17.5:1** | Titres, valeurs clés, libellés principaux |
| `--color-text-secondary` | `#475569` | `#CBD5E1` | **7.5:1 / 11.4:1** | Sous-titres, descriptions, labels de formulaires |
| `--color-text-muted` | `#64748B` | `#94A3B8` | **4.76:1 / 6.92:1 (PASS AA)** | Métadonnées, dates, hints *(remplace les 413 `text-slate-400` en échec à 2.56:1)* |
| `--color-primary` | `#4F46E5` | `#6366F1` | **6.29:1 (clair)** | CTA primaires, focus ring, liens actifs |
| `--color-primary-hover` | `#4338CA` | `#818CF8` | — | Survol CTA primaire |
| `--color-brand-go` | `#E11D48` | `#FB7185` | **4.70:1** | Exclusivement logotype & badge entité GamersOrigin |
| `--color-brand-intrus` | `#7C3AED` | `#A78BFA` | **5.70:1** | Exclusivement badge entité L'Intrus |
| `--color-success` | `#047857` (texte) / `#10B981` (fill) | `#34D399` | **5.48:1** | Validé, dans le budget, marge saine |
| `--color-warning` | `#B45309` (texte) / `#F59E0B` (fill) | `#FBBF24` | **5.02:1** | Vigilance 90%, attestation URSSAF requise, multi-CP |
| `--color-danger` | `#DC2626` | `#F87171` | **4.83:1** | Erreurs, retards, dépassements > 100%, suppressions |

---

## 3. Typographie, Espacements, Rayons & Z-Index
- **Polices :** `Plus Jakarta Sans` (interface & titres) + `JetBrains Mono` avec `tabular-nums` obligatoire sur **tous** les montants, pourcentages, compteurs et codes projet.
- **Échelle typographique (zéro texte critique sous `11px`) :**
  - `H1` page : `text-2xl font-bold tracking-tight` (`24px`, unique par page)
  - `H2` section : `text-sm font-bold` (`14px`) ou `text-base font-semibold` (`16px`)
  - Corps & tableaux : `text-xs` (`12px`) à `text-sm` (`14px`)
  - Métadonnées / badges : `text-[11px]` minimum (supprimer les `text-[10px]` pour tout texte informatif)
- **Rayons normés :**
  - Boutons, inputs, selects, menus : `rounded-lg` (`8px`)
  - Cartes, sections, modales : `rounded-2xl` (`16px`)
  - Badges / pills : `rounded-full`
- **Largeurs de conteneur :**
  - Cockpit & formulaires : `max-w-7xl` (`1280px`)
  - Vues denses (Budget, Rétroplanning Gantt, Portefeuille Projets) : `max-w-[1600px]`
- **Échelle Z-Index (anti-collision modale / toast / popover) :**
  - `z-20` : En-têtes sticky tableaux/Gantt
  - `z-30` : Topbar
  - `z-40` : Drawer sidebar mobile
  - `z-50` : Popovers & Dropdowns (Cloche notifications, Switcher projet)
  - `z-60` : Modales (`Modal` v2, Command Palette, Visionneuse Factures)
  - `z-70` : `ToastContainer` (toujours au-dessus des modales)
- **Focus & Motion :**
  - Interdiction de `focus:outline-none` nu → toujours `focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] focus-visible:ring-offset-2`.
  - Respect strict de `@media (prefers-reduced-motion: reduce)` et de `prefers-color-scheme` à la première visite.

---

## 4. Responsive & Mobile Terrain (`390px` vs `1440px`)
- **Popovers droite (`NotificationBell`) :** `fixed inset-x-3 top-14 w-auto sm:absolute sm:inset-x-auto sm:top-full sm:right-0 sm:mt-2 sm:w-96` (zéro débordement hors écran).
- **Toasts (`ToastContainer`) :** `fixed inset-x-4 bottom-4 z-[70] sm:left-auto sm:right-5 sm:bottom-5 sm:w-96`.
- **Contexte projet mobile :** puce compacte `CP XXXX · Client` toujours visible dans la topbar `< sm`.
- **Visionneuse facture `< lg` :** onglets segmentés `[ Aperçu PDF | Vérification ]` au lieu du split vertical écrasé + bouton ouvrir PDF plein écran sur iOS/Android.
- **Cibles tactiles :** zone cliquable minimale `32×32px` desktop / `44×44px` sur écrans tactiles (`p-2 -m-2` sur checkboxes et pastilles).

---

## 5. Composants atomiques requis (`src/components/ui/*`)
- [ ] `Button.tsx` (`primary`, `secondary`, `ghost`, `danger`, `danger-subtle` ; tailles `sm | md | lg` ; `loading` + `aria-busy`)
- [ ] `IconButton.tsx` (`aria-label` obligatoire dans le type TS, cible tactile ≥ 36px/44px)
- [ ] `Badge.tsx` (`neutral | primary | success | warning | danger | brand-go | brand-intrus`)
- [ ] `FormField.tsx`, `Input.tsx`, `Select.tsx`, `Textarea.tsx` (liaison `htmlFor`/`id` auto, état `error` + `aria-invalid`)
- [ ] `Card.tsx` (surface unifiée + `EmptyState.tsx` actionnable + `Skeleton.tsx`)
- [x] `Modal.tsx` *(à durcir en `UI-2` : `role="dialog"` sur le panel interne, focus trap, restauration du focus, scroll lock, `Escape`, tailles `sm..full`)*
- [x] `PdfPreviewModal.tsx` *(à durcir en `UI-10` : skeleton `onLoad`, bouton Télécharger, fallback mobile)*
- [ ] `ConfirmDialog.tsx` / confirmation inline (remplacer tout `window.confirm()` et toute suppression 1-clic non protégée)
- [ ] `Combobox.tsx` (Switcher projet multi-agences + partage membres)
- [ ] `ToastContainer.tsx` v2 (support `action: { label: "Annuler", onClick }`, pause au hover, `role="alert"` sur erreurs, cleanup timers)
