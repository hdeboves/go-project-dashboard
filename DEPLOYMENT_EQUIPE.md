# Déploiement Production — GO Project Hub sur Firebase App Hosting

Ce guide détaille le passage de l'environnement local (`localhost:3000` + SQLite) à une mise en production réelle pour toute l'équipe GamersOrigin via **GitHub + Firebase App Hosting + PostgreSQL**.

> **Important (Pourquoi App Hosting et pas Firebase Hosting statique ?)**
> GO Project Hub est une application Next.js 16 dynamique (API Routes, OAuth2 Google Workspace, webhook Krisp, Prisma). **Firebase App Hosting** déploie automatiquement Next.js SSR sur Cloud Run à chaque `git push` sur `main`.

---

## 1. Base de données persistante (PostgreSQL) — Obligatoire en production

Sur Firebase App Hosting (Cloud Run), le système de fichiers local du conteneur est **éphémère** : un fichier SQLite (`dev.db`) est effacé à chaque redéploiement.

1. Créer une base **PostgreSQL** managée (au choix : **Cloud SQL** dans le même projet GCP/Firebase, **Neon**, ou **Supabase**).
2. Basculer `datasource db` dans `prisma/schema.prisma` vers :
   ```prisma
   datasource db {
     provider = "postgresql"
     url      = env("DATABASE_URL")
   }
   ```
3. Appliquer le schéma initial :
   ```bash
   npx prisma db push
   ```

---

## 2. Connexion GitHub → Firebase App Hosting

1. Ouvrir **Firebase Console** → **App Hosting** → **Créer un backend**.
2. Connecter le dépôt GitHub : **`hdeboves/go-project-dashboard`** (branche **`main`**, déploiements automatiques activés).
3. Choisir la région **`europe-west4`** (ou `europe-west1` au plus proche de l'équipe en France).
4. Firebase détecte automatiquement `apphosting.yaml` et Next.js 16.

---

## 3. Secrets & Variables d'environnement

Enregistrer les secrets dans Firebase App Hosting (Cloud Secret Manager) :

```bash
firebase apphosting:secrets:set DATABASE_URL
firebase apphosting:secrets:set APP_ENCRYPTION_KEY
firebase apphosting:secrets:set GOOGLE_CLIENT_ID
firebase apphosting:secrets:set GOOGLE_CLIENT_SECRET
firebase apphosting:secrets:set GEMINI_API_KEY
```

- **`APP_ENCRYPTION_KEY`** : générer une clé aléatoire 64 caractères hex (`node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`).
- **`APP_BASE_URL`** : URL publique Firebase App Hosting (ex. `https://go-project-hub--<project-id>.europe-west4.hosted.app` ou domaine personnalisé `https://hub.gamersorigin.com`).
- Décommenter ensuite la section `secrets` dans `apphosting.yaml` et pousser sur `main`.

---

## 4. URI de redirection Google Cloud & Webhook Krisp

1. **Google Cloud Console → API & Services → Identifiants OAuth2** :
   - Ajouter l'URI autorisée : `https://<votre-url-prod>/api/auth/google/callback`
   - Garder le type d'audience **Interne** (`@gamersorigin.com`) pour sécuriser l'accès à l'agence.
2. **Krisp → Intégrations / Webhooks** :
   - Copier l'URL Webhook affichée dans `/settings` (elle se met à jour automatiquement avec l'URL publique de production) et renseigner le header `x-krisp-secret`.

---

## 5. Automatisations planifiées (Cloud Scheduler)

- **Veille Gmail quotidienne (8h30)** : `POST https://<votre-url-prod>/api/projects/<projectId>/retroplanning/veille`
- **Archive rétroplanning 14 jours (002.2)** : `POST https://<votre-url-prod>/api/projects/<projectId>/retroplanning/snapshots`

---

## 6. Règles de sécurité préservées en production

- **002.1 Rétroplanning Actif** : jamais synchronisé en continu vers `[EXT]` (export PDF ponctuel uniquement).
- **Gmail Draft-First** : création de brouillons uniquement (`gmail.compose`), aucun envoi automatique.
- **Isolation Code Projet** : blocage automatique (`409 CP_CONFLICT`) de toute facture ou email appartenant à un autre CP.
- **Dossiers PROD existants** : les IDs immuables définis dans `src/lib/google/sandbox-guard.ts` restent protégés en lecture seule.
