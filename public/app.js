// STREAMTALK V9.0 APPLICATION LOGIC

let socket;
let currentRoom = '';
let currentRole = '';
let currentName = '';
let activeTargets = ['todos']; // Target list for director

// Media Recording & Audio Playback State
let audioCtx;
let mediaRecorder;
let stream;
let isPTTActive = false;
let isMuted = false;

// Global list of connected crew for routing
let crewList = [];

// DOM Elements
const landingView = document.getElementById('landing-view');
const directorView = document.getElementById('director-view');
const crewView = document.getElementById('crew-view');

const btnJoinDirector = document.getElementById('btn-join-director');
const btnJoinCrew = document.getElementById('btn-join-crew');

const directorRoomInput = document.getElementById('director-room');
const crewRoomInput = document.getElementById('crew-room');
const crewNameInput = document.getElementById('crew-name');

const dirRoomDisplay = document.getElementById('dir-room-display');
const crewRoomDisplay = document.getElementById('crew-room-display');
const crewRoleDisplay = document.getElementById('crew-role-display');

const matrixRoutingButtons = document.getElementById('matrix-routing-buttons');
const btnDirectorPTT = document.getElementById('btn-director-ptt');
const btnPartyMix = document.getElementById('btn-party-mix');

const crewCountEl = document.getElementById('crew-count');
const crewMembersListEl = document.getElementById('crew-members-list');

const earphonesStatus = document.getElementById('earphones-status');
const earphonesMsg = document.getElementById('earphones-msg');
const btnCrewPTT = document.getElementById('btn-crew-ptt');

const btnPocketMode = document.getElementById('btn-pocket-mode');
const pocketOverlay = document.getElementById('pocket-overlay');
const btnExitPocket = document.getElementById('btn-exit-pocket');

const toastContainer = document.getElementById('alert-toast-container');

// View management: toggle views
function showView(viewId) {
  [landingView, directorView, crewView].forEach(view => view.classList.remove('active'));
  if (viewId === 'landing') landingView.classList.add('active');
  if (viewId === 'director') directorView.classList.add('active');
  if (viewId === 'crew') crewView.classList.add('active');
}

// Show Toast Alert notification
function showToast(message, type = 'danger') {
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `<i class="fa-solid fa-bell"></i> <span>${message}</span>`;
  toastContainer.appendChild(toast);
  setTimeout(() => toast.remove(), 4500);

  // Fallback to simple vibration on mobile
  if ('vibrate' in navigator) {
    navigator.vibrate([200, 100, 200]);
  }
}

// Init AudioContext on first user interaction to ensure working mobile playback
function initAudio() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
}

// Convert audio blob chunk to base64
function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const base64String = reader.result.split(',')[1];
      resolve(base64String);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

// Convert base64 back to an array buffer for the AudioContext
function base64ToArrayBuffer(base64) {
  const binaryString = window.atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer;
}

// Play an incoming audio chunk via AudioContext
async function playAudioChunk(base64Chunk) {
  try {
    initAudio();
    const arrayBuf = base64ToArrayBuffer(base64Chunk);
    const audioBuf = await audioCtx.decodeAudioData(arrayBuf);
    const source = audioCtx.createBufferSource();
    source.buffer = audioBuf;
    source.connect(audioCtx.destination);
    source.start(0);
  } catch (err) {
    console.error('Playback error:', err);
  }
}

// Capture device audio via microphone and start MediaRecorder timeslicing
async function startAudioCapture(emitEventName) {
  try {
    if (!stream) {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    }

    mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
    
    mediaRecorder.ondataavailable = async (e) => {
      if (e.data && e.data.size > 0) {
        const base64Chunk = await blobToBase64(e.data);
        if (currentRole === 'director') {
          socket.emit(emitEventName, {
            room: currentRoom,
            targets: activeTargets,
            chunk: base64Chunk
          });
        } else {
          socket.emit(emitEventName, {
            room: currentRoom,
            from: currentName,
            chunk: base64Chunk
          });
        }
      }
    };

    // Slice audio into 150ms intervals for low latency
    mediaRecorder.start(150);
  } catch (err) {
    console.error('Audio capture permission denied/error:', err);
    showToast('No se pudo acceder al micrófono para el intercomunicador.', 'danger');
  }
}

