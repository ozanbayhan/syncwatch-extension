# Privacy Policy — SyncWatch

**Last Updated:** March 11, 2026

## What SyncWatch Does
SyncWatch is a browser extension that allows two users to synchronize video and audio playback in real-time. Users create or join rooms using a unique code and share the same playback state.

## Data We Collect

### 1. Page URL (Temporary)
- **What:** The URL of the page you are currently viewing.
- **Why:** To check if you and your sync partner are on the same page, and to show you how many SyncWatch users are on the same page.
- **How stored:** URLs are stored temporarily in Firebase Realtime Database only while you are connected to a room. They are deleted when you leave the room.
- **Not stored permanently.** We do not build browsing history profiles.

### 2. Room & Session Data (Temporary)
- **What:** Room code, peer ID (random 8-character string, not linked to your identity), playback state (play/pause/seek position).
- **Why:** To synchronize media playback between two users.
- **How stored:** Stored in Firebase only during the session. Rooms are automatically deleted when both users leave or after 24 hours.

### 3. Presence Data (Temporary)
- **What:** An anonymized page identifier and a timestamp.
- **Why:** To show the count of SyncWatch users on the same page.
- **How stored:** Automatically deleted after 90 seconds of inactivity.

## Data We Do NOT Collect
- ❌ Personal information (name, email, etc.)
- ❌ Browsing history
- ❌ Cookies or login credentials
- ❌ Video/audio content
- ❌ Analytics or tracking data
- ❌ Data sold to third parties

## Third-Party Services
- **Firebase Realtime Database** (Google): Used for real-time signaling. Data is processed under [Google's Privacy Policy](https://policies.google.com/privacy).

## Data Retention
All data is ephemeral and automatically deleted:
- Room data: Deleted on disconnect or after 24 hours
- Presence data: Deleted after 90 seconds of inactivity
- No server-side logs are maintained

## Permissions Justification
| Permission | Reason |
|-----------|--------|
| `storage` | Save your language preference and session state locally |
| `tabs` | Read current tab URL for page matching feature |
| `activeTab` | Interact with the current tab when you click the extension |
| `<all_urls>` (content script) | Detect video/audio elements on any website |
| Firebase host permissions | Communicate with the sync server |

## Contact
For questions about this privacy policy, contact: ozanbayhan@gmail.com

## Changes
We may update this policy. Changes will be posted here with an updated date.
