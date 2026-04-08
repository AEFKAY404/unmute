const roomsGrid = document.getElementById("rooms-grid");
const emptyState = document.getElementById("dashboard-empty");
const streamsCount = document.getElementById("streams-count");
const watchersCount = document.getElementById("watchers-count");
const chattersCount = document.getElementById("chatters-count");
const refreshButton = document.getElementById("refresh-button");
const logoutButton = document.getElementById("logout-button");
const roomDetail = document.getElementById("room-detail");
const detailRoomId = document.getElementById("detail-room-id");
const detailStreamLink = document.getElementById("detail-stream-link");
const settingsForm = document.getElementById("settings-form");
const endStreamButton = document.getElementById("end-stream-button");
const detailParticipants = document.getElementById("detail-participants");

const settingCooldown = document.getElementById("setting-cooldown");
const settingRateWindow = document.getElementById("setting-rate-window");
const settingRateMax = document.getElementById("setting-rate-max");
const settingRepeatWindow = document.getElementById("setting-repeat-window");
const settingRepeatLimit = document.getElementById("setting-repeat-limit");
const settingLinkWindow = document.getElementById("setting-link-window");
const settingLinkMax = document.getElementById("setting-link-max");

let activeRoomId = "";

function formatRelativeTime(timestamp) {
  const diffMs = Date.now() - Number(timestamp || 0);
  const diffMinutes = Math.max(0, Math.round(diffMs / 60000));
  if (diffMinutes < 1) {
    return "just now";
  }
  if (diffMinutes === 1) {
    return "1 minute ago";
  }
  if (diffMinutes < 60) {
    return `${diffMinutes} minutes ago`;
  }

  const diffHours = Math.round(diffMinutes / 60);
  return diffHours === 1 ? "1 hour ago" : `${diffHours} hours ago`;
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  if (response.status === 401) {
    window.location.assign("/admin/login");
    return null;
  }
  return response.json();
}

function renderParticipants(participants) {
  detailParticipants.innerHTML = "";
  participants.forEach((participant) => {
    const item = document.createElement("article");
    item.className = "detail-participant";
    item.innerHTML = `
      <div>
        <strong>${participant.username}</strong>
        <span>${participant.isAdmin ? "Moderator" : "Participant"}</span>
      </div>
      <button type="button" data-session-id="${participant.sessionId}">Kick User</button>
    `;
    detailParticipants.appendChild(item);
  });
}

function fillSettings(settings) {
  settingCooldown.value = settings.messageCooldownMs;
  settingRateWindow.value = settings.rateLimitWindowMs;
  settingRateMax.value = settings.rateLimitMaxMessages;
  settingRepeatWindow.value = settings.repeatedMessageWindowMs;
  settingRepeatLimit.value = settings.repeatedMessageLimit;
  settingLinkWindow.value = settings.linkThrottleWindowMs;
  settingLinkMax.value = settings.linkThrottleMaxLinks;
}

async function loadRoomDetail(roomId) {
  const data = await fetchJson(`/api/admin/rooms/${roomId}`);
  if (!data) {
    return;
  }

  const room = data.room;
  activeRoomId = room.roomId;
  roomDetail.classList.remove("hidden");
  detailRoomId.textContent = room.roomId;
  detailStreamLink.href = room.streamUrl;
  fillSettings(room.settings);
  renderParticipants(room.participants);
}

function renderRooms(rooms) {
  roomsGrid.innerHTML = "";
  emptyState.classList.toggle("hidden", rooms.length > 0);

  const totalWatchers = rooms.reduce((sum, room) => sum + room.watcherCount, 0);
  const totalChatters = rooms.reduce((sum, room) => sum + room.chatCount, 0);

  streamsCount.textContent = String(rooms.length);
  watchersCount.textContent = String(totalWatchers);
  chattersCount.textContent = String(totalChatters);

  rooms.forEach((room) => {
    const card = document.createElement("article");
    card.className = "room-card";
    card.innerHTML = `
      <div class="room-card-top">
        <div>
          <p class="room-label">Stream ID</p>
          <h2>${room.roomId}</h2>
        </div>
        <div class="card-action-group">
          <a class="room-link-pill" href="${room.streamUrl}">Open Stream</a>
          <button type="button" data-manage-room="${room.roomId}">Manage</button>
        </div>
      </div>
      <div class="room-stats">
        <div>
          <span>Watching</span>
          <strong>${room.watcherCount}</strong>
        </div>
        <div>
          <span>In Chat</span>
          <strong>${room.chatCount}</strong>
        </div>
        <div>
          <span>Messages</span>
          <strong>${room.messageCount}</strong>
        </div>
        <div>
          <span>Reports</span>
          <strong>${room.reportsCount}</strong>
        </div>
      </div>
      <p class="room-meta">
        ${room.hasPinnedMessage ? "Pinned message active" : "No pinned message"} • Last active ${formatRelativeTime(room.lastActiveAt)}
      </p>
    `;
    roomsGrid.appendChild(card);
  });
}

async function loadRooms() {
  const data = await fetchJson("/api/admin/rooms");
  if (!data) {
    return;
  }

  renderRooms(data.rooms || []);
  if (activeRoomId) {
    const stillExists = (data.rooms || []).some((room) => room.roomId === activeRoomId);
    if (stillExists) {
      loadRoomDetail(activeRoomId);
    } else {
      activeRoomId = "";
      roomDetail.classList.add("hidden");
    }
  }
}

roomsGrid.addEventListener("click", (event) => {
  const button = event.target.closest("[data-manage-room]");
  if (!button) {
    return;
  }
  loadRoomDetail(button.dataset.manageRoom);
});

settingsForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!activeRoomId) {
    return;
  }

  await fetchJson(`/api/admin/rooms/${activeRoomId}/settings`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messageCooldownMs: Number(settingCooldown.value),
      rateLimitWindowMs: Number(settingRateWindow.value),
      rateLimitMaxMessages: Number(settingRateMax.value),
      repeatedMessageWindowMs: Number(settingRepeatWindow.value),
      repeatedMessageLimit: Number(settingRepeatLimit.value),
      linkThrottleWindowMs: Number(settingLinkWindow.value),
      linkThrottleMaxLinks: Number(settingLinkMax.value),
    }),
  });

  loadRooms();
});

endStreamButton.addEventListener("click", async () => {
  if (!activeRoomId) {
    return;
  }

  await fetchJson(`/api/admin/rooms/${activeRoomId}/end`, {
    method: "POST",
  });

  activeRoomId = "";
  roomDetail.classList.add("hidden");
  loadRooms();
});

detailParticipants.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-session-id]");
  if (!button || !activeRoomId) {
    return;
  }

  await fetchJson(`/api/admin/rooms/${activeRoomId}/kick`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      sessionId: button.dataset.sessionId,
    }),
  });

  loadRoomDetail(activeRoomId);
  loadRooms();
});

refreshButton.addEventListener("click", () => {
  loadRooms();
});

logoutButton.addEventListener("click", async () => {
  await fetch("/admin/logout", { method: "POST" });
  window.location.assign("/admin/login");
});

loadRooms();
window.setInterval(loadRooms, 10000);
