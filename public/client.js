/* -------------------------------------------------------
   CONFIG SUPABASE
------------------------------------------------------- */
const SUPABASE_URL = "https://YOUR-PROJECT-ID.supabase.co";
const SUPABASE_KEY = "YOUR_PUBLIC_ANON_KEY";
const supabase = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

/* -------------------------------------------------------
   VARIABLES
------------------------------------------------------- */
const socket = io();

// DOM
const joinBtn = document.getElementById("joinBtn");
const leaveBtn = document.getElementById("leaveBtn");
const roomInput = document.getElementById("roomId");
const nameInput = document.getElementById("displayName");

const toggleCamBtn = document.getElementById("toggleCamBtn");
const toggleMicBtn = document.getElementById("toggleMicBtn");
const screenShareBtn = document.getElementById("screenShareBtn");

const themeSelect = document.getElementById("themeSelect");
const themeLabel = document.getElementById("themeLabel");

const localVideo = document.getElementById("localVideo");
const remoteContainer = document.getElementById("videos");

const chatInput = document.getElementById("chatInput");
const sendChatBtn = document.getElementById("sendChatBtn");
const chatMessages = document.getElementById("chatMessages");
const typingIndicator = document.getElementById("typingIndicator");
const stickerPalette = document.getElementById("stickerPalette");

const googleLoginBtn = document.getElementById("googleLoginBtn");

// RTC
let localStream;
let screenStream;

const pcs = {};
const remoteEls = {};

let roomId = null;
let myName = null;

// Avatar generator simple
const avatarUrl = name =>
  `https://ui-avatars.com/api/?background=random&color=fff&name=${encodeURIComponent(name)}`;

/* -------------------------------------------------------
   GOOGLE LOGIN
------------------------------------------------------- */
googleLoginBtn.onclick = async () => {
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google"
  });

  if (error) {
    alert("Login failed");
    return;
  }
};

// When supabase returns session after redirect
supabase.auth.onAuthStateChange((_event, session) => {
  if (session?.user) {
    myName = session.user.user_metadata.full_name;
    nameInput.value = myName;
    googleLoginBtn.textContent = "Logged in";
    googleLoginBtn.disabled = true;
  }
});

/* -------------------------------------------------------
   ROOM JOIN/LEAVE
------------------------------------------------------- */
joinBtn.onclick = async () => {
  roomId = roomInput.value.trim();
  myName = nameInput.value.trim();

  if (!roomId || !myName) {
    alert("Room & Name required");
    return;
  }

  await startLocalVideo();

  socket.emit("join", { roomId, name: myName });

  joinBtn.disabled = true;
  leaveBtn.disabled = false;
};

leaveBtn.onclick = () => {
  socket.emit("leaveRoom");
  cleanupRTC();
  joinBtn.disabled = false;
  leaveBtn.disabled = true;
};

/* -------------------------------------------------------
   LOCAL VIDEO INIT
------------------------------------------------------- */
async function startLocalVideo() {
  localStream = await navigator.mediaDevices.getUserMedia({
    video: true,
    audio: true
  });

  localVideo.srcObject = localStream;
}

/* -------------------------------------------------------
   CREATE PEER CONNECTION
------------------------------------------------------- */
async function createPeerConnection(peerId, isInitiator) {
  if (pcs[peerId]) return pcs[peerId];

  log("Creating RTCPeerConnection for", peerId);

  const pc = new RTCPeerConnection({
    iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
  });
  pcs[peerId] = pc;

  // Add local tracks
  localStream.getTracks().forEach(t => pc.addTrack(t, localStream));

  // ontrack = remote video received
  pc.ontrack = e => {
    log("Received remote track from", peerId);
    const v = getOrCreateRemoteVideo(peerId);
    v.srcObject = e.streams[0];
  };

  // ICE
  pc.onicecandidate = e => {
    if (e.candidate) {
      socket.emit("ice-candidate", {
        to: peerId,
        candidate: e.candidate
      });
    }
  };

  pc.onconnectionstatechange = () => {
    if (pc.connectionState === "failed" ||
        pc.connectionState === "disconnected" ||
        pc.connectionState === "closed") {

      log(`PC ${peerId} closed`);
      removeRemoteElement(peerId);
      try { pc.close(); } catch {}
      delete pcs[peerId];
    }
  };

  // If initiator → send offer
  if (isInitiator) {
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    socket.emit("offer", { to: peerId, sdp: offer });
  }

  return pc;
}

/* -------------------------------------------------------
   SOCKET EVENTS (SIGNALING)
------------------------------------------------------- */
socket.on("users", users => {
  log("Users in room:", users);

  users.forEach(uid => {
    if (uid !== socket.id) {
      createPeerConnection(uid, true);
    }
  });
});

socket.on("user-joined", async ({ id }) => {
  log("User joined:", id);
  await createPeerConnection(id, true);
});

socket.on("offer", async ({ from, sdp }) => {
  log("Received offer from", from);

  const pc = await createPeerConnection(from, false);
  await pc.setRemoteDescription(new RTCSessionDescription(sdp));

  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);

  socket.emit("answer", { to: from, sdp: answer });
});

socket.on("answer", async ({ from, sdp }) => {
  log("Received answer from", from);
  const pc = pcs[from];
  if (pc) await pc.setRemoteDescription(new RTCSessionDescription(sdp));
});

socket.on("ice-candidate", async ({ from, candidate }) => {
  log("ICE candidate from", from);
  const pc = pcs[from];
  if (pc) await pc.addIceCandidate(candidate);
});

