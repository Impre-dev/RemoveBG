# Session du 02/11 (2)

## État courant

**PROJET FONCTIONNEL DE BOUT EN BOUT — v0.13.0, tous les constats opérateur ✓.**
- Cycle final : DL → toast ask (4 s) → clic → « Traitement… » shimmer hors
  champ → damier seul en verre → clic → `-nobg.png` à côté de l'original →
  voile vert ✓ + ding (level-up.mp3, 50 %) → envol animé. Presse-papier
  restauré au paste confirmé. Zéro site vu.
- **File restante** : push (imminent — ce commit) · couleurs des états du
  toast (reporté, à l'œil) · captcha reveal Phase 5 en réserve (le site ne
  l'a jamais exigé hors champ — constat opérateur)

## Journal
- [jalon] Phase 0-4 (cf. page du 01/11) : squelette → injection image (v0.9.5)
- [décision, 00:00] Analyse captcha : tripwire DL-pendant-présence (thèse
  opérateur, plausible mais non prouvée) → design robuste dans tous les cas :
  jamais d'auto-DL, l'humain finalise. Nuance prouvée : le serveur vérifie le
  token (423) ; le site rapporte l'export en analytics (dump ToolV2.js)
- [jalon] **Phase 6a (49ea7eb, constat 00:20)** : anti-popup photoroom
  (jamais de toast sur origin photoroom.com) + fermeture overlay sur DL
  résultat (hideGhost + purge about:blank + flag off) + jamais auto-DL
- [leçon, prouvée] Une transition ne démarre jamais sur un élément
  display:none → toast immortel (transitionend jamais émis). Fix : afficher
  AVANT de lancer la transition (fix dans showToast)
- [leçon, prouvée] Multi-background : une couleur dans une couche
  non-dernière invalide TOUTE la déclaration → le fond glass était rejeté
  (toast fantôme sur page blanche, constat 01:01). Fix : pré-combiner en une
  seule couleur par mode light-dark. light-dark() veut aussi un
  color-scheme défini
- [jalon] **Popup redesign (569e456, constat 01:04)** : toast cliquable,
  verre utopia + voile, jauge plein-toast, titre FR « Supprimer le fond de
  l'image ? » — le `body.appendChild(name)` avait sauté au refactor (texte
  disparu, fixé)
- [régression + diagnostic, 01:15-01:30] Épuration tentative 1 : frame
  script injection CSS (<style> dans content) + resize 440 → collage auto ET
  manuel mort. Élimination en 3 tests (reverts croisés 7e877d8/ccbb18d/
  ec22b88) : **coupable = l'injection DOM dans le content**, resize innocent
  (re-test isolé b5b21cf = carré validé). WIP sauvé (e753c98)
- [outil] Dump DOM du ghost : contentDocument inaccessible (browser remote =
  frontière process) → passage par le message manager + micro frame script
  data: URI chargé à chaud depuis la Browser Console (snippet 01:40,
  3.6 Mo captés). Snippet à réutiliser
