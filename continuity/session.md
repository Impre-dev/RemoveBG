# Session du 01/11 (2)

## État courant
**PHASE 4 VALIDÉE (v0.9.5, 3da9295)** — l'injection image complète fonctionne :
download → toast → ghost → clipboard (helper screenshot) → focus ghost →
Ctrl+V système AHK → le site traite l'image. Constat opérateur 23:42.

**Le pipeline gagnant** :
1. fileToPNGArrayBuffer → decodeImageFromArrayBuffer('image/png')
2. Flavor `application/x-moz-nativeimage` (SANS tiret !) via Services.clipboard
3. focusGhost() (b.focus + attente RemoveBG:Focused, filet 400ms) — REQUIS :
   le clic toast dismiss et le focus retombe sur l'onglet, sans ça le ^v
   atterrit à côté (constat 23:38)
4. AutoHotkey64.exe ctrlv.ahk (Sleep 500 → Send '^v') via nsIProcess.runAsync
   — AHK = toléré par Bitdefender, contrairement à powershell.exe enfant de
   zen.exe (blocage ATD, cf. capture 23:22 — exception ATD non nécessaire)

**À la prochaine session (file priorisée)** :
- ⭐ Phase 5 : captcha watch (monkey-patch turnstile + reveal overlay CSS) —
  l'ORB sur turnstile/api.js est le blocker connu
- Phase 6 : capture auto du résultat + destruction ghost + anti-boucle
- Purge copyDebug : wrapper trace (désactivé v0.8.1), DIAG paste, debug.log
- Identifier la cause exacte du blocage post-v0.6.2 (état cassé archivé :
  removebg.uc.v0.8.1.bak — comparaison à froid)
- Nettoyer le code mort frame script (listener DoPaste sans émetteur)
- Optionnel : restaurer le presse-papier utilisateur après traitement

## Journal
- [jalon] Phase 0 squelette (97450f5) + Phase 1 toast/listener (b828a58) — matin
- [leçon, prouvée] Flavor clipboard : `application/x-moz-nativeimage` SANS tiret
  (l'ancien `x-moz-native-image` inconnu de l'OS = root cause blocker D11)
- [leçon, prouvée] execCommand('copy') = true mais HTML/text seul, jamais native
  image → voie content-side morte ; répliquer BrowserUtils.copyImageToClipboard
  (omni.ja) : PNG ArrayBuffer → decode → nativeimage ✓ (files=1 constaté)
- [leçon, prouvée] IOUtils.write refuse les strings → writeUTF8 ; 'append' ne
  crée pas le fichier → buffer + 'overwrite' (debug.log opérationnel)
- [leçon, prouvée] WindowUtils modernes : sendKeyEvent/sendMouseEvent retirés
- [leçon, prouvée] Flag d'injection sur outer window survit aux navigations →
  marqueur DOM par document (getElementById) — v0.6.9
- [règle] error-first.md créée (workspace) : l'erreur est LA source, zéro
  suspicion en boucle sur version/environnement
- [revert] Code post-v0.6.2 cassait le flow (constat opérateur) → revert
  complet c38bb04 ; état cassé archivé removebg.uc.v0.8.1.bak (gitigné) —
  cause exacte à identifier à froid
- [leçon] Bitdefender ATD bloque powershell.exe enfant de zen.exe →
  AutoHotkey64.exe ctrlv.ahk = toléré (v0.9.4)
- [leçon, prouvée] focusGhost() REQUIS avant Ctrl+V OS (constat 23:38) —
  sans focus, le ^v système atterrit sur l'onglet actif
- [jalon] **PHASE 4 VALIDÉE (3da9295, constat opérateur 23:42)** : image
  injectée, le site lance la segmentation — Phase 5 (captcha) next
