// SyncWatch Background Service Worker
// Uses Firebase Realtime Database REST API for signaling

// ─── Config ───────────────────────────────────────────────
let FIREBASE_DB_URL = '';

try {
    importScripts('../config.js');
    FIREBASE_DB_URL = FIREBASE_CONFIG.databaseURL.replace(/\/$/, '');
} catch (e) {
    console.error('[SyncWatch] Failed to load config.js');
}

// ─── Constants ────────────────────────────────────────────
const INITIAL_STATE = {
    roomId: null,
    peerConnected: false,
    lastEventTimestamp: 0,
    isHost: false,
    mediaInfo: null,
    myUrl: null,
    peerUrl: null,
    urlMatch: null,
    presenceCount: 0
};

const PRESENCE_HEARTBEAT_MS = 30000;
const PRESENCE_TTL_MS = 90000;
const ROOM_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

// ─── Init ─────────────────────────────────────────────────
chrome.storage.local.get(['peerId'], (result) => {
    if (!result.peerId) {
        chrome.storage.local.set({ peerId: crypto.randomUUID().slice(0, 8) });
    }
});

chrome.storage.local.get(Object.keys(INITIAL_STATE), (result) => {
    if (result.roomId === undefined) {
        chrome.storage.local.set(INITIAL_STATE);
    }
});

// ─── Firebase REST API ────────────────────────────────────
async function firebase(method, path, data = null) {
    if (!FIREBASE_DB_URL || FIREBASE_DB_URL.includes('YOUR-PROJECT')) return null;
    const options = {
        method,
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-store'
    };
    if (data) options.body = JSON.stringify(data);
    const query = method === 'GET' ? `?_=${Date.now()}` : '';

    try {
        const res = await fetch(`${FIREBASE_DB_URL}/${path}.json${query}`, options);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return await res.json();
    } catch (err) {
        console.warn(`[SyncWatch] Firebase ${method} ${path} failed:`, err.message);
        return null;
    }
}

// ─── Security Helpers ─────────────────────────────────────
function sanitizeRoomId(id) {
    if (!id || typeof id !== 'string') return null;
    return id.replace(/[^A-Z0-9]/gi, '').toUpperCase().slice(0, 6);
}

function isValidUrl(url) {
    try {
        const u = new URL(url);
        return ['http:', 'https:'].includes(u.protocol);
    } catch {
        return false;
    }
}

function normalizeUrl(url) {
    try {
        const u = new URL(url);
        // Strip tracking params but keep meaningful ones (e.g. YouTube ?v=)
        const trackingParams = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
            'fbclid', 'gclid', 'ref', 'source', 'mc_cid', 'mc_eid', 'si', 'feature'];
        trackingParams.forEach(p => u.searchParams.delete(p));
        // Sort remaining params for consistent comparison
        u.searchParams.sort();
        const search = u.searchParams.toString();
        return u.origin + u.pathname.replace(/\/$/, '') + (search ? '?' + search : '');
    } catch {
        return null;
    }
}

