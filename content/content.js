// WeWatch Content Script
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
    let overlayStatus = null;
    let overlayDrift = null;
    let overlayUrlStatus = null;
    let overlayPresence = null;
    let goToPageBtn = null;
    let overlayVisible = false;

    // Dragging globals
    let isDragging = false, dragStartX = 0, dragStartY = 0, dragInitialLeft = 0, dragInitialTop = 0;

    // Chat elements
    let chatPanelEl = null;
    let chatToggleBtn = null;
    let unreadCount = 0;
    let lastChatTimestamp = 0;
    let myPeerId = null;

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

    // Strategy 1: Standard HTML5 media
    function findHTML5Media() {
        return [...document.querySelectorAll('video, audio')];
    }

    // Strategy 2: Shadow DOM traversal
    function findShadowMedia() {
        const results = [];
        const allElements = document.querySelectorAll('*');

        allElements.forEach(host => {
            if (host.shadowRoot) {
                const shadowMedia = host.shadowRoot.querySelectorAll('video, audio');
                results.push(...shadowMedia);
            }
        });

        return results;
    }

    // Strategy 3: Site-specific selectors
    function findSiteSpecificPlayers() {
        const hostname = window.location.hostname;

        if (hostname.includes('youtube.com')) {
            const player = document.querySelector('.html5-video-player video');
            if (player) return [player];
        }

        if (hostname.includes('netflix.com')) {
            const player = document.querySelector('video');
            if (player) return [player];
        }

        if (hostname.includes('twitch.tv')) {
            const player = document.querySelector('video[data-a-target="video-player"]');
            if (player) return [player];
        }

        if (hostname.includes('vimeo.com')) {
            const player = document.querySelector('.vp-video video, .vp-video-wrapper video');
            if (player) return [player];
        }

        if (hostname.includes('disneyplus.com')) {
            const player = document.querySelector('video');
            if (player) return [player];
        }

        if (hostname.includes('amazon.') || hostname.includes('primevideo.com')) {
            const player = document.querySelector('video.dv-player-fullscreen, video');
            if (player) return [player];
        }

        if (hostname.includes('hbomax.com') || hostname.includes('max.com')) {
            const player = document.querySelector('video');
            if (player) return [player];
        }

        if (hostname.includes('dailymotion.com')) {
            const player = document.querySelector('video');
            if (player) return [player];
        }

        return [];
    }

    // Strategy 4: Custom player frameworks
    function findCustomPlayerElements() {
        const knownTags = ['video-js', 'plyr', 'vg-player', 'jwplayer'];

        for (const tag of knownTags) {
            const elements = document.querySelectorAll(tag);
            for (const el of elements) {
                const video = el.querySelector('video') || el.shadowRoot?.querySelector('video');
                if (video) return [video];
            }
        }

        return [];
    }

    // Master detection with fallback chain
    function findMediaElements() {
        let elements = [];

        // Priority 1: Site-specific (most reliable)
        elements = findSiteSpecificPlayers();
        if (elements.length > 0) {
            console.log('[WeWatch] Detected media via site-specific selector');
            return elements;
        }

        // Priority 2: Standard HTML5
        elements = findHTML5Media();
        if (elements.length > 0) {
            console.log('[WeWatch] Detected HTML5 media');
            return elements;
        }

        // Priority 3: Shadow DOM
        elements = findShadowMedia();
        if (elements.length > 0) {
            console.log('[WeWatch] Detected media in Shadow DOM');
            return elements;
        }

        // Priority 4: Custom player frameworks
        elements = findCustomPlayerElements();
        if (elements.length > 0) {
            console.log('[WeWatch] Detected media in custom player');
            return elements;
        }

        console.log('[WeWatch] No media elements detected');
        return [];
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
        if (!media || media._WeWatchListening) return;
        media._WeWatchListening = true;

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

        media.addEventListener('timeupdate', () => {
            if (!media.paused && Math.floor(media.currentTime) % 1 === 0) {
                try {
                    chrome.runtime.sendMessage({
                        type: 'media_timeupdate',
                        currentTime: media.currentTime,
                        duration: media.duration
                    });
                } catch (e) { /* ignore */ }
            }
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
            createOverlay(true); // Create hidden initially
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

        // Global capture listener for any media play event
        document.addEventListener('play', (e) => {
            if (e.target && (e.target.tagName === 'VIDEO' || e.target.tagName === 'AUDIO')) {
                if (activeMedia !== e.target) {
                    activeMedia = e.target;
                    attachMediaListeners(activeMedia);
                    notifyMediaFound();
                }
            }
        }, true);
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
                    if (response && response.event) {
                        if (response.event.timestamp > localLastEventTimestamp) {
                            localLastEventTimestamp = response.event.timestamp;
                            try {
                                chrome.runtime.sendMessage({
                                    type: 'forward_sync',
                                    event: response.event
                                });
                            } catch (e) { /* extension context invalidated */ }
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

                // Presence every 15 seconds (and on first run)
                presencePollCounter++;
                if (presencePollCounter === 1 || presencePollCounter % 15 === 0) {
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

                // Poll chat messages every 2 seconds
                if (presencePollCounter % 2 === 0) {
                    pollChatMessages();
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
                src: activeMedia.currentSrc || activeMedia.src,
                currentTime: activeMedia.currentTime || 0,
                duration: activeMedia.duration || 0
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
                applyRemoteEvent(msg);
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
                if (msg.lang && typeof WeWatch_LOCALES !== 'undefined' && WeWatch_LOCALES[msg.lang]) {
                    currentLang = msg.lang;
                    updateOverlayUI();
                }
                break;
                
            case 'restore_overlay':
                if (!overlayEl) {
                    createOverlay(false); // Re-create visible
                } else {
                    overlayEl.style.cssText = overlayEl.style.cssText.replace('display: none !important;', '');
                    overlayEl.style.display = 'block';
                }
                overlayVisible = true;
                break;
        }

        return true;
    });

    // ─── OVERLAY UI ───────────────────────────────────────────

    function toggleOverlay() {
        if (!overlayEl) return;
        overlayVisible = !overlayVisible;
        overlayEl.style.display = overlayVisible ? 'block' : 'none';
        if (!overlayVisible && chatPanelEl) {
            chatPanelEl.style.display = 'none';
        }
    }

    function createOverlay(initiallyHidden = false) {
        if (overlayEl || !isTopFrame) return;

        // ─── Main Overlay ─────────────────────────────────────────
        overlayEl = document.createElement('div');
        overlayEl.id = 'WeWatch-overlay';
        overlayEl.innerHTML = `
            <div id="sw-header" style="cursor:grab;font-weight:bold;padding-bottom:5px;border-bottom:1px solid rgba(255,255,255,0.1);margin-bottom:6px;display:flex;justify-content:space-between;align-items:center;">
                <span style="font-size:12px;background:linear-gradient(135deg,#A78BFA,#6366F1);-webkit-background-clip:text;-webkit-text-fill-color:transparent;">⚡ WeWatch</span>
                <span id="sw-close" style="cursor:pointer;font-size:14px;color:#71717a;line-height:1;padding:2px 4px;">&times;</span>
            </div>
            <div id="sw-presence" style="font-size:11px;color:#a5b4fc;margin-bottom:4px;display:none;"></div>
            <div id="sw-status" style="font-size:12px;margin-bottom:4px;color:#71717a;">Disconnected</div>
            <div id="sw-url-status" style="font-size:11px;margin-bottom:3px;display:none;"></div>
            <div id="sw-drift" style="font-size:11px;color:#aaa;"></div>
            <button id="sw-sync-btn" style="display:none;background:linear-gradient(135deg,#7c3aed,#6366f1);color:white;border:none;padding:5px 10px;border-radius:6px;cursor:pointer;margin-top:5px;font-size:11px;width:100%;font-weight:600;">⚡ Fix Sync</button>
            <button id="sw-goto-btn" style="display:none;background:rgba(99,102,241,0.15);color:#a5b4fc;border:1px solid rgba(99,102,241,0.2);padding:4px 8px;border-radius:6px;cursor:pointer;margin-top:4px;font-size:10px;width:100%;font-weight:500;">→ Go to peer's page</button>
            <button id="sw-chat-toggle" style="display:none;margin-top:8px;background:rgba(99,102,241,0.2);border:1px solid rgba(99,102,241,0.3);color:#a5b4fc;padding:6px 12px;border-radius:6px;cursor:pointer;font-size:11px;width:100%;font-weight:500;">💬 <span id="sw-chat-label">Chat</span> <span id="sw-chat-badge"></span></button>
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
            display: initiallyHidden ? 'none' : 'block',
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

        // ─── Live Chat Overlay ─────────────────────────────────────
        liveChatEl = document.createElement('div');
        liveChatEl.id = 'WeWatch-live-chat';
        Object.assign(liveChatEl.style, {
            position: 'fixed',
            bottom: '80px', // Above the player controls usually
            left: '20px',
            width: '300px',
            maxHeight: '400px',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'flex-end',
            gap: '8px',
            zIndex: '2147483645',
            pointerEvents: 'none', // Let clicks pass through to video
            fontFamily: "'Inter', -apple-system, sans-serif"
        });
        document.body.appendChild(liveChatEl);

        overlayStatus = document.getElementById('sw-status');
        overlayDrift = document.getElementById('sw-drift');
        overlayUrlStatus = document.getElementById('sw-url-status');
        overlayPresence = document.getElementById('sw-presence');
        syncBtn = document.getElementById('sw-sync-btn');
        goToPageBtn = document.getElementById('sw-goto-btn');
        chatToggleBtn = document.getElementById('sw-chat-toggle');

        // Ensure events are attached to the actual overlay element directly
        overlayEl.addEventListener('click', (e) => {
            if (e.target.id === 'sw-close' || e.target.closest('#sw-close')) {
                e.preventDefault();
                e.stopPropagation();
                if (overlayEl) {
                    overlayEl.style.display = 'none';
                }
                if (chatPanelEl) {
                    chatPanelEl.style.display = 'none';
                }
                overlayVisible = false;
            }
        });


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
        
        if (header) {
            header.addEventListener('mousedown', (e) => {
                if (e.target.id === 'sw-close') return; // Don't drag if clicking close
                isDragging = true;
                dragStartX = e.clientX;
                dragStartY = e.clientY;
                const rect = overlayEl.getBoundingClientRect();
                dragInitialLeft = rect.left;
                dragInitialTop = rect.top;
                
                // Switch from right-based to left-based positioning for dragging
                overlayEl.style.right = 'auto';
                overlayEl.style.bottom = 'auto';
                overlayEl.style.left = dragInitialLeft + 'px';
                overlayEl.style.top = dragInitialTop + 'px';
                
                header.style.cursor = 'grabbing';
                e.preventDefault();
            });
        }

        // We now handle mousemove/mouseup globally below outside createOverlay 
        // to avoid duplicate listeners.

        // Get peerId from storage
        chrome.storage.local.get(['peerId'], (result) => {
            myPeerId = result.peerId;
        });

        // Create chat panel
        createChatPanel();
    }

    // ─── Global Event Listeners for Dragging ────────────────────────
    document.addEventListener('mousemove', (e) => {
        if (!isDragging || !overlayEl) return;
        const deltaX = e.clientX - dragStartX;
        const deltaY = e.clientY - dragStartY;
        overlayEl.style.left = (dragInitialLeft + deltaX) + 'px';
        overlayEl.style.top = (dragInitialTop + deltaY) + 'px';
    });

    document.addEventListener('mouseup', () => {
        if (isDragging) {
            isDragging = false;
            const header = document.getElementById('sw-header');
            if (header) header.style.cursor = 'grab';
        }
    });

    // ─── Chat Panel ───────────────────────────────────────────

    function createChatPanel() {
        if (chatPanelEl || !isTopFrame) return;

        chatPanelEl = document.createElement('div');
        chatPanelEl.id = 'WeWatch-chat';
        chatPanelEl.innerHTML = `
            <div class="chat-header" style="padding:12px 16px;border-bottom:1px solid rgba(255,255,255,0.1);display:flex;justify-content:space-between;align-items:center;font-weight:600;font-size:13px;color:#e4e4eb;">
                <span>💬 Chat</span>
                <span id="chat-close" style="cursor:pointer;font-size:16px;">&times;</span>
            </div>
            <div id="chat-messages" class="chat-messages" style="flex:1;overflow-y:auto;padding:12px;display:flex;flex-direction:column;gap:8px;"></div>
            <div class="chat-input-container" style="display:flex;gap:8px;padding:12px;border-top:1px solid rgba(255,255,255,0.1);">
                <input type="text" id="chat-input" placeholder="Type a message..." maxlength="500" style="flex:1;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.12);border-radius:6px;padding:8px 10px;color:#e4e4eb;font-size:12px;outline:none;">
                <button id="chat-send" style="background:linear-gradient(135deg,#7c3aed,#6366f1);border:none;border-radius:6px;color:white;padding:8px 16px;font-size:12px;font-weight:600;cursor:pointer;">Send</button>
            </div>
        `;

        Object.assign(chatPanelEl.style, {
            position: 'fixed',
            bottom: '20px',
            right: '20px',
            width: '280px',
            height: '400px',
            backgroundColor: 'rgba(15, 15, 23, 0.95)',
            backdropFilter: 'blur(16px)',
            WebkitBackdropFilter: 'blur(16px)',
            borderRadius: '12px',
            border: '1px solid rgba(255,255,255,0.08)',
            display: 'none',
            flexDirection: 'column',
            zIndex: '2147483645',
            fontFamily: "'Inter', -apple-system, sans-serif",
            boxShadow: '0 8px 32px rgba(0,0,0,0.4)'
        });

        // Inject chat styles
        const chatStyles = document.createElement('style');
        chatStyles.textContent = `
            #WeWatch-chat .chat-message {
                background: rgba(255,255,255,0.05);
                padding: 8px 10px;
                border-radius: 8px;
                font-size: 12px;
            }
            #WeWatch-chat .chat-message-header {
                display: flex;
                justify-content: space-between;
                margin-bottom: 4px;
                font-size: 10px;
            }
            #WeWatch-chat .chat-username {
                font-weight: 600;
                color: #a5b4fc;
            }
            #WeWatch-chat .chat-username.me {
                color: #34d399;
            }
            #WeWatch-chat .chat-time {
                color: #71717a;
            }
            #WeWatch-chat .chat-text {
                color: #e4e4eb;
                line-height: 1.4;
                word-wrap: break-word;
            }
            #WeWatch-chat #chat-input:focus {
                border-color: rgba(99,102,241,0.5);
            }
            #WeWatch-chat #chat-send:hover {
                opacity: 0.9;
            }
        `;
        chatPanelEl.appendChild(chatStyles);
        document.body.appendChild(chatPanelEl);

        // Chat toggle
        chatToggleBtn.addEventListener('click', () => {
            const isVisible = chatPanelEl.style.display !== 'none';
            chatPanelEl.style.display = isVisible ? 'none' : 'flex';

            if (!isVisible) {
                unreadCount = 0;
                updateChatBadge();
                document.getElementById('chat-input').focus();
            }
        });

        // Chat close
        chatPanelEl.querySelector('#chat-close').addEventListener('click', () => {
            chatPanelEl.style.display = 'none';
        });

        // Chat send
        function sendChatMessage() {
            const input = document.getElementById('chat-input');
            const text = input.value.trim();
            if (!text || text.length > 500) return;

            try {
                chrome.runtime.sendMessage({
                    type: 'send_chat',
                    text: text
                }, (response) => {
                    if (response && response.ok) {
                        input.value = '';
                    }
                });
            } catch (e) { /* ignore */ }
        }

        document.getElementById('chat-send').addEventListener('click', sendChatMessage);
        document.getElementById('chat-input').addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendChatMessage();
            }
        });
    }

    function pollChatMessages() {
        if (!currentRoomState.peerConnected) return;

        try {
            chrome.runtime.sendMessage({
                type: 'get_chat_messages',
                since: lastChatTimestamp
            }, (response) => {
                if (chrome.runtime.lastError || !response) return;
                if (response.messages) {
                    response.messages.forEach(msg => {
                        appendChatMessage(msg);
                        if (msg.timestamp > lastChatTimestamp) {
                            lastChatTimestamp = msg.timestamp;

                            // Increment unread if chat is hidden and not from me
                            if (chatPanelEl.style.display === 'none' && msg.from !== myPeerId) {
                                unreadCount++;
                                updateChatBadge();
                            }
                        }
                    });
                }
            });
        } catch (e) { /* ignore */ }
    }

    function appendChatMessage(msg) {
        // 1. Add to the chat panel
        const messagesDiv = document.getElementById('chat-messages');
        if (messagesDiv) {
            const msgEl = document.createElement('div');
            msgEl.className = 'chat-message';

            const time = new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            const isMe = msg.from === myPeerId;

            msgEl.innerHTML = `
                <div class="chat-message-header">
                    <span class="chat-username ${isMe ? 'me' : ''}">${escapeHtml(msg.username)}</span>
                    <span class="chat-time">${time}</span>
                </div>
                <div class="chat-text">${escapeHtml(msg.text)}</div>
            `;

            messagesDiv.appendChild(msgEl);
            messagesDiv.scrollTop = messagesDiv.scrollHeight;
        }

        // 2. Add to the live chat overlay (if new)
        if (msg.timestamp > lastChatTimestamp && liveChatEl) {
            const isMe = msg.from === myPeerId;
            const bubble = document.createElement('div');
            Object.assign(bubble.style, {
                background: 'rgba(15, 15, 23, 0.6)',
                backdropFilter: 'blur(8px)',
                WebkitBackdropFilter: 'blur(8px)',
                padding: '6px 12px',
                borderRadius: '8px',
                color: '#fff',
                fontSize: '13px',
                border: '1px solid rgba(255,255,255,0.1)',
                opacity: '0',
                transform: 'translateY(10px)',
                transition: 'all 0.3s ease',
                wordWrap: 'break-word',
                textShadow: '0 1px 2px rgba(0,0,0,0.8)'
            });

            bubble.innerHTML = `<b style="color:${isMe ? '#34d399' : '#a5b4fc'}; font-size: 11px; margin-right: 6px;">${escapeHtml(msg.username)}</b> ${escapeHtml(msg.text)}`;
            liveChatEl.appendChild(bubble);

            // Animate in
            requestAnimationFrame(() => {
                bubble.style.opacity = '1';
                bubble.style.transform = 'translateY(0)';
            });

            // Remove after 6 seconds
            setTimeout(() => {
                bubble.style.opacity = '0';
                bubble.style.transform = 'translateY(-10px)';
                setTimeout(() => bubble.remove(), 300);
            }, 6000);
            
            // Limit to max 7 visible bubbles
            while (liveChatEl.children.length > 7) {
                liveChatEl.children[0].remove();
            }
        }
    }

    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    function updateChatBadge() {
        const badge = document.getElementById('sw-chat-badge');
        if (!badge) return;

        if (unreadCount > 0) {
            badge.textContent = `(${unreadCount})`;
            badge.style.color = '#fbbf24';
        } else {
            badge.textContent = '';
        }
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
            if (chatToggleBtn) chatToggleBtn.style.display = 'none';
            if (chatPanelEl) chatPanelEl.style.display = 'none';
            return;
        }

        if (!currentRoomState.peerConnected) {
            overlayStatus.innerHTML = `<span style="color:#f59e0b">${_('waitingPeer')}</span>`;
            overlayDrift.textContent = currentRoomState.roomId || '';
            overlayUrlStatus.style.display = 'none';
            syncBtn.style.display = 'none';
            goToPageBtn.style.display = 'none';
            if (chatToggleBtn) chatToggleBtn.style.display = 'none';
            if (chatPanelEl) chatPanelEl.style.display = 'none';
            return;
        }

        overlayStatus.innerHTML = `<span style="color:#34d399">${_('synced')}</span> <span style="color:#52525b;font-size:10px">${currentRoomState.roomId}</span>`;

        // Show chat button when connected
        if (chatToggleBtn) chatToggleBtn.style.display = 'block';

        // Show custom player warning if no media detected
        const warningEl = document.getElementById('sw-custom-warning');
        if (!activeMedia) {
            if (!warningEl) {
                const warning = document.createElement('div');
                warning.id = 'sw-custom-warning';
                warning.style.cssText = 'font-size:10px; color:#fca5a5; background:rgba(239,68,68,0.1); padding:6px 8px; border-radius:4px; margin-top:6px; border:1px solid rgba(239,68,68,0.2);';
                warning.innerHTML = `⚠️ Player not detected. Sync disabled, chat works.`;
                overlayEl.appendChild(warning);
            }
        } else if (warningEl) {
            warningEl.remove();
        }

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
