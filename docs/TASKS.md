# Tableau de suivi multi-agents — Project Hub (`TASKS.md`)

> **Statuts autorisés :** `À faire` | `En cours` | `Terminé` | `Bloqué`  
> **Source :** Audit V2 Extrême (7 experts : `01-architect`, `02-ui-ux`, `03-backend`, `04-frontend`, `05-qa-tester`, `06-seo-copy`, `07-agency-product`).  
> **Convention :** Exécuter les vagues dans l'ordre (`Vague 0` → `Vague 1` → `Vague 2` → `Vague 3`).

---

## Vague 0 — Urgences Production & Sécurité Critique (P0 Immédiats)

| ID | Agent | Tâche | Dépendances | Statut | Critère d'acceptation |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `FE-1` | `04-frontend` | Corriger le 404 de complétion 1-clic tâche sur le Cockpit (`UpcomingTasksCard.tsx:49` → `PATCH /retroplanning` + rollback `prevTasks`) | Aucune | `À faire` | Cocher une tâche sur `/` renvoie HTTP 200 et persiste après reload |
| `BE-5` | `03-backend` | Éliminer crashs Vercel `EROFS` (`influence-service.ts:273`, `crypto.ts:28`) et pertes `/tmp` Devis & Vigilance (valider PDF avant `quote.create`, stockage durable) | Aucune | `À faire` | 0 écriture `process.cwd()/.data` ; upload Influence et preview Devis fonctionnent sur Vercel après cold start |
| `BE-4` | `03-backend` | Corriger faille LFI `STAGED:` (`vigilance/route.ts:42`, `validate.ts:560`, `invoices/[id]/route.ts:176`), IDOR `budgetLineId`/`quoteId` cross-projet & CRLF MIME Gmail (`gmail.ts:199`) | Aucune | `À faire` | Rejet 400 si `driveFileId` contient `STAGED:`/`..` ; test IDOR cross-projet → 400 ; headers Gmail nettoyés |
| `BE-6` | `03-backend` | Stopper l'explosion 4.5 Mo Vercel & OOM Backups : stripper `pdfBase64` des réponses `GET/POST/PATCH /invoices` et de `BackupSnapshot` (`ingest.ts`, `backup-service.ts`) | Aucune | `À faire` | `GET /invoices` < 100 Ko avec 20 factures ; `createBackupSnapshot` exclut `pdfBase64` |
| `BE-1` | `03-backend` | Fermer le fail-open Auth (`session.ts:198,218`), vérifier expiration `iat`, bloquer usurpation email `POST /auth/session` & `PATCH /profile`, filtrer domaines OAuth `GO`/`L'Intrus` | Aucune | `À faire` | Sans cookie → 401 sur routes privées ; `EDITOR` a `canManageMembers: false` |
| `BE-2` | `03-backend` | Verrouiller en `requireAdmin` (fail-closed) : `/api/admin/*`, `/api/settings`, `/api/integrations/krisp/config`, `PUT /api/templates`, `/api/projects/bootstrap-sandbox` | `BE-1` | `À faire` | Anonyme → 401, non-Admin → 403 ; secret Krisp jamais exposé à un non-Admin |
| `BE-3` | `03-backend` | Ajouter `requireCurrentUser` + `assertProjectAccess` sur les 24 routes `/api/projects/[id]/**` non protégées (Drive, Calendar, Meetings, Reporting, Retro, Talents, Scan-Gmail) et rendre `email-preview` read-only | `BE-1` | `À faire` | 100 % des routes `/api/projects/[id]/*` testées sans session → 401, mauvais projet → 403 |
| `FE-3` | `04-frontend` | Corriger les fuites d'état inter-projets (`WeeklysWorkspace`, `ReportingDashboard`, `RetroplanningWorkspace`, `BudgetDashboardClient`) + `AbortController` + `key={projectId}` | Aucune | `À faire` | Switch projet A→B vide `nextSteps`, `reportingSheetId`, `slidesFileId`, `retroSheetId`, `quotes` |
| `QA-6` | `05-qa-tester` | Corriger bugs Timezone/Dates (tâches dues aujourd'hui « en retard » à 13h Paris), création projet `isSandbox` sur `/projects`, budget 100 % / 0 € et devis comptant factures bloquées | Aucune | `À faire` | Tâche due aujourd'hui à 15h Paris ≠ en retard ; création projet en mode sandbox → 201 ; tests verts |
| `QA-5` | `05-qa-tester` | Durcir uploads contre bombes Zlib (`maxOutputLength` sur `pdf-text.ts:215` et `influence-service.ts:95`) + limites de taille 4 Mo + magic bytes `.xlsx` | Aucune | `À faire` | Test bombe FlateDecode/zTXt rejetée sans OOM ; fichier > 4 Mo rejeté proprement en 413 |

---

## Vague 1 — Architecture Multi-Agences (`GO` / `L'Intrus`), Isolation & Socle Tests (P0/P1)

| ID | Agent | Tâche | Dépendances | Statut | Critère d'acceptation |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `ARCH-4` | `01-architect` | Modéliser `AgencyEntity` (`GAMERSORIGIN` / `LINTRUS`) dans `prisma/schema.prisma` (routage Pennylane, CC, Shared Drive, templates) + FK `Project.entityId` | Aucune | `À faire` | Projet L'Intrus route vers config L'Intrus ; zéro ID Drive client hardcodé dans `sandbox-guard.ts` |
| `SEO-1` | `06-seo-copy` | Dé-hardcoder « GamersOrigin / Interne GO » dans `weekly-service.ts`, `krisp-service.ts`, `project-templates.ts`, `layout.tsx`, `AppShell.tsx`, `page.tsx`, `projects/page.tsx` | `ARCH-4` | `À faire` | Un Weekly/CR Krisp/CSV L'Intrus ne mentionne jamais « GamersOrigin » |
| `ARCH-2` | `01-architect` | Migrer le stockage binaire temporaire/durable (PDFs factures/devis, vigilance, captures Influence, archives backups) vers Vercel Blob privé / Drive + colonne indexée `Invoice.supplierInvoiceNumber` | `BE-5`, `BE-6` | `À faire` | 0 binaire en base64 dans Postgres ; previews 100 % stables entre cold starts |
| `ARCH-3` | `01-architect` | Isoler `GoogleConnection` par `userId` (+ compte service par entité) et remplacer le refresh in-memory/fire-and-forget par un verrou advisory Postgres `await`é | `BE-1` | `À faire` | 2 utilisateurs simultanés créent chacun leurs brouillons dans leur propre Gmail |
| `ARCH-5` | `01-architect` | Supprimer `AppSetting("ACTIVE_PROJECT_ID")` (passer à `User.lastActiveProjectId` + cookie), isoler `Notification` par utilisateur (`NotificationRead`), empêcher le fallback Krisp aléatoire, ajouter verrous atomiques (`VALIDATING`, `APPLYING`, `nextInvoiceSeq`, `WeeklyReport` idempotence) | `BE-1` | `À faire` | 2 validations concurrentes = exactement 1 cumul HT + 1 brouillon Gmail ; cloche isolée par user |
| `BE-7` | `03-backend` | Filtrer les factures privées dans `quotes/route.ts` et `projects/route.ts` via `buildVisibleInvoicesWhere`, ne pas écraser `user.name` lors du partage membre | `BE-1` | `À faire` | User B ne voit jamais les factures en attente de User A ni dans `/quotes` ni dans `/projects` |
| `BE-8` | `03-backend` | Atomiser dans `prisma.$transaction` : `validate.ts` (relecture `budgetLine FOR UPDATE` + fix `cc: finalCc`), `retro-service.ts` (`syncSheetToDb`, `updateRetroTask` optimiste SQL), `proposal-service.ts`, `quotes POST`, `backup-service.ts` | `ARCH-5` | `À faire` | Zéro lost update en concurrence ; bloquer `DELETE /invoices/[id]` si `stepSheetDone \|\| stepDriveDone` |
| `BE-9` | `03-backend` | Durcir `toErrorResponse` (mapping Prisma `P2002/P2025/P2003`, `console.error` prod, masquer internals 500) + `actor: currentUser.email` sur tous les `AuditLog` | `BE-1` | `À faire` | 0 fuite SQL/stack en 500 prod ; 100 % des audit logs nominatifs |
| `ARCH-6` | `01-architect` | Initialiser `prisma/migrations/` + `directUrl`, remplacer `db push` au build par `migrate deploy`, ajouter index composites manquants (`AuditLog(createdAt)`, `Invoice(gmailMessageId)`, `User(role)`, `MeetingNote` unique, `FortniteMetric` unique) | `ARCH-4`, `ARCH-5` | `À faire` | Build Vercel propre avec migrations versionnées ; EXPLAIN sur AuditLog utilise l'index |
| `QA-1` | `05-qa-tester` | Réparer les 12 suites Vitest cassées (PostgreSQL test helper cross-OS sans `npx.cmd` ni `file:`) + réaligner `m2-invoice-validation.test.ts` | `BE-8` | `À faire` | 100 % des tests unitaires Vitest verts sous Windows & Linux |
| `FE-2` | `04-frontend` | Introduire `ShellContext` dans `AppShell` et supprimer la tempête `go:shell-refresh` (8 pages + mutations) | Aucune | `À faire` | Validation facture : 11 → ≤ 2 req HTTP ; Drive status : 7 → 1 req sans flash |

---

## Vague 2 — Expérience Pennylane / PayFit / Asana & Super-Pouvoirs Gain de Temps (P1)

| ID | Agent | Tâche | Dépendances | Statut | Critère d'acceptation |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `UI-1` | `02-ui-ux` | Unifier les tokens CSS (`globals.css`), Primaire `Indigo` vs Danger `Red/Rose`, corriger les 413 `text-slate-400` WCAG AA, échelle `z-index`, `focus-visible` partout, `prefers-color-scheme` & `reduced-motion` | Aucune | `À faire` | 100 % des textes ≥ 4.5:1 ; aucun bouton primaire en rouge danger |
| `UI-2` | `02-ui-ux` | Créer socle `src/components/ui/*` (`Button`, `IconButton`, `Badge`, `FormField`, `Input`, `Select`, `Card`, `EmptyState`, `Skeleton`, `Modal` v2 avec focus trap + scroll lock + `Escape`) | `UI-1` | `À faire` | Tous les états `default/hover/focus-visible/disabled/loading/error` validés |
| `FE-4` | `04-frontend` | Migrer les 5 modales (`ProjectShareModal`, `drive`, `QuotesPanel`, `GanttBoard`, `CockpitInvoiceDropzone`) et 2 dropdowns sur `<Modal>` v2 + révoquer `URL.createObjectURL` au unmount | `UI-2` | `À faire` | 100 % des modales ferment sur `Esc` et backdrop sans fuite mémoire |
| `UI-3` | `02-ui-ux` | Corriger les 4 bugs critiques mobile 390px (`NotificationBell` popover, `ToastContainer`, puce projet topbar mobile, cibles tactiles ≥ 44px) | `UI-1` | `À faire` | 0 scroll horizontal à 390px sur toutes les pages |
| `PROD-1` | `03-backend` + `04-frontend` | **Super-Pouvoir #1 (Asana) :** Ajouter `RetroTask.ownerUserId` + vue transverse **« Mes Tâches »** (`/my-tasks`) multi-projets (Retard / Aujourd'hui / Semaine / Attente client) avec coche 1 clic + report `+1j / +1 sem` | `ARCH-6` | `À faire` | Un CP voit et traite toutes ses tâches multi-projets en < 15s sans switcher de projet |
| `PROD-2` | `03-backend` + `04-frontend` | **Super-Pouvoir #2 (Pennylane) :** Fusionner les 2 pipelines factures en 1 seule `InvoiceVerificationModal` HT-only (navigation lot `← 1/4 →`, `⌘↵`, comparaison devis, onglets PDF/Form mobile) + **OCR Gemini sur Devis** + auto-match Devis↔Facture | `UI-2`, `FE-4` | `À faire` | 1 seul flux comptable identique depuis Cockpit et Budget ; devis pré-remplis par IA |
| `PROD-3` | `03-backend` + `04-frontend` | **Super-Pouvoir #3 (Pennylane) :** Intégrer les devis `ACCEPTE` dans la marge à terminaison (`max(Prévu, Engagé Devis, Facturé)`) + colonne « Engagé » dans `BudgetTable` + alerte **Factures Manquantes (FNP)** | Aucune | `À faire` | Un devis accepté supérieur au prévu déclenche immédiatement l'alerte marge |
| `PROD-4` | `03-backend` + `04-frontend` | **Super-Pouvoir #4 (Asana + IA) :** Persister les actions Krisp déjà converties (`convertedActionIndexesJson`), permettre édition phase/owner avant import, et bouton **« Pré-remplir Weekly par IA (Planning + CR Krisp + N-1) »** | `ARCH-6`, `SEO-1` | `À faire` | Zéro doublon après reload sur Krisp ; Weekly pré-rempli en 1 clic < 2 min |
| `FE-5` | `04-frontend` | Mises à jour optimistes Asana-grade sur Planning (checkbox, Kanban D&D sans flicker `onDragLeave`, dates) + Budget inline (consommer le payload `POST /budget` sans refetch) + Drive statut + Toast **Undo 5s** (`UI-5`) | `FE-2` | `À faire` | Latence perçue < 16ms ; annulation possible en 1 clic sur complétion tâche |
| `FE-6` | `04-frontend` | Corriger faux toasts verts (`useTemplatesApi.ts`), blocage double-clics (`QuotesPanel`, `ProjectShareModal`, `projects`, `profile`, `ReportingDashboard`), supprimer `window.confirm`, corriger template apply si save échoue | `UI-2` | `À faire` | Zéro toast erreur vert ; zéro double soumission ; confirmation inline sur suppressions |
| `FE-7` | `04-frontend` | Optimiser le rendu : éliminer le `O(N²)` dans `InvoicePipelinePanel`, isoler `<InlineMoneyCell>` + `React.memo` dans `BudgetTable`, singleton `Intl.DateTimeFormat` et cap Timeline > 16 sem dans `GanttBoard` | Aucune | `À faire` | 60 FPS à la saisie sur 100 lignes budget et 60 factures |
| `FE-8` / `QA-7` | `04-frontend` + `05-qa-tester` | Créer `error.tsx`, `global-error.tsx`, `loading.tsx`, `not-found.tsx`, wrapper `fetchJsonSafe` (gérer 413/502/504 HTML), `beforeunload` dirty guard, `BroadcastChannel` multi-onglets, lazy-load onglets `/team`, supprimer flash « Non connecté » `/settings` | `UI-2` | `À faire` | 0 écran blanc sur erreur ; 0 unhandled rejection sur 504 ; synchro multi-onglets OK |
| `UI-6` / `UI-7` | `02-ui-ux` + `04-frontend` | `ProjectSwitcherCombobox` recherchable (badge `GO`/`L'Intrus` + santé, utilisable sidebar repliée) + `CommandPalette` 100 % clavier (`⌘K` Mac / `Ctrl K` Win, recherche entités, raccourcis `G C/R/B/P`) + sidebar unifiée (retirer doublon `/profile`) | `UI-2`, `ARCH-4` | `À faire` | Switch projet < 2s à 30+ projets ; 100 % des items palette accessibles au clavier |
| `SEO-2`..`SEO-6` | `06-seo-copy` | Titres d'onglets uniques sur les 12 pages, désambiguïser `CP` (Code Projet vs Chef de projet), supprimer jargon IT (`PROD protégé`, `Vercel Schedule`, `provisionnés`, `Pilote Caisse d'Épargne`), pluralisation propre, `aria-label` + `<label htmlFor>` + `aria-current="page"` partout | `SEO-1` | `À faire` | 12 onglets distincts ; 0 bouton icône sans `aria-label` ; 0 collision `CP` |

---

## Vague 3 — Scale Direction, Nettoyage 6 Mois & Finitions (P2)

| ID | Agent | Tâche | Dépendances | Statut | Critère d'acceptation |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `ARCH-7` | `01-architect` | Agrégations SQL & pagination sur `GET /api/projects`, concurrence bornée (`p-limit(5)`) sur syncs Drive/Influence, exclusion `isArchived: true` des crons & déclaration `vercel.json` | `ARCH-6` | `À faire` | `GET /api/projects` < 150ms à 100 projets ; zéro timeout Vercel |
| `ARCH-8` / `BE-10` | `01-architect` + `03-backend` | Extraire services `portfolio-service.ts` et `quote-service.ts`, supprimer exports non-HTTP des `route.ts`, Zod strict partout, backups complets (toutes tables) + `maxDuration = 60` | `ARCH-2`, `BE-8` | `À faire` | 100 % conformité Next.js Route Handlers ; backups complets & testés |
| `PROD-5` | `03-backend` + `04-frontend` | **Super-Pouvoir #5 (Pennylane/PayFit) :** Répertoire `Vendor` agence + Coffre Attestations URSSAF (validité 6 mois) auto-jointes sur factures > 3 000 € HT | `ARCH-2` | `À faire` | Une attestation valide < 6 mois est automatiquement rattachée aux factures du prestataire |
| `PROD-6` | `03-backend` + `04-frontend` | **Super-Pouvoir #6 :** Wizard création projet 30s (`GO`/`L'Intrus`, catégorie `PROD_CREA`, templates rétro spécifiques par métier, dates clés, équipe & talents, option « Cloner un projet passé ») | `ARCH-4` | `À faire` | Nouveau projet prêt à travailler en 1 écran < 45s |
| `PROD-7` | `03-backend` + `04-frontend` | **Super-Pouvoir #7 (Direction) :** Filtres `/projects` par Entité / CP / Client / Trimestre + onglet **Charge Équipe** sur `/team` + recalibrage santé (ne pas passer en `VIGILANCE` pour une facture déposée il y a 10 min) | `ARCH-4`, `PROD-1` | `À faire` | Vue Direction consolidée GO vs L'Intrus + charge par CP en 1 clic |
| `PROD-8` / `PROD-9` | `03-backend` + `04-frontend` | **Super-Pouvoirs #8 & #9 :** Rétroplanning « Rétro-calcul depuis date lancement » & « Décaler à partir de cette tâche (hors terminées) » + Pointage express jours RH Internes (`+0,5j / +1j`) | `FE-5` | `À faire` | Décalage sélectif sans toucher aux tâches finies ; marge nette intégrant les RH internes |
| `UI-8`..`UI-10` / `FE-9`..`FE-10` | `02-ui-ux` + `04-frontend` | Grille Cockpit symétrique (`max-w-7xl`, 0 trou orphelin), `NotificationBell` visibilité-aware + ligne cliquable, recherche/filtres à l'échelle (Devis/Factures/Reporting/Meetings/Drive « À publier » par défaut), supprimer `setState` en render + cap 3 visuels Weekly, masquer outils QA en prod, fusionner `/calendar` règles dans `/retroplanning` | `UI-2`, `FE-4` | `À faire` | Interface zéro bruit post-6 mois ; recherche fluide sur 50+ éléments |
| `QA-8` | `05-qa-tester` | Suite E2E Playwright autonome (`tests/e2e/smoke-critical-flows.spec.ts`) sans `/api/test-harness/*` fantômes couvrant les 5 parcours critiques M5–M9 | `QA-1`, `FE-8` | `À faire` | `npm run test:e2e` passe en vert en CI desktop (1440px) & mobile (390px) |

---

## Journal de passation (3 à 5 lignes max par tâche)
- **2026-11-26 — Initialisation Audit V2 :** Déploiement des 7 fichiers `.agent/` + audit complet par 7 experts (`01-architect`, `02-ui-ux`, `03-backend`, `04-frontend`, `05-qa-tester`, `06-seo-copy`, `07-agency-product`). Rédaction des 4 documents de référence (`SPEC.md`, `ARCHITECTURE.md`, `DESIGN_SYSTEM.md`, `TASKS.md`) et du rapport exécutif `audit_v2_ultra_report.md`. En attente de validation humaine sur les vagues à lancer.

---

## Bugs & Escalades (Règle des 2 échecs)
*(Aucune escalade en cours.)*