- [jalon] **Épuration v1 VALIDÉE (931fdf1, constat 01:55)** : agent
  stylesheet via `styleSheetService.loadAndRegisterSheet` (AGENT_SHEET,
  unregister au unload), ancres stables du dump (radiogroup radix,
  data-rater-promo-dismiss, conic-gradient pastilles, CTAs :not(:last-child)
  = Download survit). JAMAIS `.component-400` seul : c'est la span du label
  Download (c'était l'assassin du bouton dans l'ancien userContent)
- [diagnostic, 02:10-02:16] Fixes (c) reveal-after-Ready + (d) purge au ✕
  testés ensemble puis (d) seul → le re-DL après purge pend (jamais de
  Dropzone prête) : le re-load du tool re-render le turnstile AVANT la
  dropzone et l'api.js ORB-bloquée → UI jamais montée. Revert complet →
  ✕ = hideGhost seul. 2e cycle = D13, attaque à froid
- [jalon] **D13 FIXÉ (a9c2e1f, constat 02:40)** : le frame script ne
  survit pas au cycle purge about:blank → re-nav (site prêt, collage
  manuel OK, jamais de Ready) → re-chargé à CHAQUE navigation (guard
  mmAttached levé dans loadTool). + purge site-data (nsIClearDataService
  CLEAR_ALL sur photoroom) aux fermetures
- [jalon] **Overlay EN VERRE (13c3cc9, constat 03:30)** : browser
  transparent="true" + site transparent (agent sheet) + wrap porte le
  fond utopia var + blur 80px — la page Zen floutée derrière, comme le
  toast. Le fond blanc plein était peint par le canvas browser + body
  (bg-surface-default), pas la dropzone
- [leçon, outil] debug.log muet depuis 00:13 (writes en échec silencieux) —
  la Browser Console reste la source quand le log se tait
- [vision, 03:42] **Setup idéal adopté** : overlay = rectangle damier seul
  (crop par offset + couche cliquable + toBlob via frame script + save
  chrome direct + croix native = reset). Détails architecture dans la
  file priorisée — prochaine session dédiée
- [jalon, 04:2x] **PHASE 8 v1 VALIDÉE (constat opérateur « ça marche »)** :
  dump ToolV2.js a tout débloqué — le résultat est un IMG (pas un canvas),
  damier = classes CSS, croix native = handleReset. fetch(img.src) local
  (blob:/data:) remplace le toBlob : zéro tainted, zéro réseau, règle
  captcha respectée (lecture d'un blob déjà affiché). Recadrage sans
  reflow (browser taille fixe). Reveal au résultat seulement. Listeners
  chrome × 1/browser. v0.10.0
- [chantier, 04:2x] **Feedback ouvert (mode aveugle)** : rien pendant le
  processing (3-5 s), rien au DL (envol silencieux). Options en discussion
- [régression + REVERT, 04:39-05:16] v0.10.1-0.10.6 (toast 3 états +
  restructuration injection + captcha reveal + sondes) → cascade de pannes
  → **revert à a1ab9c1 constaté ✓**. Leçons gravées :
  (a) `loadFrameScript(uri, true)` = inscription PERSISTANTE — chaque appel
  empile une instance (×3 → FetchResult ×3, writes concurrents) ;
  (b) annuler une transition (remove de classe) laisse la propriété à sa
  valeur COURANTE → jauge repartie de ~50% (elapsed=7.6s au lieu de 15) ;
  (c) une restructuration d'injection et un redesign UI ne voyagent jamais
  dans le même commit.
- [découverte, 05:21] `ERREUR saveResult {}` ×3 AUSSI en v0.10.0 : le save
  n'a jamais marché (ArrayBuffer via message manager suspect) — l'overlay
  ne ferme pas car `closeGhostAfterResult()` jamais atteint
- [jalon, 05:2x] **Étape 1 VALIDÉE (constat opérateur « Validé GG »)** :
  toast de chargement — shimmer + filet masqué 15 s + reset largeur
  explicite, sur base saine, frame script/injection intacts. v0.11.0
- [jalon, 05:3x] **Étape 2 VALIDÉE** : transport base64 frame→chrome (le
  write vit), voile vert ✓ + chevron pop, envol animé (transform/opacity,
  enchaînement animationend). v0.12.0
- [jalon, 05:4x] **Polish validé** : level-up.mp3 embarqué (choix
  opérateur) à 50 %, envol ralenti (400+380 ms), logs nettoyés (logDebug,
  format d'erreur réparé globalement — adieu `{}`), idempotence frame
  script (garde __rmbgFrameActive — un seul Dropzone prête au log),
  vestiges nettoyés (.bak, ctrlv.ps1 détaché — verrou disque, theme.json
  0.13.0). v0.13.0
- [jalon, 05:5x] **Restauration presse-papier VALIDÉE** : armée au cycle,
  tirée au premier paste confirmé (Pasted) — jamais avant, sinon le Ctrl+V
  lirait le contenu restauré. Si paste échoue : l'image reste au
  clipboard (filet debug conservé)
- [push] Batch final vers origin/main
