# Session du 02/11

## État courant
**Phase 6a + popup redesign VALIDÉS** (49ea7eb, 569e456) :
- Pipeline complet opérationnel : DL → toast → clic → collage auto → **l'humain
  clique Download dans l'overlay** → détection du résultat → overlay se referme
  seul. Zéro toast parasite (anti-boucle sur origin photoroom.com).
- Toast redesigné : cliquable (zéro bouton), verre utopia pré-combiné
  (`light-dark(rgba(15,15,16,0.64), rgba(20,20,22,0.55))` + blur 80px),
  jauge plein-toast (couche se rétractant en 4s, transitionend = dismiss),
  titre FR « Supprimer le fond de l'image ? » + nom de fichier secondaire.

**Règle de survie captcha** (décision design) : le captcha du tool est un
tripwire — un DL auto pendant sa présence = signal bot. L'humain clique
Download, TOUJOURS. Le mod ne fait que détecter le DL et refermer.

## À la prochaine session (file priorisée)
- ⭐ **Chantier site** : styler l'overlay ghost (virer le bruit du tool) —
  reprendre le `userContent.css` (fait à l'arrache : sélecteurs Tailwind
  fragiles, hacks height 1195px/830px). Demander un screenshot du rendu
  actuel avant de restructurer.
- Phase 5 captcha watch — probablement optionnelle (voir ci-dessous)
- Purge copyDebug : wrapper trace (désactivé v0.8.1), DIAG paste, debug.log
- Identifier la cause exacte du blocage post-v0.6.2 (removebg.uc.v0.8.1.bak,
  comparaison à froid)
- Nettoyer le code mort frame script (listener DoPaste sans émetteur)
- Optionnel : restaurer le presse-papier utilisateur après traitement

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
  seule couleur par mode light-dark
- [leçon] light-dark() a besoin de color-scheme défini pour resolver
- [découverte, dump 17:00] Mécanisme DL résultat : canvas local exporté en
  blob (D12 dans discovery) → anti-boucle sur origin fiable ; Phase 5 a un
  point d'accroche (`captchaContainerRef`, `isCaptchaInteractive`)
- [jalon] **Popup redesign (569e456, constat 01:04)** : toast cliquable,
  verre utopia + voile, jauge plein-toast, titre FR — le fichier
  `body.appendChild(name)` avait sauté au refactor (texte disparu, fixé)
