// URL del WebSocket del tuo backend (DEVI configurarlo tu)
const WS_URL = "wss://tuo-server-websocket.example"; // Cambialo quando hai il server

// Config WebRTC base
const RTC_CONFIG = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" }
  ]
};

let socket = null;
let userData = null;
let filters = null;
let isConnected = false;

// WebRTC
let peer = null;
let localStream = null;
let remoteStream = null;
let isVideoEnabled = true;
let isAudioEnabled = true;

// ELEMENTI
const introOverlay = document.getElementById("introOverlay");
const startBtn = document.getElementById("startBtn");
const introError = document.getElementById("introError");

const app = document.getElementById("app");
const userSummary = document.getElementById("userSummary");
const filtersSummary = document.getElementById("filtersSummary");
const editFiltersBtn = document.getElementById("editFiltersBtn");

const statusEl = document.getElementById("status");
const chatInfo = document.getElementById("chatInfo");
const messagesEl = document.getElementById("messages");
const messageForm = document.getElementById("messageForm");
const messageInput = document.getElementById("messageInput");
const nextBtn = document.getElementById("nextBtn");
const reportBtn = document.getElementById("reportBtn");
const toggleCamBtn = document.getElementById("toggleCamBtn");
const toggleMicBtn = document.getElementById("toggleMicBtn");

const localVideo = document.getElementById("localVideo");
const remoteVideo = document.getElementById("remoteVideo");

// AVVIO: dati + filtri
startBtn.addEventListener("click", async () => {
  introError.textContent = "";

  const myAge = parseInt(document.getElementById("myAge").value, 10);
  const myGender = document.getElementById("myGender").value.trim();
  const myCountry = document.getElementById("myCountry").value.trim();

  const filterGender = document.getElementById("filterGender").value.trim();
  const filterAgeMin = parseInt(document.getElementById("filterAgeMin").value, 10) || null;
  const filterAgeMax = parseInt(document.getElementById("filterAgeMax").value, 10) || null;
  const filterCountry = document.getElementById("filterCountry").value.trim();

  if (!myAge || myAge < 13 || myAge > 99) {
    introError.textContent = "Inserisci un'età valida (13-99).";
    return;
  }
  if (!myGender) {
    introError.textContent = "Seleziona il tuo genere.";
    return;
  }
  if (!myCountry) {
    introError.textContent = "Inserisci la tua nazionalità.";
    return;
  }
  if (filterAgeMin && filterAgeMax && filterAgeMin > filterAgeMax) {
    introError.textContent = "L'età minima non può essere maggiore della massima.";
    return;
  }

  userData = { age: myAge, gender: myGender, country: myCountry };
  filters = {
    gender: filterGender || null,
    ageMin: filterAgeMin,
    ageMax: filterAgeMax,
    country: filterCountry || null
  };

  userSummary.textContent =
    `${userData.age} anni, ${formatGender(userData.gender)}, ${userData.country}`;
  filtersSummary.textContent = buildFiltersSummary(filters);

  // Prova ad attivare fotocamera/microfono
  try {
    localStream = await navigator.mediaDevices.getUserMedia({
      video: true,
      audio: true
    });
    localVideo.srcObject = localStream;
  } catch (err) {
    introError.textContent = "Devi consentire l'accesso a videocamera e microfono.";
    return;
  }

  introOverlay.style.display = "none";
  app.style.display = "flex";

  connectSocket();
});

// Modifica filtri = riapri overlay
editFiltersBtn.addEventListener("click", () => {
  introOverlay.style.display = "flex";
});

// Toggle videocamera
toggleCamBtn.addEventListener("click", () => {
  if (!localStream) return;
  isVideoEnabled = !isVideoEnabled;
  localStream.getVideoTracks().forEach(t => t.enabled = isVideoEnabled);
  toggleCamBtn.style.opacity = isVideoEnabled ? "1" : "0.5";
});

