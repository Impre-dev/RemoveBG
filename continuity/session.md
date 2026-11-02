# Session du 02/11 (2)

## État courant
**Épuration v1 VALIDÉE + pipeline 1er cycle opérationnel — 2e cycle = chantier ouvert (D13).**
- Pipeline : DL → toast (redesigné) → clic → collage auto → l'humain clique
  Download → détection résultat → overlay se ferme seul. **Le 1er cycle de
  session est parfait** (constat 02:16, DIAG paste files=1).
- Overlay : carré 420×440 (resize validé isolément, b5b21cf), wrapper chrome
  avec bouton ✕ (fermeture sans purge), agent stylesheet d'épuration
  (marketing, before/after, pastilles, CTAs sauf Download tués — ancres
  stables issues du dump DOM 3.6 Mo, constat 01:55). userContent.css purgé
  de sa section photoroom (backup `.bak-epuration-0211`).
- **Régression épuration (01:15-01:30) diagnostiquée par élimination** :
  l'injection DOM d'un `<style>` dans le content du tool (même vide) tue le
  collage auto ET manuel. Le resize 440 est INNOCENT. La voie = agent
  stylesheet côté chrome, zéro contact avec le DOM du site.

**Règle de survie captcha** (décision design) : le captcha du tool est un
tripwire — un DL auto pendant sa présence = signal bot. L'humain clique
Download, TOUJOURS. Le mod ne fait que détecter le DL et refermer.

## À la prochaine session (file priorisée)
- ⭐ **VISION SETUP IDÉAL (spec capture 03:41, adoptée)** : l'overlay = le
  rectangle damier de l'image, RIEN d'autre. Le site tourne toujours
  (chargement/pub/bruit hors champ pour toujours — reveal conditionné au
  canvas résultat, pas à l'input file). Architecture validée en discussion :
  ① frame script mesure la frame (position + dims) → chrome crop/resize le
  wrap (offset négatif, overflow hidden) pour ne montrer que le damier ;
  ② clic image → couche cliquable chrome-side (épargnant le coin croix) →
  frame script canvas.toBlob() lecture seule (D12) → blob au chrome via
  message manager (structured clone) → IOUtils.write direct dans Downloads
  → fermeture auto. ③ croix native du site = reset : frame script détecte
  la disparition du canvas → hideGhost (lecture seule, jamais d'injection).
  Cycle humain final : DL → clic toast → l'image apparaît en carré de
  verre → clic dessus → fichier dans Downloads, overlay envolé. 2 clics.
  Angles morts à valider : cadrage frame selon aspect ratio, toBlob
  non-tainted, canvas unique identifiable (dump + count).
- Épuration suite : (b) fond transparent — FAIT (13c3cc9, verre utopia
  validé 03:30) ; micro-retouches marges au devtool si l'œil affine

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
