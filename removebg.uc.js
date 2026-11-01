// ==UserScript==
// @name           RemoveBG — Engine
// @version        0.1.0
// @description    Retrait de BG sans friction : toast au download, ghost browser, captcha auto-revealed
// @author         Impre
// @include        main
// ==/UserScript==

(function () {
    'use strict';

    // ═══════════════════════════════════════════════════════════════════
    //  RemoveBG — squelette
    //
    //  Flow cible :
    //    1. Download d'image détecté (event Downloads view — pas de polling)
    //    2. Toast bas-droite "Retirer le BG ?" + auto-dismiss
    //    3. Clic Oui → ghost browser off-screen charge le tool Photoroom
    //       (off-screen = left:-99999px, JAMAIS display:none — sinon rAF gelés
    //        + Turnstile méfiant)
    //    4. Injection image via paste synthétique (document listener du site)
    //    5. Captcha interactif → monkey-patch turnstile.render (before-interactive-
    //       callback) + fallback DOM (iframe dimensions) → révélation en overlay
    //       CSS du MÊME browser (zéro reload) → clic → re-masquage auto
    //    6. Résultat téléchargé auto → ghost détruit
    //
    //  Décisions verrouillées (brainstorm 01/11) : ghost défaut, split optionnel
    //  droite 25%, V1 = tool natif injecté (le POST direct dort en discovery).
    // ═══════════════════════════════════════════════════════════════════

    const MOD_ID = 'RemoveBG';
    const LOG_PREFIX = '[RemoveBG]';

    const TOOL_URL = 'https://www.photoroom.com/tools/background-remover';

    // Formats acceptés par le tool (accept="image/jpeg,image/png,image/webp,image/avif")
    const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/avif']);

    function log(...args) {
        console.log(LOG_PREFIX, ...args);
    }

    // ═══════════════════════════════════════════════════════════════════
    //  PHASE 0 — Sondage du terrain
    //  Vérifie en réel, au restart, que toutes les APIs nécessaires
    //  sont bien là. Log = validation opérateur en console.
    // ═══════════════════════════════════════════════════════════════════

    function probeEnvironment() {
        const checks = {
            gBrowser: typeof window.gBrowser !== 'undefined' && !!gBrowser.addTab,
            gZenViewSplitter: typeof window.gZenViewSplitter !== 'undefined',
            DownloadsESModule: (() => {
                try {
                    ChromeUtils.importESModule('resource://gre/modules/Downloads.sys.mjs');
                    return true;
                } catch (e) {
                    return false;
                }
            })(),
        };
        for (const [name, ok] of Object.entries(checks)) {
            log(`${ok ? '✓' : '✗'} ${name}`);
        }
        return checks;
    }

    function init() {
        if (window.__removeBGPatched) return;
        if (!window.gBrowser || !gBrowser.tabContainer) {
            setTimeout(init, 500);
            return;
        }
        window.__removeBGPatched = true;

        log('init v0.1.0');
        probeEnvironment();

        // ── Phases suivantes (itérations à venir) ──
        // initDownloadsListener();   // Phase 1 : event onDownloadAdded → toast
        // initToastUI();             // Phase 2 : popup bas-droite stylé
        // initGhostBrowser();        // Phase 3 : browser off-screen + load tool
        // initInjection();           // Phase 4 : paste synthétique de l'image
        // initCaptchaWatch();        // Phase 5 : monkey-patch turnstile + overlay reveal
        // initAutoDownload();        // Phase 6 : capture résultat + cleanup
    }

    if (document.readyState === 'complete' || document.readyState === 'interactive') init();
    else document.addEventListener('DOMContentLoaded', init, { once: true });
})();