// Stop audio capture
function stopAudioCapture() {
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop();
  }
}

// Setup standard event listener and PTT features for Director
function initDirectorControls() {
  // Matriz de Ruteo Dynamic Click toggles
  matrixRoutingButtons.addEventListener('click', (e) => {
    const btn = e.target.closest('.matrix-btn');
    if (!btn) return;

    const target = btn.dataset.target;

    if (target === 'todos') {
      // Toggle off other active items
      Array.from(matrixRoutingButtons.querySelectorAll('.matrix-btn')).forEach(b => {
        if (b.dataset.target !== 'todos') b.classList.remove('active');
      });
      btn.classList.add('active');
      activeTargets = ['todos'];
    } else {
      // Normal target clicked
      const todosBtn = matrixRoutingButtons.querySelector('[data-target="todos"]');
      if (todosBtn) todosBtn.classList.remove('active');

      btn.classList.toggle('active');
      
      // Compute targets from active buttons
      activeTargets = Array.from(matrixRoutingButtons.querySelectorAll('.matrix-btn.active'))
        .map(b => b.dataset.target);

      // If nothing selected, default back to 'todos'
      if (activeTargets.length === 0) {
        todosBtn.classList.add('active');
        activeTargets = ['todos'];
      }
    }

    // Broadcast active routing targets to Crew
    socket.emit('director-routing', { room: currentRoom, activeTargets });
  });

  // Director PTT events
  const startDirectorPTT = (e) => {
    e.preventDefault();
    if (isPTTActive) return;
    isPTTActive = true;
    
    btnDirectorPTT.classList.add('talking');
    btnDirectorPTT.querySelector('.ptt-status').textContent = 'HABLANDO';
    
    initAudio();
    startAudioCapture('director-audio-stream');
  };

  const stopDirectorPTT = (e) => {
    e.preventDefault();
    if (!isPTTActive) return;
    isPTTActive = false;
    
    btnDirectorPTT.classList.remove('talking');
    btnDirectorPTT.querySelector('.ptt-status').textContent = 'SILENCIO';
    
    stopAudioCapture();
  };

  btnDirectorPTT.addEventListener('mousedown', startDirectorPTT);
  btnDirectorPTT.addEventListener('mouseup', stopDirectorPTT);
  btnDirectorPTT.addEventListener('touchstart', startDirectorPTT, { passive: false });
  btnDirectorPTT.addEventListener('touchend', stopDirectorPTT, { passive: false });

  // Party Mix Toggle
  btnPartyMix.addEventListener('click', () => {
    btnPartyMix.classList.toggle('active');
    if (btnPartyMix.classList.contains('active')) {
      btnPartyMix.innerHTML = `<i class="fa-solid fa-music"></i> PARTY MIX ON`;
      btnPartyMix.style.backgroundColor = '#10b981';
      btnPartyMix.style.color = '#fff';
    } else {
      btnPartyMix.innerHTML = `<i class="fa-solid fa-music"></i> PARTY MIX OFF`;
      btnPartyMix.style.backgroundColor = 'transparent';
      btnPartyMix.style.color = 'var(--primary-color)';
    }
  });

  // Copy Link button
  document.getElementById('btn-copy-link').addEventListener('click', () => {
    const link = `${window.location.origin}/?room=${currentRoom}`;
    navigator.clipboard.writeText(link).then(() => {
      showToast('¡Link copiado al portapapeles!', 'success');
    }).catch(err => {
      console.error('Failed to copy link:', err);
    });
  });

  document.getElementById('btn-leave-director').addEventListener('click', () => {
    socket.disconnect();
    showView('landing');
  });
}