/* -------------------------------------------------------
   VIDEO HELPER FUNCTIONS
------------------------------------------------------- */
function getOrCreateRemoteVideo(peerId) {
  if (remoteEls[peerId]) return remoteEls[peerId].video;

  const wrapper = document.createElement("div");
  wrapper.className = "remote-item";

  const v = document.createElement("video");
  v.autoplay = true;
  v.playsInline = true;

  wrapper.appendChild(v);
  remoteContainer.appendChild(wrapper);

  remoteEls[peerId] = { wrapper, video: v };
  return v;
}

function removeRemoteElement(peerId) {
  if (remoteEls[peerId]) {
    remoteEls[peerId].wrapper.remove();
    delete remoteEls[peerId];
  }
}

function cleanupRTC() {
  Object.keys(pcs).forEach(id => {
    try { pcs[id].close(); } catch {}
  });
  Object.keys(remoteEls).forEach(removeRemoteElement);
}

/* -------------------------------------------------------
   CAMERA / MIC TOGGLE
------------------------------------------------------- */
toggleCamBtn.onclick = () => {
  const track = localStream.getVideoTracks()[0];
  track.enabled = !track.enabled;
  toggleCamBtn.textContent = track.enabled ? "Camera Off" : "Camera On";
};

toggleMicBtn.onclick = () => {
  const track = localStream.getAudioTracks()[0];
  track.enabled = !track.enabled;
  toggleMicBtn.textContent = track.enabled ? "Mic Off" : "Mic On";
};

/* -------------------------------------------------------
   SCREEN SHARE
------------------------------------------------------- */
screenShareBtn.onclick = async () => {
  if (!screenStream) {
    screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });

    const screenTrack = screenStream.getVideoTracks()[0];
    screenTrack.onended = stopScreenShare;

    Object.values(pcs).forEach(pc => {
      const sender = pc.getSenders().find(s => s.track.kind === "video");
      sender.replaceTrack(screenTrack);
    });

    localVideo.srcObject = screenStream;
    screenShareBtn.textContent = "Stop Share";
  } else {
    stopScreenShare();
  }
};

function stopScreenShare() {
  screenStream.getTracks().forEach(t => t.stop());
  screenStream = null;

  const camTrack = localStream.getVideoTracks()[0];
  Object.values(pcs).forEach(pc => {
    const sender = pc.getSenders().find(s => s.track.kind === "video");
    sender.replaceTrack(camTrack);
  });

  localVideo.srcObject = localStream;
  screenShareBtn.textContent = "Share Screen";
}

/* -------------------------------------------------------
   CHAT SYSTEM
------------------------------------------------------- */
sendChatBtn.onclick = sendChat;
chatInput.onkeydown = e => {
  if (e.key === "Enter") sendChat();
  socket.emit("typing", { roomId, name: myName });
};

function sendChat() {
  const msg = chatInput.value.trim();
  if (!msg) return;

  const packet = {
    from: myName,
    avatar: avatarUrl(myName),
    text: msg,
    timestamp: Date.now()
  };

  appendMessage(packet, true);
  socket.emit("chat", { roomId, msg: packet });

  chatInput.value = "";
}

socket.on("chat", packet => appendMessage(packet, false));

function appendMessage(data, isMe) {
  const row = document.createElement("div");
  row.className = `msg-row ${isMe ? "me" : "them"}`;

  row.innerHTML = `
    <img class="avatar" src="${data.avatar}">
    <div>
      <div class="bubble">
        ${data.text.startsWith("STICKER:") ?
          `<img src="${data.text.replace("STICKER:", "")}">` :
          data.text
        }
      </div>
      <div class="timestamp">${new Date(data.timestamp).toLocaleTimeString()}</div>
    </div>
  `;

  chatMessages.appendChild(row);
  row.scrollIntoView({ behavior: "smooth" });
}

/* -------------------------------------------------------
   TYPING INDICATOR
------------------------------------------------------- */
socket.on("typing", ({ name }) => {
  typingIndicator.textContent = `${name} đang nhập…`;
  typingIndicator.style.display = "block";

  clearTimeout(window._typingTimeout);
  window._typingTimeout = setTimeout(() => {
    typingIndicator.style.display = "none";
  }, 1200);
});

/* -------------------------------------------------------
   STICKER SYSTEM
------------------------------------------------------- */
const stickerUrls = [
  "https://i.ibb.co/1Gh3MrHX/sticker1.png",
  "https://i.ibb.co/7t2BfdYv/sticker2.png",
  "https://i.ibb.co/nMbsWbwX/sticker3.png"
];

function initStickers() {
  stickerUrls.forEach(url => {
    const img = document.createElement("img");
    img.src = url;
    img.className = "sticker";
    img.onclick = () => sendSticker(url);
    stickerPalette.appendChild(img);
  });
}

function sendSticker(url) {
  const packet = {
    from: myName,
    avatar: avatarUrl(myName),
    text: "STICKER:" + url,
    timestamp: Date.now()
  };

  appendMessage(packet, true);
  socket.emit("chat", { roomId, msg: packet });
}

initStickers();

/* -------------------------------------------------------
   THEME
------------------------------------------------------- */
themeSelect.onchange = () => {
  document.body.className = themeSelect.value;
  themeLabel.textContent = themeSelect.value === "work" ? "Work" : "Love";
};

/* -------------------------------------------------------
   DEBUG LOG
------------------------------------------------------- */
function log(...args) {
  console.log("[DEBUG]", ...args);
}
