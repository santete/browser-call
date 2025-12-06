# WebRTC Mesh Demo (1:1 & group)

## What this project contains
- `server.js`: simple Express + Socket.IO signaling server
- `public/index.html`: client UI
- `public/client.js`: client logic building RTCPeerConnections (mesh topology)

## Run
1. `npm install`
2. `npm start`
3. Open `http://localhost:3000` in multiple browser windows or devices and use the same room name to connect.

## Notes
- This demo uses a **mesh** topology: every participant creates a PeerConnection to every other participant. Works well for small groups (<=4). For larger groups, use an SFU (mediasoup, Janus, Jitsi, or commercial SFUs) to reduce upstream bandwidth and CPU.
- You can add a TURN server in `RTCPeerConnection` iceServers for better NAT traversal.
- This is a minimal demo. For production, add auth, HTTPS, TURN, reconnection logic, proper UI and bandwidth controls.