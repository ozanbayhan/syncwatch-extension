// SyncWatch Popup Script — v3.0 Production

document.addEventListener('DOMContentLoaded', () => {
    // ─── Elements ─────────────────────────────────────────────
    const statusDot = document.getElementById('statusDot');
    const viewDisconnected = document.getElementById('viewDisconnected');
    const viewWaiting = document.getElementById('viewWaiting');
    const viewSynced = document.getElementById('viewSynced');
    const toast = document.getElementById('toast');
    const toastMessage = document.getElementById('toastMessage');

    const btnCreate = document.getElementById('btnCreate');
    const btnJoin = document.getElementById('btnJoin');
    const inputRoomId = document.getElementById('inputRoomId');
    const roomCode = document.getElementById('roomCode');
    const btnCopy = document.getElementById('btnCopy');
    const btnLeaveWaiting = document.getElementById('btnLeaveWaiting');
    const syncRoomId = document.getElementById('syncRoomId');
    const mediaLabel = document.getElementById('mediaLabel');
    const btnDisconnect = document.getElementById('btnDisconnect');

    const presenceBar = document.getElementById('presenceBar');
    const presenceText = document.getElementById('presenceText');
    const urlStatus = document.getElementById('urlStatus');
    const urlStatusIcon = document.getElementById('urlStatusIcon');
    const urlStatusText = document.getElementById('urlStatusText');
    const btnGoToPage = document.getElementById('btnGoToPage');
    const langSelect = document.getElementById('langSelect');

    // ─── i18n ─────────────────────────────────────────────────
    let currentLang = 'en';

    function _(key) {
        return t(key, currentLang);
    }

    function initLangSelector() {
        // Populate language dropdown
        langSelect.innerHTML = '';
        for (const [code, locale] of Object.entries(SYNCWATCH_LOCALES)) {
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
            showView(viewDisconnected);
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

    // ─── Media Status ─────────────────────────────────────────
    function checkMediaStatus() {
        chrome.storage.local.get(['mediaInfo'], (result) => {
            if (result.mediaInfo) {
                const type = result.mediaInfo.tagName === 'VIDEO' ? _('videoDetected') : _('audioDetected');
                mediaLabel.textContent = type;
            } else {
                mediaLabel.textContent = _('noMedia');
            }
        });
    }

    // ─── Event Handlers ───────────────────────────────────────

    btnCreate.addEventListener('click', () => {
        btnCreate.disabled = true;
        chrome.runtime.sendMessage({ type: 'create_room' }, () => {
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

    btnDisconnect.addEventListener('click', () => {
        chrome.runtime.sendMessage({ type: 'leave_room' });
    });

    btnGoToPage.addEventListener('click', () => {
        chrome.runtime.sendMessage({ type: 'navigate_to_peer' });
    });

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

    setInterval(() => {
        if (!viewSynced.classList.contains('hidden')) checkMediaStatus();
    }, 3000);
});
