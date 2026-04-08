const socket = io();

const streamLocatorForm = document.getElementById("stream-locator-form");
const streamInput = document.getElementById("streamInput");
const joinForm = document.getElementById("join-form");
const usernameInput = document.getElementById("username");
const colorOptions = document.getElementById("color-options");
const messageForm = document.getElementById("message-form");
const messageInput = document.getElementById("message-input");
const messageButton = messageForm.querySelector("button");
const streamTitle = document.getElementById("stream-title");
const roomBadge = document.getElementById("room-badge");
const embedHelp = document.getElementById("embed-help");
const peoplePill = document.getElementById("people-pill");
const connectionPill = document.getElementById("connection-pill");
const presenceLine = document.getElementById("presence-line");
const prejoinPanel = document.getElementById("prejoin-panel");
const prejoinTitle = document.getElementById("prejoin-title");
const prejoinCopy = document.getElementById("prejoin-copy");
const moderatorNotice = document.getElementById("moderator-notice");
const pinnedPanel = document.getElementById("pinned-panel");
const pinnedAuthor = document.getElementById("pinned-author");
const pinnedText = document.getElementById("pinned-text");
const pinnedTime = document.getElementById("pinned-time");
const messages = document.getElementById("messages");
const typingStatus = document.getElementById("typing-status");
const adminPanel = document.getElementById("admin-panel");
const adminHelp = document.getElementById("admin-help");
const participantList = document.getElementById("participant-list");
const pinForm = document.getElementById("pin-form");
const pinInput = document.getElementById("pin-input");
const clearPinButton = document.getElementById("clear-pin-button");
const clearChatButton = document.getElementById("clear-chat-button");
const reportsList = document.getElementById("reports-list");
const playerFallback = document.getElementById("player-fallback");
const youtubeLink = document.getElementById("youtube-link");

const COLOR_PRESETS = ["#ff7a18", "#ffd166", "#79f2a3", "#73c2fb", "#f497da", "#c4b5fd"];

let activeRoomId = "";
let activeUsername = localStorage.getItem("streamside-username") || "";
let moderatorToken = new URLSearchParams(window.location.search).get("mod") || "";
let isAdmin = false;
let currentHistory = [];
let currentPinnedMessage = null;
let currentReports = [];
let joinedChat = false;
let sessionId = localStorage.getItem("streamside-session-id") || crypto.randomUUID();
let selectedProfileColor = localStorage.getItem("streamside-profile-color") || COLOR_PRESETS[0];
let typingTimeoutId = 0;
let ytPlayer = null;
let ytScriptPromise = null;
let currentRoomSettings = null;

localStorage.setItem("streamside-session-id", sessionId);
usernameInput.value = activeUsername;

function getInitials(name) {
  return String(name || "G")
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((chunk) => chunk[0]?.toUpperCase() || "")
    .join("") || "G";
}

function renderColorOptions() {
  colorOptions.innerHTML = "";
  COLOR_PRESETS.forEach((color) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "color-swatch";
    button.dataset.color = color;
    button.style.setProperty("--swatch-color", color);
    if (color === selectedProfileColor) {
      button.classList.add("active");
    }
    colorOptions.appendChild(button);
  });
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function extractVideoId(input) {
  const raw = String(input || "").trim();
  if (!raw) {
    return "";
  }

  if (/^[a-zA-Z0-9_-]{11}$/.test(raw)) {
    return raw;
  }

  try {
    const url = new URL(raw);
    const hostname = url.hostname.replace(/^www\./, "");

    if (hostname === "youtu.be") {
      const id = url.pathname.split("/").filter(Boolean)[0];
      return /^[a-zA-Z0-9_-]{11}$/.test(id || "") ? id : "";
    }

    if (hostname === "youtube.com" || hostname === "m.youtube.com") {
      const queryId = url.searchParams.get("v");
      if (/^[a-zA-Z0-9_-]{11}$/.test(queryId || "")) {
        return queryId;
      }

      const pathParts = url.pathname.split("/").filter(Boolean);
      const candidate =
        pathParts[pathParts.indexOf("live") + 1] ||
        pathParts[pathParts.indexOf("embed") + 1] ||
        "";

      return /^[a-zA-Z0-9_-]{11}$/.test(candidate || "") ? candidate : "";
    }
  } catch {
    return "";
  }

  return "";
}

