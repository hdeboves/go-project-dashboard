# Spécification Produit — Project Hub (`GamersOrigin` & `L'Intrus`)

> **Statut :** `Audit V2 Consolidé (Prêt pour validation humaine)`  
> **Dernière mise à jour :** 2026-11-26  
> **Références produit cibles :** **Pennylane** (factures, devis, marge temps réel), **PayFit** (clarté administrative, micro-copy zéro jargon, multi-entités), **Asana** (vitesse quotidienne, « Mes tâches », mises à jour optimistes, Undo).

---

## 1. Objectif du produit
- **Concept :** Cockpit opérationnel et financier tout-en-un pour piloter les productions créatives, gaming, vidéo et événementielles de bout en bout (de la création du projet au bilan client final), connecté à Google Workspace (Drive, Sheets, Slides, Gmail, Calendar), Krisp et Gemini IA.
- **Public cible :**
  - **Chefs de projet (10–20 personnes)** des agences **GamersOrigin** et **L'Intrus** (jeux pour marques Fortnite/Roblox, vidéos YouTube & influence, production créative/social, événements, sponsoring).
  - **Service Comptabilité / Finance** (réception Pennylane, contrôle attestations URSSAF > 3 000 € HT, suivi marges).
  - **Direction d'agence / Admins** (pilotage consolidé du portefeuille multi-agences, charge équipe, sauvegardes, audit).
- **Proposition de valeur :** Faire gagner **3h30 à 5h30 par semaine et par chef de projet** en réduisant au minimum les changements d'écran, la double saisie et les erreurs de marge ou d'entité juridique.

---

## 2. Règles métier structurantes (Non négociables)
1. **Bi-agence native (`GamersOrigin` & `L'Intrus`) :**
   - Chaque projet est rattaché à une entité juridique (`GAMERSORIGIN` ou `LINTRUS`).
   - Les livrables clients (Slides Weekly, brouillons Gmail client, Google Docs CR Krisp, Google Calendar, exports CSV) et le routage comptable (inbox Pennylane, CC obligatoires, Shared Drive) s'adaptent dynamiquement à l'entité du projet.
   - À l'extraction PDF de factures, `GamersOrigin` et `L'Intrus` sont **toujours** le client/destinataire, jamais le prestataire.
2. **Factures fournisseurs — 100 % HT & Zéro TVA :**
   - Seul le **Montant HT (€)** est extrait, vérifié et imputé dans le budget (`postOpTotalHt`). Aucun champ TVA/TTC dans la vérification.
   - **Numérotation séquentielle automatique à partir de `1`** (`1`, `2`, `3`…) par projet : nomenclature Drive et pièce jointe **`<N° séquentiel>_<CodeProjet(s)>_<Prestataire>_<DateÉmission>.pdf`** (la référence fournisseur du PDF est conservée en métadonnée pour la détection de doublons).
   - **Isolation par utilisateur :** toute facture en cours de vérification (`PENDING_VALIDATION` / `CONFLICT_BLOCKED`) n'est visible, modifiable et supprimable que par l'utilisateur qui l'a déposée. Une fois validée, elle rejoint le budget partagé du projet.
   - **Conformité comptable :** rappel + dépôt Drive d'attestation de vigilance URSSAF pour toute facture **> 3 000 € HT** ; support mono et multi-CP ; **1 brouillon Gmail strict par facture** (jamais d'envoi automatique) vers l'adresse Pennylane + CC obligatoires (`s.aslam@gamersorigin.com`, `louis.berody@gamersorigin.com`) + rôle `COMPTA` + collaborateurs/chefs de projet du ou des projets concernés.
3. **Isolation stricte des dossiers clients (Anti-mélange CP & Barrière `[INT]` / `[EXT]`) :**
   - Tout document mentionnant un autre Code Projet déclenche un garde-fou visible avant validation.
   - Aucun fichier interne `[INT]` ne passe côté client `[EXT]` sans validation humaine explicite.

---

## 3. Périmètre Actuel & Cible « Prêt pour 6 mois de prod »

### Déjà en place (Socle M1–M9)
- [x] Cockpit projet (`/`) avec dépôt PDF direct dans *Accès rapides* + visionneuse plein écran style Pennylane en 2 étapes sans changement d'écran
- [x] Gestion multi-projets & archivage (`/projects`), partage par projet (`OWNER` / `EDITOR` / `VIEWER`), 4 rôles globaux (`ADMIN`, `CHEF_DE_PROJET`, `COMPTA`, `MEMBER`)
- [x] Budget Pre-Op / Post-Op + import Excel + Devis reliables à N factures (`/budget`)
- [x] Rétroplanning Liste / Kanban / Chronologie + Veille IA + Snapshots (`/retroplanning`)
- [x] Arborescence Drive 61 dossiers & publication `[INT] → [EXT]` (`/drive`)
- [x] Comptes rendus Krisp webhook + création tâches (`/meetings`)
- [x] Weeklys client Slides + brouillon Gmail (`/weeklys`) et Reporting Fortnite/Influence (`/reporting`)
- [x] Équipe, Admin, Audit Log et Sauvegardes hebdomadaires (`/team`), Profil & Avatars (`/profile`), Paramètres (`/settings`)

### Chantiers prioritaires issus de l'Audit V2 (à livrer par vagues)
- [ ] **Vague 0 (Urgences prod immédiates) :** corriger le 404 de complétion tâche Cockpit, l'erreur `EROFS` Influence, le bug `isSandbox: false` création projet, le bug timezone 13h/14h des tâches « en retard », les fuites d'état inter-projets (Weeklys/Reporting/Retro), la faille `STAGED:` LFI, le fail-open Auth/Admin/Backups, et la bombe 4.5 Mo / OOM `pdfBase64`.
- [ ] **Vague 1 (Socle solide & bi-agence) :** entité `GAMERSORIGIN` / `LINTRUS` partout (zéro signature *GamersOrigin* sur un projet *L'Intrus*), `ShellContext` (supprimer les 7–11 requêtes par action), stockage objet durable pour PDFs/images, OAuth Google isolé, notifications par utilisateur, verrous anti-double-clic, suite tests Vitest PostgreSQL verte.
- [ ] **Vague 2 (Super-pouvoirs gain de temps Asana / Pennylane / PayFit) :**
  - Vue transverse **« Mes Tâches » multi-projets** + `RetroTask.ownerUserId`
  - **Pipeline Factures unifié** (supprimer la divergence Cockpit vs Budget) + **OCR Devis** + **auto-match Devis↔Facture**
  - **Marge à terminaison « Engagé réel »** (intégrer les devis `ACCEPTE` + radar Factures Manquantes FNP)
  - **Pont IA 1-clic Krisp → Tâches (persistées) → Weekly client**
  - **Design System unifié** (Primaire Indigo / Danger Red, WCAG AA, 390px mobile propre, `<Modal>` partout, Toast Undo, Command Palette full-clavier)
- [ ] **Vague 3 (Scale Direction & Productivité avancée) :** Wizard « Lancer un projet en 30s » + Clonage + Templates rétro par catégorie, Coffre Attestations URSSAF 6 mois par prestataire, Vue Direction Charge Équipe & P&L `GO / L'Intrus`, Décalage sélectif & rétro-calcul lancement, Agenda global multi-projets, Pointage express RH Internes.

