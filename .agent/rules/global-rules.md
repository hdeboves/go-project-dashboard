# Règles globales de l'équipe multi-agents

Ces règles s'appliquent à tous les agents travaillant sur ce dépôt.

## 1. Source de vérité partagée
- Avant toute modification de code, lis obligatoirement `docs/ARCHITECTURE.md` et `docs/TASKS.md`.
- Pour toute tâche UI ou page, lis aussi `docs/DESIGN_SYSTEM.md`.
- Ne devine jamais un contrat d'API, un nom de table ou une règle métier : réfère-toi uniquement aux fichiers `docs/`.

## 2. Verrouillage des périmètres (anti-conflits en parallèle)
Chaque agent modifie uniquement ses dossiers autorisés :
- **01-architect** : `docs/*`, configuration racine (`package.json`, `tsconfig.json`, linter), types/contrats partagés (`src/types/*` ou `shared/*`).
- **02-ui-ux** : `docs/DESIGN_SYSTEM.md`, styles globaux, configuration Tailwind/CSS, composants atomiques (`src/components/ui/*`), page de prévisualisation `/design-system`.
- **03-backend** : `server/*`, `api/*`, `src/app/api/*`, `prisma/*`, `supabase/*`, services serveur, `.env.example`.
- **04-frontend** : `src/app/*` (hors `/api`), `src/pages/*`, `src/components/*` (hors logique serveur), hooks client.
- **05-qa-tester** : `tests/*`, `e2e/*`, `*.test.*`, `*.spec.*`, rapports de bugs dans `docs/TASKS.md`.
- **06-seo-copy** : textes UI/marketing, métadonnées SEO, `robots.txt`, `sitemap.*`, JSON-LD, attributs `alt` et balises sémantiques.

Interdiction stricte de modifier `package.json` en dehors d'une tâche explicitement assignée à `01-architect`.

## 3. Protocole de tâches et traçabilité
- Ne travaille que sur les identifiants de tâches (`ARCH-x`, `UI-x`, `BE-x`, `FE-x`, `QA-x`, `SEO-x`) demandés dans la session.
- À la fin de chaque tâche, mets à jour son statut dans `docs/TASKS.md` (`À faire` -> `En cours` -> `Terminé` ou `Bloqué`) et ajoute un résumé factuel de 3 à 5 lignes maximum (fichiers modifiés + vérification effectuée).

## 4. Règle des 2 échecs (escalade de modèle)
- Si une erreur ou un test échoue **2 fois de suite** malgré deux corrections distinctes, arrête immédiatement les tentatives.
- Passe la tâche en statut `Bloqué` dans `docs/TASKS.md` avec le message d'erreur exact, les fichiers concernés et les 2 pistes déjà essayées, puis demande une escalade vers `/01-architect` (Tier 1).

## 5. Sécurité et hygiène
- Zéro secret, clé API ou mot de passe en dur dans le code ou les commits.
- Toute nouvelle variable d'environnement doit être documentée dans `.env.example` avec une valeur factice.
- Privilégie un code typé, lisible et simple ; pas de dépendance superflue.
