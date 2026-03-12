// WeWatch Popup Script — v3.0 Production

document.addEventListener('DOMContentLoaded', () => {
    // ─── Elements ─────────────────────────────────────────────
    const statusDot = document.getElementById('statusDot');
    const viewDisconnected = document.getElementById('viewDisconnected');
    const viewWaiting = document.getElementById('viewWaiting');
    const viewSynced = document.getElementById('viewSynced');
    const viewBrowse = document.getElementById('viewBrowse');
    const viewRequestPending = document.getElementById('viewRequestPending');
    const toast = document.getElementById('toast');
    const toastMessage = document.getElementById('toastMessage');

    const btnCreate = document.getElementById('btnCreate');
    const btnJoin = document.getElementById('btnJoin');
    const inputRoomId = document.getElementById('inputRoomId');
    const roomCode = document.getElementById('roomCode');
    const btnCopy = document.getElementById('btnCopy');
    const btnLeaveWaiting = document.getElementById('btnLeaveWaiting');
    const btnCancelRequest = document.getElementById('btnCancelRequest');
    const syncRoomId = document.getElementById('syncRoomId');
    const mediaLabel = document.getElementById('mediaLabel');
    const mediaDuration = document.getElementById('mediaDuration');
    const btnDisconnect = document.getElementById('btnDisconnect');

    const presenceBar = document.getElementById('presenceBar');
    const presenceText = document.getElementById('presenceText');
    const urlStatus = document.getElementById('urlStatus');
    const urlStatusIcon = document.getElementById('urlStatusIcon');
    const urlStatusText = document.getElementById('urlStatusText');
    const btnGoToPage = document.getElementById('btnGoToPage');
    const langSelect = document.getElementById('langSelect');

    // Advanced options elements
    const btnAdvanced = document.getElementById('btnAdvanced');
    const roomOptions = document.getElementById('roomOptions');
    const publicRoomToggle = document.getElementById('publicRoomToggle');
    const roomName = document.getElementById('roomName');
    const roomDescription = document.getElementById('roomDescription');

    // Browse view elements
    const btnBrowse = document.getElementById('btnBrowse');
    const btnBackFromBrowse = document.getElementById('btnBackFromBrowse');
    const filterOccupancy = document.getElementById('filterOccupancy');
    const roomsList = document.getElementById('roomsList');

    // Host Approval elements
    const joinReqCountWaiting = document.getElementById('joinReqCountWaiting');
    const requestListWaiting = document.getElementById('requestListWaiting');
    const joinRequestsPanelWaiting = document.getElementById('joinRequestsPanelWaiting');

    const joinReqCountSynced = document.getElementById('joinReqCountSynced');
    const requestListSynced = document.getElementById('requestListSynced');
    const joinRequestsPanelSynced = document.getElementById('joinRequestsPanelSynced');

    // ─── i18n ─────────────────────────────────────────────────
    let currentLang = 'en';

    function _(key) {
        return t(key, currentLang);
    }

    function initLangSelector() {
        // Populate language dropdown
        langSelect.innerHTML = '';
        for (const [code, locale] of Object.entries(WeWatch_LOCALES)) {
            const opt = document.createElement('option');
            opt.value = code;
            opt.textContent = `${locale.flag} ${locale.name}`;
            langSelect.appendChild(opt);
        }

        // Load saved language
        getSavedLang((lang) => {
            currentLang = lang;
            langSelect.value = lang;
            applyTranslations();
        });

        langSelect.addEventListener('change', () => {
            currentLang = langSelect.value;
            saveLang(currentLang);
            applyTranslations();

            // Notify content script about language change
            chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
                if (tab) {
                    chrome.tabs.sendMessage(tab.id, {
                        type: 'lang_changed',
                        lang: currentLang
                    }).catch(() => {});
                }
            });
        });
    }

    function applyTranslations() {
        document.querySelectorAll('[data-i18n]').forEach(el => {
            const key = el.getAttribute('data-i18n');
            el.textContent = _(key);
        });
        document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
            const key = el.getAttribute('data-i18n-placeholder');
            el.placeholder = _(key);
        });
    }

    // ─── View Management ──────────────────────────────────────
    function showView(view) {
        viewDisconnected.classList.add('hidden');
        viewWaiting.classList.add('hidden');
        viewSynced.classList.add('hidden');
        viewBrowse.classList.add('hidden');
        viewRequestPending.classList.add('hidden');
        view.classList.remove('hidden');
    }

    // ─── State Update ─────────────────────────────────────────
    function updateUI(state) {
        // Presence bar
        if (state.presenceCount && state.presenceCount > 0) {
            presenceBar.style.display = 'flex';
            presenceText.textContent = `${state.presenceCount} ${_('usersOnPage')}`;
        } else {
            presenceBar.style.display = 'none';
        }

        if (!state.isConnected && !state.roomId) {
            statusDot.className = 'status-dot';
            statusDot.title = _('disconnected');
            if (viewBrowse.classList.contains('hidden')) {
                showView(viewDisconnected);
            }
        } else if (state.waitingForApproval) {
            statusDot.className = 'status-dot';
            statusDot.title = 'Waiting...';
            showView(viewRequestPending);
        } else if (state.roomId && !state.peerConnected) {
            if (state.isHost) {
                statusDot.className = 'status-dot connected';
                statusDot.title = _('waitingPeer');
                roomCode.textContent = state.roomId;
                showView(viewWaiting);
            } else {
                showToast(_('hostDisconnected'), 'error');
                chrome.runtime.sendMessage({ type: 'leave_room' });
            }
        } else if (state.roomId && state.peerConnected) {
            statusDot.className = 'status-dot synced';
            statusDot.title = _('synced');
            syncRoomId.textContent = state.roomId;
            showView(viewSynced);
            checkMediaStatus();

            // URL Match Status
            if (state.urlMatch === true) {
                urlStatus.style.display = 'flex';
                urlStatus.className = 'url-status match';
                urlStatusIcon.textContent = '✅';
                urlStatusText.textContent = _('samePage');
                btnGoToPage.style.display = 'none';
            } else if (state.urlMatch === false) {
                urlStatus.style.display = 'flex';
                urlStatus.className = 'url-status mismatch';
                urlStatusIcon.textContent = '⚠️';
                urlStatusText.textContent = _('diffPage');
                btnGoToPage.style.display = 'flex';
                btnGoToPage.textContent = `→ ${_('goToPage')}`;
            } else {
                urlStatus.style.display = 'none';
                btnGoToPage.style.display = 'none';
            }
        }

        // Render Join Requests if host
        if (state.isHost && state.joinRequests) {
            renderJoinRequests(state.joinRequests);
        } else {
            joinRequestsPanelWaiting.classList.add('hidden');
            joinRequestsPanelSynced.classList.add('hidden');
        }

        if (state.error) {
            showToast(state.error, 'error');
        }
    }

    // ─── Toast ────────────────────────────────────────────────
    function showToast(message, type = 'error') {
        toastMessage.textContent = message;
        toast.className = `toast ${type === 'success' ? 'success' : ''}`;
        toast.classList.remove('hidden');
        setTimeout(() => toast.classList.add('hidden'), 3000);
    }

    // ─── Format Time ──────────────────────────────────────────
    function formatTime(seconds) {
        if (!seconds || isNaN(seconds) || seconds < 0) return '00:00';
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = Math.floor(seconds % 60);
        
        const pad = (num) => num.toString().padStart(2, '0');
        
        if (h > 0) return `${h}:${pad(m)}:${pad(s)}`;
        return `${pad(m)}:${pad(s)}`;
    }

    // ─── Media Status ─────────────────────────────────────────
    function checkMediaStatus() {
        chrome.storage.local.get(['mediaInfo'], (result) => {
            if (result.mediaInfo) {
                const type = result.mediaInfo.tagName === 'VIDEO' ? _('videoDetected') : _('audioDetected');
                mediaLabel.textContent = type;
                
                if (result.mediaInfo.duration > 0) {
                    const ct = formatTime(result.mediaInfo.currentTime);
                    const dt = formatTime(result.mediaInfo.duration);
                    mediaDuration.textContent = `${ct} / ${dt}`;
                    mediaDuration.style.display = 'block';
                } else {
                    mediaDuration.style.display = 'none';
                }
            } else {
                mediaLabel.textContent = _('noMedia');
                mediaDuration.style.display = 'none';
            }
        });
    }

    // ─── Event Handlers ───────────────────────────────────────

    // Advanced options toggle
    btnAdvanced.addEventListener('click', () => {
        const isVisible = roomOptions.style.display !== 'none';
        roomOptions.style.display = isVisible ? 'none' : 'block';
        btnAdvanced.textContent = _(isVisible ? 'advancedOptions' : 'hideOptions');
    });

    // Show/hide name/description when public is toggled
    publicRoomToggle.addEventListener('change', () => {
        const isPublic = publicRoomToggle.checked;
        roomName.style.display = isPublic ? 'block' : 'none';
        roomDescription.style.display = isPublic ? 'block' : 'none';
    });

    btnCreate.addEventListener('click', () => {
        btnCreate.disabled = true;

        const isPublic = publicRoomToggle.checked;
        const name = roomName.value.trim();
        const desc = roomDescription.value.trim();

        chrome.runtime.sendMessage({
            type: 'create_room',
            isPublic: isPublic,
            name: name || null,
            description: desc || null
        }, () => {
            btnCreate.disabled = false;
        });
    });

    btnJoin.addEventListener('click', () => {
        const code = inputRoomId.value.trim().toUpperCase();
        if (code.length < 4) {
            showToast(_('invalidCode'));
            return;
        }
        btnJoin.disabled = true;
        chrome.runtime.sendMessage({ type: 'join_room', roomId: code }, () => {
            btnJoin.disabled = false;
        });
    });

    inputRoomId.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') btnJoin.click();
    });

    // Only allow valid room code characters
    inputRoomId.addEventListener('input', () => {
        inputRoomId.value = inputRoomId.value.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
    });

    btnCopy.addEventListener('click', () => {
        navigator.clipboard.writeText(roomCode.textContent).then(() => {
            showToast(_('codeCopied'), 'success');
        });
    });

    btnLeaveWaiting.addEventListener('click', () => {
        chrome.runtime.sendMessage({ type: 'leave_room' });
    });

    btnCancelRequest.addEventListener('click', () => {
        chrome.runtime.sendMessage({ type: 'leave_room' });
    });

    btnDisconnect.addEventListener('click', () => {
        chrome.runtime.sendMessage({ type: 'leave_room' });
    });

    btnGoToPage.addEventListener('click', () => {
        chrome.runtime.sendMessage({ type: 'navigate_to_peer' });
    });

    // Browse view handlers
    btnBrowse.addEventListener('click', () => {
        showView(viewBrowse);
        loadPublicRooms();
    });

    btnBackFromBrowse.addEventListener('click', () => {
        showView(viewDisconnected);
    });

    filterOccupancy.addEventListener('change', loadPublicRooms);

    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    async function loadPublicRooms() {
        const occupancyFilter = filterOccupancy.value;

        chrome.runtime.sendMessage({ type: 'get_public_rooms' }, (response) => {
            if (!response || !response.rooms) {
                roomsList.innerHTML = `<p class="no-rooms" data-i18n="noRoomsFound">No public rooms found</p>`;
                return;
            }

            let rooms = response.rooms;

            // Client-side occupancy filter
            if (occupancyFilter) {
                rooms = rooms.filter(r => {
                    const ratio = r.userCount / r.maxPeers;
                    if (occupancyFilter === 'empty') return r.userCount === 0;
                    if (occupancyFilter === 'half') return ratio > 0 && ratio <= 0.6;
                    if (occupancyFilter === 'almost') return ratio > 0.6;
                    return true;
                });
            }

            if (rooms.length === 0) {
                roomsList.innerHTML = `<p class="no-rooms">No rooms match your filter</p>`;
                return;
            }

            roomsList.innerHTML = rooms.map(room => `
                <div class="room-item">
                    <div class="room-header">
                        <span class="room-name">${escapeHtml(room.name)}</span>
                        <span class="room-badge">${room.userCount}/${room.maxPeers}</span>
                    </div>
                    <div class="room-meta">
                        <span class="room-site">🌐 ${escapeHtml(room.currentSite)}</span>
                        <span class="room-time">⏱ ${room.timeAgo}</span>
                    </div>
                    ${room.description ? `<p class="room-desc">${escapeHtml(room.description)}</p>` : ''}
                    <button class="btn-join-room" data-room-id="${room.roomId}">${_('joinRoom')}</button>
                </div>
            `).join('');

            // Attach click handlers
            document.querySelectorAll('.btn-join-room').forEach(btn => {
                btn.addEventListener('click', () => {
                    const roomId = btn.getAttribute('data-room-id');
                    chrome.runtime.sendMessage({ type: 'join_public_room', roomId }, (res) => {
                        if (res && !res.error) {
                            // Will be handled by state update
                        } else {
                            showToast(res.error || 'Failed to join', 'error');
                        }
                    });
                });
            });
        });
    }

    // ─── Host Approval Handlers ───────────────────────────────

    function renderJoinRequests(requests) {
        const count = requests.length;

        // Waiting View Update
        joinReqCountWaiting.textContent = count;
        requestListWaiting.innerHTML = '';
        if (count > 0 && !viewWaiting.classList.contains('hidden')) {
            joinRequestsPanelWaiting.classList.remove('hidden');
        } else {
            joinRequestsPanelWaiting.classList.add('hidden');
        }

        // Synced View Update
        joinReqCountSynced.textContent = count;
        requestListSynced.innerHTML = '';
        if (count > 0 && !viewSynced.classList.contains('hidden')) {
            joinRequestsPanelSynced.classList.remove('hidden');
        } else {
            joinRequestsPanelSynced.classList.add('hidden');
        }

        if (count === 0) return;

        const html = requests.map(req => {
            const domain = req.url ? escapeHtml(new URL(req.url).hostname) : 'Unknown site';
            return `
                <div class="request-item">
                    <div class="request-info">
                        <span class="request-name">${escapeHtml(req.username)}</span>
                        <span class="request-site">${domain}</span>
                    </div>
                    <div class="request-actions">
                        <button class="btn-req accept" data-id="${escapeHtml(req.id)}">✓</button>
                        <button class="btn-req deny" data-id="${escapeHtml(req.id)}">✕</button>
                    </div>
                </div>
            `;
        }).join('');

        requestListWaiting.innerHTML = html;
        requestListSynced.innerHTML = html;

        document.querySelectorAll('.btn-req.accept').forEach(btn => {
            btn.addEventListener('click', () => {
                const id = btn.getAttribute('data-id');
                chrome.runtime.sendMessage({ type: 'accept_join_request', requesterId: id });
            });
        });

        document.querySelectorAll('.btn-req.deny').forEach(btn => {
            btn.addEventListener('click', () => {
                const id = btn.getAttribute('data-id');
                chrome.runtime.sendMessage({ type: 'deny_join_request', requesterId: id });
            });
        });
    }

    // ─── State Listener ───────────────────────────────────────

    chrome.runtime.onMessage.addListener((msg) => {
        if (msg.type === 'state_update') updateUI(msg);
    });

    // ─── Initialization ───────────────────────────────────────

    function fetchState() {
        chrome.runtime.sendMessage({ type: 'get_state' }, (response) => {
            if (chrome.runtime.lastError) return;
            if (response) updateUI(response);
        });
    }

    function fetchPresence() {
        chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
            if (tab && tab.url) {
                chrome.runtime.sendMessage({ type: 'get_presence', url: tab.url }, (response) => {
                    if (chrome.runtime.lastError) return;
                    if (response && response.count > 0) {
                        presenceBar.style.display = 'flex';
                        presenceText.textContent = `${response.count} ${_('usersOnPage')}`;
                    }
                });
            }
        });
    }

    initLangSelector();
    fetchState();
    fetchPresence();

    setInterval(fetchState, 1000);
    setInterval(fetchPresence, 15000);

    // Update media duration much faster (every second) to seem real-time
    setInterval(() => {
        if (!viewSynced.classList.contains('hidden')) checkMediaStatus();
    }, 1000);
    
    // Attempt to restore overlay in the active tab when popup opens
    chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
        if (tab && tab.id) {
            chrome.tabs.sendMessage(tab.id, { type: 'restore_overlay' }).catch(() => {});
        }
    });
});