// Toggle microfono
toggleMicBtn.addEventListener("click", () => {
  if (!localStream) return;
  isAudioEnabled = !isAudioEnabled;
  localStream.getAudioTracks().forEach(t => t.enabled = isAudioEnabled);
  toggleMicBtn.style.opacity = isAudioEnabled ? "1" : "0.5";
});

// Connessione WebSocket (signaling)
function connectSocket() {
  messagesEl.innerHTML = "";
  addSystemMessage("Connessione al server...");

  if (!WS_URL || WS_URL.includes("tuo-server-websocket.example")) {
    addSystemMessage("⚙️ Configura WS_URL in app.js per attivare video e match reali.");
    setStatus("In attesa configurazione server", "waiting");
    chatInfo.textContent =
      "UI pronta. Quando il backend WebSocket sarà online, la videochat funzionerà.";
    return;
  }

  try {
    socket = new WebSocket(WS_URL);
  } catch (err) {
    addSystemMessage("Impossibile connettersi al server.");
    setStatus("Errore connessione", "waiting");
    return;
  }

  socket.addEventListener("open", () => {
    isConnected = true;
    addSystemMessage("Connesso. Cerchiamo uno sconosciuto compatibile...");
    setStatus("In attesa di un altro utente...", "waiting");
    chatInfo.textContent = "Filtri inviati. Rimani online per il match.";

    socketSend({
      type: "join",
      user: userData,
      filters
    });
  });

  socket.addEventListener("message", (event) => {
    let data;
    try {
      data = JSON.parse(event.data);
    } catch {
      console.warn("Messaggio non valido dal server:", event.data);
      return;
    }
    handleServerEvent(data);
  });

  socket.addEventListener("close", () => {
    isConnected = false;
    setStatus("Disconnesso", "waiting");
    addSystemMessage("Connessione chiusa dal server.");
    destroyPeer();
  });

  socket.addEventListener("error", () => {
    setStatus("Errore", "waiting");
    addSystemMessage("Errore di connessione al server.");
  });
}

// Gestione eventi dal backend
function handleServerEvent(data) {
  switch (data.type) {
    case "waiting":
      setStatus("In attesa di un altro utente...", "waiting");
      chatInfo.textContent = "Nessun match ancora. Rimani collegato.";
      break;

    case "matched":
      // Il server può inviare: { type: "matched", role: "offer" | "answer" }
      setStatus("Connesso con uno sconosciuto", "connected");
      chatInfo.textContent = "Video connesso. Sii rispettoso. Usa Next per cambiare.";
      messagesEl.innerHTML = "";
      addSystemMessage("Match trovato. Di' ciao 👋");
      startPeer(data.role === "offer");
      break;

    case "message":
      if (typeof data.text === "string") {
        addMessage(data.text, "other");
      }
      break;

    case "partner_left":
      addSystemMessage("L'altro utente ha lasciato. Cerchiamo qualcun altro.");
      setStatus("In attesa di un altro utente...", "waiting");
      chatInfo.textContent = "Match terminato. Attendi il prossimo utente.";
      destroyPeer(false);
      break;

    case "rtc-offer":
      if (data.sdp) handleOffer(data.sdp);
      break;

    case "rtc-answer":
      if (data.sdp) handleAnswer(data.sdp);
      break;

    case "rtc-ice":
      if (data.candidate) handleRemoteIce(data.candidate);
      break;

    case "system":
      if (data.text) addSystemMessage(data.text);
      break;

    default:
      console.log("Evento sconosciuto:", data);
  }
}

/* ========== WEBRTC ========== */

function startPeer(isOfferer) {
  destroyPeer();

  peer = new RTCPeerConnection(RTC_CONFIG);

  // Stream remoto
  remoteStream = new MediaStream();
  remoteVideo.srcObject = remoteStream;

  // Aggiungi tracce locali
  if (localStream) {
    localStream.getTracks().forEach(track => {
      peer.addTrack(track, localStream);
    });
  }

  // Ricezione tracce remote
  peer.addEventListener("track", (event) => {
    event.streams[0].getTracks().forEach(track => {
      remoteStream.addTrack(track);
    });
  });

  // ICE locali → al server
  peer.addEventListener("icecandidate", (event) => {
    if (event.candidate) {
      socketSend({
        type: "rtc-ice",
        candidate: event.candidate
      });
    }
  });

  // Se siamo offerer, creiamo l'offerta
  if (isOfferer) {
    createAndSendOffer();
  }
}

