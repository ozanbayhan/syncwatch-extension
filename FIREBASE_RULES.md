# Firebase Security Rules for SyncWatch

Apply these rules in Firebase Console → Realtime Database → Rules.

```json
{
  "rules": {
    "rooms": {
      "$roomId": {
        ".read": true,
        ".write": true,
        ".validate": "newData.hasChildren(['createdAt', 'host', 'peers'])",
        "createdAt": { ".validate": "newData.isNumber()" },
        "host": { ".validate": "newData.isString() && newData.val().length <= 10" },
        "isPublic": { ".validate": "newData.isBoolean()" },
        "name": { ".validate": "!newData.exists() || (newData.isString() && newData.val().length <= 50)" },
        "description": { ".validate": "!newData.exists() || (newData.isString() && newData.val().length <= 200)" },
        "maxPeers": { ".validate": "newData.isNumber() && newData.val() >= 2 && newData.val() <= 10" },
        "currentSite": { ".validate": "!newData.exists() || newData.isString()" },
        "lastActivity": { ".validate": "newData.isNumber()" },
        "peers": {
          "$peerId": {
            ".validate": "newData.hasChildren(['joined', 'username'])",
            "joined": { ".validate": "newData.isNumber()" },
            "username": { ".validate": "newData.isString() && newData.val().length <= 30" }
          }
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
    "publicRooms": {
      "$roomId": {
        ".read": true,
        ".write": true,
        ".validate": "newData.hasChildren(['name', 'createdAt', 'userCount'])",
        "name": { ".validate": "newData.isString() && newData.val().length <= 50" },
        "description": { ".validate": "!newData.exists() || (newData.isString() && newData.val().length <= 200)" },
        "createdAt": { ".validate": "newData.isNumber()" },
        "userCount": { ".validate": "newData.isNumber() && newData.val() >= 0 && newData.val() <= 10" },
        "maxPeers": { ".validate": "newData.isNumber() && newData.val() >= 2 && newData.val() <= 10" },
        "currentSite": { ".validate": "!newData.exists() || newData.isString()" },
        "lastActivity": { ".validate": "newData.isNumber()" }
      }
    },
    "chat": {
      "$roomId": {
        "$messageId": {
          ".read": true,
          ".write": true,
          ".validate": "newData.hasChildren(['from', 'username', 'text', 'timestamp'])",
          "from": { ".validate": "newData.isString() && newData.val().length <= 10" },
          "username": { ".validate": "newData.isString() && newData.val().length <= 30" },
          "text": { ".validate": "newData.isString() && newData.val().length <= 500" },
          "timestamp": { ".validate": "newData.isNumber()" }
        }
      }
    },
    "usernames": {
      "$peerId": {
        ".read": true,
        ".write": true,
        ".validate": "newData.hasChild('username')",
        "username": { ".validate": "newData.isString() && newData.val().length <= 30" },
        "lastSeen": { ".validate": "newData.isNumber()" }
      }
    },
    "presence": {
      "$urlKey": {
        ".read": true,
        ".write": true,
        "$peerId": {
          ".validate": "newData.hasChild('lastSeen')",
          "lastSeen": { ".validate": "newData.isNumber()" },
          "username": { ".validate": "!newData.exists() || (newData.isString() && newData.val().length <= 30)" }
        }
      }
    }
  }
}
```

> **Note**: For production, replace `.write: true` with authenticated writes using Firebase Auth.
