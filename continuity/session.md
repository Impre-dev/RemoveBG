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
- ⭐ **D13 — Le 2e cycle ne repart pas** : après purge (about:blank), le
  re-DL pend — le site re-render son turnstile AVANT la dropzone et
  `turnstile/api.js` est ORB-bloquée dans le ghost → l'UI ne monte jamais
  (constat 02:16, logs Browser Console). Pistes : purge site-data/cookies
  photoroom à la fermeture, ou signal Ready différent en re-load, ou ne
  JAMAIS re-naviguer. Outil : DIAG paste (frame script) + Browser Console
  (⚠️ debug.log muet depuis 00:13 — writes en échec silencieux).
- Épuration suite (v1 validée 01:55) : (a) tuer le breadcrumb résiduel +
  compaction fine (Download collé en bas), (b) fond transparent + blur
  toast côté ghost (`browser transparent="true"` + html/body transparent —
  expérimental, à froid).
- Phase 5 captcha watch — probablement optionnelle (turnstile auto-résolu
  invisible constaté dans le dump, cf. D12)
- Purge copyDebug (⚠️ debug.log muet — réparer les writes), code mort frame
  script (DoPaste sans émetteur), restauration clipboard (optionnel),
  cause blocage post-v0.6.2 (bak, comparaison à froid)

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
- [leçon, outil] debug.log muet depuis 00:13 (writes en échec silencieux) —
  la Browser Console reste la source quand le log se tait