---

## 4. Arborescence des pages et parcours clés

| Route | Titre onglet cible (`%s · Project Hub`) | Rôle de la page | Accès | Action principale (< 20s) |
| :--- | :--- | :--- | :--- | :--- |
| `/` | `Cockpit projet` | Vue du jour du projet actif | Privé (membre) | Déposer & vérifier une facture PDF sur place ; cocher ses tâches du jour |
| `/my-tasks` *(V2)* | `Mes tâches` | Tâches multi-projets assignées au CP | Privé (user) | Traiter ses priorités du matin sans changer de projet |
| `/projects` | `Tous les projets` | Portefeuille consolidé GO + L'Intrus | Privé (filtré user/Admin) | Lancer un projet en 30s, filtrer par entité/CP/santé, ouvrir un projet |
| `/retroplanning` | `Tâches & Planning` | Liste / Kanban / Gantt + Veille IA | Privé (membre) | Mettre à jour statuts/dates en 1 clic optimiste, décaler une phase |
| `/budget` | `Budget & Factures` | Suivi marge Pre-Op / Engagé / Post-Op, Devis, Factures | Privé (membre) | Contrôler la marge à terminaison, lier devis↔factures, importer Excel |
| `/drive` | `Fichiers Drive` | Dossiers actifs & publication `[INT] → [EXT]` | Privé (membre) | Valider et publier les livrables prêts au client |
| `/meetings` | `Comptes rendus` | CR Krisp & saisie rapide → tâches | Privé (membre) | Convertir les actions d'un CR en tâches rétroplanning (sans doublon) |
| `/calendar` | `Agenda & Rappels` | Jalons & rappels (puis Agenda global V3) | Privé (membre) | Synchroniser les rappels J-X sur Google Calendar |
| `/weeklys` | `Weeklys clients` | Préparation Slides + brouillon email client | Privé (membre) | Pré-remplir depuis Planning + CR Krisp et générer Slides + brouillon |
| `/reporting` | `Reporting bilan` | Consolidation Fortnite + Influence + Slides | Privé (membre) | Importer stats/captures et générer le bilan client |
| `/team` | `Équipe & Administration` | Annuaire, rôles, charge, modèles agence, sauvegardes, audit | Privé (`ADMIN` pour actions admin) | Gérer les rôles, la charge équipe et les sauvegardes |
| `/profile` | `Mon profil` | Session, infos collaborateur, avatar | Privé (user) | Mettre à jour son profil et son avatar |
| `/settings` | `Paramètres` | Connexion Google, Gemini, Krisp, config entités | Privé (`ADMIN`) | Connecter/vérifier les intégrations |
