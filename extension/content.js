(() => {
  const BACKEND_URL = "https://unmute-b7au.onrender.com";
  const DEFAULT_SETTINGS = {
    enabled: true,
    displayName: "",
  };

  const state = {
    settings: { ...DEFAULT_SETTINGS },
    sessionId: "",
    socket: null,
    roomId: "",
    streamTitle: "",
    overlay: null,
    restoreButton: null,
    titleEl: null,
    statusEl: null,
    messagesEl: null,
    typingEl: null,
    inputEl: null,
    sendButtonEl: null,
    hideButtonEl: null,
    currentUrl: location.href,
    currentHistory: [],
    hasJoinedRoom: false,
  };

  function getVideoIdFromUrl(urlString) {
    try {
      const url = new URL(urlString);
      const hostname = url.hostname.replace(/^www\./, "");
      if (!(hostname === "youtube.com" || hostname === "m.youtube.com" || hostname === "youtu.be")) {
        return "";
      }

      if (hostname === "youtu.be") {
        const shortId = url.pathname.split("/").filter(Boolean)[0] || "";
        return /^[a-zA-Z0-9_-]{11}$/.test(shortId) ? shortId : "";
      }

      const watchId = url.searchParams.get("v") || "";
      if (/^[a-zA-Z0-9_-]{11}$/.test(watchId)) {
        return watchId;
      }

      const parts = url.pathname.split("/").filter(Boolean);
      const liveIndex = parts.indexOf("live");
      if (liveIndex !== -1) {
        const liveId = parts[liveIndex + 1] || "";
        return /^[a-zA-Z0-9_-]{11}$/.test(liveId) ? liveId : "";
      }
    } catch {
      return "";
    }

    return "";
  }

  function getDisplayName() {
    const value = String(state.settings.displayName || "").trim();
    if (value) {
      return value.slice(0, 30);
    }
    return `Guest ${state.sessionId.slice(0, 4) || "User"}`;
  }

  function getStreamTitle() {
    const metaTitle = document.querySelector('meta[property="og:title"]')?.getAttribute("content") || "";
    if (metaTitle.trim()) {
      return metaTitle.trim();
    }

    const heading = document.querySelector("h1.ytd-watch-metadata yt-formatted-string")?.textContent || "";
    if (heading.trim()) {
      return heading.trim();
    }

    return document.title.replace(/\s*-\s*YouTube\s*$/i, "").trim() || "YouTube stream";
  }

  function createOverlay() {
    if (state.overlay && state.restoreButton) {
      return;
    }

    const overlay = document.createElement("section");
    overlay.className = "unmute-overlay";
    overlay.innerHTML = `
      <div class="unmute-header">
        <div>
          <p class="unmute-eyebrow">Unmute</p>
          <h2 class="unmute-title">Waiting for stream…</h2>
        </div>
        <div class="unmute-header-actions">
          <span class="unmute-pill">Chat live</span>
          <button class="unmute-hide" type="button">Hide</button>
        </div>
      </div>
      <div class="unmute-messages"></div>
      <p class="unmute-typing"></p>
      <form class="unmute-form">
        <input class="unmute-input" type="text" maxlength="500" placeholder="Send a message" />
        <button class="unmute-send" type="submit">Send</button>
      </form>
      <p class="unmute-status"></p>
    `;

    const restoreButton = document.createElement("button");
    restoreButton.className = "unmute-restore hidden";
    restoreButton.type = "button";
    restoreButton.textContent = "Chat";

    document.documentElement.appendChild(overlay);
    document.documentElement.appendChild(restoreButton);

    state.overlay = overlay;
    state.restoreButton = restoreButton;
    state.titleEl = overlay.querySelector(".unmute-title");
    state.statusEl = overlay.querySelector(".unmute-status");
    state.messagesEl = overlay.querySelector(".unmute-messages");
    state.typingEl = overlay.querySelector(".unmute-typing");
    state.inputEl = overlay.querySelector(".unmute-input");
    state.sendButtonEl = overlay.querySelector(".unmute-send");
    state.hideButtonEl = overlay.querySelector(".unmute-hide");

    state.hideButtonEl.addEventListener("click", () => {
      overlay.classList.add("hidden");
      restoreButton.classList.remove("hidden");
    });

    restoreButton.addEventListener("click", () => {
      overlay.classList.remove("hidden");
      restoreButton.classList.add("hidden");
    });

    overlay.querySelector(".unmute-form").addEventListener("submit", (event) => {
      event.preventDefault();
      const text = state.inputEl.value.trim();
      if (!text || !state.socket || !state.roomId || !state.hasJoinedRoom) {
        setStatus("Still connecting to chat…");
        return;
      }

      state.socket.emit("chat-message", text);
      state.inputEl.value = "";
      state.inputEl.focus();
    });

    setComposerEnabled(false);
  }

  function setComposerEnabled(enabled) {
    if (!state.inputEl || !state.sendButtonEl) {
      return;
    }

    state.inputEl.disabled = !enabled;
    state.sendButtonEl.disabled = !enabled;
  }

  function setStatus(text) {
    if (state.statusEl) {
      state.statusEl.textContent = text || "";
    }
  }

  function resetMessages() {
    if (state.messagesEl) {
      state.messagesEl.innerHTML = "";
    }
  }

  function renderMessage(message, type = "user") {
    if (!state.messagesEl) {
      return;
    }

    const isOwn = type === "user" && message.sessionId === state.sessionId;
    const item = document.createElement("article");
    item.className = `unmute-message ${type}${isOwn ? " own" : ""}`;
    const safeName = String(message.username || "System");
    const safeText = String(message.text || "");
    const safeTime = new Intl.DateTimeFormat([], { hour: "numeric", minute: "2-digit" }).format(new Date(message.timestamp || Date.now()));
    item.innerHTML = `
      <div class="unmute-meta">
        <strong>${safeName}</strong>
        <span>${safeTime}</span>
      </div>
      <p>${safeText}</p>
    `;
    state.messagesEl.appendChild(item);
    state.messagesEl.scrollTop = state.messagesEl.scrollHeight;
  }

  function replaceHistory(history) {
    state.currentHistory = Array.isArray(history) ? history : [];
    resetMessages();
    state.currentHistory.forEach((message) => renderMessage(message, "user"));
  }

  function bindSocket(socket) {
    socket.on("connect", () => {
      setStatus("Connected. Joining room…");
      joinCurrentRoom();
    });

    socket.on("disconnect", () => {
      state.hasJoinedRoom = false;
      setComposerEnabled(false);
      setStatus("Disconnected");
    });

    socket.on("connect_error", (error) => {
      state.hasJoinedRoom = false;
      setComposerEnabled(false);
      setStatus(`Connect failed: ${error?.message || "unknown error"}`);
    });

    socket.on("chat-history", (history) => {
      state.hasJoinedRoom = true;
      setComposerEnabled(true);
      setStatus(`Joined room ${state.roomId}`);
      replaceHistory(history);
    });

    socket.on("chat-message", (message) => {
      state.currentHistory.push(message);
      renderMessage(message, "user");
    });

    socket.on("system-message", (message) => {
      renderMessage(message, "system");
    });

    socket.on("system-error", (text) => {
      setStatus(String(text || ""));
    });

    socket.on("join-denied", (text) => {
      state.hasJoinedRoom = false;
      setComposerEnabled(false);
      setStatus(String(text || "Unable to join this room."));
    });

    socket.on("room-ended", ({ text }) => {
      state.hasJoinedRoom = false;
      setComposerEnabled(false);
      setStatus(String(text || "This room has ended."));
    });

    socket.on("room-stats", ({ participantCount, typingNames }) => {
      const typing = Array.isArray(typingNames) && typingNames.length > 0
        ? `${typingNames.slice(0, 3).join(", ")} ${typingNames.length === 1 ? "is" : "are"} typing...`
        : `${participantCount || 0} here now`;
      if (state.typingEl) {
        state.typingEl.textContent = typing;
      }
    });
  }

  function connectSocket() {
    if (!state.settings.enabled) {
      disconnectSocket();
      setComposerEnabled(false);
      setStatus("Overlay disabled in extension settings.");
      return;
    }

    if (state.socket && state.socket.io?.uri === BACKEND_URL) {
      return;
    }

    disconnectSocket();
    state.hasJoinedRoom = false;
    setComposerEnabled(false);
    setStatus(`Connecting to ${BACKEND_URL}…`);
    state.socket = io(BACKEND_URL, {
      path: "/socket.io",
      transports: ["websocket", "polling"],
      withCredentials: false,
      timeout: 10000,
      reconnection: true,
    });
    bindSocket(state.socket);
  }

  function disconnectSocket() {
    if (state.socket) {
      state.socket.disconnect();
      state.socket = null;
    }
  }

  function joinCurrentRoom() {
    if (!state.socket || !state.socket.connected || !state.roomId) {
      return;
    }

    const username = getDisplayName();
    state.hasJoinedRoom = false;
    setComposerEnabled(false);
    state.socket.emit("watch-room", {
      roomId: state.roomId,
      sessionId: state.sessionId,
    });
    state.socket.emit("join-room", {
      roomId: state.roomId,
      username,
      sessionId: state.sessionId,
      profileColor: "#2563eb",
    });
    setStatus(`Joining ${state.roomId} as ${username}…`);
  }

  function refreshStreamContext() {
    const videoId = getVideoIdFromUrl(location.href);
    state.currentUrl = location.href;

    if (!videoId) {
      state.roomId = "";
      state.streamTitle = "";
      state.hasJoinedRoom = false;
      setComposerEnabled(false);
      if (state.titleEl) {
        state.titleEl.textContent = "Open a YouTube stream";
      }
      setStatus("Navigate to a YouTube live/watch page to join chat.");
      resetMessages();
      return;
    }

    const nextTitle = getStreamTitle();
    const roomChanged = videoId !== state.roomId;
    state.roomId = videoId;
    state.streamTitle = nextTitle;

    if (state.titleEl) {
      state.titleEl.textContent = nextTitle || "YouTube stream";
    }

    if (roomChanged) {
      resetMessages();
      state.currentHistory = [];
      state.hasJoinedRoom = false;
      setComposerEnabled(false);
    }

    connectSocket();
    joinCurrentRoom();
  }

  async function loadSettings() {
    state.settings = await chrome.storage.sync.get(DEFAULT_SETTINGS);
    const localState = await chrome.storage.local.get(["sessionId"]);
    if (!localState.sessionId) {
      state.sessionId = crypto.randomUUID();
      await chrome.storage.local.set({ sessionId: state.sessionId });
    } else {
      state.sessionId = localState.sessionId;
    }
  }

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "sync") {
      return;
    }

    if (changes.enabled) {
      state.settings.enabled = changes.enabled.newValue;
    }
    if (changes.displayName) {
      state.settings.displayName = changes.displayName.newValue;
    }

    refreshStreamContext();
  });

  async function init() {
    createOverlay();
    await loadSettings();
    refreshStreamContext();
    window.setInterval(() => {
      if (location.href !== state.currentUrl) {
        refreshStreamContext();
        return;
      }

      const latestTitle = getStreamTitle();
      if (latestTitle && latestTitle !== state.streamTitle) {
        state.streamTitle = latestTitle;
        if (state.titleEl) {
          state.titleEl.textContent = latestTitle;
        }
      }
    }, 1000);
  }

  init().catch((error) => {
    console.error("Unmute overlay failed to initialize", error);
  });
})();
