# Nullify

Tinder-style message triage for MS Teams web app.

## What it does

Click the extension icon on [teams.cloud.microsoft](https://teams.cloud.microsoft) to open a card overlay:

1. The current page blurs behind a backdrop
2. A phone-sized card (420×780) appears centered on screen
3. Inside the card: a **real Teams instance** rendered at mobile resolution via iframe
4. Teams handles its own responsive layout — sidebar collapses, mobile-friendly UI
5. Navigate through unread chats with **← Mark Read** / **Keep →**
6. Everything works natively: reply, react, open threads, click links

## Why iframe

| Approach | Problem |
|----------|---------|
| Custom card UI | No reactions, threads, file previews, formatting |
| Restyle Teams DOM | Breaks emoji picker, popups, portals |
| Resize browser window | Disruptive, changes user's workspace |
| **Iframe at card size** | **Teams renders natively, zero DOM hacking** |

The extension strips `X-Frame-Options` and CSP headers for the Teams iframe via `declarativeNetRequest`.

## Controls

| Input | Action |
|-------|--------|
| **← / H** | Mark as read |
| **→ / L** | Keep unread |
| **Esc** | Close overlay |

## Install (dev mode)

1. Open `chrome://extensions`
2. Enable **Developer mode** (top right)
3. Click **Load unpacked** → select this folder
4. Navigate to [teams.cloud.microsoft](https://teams.cloud.microsoft)
5. Click the **Nullify** icon

To reload after code changes: hit the ↻ button on the extension card in `chrome://extensions`, then refresh the Teams tab.

## Files

```
nullify/
├── manifest.json   # Manifest V3 + declarativeNetRequest
├── rules.json      # Strip X-Frame-Options/CSP for iframe
├── background.js   # Handle icon click → toggle
├── content.js      # Backdrop + card + iframe + triage controls
├── icons/          # Extension icons
└── README.md
```
