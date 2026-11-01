# Session du 01/11 (2)

## État courant
**Phase 4 en cours — l'injection passe le clipboard, bloque sur l'état du site (rate-limit suspecté).**

Acquis PROUVÉS en réel aujourd'hui :
- Clipboard : le helper screenshot répliqué (decodeImageFromArrayBuffer PNG + flavor
  `application/x-moz-nativeimage` SANS tiret) produit une image collable ✓
  (root cause du blocker historique : l'ancien flavor avait un tiret en trop).
- Event paste natif : doCommand('cmd_paste') part avec files=1, trusted ✓.
- Ctrl+V physique sur notre nativeimage : le site traite ✓ (plusieurs fois).
- Scripts inline injectables dans la page (exécuteur v0.6.x a répondu) ✓.
- WindowUtils modernes : sendKeyEvent/sendMouseEvent RETIRÉS (constat v0.6.7/0.6.8).
- Traceur wrapper : bug du flag outer window (survit aux navigations → injecté
  une fois dans le about:blank jetable, jamais dans photoroom) → fix v0.6.9
  marqueur DOM par document (getElementById). LE wrapper est en place dans
  photoroom (attempt rs:loading puis already:true sur le même document) —
  mais TOUJOURS zéro `add`/`call` tracé → à creuser à la reprise (preuve
  d'exécution du script inline manquante : remettre le postMessage `installed`).

**Constat final 21:57 (v0.8.0)** : le flow s'arrête à "Navigation lancée" —
le tool ne charge PLUS du tout dans le ghost (jamais de "Dropzone prête"),
et le Ctrl+V manuel ne colle plus non plus. AUCUN changement de code
n'explique ce basculement (le manuel marchait à 22:45) → **hypothèse
dominante : rate-limit/captcha Cloudflare après ~20 uploads automatisés
le même jour** (l'ORB sur turnstile/api.js apparaît dans chaque run).

**Plan de reprise (à froid)** :
1. Test discriminant : photoroom dans un ONGLET NORMAL + Ctrl+V manuel
   (clipboard bureautique). Colle = le ghost est en cause (captcha/ORB →
   Phase 5 captcha reveal devient prioritaire). Colle pas = rate-limit
   Cloudflare (attendre 24h / changer d'IP) — re-tester ensuite.
2. v0.8.0 (Ctrl+V système via powershell SendKeys ^v, idée opérateur) :
   à re-tester sur un site sain. Si le DIAG paste files=1 apparaît sans
   traitement → activation OK mais site refuse → captcha.
3. À la validation Phase 4 : PURGER le copyDebug (wrapper trace, DIAG paste,
   debug.log — le .gitignore couvre debug.log) et nettoyer le code mort
   (exécuteur input-change v0.7.0 resté dans le frame script).

## Journal
- [jalon] Brainstorm capturé + squelette Phase 0 (97450f5) — 3 ticks verts constatés
- [leçon, prouvée] `installMod` écrase le local par le contenu GitHub — jamais d'itération
  non-pushée avant un installMod
- [leçon, prouvée] Browser remoté hors-tab sous Fission : contentWindow null → frame script
  via messageManager (allowDelayedLoad) = le canal fiable
- [jalon] Phase 1 validée : toast + listener (b828a58)
- [leçon, prouvée] FRAME_SCRIPT_SRC est une STRING : vérifier la syntaxe à chaque édition
- [leçon, prouvée] Flavor clipboard : `application/x-moz-nativeimage` SANS tiret —
  l'ancien `x-moz-native-image` était inconnu de l'OS (root cause blocker D11, 01/11)
- [leçon, prouvée] Sélection + execCommand('copy') : true mais HTML/text seul, jamais
  de native image (voie content-side morte, constat 01/11)
- [leçon, prouvée] Clipboard XPCOM chrome-side : répliquer BrowserUtils.copyImageToClipboard
  (omni.ja Zen) — PNG ArrayBuffer → decode 'image/png' → nativeimage (01/11, files=1)
- [leçon, prouvée] IOUtils.write refuse les strings → writeUTF8 ; mode 'append' ne crée
  pas le fichier → buffer mémoire + 'overwrite' (debug.log, 01/11)
- [leçon, prouvée] WindowUtils modernes : sendKeyEvent/sendMouseEvent retirés (01/11)
- [leçon, prouvée] Flag d'injection sur l'outer window survit aux navigations → injecté
  dans le about:blank jetable et jamais réinjecté → marqueur DOM par document (v0.6.9)
- [règle] error-first.md créée (01/11) : le message d'erreur est LA source, zéro suspicion
  en boucle sur la version/l'environnement
- [état] v0.8.0 : Ctrl+V système (powershell SendKeys ^v via nsIProcess.runAsync) —
  bloqué en amont : le tool ne charge plus dans le ghost (rate-limit suspecté).
  Transition propre à 22:58, reprise au plan ci-dessus. WIP non commité (choix
  opérateur : chantier en cours — tout l'état vital est dans ces registres locaux).
