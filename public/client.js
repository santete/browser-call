// Client-side signaling + PeerConnection management (mesh)
const socket = io();
let localStream = null;
const pcs = {}; // peerId -> RTCPeerConnection
const remoteContainers = {}; // peerId -> DOM container
let roomId = null;
let myId = null;
let audioMuted = false;

const videosEl = document.getElementById('videos');
const localVideo = document.getElementById('localVideo');
const joinBtn = document.getElementById('joinBtn');
const leaveBtn = document.getElementById('leaveBtn');
const screenshareBtn = document.getElementById('screenshareBtn');
const muteBtn = document.getElementById('muteBtn');

joinBtn.onclick = async () => {
  roomId = document.getElementById('roomId').value.trim();
  const name = document.getElementById('name').value.trim();
  if (!roomId) return alert('enter room id');

  await startLocal();
  socket.emit('join', { roomId, userName: name });
  joinBtn.disabled = true;
  leaveBtn.disabled = false;
  screenshareBtn.disabled = false;
  muteBtn.disabled = false;
};

leaveBtn.onclick = () => {
  socket.emit('leave');
  cleanupAll();
  joinBtn.disabled = false;
  leaveBtn.disabled = true;
};

screenshareBtn.onclick = async () => {
  try {
    const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
    // Replace local video track for all peer connections (simple approach)
    const screenTrack = screenStream.getVideoTracks()[0];
    for (const id in pcs) {
      const sender = pcs[id].getSenders().find(s => s.track && s.track.kind === 'video');
      if (sender) sender.replaceTrack(screenTrack);
    }

    // When screen sharing stops, restore camera
    screenTrack.onended = async () => {
      const camTrack = localStream.getVideoTracks()[0];
      for (const id in pcs) {
        const sender = pcs[id].getSenders().find(s => s.track && s.track.kind === 'video');
        if (sender) sender.replaceTrack(camTrack);
      }
    };
  } catch (e) {
    console.warn('screen share canceled', e);
  }
};

muteBtn.onclick = () => {
  audioMuted = !audioMuted;
  localStream.getAudioTracks().forEach(t => t.enabled = !audioMuted);
  muteBtn.textContent = audioMuted ? 'Unmute' : 'Mute';
};

async function startLocal() {
  if (!localStream) {
    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    localVideo.srcObject = localStream;
  }
}

function createRemoteContainer(peerId) {
  const wrapper = document.createElement('div');
  wrapper.id = 'remote-' + peerId;
  const p = document.createElement('p');
  p.innerText = 'Remote: ' + peerId;
  const v = document.createElement('video');
  v.autoplay = true;
  v.playsInline = true;
  wrapper.appendChild(p);
  wrapper.appendChild(v);
  videosEl.appendChild(wrapper);
  remoteContainers[peerId] = { wrapper, video: v };
  return v;
}

function removeRemoteContainer(peerId) {
  const c = remoteContainers[peerId];
  if (c) {
    c.wrapper.remove();
    delete remoteContainers[peerId];
  }
}

function createPeerConnection(peerId, isInitiator) {
  const pc = new RTCPeerConnection({
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' }
    ]
  });

  // Add local tracks
  localStream.getTracks().forEach(track => pc.addTrack(track, localStream));

  // When remote track arrives
  pc.ontrack = (evt) => {
    const remoteVideo = remoteContainers[peerId]?.video || createRemoteContainer(peerId);
    // Some browsers deliver multiple tracks in separate ontrack calls — use streams[0]
    remoteVideo.srcObject = evt.streams[0];
  };

  pc.onicecandidate = (evt) => {
    if (evt.candidate) {
      socket.emit('ice-candidate', { to: peerId, candidate: evt.candidate });
    }
  };

  pc.onconnectionstatechange = () => {
    if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
      removeRemoteContainer(peerId);
      pc.close();
      delete pcs[peerId];
    }
  };

  pcs[peerId] = pc;
  return pc;
}

// Signaling handlers
socket.on('joined', async ({ you, peers }) => {
  myId = you;
  console.log('joined as', myId, 'peers:', peers);
  // Create an offer to each existing peer (mesh)
  for (const peerId of peers) {
    // create pc + offer
    const pc = createPeerConnection(peerId, true);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socket.emit('offer', { to: peerId, sdp: offer });
  }
});

socket.on('user-joined', async ({ id, userName }) => {
  console.log('user joined', id);
  // New peer joined — if we already exist in room, create a pc and be initiator
  // The joining peer will receive 'joined' event with existing peers earlier; here we act as responder
});

socket.on('offer', async ({ from, sdp }) => {
  console.log('offer from', from);
  // Create pc if doesn't exist
  if (!pcs[from]) createPeerConnection(from, false);
  const pc = pcs[from];
  await pc.setRemoteDescription(new RTCSessionDescription(sdp));
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  socket.emit('answer', { to: from, sdp: answer });
});

socket.on('answer', async ({ from, sdp }) => {
  console.log('answer from', from);
  const pc = pcs[from];
  if (!pc) return console.warn('no pc for', from);
  await pc.setRemoteDescription(new RTCSessionDescription(sdp));
});

socket.on('ice-candidate', async ({ from, candidate }) => {
  const pc = pcs[from];
  if (!pc) return;
  try {
    await pc.addIceCandidate(new RTCIceCandidate(candidate));
  } catch (e) {
    console.warn('failed addIceCandidate', e);
  }
});

socket.on('user-left', ({ id }) => {
  console.log('user-left', id);
  if (pcs[id]) {
    try { pcs[id].close(); } catch(e){}
    delete pcs[id];
  }
  removeRemoteContainer(id);
});

function cleanupAll() {
  for (const id in pcs) try { pcs[id].close(); } catch(e) {}
  Object.keys(pcs).forEach(k => delete pcs[k]);
  Object.keys(remoteContainers).forEach(k => removeRemoteContainer(k));
  if (localStream) {
    localStream.getTracks().forEach(t => t.stop());
    localStream = null;
    localVideo.srcObject = null;
  }
}

// handle page unload
window.addEventListener('beforeunload', () => socket.emit('leave'));