// WeWatch Background Service Worker
// Uses Firebase Realtime Database REST API for signaling

// ─── Config ───────────────────────────────────────────────
let FIREBASE_DB_URL = '';
let YT_API_KEY = '';

try {
    importScripts('../config.js');
    FIREBASE_DB_URL = FIREBASE_CONFIG.databaseURL.replace(/\/$/, '');
    if (typeof YOUTUBE_API_KEY !== 'undefined' && YOUTUBE_API_KEY !== 'YOUR_YOUTUBE_API_KEY_HERE') {
        YT_API_KEY = YOUTUBE_API_KEY;
    }
} catch (e) {
    console.error('[WeWatch] Failed to load config.js');
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
    presenceCount: 0,
    joinRequests: [] // Array of { peerId, username, timestamp }
};

const PRESENCE_HEARTBEAT_MS = 30000;
const PRESENCE_TTL_MS = 90000;
const ROOM_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

// ─── Init ─────────────────────────────────────────────────
chrome.storage.local.get(['peerId', 'username'], (result) => {
    if (!result.peerId) {
        chrome.storage.local.set({ peerId: crypto.randomUUID().slice(0, 8) });
    }
    // Generate anonymous username if not exists
    if (!result.username) {
        const adjectives = ['Swift', 'Clever', 'Brave', 'Silent', 'Bright', 'Calm', 'Bold', 'Wise', 'Quick', 'Noble'];
        const animals = ['Fox', 'Panda', 'Tiger', 'Eagle', 'Wolf', 'Bear', 'Hawk', 'Lion', 'Otter', 'Raven'];
        const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
        const animal = animals[Math.floor(Math.random() * animals.length)];
        const num = Math.floor(Math.random() * 1000);
        const username = `${adj}_${animal}${num}`;
        chrome.storage.local.set({ username });
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
        console.warn(`[WeWatch] Firebase ${method} ${path} failed:`, err.message);
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

function generateAnonymousUsername() {
    const adjectives = ['Swift', 'Clever', 'Brave', 'Silent', 'Bright', 'Calm', 'Bold', 'Wise', 'Quick', 'Noble'];
    const animals = ['Fox', 'Panda', 'Tiger', 'Eagle', 'Wolf', 'Bear', 'Hawk', 'Lion', 'Otter', 'Raven'];
    const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
    const animal = animals[Math.floor(Math.random() * animals.length)];
    const num = Math.floor(Math.random() * 1000);
    return `${adj}_${animal}${num}`;
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

async function createRoom(isPublic = false, roomName = null, description = null) {
    const { peerId, username } = await chrome.storage.local.get(['peerId', 'username']);

    // Ensure username exists
    let finalUsername = username;
    if (!finalUsername) {
        finalUsername = generateAnonymousUsername();
        await chrome.storage.local.set({ username: finalUsername });
    }

    const newRoomId = generateRoomId();
    const currentUrl = await getActiveTabUrl();
    const norm = currentUrl ? normalizeUrl(currentUrl) : null;

    // Extract site domain
    let site = 'unknown';
    if (norm) {
        try {
            const u = new URL(norm);
            site = u.hostname.replace('www.', '');
        } catch (e) {
            site = 'unknown';
        }
    }

    // Create room data with extended schema
    const roomData = {
        createdAt: Date.now(),
        host: peerId,
        isPublic: isPublic,
        maxPeers: isPublic ? 5 : 2,
        peers: {
            [peerId]: {
                joined: Date.now(),
                username: finalUsername
            }
        },
        joinRequests: {},
        urls: norm ? { [peerId]: norm } : {},
        lastEvent: null,
        lastActivity: Date.now()
    };

    // Add public room metadata if public
    if (isPublic && roomName) {
        roomData.name = String(roomName).slice(0, 50);
        roomData.description = String(description || '').slice(0, 200);
        roomData.currentSite = site;
    }

    const res = await firebase('PUT', `rooms/${newRoomId}`, roomData);

    if (!res) {
        broadcastState({ error: 'Firebase connection failed.' });
        return;
    }

    // Add to public rooms listing if public
    if (isPublic) {
        await firebase('PUT', `publicRooms/${newRoomId}`, {
            name: roomData.name || 'Unnamed Room',
            description: roomData.description || '',
            createdAt: roomData.createdAt,
            userCount: 1,
            maxPeers: 5,
            currentSite: site,
            lastActivity: Date.now()
        });
    }

    // Store username in global mapping
    await firebase('PUT', `usernames/${peerId}`, {
        username: finalUsername,
        lastSeen: Date.now()
    });

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
        return { error: 'Invalid room code.' };
    }

    const room = await firebase('GET', `rooms/${code}`);
    if (!room) {
        broadcastState({ error: 'Room not found.' });
        return { error: 'Room not found.' };
    }

    // Stale room check
    if (room.createdAt && (Date.now() - room.createdAt) > ROOM_TTL_MS) {
        await firebase('DELETE', `rooms/${code}`);
        broadcastState({ error: 'Room expired.' });
        return { error: 'Room expired.' };
    }

    // Check capacity against maxPeers
    const maxPeers = room.maxPeers || 2;
    const peerCount = room.peers ? Object.keys(room.peers).length : 0;
    if (peerCount >= maxPeers) {
        broadcastState({ error: `Room is full (${maxPeers}/${maxPeers}).` });
        return { error: `Room is full (${maxPeers}/${maxPeers}).` };
    }

    const { peerId, username } = await chrome.storage.local.get(['peerId', 'username']);

    // Ensure username exists
    let finalUsername = username;
    if (!finalUsername) {
        finalUsername = generateAnonymousUsername();
        await chrome.storage.local.set({ username: finalUsername });
    }

    const currentUrl = await getActiveTabUrl();
    const norm = currentUrl ? normalizeUrl(currentUrl) : null;

    // Add user with username to joinRequests instead of peers
    await firebase('PATCH', `rooms/${code}/joinRequests`, {
        [peerId]: {
            timestamp: Date.now(),
            username: finalUsername,
            url: norm || ''
        }
    });

    await firebase('PATCH', `rooms/${code}`, {
        lastActivity: Date.now()
    });

    // Store username in global mapping
    await firebase('PUT', `usernames/${peerId}`, {
        username: finalUsername,
        lastSeen: Date.now()
    });

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
        peerConnected: false, // Initially false because we are waiting for host approval
        lastEventTimestamp: 0,
        isHost: false,
        myUrl: norm,
        peerUrl,
        urlMatch,
        waitingForApproval: true
    });

    broadcastState();
    return { ok: true };
}

async function acceptJoinRequest(requesterId) {
    const { roomId, peerId } = await chrome.storage.local.get(['roomId', 'peerId']);
    if (!roomId) return { ok: false };

    const room = await firebase('GET', `rooms/${roomId}`);
    if (!room || !room.joinRequests || !room.joinRequests[requesterId]) return { ok: false };

    const request = room.joinRequests[requesterId];

    // Remove from joinRequests
    await firebase('DELETE', `rooms/${roomId}/joinRequests/${requesterId}`);

    // Add to peers
    await firebase('PATCH', `rooms/${roomId}/peers`, {
        [requesterId]: {
            joined: Date.now(),
            username: request.username
        }
    });

    if (request.url) {
        await firebase('PATCH', `rooms/${roomId}/urls`, { [requesterId]: request.url });
    }

    // Update room activity explicitly
    await firebase('PATCH', `rooms/${roomId}`, {
        peerJoined: Date.now(),
        lastActivity: Date.now()
    });

    // Update publicRooms userCount if public
    if (room.isPublic) {
        const currentPeers = room.peers ? Object.keys(room.peers).length : 0;
        await firebase('PATCH', `publicRooms/${roomId}`, {
            userCount: currentPeers + 1,
            lastActivity: Date.now()
        });
    }

    return { ok: true };
}

async function denyJoinRequest(requesterId) {
    const { roomId } = await chrome.storage.local.get('roomId');
    if (!roomId) return { ok: false };
    
    // Remove from joinRequests
    await firebase('DELETE', `rooms/${roomId}/joinRequests/${requesterId}`);
    return { ok: true };
}

async function leaveRoom() {
    const { roomId, peerId } = await chrome.storage.local.get(['roomId', 'peerId']);

    if (roomId) {
        // Get room data before deletion
        const room = await firebase('GET', `rooms/${roomId}`);

        await firebase('DELETE', `rooms/${roomId}/peers/${peerId}`);
        await firebase('DELETE', `rooms/${roomId}/urls/${peerId}`);
        await firebase('DELETE', `rooms/${roomId}/joinRequests/${peerId}`);

        const peers = await firebase('GET', `rooms/${roomId}/peers`);
        const remainingCount = peers ? Object.keys(peers).length : 0;

        if (remainingCount === 0) {
            // Delete room entirely
            await firebase('DELETE', `rooms/${roomId}`);

            // Delete from publicRooms if public
            if (room && room.isPublic) {
                await firebase('DELETE', `publicRooms/${roomId}`);
            }
        } else {
            await firebase('PATCH', `rooms/${roomId}`, {
                peerLeft: Date.now(),
                lastActivity: Date.now()
            });

            // Update publicRooms userCount if public
            if (room && room.isPublic) {
                await firebase('PATCH', `publicRooms/${roomId}`, {
                    userCount: remainingCount,
                    lastActivity: Date.now()
                });
            }
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

// ─── Room Discovery ───────────────────────────────────────

function formatTimeAgo(ms) {
    const minutes = Math.floor(ms / 60000);
    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    return `${hours}h ago`;
}

async function getPublicRooms() {
    const data = await firebase('GET', 'publicRooms');
    if (!data) return [];

    const now = Date.now();
    const rooms = [];

    for (const [roomId, room] of Object.entries(data)) {
        // Filter expired rooms (>24 hours)
        if (room.createdAt && (now - room.createdAt) > ROOM_TTL_MS) {
            firebase('DELETE', `publicRooms/${roomId}`).catch(() => {});
            continue;
        }

        // Verify room still exists
        const roomData = await firebase('GET', `rooms/${roomId}`);
        if (!roomData) {
            firebase('DELETE', `publicRooms/${roomId}`).catch(() => {});
            continue;
        }

        const peerCount = roomData.peers ? Object.keys(roomData.peers).length : 0;
        const maxPeers = roomData.maxPeers || 5;

        // Skip full rooms
        if (peerCount >= maxPeers) continue;

        rooms.push({
            roomId,
            name: room.name || 'Unnamed Room',
            description: room.description || '',
            userCount: peerCount,
            maxPeers: maxPeers,
            currentSite: room.currentSite || 'unknown',
            createdAt: room.createdAt,
            timeAgo: formatTimeAgo(now - room.createdAt)
        });
    }

    // Sort by most recent
    return rooms.sort((a, b) => b.createdAt - a.createdAt);
}

// ─── Chat System ──────────────────────────────────────────

async function sendChatMessage(text) {
    const { roomId, peerId, username } = await chrome.storage.local.get(['roomId', 'peerId', 'username']);
    if (!roomId || !text) return false;

    const sanitized = String(text).slice(0, 500);
    const messageId = `${Date.now()}_${peerId.slice(0, 4)}`;

    await firebase('PUT', `chat/${roomId}/${messageId}`, {
        from: peerId,
        username: username || 'Anonymous',
        text: sanitized,
        timestamp: Date.now()
    });

    // Update room activity
    await firebase('PATCH', `rooms/${roomId}`, { lastActivity: Date.now() });

    return true;
}

async function getChatMessages(sinceTimestamp = 0) {
    const { roomId } = await chrome.storage.local.get('roomId');
    if (!roomId) return [];

    const data = await firebase('GET', `chat/${roomId}`);
    if (!data) return [];

    const messages = [];
    for (const [msgId, msg] of Object.entries(data)) {
        if (msg.timestamp > sinceTimestamp) {
            messages.push({ ...msg, id: msgId });
        }
    }

    // Sort by timestamp ascending
    return messages.sort((a, b) => a.timestamp - b.timestamp);
}

// ─── Presence System ──────────────────────────────────────

let presenceInterval = null;
let currentPresenceKey = null;

async function updatePresence(url, title) {
    if (!url) return;
    const key = urlToFirebaseKey(url);
    if (!key) return;
    const { peerId, openToMatch } = await chrome.storage.local.get(['peerId', 'openToMatch']);

    if (currentPresenceKey && currentPresenceKey !== key) {
        firebase('DELETE', `presence/${currentPresenceKey}/${peerId}`).catch(() => {});
    }
    currentPresenceKey = key;

    const presenceData = { lastSeen: Date.now(), url: url };
    if (title) presenceData.title = String(title).slice(0, 200);
    if (openToMatch) presenceData.openToMatch = true;

    await firebase('PATCH', `presence/${key}`, {
        [peerId]: presenceData
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

async function getTrendingPages() {
    const data = await firebase('GET', 'presence');
    if (!data || typeof data !== 'object') return [];

    const now = Date.now();
    const pageMap = {}; // url -> { count, title, url }

    for (const [key, users] of Object.entries(data)) {
        if (!users || typeof users !== 'object') continue;

        let pageUrl = null;
        let pageTitle = null;
        let activeCount = 0;

        for (const [pid, info] of Object.entries(users)) {
            if (!info || typeof info.lastSeen !== 'number') continue;
            if ((now - info.lastSeen) > PRESENCE_TTL_MS) {
                firebase('DELETE', `presence/${key}/${pid}`).catch(() => {});
                continue;
            }
            activeCount++;
            if (!pageUrl && info.url) pageUrl = info.url;
            if (!pageTitle && info.title) pageTitle = info.title;
        }

        if (activeCount >= 2 && pageUrl) {
            // Extract domain for display
            let domain = 'unknown';
            try {
                domain = new URL(pageUrl).hostname.replace('www.', '');
            } catch (e) {}

            pageMap[key] = {
                url: pageUrl,
                title: pageTitle || domain,
                domain: domain,
                count: activeCount
            };
        }
    }

    // Sort by count descending, return top 20
    return Object.values(pageMap)
        .sort((a, b) => b.count - a.count)
        .slice(0, 20);
}

async function getMatchableUsers(url) {
    if (!url) return [];
    const key = urlToFirebaseKey(url);
    if (!key) return [];
    const { peerId } = await chrome.storage.local.get('peerId');
    const data = await firebase('GET', `presence/${key}`);
    if (!data || typeof data !== 'object') return [];

    const now = Date.now();
    const users = [];
    for (const [pid, info] of Object.entries(data)) {
        if (pid === peerId) continue;
        if (!info || typeof info.lastSeen !== 'number') continue;
        if ((now - info.lastSeen) > PRESENCE_TTL_MS) continue;
        if (!info.openToMatch) continue;
        users.push({
            peerId: pid,
            url: info.url || url,
            title: info.title || 'Unknown'
        });
    }
    return users;
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
    }
    
    // Process Host / Guest Approval logic
    let extraState = {};
    if (state.isHost) {
        const joinReqs = room.joinRequests ? Object.entries(room.joinRequests).map(([id, data]) => ({ id, ...data })) : [];
        extraState.joinRequests = joinReqs;
    } else if (state.waitingForApproval) {
        // We are a guest waiting for approval
        if (peers.includes(state.peerId)) {
            // We were accepted!
            await chrome.storage.local.set({ waitingForApproval: false, peerConnected: true });
            extraState.waitingForApproval = false;
        } else if (!room.joinRequests || !room.joinRequests[state.peerId]) {
            // We were denied! (Removed from joinRequests but not in peers)
            await chrome.storage.local.set(INITIAL_STATE);
            broadcastState({ error: 'Host denied your request.' });
            return null;
        } else {
            // Still waiting
            extraState.waitingForApproval = true;
        }
    }

    if (stateChanged || Object.keys(extraState).length > 0) {
        broadcastState(extraState);
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
        waitingForApproval: state.waitingForApproval || false,
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
            createRoom(msg.isPublic, msg.name, msg.description)
                .then(() => sendResponse({ ok: true }))
                .catch(() => sendResponse({ ok: false }));
            return true;

        case 'join_room':
            joinRoom(msg.roomId)
                .then(result => sendResponse(result))
                .catch(() => sendResponse({ error: 'Failed to join' }));
            return true;

        case 'get_public_rooms':
            getPublicRooms()
                .then(rooms => sendResponse({ rooms }))
                .catch(() => sendResponse({ rooms: [] }));
            return true;

        case 'join_public_room':
            joinRoom(msg.roomId)
                .then(result => sendResponse(result))
                .catch(() => sendResponse({ error: 'Failed to join' }));
            return true;
            
        case 'accept_join_request':
            acceptJoinRequest(msg.requesterId)
                .then(result => sendResponse(result))
                .catch(() => sendResponse({ ok: false }));
            return true;
            
        case 'deny_join_request':
            denyJoinRequest(msg.requesterId)
                .then(result => sendResponse(result))
                .catch(() => sendResponse({ ok: false }));
            return true;

        case 'send_chat':
            sendChatMessage(msg.text)
                .then(ok => sendResponse({ ok }))
                .catch(() => sendResponse({ ok: false }));
            return true;

        case 'get_chat_messages':
            getChatMessages(msg.since)
                .then(messages => sendResponse({ messages }))
                .catch(() => sendResponse({ messages: [] }));
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
                    src: String(msg.src || '').slice(0, 500),
                    currentTime: msg.currentTime || 0,
                    duration: msg.duration || 0
                }
            });
            sendResponse({ ok: true });
            return true;
            
        case 'media_timeupdate':
            chrome.storage.local.get(['mediaInfo']).then((result) => {
                if (result.mediaInfo) {
                    result.mediaInfo.currentTime = msg.currentTime || 0;
                    result.mediaInfo.duration = msg.duration || 0;
                    chrome.storage.local.set({ mediaInfo: result.mediaInfo });
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

        case 'forward_sync':
            if (sender.tab) {
                chrome.tabs.sendMessage(sender.tab.id, {
                    type: 'sync_command',
                    ...msg.event
                }).catch(() => {});
            }
            sendResponse({ ok: true });
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

        case 'get_trending':
            getTrendingPages()
                .then(pages => sendResponse({ pages }))
                .catch(() => sendResponse({ pages: [] }));
            return true;

        case 'update_page_title':
            if (msg.title && msg.url) {
                chrome.storage.local.set({ pageTitle: String(msg.title).slice(0, 200) });
            }
            sendResponse({ ok: true });
            return true;

        case 'get_youtube_live':
            getYouTubeLive(msg.query || '')
                .then(result => sendResponse(result))
                .catch(err => sendResponse({ videos: [], error: err.message }));
            return true;

        case 'set_matchmaking':
            chrome.storage.local.set({ openToMatch: !!msg.enabled }, () => {
                // Force presence update
                chrome.tabs.query({ active: true, lastFocusedWindow: true }, ([tab]) => {
                    if (tab && tab.url) {
                        updatePresence(normalizeUrl(tab.url), null);
                    }
                });
                sendResponse({ ok: true });
            });
            return true;

        case 'get_matchable_users':
            if (msg.url) {
                getMatchableUsers(normalizeUrl(msg.url))
                    .then(users => sendResponse({ users }))
                    .catch(() => sendResponse({ users: [] }));
            } else {
                sendResponse({ users: [] });
            }
            return true;

        case 'send_match_request':
            // Store request in Firebase for the target peer to discover
            (async () => {
                try {
                    const { peerId } = await chrome.storage.local.get('peerId');
                    await firebase('PUT', `matchRequests/${msg.targetPeerId}/${peerId}`, {
                        from: peerId,
                        url: msg.url || '',
                        title: msg.title || '',
                        timestamp: Date.now()
                    });
                    sendResponse({ ok: true });
                } catch (e) {
                    sendResponse({ ok: false, error: e.message });
                }
            })();
            return true;

        case 'get_match_requests':
            // Check if anyone wants to match with me
            (async () => {
                try {
                    const { peerId } = await chrome.storage.local.get('peerId');
                    const requests = await firebase('GET', `matchRequests/${peerId}`);
                    if (!requests || typeof requests !== 'object') {
                        sendResponse({ requests: [] });
                        return;
                    }
                    const now = Date.now();
                    const valid = Object.entries(requests)
                        .filter(([, r]) => r && (now - r.timestamp) < 60000) // 60s TTL
                        .map(([fromId, r]) => ({
                            fromPeerId: fromId,
                            url: r.url || '',
                            title: r.title || 'Unknown',
                            timestamp: r.timestamp
                        }));
                    sendResponse({ requests: valid });
                } catch (e) {
                    sendResponse({ requests: [] });
                }
            })();
            return true;

        case 'accept_match':
            // Accept match request → create room
            (async () => {
                try {
                    const roomId = generateRoomId();
                    const { peerId } = await chrome.storage.local.get('peerId');
                    // Clean up the match request
                    await firebase('DELETE', `matchRequests/${peerId}/${msg.fromPeerId}`);
                    // Create room
                    await firebase('PUT', `rooms/${roomId}`, {
                        host: peerId,
                        peer: msg.fromPeerId,
                        createdAt: Date.now(),
                        isPublic: false
                    });
                    await chrome.storage.local.set({
                        roomId,
                        isHost: true,
                        isConnected: true,
                        peerConnected: true,
                        openToMatch: false
                    });
                    broadcastState();
                    sendResponse({ ok: true, roomId });
                } catch (e) {
                    sendResponse({ ok: false, error: e.message });
                }
            })();
            return true;

        case 'decline_match':
            // Remove the match request
            (async () => {
                try {
                    const { peerId } = await chrome.storage.local.get('peerId');
                    await firebase('DELETE', `matchRequests/${peerId}/${msg.fromPeerId}`);
                    sendResponse({ ok: true });
                } catch (e) {
                    sendResponse({ ok: false });
                }
            })();
            return true;
    }
});

// ─── YouTube Live API ─────────────────────────────────────

async function getYouTubeLive(query) {
    if (!YT_API_KEY) return { videos: [], error: 'API key not configured' };

    try {
        const params = new URLSearchParams({
            part: 'snippet',
            type: 'video',
            eventType: 'live',
            order: 'viewCount',
            maxResults: '15',
            key: YT_API_KEY,
            relevanceLanguage: 'tr',
            q: query || 'live'
        });

        const searchRes = await fetch(`https://www.googleapis.com/youtube/v3/search?${params}`, {
            cache: 'no-store'
        });
        
        if (!searchRes.ok) {
            const errBody = await searchRes.json().catch(() => ({}));
            const errMsg = errBody?.error?.message || `HTTP ${searchRes.status}`;
            console.warn('[WeWatch] YouTube API error:', errMsg);
            return { videos: [], error: errMsg };
        }
        
        const searchData = await searchRes.json();

        if (!searchData.items || searchData.items.length === 0) {
            return { videos: [], error: null };
        }

        // Get video details (view counts)
        const videoIds = searchData.items.map(item => item.id.videoId).join(',');
        const detailsRes = await fetch(
            `https://www.googleapis.com/youtube/v3/videos?part=liveStreamingDetails,statistics&id=${videoIds}&key=${YT_API_KEY}`,
            { cache: 'no-store' }
        );
        
        let detailsMap = {};
        if (detailsRes.ok) {
            const detailsData = await detailsRes.json();
            if (detailsData.items) {
                detailsData.items.forEach(item => {
                    detailsMap[item.id] = {
                        viewers: item.liveStreamingDetails?.concurrentViewers || '0',
                        viewCount: item.statistics?.viewCount || '0'
                    };
                });
            }
        }

        const videos = searchData.items.map(item => {
            const videoId = item.id.videoId;
            const details = detailsMap[videoId] || {};
            return {
                videoId,
                title: item.snippet.title,
                channel: item.snippet.channelTitle,
                thumbnail: item.snippet.thumbnails?.medium?.url || item.snippet.thumbnails?.default?.url,
                viewers: parseInt(details.viewers || '0'),
                url: `https://www.youtube.com/watch?v=${videoId}`
            };
        }).sort((a, b) => b.viewers - a.viewers);

        return { videos, error: null };

    } catch (err) {
        console.warn('[WeWatch] YouTube API error:', err.message);
        return { videos: [], error: err.message };
    }
}

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
