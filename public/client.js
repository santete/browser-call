// public/client.js
// Clean client: join/leave, WebRTC mesh (small groups), chat (no duplicate), stickers, typing, theme switch
import { signInWithGoogle, signOut, getCurrentUser } from './supabase.js';
const loginBtn = document.getElementById('loginBtn');
const logoutBtn = document.getElementById('logoutBtn');
const userInfo = document.getElementById('userInfo');


async function refreshAuthUI() {
const user = await getCurrentUser();
if (user) {
loginBtn.classList.add('hidden');
logoutBtn.classList.remove('hidden');
userInfo.classList.remove('hidden');


userInfo.innerHTML = `
<img src="${user.user_metadata.avatar_url}" class="avatar" />
<span>${user.user_metadata.full_name}</span>
`;
} else {
loginBtn.classList.remove('hidden');
logoutBtn.classList.add('hidden');
userInfo.classList.add('hidden');
}
}


loginBtn.onclick = async () => {
await signInWithGoogle();
};


logoutBtn.onclick = async () => {
await signOut();
refreshAuthUI();
};


// Refresh UI khi vào trang hoặc redirect from Google
refreshAuthUI();

document.addEventListener('DOMContentLoaded', () => {
  // DOM
  const joinBtn = document.getElementById('joinBtn');
  const leaveBtn = document.getElementById('leaveBtn');
  const roomInput = document.getElementById('roomId');
  const nameInput = document.getElementById('name');
  const toggleCamBtn = document.getElementById('toggleCamBtn');
  const toggleMicBtn = document.getElementById('toggleMicBtn');
  const themeSelect = document.getElementById('themeSelect');

  const localVideo = document.getElementById('localVideo');
  const videos = document.getElementById('videos');

  const chatMessages = document.getElementById('chatMessages');
  const chatInput = document.getElementById('chatInput');
  const sendChatBtn = document.getElementById('sendChatBtn');
  const stickerPalette = document.getElementById('stickerPalette');
  const typingIndicator = document.getElementById('typingIndicator');
  const themeLabel = document.getElementById('themeLabel');

  // state
  let socket = null;
  let myId = null;
  let roomId = null;
  let camOn = true;
  let micOn = true;
  let userName = null;
  let myAvatar = null;
  let localStream = null;
  const pcs = {};            // peerId -> RTCPeerConnection
  const remoteEls = {};      // peerId -> { wrapper, video }

  // stickers
  const STICKERS = [
    'https://ibb.co/7t2BfdYv',
    'https://ibb.co/nMbsWbwX',
    'https://ibb.co/1Gh3MrHX'
  ];

  // helpers
  const defaultAvatar = (name) => `https://ui-avatars.com/api/?name=${encodeURIComponent(name||'Guest')}&background=0D8ABC&color=fff&rounded=true`;
  const timeFmt = (ts) => new Date(ts||Date.now()).toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' });

  function scrollChat() {
    const last = chatMessages.lastElementChild;
    if (last) last.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }

  function renderChatMessage({ id, userName: from, avatar, message, type, timestamp }) {
    const isMe = id === myId;
    const row = document.createElement('div');
    row.className = 'msg-row' + (isMe ? ' end' : '');

    if (!isMe) {
      const av = document.createElement('img'); av.className = 'msg-avatar'; av.src = avatar || defaultAvatar(from); row.appendChild(av);
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

  const typingMap = new Map();
  function showTyping(id, name) {
    if (typingMap.has(id)) return;
    const el = document.createElement('div'); el.id = `typing-${id}`; el.className = 'typing'; el.textContent = `${name} đang nhập...`;
    chatMessages.appendChild(el); typingMap.set(id, el); scrollChat();
  }
  function hideTyping(id) { const el = typingMap.get(id); if (el) { el.remove(); typingMap.delete(id); } }

  function renderStickers() {
    if (!stickerPalette) return;
    stickerPalette.innerHTML = '';
    STICKERS.forEach(u => {
      const img = document.createElement('img'); img.src = u; img.className = 'sticker'; img.title = 'Send sticker';
      img.addEventListener('click', () => {
        // local render then send to server (server relays to others)
        renderChatMessage({ id: myId, userName, avatar: myAvatar, message: u, type: 'sticker', timestamp: Date.now() });
        socket.emit('chat-message', { roomId, userName, avatar: myAvatar, message: u, type: 'sticker' });
      });
      stickerPalette.appendChild(img);
    });
  }

  // Socket + signaling handlers
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
      console.log('user joined', id);
      // no immediate action here: joining peer will create offers to existing peers
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

    // chat: server forwards to others only
    socket.on('chat-message', (data) => {
      renderChatMessage({ id: data.id, userName: data.userName, avatar: data.avatar, message: data.message, type: data.type, timestamp: data.timestamp });
    });

    socket.on('typing', ({ id, userName: tname, isTyping }) => {
      if (isTyping) showTyping(id, tname); else hideTyping(id);
    });

    socket.emit('join', { roomId, userName, avatar: myAvatar });
  }

  // WebRTC helpers
  function createRemoteElement(peerId) {
    const wrapper = document.createElement('div'); wrapper.className = 'video-card'; wrapper.id = 'peer-'+peerId;
    const label = document.createElement('p'); label.style.margin='0 0 8px 0'; label.textContent = 'Peer: ' + peerId;
    const v = document.createElement('video'); v.autoplay = true; v.playsInline = true; v.style.width='320px'; v.style.height='180px'; v.style.borderRadius='8px';
    wrapper.appendChild(label); wrapper.appendChild(v);
    videos.appendChild(wrapper);
    remoteEls[peerId] = { wrapper, video: v };
    return v;
  }

  async function createPeerConnection(peerId, isInitiator) {
    if (pcs[peerId]) return pcs[peerId];
    const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
    pcs[peerId] = pc;

    if (localStream) localStream.getTracks().forEach(t => pc.addTrack(t, localStream));

    pc.ontrack = (e) => {
      const v = (remoteEls[peerId]?.video) || createRemoteElement(peerId);
      v.srcObject = e.streams[0];
    };

    pc.onicecandidate = (e) => { if (e.candidate) socket.emit('ice-candidate', { to: peerId, candidate: e.candidate }); };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
        if (remoteEls[peerId]) { remoteEls[peerId].wrapper.remove(); delete remoteEls[peerId]; }
        try { pc.close(); } catch (e) {}
        delete pcs[peerId];
      }
    };

    if (isInitiator) {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      socket.emit('offer', { to: peerId, sdp: offer });
    }

    return pc;
  }

  async function startLocalMedia() {
    if (localStream) return localStream;
    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    localVideo.srcObject = localStream;
    return localStream;
  }

  // Chat send (render locally then send to server to relay to others)
  function sendChatText() {
    const txt = chatInput.value.trim();
    if (!txt || !socket) return;
    renderChatMessage({ id: myId, userName, avatar: myAvatar, message: txt, type: 'text', timestamp: Date.now() });
    socket.emit('chat-message', { roomId, userName, avatar: myAvatar, message: txt, type: 'text' });
    chatInput.value = '';
    sendTyping(false);
  }

  // typing
  let typingTimer = null;
  let amTyping = false;
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
      document.body.className = v;
      if (themeLabel) themeLabel.textContent = v === 'romantic' ? 'Romantic' : 'Basic';
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

  toggleCamBtn.addEventListener('click', () => {
    //alert("hello");
    if (!localStream) return;

    camOn = !camOn;

    localStream.getVideoTracks().forEach(t => t.enabled = camOn);

    if (camOn) {
      toggleCamBtn.textContent = "Camera Off";
      localVideo.style.filter = "none";
    } else {
      toggleCamBtn.textContent = "Camera On";
      localVideo.style.filter = "brightness(0)";  // đen màn
    }
  });

  toggleMicBtn.addEventListener('click', () => {
    if (!localStream) return;

    micOn = !micOn;

    localStream.getAudioTracks().forEach(t => t.enabled = micOn);

    toggleMicBtn.textContent = micOn ? "Mic Off" : "Mic On";
  });

  function renderStickers() {
    if (!stickerPalette) return;
    stickerPalette.innerHTML = '';
    STICKERS.forEach(u => {
      const img = document.createElement('img'); img.src = u; img.className = 'sticker'; img.title = 'Send sticker';
      img.addEventListener('click', () => {
        // local render + emit
        renderChatMessage({ id: myId, userName, avatar: myAvatar, message: u, type: 'sticker', timestamp: Date.now() });
        socket.emit('chat-message', { roomId, userName, avatar: myAvatar, message: u, type: 'sticker' });
      });
      stickerPalette.appendChild(img);
    });
  }
});