async function createAndSendOffer() {
  if (!peer) return;
  try {
    const offer = await peer.createOffer();
    await peer.setLocalDescription(offer);
    socketSend({
      type: "rtc-offer",
      sdp: offer
    });
  } catch (err) {
    console.error("Errore creazione offerta:", err);
  }
}

async function handleOffer(offer) {
  if (!peer) startPeer(false);
  try {
    await peer.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await peer.createAnswer();
    await peer.setLocalDescription(answer);
    socketSend({
      type: "rtc-answer",
      sdp: answer
    });
  } catch (err) {
    console.error("Errore gestione offerta:", err);
  }
}

async function handleAnswer(answer) {
  if (!peer) return;
  try {
    await peer.setRemoteDescription(new RTCSessionDescription(answer));
  } catch (err) {
    console.error("Errore gestione answer:", err);
  }
}

function handleRemoteIce(candidate) {
  if (!peer) return;
  try {
    peer.addIceCandidate(new RTCIceCandidate(candidate));
  } catch (err) {
    console.error("Errore ICE remoto:", err);
  }
}

function destroyPeer(clearRemote = true) {
  if (peer) {
    peer.ontrack = null;
    peer.onicecandidate = null;
    peer.close();
    peer = null;
  }
  if (clearRemote) {
    if (remoteVideo) remoteVideo.srcObject = null;
    remoteStream = null;
  }
}

/* ========== CHAT TESTUALE & SEGNALI ========== */

function socketSend(obj) {
  if (!socket || socket.readyState !== WebSocket.OPEN) return;
  socket.send(JSON.stringify(obj));
}

messageForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const text = messageInput.value.trim();
  if (!text) return;

  addMessage(text, "me");
  socketSend({ type: "message", text });
  messageInput.value = "";
});

nextBtn.addEventListener("click", () => {
  addSystemMessage("Hai lasciato la chat. Cerchiamo un nuovo utente...");
  setStatus("Ricerca nuovo utente...", "waiting");
  chatInfo.textContent = "In attesa di un nuovo match...";
  destroyPeer();
  socketSend({ type: "next" });
});

reportBtn.addEventListener("click", () => {
  addSystemMessage("Hai segnalato questo utente. Verrà verificato.");
  socketSend({ type: "report" });
});

/* ========== UI HELPERS ========== */

function addMessage(text, who) {
  const div = document.createElement("div");
  div.classList.add("message");
  if (who === "me") div.classList.add("me");
  else if (who === "other") div.classList.add("other");
  else div.classList.add("system");
  div.textContent = text;
  messagesEl.appendChild(div);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function addSystemMessage(text) {
  const div = document.createElement("div");
  div.classList.add("message", "system");
  div.textContent = text;
  messagesEl.appendChild(div);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function setStatus(text, mode) {
  statusEl.textContent = text;
  statusEl.classList.remove("status-connected", "status-waiting");
  if (mode === "connected") statusEl.classList.add("status-connected");
  else statusEl.classList.add("status-waiting");
}

function buildFiltersSummary(f) {
  const parts = [];
  parts.push(f.gender ? `Genere: ${formatGender(f.gender)}` : "Genere: tutti");
  if (f.ageMin || f.ageMax) {
    const min = f.ageMin || 13;
    const max = f.ageMax || 99;
    parts.push(`Età: ${min}-${max}`);
  } else {
    parts.push("Età: tutte");
  }
  parts.push(f.country ? `Nazionalità: ${f.country}` : "Nazionalità: tutte");
  return parts.join(" • ");
}

function formatGender(g) {
  if (g === "male") return "Maschio";
  if (g === "female") return "Femmina";
  if (g === "other") return "Altro";
  return g;
}
