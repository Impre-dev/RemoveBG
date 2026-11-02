// ==UserScript==
// @name           RemoveBG — Engine
// @version        0.9.5
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
            .map((a) => (typeof a === 'string' ? a : JSON.stringify(a)))
            .join(' ');
        console.log(LOG_PREFIX, ...args);
        logFile('chrome', msg);
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
        doc.documentElement.appendChild(root);

        toastEls = { root, thumb, name, countdown, current: null };

        // Le toast ENTIER est le bouton : clic → ouvre l'overlay. Sinon
        // auto-dismiss 4s (évt transitionend).
        root.addEventListener('click', () => {
            const d = toastEls.current;
            const path = d?.target?.path;
            dismissToast();
            if (path) startRemoveBG(path);
        });

        // Auto-dismiss : transition CSS 4s → event transitionend (zéro timer)
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

        // Afficher AVANT de lancer la transition : une transition ne démarre
        // jamais sur un élément display:none — le width passait à 0 sans
        // transition, transitionend ne partait jamais → toast immortel.
        t.root.hidden = false;
        t.countdown.classList.remove('run');
        void t.countdown.offsetWidth;
        t.countdown.style.transitionDuration = `${TOAST_SECONDS}s`;
        t.countdown.classList.add('run');
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
                    log('DL photoroom ajouté — source:', spec);
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

    let ghost = null; // { browser, mmAttached }
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

        wrap.appendChild(b);
        wrap.appendChild(close);
        document.documentElement.appendChild(wrap);
        ghost = { browser: b, wrap, mmAttached: false };
        log('Ghost browser créé');
        return ghost;
    }

    function revealGhost() {
        getGhost().wrap.classList.add('rmbg-ghost-visible');
    }

    function hideGhost() {
        ghost?.wrap.classList.remove('rmbg-ghost-visible');
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
                log('Site-data photoroom purgé (cookies + storage)');
            });
        } catch (e) {
            log('ERREUR purge site-data :', e);
        }
    }

    function purgeGhostTool() {
        const g = getGhost();
        hideGhost();
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
            log('Tool déjà chargé — réutilisation (zéro reload)');
            return;
        }
        const principal = Services.scriptSecurityManager.createContentPrincipalFromOrigin(
            'https://www.photoroom.com'
        );
        const uri = Services.io.newURI(TOOL_URL);
        g.browser.loadURI(uri, { triggeringPrincipal: principal });
        // D13 (02/11) : le frame script initial ne survit pas au cycle
        // purge about:blank → re-nav (site prêt, collage manuel OK, mais
        // jamais de Ready) → on le re-charge à CHAQUE navigation. Les
        // doublons de listeners sont bénins (Ready = resolve no-op).
        ghost.mmAttached = false;
        attachFrameScript(g.browser);
        log('Navigation lancée');
    }

    // ═══════════════════════════════════════════════════════════════════
    //  Frame script — signale que la dropzone du tool est montée.
    // ═══════════════════════════════════════════════════════════════════

    const FRAME_SCRIPT_SRC = `(function () {
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
    addEventListener('DOMContentLoaded', tryObserve, true);
    addEventListener('pageshow', tryObserve, true);
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
})();`;

    const FRAME_SCRIPT_URI = `data:application/javascript;charset=utf-8,${encodeURIComponent(
        FRAME_SCRIPT_SRC
    )}`;

    let pendingReady = null;
    let lastReadyAt = 0; // timestamp du dernier Ready reçu (race condition 2e cycle)

    function attachFrameScript(browser) {
        if (ghost.mmAttached) return;
        ghost.mmAttached = true;
        const mm = browser.messageManager;
        mm.loadFrameScript(FRAME_SCRIPT_URI, true);
        mm.addMessageListener('RemoveBG:Ready', () => {
            lastReadyAt = Date.now();
            log('Dropzone prête (frame script)');
            pendingReady?.resolve();
        });
        mm.addMessageListener('RemoveBG:Pasted', (msg) => {
            const d = msg.data;
            log(
                `DIAG paste — files=${d.files} name=${d.name} type=${d.type} size=${d.size}` +
                    ` target=${d.target} active=${d.active} trusted=${d.trusted}`
            );
        });
        mm.addMessageListener('RemoveBG:Focused', () => {
            log('Content window a le focus');
            pendingFocused?.resolve();
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
        log('Image écrite au clipboard (nativeimage depuis PNG) — helper screenshot');
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
                        log('Ctrl+V système terminé :', topic);
                        resolve(topic === 'process-finished');
                    },
                });
                log('Ctrl+V AHK lancé (Send ^v)');
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
            pipelineActive = true;
            revealGhost();
            const g = getGhost();
            attachFrameScript(g.browser);
            await loadTool();
            await waitForReady();
            log('Dropzone prête → écriture clipboard puis Ctrl+V système');

            const snap = snapshotClipboard();
            await writeImageToClipboard(filePath);
            await focusGhost();
            log('Focus ghost OK → Ctrl+V AHK');
            await sendSystemCtrlV();

            // Restauration presse-papier : en réserve (polish)
            if (false) setTimeout(() => restoreClipboard(snap), 2000);
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
            log(`${ok ? '✓' : '✗'} ${name}`);
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

    /* ─── Breadcrumb Home > Tools > Background Remover ─── */
    a[href="/tools"] { display: none !important; }

    /* ─── Compaction : les containers du tool ne décident plus de la
       hauteur — le carré du ghost commande. ─── */
    main { min-height: 0 !important; }
    .bg-surface-subtle.px-4,
    .rounded-area-500.shadow-800 {
        height: auto !important;
        min-height: 0 !important;
        max-height: 100% !important;
    }

    /* ─── Scroll interdit : le carré est fini, pas de dépassement ─── */
    html, body { overflow: hidden !important; height: 100% !important; }
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

        log('init v0.9.5');
        // Header debug.log (purge copyDebug — réécrite par le 1er log en overwrite)
        logFile('chrome', '──── session start v0.9.5 ────');
        probeEnvironment();
        initDownloadsListener();
        initSiteStyleSheet();
    }

    if (document.readyState === 'complete' || document.readyState === 'interactive') init();
    else document.addEventListener('DOMContentLoaded', init, { once: true });
})();