// Setup Crew Event listener and controls
function initCrewControls() {
  // Push To Talk
  const startCrewPTT = (e) => {
    e.preventDefault();
    if (isPTTActive) return;
    isPTTActive = true;
    
    btnCrewPTT.classList.add('speaking');
    btnCrewPTT.querySelector('.ptt-label-primary').textContent = 'HABLANDO';
    
    initAudio();
    startAudioCapture('crew-audio-stream');
  };

  const stopCrewPTT = (e) => {
    e.preventDefault();
    if (!isPTTActive) return;
    isPTTActive = false;
    
    btnCrewPTT.classList.remove('speaking');
    btnCrewPTT.querySelector('.ptt-label-primary').textContent = 'PUSH TO TALK';
    
    stopAudioCapture();
  };

  btnCrewPTT.addEventListener('mousedown', startCrewPTT);
  btnCrewPTT.addEventListener('mouseup', stopCrewPTT);
  btnCrewPTT.addEventListener('touchstart', startCrewPTT, { passive: false });
  btnCrewPTT.addEventListener('touchend', stopCrewPTT, { passive: false });

  // Mode Pocket toggle
  btnPocketMode.addEventListener('click', () => {
    pocketOverlay.classList.add('active');
  });

  btnExitPocket.addEventListener('click', () => {
    pocketOverlay.classList.remove('active');
  });

  // Alert To Director button
  document.getElementById('btn-crew-alert').addEventListener('click', () => {
    socket.emit('crew-alert', { room: currentRoom, from: currentName, message: '¡EMERGENCIA/AVISO!' });
    showToast('¡Alerta enviada al Director!', 'success');
  });

  document.getElementById('btn-leave-crew').addEventListener('click', () => {
    socket.disconnect();
    showView('landing');
  });
}

