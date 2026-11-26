# Plan d'Exécution & Suivi des Tâches — Project Hub V2

> Statut global : **Vagues 0, 1, 2 et 3 terminées et déployées sur `main`**.

## Vague 0 — Bugs P0, Sécurité & Stockage 100 % Postgres/Drive (`Terminé`)
- [x] `QA-1` : Correction 404 + rollback + toast Annuler 5s + ajout rapide inline sur `UpcomingTasksCard.tsx`
- [x] `QA-2` : Suppression `EROFS` Vercel dans `influence-service.ts`, `crypto.ts` (`CryptoKeyError`), `ingest.ts` & `quotes/route.ts` (stockage Google Drive + Postgres `Bytes?`, purge post-validation)
- [x] `BE-5` / `BE-6` / `QA-4` : Verrou atomique `VALIDATING` anti double-brouillon Gmail, `Project.nextInvoiceSeq`, suppression LFI `STAGED:`, validation magic bytes `.xlsx` & PDF, cap Zlib bomb, assainissement CRLF Gmail, `email-preview` read-only
- [x] `QA-3` / `QA-6` : Timezone `Europe/Paris` unifiée (`src/lib/shared/dates.ts`), isolement d'état cross-projet (`WeeklysWorkspace`, `ReportingDashboard`, `RetroplanningWorkspace`, `BudgetDashboardClient`), correction toasts verts d'erreur
- [x] `FE-3` : Boundaries Next.js (`error.tsx`, `global-error.tsx`, `loading.tsx`, `not-found.tsx`)

## Vague 1 — Auth Google Workspace, Isolation Multi-Utilisateurs & Hub Neutre (`Terminé`)
- [x] `BE-1` / `BE-2` : Auth Google Workspace obligatoire en production (`@gamersorigin.com`, `@lintrus.fr`, `@lintrus.com` + env allowlist), `GoogleConnection.userId` par utilisateur (chaque utilisateur reçoit ses brouillons dans SON Gmail), gestion `invalid_grant` (`412 GOOGLE_TOKEN_EXPIRED`)
- [x] `BE-3` / `BE-7` : `assertProjectAccess` sur 100 % des routes `/api/projects/[id]/*`, `requireAdminOrBootstrap` sur routes admin/settings/templates, `NotificationRead` par utilisateur, `User.lastActiveProjectId` (suppression `AppSetting("ACTIVE_PROJECT_ID")`)
- [x] `SEO-1` / `FE-2` : Branding neutre `"Project Hub"` (GamersOrigin & L'Intrus), `ShellContext` + `BroadcastChannel("project-hub-sync")`

## Vague 2 — Super-Pouvoirs Pennylane / PayFit / Asana & Design System Indigo (`Terminé`)
- [x] `UI-1` / `UI-2` / `UI-3` : Design System Indigo primaire (`#4F46E5`), rouge réservé aux erreurs/retards, `<Modal>` v2 (focus trap, scroll lock, Esc), `NotificationBell` mobile 390px + pause onglet inactif, `ProjectSwitcherCombobox` searchable, `CommandPalette` 100 % clavier, titres `<title>` uniques sur les 12 routes
- [x] `PROD-1` : Page `/my-tasks` (« Mes Tâches » multi-projets) + `ownerUserId` + complétion optimiste 1 clic avec Undo 5s + snooze `+1j` / `+1 sem`
- [x] `PROD-2` / `PROD-3` : Modal Pennylane 2 étapes enrichi (navigation lot `← 1/4 →`, `⌘↵`, onglets mobile PDF/Vérif, badge écart devis, `beforeunload`, `URL.revokeObjectURL`) + **OCR PDF Devis** (`/api/projects/[id]/quotes/extract`) + recherche/filtres devis sans `window.confirm`
- [x] `PROD-4` : Marge atterrissage avec **Engagé (Devis acceptés)** (`max(Prévu, Engagé, Facturé)`) + **Radar Factures Manquantes (FNP)**
- [x] `PROD-5` : Pont IA 1-clic **Krisp → Tâches (index persistés `convertedActionIndexesJson`) + Import express 1 champ → Weekly Client** (pré-remplissage Planning + CR Krisp, cap 3 visuels)

## Vague 3 — Wizard 30s, Agenda Agence, Charge Direction & Coffre URSSAF (`Terminé`)
- [x] `PROD-6` : Catégorie `PROD_CREA` (« Prod Créa & Vidéo ») + Wizard projet 30s avec **Clonage d'un projet existant** + dates Kick-off / Lancement auto-planifiant le rétroplanning + masquage des outils pilote hors sandbox
- [x] `PROD-7` : Décalage rétroplanning intelligent (`fromTaskId`, `excludeDone`, `retroFromLaunchDate` hors week-ends) + **Agenda Agence Multi-Projets** (`/api/calendar/global` dans `/calendar`)
- [x] `PROD-8` : Onglets **Charge Équipe** (`/api/team/workload`) et **Coffre Prestataires URSSAF 6 mois** (`/api/vendors`) dans `/team` + bandeau `"Modèle global agence"` sur les 3 éditeurs de modèles vierges
- [x] `QA-7` : Suite de tests unitaires V2 (`tests/unit/m10-audit-v2-hardening.test.ts`), validation `tsc`, `eslint`, `vitest`, `next build` et vérification live Vercel
