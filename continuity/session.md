# Session du 01/11

## État courant
Phase 1 (listener downloads + toast) : listener **validé en réel** (webp, contentType=null
→ fallback extension indispensable). Toast codé mais invisible : CSS jamais chargé car les
données Sine du mod datent de l'install v0.1.0 (sans style.chrome). v0.2.0 (script + theme)
pushée pour permettre `installMod` → **prochaine étape : installMod + restart + constat
toast stylé**. La validation du commit précède le constat (contrainte Sine) — fallback
trivial : `git revert`.

## Journal
- [jalon] Brainstorm capturé + squelette Phase 0 (97450f5) — 3 ticks verts constatés
- [découverte] DIAG copyDebug : listener OK, showToast atteint, toast invisible = CSS non
  chargé (entrypoint sine-mods/chrome.css sans import RemoveBG) → DIAG purgés
- [leçon, prouvée] `installMod` écrase le local par le contenu GitHub — jamais d'itération
  non-pushée avant un installMod (coût : la v0.2.0 locale a été perdue une fois, restaurée)
