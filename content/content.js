// SyncWatch Content Script
// Detects and controls media elements on the page
// locales.js is loaded before this file via manifest.json content_scripts

(function () {
    'use strict';

    const isTopFrame = (window === window.top);

    // ─── State ────────────────────────────────────────────────
    let isRemoteAction = false;
    let activeMedia = null;
    let currentLang = 'en';
    const SEEK_THRESHOLD = 2.0;

    // Overlay elements
    let overlayEl = null;
    let miniToggle = null;
    let overlayStatus = null;
    let overlayDrift = null;
    let overlayUrlStatus = null;
    let overlayPresence = null;
    let syncBtn = null;
    let goToPageBtn = null;
    let overlayVisible = true;

    let lastRemoteState = {
        action: 'paused',
        currentTime: 0,
        timestamp: 0,
        isBuffering: false
    };

    let currentRoomState = {
        isConnected: false,
        roomId: null,
        peerConnected: false,
        myUrl: null,
        peerUrl: null,
        urlMatch: null,
        presenceCount: 0
    };

    // Cached presence to avoid flickering
    let cachedPresenceCount = 0;

    // ─── i18n Helper ──────────────────────────────────────────
    function _(key) {
        if (typeof t === 'function') return t(key, currentLang);
        return key;
    }

    function loadLang() {
        if (typeof getSavedLang === 'function') {
            getSavedLang((lang) => { currentLang = lang; });
        }
    }

    // ─── Media Detection ──────────────────────────────────────
    function findMediaElements() {
        return [...document.querySelectorAll('video, audio')];
    }

    function selectBestMedia() {
        const elements = findMediaElements();
        if (elements.length === 0) return null;

        const videos = elements.filter(el => el.tagName === 'VIDEO');
        const audios = elements.filter(el => el.tagName === 'AUDIO');

        if (videos.length > 0) {
            let best = videos[0];
            let bestArea = 0;
            for (const v of videos) {
                const rect = v.getBoundingClientRect();
                const area = rect.width * rect.height;
                if (area > bestArea && rect.width > 0 && rect.height > 0) {
                    bestArea = area;
                    best = v;
                }
            }
            return best;
        }

        return audios[0] || null;
    }

    function attachMediaListeners(media) {
        if (!media || media._syncWatchListening) return;
        media._syncWatchListening = true;

        const events = ['play', 'pause', 'seeked', 'ratechange', 'waiting', 'playing'];

        events.forEach(eventName => {
            media.addEventListener(eventName, () => {
                if (isRemoteAction) return;

                let action = eventName;
                if (eventName === 'seeked') action = 'seek';
                if (eventName === 'waiting') action = 'buffering';
                if (eventName === 'playing') action = 'play';

                try {
                    chrome.runtime.sendMessage({
                        type: 'media_event',
                        action,
                        currentTime: media.currentTime,
                        playbackRate: media.playbackRate,
                        paused: media.paused
                    });
                } catch (e) { /* extension context invalidated */ }
            });
        });

        let syncInterval = null;

        media.addEventListener('play', () => {
            if (syncInterval) clearInterval(syncInterval);
            syncInterval = setInterval(() => {
                if (!isRemoteAction && !media.paused) {
                    try {
                        chrome.runtime.sendMessage({
                            type: 'media_event',
                            action: 'timesync',
                            currentTime: media.currentTime,
                            playbackRate: media.playbackRate,
                            paused: media.paused
                        });
                    } catch (e) { /* ignore */ }
                }
                if (isTopFrame) updateDriftUI();
            }, 1000);
        });

        media.addEventListener('pause', () => {
            if (syncInterval) { clearInterval(syncInterval); syncInterval = null; }
            if (isTopFrame) updateDriftUI();
        });
    }

    // ─── Init ─────────────────────────────────────────────────
    function init() {
        loadLang();

        activeMedia = selectBestMedia();
        if (activeMedia) {
            attachMediaListeners(activeMedia);
            notifyMediaFound();
        }

        if (isTopFrame) {
            createOverlay();
            sendUrlUpdate();
        }

        // Watch for dynamically added media
        const observer = new MutationObserver((mutations) => {
            for (const mutation of mutations) {
                for (const node of mutation.addedNodes) {
                    if (node.nodeType !== Node.ELEMENT_NODE) continue;
                    if (node.tagName === 'VIDEO' || node.tagName === 'AUDIO') {
                        handleNewMedia(node);
                    }
                    const childMedia = node.querySelectorAll?.('video, audio');
                    if (childMedia) childMedia.forEach(handleNewMedia);
                }
            }
        });

        observer.observe(document.body, { childList: true, subtree: true });

        setInterval(() => {
            if (!activeMedia || !document.contains(activeMedia)) {
                const newMedia = selectBestMedia();
                if (newMedia && newMedia !== activeMedia) {
                    activeMedia = newMedia;
                    attachMediaListeners(activeMedia);
                    notifyMediaFound();
                }
            }
        }, 2000);
    }

    function handleNewMedia(element) {
        if (!activeMedia || !document.contains(activeMedia)) {
            activeMedia = element;
            attachMediaListeners(activeMedia);
            notifyMediaFound();
        }
    }

    // ─── URL Tracking ─────────────────────────────────────────
    let lastSentUrl = null;

    function sendUrlUpdate() {
        const currentUrl = window.location.href;
        if (currentUrl === lastSentUrl) return;
        lastSentUrl = currentUrl;
        try {
            chrome.runtime.sendMessage({ type: 'update_url', url: currentUrl });
        } catch (e) { /* ignore */ }
    }

    if (isTopFrame) {
        window.addEventListener('popstate', () => setTimeout(sendUrlUpdate, 50));
        window.addEventListener('hashchange', () => setTimeout(sendUrlUpdate, 50));

        // SPA navigation detection
        const origPush = history.pushState;
        const origReplace = history.replaceState;
        history.pushState = function (...args) {
            origPush.apply(this, args);
            setTimeout(sendUrlUpdate, 100);
        };
        history.replaceState = function (...args) {
            origReplace.apply(this, args);
            setTimeout(sendUrlUpdate, 100);
        };

        // Also periodically check URL (covers edge cases)
        setInterval(sendUrlUpdate, 3000);
    }

    // ─── Polling ──────────────────────────────────────────────
    let pollInterval = null;
    let localLastEventTimestamp = 0;
    let presencePollCounter = 0;

    function startPolling() {
        if (pollInterval || !isTopFrame) return;

        pollInterval = setInterval(() => {
            try {
                // Poll events
                chrome.runtime.sendMessage({ type: 'poll_room' }, (response) => {
                    if (chrome.runtime.lastError) return;
                    if (response && response.event && activeMedia) {
                        if (response.event.timestamp > localLastEventTimestamp) {
                            localLastEventTimestamp = response.event.timestamp;
                            applyRemoteEvent(response.event);
                        }
                    }
                });

                // Poll state
                chrome.runtime.sendMessage({ type: 'get_state' }, (response) => {
                    if (chrome.runtime.lastError) return;
                    if (response) {
                        currentRoomState = response;
                        updateOverlayUI();
                    }
                });

                // Presence every 15 seconds
                presencePollCounter++;
                if (presencePollCounter % 15 === 0) {
                    chrome.runtime.sendMessage({
                        type: 'get_presence',
                        url: window.location.href
                    }, (response) => {
                        if (chrome.runtime.lastError) return;
                        if (response && typeof response.count === 'number') {
                            cachedPresenceCount = response.count;
                            updatePresenceUI();
                        }
                    });
                }
            } catch (e) { /* extension context invalidated */ }
        }, 1000);
    }

    startPolling();

    // ─── Remote Event Application ─────────────────────────────
    function applyRemoteEvent(msg) {
        lastRemoteState = msg;
        if (isTopFrame) updateOverlayUI();

        if (!activeMedia) return;
        if (msg.action === 'buffering' || msg.action === 'timesync') return;

        isRemoteAction = true;

        switch (msg.action) {
            case 'play':
                if (Math.abs(activeMedia.currentTime - msg.currentTime) > SEEK_THRESHOLD) {
                    activeMedia.currentTime = msg.currentTime;
                }
                activeMedia.play().catch(() => {});
                break;
            case 'pause':
                activeMedia.pause();
                if (typeof msg.currentTime === 'number') activeMedia.currentTime = msg.currentTime;
                break;
            case 'seek':
                if (typeof msg.currentTime === 'number') activeMedia.currentTime = msg.currentTime;
                break;
            case 'ratechange':
                if (typeof msg.playbackRate === 'number') activeMedia.playbackRate = msg.playbackRate;
                break;
        }

        setTimeout(() => { isRemoteAction = false; }, 200);
    }

    function notifyMediaFound() {
        if (!activeMedia) return;
        try {
            chrome.runtime.sendMessage({
                type: 'media_detected',
                tagName: activeMedia.tagName,
                duration: activeMedia.duration || 0,
                src: activeMedia.currentSrc || activeMedia.src || 'unknown'
            });
        } catch (e) { /* ignore */ }
        if (isTopFrame) updateOverlayUI();
    }

    // ─── Message Handler ──────────────────────────────────────
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
        if (!msg || !msg.type) return;

        switch (msg.type) {
            case 'execute_force_sync':
                if (activeMedia && typeof msg.time === 'number') {
                    isRemoteAction = true;
                    activeMedia.currentTime = msg.time;
                    setTimeout(() => { isRemoteAction = false; }, 200);
                }
                break;

            case 'sync_command':
                if (activeMedia) applyRemoteEvent(msg);
                sendResponse({ ok: true });
                break;

            case 'get_media_status':
                const media = activeMedia || selectBestMedia();
                if (media) {
                    sendResponse({
                        found: true,
                        tagName: media.tagName,
                        paused: media.paused,
                        currentTime: media.currentTime,
                        duration: media.duration,
                        src: media.currentSrc || media.src || 'unknown'
                    });
                } else {
                    sendResponse({ found: false });
                }
                break;

            case 'toggle_overlay':
                toggleOverlay();
                break;

            case 'lang_changed':
                if (msg.lang && typeof SYNCWATCH_LOCALES !== 'undefined' && SYNCWATCH_LOCALES[msg.lang]) {
                    currentLang = msg.lang;
                    updateOverlayUI();
                }
                break;
        }

        return true;
    });

    // ─── OVERLAY UI ───────────────────────────────────────────

    function toggleOverlay() {
        if (!overlayEl) return;
        overlayVisible = !overlayVisible;
        overlayEl.style.display = overlayVisible ? 'block' : 'none';
        if (miniToggle) miniToggle.style.display = overlayVisible ? 'none' : 'flex';
    }

    function createOverlay() {
        if (overlayEl || !isTopFrame) return;

        // ─── Mini Toggle Button (visible when overlay is closed) ───
        miniToggle = document.createElement('div');
        miniToggle.id = 'syncwatch-mini-toggle';
        miniToggle.innerHTML = '⚡';
        Object.assign(miniToggle.style, {
            position: 'fixed',
            top: '20px',
            right: '20px',
            width: '36px',
            height: '36px',
            backgroundColor: 'rgba(99, 102, 241, 0.9)',
            color: '#fff',
            borderRadius: '50%',
            display: 'none', // hidden by default, shown when overlay is closed
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            zIndex: '2147483647',
            fontSize: '16px',
            boxShadow: '0 2px 12px rgba(99, 102, 241, 0.5)',
            transition: 'transform 0.2s, box-shadow 0.2s',
            fontFamily: 'sans-serif'
        });
        miniToggle.addEventListener('mouseenter', () => {
            miniToggle.style.transform = 'scale(1.15)';
            miniToggle.style.boxShadow = '0 4px 20px rgba(99, 102, 241, 0.7)';
        });
        miniToggle.addEventListener('mouseleave', () => {
            miniToggle.style.transform = 'scale(1)';
            miniToggle.style.boxShadow = '0 2px 12px rgba(99, 102, 241, 0.5)';
        });
        miniToggle.addEventListener('click', toggleOverlay);
        document.body.appendChild(miniToggle);

        // ─── Main Overlay ─────────────────────────────────────────
        overlayEl = document.createElement('div');
        overlayEl.id = 'syncwatch-overlay';
        overlayEl.innerHTML = `
            <div id="sw-header" style="cursor:grab;font-weight:bold;padding-bottom:5px;border-bottom:1px solid rgba(255,255,255,0.1);margin-bottom:6px;display:flex;justify-content:space-between;align-items:center;">
                <span style="font-size:12px;background:linear-gradient(135deg,#A78BFA,#6366F1);-webkit-background-clip:text;-webkit-text-fill-color:transparent;">⚡ SyncWatch</span>
                <span id="sw-close" style="cursor:pointer;font-size:14px;color:#71717a;line-height:1;padding:2px 4px;">&times;</span>
            </div>
            <div id="sw-presence" style="font-size:11px;color:#a5b4fc;margin-bottom:4px;display:none;"></div>
            <div id="sw-status" style="font-size:12px;margin-bottom:4px;color:#71717a;">Disconnected</div>
            <div id="sw-url-status" style="font-size:11px;margin-bottom:3px;display:none;"></div>
            <div id="sw-drift" style="font-size:11px;color:#aaa;"></div>
            <button id="sw-sync-btn" style="display:none;background:linear-gradient(135deg,#7c3aed,#6366f1);color:white;border:none;padding:5px 10px;border-radius:6px;cursor:pointer;margin-top:5px;font-size:11px;width:100%;font-weight:600;">⚡ Fix Sync</button>
            <button id="sw-goto-btn" style="display:none;background:rgba(99,102,241,0.15);color:#a5b4fc;border:1px solid rgba(99,102,241,0.2);padding:4px 8px;border-radius:6px;cursor:pointer;margin-top:4px;font-size:10px;width:100%;font-weight:500;">→ Go to peer's page</button>
        `;

        Object.assign(overlayEl.style, {
            position: 'fixed',
            top: '20px',
            right: '20px',
            width: '180px',
            backgroundColor: 'rgba(15, 15, 23, 0.55)',
            color: '#fff',
            padding: '10px 12px',
            borderRadius: '12px',
            fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
            zIndex: '2147483647',
            backdropFilter: 'blur(16px)',
            WebkitBackdropFilter: 'blur(16px)',
            transition: 'opacity 0.2s, background-color 0.2s',
            boxShadow: '0 4px 24px rgba(0,0,0,0.4)',
            border: '1px solid rgba(255,255,255,0.06)',
            opacity: '0.55'
        });

        overlayEl.addEventListener('mouseenter', () => {
            overlayEl.style.opacity = '1';
            overlayEl.style.backgroundColor = 'rgba(15, 15, 23, 0.95)';
        });
        overlayEl.addEventListener('mouseleave', () => {
            overlayEl.style.opacity = '0.55';
            overlayEl.style.backgroundColor = 'rgba(15, 15, 23, 0.55)';
        });

        document.body.appendChild(overlayEl);

        overlayStatus = document.getElementById('sw-status');
        overlayDrift = document.getElementById('sw-drift');
        overlayUrlStatus = document.getElementById('sw-url-status');
        overlayPresence = document.getElementById('sw-presence');
        syncBtn = document.getElementById('sw-sync-btn');
        goToPageBtn = document.getElementById('sw-goto-btn');

        // Close button → hides overlay, shows mini toggle
        document.getElementById('sw-close').addEventListener('click', toggleOverlay);

        // Sync button
        syncBtn.addEventListener('click', () => {
            if (lastRemoteState.currentTime) {
                try {
                    chrome.runtime.sendMessage({
                        type: 'force_sync_to',
                        time: lastRemoteState.currentTime
                    });
                } catch (e) { /* ignore */ }
                syncBtn.style.display = 'none';
                overlayDrift.innerHTML = `<span style="color:#a78bfa">${_('syncing')}</span>`;
            }
        });

        // Go to peer's page button
        goToPageBtn.addEventListener('click', () => {
            try {
                chrome.runtime.sendMessage({ type: 'navigate_to_peer' });
            } catch (e) { /* ignore */ }
        });

        // Dragging
        const header = document.getElementById('sw-header');
        let isDragging = false, startX, startY, startRight, startTop;

        header.addEventListener('mousedown', (e) => {
            isDragging = true;
            startX = e.clientX;
            startY = e.clientY;
            const rect = overlayEl.getBoundingClientRect();
            startRight = window.innerWidth - rect.right;
            startTop = rect.top;
            header.style.cursor = 'grabbing';
            e.preventDefault();
        });

        document.addEventListener('mousemove', (e) => {
            if (!isDragging) return;
            overlayEl.style.right = (startRight - (e.clientX - startX)) + 'px';
            overlayEl.style.top = (startTop + (e.clientY - startY)) + 'px';
        });

        document.addEventListener('mouseup', () => {
            if (isDragging) {
                isDragging = false;
                if (header) header.style.cursor = 'grab';
            }
        });
    }

    // ─── Overlay Update Functions ─────────────────────────────

    function updatePresenceUI() {
        if (!overlayPresence) return;
        if (cachedPresenceCount > 0) {
            overlayPresence.style.display = 'block';
            overlayPresence.innerHTML = `🟢 <b>${cachedPresenceCount}</b> ${_('usersOnPage')}`;
        } else {
            overlayPresence.style.display = 'none';
        }
    }

    function updateOverlayUI() {
        if (!overlayEl) return;

        updatePresenceUI();

        if (!currentRoomState.isConnected) {
            overlayStatus.textContent = _('disconnected');
            overlayStatus.style.color = '#71717a';
            overlayDrift.textContent = '';
            overlayUrlStatus.style.display = 'none';
            syncBtn.style.display = 'none';
            goToPageBtn.style.display = 'none';
            return;
        }

        if (!currentRoomState.peerConnected) {
            overlayStatus.innerHTML = `<span style="color:#f59e0b">${_('waitingPeer')}</span>`;
            overlayDrift.textContent = currentRoomState.roomId || '';
            overlayUrlStatus.style.display = 'none';
            syncBtn.style.display = 'none';
            goToPageBtn.style.display = 'none';
            return;
        }

        overlayStatus.innerHTML = `<span style="color:#34d399">${_('synced')}</span> <span style="color:#52525b;font-size:10px">${currentRoomState.roomId}</span>`;

        // URL match status
        if (currentRoomState.urlMatch === true) {
            overlayUrlStatus.style.display = 'block';
            overlayUrlStatus.innerHTML = `<span style="color:#34d399">✅ ${_('samePage')}</span>`;
            goToPageBtn.style.display = 'none';
        } else if (currentRoomState.urlMatch === false) {
            overlayUrlStatus.style.display = 'block';
            overlayUrlStatus.innerHTML = `<span style="color:#ef4444">⚠️ ${_('diffPage')}</span>`;
            goToPageBtn.style.display = 'block';
            goToPageBtn.textContent = `→ ${_('goToPage')}`;
        } else {
            overlayUrlStatus.style.display = 'none';
            goToPageBtn.style.display = 'none';
        }

        updateDriftUI();
    }

    function updateDriftUI() {
        if (!overlayEl || !currentRoomState.peerConnected || !activeMedia) return;

        if (lastRemoteState.action === 'buffering') {
            overlayDrift.innerHTML = `<span style="color:#FFA500">${_('peerBuffering')}</span>`;
            syncBtn.style.display = 'none';
            return;
        }

        let remoteTime = lastRemoteState.currentTime || 0;
        if (lastRemoteState.action === 'play' || lastRemoteState.action === 'timesync') {
            const elapsed = (Date.now() - (lastRemoteState.timestamp || 0)) / 1000;
            if (elapsed > 0 && elapsed < 60) remoteTime += elapsed;
        }

        const diff = activeMedia.currentTime - remoteTime;
        const absDiff = Math.abs(diff);

        if (absDiff > SEEK_THRESHOLD) {
            const dir = diff > 0 ? _('ahead') : _('behind');
            overlayDrift.innerHTML = `<b style="color:#FFA500">${absDiff.toFixed(1)}s</b> ${dir}`;
            syncBtn.style.display = 'block';
            syncBtn.textContent = _('fixSync');
        } else {
            const status = (lastRemoteState.action === 'play' || lastRemoteState.action === 'timesync')
                ? _('playing') : _('paused');
            overlayDrift.innerHTML = `<span style="color:#6ee7b7">${_('inSync')}</span> · ${status}`;
            syncBtn.style.display = 'none';
        }
    }

    // ─── Start ────────────────────────────────────────────────
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
