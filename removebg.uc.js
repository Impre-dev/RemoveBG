// ==UserScript==
// @name           RemoveBG — Engine
// @version        0.13.0
// @description    Retrait de BG sans friction : toast au download, ghost browser, paste natif
// @author         Impre
// @include        main
// ==/UserScript==

(function () {
    'use strict';

    // ═══════════════════════════════════════════════════════════════════
    //  RemoveBG — moteur (REVERT test : reconstruction de l'état v0.6.2)
    //
    //  Flow cible :
    //    1. Download d'image détecté (event Downloads view — pas de polling)
    //    2. Toast bas-droite "Remove background?" + auto-dismiss par
    //       transition CSS + event transitionend (zéro timer JS)
    //    3. Clic Oui → ghost browser off-screen charge le tool
    //    4. Copie clipboard (helper screenshot : nativeimage SANS tiret)
    //       + paste NATIF (commandManager)
    //    5. PHASE 8 (vision setup idéal) : le site tourne HORS CHAMP —
    //       l'overlay n'est révélé qu'au résultat, recadré sur le rectangle
    //       damier seul. Clic sur l'image → PNG dans Downloads → envol.
    //
    //  ⚠️ Leçons de plateforme (prouvées 01/11) :
    //  - installMod écrase les fichiers locaux par le contenu GitHub.
    //  - Browser remoté hors-tab sous Fission : frame script via messageManager.
    //  - Clipboard : flavor 'application/x-moz-nativeimage' (SANS tiret).
    //  - IOUtils.write refuse les strings → writeUTF8 + buffer/overwrite.
    // ═══════════════════════════════════════════════════════════════════

    const MOD_ID = 'RemoveBG';
    const LOG_PREFIX = '[RemoveBG]';

    const TOOL_URL = 'https://www.photoroom.com/tools/background-remover';

    const MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/avif']);
    const FILE_EXTS = new Set(['jpg', 'jpeg', 'png', 'webp', 'avif']);

    const TOAST_SECONDS = 4;
    const PROCESSING_SECONDS = 15; // filet d'échec — jauge MASQUÉE en mode traitement

    const HTML_NS = 'http://www.w3.org/1999/xhtml';

    const EXT_MIME = {
        jpg: 'image/jpeg',
        jpeg: 'image/jpeg',
        png: 'image/png',
        webp: 'image/webp',
        avif: 'image/avif',
    };

    function log(...args) {
        const msg = args
            .map((a) => {
                if (typeof a === 'string') return a;
                if (a instanceof Error) return a.message;
                // DOMException & co : message non-énumérable → JSON donnait {}
                if (a && typeof a === 'object' && 'message' in a) return `${a.name ?? 'err'}: ${a.message}`;
                return JSON.stringify(a);
            })
            .join(' ');
        console.log(LOG_PREFIX, ...args);
        logFile('chrome', msg);
    }

    // Flux verbeux (événements fréquents) — muet par défaut ; basculer
    // DEBUG_LOG à true pour instrumenter une session de diagnostic.
    const DEBUG_LOG = false;
    function logDebug(...args) {
        if (DEBUG_LOG) log(...args);
    }

    // ── Debug log fichier (copyDebug — purge après diagnostic, gitigné) ──
    const LOG_PATH = PathUtils.join(
        PathUtils.profileDir,
        'chrome',
        'sine-mods',
        'RemoveBG',
        'debug.log'
    );
    let logLines = [];
    let logChain = Promise.resolve();
    function logFile(tag, data) {
        logLines.push(`[${new Date().toISOString()}] [${tag}] ${data}`);
        logChain = logChain.then(() =>
            IOUtils.writeUTF8(LOG_PATH, logLines.join('\n') + '\n', { mode: 'overwrite' }).catch((e) =>
                console.error(LOG_PREFIX, 'logFile KO :', e)
            )
        );
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

    // Spec de la source du download (string OU nsIURI selon les versions)
    function downloadSourceSpec(d) {
        const u = d.source?.url;
        if (!u) return '';
        return typeof u === 'string' ? u : u.spec || '';
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

        const title = doc.createElementNS(HTML_NS, 'div');
        title.className = 'rmbg-title';
        title.textContent = "Supprimer le fond de l'image ?";

        const name = doc.createElementNS(HTML_NS, 'div');
        name.className = 'rmbg-name';

        // Compteur : barre en bas du toast, se vide en 4s — transitionend
        // déclenche le dismiss (zéro timer JS).
        const countdown = doc.createElementNS(HTML_NS, 'span');
        countdown.className = 'rmbg-countdown';

        root.appendChild(thumb);
        body.appendChild(title);
        body.appendChild(name);
        root.appendChild(body);
        root.appendChild(countdown);
        // Shimmer du mode traitement : nature visuelle DIFFÉRENTE de la
        // jauge — jamais deux minuteurs qui se suivent au même endroit.
        const shimmer = doc.createElementNS(HTML_NS, 'span');
        shimmer.className = 'rmbg-shimmer';
        root.appendChild(shimmer);
        doc.documentElement.appendChild(root);

        toastEls = { root, thumb, title, body, name, countdown, shimmer, current: null, mode: null };

        // Le toast ENTIER est le bouton en mode « ask » uniquement —
        // traitement/fin sont informatifs (curseur default, clic no-op).
        root.addEventListener('click', () => {
            const t = toastEls;
            if (t.mode !== 'ask') return;
            const d = t.current;
            const path = d?.target?.path;
            dismissToast();
            if (path) startRemoveBG(path);
        });

        // Auto-dismiss : transition CSS → event transitionend (zéro timer).
        // ask = fin naturelle · processing = filet d'échec (résultat jamais
        // venu) · done = fin naturelle.
        countdown.addEventListener('transitionend', (e) => {
            if (e.propertyName !== 'width') return;
            if (toastEls.mode === 'processing') log('Timeout processing — résultat jamais venu (elapsed=' + e.elapsedTime.toFixed(1) + 's)');
            dismissToast();
        });

        return toastEls;
    }

    function dismissToast() {
        if (!toastEls) return;
        toastEls.mode = null;
        toastEls.countdown.classList.remove('run');
        toastEls.root.hidden = true;
        toastEls.current = null;
    }

    // Un seul objet UI raconte le cycle : ask (« Supprimer le fond ? »,
    // cliquable) → processing (« Suppression du fond… », shimmer, jauge
    // 15 s masquée = filet d'échec, interrompue au résultat). Zéro timer JS.
    function presentToast({ title, name, thumbPath, seconds, mode, download = null }) {
        const t = getToast();
        t.mode = mode;
        t.current = download;
        t.title.textContent = title;
        t.name.textContent = name;
        t.name.title = name;
        if (thumbPath) t.thumb.style.backgroundImage = `url("${PathUtils.toFileURI(thumbPath)}")`;
        // Afficher AVANT de lancer la transition : une transition ne démarre
        // jamais sur un élément display:none → toast immortel.
        t.root.classList.toggle('rmbg-busy', mode !== 'ask');
        t.root.hidden = false;
        t.countdown.classList.remove('run');
        // Reset EXPLICITE de la largeur : annuler une transition (remove de
        // .run) laisse la propriété à sa valeur COURANTE (spec) — la jauge
        // repartait de l'endroit du clic et le filet tirait trop tôt.
        t.countdown.style.transition = 'none';
        t.countdown.style.width = '100%';
        void t.countdown.offsetWidth;
        t.countdown.style.transition = '';
        t.countdown.style.width = '';
        t.countdown.style.transitionDuration = `${seconds}s`;
        t.countdown.classList.add('run');
    }

    function showToast(download) {
        const path = download.target?.path || '';
        const filename = path.split(/[\\/]/).pop() || 'image';
        presentToast({
            title: "Supprimer le fond de l'image ?",
            name: filename,
            thumbPath: path,
            seconds: TOAST_SECONDS,
            mode: 'ask',
            download,
        });
        log('Toast affiché →', filename);
    }

    async function initDownloadsListener() {
        const { Downloads } = ChromeUtils.importESModule('resource://gre/modules/Downloads.sys.mjs');
        const list = await Downloads.getList(Downloads.ALL);

        const view = {
            onDownloadAdded(download) {
                const spec = downloadSourceSpec(download);
                // Anti-boucle : tout DL photoroom (page ou blob: — le blob
                // porte l'origine) ne déclenche JAMAIS le toast.
                if (spec.includes('photoroom.com')) {
                    download.__removebgResult = true;
                    logDebug('DL photoroom ajouté — source:', spec);
                    return;
                }
                if (isImageDownload(download)) {
                    download.__removebgCandidate = true;
                }
            },
            onDownloadChanged(download) {
                if (download.__removebgResult && download.succeeded) {
                    download.__removebgResult = false;
                    onResultDownloaded(download);
                    return;
                }
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
    //  PHASE 3 — Ghost browser off-screen + chargement du tool
    // ═══════════════════════════════════════════════════════════════════

    let ghost = null; // { browser, wrap }
    let pipelineActive = false; // collage → DL résultat (fenêtre du résultat attendu)

    function getGhost() {
        if (ghost) return ghost;
        // Wrapper chrome : le browser + le bouton ✕ vivent dedans — le ✕
        // reste cliquable PAR-DESSUS le content (jamais dans le DOM du
        // site, cf. leçon injection DOM du 02/11).
        const wrap = document.createElementNS(HTML_NS, 'div');
        wrap.id = 'removebg-ghost-wrap';

        const b = document.createXULElement('browser');
        b.id = 'removebg-ghost';
        b.setAttribute('type', 'content');
        b.setAttribute('remote', 'true');
        b.setAttribute('disablehistory', 'true');
        // Canvas transparent : le fond blanc opaque de Gecko ne peint plus —
        // le site (rendu transparent en agent sheet) laisse voir le fond
        // verre du wrapper, floutant la page Zen derrière (comme le toast).
        b.setAttribute('transparent', 'true');

        const close = document.createElementNS(HTML_NS, 'button');
        close.id = 'removebg-ghost-close';
        close.textContent = '✕';
        close.title = 'Fermer l\'overlay';
        close.addEventListener('click', () => {
            // Purge complète : sinon le tool reste en état « résultat N-1 »
            // (et le re-DL hérite d'une session résiduelle → D13).
            purgeGhostTool();
            log('Overlay fermé manuellement');
        });

        // Couche cliquable (phase 8) : TOUTE la surface du damier = bouton
        // (clic → fetch du PNG résultat → Downloads → envol). Sous la croix
        // (z-index), qui ne montre qu'au survol du wrap.
        const clickzone = document.createElementNS(HTML_NS, 'div');
        clickzone.id = 'removebg-ghost-clickzone';
        clickzone.title = "Télécharger l'image (sans fond)";
        clickzone.addEventListener('click', () => {
            log('Clic damier → fetch résultat via frame script');
            ghost.browser.messageManager.sendAsyncMessage('RemoveBG:FetchResult', {});
        });

        wrap.appendChild(b);
        wrap.appendChild(clickzone);
        wrap.appendChild(close);
        document.documentElement.appendChild(wrap);
        ghost = { browser: b, wrap };
        logDebug('Ghost browser créé');
        return ghost;
    }

    function revealGhost() {
        getGhost().wrap.classList.add('rmbg-ghost-visible');
    }

    function hideGhost() {
        ghost?.wrap.classList.remove('rmbg-ghost-visible');
    }

    // ═══════════════════════════════════════════════════════════════════
    //  PHASE 8 — VISION SETUP IDÉAL : overlay = rectangle damier seul.
    //  ① Le frame script mesure l'img résultat (img[class*="bg-damier"],
    //  ancre design-system du dump ToolV2) → ResultRect.
    //  ② Le wrap recadre : taille = rect mesuré, browser décalé en négatif
    //  MAIS GARDE SA TAILLE (zéro reflow du site — le rect reste valide) ;
    //  l'overlay n'est révélé QU'ICI : montage, segmentation, captcha
    //  restent hors champ pour toujours.
    //  ③ Clic (couche cliquable chrome) → frame script fetch(img.src) —
    //  blob:/data: même origine : le PNG transparent déjà en mémoire,
    //  zéro appel réseau, zéro clic export (règle captcha respectée : on
    //  lit localement ce qui est déjà affiché) → buffer → IOUtils.write à
    //  côté de l'original → envol.
    //  ④ Croix native du site (handleReset) = imgs démontées → ResultGone
    //  → purge. Lecture seule, jamais d'injection dans le DOM du site.
    // ═══════════════════════════════════════════════════════════════════

    let currentSource = null; // { path } du download à l'origine du pipeline

    const RESULT_EXT = {
        'image/png': 'png',
        'image/jpeg': 'jpg',
        'image/webp': 'webp',
        'image/avif': 'avif',
    };

    // Son de succès (level-up.mp3 embarqué, choix opérateur — lu nativement
    // par le Audio() du chrome, zéro conversion).
    function playSuccess() {
        try {
            const audio = new Audio(PathUtils.toFileURI(
                PathUtils.join(PathUtils.profileDir, 'chrome', 'sine-mods', 'RemoveBG', 'level-up.mp3')
            ));
            audio.volume = 0.5;
            audio.play();
        } catch (e) {
            log('ERREUR son :', e?.message || String(e));
        }
    }

    function applyResultCrop(rect) {
        const g = getGhost();
        const br = g.browser.getBoundingClientRect(); // taille actuelle (≈ wrap 420x440)
        const x = Math.max(0, rect.x);
        const y = Math.max(0, rect.y);
        // Le browser GARDE sa taille : seul le wrap rétrécit (overflow
        // hidden) et le browser se décale en négatif — le layout du site
        // ne bouge pas d'un pixel, la mesure reste exacte.
        g.browser.style.width = br.width + 'px';
        g.browser.style.height = br.height + 'px';
        g.browser.style.marginLeft = -x + 'px';
        g.browser.style.marginTop = -y + 'px';
        g.wrap.style.width = rect.w + 'px';
        g.wrap.style.height = rect.h + 'px';
        // Relais visuel : le toast « Traitement… » s'efface pendant que le
        // damier apparaît (jamais un « ask » d'un autre DL en vol).
        if (toastEls?.mode === 'processing') dismissToast();
        revealGhost();
        log(`Résultat cadré ${Math.round(rect.w)}x${Math.round(rect.h)} @ ${Math.round(x)},${Math.round(y)} — overlay révélé`);
    }

    // Base64 → bytes : une string frame→chrome passe toujours, un buffer
    // pas forcément (leçon saveResult {}).
    function b64ToBytes(b64) {
        const bin = atob(b64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        return bytes;
    }

    async function saveResult({ b64, mime, size }) {
        try {
            const ext = RESULT_EXT[mime] || 'png';
            const base = (currentSource?.path || 'image.png').replace(/\.[^./\\]+$/, '');
            const path = `${base}-nobg.${ext}`;
            await IOUtils.write(path, b64ToBytes(b64), { mode: 'overwrite' });
            log(`Résultat sauvegardé (${Math.round((size || 0) / 1024)} Ko) →`, path);
            playSuccess();
            showResultVeil();
        } catch (e) {
            // Log PARLANT : le `{}` historique masquait le message réel.
            log('ERREUR saveResult :', e?.message || String(e));
        }
    }

    // Étape 2 — confirmation DL : voile vert transparent + chevron ✓ sur
    // l'image, puis envol du carré. Enchaînement par animationend —
    // transform/opacity only (composited, zéro layout), zéro timer JS.
    function showResultVeil() {
        const g = getGhost();
        if (!g.wrap.__rmbgCloseBound) {
            g.wrap.__rmbgCloseBound = true;
            g.wrap.addEventListener('animationend', (e) => {
                if (e.animationName === 'rmbg-close') purgeGhostTool();
            });
        }
        let veil = g.wrap.querySelector('.rmbg-veil');
        if (!veil) {
            veil = document.createElementNS(HTML_NS, 'div');
            veil.className = 'rmbg-veil';
            const check = document.createElementNS(HTML_NS, 'span');
            check.className = 'rmbg-veil-check';
            check.textContent = '✓';
            veil.appendChild(check);
            veil.addEventListener('animationend', (e) => {
                if (e.animationName === 'rmbg-veil-in') g.wrap.classList.add('rmbg-closing');
            });
            g.wrap.appendChild(veil);
        }
        // Redémarrage propre si un cycle précédent a laissé des classes.
        veil.classList.remove('rmbg-veil-in');
        g.wrap.classList.remove('rmbg-closing');
        void veil.offsetWidth;
        veil.classList.add('rmbg-veil-in');
    }

    // ═══════════════════════════════════════════════════════════════════
    //  PHASE 6 — Résultat : fermeture de l'overlay sur DL (JAMAIS auto-DL)
    //  Règle de survie : le captcha du tool est actif pendant la fenêtre
    //  pipeline — un DL automatique pendant sa présence = signal bot.
    //  L'humain clique Download, TOUJOURS ; le mod ne fait que détecter
    //  ce DL et refermer l'overlay derrière lui.
    // ═══════════════════════════════════════════════════════════════════

    function purgeSiteData() {
        // D13 : le re-load du tool avec session résiduelle (cookies,
        // localStorage, IndexedDB websiteHandoff) re-render le turnstile
        // AVANT la dropzone et l'api.js est ORB-bloquée → l'UI ne monte
        // jamais. Chaque fermeture = session photoroom détruite : chaque
        // re-DL repart exactement comme un 1er load (qui, lui, marche).
        try {
            const principal = Services.scriptSecurityManager
                .createContentPrincipalFromOrigin('https://www.photoroom.com');
            const flags = Components.interfaces.nsIClearDataService.CLEAR_ALL;
            Services.clearData.deleteDataFromPrincipal(principal, false, flags, () => {
                logDebug('Site-data photoroom purgé (cookies + storage)');
            });
        } catch (e) {
            log('ERREUR purge site-data :', e);
        }
    }

    function purgeGhostTool() {
        const g = getGhost();
        hideGhost();
        // Reset du recadrage (phase 8) : inline styles vidés — le prochain
        // cycle repart du wrap plein, browser 100%/100%.
        g.browser.style.width = '';
        g.browser.style.height = '';
        g.browser.style.marginLeft = '';
        g.browser.style.marginTop = '';
        g.wrap.style.width = '';
        g.wrap.style.height = '';
        // Cleanup du voile de confirmation (étape 2) + classe d'envol.
        const veil = g.wrap.querySelector('.rmbg-veil');
        if (veil) veil.remove();
        g.wrap.classList.remove('rmbg-closing');
        try {
            // Purge du tool : l'élément reste (réutilisé tel quel), la page
            // est déchargée. loadTool() re-naviguera au prochain run.
            g.browser.loadURI(Services.io.newURI('about:blank'), {
                triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal(),
            });
        } catch (e) {
            log('ERREUR purge ghost :', e);
        }
        pipelineActive = false;
        purgeSiteData();
    }

    function closeGhostAfterResult() {
        purgeGhostTool();
        log('Overlay fermé — résultat téléchargé');
    }

    function onResultDownloaded(download) {
        if (!pipelineActive) {
            log('DL photoroom hors pipeline — overlay déjà calme');
            return;
        }
        const path = download.target?.path || '';
        log('Résultat téléchargé →', path.split(/[\\/]/).pop());
        closeGhostAfterResult();
    }

    async function loadTool() {
        const g = getGhost();
        const current = g.browser.currentURI?.spec;
        if (current && current.startsWith('https://www.photoroom.com')) {
            logDebug('Tool déjà chargé — réutilisation (zéro reload)');
            return;
        }
        const principal = Services.scriptSecurityManager.createContentPrincipalFromOrigin(
            'https://www.photoroom.com'
        );
        const uri = Services.io.newURI(TOOL_URL);
        g.browser.loadURI(uri, { triggeringPrincipal: principal });
        // D13 (02/11) : le frame script initial ne survit pas au cycle
        // purge about:blank → re-nav (site prêt, collage manuel OK, mais
        // jamais de Ready) → on le re-charge à CHAQUE navigation.
        // (Les listeners chrome, eux, sont liés une seule fois — cf.
        // attachFrameScript.)
        attachFrameScript(g.browser);
        logDebug('Navigation lancée');
    }

    // ═══════════════════════════════════════════════════════════════════
    //  Frame script — signale que la dropzone du tool est montée.
    // ═══════════════════════════════════════════════════════════════════

    const FRAME_SCRIPT_SRC = `(function () {
    // Idempotence : une même navigation peut injecter DEUX fois ce script
    // (inscription directe + delayed du loadFrameScript) — une seule
    // instance active par document, sinon listeners en double.
    try {
        if (content.wrappedJSObject.__rmbgFrameActive) return;
        content.wrappedJSObject.__rmbgFrameActive = true;
    } catch (e) {}
    const ACCEPT = 'image/jpeg,image/png,image/webp,image/avif';
    const SELECTOR = 'input[type="file"][accept="' + ACCEPT + '"]';
    let announced = false;
    addEventListener('focus', () => {
        try { sendAsyncMessage('RemoveBG:Focused', {}); } catch (e) {}
    }, true);
    const announce = () => {
        if (announced) return;
        try {
            if (content.document.querySelector(SELECTOR)) {
                announced = true;
                sendAsyncMessage('RemoveBG:Ready', {});
            }
        } catch (e) {}
    };
    // DIAG paste : détails de l'event pour trancher event-vs-contenu
    addEventListener('paste', (e) => {
        try {
            const dt = e.clipboardData;
            const f = dt && dt.files && dt.files[0];
            sendAsyncMessage('RemoveBG:Pasted', {
                files: dt ? dt.files.length : -1,
                name: f ? f.name : null,
                type: f ? f.type : null,
                size: f ? f.size : null,
                target: (e.target && e.target.nodeName) || null,
                active: (content.document.activeElement && content.document.activeElement.nodeName) || null,
                trusted: e.isTrusted,
            });
        } catch (err) {
            sendAsyncMessage('RemoveBG:Pasted', { files: 'err:' + String(err) });
        }
    }, true);
    // ─── Phase 8 : suivi du résultat (LECTURE SEULE) ───
    // Le résultat affiché = img[class*="bg-damier"] (deux imgs superposées,
    // même boîte). Apparition → mesure du rect (le damier peint LA BOÎTE de
    // l'élément — object-contain letterbox compris) → ResultRect.
    // Disparition (croix native = handleReset démonte les imgs) → ResultGone.
    const DAMIER_SEL = 'img[class*="bg-damier"]';
    let trackedResult = null;
    const measureResult = (img) => {
        try {
            const r = img.getBoundingClientRect();
            if (r.width < 2 || r.height < 2) return;
            sendAsyncMessage('RemoveBG:ResultRect', {
                x: r.left, y: r.top, w: r.width, h: r.height,
                src: img.currentSrc || img.src,
                nw: img.naturalWidth, nh: img.naturalHeight,
            });
        } catch (e) {}
    };
    const armResultMeasure = (img) => {
        if (img.complete && img.naturalWidth > 0) {
            measureResult(img);
            // Filet : si le layout n'était pas prêt (rect ~0), re-mesure
            // au frame suivant — doublon bénin (valeurs identiques).
            content.requestAnimationFrame(() => measureResult(img));
        } else {
            img.addEventListener('load', () => measureResult(img), { once: true });
        }
    };
    let resultObserved = false;
    const tryObserveResult = () => {
        if (resultObserved) return;
        try {
            if (!content || !content.document || !content.document.documentElement) return;
            resultObserved = true;
            const mo = new content.MutationObserver(() => {
                try {
                    const img = content.document.querySelector(DAMIER_SEL);
                    if (img && img !== trackedResult) {
                        trackedResult = img;
                        armResultMeasure(img);
                    } else if (!img && trackedResult) {
                        trackedResult = null;
                        sendAsyncMessage('RemoveBG:ResultGone', {});
                    }
                } catch (e) {}
            });
            mo.observe(content.document.documentElement, { childList: true, subtree: true });
            const img = content.document.querySelector(DAMIER_SEL);
            if (img) { trackedResult = img; armResultMeasure(img); }
        } catch (e) {}
    };
    const tryObserve = () => {
        if (announced) return;
        try {
            if (!content || !content.document || !content.document.documentElement) return;
            announce();
            const mo = new content.MutationObserver(() => {
                try {
                    if (content && content.document && content.document.querySelector(SELECTOR)) {
                        mo.disconnect();
                        announced = true;
                        sendAsyncMessage('RemoveBG:Ready', {});
                    }
                } catch (e) {}
            });
            mo.observe(content.document.documentElement, { childList: true, subtree: true });
        } catch (e) {}
    };
    tryObserve();
    tryObserveResult();
    addEventListener('DOMContentLoaded', tryObserve, true);
    addEventListener('DOMContentLoaded', tryObserveResult, true);
    addEventListener('pageshow', tryObserve, true);
    addEventListener('pageshow', tryObserveResult, true);
    addMessageListener('RemoveBG:DoPaste', () => {
        // Paste NATIF : le command manager DU CONTENT exécute cmd_paste
        try {
            const cmdMgr = docShell.commandManager;
            cmdMgr.doCommand('cmd_paste', null, content);
            sendAsyncMessage('RemoveBG:DoPasteResult', { ok: true });
        } catch (e) {
            try {
                const ok = content.document.execCommand('paste');
                sendAsyncMessage('RemoveBG:DoPasteResult', { ok });
            } catch (e2) {
                sendAsyncMessage('RemoveBG:DoPasteResult', { ok: false, error: String(e2) });
            }
        }
    });
    // Phase 8 : le PNG résultat est déjà en mémoire (blob:/data:) — fetch
    // local, zéro réseau, zéro clic export. Buffer structuré-cloné au chrome.
    addMessageListener('RemoveBG:FetchResult', () => {
        (async () => {
            try {
                const img = content.document.querySelector(DAMIER_SEL);
                if (!img) {
                    sendAsyncMessage('RemoveBG:ResultBlob', { err: 'img damier introuvable' });
                    return;
                }
                const resp = await fetch(img.currentSrc || img.src);
                const blob = await resp.blob();
                // Transport BLINDÉ : base64 (string). L'ArrayBuffer brut à
                // travers le message manager faisait échouer le write côté
                // chrome (ERREUR saveResult {} x3 — constats 03:40 + 04:18).
                const bytes = new Uint8Array(await blob.arrayBuffer());
                let bin = '';
                for (let i = 0; i < bytes.length; i += 0x8000) {
                    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
                }
                sendAsyncMessage('RemoveBG:ResultBlob', {
                    b64: btoa(bin),
                    mime: blob.type || 'image/png',
                    nw: img.naturalWidth,
                    nh: img.naturalHeight,
                    size: bytes.length,
                });
            } catch (e) {
                sendAsyncMessage('RemoveBG:ResultBlob', { err: String(e) });
            }
        })();
    });
})();`;

    const FRAME_SCRIPT_URI = `data:application/javascript;charset=utf-8,${encodeURIComponent(
        FRAME_SCRIPT_SRC
    )}`;

    let pendingReady = null;
    let lastReadyAt = 0; // timestamp du dernier Ready reçu (race condition 2e cycle)

    function attachFrameScript(browser) {
        const mm = browser.messageManager;
        // D13 : le frame script est rechargé à CHAQUE navigation (il ne
        // survit pas au cycle purge → re-nav). Les listeners chrome, eux,
        // vivent sur le messageManager (persistent aux navigations) → une
        // seule liaison par browser.
        mm.loadFrameScript(FRAME_SCRIPT_URI, true);
        if (browser.__rmbgMmBound) return;
        browser.__rmbgMmBound = true;
        mm.addMessageListener('RemoveBG:Ready', () => {
            lastReadyAt = Date.now();
            logDebug('Dropzone prête (frame script)');
            pendingReady?.resolve();
        });
        mm.addMessageListener('RemoveBG:Pasted', (msg) => {
            const d = msg.data;
            logDebug(
                `DIAG paste — files=${d.files} name=${d.name} type=${d.type} size=${d.size}` +
                    ` target=${d.target} active=${d.active} trusted=${d.trusted}`
            );
            // Le tool a reçu le paste → le presse-papier peut être rendu.
            if (clipboardRestore) {
                const snap = clipboardRestore.snap;
                clipboardRestore = null;
                // Déféré : le handler du site (bubble) lit clipboardData au
                // dispatch — on rend le presse-papier APRÈS la fin de l'event
                // (yield event loop, autorisé — pas un polling).
                setTimeout(() => restoreClipboard(snap), 0);
            }
        });
        mm.addMessageListener('RemoveBG:Focused', () => {
            logDebug('Content window a le focus');
            pendingFocused?.resolve();
        });
        // ─── Phase 8 : recadrage damier + sauvegarde directe ───
        mm.addMessageListener('RemoveBG:ResultRect', (msg) => {
            if (!pipelineActive) return;
            applyResultCrop(msg.data);
        });
        mm.addMessageListener('RemoveBG:ResultGone', () => {
            if (!pipelineActive) return;
            log('Résultat disparu (croix native) — reset');
            purgeGhostTool();
        });
        mm.addMessageListener('RemoveBG:ResultBlob', (msg) => {
            const d = msg.data;
            if (d.err) {
                log('ERREUR fetch résultat (frame) :', d.err);
                return;
            }
            saveResult(d);
        });
    }

    function waitForReady() {
        return new Promise((res) => {
            // Race condition du 2e cycle : en re-navigation, le tool se
            // monte depuis le cache disque PLUS VITE que le chrome
            // n'atteint waitForReady() — le message Ready est consommé
            // avant l'abonnement, la promise pendrait à jamais et le
            // clipboard ne serait jamais écrit (bug « 1ère image
            // réaffichée »). Si un Ready est tout récent, ce chargement
            // est déjà prêt.
            if (Date.now() - lastReadyAt < 5000) {
                res();
                return;
            }
            pendingReady = { resolve: res };
        });
    }

    // ═══════════════════════════════════════════════════════════════════
    //  PHASE 4 — Clipboard (helper screenshot) + paste NATIF
    // ═══════════════════════════════════════════════════════════════════

    const CLIP = {
        get TI() {
            return Components.interfaces.nsITransferable;
        },
        get svc() {
            return Components.classes['@mozilla.org/widget/clipboard;1'].getService(
                Components.interfaces.nsIClipboard
            );
        },
    };

    let clipboardRestore = null; // { snap } — restauré au paste confirmé

    function snapshotClipboard() {
        const snap = {};
        for (const flavor of ['text/unicode', 'application/x-moz-nativeimage']) {
            try {
                const xfer = Components.classes['@mozilla.org/widget/transferable;1'].createInstance(CLIP.TI);
                xfer.init(null);
                xfer.addDataFlavor(flavor);
                CLIP.svc.getData(xfer, CLIP.svc.kGlobalClipboard);
                const holder = {};
                xfer.getTransferData(flavor, holder);
                if (holder.value?.value) snap[flavor] = holder.value.value;
            } catch (e) {}
        }
        return snap;
    }

    function restoreClipboard(snap) {
        try {
            const xfer = Components.classes['@mozilla.org/widget/transferable;1'].createInstance(CLIP.TI);
            xfer.init(null);
            let any = false;
            if (snap['text/unicode']) {
                xfer.addDataFlavor('text/unicode');
                xfer.setTransferData('text/unicode', snap['text/unicode']);
                any = true;
            }
            if (snap['application/x-moz-nativeimage']) {
                xfer.addDataFlavor('application/x-moz-nativeimage');
                xfer.setTransferData('application/x-moz-nativeimage', snap['application/x-moz-nativeimage']);
                any = true;
            }
            if (any) CLIP.svc.setData(xfer, null, CLIP.svc.kGlobalClipboard);
            log('Presse-papier restauré');
        } catch (e) {
            log('Restauration presse-papier échouée :', e);
        }
    }

    function fileToPNGArrayBuffer(path) {
        // Le fichier (webp/jpeg/avif) → PNG ArrayBuffer : l'entrée EXACTE
        // attendue par le helper screenshot.
        return new Promise((resolve, reject) => {
            const img = document.createElementNS(HTML_NS, 'img');
            img.onload = () => {
                img.decode().then(() => {
                    try {
                        const canvas = document.createElementNS(HTML_NS, 'canvas');
                        canvas.width = img.naturalWidth;
                        canvas.height = img.naturalHeight;
                        canvas.getContext('2d').drawImage(img, 0, 0);
                        canvas.toBlob(
                            (blob) => {
                                if (!blob) {
                                    reject(new Error('toBlob PNG a échoué'));
                                    return;
                                }
                                blob.arrayBuffer().then(resolve, reject);
                            },
                            'image/png'
                        );
                    } catch (e) {
                        reject(e);
                    }
                }, reject);
            };
            img.onerror = () => reject(new Error('Chargement image impossible : ' + path));
            img.src = PathUtils.toFileURI(path);
        });
    }

    async function writeImageToClipboard(path) {
        // Miroir EXACT de BrowserUtils.copyImageToClipboard (omni.ja Zen,
        // la voie des screenshots) : PNG ArrayBuffer → decodeImageFrom
        // ArrayBuffer('image/png') → flavor 'application/x-moz-nativeimage'
        // (⚠️ SANS tiret — l'ancien 'x-moz-native-image' était inconnu de
        // l'OS : root cause du blocker D11).
        const png = await fileToPNGArrayBuffer(path);
        const imageTools = Components.classes['@mozilla.org/image/tools;1'].getService(
            Components.interfaces.imgITools
        );
        const imgDecoded = imageTools.decodeImageFromArrayBuffer(png, 'image/png');
        const xfer = Components.classes['@mozilla.org/widget/transferable;1'].createInstance(
            Components.interfaces.nsITransferable
        );
        xfer.init(null);
        xfer.addDataFlavor('application/x-moz-nativeimage');
        xfer.setTransferData('application/x-moz-nativeimage', imgDecoded);
        Services.clipboard.setData(xfer, null, Services.clipboard.kGlobalClipboard);
        logDebug('Image écrite au clipboard (nativeimage depuis PNG) — helper screenshot');
    }

    let pendingFocused = null;

    function waitForFocused() {
        return new Promise((res) => {
            pendingFocused = { resolve: res };
        });
    }

    function focusGhost() {
        const b = ghost.browser;
        attachFrameScript(b);
        b.focus();
        // Le focus traverse les process en async (Fission) : attendre la
        // confirmation du content (filet LAST RESORT 400 ms).
        return Promise.race([
            waitForFocused(),
            new Promise((res) => setTimeout(res, 400)),
        ]);
    }

    // Ctrl+V au niveau SYSTÈME (idée opérateur 01/11 : « lancer un .py qui
    // fait un ctrl au niveau du système ») — implémenté via PowerShell
    // SendKeys : présent sur tout Windows, zéro dépendance. SendWait('^v')
    // injecte le raccourci dans la fenêtre foreground : le VRAI pipeline OS,
    // activation utilisateur incluse. Process éphémère (~300 ms), lancé par
    // Zen lui-même. AUCUN refocus : la fenêtre a déjà le focus (clic toast).
    function sendSystemCtrlV() {
        return new Promise((resolve) => {
            try {
                // Script AHK dédié (ctrlv.ahk à côté du mod) — AutoHotkey est
                // déjà de confiance sur la machine (Bitdefender le tolère),
                // contrairement à powershell.exe enfant de zen.exe (blocage
                // ATD, constat v0.9.2/0.9.3).
                const scriptPath = PathUtils.join(
                    PathUtils.profileDir,
                    'chrome',
                    'sine-mods',
                    'RemoveBG',
                    'ctrlv.ahk'
                );
                // ⚠️ proc.init() = l'EXÉCUTABLE (AutoHotkey64.exe) — le .ahk
                // est un ARGUMENT.
                const exePath = 'C:\\Program Files\\AutoHotkey\\v2\\AutoHotkey64.exe';
                // nsIFile sans .init (retiré des versions modernes) : passer
                // par nsIFileURL, fallback initWithPath
                let ps;
                try {
                    ps = Services.io
                        .newURI('file:///' + exePath.replace(/\\/g, '/'))
                        .QueryInterface(Components.interfaces.nsIFileURL).file;
                } catch (e) {
                    ps = Components.classes['@mozilla.org/file/local;1'].createInstance(
                        Components.interfaces.nsIFile
                    );
                    if (typeof ps.initWithPath === 'function') ps.initWithPath(exePath);
                    else ps.init(exePath);
                }
                const proc = Components.classes['@mozilla.org/process/util;1'].createInstance(
                    Components.interfaces.nsIProcess
                );
                proc.init(ps);
                const args = [scriptPath];
                proc.runAsync(args, args.length, {
                    observe(subject, topic) {
                        logDebug('Ctrl+V système terminé :', topic);
                        resolve(topic === 'process-finished');
                    },
                });
                logDebug('Ctrl+V AHK lancé (Send ^v)');
            } catch (e) {
                log('ERREUR lancement Ctrl+V système :', e);
                resolve(false);
            }
        });
    }

    // ═══════════════════════════════════════════════════════════════════
    //  Orchestration Remove BG
    // ═══════════════════════════════════════════════════════════════════

    async function startRemoveBG(filePath) {
        try {
            log('Remove BG demandé →', filePath);
            currentSource = { path: filePath };
            // Relais visuel : le toast passe en « Traitement… » (shimmer —
            // jauge 15 s masquée = filet d'échec, interrompue au résultat).
            presentToast({
                title: 'Suppression du fond…',
                name: filePath.split(/[\\/]/).pop() || 'image',
                thumbPath: filePath,
                seconds: PROCESSING_SECONDS,
                mode: 'processing',
            });
            if (pipelineActive) {
                // Run précédent jamais refermé (résultat non venu) : remise
                // à zéro propre — le re-load repart comme un 1er cycle.
                log('Pipeline déjà actif — reset avant re-run');
                purgeGhostTool();
            }
            pipelineActive = true;
            // PAS de reveal ici (phase 8) : montage, segmentation, captcha
            // restent hors champ — l'overlay n'apparaît qu'au résultat.
            const g = getGhost();
            attachFrameScript(g.browser);
            await loadTool();
            await waitForReady();
            logDebug('Dropzone prête → écriture clipboard puis Ctrl+V système');

            const snap = snapshotClipboard();
            await writeImageToClipboard(filePath);
            await focusGhost();
            logDebug('Focus ghost OK → Ctrl+V AHK');
            await sendSystemCtrlV();
            // Restauration ARMÉE : elle partira au premier paste confirmé
            // par le tool (message Pasted) — jamais avant, sinon le Ctrl+V
            // lirait le presse-papier restauré au lieu de notre image. Si le
            // paste échoue, rien ne part : l'image reste dispo pour debug.
            clipboardRestore = { snap };
        } catch (e) {
            log('ERREUR startRemoveBG :', e);
        }
    }

    // ═══════════════════════════════════════════════════════════════════
    //  PHASE 0 — Sondage du terrain
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
            logDebug(`${ok ? '✓' : '✗'} ${name}`);
        }
        return checks;
    }

    // ═══════════════════════════════════════════════════════════════
    //  PHASE 7 — Épuration du site : AGENT STYLESHEET (zéro injection DOM)
    //  Leçon du 02/11 : injecter un <style> dans le content du tool tue le
    //  collage (même vide — constaté 01:15-01:26). La voie sûre : une
    //  feuille enregistrée côté chrome (mécanique de userContent.css, mais
    //  portée par le mod, unregister au unload). Scopée par domaine : les
    //  tabs photoroom normales reçoivent aussi le style (non utilisé par
    //  l'opérateur). AGENT_SHEET = prévalence max, pas besoin de !important.
    // ═══════════════════════════════════════════════════════════════

    const SITE_CSS = `@-moz-document domain("photoroom.com") {
    /* ═══ ÉPURATION — construite sur le dump DOM du 02/11 (3.6 Mo) ═══
       Ancres stables : attributs sémantiques + :has() sur parents directs.
       JAMAIS .component-400 seul : c'est la span du label Download ! */

    /* ─── Header / nav ─── */
    header,
    [aria-label="Open navigation"],
    .start-0.end-0.top-0.z-50 { display: none !important; }

    /* ─── Landing B2B (tabs stats, hero marketing) ─── */
    [role="tablist"], [role="tab"] { display: none !important; }
    .mx-auto.flex.max-w-\\[1072px\\].flex-col.items-center.text-center,
    .component-light-400.text-content-secondary.mx-auto.mt-6,
    .body-light-600.text-content-secondary { display: none !important; }

    /* ─── Bloc rater-promo « Want to land 50% more sales? » ───
       Le ✕ du banner = [data-rater-promo-dismiss], enfant direct du
       banner → :has(>) cible LE banner uniquement. */
    div:has(> [data-rater-promo-dismiss]) { display: none !important; }

    /* ─── Toggle Before/After (radix radiogroup, unique) ─── */
    [role="radiogroup"] { display: none !important; }

    /* ─── Pastilles couleur de fond (container direct de la pastille
       conic-gradient) ─── */
    div:has(> button[class*="conic-gradient"]) { display: none !important; }

    /* ─── Barre de CTAs : Download = DERNIER bouton de la rangée (ordre
       dump) → on tue les 4 autres sans le toucher. ─── */
    div:has(> button > span.truncate) > button:not(:last-child) {
        display: none !important;
    }

    /* ─── Breadcrumb (les DEUX formats de rendu du site) — l'ancre courte
       = le container max-w-[1200px]+pt-3 (commun aux deux). Fallbacks :
       les liens du format desktop. Une maj du site peut casser l'ancre →
       re-dumper (snippet IOUtils) et re-trouver le container en 30 s. ─── */
    [class*="max-w-[1200px]"].pt-3,
    a[href="/tools"],
    a[href="/"],
    div:has(> a[href="/tools"])
    { display: none !important; }

    /* ─── Respiration : décoller le Download du bord bas (padding du
       container de la barre de CTAs) ─── */
    div:has(> button > span.truncate) {
        padding-bottom: 16px !important;
    }

    .rounded-area-500.shadow-800 { margin-bottom: 12px !important; }

    /* ─── Spacer/footer sous la preview (container pb-6 + justify-between,
       trouvé au devtool opérateur) : tué — il créait l'écart. Version
       solide par attributs partiels. ─── */
    [class*="pb-6"][class*="justify-between"] { display: none !important; }

    /* ─── Dropzone / surface du tool en VERRE (cohérent avec le toast) —
       base ultra-subtile, hover à peine plus présent (choix opérateur) ─── */
    .bg-surface-subtle {
        background-color: #00000010 !important;
        backdrop-filter: blur(80px);
    }

    .hover\\:bg-background-subdued-hover:hover {
        background-color: #00000015 !important;
    }

    /* ─── Fond du site : c'est le BODY (bg-surface-default) qui peint le
       blanc plein — teinte légère pour laisser le carré respirer ─── */
    body.bg-surface-default { background-color: #00000010 !important; }

    /* ─── Vide au-dessus de la preview : la dropzone du tool garde un
       padding vertical propre à la landing (div.py-6 vu dans le dump) ─── */
    .py-6 { padding-top: 0 !important; padding-bottom: 0 !important; }

    /* ─── Compaction : les containers du tool ne décident plus de la
       hauteur — le carré du ghost commande. ─── */
    main { min-height: 0 !important; }
    .bg-surface-subtle.px-4,
    .rounded-area-500.shadow-800 {
        height: auto !important;
        min-height: 0 !important;
        max-height: 100% !important;
    }

    /* ─── Scroll interdit + site TRANSPARENT : le canvas du browser ne
       peint plus de blanc — c'est le fond verre du WRAPPER (chrome) qui
       apparaît derrière le contenu. ─── */
    html, body {
        overflow: hidden !important;
        height: 100% !important;
        background: transparent !important;
    }
    body.bg-surface-default { background-color: transparent !important; }
}`;

    function initSiteStyleSheet() {
        try {
            const uri = Services.io.newURI(
                'data:text/css;charset=utf-8,' + encodeURIComponent(SITE_CSS)
            );
            const sss = Components.classes['@mozilla.org/content/style-sheet-service;1']
                .getService(Components.interfaces.nsIStyleSheetService);
            if (!sss.sheetRegistered(uri, sss.AGENT_SHEET)) {
                sss.loadAndRegisterSheet(uri, sss.AGENT_SHEET);
                log('Agent stylesheet enregistrée (épuration site)');
            }
            window.addEventListener('unload', () => {
                try { sss.unregisterSheet(uri, sss.AGENT_SHEET); } catch (e) {}
            }, { once: true });
        } catch (e) {
            log('ERREUR agent stylesheet :', e);
        }
    }

    function init() {
        if (window.__removeBGPatched) return;
        if (!window.gBrowser || !gBrowser.tabContainer) {
            setTimeout(init, 500);
            return;
        }
        window.__removeBGPatched = true;

        log('init v0.13.0');
        // Header debug.log (purge copyDebug — réécrite par le 1er log en overwrite)
        logFile('chrome', '──── session start v0.13.0 ────');
        probeEnvironment();
        initDownloadsListener();
        initSiteStyleSheet();
    }

    if (document.readyState === 'complete' || document.readyState === 'interactive') init();
    else document.addEventListener('DOMContentLoaded', init, { once: true });
})();
