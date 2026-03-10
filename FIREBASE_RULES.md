# Firebase Security Rules for SyncWatch

Apply these rules in Firebase Console → Realtime Database → Rules.

```json
{
  "rules": {
    "rooms": {
      "$roomId": {
        ".read": true,
        ".write": true,
        ".validate": "newData.hasChildren(['createdAt', 'host'])",
        "createdAt": { ".validate": "newData.isNumber()" },
        "host": { ".validate": "newData.isString() && newData.val().length <= 10" },
        "peers": {
          "$peerId": { ".validate": "newData.isBoolean()" }
        },
        "urls": {
          "$peerId": { ".validate": "newData.isString() && newData.val().length <= 500" }
        },
        "lastEvent": {
          ".validate": "newData.hasChildren(['action', 'currentTime', 'timestamp', 'from'])",
          "action": { ".validate": "newData.isString() && newData.val().length <= 20" },
          "currentTime": { ".validate": "newData.isNumber()" },
          "playbackRate": { ".validate": "newData.isNumber()" },
          "timestamp": { ".validate": "newData.isNumber()" },
          "from": { ".validate": "newData.isString() && newData.val().length <= 10" }
        }
      }
    },
    "presence": {
      "$urlKey": {
        ".read": true,
        ".write": true,
        "$peerId": {
          ".validate": "newData.hasChild('lastSeen')",
          "lastSeen": { ".validate": "newData.isNumber()" }
        }
      }
    }
  }
}
```

> **Note**: For production, replace `.write: true` with authenticated writes using Firebase Auth.
