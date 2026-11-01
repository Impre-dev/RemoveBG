// ==UserScript==
// @name           RemoveBG — Engine
// @version        0.2.0
// @description    Retrait de BG sans friction : toast au download, ghost browser, captcha auto-revealed
// @author         Impre
// @include        main
// ==/UserScript==

(function () {
    'use strict';

    // ═══════════════════════════════════════════════════════════════════
    //  RemoveBG — moteur
    //
    //  Flow cible :
    //    1. Download d'image détecté (event Downloads view — pas de polling)
    //    2. Toast bas-droite "Remove background?" + auto-dismiss par
    //       transition CSS + event transitionend (zéro timer JS)
    //    3. Clic Oui → ghost browser off-screen charge le tool
    //       (off-screen = left:-99999px, JAMAIS display:none — sinon rAF gelés
    //        + Turnstile méfiant)
    //    4. Injection image via paste synthétique (document listener du site)
    //    5. Captcha interactif → monkey-patch turnstile.render + fallback DOM
    //       (iframe dimensions) → révélation en overlay CSS du MÊME browser
    //       (zéro reload) → clic → re-masquage auto
    //    6. Résultat téléchargé auto → ghost détruit
    //       ⚠️ exclure ce download du listener (sinon boucle de toasts)
    //
    //  Décisions verrouillées (brainstorm 01/11) : ghost défaut, split optionnel
    //  droite 25%, V1 = tool natif injecté (le POST direct dort en discovery).
    //
    //  ⚠️ Leçon de plateforme (prouvée 01/11) : installMod écrase les fichiers
    //  locaux par le contenu GitHub — jamais d'itération locale non-pushée
    //  avant un installMod.
    // ═══════════════════════════════════════════════════════════════════

    const MOD_ID = 'RemoveBG';
    const LOG_PREFIX = '[RemoveBG]';

    const TOOL_URL = 'https://www.photoroom.com/tools/background-remover';

    // Formats acceptés par le tool (accept="image/jpeg,image/png,image/webp,image/avif")
    const MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/avif']);
    const FILE_EXTS = new Set(['jpg', 'jpeg', 'png', 'webp', 'avif']);

    // Durée d'affichage du toast (doit rester synchrone avec chrome.css .rmbg-countdown)
    const TOAST_SECONDS = 7;

    const HTML_NS = 'http://www.w3.org/1999/xhtml';

    function log(...args) {
        console.log(LOG_PREFIX, ...args);
    }

    // ═══════════════════════════════════════════════════════════════════
    //  PHASE 1 — Downloads listener (events) + Toast
    // ═══════════════════════════════════════════════════════════════════

    function isImageDownload(d) {
        if (d.contentType && MIME_TYPES.has(d.contentType)) return true;
        const path = d.target?.path || '';
        const ext = path.includes('.') ? path.split('.').pop().toLowerCase() : '';
        return FILE_EXTS.has(ext);
    }

    let toastEls = null; // refs DOM du toast (lazy)

    function getToast() {
        if (toastEls) return toastEls;
        const doc = document;

        const root = doc.createElementNS(HTML_NS, 'div');
        root.id = 'removebg-toast';
        root.hidden = true;

        const thumb = doc.createElementNS(HTML_NS, 'div');
        thumb.className = 'rmbg-thumb';

        const body = doc.createElementNS(HTML_NS, 'div');
        body.className = 'rmbg-body';

        const name = doc.createElementNS(HTML_NS, 'div');
        name.className = 'rmbg-name';

        const question = doc.createElementNS(HTML_NS, 'div');
        question.className = 'rmbg-q';
        question.textContent = 'Remove background?';

        const actions = doc.createElementNS(HTML_NS, 'div');
        actions.className = 'rmbg-actions';

        const yes = doc.createElementNS(HTML_NS, 'button');
        yes.className = 'rmbg-yes';
        yes.textContent = 'Remove BG';

        const close = doc.createElementNS(HTML_NS, 'button');
        close.className = 'rmbg-close';
        close.textContent = '✕';

        const countdown = doc.createElementNS(HTML_NS, 'div');
        countdown.className = 'rmbg-countdown';

        actions.appendChild(yes);
        body.appendChild(name);
        body.appendChild(question);
        body.appendChild(actions);
        root.appendChild(thumb);
        root.appendChild(body);
        root.appendChild(close);
        root.appendChild(countdown);
        doc.documentElement.appendChild(root);

        toastEls = { root, thumb, name, yes, close, countdown, current: null };

        yes.addEventListener('click', () => {
            const d = toastEls.current;
            log('Remove BG demandé →', d?.target?.path);
            // Phase 3 branchera ici : ghost browser + injection
            dismissToast();
        });

        close.addEventListener('click', dismissToast);

        // Auto-dismiss : transition CSS 7s → event transitionend (zéro timer)
        countdown.addEventListener('transitionend', (e) => {
            if (e.propertyName === 'width') dismissToast();
        });

        return toastEls;
    }

    function dismissToast() {
        if (!toastEls) return;
        toastEls.countdown.classList.remove('run');
        toastEls.root.hidden = true;
        toastEls.current = null;
    }

    function showToast(download) {
        const t = getToast();
        t.current = download;

        const path = download.target?.path || '';
        const filename = path.split(/[\\/]/).pop() || 'image';
        t.name.textContent = filename;
        t.name.title = filename;
        t.thumb.style.backgroundImage = `url("${PathUtils.toFileURI(path)}")`;

        // Relancer la transition : retirer .run, forcer un reflow, remettre
        t.countdown.classList.remove('run');
        void t.countdown.offsetWidth;
        t.countdown.style.transitionDuration = `${TOAST_SECONDS}s`;
        t.countdown.classList.add('run');

        t.root.hidden = false;
        log('Toast affiché →', filename);
    }

    async function initDownloadsListener() {
        const { Downloads } = ChromeUtils.importESModule('resource://gre/modules/Downloads.sys.mjs');
        const list = await Downloads.getList(Downloads.ALL);

        const view = {
            onDownloadAdded(download) {
                // Le download s'ajoute au DÉBUT : on ne marque que les images,
                // le toast partira quand le fichier sera complet (succeeded).
                // (Validé en réel 01/11 : webp avec contentType=null → le
                //  fallback extension est indispensable.)
                if (isImageDownload(download)) {
                    download.__removebgCandidate = true;
                }
            },
            onDownloadChanged(download) {
                if (download.__removebgCandidate && download.succeeded) {
                    download.__removebgCandidate = false;
                    showToast(download);
                }
            },
        };

        await list.addView(view);
        log('Downloads listener actif (events onDownloadAdded/onDownloadChanged)');
    }

    // ═══════════════════════════════════════════════════════════════════
    //  PHASE 0 — Sondage du terrain (validé 01/11 : 3 ticks verts)
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

        log('init v0.2.0');
        probeEnvironment();
        initDownloadsListener();

        // ── Phases suivantes (itérations à venir) ──
        // initGhostBrowser();        // Phase 3 : browser off-screen + load tool
        // initInjection();           // Phase 4 : paste synthétique de l'image
        // initCaptchaWatch();        // Phase 5 : monkey-patch turnstile + overlay reveal
        // initAutoDownload();        // Phase 6 : capture résultat + cleanup (+ anti-boucle)
    }

    if (document.readyState === 'complete' || document.readyState === 'interactive') init();
    else document.addEventListener('DOMContentLoaded', init, { once: true });
})();
