# Session du 02/11

## État courant
**Pipeline opérationnel — épuration du site EN PAUSE (régression diagnostiquée)** :
- Pipeline complet : DL → toast → clic → collage auto → l'humain clique
  Download dans l'overlay → fermeture auto. Popup redesigné et validé.
- Épuration du site (chantier ⭐) : tentative 01:12 → régression collage
  (auto ET manuel mort). Coupable identifié PAR ÉLIMINATION (01:23-01:26) :
  **l'injection DOM d'un <style> dans le content du tool (frame script)** —
  même un style vide casse le collage. Le resize 440px reste suspect
  secondaire non tranché. WIP conservé dans l'historique (e753c98).
- **Prochaine voie pour l'épuration : agent stylesheet** enregistrée côté
  chrome (`styleSheetService.loadAndRegisterSheet`, la mécanique de
  userContent.css mais portée par le mod, unregister au unload) — ZÉRO
  injection DOM dans le content. Le dump DOM (snippet IOUtils) reste à
  faire pour construire les sélecteurs.

**Règle de survie captcha** (décision design) : le captcha du tool est un
tripwire — un DL auto pendant sa présence = signal bot. L'humain clique
Download, TOUJOURS. Le mod ne fait que détecter le DL et refermer.

## À la prochaine session (file priorisée)
- ⭐ **Épuration du site via agent stylesheet** (pas d'injection DOM !) —
  dump DOM d'abord (snippet IOUtils, 2 états : dropzone + image chargée),
  construire les sélecteurs sur le vrai DOM, virer marketing/before-after/
  pastilles, garder dropzone/preview/download/captcha, sans scroll.
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
- [régession + diagnostic, 01:15-01:26] Épuration tentative 1 : frame script
  injection CSS (<style> dans content) + resize ghost 440px → collage auto ET
  manuel mort. Élimination en 2 tests : revert du resize seul (7e877d8) = ça
  remarche PAS tout de suite (retest avec WIP frame script réappliqué
  ccbb18d = toujours mort) → **coupable = l'injection DOM dans le content**
  (constat, mécanisme exact inconnu). Revert final ec22b88 = collage OK
  (à re-vérifier au restart). WIP sauvé dans l'historique (e753c98).
- [leçon, prouvée] **Ne JAMAIS injecter de DOM dans le content du tool**
  (même un <style> vide) — le collage meurt. L'épuration passera par une
  agent stylesheet côté chrome (loadAndRegisterSheet), zéro injection DOM.
- [leçon] Le turnstile se charge dans le ghost dès la navigation (iframe
  challenges.cloudflare.com constatée en Browser Console 01:19)
- [leçon, outil] debug.log est devenu muet en cours de session (writes en
  échec silencieux depuis 00:13:54) — la Browser Console reste la source
  quand le log se tait
