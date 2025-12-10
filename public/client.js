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

  const currentRoomNameEl = document.getElementById('currentRoomName');
  const stickerBtn = document.getElementById('stickerBtn');
  const stickerPopup = document.getElementById('stickerPalette');
  const attachBtn = document.getElementById('attachBtn');
  const fileInput = document.getElementById('fileInput');

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

  // --- LOGIC HIỂN THỊ DANH SÁCH PHÒNG (YAHOO STYLE) ---
  
  // 1. Dữ liệu giả lập (Sau này sẽ lấy từ API)
  const REGIONS = [
    {
      name: "Hà Nội",
      rooms: [
        { id: "hn_1", name: "Hà Nội Phố", count: 12 },
        { id: "hn_2", name: "Trà Chanh Chém Gió", count: 5 },
        { id: "hn_3", name: "Hồ Gươm Sáng Sớm", count: 8 },
        { id: "hn_4", name: "Hoàng Hôn Hồ Tây", count: 2 },
        { id: "hn_5", name: "Cầu Giấy", count: 22 },
        { id: "hn_6", name: "SVĐ Mỹ Đình", count: 1002 }
      ]
    },
    {
      name: "TP. Hồ Chí Minh",
      rooms: [
        { id: "sg_1", name: "Sài Gòn Cafe Sữa Đá", count: 20 },
        { id: "sg_2", name: "Phố Đi Bộ Nguyễn Huệ", count: 15 },
        { id: "sg_3", name: "Night Life District 1", count: 3 },
        { id: "sg_4", name: "Phố Tây Bùi Viện", count: 39 },
        { id: "sg_5", name: "Hồ Con Rùa", count: 50 },
        { id: "sg_6", name: "Nhà Văn Hóa Thanh Niên", count: 100 },
        { id: "sg_7", name: "Cầu Thủ Thêm", count: 12 },
        { id: "sg_8", name: "Bến Bạch Đằng", count: 500 }
      ]
    },
    {
      name: "Góc Tâm Sự",
      rooms: [
        { id: "ts_1", name: "Tuổi Teen", count: 45 },
        { id: "ts_2", name: "Thất Tình Quán", count: 2 },
        { id: "ts_3", name: "Tìm Bạn Bốn Phương", count: 102 }
      ]
    },
     {
      name: "Miền Trung",
      rooms: [
        { id: "dn_1", name: "Đà Nẵng City", count: 9 },
        { id: "hue_1", name: "Huế Mộng Mơ", count: 4 }
      ]
    }
  ];

  const roomListContainer = document.getElementById('roomListContainer');
  const currentRoomId = roomInput.value; // Lấy phòng hiện tại

  // --- LOGIC RENDER PHÒNG CHAT (CÓ COLLAPSE + ICON MỚI) ---
  
  // --- CẬP NHẬT HÀM RENDER ROOM LIST ---
  
  function renderRoomList() {
    roomListContainer.innerHTML = '';

    // Icon mũi tên
    const arrowSvg = `<svg class="arrow-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>`;
    
    // Icon Cộng đồng
    const communitySvg = `<svg class="community-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>`;

    // Icon người nhỏ xíu (cho phần user count)
    const userCountSvg = `<svg class="count-icon-svg" viewBox="0 0 24 24"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg>`;

    REGIONS.forEach((region, index) => {
      const groupDiv = document.createElement('div');
      groupDiv.className = 'region-group';
      if (index === 0) groupDiv.classList.add('expanded');

      // Header
      const titleDiv = document.createElement('div');
      titleDiv.className = 'region-title';
      titleDiv.innerHTML = `${arrowSvg} ${communitySvg} <span>${region.name}</span>`;
      titleDiv.addEventListener('click', () => groupDiv.classList.toggle('expanded'));
      groupDiv.appendChild(titleDiv);

      // List Rooms
      const roomsDiv = document.createElement('div');
      roomsDiv.className = 'region-rooms';

      region.rooms.forEach(room => {
        const roomDiv = document.createElement('div');
        roomDiv.className = 'room-item';
        if (room.id === currentRoomId) roomDiv.classList.add('active');

        // 1. Tên phòng (Bọc trong span riêng để CSS căn trái)
        const nameSpan = document.createElement('span');
        nameSpan.className = 'room-name-text'; // Class mới để xử lý text
        nameSpan.textContent = room.name;
        
        // 2. Số lượng người + Icon người
        const countSpan = document.createElement('span');
        countSpan.className = 'user-count';
        // Chèn số trước, icon sau
        countSpan.innerHTML = `${room.count} ${userCountSvg}`;

        roomDiv.appendChild(nameSpan);
        roomDiv.appendChild(countSpan);

        roomDiv.addEventListener('click', (e) => {
            e.stopPropagation();
            if (room.id !== currentRoomId) {
                 if (confirm(`Chuyển sang phòng: ${room.name}?`)) {
                    window.location.href = `?room=${room.id}&name=${nameInput.value}`;
                 }
            }
        });

        roomsDiv.appendChild(roomDiv);
      });

      groupDiv.appendChild(roomsDiv);
      roomListContainer.appendChild(groupDiv);
    });
  }

  // Chạy ngay khi load trang
  renderRoomList();

  // 1. Cập nhật tên phòng trên Header khi vào
  // (Bạn nhớ gọi dòng này khi joinRoom hoặc renderRoomList)
  // Ví dụ: currentRoomNameEl.textContent = "# " + "Tên phòng từ biến roomName";

  // 2. Xử lý nút Sticker (Bật/Tắt Popup)
  stickerBtn.addEventListener('click', (e) => {
    e.stopPropagation(); // Ngăn click lan ra ngoài
    stickerPopup.classList.toggle('hidden');
  });

  // Click ra ngoài thì đóng popup
  document.addEventListener('click', (e) => {
    if (!stickerPopup.contains(e.target) && e.target !== stickerBtn) {
      stickerPopup.classList.add('hidden');
    }
  });
  
  // Khi chọn sticker xong thì cũng đóng luôn
  // (Đã có logic renderSticker cũ, chỉ cần thêm dòng đóng popup vào đó)
  
  // 3. Xử lý nút Gửi Ảnh (Attach)
  attachBtn.addEventListener('click', () => {
    fileInput.click(); // Kích hoạt input file ẩn
  });

  fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
      // Demo: Đọc file ảnh và hiện lên chat ngay lập tức (Local)
      const reader = new FileReader();
      reader.onload = function(evt) {
        const imgUrl = evt.target.result;
        
        // Gửi như tin nhắn sticker (dạng ảnh)
        // Lưu ý: Thực tế bạn cần upload lên Server lấy link, ở đây mình gửi base64 trực tiếp (chỉ test ảnh nhỏ)
        const msgData = { 
            id: myId, 
            userName, 
            avatar: myAvatar, 
            message: imgUrl, 
            type: 'sticker', // Tạm dùng type sticker để hiện ảnh
            timestamp: Date.now() 
        };
        
        // Render lên màn hình mình
        renderChatMessage(msgData);
        // Gửi qua socket
        socket.emit('chat-message', msgData);
      };
      reader.readAsDataURL(file);
    }
    // Reset input để chọn lại file cũ được
    fileInput.value = '';
  });

  // stickers logic chat cũ
  const STICKERS = [
    '/assets/stickers/heart.PNG',
    '/assets/stickers/smile.PNG',
    '/assets/stickers/fire.PNG'
  ];
  renderStickers();
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
    // Kiểm tra nếu không có div palette thì thôi
    if (!stickerPalette) return;
    
    // Xóa nội dung cũ (tránh bị duplicate nếu gọi hàm nhiều lần)
    stickerPalette.innerHTML = '';
    
    STICKERS.forEach(u => {
      const img = document.createElement('img'); 
      img.src = u; 
      img.className = 'sticker'; 
      img.title = 'Send sticker';
      
      img.addEventListener('click', () => {
        // 1. Gửi sticker (Logic cũ giữ nguyên)
        renderChatMessage({ id: myId, userName, avatar: myAvatar, message: u, type: 'sticker', timestamp: Date.now() });
        socket.emit('chat-message', { roomId, userName, avatar: myAvatar, message: u, type: 'sticker' });

        // 2. [MỚI] Đóng popup ngay sau khi chọn xong cho gọn
        stickerPalette.classList.add('hidden'); 
      });
      
      stickerPalette.appendChild(img);
    });
  }

	// Ví dụ trong client.js khi render tin nhắn:
	function addMessageToUI(msg, isMyMessage) {
	  const div = document.createElement('div');
	  
	  // Thêm class chung và class phân biệt
	  div.classList.add('message-item'); 
	  if (isMyMessage) {
		div.classList.add('message-self');
	  } else {
		div.classList.add('message-other');
	  }
	  
	  div.textContent = msg.text; // Hoặc nội dung chat
	  document.getElementById('chatMessages').appendChild(div);
	  
	  // Auto scroll xuống dưới
	  document.getElementById('chatMessages').scrollTop = document.getElementById('chatMessages').scrollHeight;
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

  // --- CHỨC NĂNG NÚT REFRESH ---
  const refreshBtn = document.getElementById('refreshRoomsBtn');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => {
      // 1. Hiệu ứng xoay xoay (Add class 'spin' nếu muốn CSS animation phức tạp hơn)
      refreshBtn.style.transform = "rotate(360deg)";
      
      // 2. Gọi lại hàm render danh sách
      // Trong thực tế chỗ này sẽ là socket.emit('get-rooms')
      renderRoomList(); 

      // 3. Reset góc xoay sau khi animation xong (để lần sau bấm còn xoay tiếp)
      setTimeout(() => {
        refreshBtn.style.transform = "none";
      }, 500);
    });
  }
});
