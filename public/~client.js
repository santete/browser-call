// public/client.js
// Full clean client - WebRTC mesh (small group) + chat + stickers + typing + theme + cam/mic toggles

(() => {
  // DOM
  const joinBtn = document.getElementById('joinBtn');
  const leaveBtn = document.getElementById('leaveBtn');
  const roomInput = document.getElementById('roomId');
  const nameInput = document.getElementById('name');
  const themeSelect = document.getElementById('themeSelect');
  const themeLabel = document.getElementById('themeLabel');

  const localVideo = document.getElementById('localVideo');
  const videos = document.getElementById('videos');

  const chatMessages = document.getElementById('chatMessages');
  const chatInput = document.getElementById('chatInput');
  const sendChatBtn = document.getElementById('sendChatBtn');
  const stickerPalette = document.getElementById('stickerPalette');
  const typingIndicator = document.getElementById('typingIndicator');

  const toggleCamBtn = document.getElementById('toggleCamBtn');
  const toggleMicBtn = document.getElementById('toggleMicBtn');
  const screenShareBtn = document.getElementById('screenShareBtn');

  // State
  let socket = null;
  let myId = null;
  let roomId = null;
  let userName = null;
  let myAvatar = null;
  let localStream = null;
  const pcs = {};       // peerId -> RTCPeerConnection
  const remoteEls = {}; // peerId -> { wrapper, video }

  // stickers (provide assets in public/assets/stickers/)
  const STICKERS = [
    '/assets/stickers/heart.png',
    '/assets/stickers/smile.png',
    '/assets/stickers/fire.png'
  ];

  // utilities
  const defaultAvatar = (name) => `https://ui-avatars.com/api/?name=${encodeURIComponent(name||'Guest')}&background=0D8ABC&color=fff&rounded=true`;
  const timeFmt = (ts) => new Date(ts||Date.now()).toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' });

  function scrollChat() {
    const last = chatMessages.lastElementChild;
    if (last) last.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }

  // chat render
  function renderChatMessage({ id, userName: from, avatar, message, type, timestamp }) {
    const isMe = id === myId;
    const row = document.createElement('div');
    row.className = 'msg-row' + (isMe ? ' end' : '');

    if (!isMe) {
      const av = document.createElement('img'); av.className = 'msg-avatar'; av.src = avatar || defaultAvatar(from);
      row.appendChild(av);
    }

    const box = document.createElement('div'); box.style.maxWidth = '78%';
    const bubble = document.createElement('div'); bubble.className = isMe ? 'bubble me' : 'bubble other';

    if (type === 'sticker') {
      const img = document.createElement('img'); img.src = message; img.className = 'sticker'; bubble.appendChild(img);
    } else {
      bubble.textContent = message;
    }

    const timeEl = document.createElement('div'); timeEl.className = 'msg-time'; timeEl.textContent = timeFmt(timestamp);
    box.appendChild(bubble); box.appendChild(timeEl);
    row.appendChild(box);

    if (isMe) {
      const av2 = document.createElement('img'); av2.className = 'msg-avatar'; av2.src = myAvatar; row.appendChild(av2);
    }

    chatMessages.appendChild(row);
    scrollChat();
  }

  // typing indicator
  const typingMap = new Map();
  function showTyping(id, name) {
    if (typingMap.has(id)) return;
    const el = document.createElement('div'); el.id = `typing-${id}`; el.className = 'typing'; el.textContent = `${name} đang nhập...`;
    chatMessages.appendChild(el); typingMap.set(id, el); scrollChat();
  }
  function hideTyping(id) {
    const el = typingMap.get(id);
    if (el) { el.remove(); typingMap.delete(id); }
  }

  // sticker UI
  function renderStickers() {
    if (!stickerPalette) return;
    stickerPalette.innerHTML = '';
    STICKERS.forEach(u => {
      const img = document.createElement('img'); img.src = u; img.className = 'sticker'; img.title = 'Send sticker';
      img.addEventListener('click', () => {
        // render locally then send to others (server relays to others only)
        renderChatMessage({ id: myId, userName, avatar: myAvatar, message: u, type: 'sticker', timestamp: Date.now() });
        socket && socket.emit('chat-message', { roomId, userName, avatar: myAvatar, message: u, type: 'sticker' });
      });
      stickerPalette.appendChild(img);
    });
  }

  // SOCKET + signaling handlers
  function initSocket() {
    socket = io();

    socket.on('connect', () => console.log('socket connected', socket.id));

    socket.on('joined', async ({ you, peers }) => {
      myId = you;
      // create offers to existing peers (mesh)
      for (const peerId of peers) {
        await createPeerConnection(peerId, true);
      }
    });

    socket.on('user-joined', ({ id }) => {
      console.log('user-joined', id);
      // no action: joining peer will create offers to existing peers
    });

    socket.on('offer', async ({ from, sdp }) => {
      if (!pcs[from]) await createPeerConnection(from, false);
      const pc = pcs[from];
      await pc.setRemoteDescription(new RTCSessionDescription(sdp));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socket.emit('answer', { to: from, sdp: answer });
    });

    socket.on('answer', async ({ from, sdp }) => {
      const pc = pcs[from]; if (!pc) return;
      await pc.setRemoteDescription(new RTCSessionDescription(sdp));
    });

    socket.on('ice-candidate', async ({ from, candidate }) => {
      const pc = pcs[from]; if (!pc) return;
      try { await pc.addIceCandidate(new RTCIceCandidate(candidate)); } catch (e) { console.warn(e); }
    });

    socket.on('user-left', ({ id }) => {
      if (pcs[id]) { try { pcs[id].close(); } catch (e) {} delete pcs[id]; }
      if (remoteEls[id]) { remoteEls[id].wrapper.remove(); delete remoteEls[id]; }
    });

    // chat: server forwards to others only (we render local immediately)
    socket.on('chat-message', (data) => {
      renderChatMessage({ id: data.id, userName: data.userName, avatar: data.avatar, message: data.message, type: data.type, timestamp: data.timestamp });
    });

    socket.on('typing', ({ id, userName: tname, isTyping }) => {
      if (isTyping) showTyping(id, tname); else hideTyping(id);
    });

    // emit join
    socket.emit('join', { roomId, userName, avatar: myAvatar });
  }

  // WebRTC helpers - fixed, stable
  function createRemoteElement(peerId) {
    const wrapper = document.createElement('div'); wrapper.className = 'video-card'; wrapper.id = 'peer-' + peerId;
    const label = document.createElement('p'); label.style.margin='0 0 8px 0'; label.textContent = 'Peer: ' + peerId;
    const v = document.createElement('video'); v.autoplay = true; v.playsInline = true;
    v.style.width='320px'; v.style.height='180px'; v.style.borderRadius='8px';
    wrapper.appendChild(label); wrapper.appendChild(v);
    videos.appendChild(wrapper);
    return { wrapper, video: v };
  }

  async function createPeerConnection(peerId, isInitiator) {
    // create or reuse
    if (!pcs[peerId]) {
      const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
      pcs[peerId] = pc;

      // add local tracks (if available)
      if (localStream) localStream.getTracks().forEach(t => pc.addTrack(t, localStream));

      // ontrack: ensure remoteEl exists & set srcObject
      pc.ontrack = (event) => {
        console.log('[ontrack] from', peerId);
        let remote = remoteEls[peerId];
        if (!remote) {
          remote = createRemoteElement(peerId);
          remoteEls[peerId] = remote;
        }
        remote.video.srcObject = event.streams[0];
      };

      pc.onicecandidate = (e) => {
        if (e.candidate) socket.emit('ice-candidate', { to: peerId, candidate: e.candidate });
      };

      pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected' || pc.connectionState === 'closed') {
          if (remoteEls[peerId]) { remoteEls[peerId].wrapper.remove(); delete remoteEls[peerId]; }
          try { pc.close(); } catch (e) {}
          delete pcs[peerId];
        }
      };
    }

    const pc = pcs[peerId];

    if (isInitiator) {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      socket.emit('offer', { to: peerId, sdp: offer });
    }

    return pc;
  }

  // local media
  async function startLocalMedia() {
    if (localStream) return localStream;
    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    if (localVideo) localVideo.srcObject = localStream;
    return localStream;
  }

  // Camera / Mic toggles
  let camOn = true, micOn = true;

  if (toggleCamBtn) {
    toggleCamBtn.addEventListener('click', () => {
      if (!localStream) return;
      camOn = !camOn;
      localStream.getVideoTracks().forEach(t => t.enabled = camOn);
      toggleCamBtn.textContent = camOn ? 'Camera Off' : 'Camera On';
      localVideo.style.filter = camOn ? 'none' : 'brightness(0)';
    });
  }

  if (toggleMicBtn) {
    toggleMicBtn.addEventListener('click', () => {
      if (!localStream) return;
      micOn = !micOn;
      localStream.getAudioTracks().forEach(t => t.enabled = micOn);
      toggleMicBtn.textContent = micOn ? 'Mic Off' : 'Mic On';
    });
  }

  // screen share
  if (screenShareBtn) {
    screenShareBtn.addEventListener('click', async () => {
      if (!localStream) return;
      try {
        const screen = await navigator.mediaDevices.getDisplayMedia({ video: true });
        const screenTrack = screen.getVideoTracks()[0];
        Object.values(pcs).forEach(pc => {
          const sender = pc.getSenders().find(s => s.track && s.track.kind === 'video');
          if (sender) sender.replaceTrack(screenTrack);
        });
        screenTrack.onended = () => {
          const cam = localStream.getVideoTracks()[0];
          Object.values(pcs).forEach(pc => {
            const sender = pc.getSenders().find(s => s.track && s.track.kind === 'video');
            if (sender) sender.replaceTrack(cam);
          });
        };
      } catch (e) {
        console.warn('screen share cancelled', e);
      }
    });
  }

  // Chat send + typing
  function sendChatText() {
    const txt = chatInput.value.trim();
    if (!txt || !socket) return;
    // render locally
    renderChatMessage({ id: myId, userName, avatar: myAvatar, message: txt, type: 'text', timestamp: Date.now() });
    // send to others (server forwards to others only)
    socket.emit('chat-message', { roomId, userName, avatar: myAvatar, message: txt, type: 'text' });
    chatInput.value = '';
    sendTyping(false);
  }

  let typingTimer = null, amTyping = false;
  function sendTyping(flag) {
    if (!socket) return;
    if (flag) {
      if (!amTyping) { amTyping = true; socket.emit('typing', { roomId, userName, isTyping: true }); }
      clearTimeout(typingTimer);
      typingTimer = setTimeout(() => { amTyping = false; socket.emit('typing', { roomId, userName, isTyping: false }); }, 1000);
    } else {
      amTyping = false; socket.emit('typing', { roomId, userName, isTyping: false }); clearTimeout(typingTimer);
    }
  }

  // UI wiring
  if (themeSelect) {
    themeSelect.addEventListener('change', () => {
      const v = themeSelect.value;
      document.body.className = v === 'love' ? 'love' : 'work';
      if (themeLabel) themeLabel.textContent = v === 'love' ? 'Love' : 'Work';
    });
  }

  if (sendChatBtn) sendChatBtn.addEventListener('click', sendChatText);
  if (chatInput) chatInput.addEventListener('keydown', (e) => {
    sendTyping(true);
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChatText(); }
  });

  if (joinBtn) {
    joinBtn.addEventListener('click', async () => {
      roomId = roomInput.value || 'room1';
      userName = nameInput.value || 'Guest';
      myAvatar = defaultAvatar(userName);

      await startLocalMedia();
      renderStickers();
      initSocket();

      joinBtn.disabled = true; leaveBtn.disabled = false;
    });
  }

  if (leaveBtn) {
    leaveBtn.addEventListener('click', () => {
      if (socket) socket.emit('leave');
      Object.values(pcs).forEach(pc => { try { pc.close(); } catch (e) {} });
      Object.keys(pcs).forEach(k => delete pcs[k]);
      Object.values(remoteEls).forEach(r => r.wrapper.remove());
      Object.keys(remoteEls).forEach(k => delete remoteEls[k]);
      if (localStream) { localStream.getTracks().forEach(t => t.stop()); localStream = null; if (localVideo) localVideo.srcObject = null; }
      chatMessages.innerHTML = '';
      joinBtn.disabled = false; leaveBtn.disabled = true;
    });
  }

  function renderStickers() {
    if (!stickerPalette) return;
    stickerPalette.innerHTML = '';
    STICKERS.forEach(u => {
      const img = document.createElement('img'); img.src = u; img.className = 'sticker'; img.title = 'Send sticker';
      img.addEventListener('click', () => {
        renderChatMessage({ id: myId, userName, avatar: myAvatar, message: u, type: 'sticker', timestamp: Date.now() });
        socket && socket.emit('chat-message', { roomId, userName, avatar: myAvatar, message: u, type: 'sticker' });
      });
      stickerPalette.appendChild(img);
    });
  }

})();