// Build sockets and connection listeners
function connectToSocket(room, role, name) {
  // Connect via relative path or current hostname
  socket = io();

  socket.on('connect', () => {
    console.log('Realtime socket connection established.');

    // Fetch local battery level if API exists, or fallback to random/fake battery level
    let currentBattery = 100;
    if ('getBattery' in navigator) {
      navigator.getBattery().then((battery) => {
        currentBattery = Math.round(battery.level * 100);
        socket.emit('join-room', { room, role, name, battery: currentBattery });
        
        battery.addEventListener('levelchange', () => {
          socket.emit('battery-update', { room, name, battery: Math.round(battery.level * 100) });
        });
      }).catch(() => {
        socket.emit('join-room', { room, role, name, battery: currentBattery });
      });
    } else {
      socket.emit('join-room', { room, role, name, battery: currentBattery });
    }
  });

  // Room state listener (For Director to list connections)
  socket.on('room-state', (data) => {
    if (currentRole === 'director') {
      crewList = data.crew;
      crewCountEl.textContent = crewList.length;

      // Update connected crew elements in matrix and listing
      crewMembersListEl.innerHTML = '';
      if (crewList.length === 0) {
        crewMembersListEl.innerHTML = `<p class="empty-list-msg">No hay miembros del equipo conectados aún.</p>`;
      } else {
        crewList.forEach(crewMember => {
          const itemEl = document.createElement('div');
          itemEl.className = 'crew-member-item';
          itemEl.innerHTML = `
            <div class="crew-member-top">
              <div class="crew-member-id">
                <i class="fa-solid fa-circle glow-green" style="font-size:0.55rem;"></i>
                <span>${crewMember.name}</span>
                <span class="battery-badge"><i class="fa-solid fa-battery-three-quarters"></i> ${crewMember.battery}%</span>
              </div>
              <div class="crew-member-actions">
                <span class="crew-status-label">En espera</span>
                <button class="btn-alert-crew" data-crew="${crewMember.name}">¡ALERTA!</button>
              </div>
            </div>
            <div class="crew-member-slider">
              <label>VOL</label>
              <input type="range" min="0" max="100" value="100">
            </div>
          `;

          // Add click alert callback
          itemEl.querySelector('.btn-alert-crew').addEventListener('click', (e) => {
            const crewName = e.target.dataset.crew;
            socket.emit('director-alert', { room: currentRoom, targets: [crewName], message: '¡ATENCIÓN!' });
            showToast(`Alerta enviada a ${crewName}`, 'success');
          });

          crewMembersListEl.appendChild(itemEl);
        });

        // Add dynamically connected Crew members to Matrix routing buttons if they aren't there
        crewList.forEach(member => {
          if (!matrixRoutingButtons.querySelector(`[data-target="${member.name}"]`)) {
            const btn = document.createElement('button');
            btn.className = 'matrix-btn';
            btn.dataset.target = member.name;
            btn.textContent = member.name;
            matrixRoutingButtons.appendChild(btn);
          }
        });
      }
    }
  });

  // Audio Stream chunks receiver
  socket.on('audio-stream', ({ from, chunk }) => {
    // Determine whether to play the chunk. Crew plays if Director routes to them or to 'todos'
    // Director always plays audio from crew members
    if (currentRole === 'director') {
      // Find the crew visual box and highlight it
      const itemEl = Array.from(crewMembersListEl.querySelectorAll('.crew-member-item'))
        .find(e => e.querySelector('.crew-member-id span').textContent === from);
      if (itemEl) {
        const label = itemEl.querySelector('.crew-status-label');
        label.textContent = 'HABLANDO';
        label.style.color = 'var(--danger-color)';
        setTimeout(() => {
          label.textContent = 'En espera';
          label.style.color = '#10b981';
        }, 1500);
      }
      playAudioChunk(chunk);
    } else {
      // For Crew members, check if they are receiving audio
      if (!isMuted) {
        playAudioChunk(chunk);
      }
    }
  });

  // Routing updates for Crew
  socket.on('routing-update', ({ activeTargets }) => {
    if (currentRole === 'crew') {
      if (activeTargets.includes('todos') || activeTargets.includes(currentName)) {
        isMuted = false;
        earphonesStatus.className = 'earphones-icon-status active';
        earphonesMsg.className = 'earphones-unmuted';
        earphonesMsg.textContent = 'CANAL ACTIVO';
      } else {
        isMuted = true;
        earphonesStatus.className = 'earphones-icon-status';
        earphonesMsg.className = 'earphones-muted';
        earphonesMsg.textContent = 'CANAL SILENCIADO';
      }
    }
  });

  // Receive emergency alerts
  socket.on('alert', ({ from, message }) => {
    if (currentRole === 'director') {
      showToast(`¡ALERTA de ${from}: ${message}!`, 'danger');
    } else {
      showToast(`¡ALERTA del Director: ${message}!`, 'danger');
    }
  });

  // Disconnect listener
  socket.on('disconnect', () => {
    console.log('Socket disconnected from server.');
  });
}

// Add event handling to setup forms and starts
btnJoinDirector.addEventListener('click', () => {
  currentRoom = directorRoomInput.value.trim() || '8275';
  currentRole = 'director';
  currentName = 'DIRECTOR';

  dirRoomDisplay.textContent = currentRoom;
  showView('director');
  initAudio();
  initDirectorControls();
  connectToSocket(currentRoom, currentRole, currentName);
});

btnJoinCrew.addEventListener('click', () => {
  currentRoom = crewRoomInput.value.trim() || '8275';
  currentRole = 'crew';
  currentName = crewNameInput.value.trim() || 'CAM 1';

  crewRoomDisplay.textContent = currentRoom;
  crewRoleDisplay.textContent = currentName;
  showView('crew');
  initAudio();
  initCrewControls();
  connectToSocket(currentRoom, currentRole, currentName);
});

// Check URL Params for easy connection/link sharing
window.addEventListener('DOMContentLoaded', () => {
  const urlParams = new URLSearchParams(window.location.search);
  const roomParam = urlParams.get('room');
  if (roomParam) {
    directorRoomInput.value = roomParam;
    crewRoomInput.value = roomParam;
  }
});
