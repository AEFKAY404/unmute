# Unmute Overlay Extension

This folder contains the Chrome extension version of Unmute.

## Load it in Chrome

1. Open `chrome://extensions`
2. Enable `Developer mode`
3. Click `Load unpacked`
4. Select this folder: `c:\Users\akash\Desktop\unmute-extension`

## Configure it

1. Click the extension icon
2. Set `Backend URL` to your running server, for example `http://localhost:3000`
3. Optionally set a display name
4. Leave `Enable on YouTube` checked

## How it works

- On YouTube watch/live pages, the content script detects the video ID
- It injects an overlay chat panel onto the page
- It connects to your existing backend with Socket.IO
- It auto-joins the room for that same YouTube video ID

## Backend note

Your server now allows Socket.IO connections from `chrome-extension://` origins and localhost by default.
If you deploy the backend publicly and want to whitelist additional website origins, set:

`ALLOWED_CLIENT_ORIGINS=https://your-site.com,https://another-site.com`