function urlToFirebaseKey(url) {
    const normalized = normalizeUrl(url);
    if (!normalized) return null;
    return btoa(unescape(encodeURIComponent(normalized))).replace(/[.$/\[\]#\+]/g, '_').slice(0, 200);
}

function generateRoomId() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let id = '';
    for (let i = 0; i < 6; i++) id += chars[Math.floor(Math.random() * chars.length)];
    return id;
}

async function getActiveTabUrl() {
    try {
        const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
        return tab?.url && isValidUrl(tab.url) ? tab.url : null;
    } catch {
        return null;
    }
}

// ─── Room Actions ─────────────────────────────────────────

async function createRoom() {
    const { peerId } = await chrome.storage.local.get('peerId');
    const newRoomId = generateRoomId();
    const currentUrl = await getActiveTabUrl();
    const norm = currentUrl ? normalizeUrl(currentUrl) : null;

    const res = await firebase('PUT', `rooms/${newRoomId}`, {
        createdAt: Date.now(),
        host: peerId,
        peers: { [peerId]: true },
        urls: norm ? { [peerId]: norm } : {},
        lastEvent: null
    });

    if (!res) {
        broadcastState({ error: 'Firebase connection failed.' });
        return;
    }

    await chrome.storage.local.set({
        roomId: newRoomId,
        peerConnected: false,
        lastEventTimestamp: 0,
        isHost: true,
        myUrl: norm,
        peerUrl: null,
        urlMatch: null
    });

    broadcastState();
}

async function joinRoom(targetRoomId) {
    const code = sanitizeRoomId(targetRoomId);
    if (!code || code.length < 4) {
        broadcastState({ error: 'Invalid room code.' });
        return false;
    }

    const room = await firebase('GET', `rooms/${code}`);
    if (!room) {
        broadcastState({ error: 'Room not found.' });
        return false;
    }

    // Stale room check
    if (room.createdAt && (Date.now() - room.createdAt) > ROOM_TTL_MS) {
        await firebase('DELETE', `rooms/${code}`);
        broadcastState({ error: 'Room expired.' });
        return false;
    }

    const peerCount = room.peers ? Object.keys(room.peers).length : 0;
    if (peerCount >= 2) {
        broadcastState({ error: 'Room is full (max 2).' });
        return false;
    }

    const { peerId } = await chrome.storage.local.get('peerId');
    const currentUrl = await getActiveTabUrl();
    const norm = currentUrl ? normalizeUrl(currentUrl) : null;

    await firebase('PATCH', `rooms/${code}/peers`, { [peerId]: true });
    await firebase('PATCH', `rooms/${code}`, { peerJoined: Date.now() });
    if (norm) {
        await firebase('PATCH', `rooms/${code}/urls`, { [peerId]: norm });
    }

    let peerUrl = null;
    let urlMatch = null;
    if (room.urls) {
        const others = Object.entries(room.urls).filter(([id]) => id !== peerId);
        if (others.length > 0) {
            peerUrl = others[0][1];
            urlMatch = norm && peerUrl ? norm === peerUrl : null;
        }
    }

    await chrome.storage.local.set({
        roomId: code,
        peerConnected: true,
        lastEventTimestamp: 0,
        isHost: false,
        myUrl: norm,
        peerUrl,
        urlMatch
    });

    broadcastState();
    return true;
}

async function leaveRoom() {
    const { roomId, peerId } = await chrome.storage.local.get(['roomId', 'peerId']);

    if (roomId) {
        await firebase('DELETE', `rooms/${roomId}/peers/${peerId}`);
        await firebase('DELETE', `rooms/${roomId}/urls/${peerId}`);
        const peers = await firebase('GET', `rooms/${roomId}/peers`);
        if (!peers || Object.keys(peers).length === 0) {
            await firebase('DELETE', `rooms/${roomId}`);
        } else {
            await firebase('PATCH', `rooms/${roomId}`, { peerLeft: Date.now() });
        }
    }

    await chrome.storage.local.set(INITIAL_STATE);
    broadcastState();
}

async function updateMyUrl(url) {
    if (url && !isValidUrl(url)) return;
    const { roomId, peerId } = await chrome.storage.local.get(['roomId', 'peerId']);
    const norm = url ? normalizeUrl(url) : null;

    await chrome.storage.local.set({ myUrl: norm });

    if (roomId && peerId && norm) {
        await firebase('PATCH', `rooms/${roomId}/urls`, { [peerId]: norm });
    }
}

async function sendSyncEvent(action, currentTime, playbackRate) {
    const { roomId, peerId } = await chrome.storage.local.get(['roomId', 'peerId']);
    if (!roomId) return;

    // Validate inputs
    if (typeof currentTime !== 'number' || isNaN(currentTime)) return;
    if (typeof playbackRate !== 'number' || isNaN(playbackRate)) return;

    const ts = Date.now();
    await firebase('PATCH', `rooms/${roomId}`, {
        lastEvent: {
            action: String(action).slice(0, 20),
            currentTime,
            playbackRate,
            timestamp: ts,
            from: peerId
        }
    });

    await chrome.storage.local.set({ lastEventTimestamp: ts });
}

// ─── Presence System ──────────────────────────────────────

let presenceInterval = null;
let currentPresenceKey = null;

async function updatePresence(url) {
    if (!url) return;
    const key = urlToFirebaseKey(url);
    if (!key) return;
    const { peerId } = await chrome.storage.local.get('peerId');

    if (currentPresenceKey && currentPresenceKey !== key) {
        firebase('DELETE', `presence/${currentPresenceKey}/${peerId}`).catch(() => {});
    }
    currentPresenceKey = key;

    await firebase('PATCH', `presence/${key}`, {
        [peerId]: { lastSeen: Date.now() }
    });
}

async function removePresence() {
    if (!currentPresenceKey) return;
    const { peerId } = await chrome.storage.local.get('peerId');
    await firebase('DELETE', `presence/${currentPresenceKey}/${peerId}`);
    currentPresenceKey = null;
}

async function getPresenceCount(url) {
    if (!url) return 0;
    const key = urlToFirebaseKey(url);
    if (!key) return 0;
    const data = await firebase('GET', `presence/${key}`);
    if (!data || typeof data !== 'object') return 0;

    const now = Date.now();
    let count = 0;
    for (const [pid, info] of Object.entries(data)) {
        if (info && typeof info.lastSeen === 'number' && (now - info.lastSeen) < PRESENCE_TTL_MS) {
            count++;
        } else {
            firebase('DELETE', `presence/${key}/${pid}`).catch(() => {});
        }
    }
    return count;
}

function startPresenceHeartbeat(url) {
    stopPresenceHeartbeat();
    if (!url) return;
    const norm = normalizeUrl(url);
    if (!norm) return;

    updatePresence(norm);
    presenceInterval = setInterval(() => updatePresence(norm), PRESENCE_HEARTBEAT_MS);
}

function stopPresenceHeartbeat() {
    if (presenceInterval) {
        clearInterval(presenceInterval);
        presenceInterval = null;
    }
}

// ─── Polling ──────────────────────────────────────────────

async function pollRoom() {
    const state = await chrome.storage.local.get([
        'roomId', 'peerId', 'peerConnected', 'lastEventTimestamp', 'myUrl'
    ]);

    if (!state.roomId) return null;

    const room = await firebase('GET', `rooms/${state.roomId}`);

    if (!room) {
        await chrome.storage.local.set(INITIAL_STATE);
        broadcastState({ error: 'Room closed.' });
        return null;
    }

    // Stale room check
    if (room.createdAt && (Date.now() - room.createdAt) > ROOM_TTL_MS) {
        await firebase('DELETE', `rooms/${state.roomId}`);
        await chrome.storage.local.set(INITIAL_STATE);
        broadcastState({ error: 'Room expired.' });
        return null;
    }

    const peers = room.peers ? Object.keys(room.peers) : [];
    const currentlyConnected = peers.length >= 2;

    // URL matching
    let peerUrl = null;
    let urlMatch = null;
    if (room.urls && state.peerId) {
        const others = Object.entries(room.urls).filter(([id]) => id !== state.peerId);
        if (others.length > 0) {
            peerUrl = others[0][1];
            urlMatch = state.myUrl && peerUrl ? state.myUrl === peerUrl : null;
        }
    }

    const stateChanged =
        state.peerConnected !== currentlyConnected ||
        state.peerUrl !== peerUrl ||
        state.urlMatch !== urlMatch;

    if (stateChanged) {
        await chrome.storage.local.set({
            peerConnected: currentlyConnected,
            peerUrl,
            urlMatch
        });
        broadcastState();
    }

    // New events from other peer
    if (room.lastEvent && room.lastEvent.from !== state.peerId) {
        return room.lastEvent;
    }

    return null;
}

// ─── State Broadcast ──────────────────────────────────────

async function broadcastState(extra = {}) {
    const state = await chrome.storage.local.get([
        'roomId', 'peerConnected', 'isHost', 'myUrl', 'peerUrl', 'urlMatch', 'presenceCount'
    ]);
    const msg = {
        type: 'state_update',
        isConnected: !!state.roomId,
        roomId: state.roomId,
        peerConnected: state.peerConnected,
        isHost: state.isHost,
        myUrl: state.myUrl,
        peerUrl: state.peerUrl,
        urlMatch: state.urlMatch,
        presenceCount: state.presenceCount || 0,
        ...extra
    };
    chrome.runtime.sendMessage(msg).catch(() => {});
}

// ─── Message Handling ─────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || !msg.type) return;

    switch (msg.type) {
        case 'create_room':
            createRoom().then(() => sendResponse({ ok: true })).catch(() => sendResponse({ ok: false }));
            return true;

        case 'join_room':
            joinRoom(msg.roomId).then(ok => sendResponse({ ok })).catch(() => sendResponse({ ok: false }));
            return true;

        case 'leave_room':
            leaveRoom().then(() => sendResponse({ ok: true })).catch(() => sendResponse({ ok: false }));
            return true;

        case 'get_state':
            chrome.storage.local.get([
                'roomId', 'peerConnected', 'isHost', 'myUrl', 'peerUrl', 'urlMatch', 'presenceCount'
            ]).then(state => {
                sendResponse({
                    isConnected: !!state.roomId,
                    roomId: state.roomId,
                    peerConnected: state.peerConnected,
                    isHost: state.isHost,
                    myUrl: state.myUrl,
                    peerUrl: state.peerUrl,
                    urlMatch: state.urlMatch,
                    presenceCount: state.presenceCount || 0
                });
            });
            return true;

        case 'media_event':
            sendSyncEvent(msg.action, msg.currentTime, msg.playbackRate)
                .then(() => sendResponse({ ok: true }));
            return true;

        case 'media_detected':
            chrome.storage.local.set({
                mediaInfo: {
                    tagName: String(msg.tagName || '').slice(0, 10),
                    src: String(msg.src || '').slice(0, 500)
                }
            });
            sendResponse({ ok: true });
            return true;

        case 'force_sync_to':
            if (sender.tab) {
                chrome.tabs.sendMessage(sender.tab.id, {
                    type: 'execute_force_sync',
                    time: msg.time
                }).catch(() => {});
            }
            sendResponse({ ok: true });
            return true;

        case 'poll_room':
            pollRoom().then(event => sendResponse({ event })).catch(() => sendResponse({ event: null }));
            return true;

        case 'update_url':
            if (msg.url && isValidUrl(msg.url)) {
                updateMyUrl(msg.url).then(() => {
                    startPresenceHeartbeat(msg.url);
                    sendResponse({ ok: true });
                });
            } else {
                sendResponse({ ok: false });
            }
            return true;

        case 'get_presence':
            const pUrl = msg.url ? normalizeUrl(msg.url) : null;
            getPresenceCount(pUrl).then(count => {
                chrome.storage.local.set({ presenceCount: count });
                sendResponse({ count });
            });
            return true;

        case 'navigate_to_peer':
            chrome.storage.local.get(['peerUrl']).then(({ peerUrl }) => {
                if (peerUrl && sender.tab) {
                    chrome.tabs.update(sender.tab.id, { url: peerUrl });
                    sendResponse({ ok: true });
                } else {
                    // If sent from popup, update active tab
                    chrome.tabs.query({ active: true, lastFocusedWindow: true }).then(([tab]) => {
                        if (tab && peerUrl) {
                            chrome.tabs.update(tab.id, { url: peerUrl });
                        }
                        sendResponse({ ok: !!peerUrl });
                    });
                }
            });
            return true;

        case 'ping':
            sendResponse({ pong: true });
            return true;
    }
});

// ─── Tab Events ───────────────────────────────────────────
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (changeInfo.url && isValidUrl(changeInfo.url)) {
        chrome.tabs.query({ active: true, lastFocusedWindow: true }, ([activeTab]) => {
            if (activeTab && activeTab.id === tabId) {
                const norm = normalizeUrl(changeInfo.url);
                if (norm) {
                    startPresenceHeartbeat(changeInfo.url);
                    updateMyUrl(changeInfo.url);
                }
            }
        });
    }
});

// Cleanup on unload
self.addEventListener('beforeunload', () => {
    removePresence();
});
