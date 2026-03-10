# ⚡ SyncWatch

**Watch videos and listen to audio in sync with a friend — anywhere on the web.**

![Chrome Extension](https://img.shields.io/badge/Chrome-Extension-blue?logo=googlechrome&logoColor=white)
![Manifest V3](https://img.shields.io/badge/Manifest-V3-green)
![License](https://img.shields.io/badge/License-MIT-yellow)

## ✨ Features

- 🎬 **Real-time sync** — Play, pause, seek synchronized between two users
- 🔗 **URL matching** — See if you and your partner are on the same page
- 👥 **Active users** — See how many SyncWatch users are on the same page
- 🌍 **12 languages** — EN, TR, ES, FR, DE, PT, RU, JA, KO, ZH, AR, HI
- 📌 **Draggable overlay** — Floating status widget on any page
- ⚡ **One-click sync fix** — Instantly align playback if drift is detected

## 🚀 How to Use

1. Install SyncWatch on both browsers
2. Open the same video/audio page
3. Click the SyncWatch icon → **Create Room**
4. Share the 6-digit code with your friend
5. They click **Join** and enter the code
6. Enjoy synchronized playback! 🎉

## 🛠️ Development

### Prerequisites
- Google Chrome
- Firebase Realtime Database (free tier works)

### Setup
1. Clone this repo
2. Edit `config.js` with your Firebase database URL
3. Go to `chrome://extensions` → Enable **Developer mode**
4. Click **Load unpacked** → Select the `syncwatch-extension` folder

### Firebase Setup
1. Go to [Firebase Console](https://console.firebase.google.com)
2. Create a project → **Realtime Database** → **Create Database** (test mode)
3. Copy the database URL to `config.js`
4. Apply the security rules from `FIREBASE_RULES.md`

## 📁 Project Structure

```
syncwatch-extension/
├── manifest.json          # Extension manifest (MV3)
├── config.js              # Firebase configuration
├── locales.js             # 12-language i18n system
├── background/
│   └── background.js      # Service worker (rooms, presence, sync)
├── content/
│   └── content.js         # Media detection, overlay UI, sync
├── popup/
│   ├── popup.html         # Extension popup
│   ├── popup.css          # Popup styles
│   └── popup.js           # Popup logic + language selector
├── icons/
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
├── PRIVACY_POLICY.md      # Privacy policy
└── FIREBASE_RULES.md      # Firebase security rules
```

## 🔒 Privacy

- No personal data collected
- No browsing history stored
- All session data is temporary and auto-deleted
- See [Privacy Policy](PRIVACY_POLICY.md) for details

## 📄 License

MIT License — feel free to use and modify.
