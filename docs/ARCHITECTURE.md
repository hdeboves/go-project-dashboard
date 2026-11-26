# Architecture Technique — Project Hub (`GamersOrigin` & `L'Intrus`)

> **Statut :** `Audit V2 Consolidé (Architecture actuelle + Cible durcie Vercel / PostgreSQL)`  
> **Dernière mise à jour :** 2026-11-26

---

## 1. Stack technique
- **Framework :** Next.js `16.4.6` (App Router, Turbopack) + React `19.3.1` + TypeScript `5.9`
- **Styling :** Tailwind CSS v4 (`@tailwindcss/postcss`), icônes `lucide-react`
- **Base de données / ORM :** PostgreSQL (Neon / managé) + Prisma `6.19.3`
- **Validation :** Zod `4.3.6`
- **Intégrations :** Google Workspace (`googleapis` — Drive, Sheets, Slides, Gmail, Calendar), Gemini `2.5-flash` (`@google/genai`), extraction PDF locale (`unpdf`), Excel (`exceljs`), Krisp Webhook, Vercel Schedules (`@vercel/schedules`)
- **Stockage fichiers cible (Vague 1) :** Vercel Blob privé / Google Drive (zéro écriture durable sur disque local ou `/tmp`, zéro `pdfBase64` en colonne `TEXT` Postgres)
- **Tests :** Vitest `5.1.1` (unitaires + intégration PostgreSQL) & Playwright `1.65.1` (E2E)
- **Déploiement :** Vercel Serverless (auto-deploy sur `main`)

---

## 2. Arborescence du projet
```text
.agent/
  rules/global-rules.md         # Règles verrouillage périmètres & protocole 2 échecs
  workflows/01-architect.md..06-seo-copy.md
docs/
  SPEC.md                       # Spécification produit bi-agence GO & L'Intrus
  ARCHITECTURE.md               # Ce document (schéma, contrats API, sécurité)
  DESIGN_SYSTEM.md              # Tokens, WCAG AA, composants UI atomiques
  TASKS.md                      # Backlog atomique multi-agents priorisé
prisma/
  schema.prisma                 # Schéma PostgreSQL (+ migrations/ à initialiser en ARCH-6)
src/
  app/
    page.tsx                    # Cockpit projet (SSR)
    icon.svg                    # Favicon Capybara Zen
    [projects|budget|retroplanning|drive|meetings|calendar|weeklys|reporting|team|profile|settings]/
    api/                        # 59 routes API REST (93 handlers)
  components/
    AppShell.tsx                # Layout + ShellContext (à introduire en FE-2)
    ui/                         # Primitives Design System (Button, Modal, Input, Badge, Card...)
    cockpit/ budget/ retroplanning/ calendar/ meetings/ weeklys/ reporting/ templates/
  lib/
    auth/                       # session.ts, roles.ts (+ guards.ts en ARCH-1)
    budget/ calendar/ drive/ gemini/ google/ invoices/ isolation/ krisp/ reporting/ retroplanning/ shared/ templates/ weeklys/ backup/
tests/
  unit/                         # Tests unitaires Vitest
  e2e/                          # Tests smoke Playwright autonomes (à créer en QA-8)
```

---

## 3. Modèle de données & Évolutions cibles (`prisma/schema.prisma`)

### Modèles existants (21 tables)
- **Identité & config :** `AppSetting`, `GoogleConnection`, `User`, `ProjectMember`, `CategoryTemplate`, `BackupSnapshot`, `AuditLog`, `Notification`
- **Cœur projet :** `Project`, `DriveNode`, `SyncStatus`
- **Finance :** `BudgetLine`, `Quote`, `Invoice` (`uploadedById` présent depuis `c970841`)
- **Planning & com :** `RetroTask`, `RetroProposal`, `RetroSnapshot`, `CalendarRule`, `CalendarEvent`, `MeetingNote`, `WeeklyReport`
- **Reporting :** `ReportingRawFile`, `FortniteMetric`, `InfluenceMetric`, `Verbatim`

### Évolutions critiques identifiées (Audit V2)
1. **Multi-entités (`ARCH-4`) :** ajouter `AgencyEntity` (`GAMERSORIGIN`, `LINTRUS` : domaines email, `pennylaneEmail`, `mandatoryCcJson`, `sharedDriveId`, `apresVenteFolderId`, `prodImmutableIdsJson`) et FK `Project.entityId`.
2. **OAuth isolé (`ARCH-3`) :** lier `GoogleConnection.userId` (FK unique vers `User`) + connexion bot/service explicite par entité pour les jobs background.
3. **États utilisateur isolés (`ARCH-5`, `BE-7`) :**
   - Supprimer `AppSetting("ACTIVE_PROJECT_ID")` → `User.lastActiveProjectId` + cookie HTTP-only.
   - Isoler les notifications par utilisateur (`Notification.userId` ou table `NotificationRead(notificationId, userId)`).
   - Ajouter `Project.nextInvoiceSeq` (compteur atomique pour la numérotation `1..N`), `Invoice.supplierInvoiceNumber` (indexé pour déduplication sans lire `extractedJson`).
   - Ajouter `RetroTask.ownerUserId` (FK vers `User` pour la vue « Mes tâches » multi-projets) et `MeetingNote.convertedActionIndexesJson`.