function getVideoIdFromPath() {
  const match = window.location.pathname.match(/^\/stream\/([a-zA-Z0-9_-]{11})$/);
  return match ? match[1] : "";
}

function formatTime(timestamp) {
  return new Intl.DateTimeFormat([], {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(timestamp));
}

function setConnectedState(isConnected) {
  connectionPill.textContent = isConnected ? "Connected" : "Offline";
  connectionPill.classList.toggle("offline", !isConnected);
  connectionPill.classList.toggle("online", isConnected);
}

function enableMessaging(enabled) {
  messageInput.disabled = !enabled;
  messageButton.disabled = !enabled;
}

function setJoinedState(joined) {
  joinedChat = joined;
  prejoinPanel.classList.toggle("hidden", joined);
  messages.classList.toggle("hidden", !joined);
  messageForm.classList.toggle("hidden", !joined);
  typingStatus.classList.toggle("hidden", !joined);
  enableMessaging(joined);
}

function setRoomEnded(text) {
  setJoinedState(false);
  setAdminState(false);
  if (text) {
    renderMessage({ text, timestamp: new Date().toISOString() }, "system");
  }
}

function setAdminState(nextIsAdmin, moderatorLinksConfigured = true) {
  isAdmin = nextIsAdmin;
  adminPanel.classList.toggle("hidden", !nextIsAdmin);
  moderatorNotice.classList.toggle("hidden", !nextIsAdmin);
  if (nextIsAdmin) {
    adminHelp.textContent = moderatorLinksConfigured
      ? "Use timeout, mute, ban, and delete controls to manage this room."
      : "Moderator links are not configured correctly on the server.";
  }
  renderParticipantList([]);
  renderReports([]);
  replaceHistory(currentHistory);
}

function renderPresence(participantCount, typingNames = []) {
  peoplePill.textContent = `${participantCount} ${participantCount === 1 ? "person" : "people"} here now`;

  if (typingNames.length === 0) {
    presenceLine.textContent = participantCount > 0
      ? `${participantCount} ${participantCount === 1 ? "person is" : "people are"} watching or chatting here now.`
      : "Nobody is here yet.";
    typingStatus.textContent = "";
    return;
  }

  const suffix = typingNames.length === 1 ? "is typing..." : "are typing...";
  typingStatus.textContent = `${typingNames.join(", ")} ${suffix}`;
  presenceLine.textContent = `${participantCount} ${participantCount === 1 ? "person is" : "people are"} watching or chatting here now.`;
}

function renderMessage(message, type = "user") {
  const item = document.createElement("article");
  item.className = `message ${type}`;
  item.dataset.messageId = message.id || "";
  item.dataset.sessionId = message.sessionId || "";
  const name = type === "user" ? escapeHtml(message.username) : "System";
  const profileColor = escapeHtml(message.profileColor || "#64748b");
  const moderationButton =
    isAdmin && type === "user"
      ? `<button class="message-action" type="button" data-action="delete-message" data-message-id="${escapeHtml(message.id)}">Delete</button>`
      : "";
  const reportButton =
    type === "user" && message.sessionId !== sessionId
      ? `<button class="message-action" type="button" data-action="report-message" data-message-id="${escapeHtml(message.id)}">Report</button>`
      : "";
  const avatar = type === "user"
    ? `<span class="message-avatar" style="--avatar-color:${profileColor}">${escapeHtml(getInitials(message.username))}</span>`
    : `<span class="message-avatar system-avatar">!</span>`;

  item.innerHTML = `
    <div class="message-shell">
      ${avatar}
      <div class="message-body">
        <div class="message-meta">
          <strong>${name}</strong>
          <div class="message-meta-actions">
            <span>${formatTime(message.timestamp)}</span>
            ${reportButton}
            ${moderationButton}
          </div>
        </div>
        <p>${escapeHtml(message.text)}</p>
      </div>
    </div>
  `;

  messages.appendChild(item);
  messages.scrollTop = messages.scrollHeight;
}

function resetMessages() {
  messages.innerHTML = "";
}

function replaceHistory(history) {
  currentHistory = Array.isArray(history) ? history : [];
  resetMessages();
  currentHistory.forEach((message) => renderMessage(message, "user"));
}

function renderPinnedMessage(pinnedMessage) {
  currentPinnedMessage = pinnedMessage;
  pinnedPanel.classList.toggle("hidden", !pinnedMessage);
  if (!pinnedMessage) {
    return;
  }

  pinnedAuthor.textContent = pinnedMessage.createdBy
    ? `Pinned by ${pinnedMessage.createdBy}`
    : "Moderator Announcement";
  pinnedText.textContent = pinnedMessage.text;
  pinnedTime.textContent = formatTime(pinnedMessage.timestamp);
}

function renderParticipantList(participants) {
  participantList.innerHTML = "";

  participants.forEach((participant) => {
    const item = document.createElement("article");
    item.className = "participant-item";
    const status = participant.isAdmin
      ? "Moderator"
      : participant.isTimedOut
      ? `Timed out for ${Math.ceil(participant.timeoutRemainingMs / 60000)}m`
      : participant.isMuted
      ? "Muted"
      : "Active";

    item.innerHTML = `
      <div class="participant-copy">
        <div class="participant-name-row">
          <span class="mini-avatar" style="--avatar-color:${escapeHtml(participant.profileColor || "#64748b")}">${escapeHtml(getInitials(participant.username))}</span>
          <strong>${escapeHtml(participant.username)}</strong>
        </div>
        <span>${status}</span>
      </div>
      <div class="participant-actions">
        <button type="button" data-action="${participant.isMuted ? "unmute-user" : "mute-user"}" data-session-id="${escapeHtml(participant.sessionId)}">
          ${participant.isMuted ? "Unmute" : "Mute"}
        </button>
        <button type="button" data-action="${participant.isTimedOut ? "clear-timeout-user" : "timeout-user"}" data-session-id="${escapeHtml(participant.sessionId)}" data-duration-ms="300000">
          ${participant.isTimedOut ? "Clear Timeout" : "Timeout 5m"}
        </button>
        <button type="button" data-action="ban-user" data-session-id="${escapeHtml(participant.sessionId)}">
          Ban
        </button>
      </div>
    `;

    participantList.appendChild(item);
  });
}

function renderReports(reports) {
  currentReports = Array.isArray(reports) ? reports : [];
  reportsList.innerHTML = "";

  currentReports.forEach((report) => {
    const item = document.createElement("article");
    item.className = "report-item";
    item.innerHTML = `
      <div class="report-copy">
        <strong>${escapeHtml(report.messageUsername)} was reported</strong>
        <span>${escapeHtml(report.reason)} by ${escapeHtml(report.reportedByUsername)}</span>
        <p>${escapeHtml(report.messageText)}</p>
      </div>
      <div class="participant-actions">
        <button type="button" data-action="delete-message" data-message-id="${escapeHtml(report.messageId)}">Delete Msg</button>
        <button type="button" data-action="dismiss-report" data-report-id="${escapeHtml(report.id)}">Dismiss</button>
      </div>
    `;
    reportsList.appendChild(item);
  });
}

function getStreamUrl(videoId) {
  return `${window.location.origin}/stream/${videoId}`;
}

function getYoutubeWatchUrl(videoId) {
  return `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;
}

function setStreamContext(videoId) {
  activeRoomId = videoId;
  streamTitle.textContent = `YouTube Live Room: ${videoId}`;
  roomBadge.textContent = `Room: ${videoId}`;
  prejoinTitle.textContent = `Stream detected: ${videoId}`;
  prejoinCopy.textContent = `Share ${getStreamUrl(videoId)} so everyone joins the same room for this stream.`;
  embedHelp.textContent = `Shareable page: ${getStreamUrl(videoId)}`;
  youtubeLink.href = getYoutubeWatchUrl(videoId);
  streamInput.value = videoId;
  socket.emit("watch-room", {
    roomId: videoId,
    sessionId,
  });
}

function showPlayerFallback(message) {
  playerFallback.classList.remove("hidden");
  if (message) {
    playerFallback.querySelector("p").textContent = message;
  }
}

function hidePlayerFallback() {
  playerFallback.classList.add("hidden");
}

function loadYouTubeApi() {
  if (window.YT?.Player) {
    return Promise.resolve(window.YT);
  }

  if (ytScriptPromise) {
    return ytScriptPromise;
  }

  ytScriptPromise = new Promise((resolve) => {
    const script = document.createElement("script");
    script.src = "https://www.youtube.com/iframe_api";
    document.head.appendChild(script);
    window.onYouTubeIframeAPIReady = () => resolve(window.YT);
  });

  return ytScriptPromise;
}

async function renderPlayer(videoId) {
  if (!videoId) {
    return;
  }

  setStreamContext(videoId);
  hidePlayerFallback();

  try {
    await loadYouTubeApi();

    if (ytPlayer) {
      ytPlayer.destroy();
    }

    ytPlayer = new window.YT.Player("player", {
      videoId,
      playerVars: {
        autoplay: 1,
        playsinline: 1,
      },
      events: {
        onError: () => {
          showPlayerFallback(
            "The YouTube embed is unavailable here, but the chat can still stay active on this page."
          );
        },
      },
    });
  } catch {
    showPlayerFallback("The embedded player could not be loaded, but the chat can still stay active on this page.");
  }
}

function redirectToStream(videoId) {
  window.location.assign(`/stream/${videoId}`);
}

function startTyping() {
  if (!joinedChat) {
    return;
  }

  socket.emit("typing-state", { isTyping: true });
  window.clearTimeout(typingTimeoutId);
  typingTimeoutId = window.setTimeout(() => {
    socket.emit("typing-state", { isTyping: false });
  }, 1200);
}

streamLocatorForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const videoId = extractVideoId(streamInput.value);
  if (!videoId) {
    embedHelp.textContent = "That does not look like a valid YouTube video ID or URL.";
    return;
  }

  redirectToStream(videoId);
});

joinForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const username = usernameInput.value.trim();
  if (!activeRoomId || !username) {
    return;
  }

  activeUsername = username;
  localStorage.setItem("streamside-username", username);
  localStorage.setItem("streamside-profile-color", selectedProfileColor);

  socket.emit("join-room", {
    roomId: activeRoomId,
    username,
    sessionId,
    moderatorToken,
    profileColor: selectedProfileColor,
  });

  setJoinedState(true);
  messageInput.focus();
});

messageForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const text = messageInput.value.trim();
  if (!text || !activeRoomId || !activeUsername) {
    return;
  }

  socket.emit("chat-message", text);
  socket.emit("typing-state", { isTyping: false });
  window.clearTimeout(typingTimeoutId);
  messageInput.value = "";
  messageInput.focus();
});

messageInput.addEventListener("input", () => {
  if (!messageInput.value.trim()) {
    socket.emit("typing-state", { isTyping: false });
    window.clearTimeout(typingTimeoutId);
    return;
  }

  startTyping();
});

socket.on("connect", () => {
  setConnectedState(true);
  if (activeRoomId) {
    socket.emit("watch-room", {
      roomId: activeRoomId,
      sessionId,
    });
  }
  if (joinedChat && activeRoomId && activeUsername) {
    socket.emit("join-room", {
      roomId: activeRoomId,
      username: activeUsername,
      sessionId,
      moderatorToken,
    });
  }
});

socket.on("disconnect", () => {
  setConnectedState(false);
});

socket.on("chat-history", (history) => {
  replaceHistory(history);
});

socket.on("pinned-message", (pinnedMessage) => {
  renderPinnedMessage(pinnedMessage);
});

socket.on("room-settings", (settings) => {
  currentRoomSettings = settings;
});

socket.on("chat-message", (message) => {
  currentHistory.push(message);
  renderMessage(message, "user");
});

socket.on("system-message", (message) => {
  renderMessage(message, "system");
});

socket.on("system-error", (text) => {
  renderMessage({ text, timestamp: new Date().toISOString() }, "system");
});

socket.on("join-denied", (text) => {
  setJoinedState(false);
  setAdminState(false);
  renderMessage({ text, timestamp: new Date().toISOString() }, "system");
});

socket.on("room-ended", ({ text }) => {
  setRoomEnded(text);
});

socket.on("admin-state", ({ isAdmin: nextIsAdmin, moderatorLinksConfigured }) => {
  setAdminState(nextIsAdmin, moderatorLinksConfigured);
});

socket.on("room-stats", ({ participantCount, typingNames }) => {
  renderPresence(participantCount, typingNames);
});

socket.on("participants-update", (participants) => {
  if (!isAdmin) {
    return;
  }

  const visibleParticipants = participants.filter((participant) => participant.sessionId !== sessionId);
  renderParticipantList(visibleParticipants);
});

socket.on("reports-update", (reports) => {
  if (!isAdmin) {
    return;
  }
  renderReports(reports);
});

socket.on("message-deleted", ({ messageId }) => {
  currentHistory = currentHistory.filter((message) => message.id !== messageId);
  const message = messages.querySelector(`[data-message-id="${CSS.escape(messageId)}"]`);
  if (message) {
    message.remove();
  }
});

socket.on("history-replaced", (history) => {
  replaceHistory(history);
});

messages.addEventListener("click", (event) => {
  const button = event.target.closest("[data-action='delete-message']");
  if (button && isAdmin) {
    socket.emit("moderation-action", {
      action: "delete-message",
      messageId: button.dataset.messageId,
    });
    return;
  }

  const reportButton = event.target.closest("[data-action='report-message']");
  if (reportButton) {
    socket.emit("report-message", {
      messageId: reportButton.dataset.messageId,
      reason: "Abusive or inappropriate",
    });
  }
});

participantList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-action]");
  if (!button || !isAdmin) {
    return;
  }

  socket.emit("moderation-action", {
    action: button.dataset.action,
    targetSessionId: button.dataset.sessionId,
    durationMs: button.dataset.durationMs,
  });
});

pinForm.addEventListener("submit", (event) => {
  event.preventDefault();
  if (!isAdmin || !pinInput.value.trim()) {
    return;
  }

  socket.emit("moderation-action", {
    action: "pin-message",
    text: pinInput.value.trim(),
  });
  pinInput.value = "";
});

clearPinButton.addEventListener("click", () => {
  if (!isAdmin) {
    return;
  }
  socket.emit("moderation-action", {
    action: "clear-pinned-message",
  });
});

clearChatButton.addEventListener("click", () => {
  if (!isAdmin) {
    return;
  }
  socket.emit("moderation-action", {
    action: "clear-chat",
  });
});

reportsList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-action]");
  if (!button || !isAdmin) {
    return;
  }

  if (button.dataset.action === "delete-message") {
    socket.emit("moderation-action", {
      action: "delete-message",
      messageId: button.dataset.messageId,
    });
    return;
  }

  if (button.dataset.action === "dismiss-report") {
    socket.emit("moderation-action", {
      action: "dismiss-report",
      messageId: button.dataset.reportId,
    });
  }
});

colorOptions.addEventListener("click", (event) => {
  const button = event.target.closest("[data-color]");
  if (!button) {
    return;
  }

  selectedProfileColor = button.dataset.color;
  renderColorOptions();
});

const initialVideoId = getVideoIdFromPath();
renderColorOptions();
if (initialVideoId) {
  setStreamContext(initialVideoId);
  renderPlayer(initialVideoId);
} else {
  setJoinedState(false);
}
