# Session du 02/11 (2)

## État courant

**PHASE 8 (vision setup idéal) V1 FONCTIONNELLE — constat opérateur 04:2x : « ça marche ».**
- Cycle complet : DL → toast → clic → traitement 100% hors champ → l'overlay
  apparaît DÉJÀ recadré sur le rectangle damier seul → clic → `-nobg.png`
  écrit à côté de l'original → envol. Deux clics, zéro site vu.
- Le paris blob:/data: du src a tenu (fetch local OK, zéro réseau).
- Recadrage : browser taille fixe + wrap rétrécit + margins négatifs — le
  site ne reflow pas, la mesure reste exacte.
- Listeners chrome liés UNE fois par browser (le frame script, lui, se
  recharge à chaque nav — D13 inchangé).

**Chantier ouvert : le feedback (mode aveugle).** Rien ne signale le
  processing (3-5 s muettes) ni le DL réussi (l'overlay s'envole en
  silence). Options proposées, décision opérateur en cours.

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