4. **Stockage binaire durable (`ARCH-2`, `BE-5`, `BE-6`) :** remplacer `pdfBase64` dans `Invoice.extractedJson`, `Quote.localPdfPath`, `ReportingRawFile.localPreviewPath` et `STAGED:/tmp/...` par un `storageKey`/`blobUrl` Vercel Blob privé ou Drive, et stocker les archives gzip de `BackupSnapshot` hors Postgres.
5. **Migrations & Index PostgreSQL (`ARCH-6`) :** configurer `directUrl`, passer à `prisma migrate deploy`, ajouter index sur `AuditLog(createdAt)`, `Invoice(gmailMessageId)`, `Invoice(projectId, invoiceNumber)`, `User(role)`, `MeetingNote(@@unique([projectId, externalId]))`, `FortniteMetric(@@unique([projectId, date]))`, `RetroProposal(retroTaskId)`.

---

## 4. Contrats d'API critiques & Sécurité

### Format d'erreur uniforme (`src/lib/api-error.ts`)
Toutes les routes passent par `toErrorResponse(err)` :
- `400 VALIDATION_ERROR` (Zod) · `401 UNAUTHORIZED` · `403 FORBIDDEN / PROJECT_ACCESS_DENIED / INVOICE_FORBIDDEN` · `404 NOT_FOUND` · `409 CONFLICT / CP_CONFLICT / VALIDATION_IN_PROGRESS` · `412 PRECONDITION_FAILED` (Google/Gemini non configuré ou token expiré) · `413 FILE_TOO_LARGE` · `422 INVALID_PDF_FILE` · `500 INTERNAL_ERROR` (loggé côté serveur via `console.error`, message interne masqué en prod).

### Matrice des principaux endpoints
| Méthode | Endpoint | Garde requise (Cible `ARCH-1`/`BE-1..3`) | Règles clés |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/shell/status` | Session (ou état non-connecté minimal) | Retourne `currentUser`, projets visibles, compteurs scopés par utilisateur |
| `GET/POST` | `/api/projects` | `requireCurrentUser` | `GET` agrégé SQL + paginé ; `POST` assigne `ownerId` + `entityId` |
| `PATCH` | `/api/projects/[id]/archive` | `assertProjectAccess("MANAGE")` | Réservé `OWNER` ou `ADMIN` |
| `GET/POST` | `/api/projects/[id]/invoices` | `VIEW` / `EDIT` | `GET` filtre via `buildVisibleInvoicesWhere` et **strip `pdfBase64`** ; `POST` numérote `1..N` (HT uniquement) avec `uploadedById` |
| `PATCH/DELETE` | `/api/projects/[id]/invoices/[invoiceId]` | `EDIT` + `assertInvoiceOwnerAccess` | Vérifie appartenance `budgetLineId`/`quoteId` ; bloque `DELETE` si `stepDriveDone \|\| stepSheetDone \|\| stepGmailDone` |
| `GET` | `/api/projects/[id]/invoices/[invoiceId]/preview` | `VIEW` + `assertInvoiceOwnerAccess` | Flux binaire `application/pdf` avec nom normalisé |
| `POST` | `/api/projects/[id]/invoices/[invoiceId]/email-preview` | `VIEW` + `assertInvoiceOwnerAccess` | **Strictement read-only** (aucune mutation DB), résout `to`/`cc` depuis `project.entity` |
| `POST` | `/api/projects/[id]/invoices/[invoiceId]/validate` | `EDIT` + `assertInvoiceOwnerAccess` | Verrou atomique `PENDING → VALIDATING`, upload Drive, cumul HT `FOR UPDATE`, 1 brouillon Gmail strict |
| `POST` | `/api/projects/[id]/invoices/[invoiceId]/vigilance` | `EDIT` + `assertInvoiceOwnerAccess` | Validation Zod stricte ; **interdiction totale des chemins `STAGED:` fournis par le client** |
| `GET/POST/PATCH/DELETE` | `/api/projects/[id]/retroplanning` | `VIEW` / `EDIT` | `PATCH` prend `{ id, ... }` (et corriger `UpcomingTasksCard.tsx` qui appelait `/retroplanning/${id}`) |
| `GET/POST/PATCH` | `/api/projects/[id]/quotes` & `[quoteId]` | `VIEW` / `EDIT` | Valider taille + `%PDF-` **avant** `prisma.quote.create` ; filtrer factures liées via `buildVisibleInvoicesWhere` |
| `GET/POST` | `/api/admin/backups`, `/api/admin/audit`, `/api/settings`, `/api/integrations/krisp/config`, `PUT /api/templates` | `requireAdmin` (**fail-closed 401/403**) | Jamais accessibles anonymement ; `BackupSnapshot` exclut tout blob `pdfBase64` |
| `POST` | `/api/integrations/krisp/webhook` | Header `x-krisp-secret` (timing-safe) | Dédup atomique `(projectId, externalId)` ; aucun fallback vers projet aléatoire/archivé |
| `POST` | `/api/schedules/weekly-backup` | Vercel Schedule + `maxDuration = 60` | Rétention 26 snapshots compressés hors blobs binaires |

---

## 5. Variables d'environnement requises (`.env.example`)
- `DATABASE_URL` (poolée Neon/Postgres) et `DATABASE_URL_UNPOOLED` (`directUrl` pour migrations Prisma)
- `APP_ENCRYPTION_KEY` (32+ octets aléatoires — **obligatoire en prod**, fail-fast sans `.data/master.key`)
- `APP_BASE_URL` (ex. `https://go-project-dashboard.vercel.app`)
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`
- `ALLOWED_AUTH_DOMAINS` (ex. `gamersorigin.com,lintrus.fr`)
- `GEMINI_API_KEY`
- `BLOB_READ_WRITE_TOKEN` (Vercel Blob pour stockage durable PDFs/images/backups)
- `SANDBOX_MODE` (`true` | `false`, documenté explicitement)
- `KRISP_WEBHOOK_SECRET` (optionnel, sinon généré et stocké chiffré en `AppSetting`)
