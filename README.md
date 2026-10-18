# LocalGemma AI

Interface graphique (Next.js + TypeScript) pour **discuter avec des modèles d'IA locaux au format GGUF** grâce à `llama-server.exe` de **llama.cpp**, sur Windows. Aucun cloud, aucune clé API.

Vous choisissez `llama-server.exe`, vos dossiers de modèles et vos fichiers `.gguf` avec les **vraies fenêtres de sélection Windows**, puis vous démarrez, arrêtez et changez de modèle d'un clic.

---

## 1. Choix d'architecture (et ses conséquences)

Un navigateur ne peut pas lire le chemin absolu d'un fichier local ni parcourir vos dossiers. J'ai retenu l'**option A : Next.js local + petite couche native**.

- L'application Next.js tourne sur votre PC (`http://localhost:3000`).
- Quand vous cliquez sur « Parcourir mon ordinateur », le **serveur Node.js** lance une fenêtre Windows (`OpenFileDialog` / `FolderBrowserDialog`) via **PowerShell** (`powershell.exe`, présent sur Windows 10/11). Le chemin choisi revient au serveur, pas au navigateur.
- Le serveur Node.js lance `llama-server.exe` avec `child_process.spawn` (`shell: false`) et relaie le chat.

Conséquences :
- ✅ Rien à installer en plus de Node.js (pas d'Electron, pas de Rust/Tauri) : installation et maintenance simples.
- ✅ Les fenêtres de sélection sont réelles ; aucun chemin à saisir à la main.
- ⚠️ Il faut garder la fenêtre PowerShell de `start.ps1` ouverte pendant l'utilisation.
- ⚠️ Les sélecteurs ne fonctionnent que sous Windows (l'interface le signale ailleurs).
- ⚠️ Application **locale uniquement** : elle ne convient pas à Vercel (pas de processus llama.cpp en serverless).

**Pourquoi des « tickets » ?** Les routes qui enregistrent un chemin n'acceptent pas de chemin libre envoyé par le navigateur : elles exigent un *ticket* à usage unique délivré uniquement après une sélection dans la fenêtre Windows (valable 10 minutes). Une page web malveillante ne peut donc pas enregistrer un programme arbitraire.

---

## 2. Quatre notions à ne pas confondre

| Étape | Ce que c'est | Où ça se passe |
|---|---|---|
| **Télécharger llama.cpp** | Récupérer le programme (`llama-server.exe` + DLL) | Vous, une fois, depuis GitHub |
| **Enregistrer un modèle GGUF** | Ajouter une *référence* (chemin) dans la bibliothèque. Le fichier n'est ni copié ni déplacé | Page *Configuration locale* / *Bibliothèque* |
| **Charger un modèle en mémoire** | Démarrer `llama-server.exe` avec ce modèle : occupe la RAM | Bouton *Démarrer* / *Utiliser ce modèle* |
| **Lancer une conversation** | Envoyer des messages au modèle déjà chargé | Page *Chat* |

Avoir 20 modèles dans la bibliothèque ne consomme **aucune** mémoire : seul le modèle démarré est chargé (un seul à la fois par défaut).

---

## 3. Prérequis Windows

- Windows 10 ou 11 (64 bits) avec Windows PowerShell 5.1+ (inclus).
- **Node.js 20 ou 22 LTS** (18.18 minimum) : <https://nodejs.org> → version « LTS », installation par défaut. Vérifiez : `node -v`.
- **llama.cpp** pour Windows (voir ci-dessous).
- Au moins un modèle `.gguf`.
- Si Windows signale une DLL manquante au lancement du moteur : installer le « Microsoft Visual C++ Redistributable ».

### Télécharger llama.cpp (source officielle)

1. Ouvrez la page **Releases** officielle : <https://github.com/ggml-org/llama.cpp/releases>
2. Choisissez l'archive Windows adaptée. Pour un processeur AMD sans carte graphique dédiée, prenez la variante **CPU** (par exemple `llama-…-bin-win-cpu-x64.zip`). Si le moteur plante avec une « instruction illégale », essayez un build plus générique (sans AVX2).
3. Décompressez **tout** le contenu dans un dossier (ex. `C:\llama.cpp\`). Gardez `llama-server.exe` à côté de ses `.dll`.
4. Vérification : dans `Configuration locale`, « Tester le moteur » affiche la version. Vous pouvez aussi comparer l'empreinte du fichier : `Get-FileHash .\llama-server.exe -Algorithm SHA256`.

> LocalGemma AI **ne télécharge et n'exécute jamais** de programme automatiquement. Vous gardez le contrôle.

---

## 4. Installation et lancement

Ouvrez PowerShell dans le dossier du projet.

```powershell
# Si Windows refuse d'exécuter les scripts (une seule fois, pour cette session) :
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass

.\scripts\check-env.ps1     # vérifie Node.js, PowerShell, port 3000, RAM
.\scripts\install.ps1       # installe les dépendances et construit l'application
.\scripts\start.ps1         # lance l'application et ouvre http://localhost:3000
```

Pour arrêter : `Ctrl+C` dans la fenêtre, ou `.\scripts\stop.ps1`. Le modèle actif est arrêté avec l'application.

**Sans taper de commande** : double-cliquez sur `Installer-LocalGemma-AI.bat` (une fois), puis sur `Lancer-LocalGemma-AI.bat` (chaque jour). Ils appellent les scripts PowerShell en contournant la restriction d'exécution pour cette session uniquement. Faites un clic droit → *Envoyer vers → Bureau (créer un raccourci)* sur le second pour l'avoir sur le bureau.

### Première configuration (une seule fois)

1. **Configuration locale → Moteur d'IA local → Parcourir mon ordinateur** : choisissez `llama-server.exe`, puis **Enregistrer**. « Tester le moteur » affiche la version.
2. **Dossiers de modèles GGUF → Ajouter un dossier** : choisissez le dossier de vos modèles (option « Inclure les sous-dossiers » au besoin). Utilisez **Actualiser** après avoir ajouté de nouveaux fichiers.
3. Ou **Ajouter un modèle GGUF** pour un fichier isolé.

### Utilisation quotidienne

1. `start.ps1`
2. **Bibliothèque de modèles** → choisissez un modèle.
3. **Démarrer** (ou **Utiliser ce modèle** si un autre est déjà actif : il est arrêté proprement, puis le nouveau est chargé).
4. Attendez le badge **Actif** (le chargement peut durer plusieurs minutes sur un PC modeste).
5. **Discuter**.

Le bouton principal d'une carte s'adapte : *Démarrer* (rien d'actif), *Utiliser ce modèle* (un autre est actif), *Arrêter / Discuter* (c'est le modèle actif), *Localiser à nouveau le fichier* (fichier introuvable).

---

## 5. Réglages pour un PC modeste (ex. AMD A9-9410, 12 Go de RAM)

Valeurs par défaut : contexte **2048**, **2 threads**, **1 slot parallèle**, 512 tokens générés maximum, port **8080**.

- **Contexte** : augmentez-le seulement si le modèle le permet (la bibliothèque affiche le contexte maximal annoncé dans ses métadonnées) ; plus de contexte = plus de mémoire.
- **Threads** : le nombre de cœurs physiques est un bon départ.
- **Slots parallèles (`--parallel 1`)** : les versions récentes de `llama-server` partagent le contexte entre plusieurs slots ; à 1, tout le contexte sert à votre conversation.
- **Mémoire** : elle dépend de la taille du modèle, de la taille du contexte, des caches et des autres applications ouvertes. Aucun réglage ne garantit qu'un modèle donné tiendra. Sur 12 Go de RAM, privilégiez des modèles petits et fortement quantifiés (Q4) ; fermez le navigateur et les autres applications lourdes.
- Les paramètres du serveur s'appliquent **au prochain démarrage** du modèle.
- **Prompt système** : le prompt recommandé (≈ 500 tokens) est suivi du prompt « compact » (≈ 150 tokens) en un clic dans *Paramètres*. Avec un contexte de 2048, préférez le compact : chaque token du prompt est retiré de la place disponible pour la conversation et ralentit le premier calcul sur CPU. Les valeurs déjà enregistrées dans `config.json` ne sont pas modifiées automatiquement.

Paramètres réellement transmis à `llama-server` : `--model`, `--host`, `--port`, `--ctx-size`, `--threads`, `--parallel`. Aucun autre drapeau n'est envoyé, pour rester compatible avec un maximum de versions.

---

## 5 bis. Fonctionnalités avancées

> Ces fonctions ajoutent des outils autour du modèle ; la **qualité des réponses dépend du modèle GGUF** choisi (un modèle de 1 milliard de paramètres n'égalera pas un grand modèle).

### Hors ligne par défaut, recherche web en option
Sans configuration, l'application n'appelle **aucun service externe** : votre modèle GGUF répond avec ses connaissances et les documents que vous lui joignez. L'en-tête du chat affiche « 100 % hors ligne ».

Pour la recherche web (facultatif) :
1. Installez **SearXNG** (par exemple avec Docker : `docker run -d --name searxng -p 127.0.0.1:8888:8080 searxng/searxng`) et activez le format JSON dans son `settings.yml` (`search: formats: [html, json]`).
2. *Paramètres → Recherche Web* : saisissez `http://127.0.0.1:8888`, **Tester la connexion**, **Enregistrer**.
3. Dans une conversation, cliquez sur le bouton **Recherche Web** pour l'activer ou le désactiver. **Rien n'est jamais recherché automatiquement** : la recherche part seulement quand le bouton est activé, à l'envoi du message. Les résultats (titre, extrait, lien) sont transmis au modèle et les sources s'affichent sous sa réponse.
4. SearXNG interroge des moteurs externes : une connexion Internet est nécessaire et vos termes de recherche quittent l'ordinateur (pas vos conversations).
Documentation : <https://docs.searxng.org/dev/search_api.html>

### Modes d'assistant
Sélecteur dans l'en-tête du chat : Général, Programmation, Rédaction et langues, Apprentissage, Analyse et raisonnement, Vie pratique, Pages web, Documents. Chaque mode ajoute quelques lignes au prompt système (le mode est mémorisé par conversation).

### Pièces jointes
Bouton trombone : PDF (avec texte), Word `.docx`, Excel `.xlsx`, texte et code (`.txt .md .csv .json .py .js …`), 8 Mo et 5 fichiers maximum. Le texte est extrait localement, puis tronqué selon la place disponible dans le contexte (affichée sous la zone de saisie). **Avec 2048 tokens de contexte, très peu de texte tient** : passez à 4096 ou plus dans *Gestionnaire de serveurs* pour lire de vrais documents. Les PDF scannés (images) ne sont pas lus : l'OCR n'est pas inclus.

### Export des réponses
Bouton **Exporter** sous chaque réponse : Word, PDF, Excel (tableaux et blocs CSV de la réponse), PowerPoint (une diapositive par titre), Markdown, texte, et **ZIP de fichiers de code** (nom de fichier pris dans `title=chemin` ou dans un commentaire `# fichier: chemin` en première ligne). Dans le PDF, les caractères hors jeu Latin-1 (emojis, par exemple) sont remplacés par « ? ».

### Aperçu de pages web
Les blocs de code `html` et `svg` ont un bouton **Aperçu** : la page s'affiche dans un cadre isolé (sans accès au réseau ni à l'application), et peut être téléchargée.

### Mémoire locale
*Paramètres → Mémoire locale* : notes (300 caractères, 50 maximum) ajoutées au prompt de toutes les conversations. Vous pouvez aussi écrire « Retiens que … » dans le chat. Stockage dans `config.json`, jamais envoyé ailleurs. N'y mettez ni mot de passe ni donnée sensible.

---

## 6. Ports utilisés

| Port | Usage | Modifiable |
|---|---|---|
| `3000` | Interface LocalGemma AI (`start.ps1 -Port 3001`) | Oui |
| `8080` | `llama-server` (API compatible OpenAI) | Oui, dans *Gestionnaire de serveurs* |

Tout écoute sur `127.0.0.1` uniquement. Le port 8080 n'est pas utilisé par le navigateur : seul le serveur Next.js lui parle.

---

## 7. Sécurité locale

- `spawn` avec tableau d'arguments, `shell: false` ; aucune route n'exécute de commande libre.
- Seuls sont lancés un exécutable nommé `llama-server(.exe)` choisi via le sélecteur et validé, et des fichiers GGUF **déjà dans la bibliothèque** (`/api/models/:id/start` prend un identifiant, jamais un chemin).
- Validation des chemins (absolus, sans `..`, sans octet nul), des ports (1024–65535) et de tous les paramètres numériques.
- Adresse d'écoute limitée à la boucle locale (`127.0.0.1`, `localhost`, `::1`).
- Middleware sur `/api/*` : refuse les hôtes non locaux (anti-DNS-rebinding), les origines étrangères, `Sec-Fetch-Site: cross-site`, et exige un en-tête `x-localgemma-request` sur toute requête modifiante.
- L'application n'arrête **que** le processus qu'elle a lancé (ou repris après vérification du nom). Elle ne tue jamais « tous les llama-server ».

---

## 8. Gestion des processus

- Un seul serveur à la fois (`ProcessManager`) ; l'architecture est prête pour plusieurs instances (une par port).
- Démarrage : validation → port libre ? → `spawn` → attente de `GET /health` (200) → statut *En marche*. En cas d'échec, l'erreur est expliquée avec une action corrective (port occupé, mémoire insuffisante, modèle incompatible, DLL manquante, délai dépassé, plantage…) et le modèle n'est **jamais** déclaré actif.
- Arrêt : demande d'arrêt, attente de 5 s, puis arrêt forcé du **seul** PID concerné (`taskkill /PID … /T /F` sous Windows).
- Fermeture de l'application : le processus enfant est arrêté (`process.on("exit")`).
- Si l'application est tuée brutalement (fermeture forcée), `llama-server` peut survivre : au prochain lancement, le PID mémorisé (`server.pid.json`) est repris **uniquement** si le processus est vivant **et** identifié comme `llama-server`, sinon il est ignoré. Aucune garantie n'est donnée au-delà.

---

## 9. Données et sauvegarde

| Donnée | Emplacement |
|---|---|
| Config (moteur, dossiers, bibliothèque, paramètres) | `%APPDATA%\LocalGemmaAI\config.json` |
| PID du serveur lancé | `%APPDATA%\LocalGemmaAI\server.pid.json` |
| Conversations | IndexedDB du navigateur (export Markdown / JSON depuis le chat) |

Dossier modifiable avec la variable `LOCALGEMMA_DATA_DIR` (voir `.env.example`).

- **Sauvegarde** : fermez l'application, copiez `config.json`.
- **Restauration** : recopiez-le au même endroit, relancez. Les fichiers déplacés apparaissent *Introuvables* ; utilisez *Localiser à nouveau le fichier*.
- Un `config.json` illisible est mis de côté (`config.corrupt-….json`), jamais écrasé silencieusement.
- Retirer un modèle ou un dossier de la bibliothèque **ne supprime jamais** les fichiers GGUF.
- Les conversations restent dans le navigateur utilisé : changer de navigateur ou vider les données du site les efface (pensez à l'export).

---

## 10. Routes API (usage interne)

| Route | Rôle |
|---|---|
| `GET/PUT /api/config` | Lire / modifier paramètres serveur et génération |
| `POST /api/dialog` | Ouvre le sélecteur Windows (`engine`, `gguf`, `folder`) → ticket |
| `GET/POST /api/engine`, `POST /api/engine/test` | Moteur : état, enregistrement, test `--version` |
| `GET/POST /api/folders`, `PATCH/DELETE /api/folders/:id`, `POST /api/folders/:id/refresh` | Dossiers de modèles |
| `GET/POST /api/models`, `POST /api/models/refresh` | Lister / ajouter / actualiser |
| `DELETE /api/models/:id`, `POST …/relocate`, `…/select`, `…/start` | Retirer, relocaliser, sélectionner, utiliser |
| `GET /api/server/status`, `POST …/start`, `…/stop`, `…/restart`, `…/test`, `GET …/logs` | Serveur llama.cpp |
| `POST /api/chat`, `POST /api/chat/stop` | Chat (SSE relayé, mode + mémoire) et arrêt d'une génération |
| `POST /api/search`, `POST /api/search/test` | Recherche SearXNG (uniquement si configurée) |
| `POST /api/extract`, `POST /api/export` | Lecture des pièces jointes ; export Word/PDF/Excel/PowerPoint |
| `GET/POST/PUT /api/memory`, `PATCH/DELETE /api/memory/:id` | Mémoire locale |

Le chat n'est **jamais simulé** : sans serveur prêt, une erreur explicite est renvoyée.

---

## 11. Dépannage

| Symptôme | Piste |
|---|---|
| « Les sélecteurs ne sont disponibles que sous Windows » | Lancez l'application sur Windows avec `start.ps1` |
| La fenêtre de sélection n'apparaît pas | Vérifiez qu'elle n'est pas derrière le navigateur ; vérifiez que `powershell.exe` est accessible |
| Port 3000 / 8080 déjà utilisé | `start.ps1 -Port 3001` ; ou changez le port du serveur dans *Gestionnaire de serveurs* |
| DLL manquante / code 3221225781 | Gardez `llama-server.exe` avec ses `.dll` ; installez le Visual C++ Redistributable |
| Instruction illégale / code 3221225501 | Utilisez un autre build de llama.cpp, adapté aux processeurs plus anciens |
| Mémoire insuffisante | Réduisez le contexte (1024), fermez des applications, choisissez un modèle plus petit / Q4 |
| Modèle incompatible | Mettez à jour llama.cpp ; retéléchargez le modèle (fichier incomplet) |
| Démarrage trop long | Augmentez le « Délai de démarrage » ; les gros modèles se chargent lentement |
| « La conversation dépasse le contexte » | Effacez la conversation ou augmentez le contexte puis redémarrez le modèle |
| Réponses très lentes | Normal sur CPU modeste : modèle plus petit, `maxTokens` plus bas |

Les journaux de `llama-server` sont affichés dans *Gestionnaire de serveurs → Journaux*.

---

## 12. Développement et tests

```powershell
npm install
npm run dev          # http://127.0.0.1:3000
npm run typecheck    # TypeScript strict
npm test             # Vitest (aucun vrai modèle requis)
npm run build
```

Les tests utilisent un **faux `llama-server`** (`tests/fixtures/llama-server`) qui n'existe que pour les tests. Ils couvrent : configuration et persistance, ajout/retrait de modèles, fichier manquant et relocalisation, validation des chemins et paramètres, démarrage/arrêt, port occupé, serveur indisponible/interrompu, changement de modèle, reprise d'un processus avec vérification d'identité, erreurs HTTP, transmission de la conversation, streaming SSE (découpage arbitraire, UTF-8), arrêt de génération, garde de sécurité, tickets, dialogues (runner PowerShell simulé).

Mode avancé (développement hors Windows) : `LOCALGEMMA_ALLOW_PATH_INPUT=1` autorise l'envoi direct d'un chemin aux routes d'enregistrement. À ne pas activer en usage normal.

### Structure

```
src/app/            pages (accueil, chat, modèles, serveurs, config, paramètres) + routes /api
src/components/     interface (sidebar, cartes, chat, formulaires)
src/lib/server/     config-store, validators, selection (tickets), native-dialog, gguf,
                    model-library, process-manager, llama-client, diagnose, engine
src/lib/client/     api, IndexedDB, lecteur SSE
src/lib/security.ts garde des routes (partagée avec le middleware)
tests/              Vitest + faux llama-server
scripts/            install / start / stop / check-env (PowerShell)
```

## 13. Mise à jour

- **Application** : remplacez les fichiers (gardez votre `config.json`, hors du dossier du projet), puis `.\scripts\install.ps1`.
- **llama.cpp** : arrêtez le modèle, décompressez la nouvelle version, resélectionnez `llama-server.exe` (*Configuration locale*) et lancez « Tester le moteur ».
- **Modèles** : ajoutez de nouveaux `.gguf` dans un dossier enregistré, puis *Actualiser*.

## 14. Limites connues

- Les fenêtres de sélection Windows et les scripts PowerShell ont été écrits pour Windows mais **n'ont pas pu être exécutés** dans l'environnement de développement (Linux). Le chemin PowerShell est couvert par des tests avec un exécuteur simulé uniquement ; testez-le à la première utilisation.
- L'intégration avec un **vrai** `llama-server` n'a pas été testée avec un vrai modèle : elle l'a été avec un faux serveur imitant `/health` et `/v1/chat/completions` (SSE). Les options `top_k`, `--parallel` et le format des erreurs peuvent varier selon la version de llama.cpp.
- Les métadonnées GGUF sont lues dans les 4 premiers Mo du fichier ; si elles sont absentes, la quantification est déduite du nom de fichier (signalé « d'après le nom »).
- Les fichiers `.doc`, `.xls`, `.ppt(x)` ne sont pas lus (enregistrez en `.docx`/`.xlsx`/`.pdf`). Pas d'OCR, pas de génération d'images ni d'exécution de code.
- Les fichiers `mmproj*.gguf` et les parties 2..N de modèles découpés ne sont pas listés.
