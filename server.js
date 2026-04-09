const path = require("path");
const crypto = require("crypto");
const fs = require("fs");
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const { verifyModeratorToken } = require("./lib/moderator-links");

function loadDotEnvFile() {
  const envPath = path.join(__dirname, ".env");
  if (!fs.existsSync(envPath)) {
    return;
  }

  const content = fs.readFileSync(envPath, "utf8");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const separatorIndex = line.indexOf("=");
    if (separatorIndex === -1) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    if (!key || process.env[key] !== undefined) {
      continue;
    }

    let value = line.slice(separatorIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    process.env[key] = value;
  }
}

loadDotEnvFile();

const app = express();
const server = http.createServer(app);

const NODE_ENV = process.env.NODE_ENV || "development";
const IS_PRODUCTION = NODE_ENV === "production";
const PORT = process.env.PORT || 3000;
const MAX_MESSAGES = 200;
const MAX_ROOMS = 500;
const ROOM_IDLE_TTL_MS = 1000 * 60 * 60 * 6;
const CLEANUP_INTERVAL_MS = 1000 * 60 * 5;
const RATE_LIMIT_WINDOW_MS = 1000 * 10;
const RATE_LIMIT_MAX_MESSAGES = 6;
const MESSAGE_COOLDOWN_MS = 1200;
const REPEATED_MESSAGE_WINDOW_MS = 1000 * 60;
const REPEATED_MESSAGE_LIMIT = 3;
const LINK_THROTTLE_WINDOW_MS = 1000 * 60;
const LINK_THROTTLE_MAX_LINKS = 3;
const DEFAULT_TIMEOUT_MS = 1000 * 60 * 5;
const ADMIN_SIGNING_SECRET = process.env.ADMIN_SIGNING_SECRET || "";
const ADMIN_DASHBOARD_PASSWORD = process.env.ADMIN_DASHBOARD_PASSWORD || "change-me-admin";
const ADMIN_DASHBOARD_SECRET = process.env.ADMIN_DASHBOARD_SECRET || ADMIN_SIGNING_SECRET || "change-dashboard-secret";
const ALLOWED_CLIENT_ORIGINS = String(process.env.ALLOWED_CLIENT_ORIGINS || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
const BLOCKED_WORDS = String(process.env.BLOCKED_WORDS || "")
  .split(",")
  .map((word) => word.trim().toLowerCase())
  .filter(Boolean);

const rooms = new Map();
const publicDir = path.join(__dirname, "public");
const indexPath = path.join(publicDir, "index.html");
const adminLoginPath = path.join(publicDir, "admin-login.html");
const adminDashboardPath = path.join(publicDir, "admin-dashboard.html");
const loginAttemptsByIp = new Map();

function isAllowedClientOrigin(origin) {
  if (!origin) {
    return true;
  }

  if (origin.startsWith("chrome-extension://")) {
    return true;
  }

  if (
    origin === "https://www.youtube.com" ||
    origin === "https://m.youtube.com" ||
    origin === "https://youtube.com"
  ) {
    return true;
  }

  if (
    origin.startsWith("http://localhost:") ||
    origin.startsWith("https://localhost:") ||
    origin.startsWith("http://127.0.0.1:") ||
    origin.startsWith("https://127.0.0.1:")
  ) {
    return true;
  }

  return ALLOWED_CLIENT_ORIGINS.includes(origin);
}

const io = new Server(server, {
  cors: {
    origin(origin, callback) {
      if (isAllowedClientOrigin(origin)) {
        callback(null, true);
        return;
      }

      callback(new Error("Origin not allowed by Socket.IO"));
    },
    methods: ["GET", "POST"],
    credentials: true,
  },
});

app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.set("trust proxy", 1);

function readRequiredEnv(name, fallbackValue) {
  const value = process.env[name] || fallbackValue || "";
  return String(value).trim();
}

function getDeploymentWarnings() {
  const warnings = [];

  if (!process.env.ADMIN_DASHBOARD_PASSWORD || ADMIN_DASHBOARD_PASSWORD === "change-me-admin") {
    warnings.push("ADMIN_DASHBOARD_PASSWORD is using the default value.");
  }

  if (!process.env.ADMIN_DASHBOARD_SECRET || ADMIN_DASHBOARD_SECRET === "change-dashboard-secret") {
    warnings.push("ADMIN_DASHBOARD_SECRET is using the default value.");
  }

  if (!process.env.ADMIN_SIGNING_SECRET) {
    warnings.push("ADMIN_SIGNING_SECRET is not set. Moderator links are disabled.");
  }

  return warnings;
}

function assertProductionEnv() {
  if (!IS_PRODUCTION) {
    return;
  }

  const missing = [];
  if (!process.env.ADMIN_DASHBOARD_PASSWORD || ADMIN_DASHBOARD_PASSWORD === "change-me-admin") {
    missing.push("ADMIN_DASHBOARD_PASSWORD");
  }
  if (!process.env.ADMIN_DASHBOARD_SECRET || ADMIN_DASHBOARD_SECRET === "change-dashboard-secret") {
    missing.push("ADMIN_DASHBOARD_SECRET");
  }

  if (missing.length > 0) {
    throw new Error(`Refusing to start in production without secure env vars: ${missing.join(", ")}`);
  }
}

function createRoomSettings() {
  return {
    rateLimitWindowMs: RATE_LIMIT_WINDOW_MS,
    rateLimitMaxMessages: RATE_LIMIT_MAX_MESSAGES,
    messageCooldownMs: MESSAGE_COOLDOWN_MS,
    repeatedMessageWindowMs: REPEATED_MESSAGE_WINDOW_MS,
    repeatedMessageLimit: REPEATED_MESSAGE_LIMIT,
    linkThrottleWindowMs: LINK_THROTTLE_WINDOW_MS,
    linkThrottleMaxLinks: LINK_THROTTLE_MAX_LINKS,
  };
}

function createRoomState() {
  return {
    history: [],
    pinnedMessage: null,
    reports: [],
    settings: createRoomSettings(),
    endedAt: 0,
    participants: new Map(),
    watcherSessionIdsBySocketId: new Map(),
    mutedSessionIds: new Set(),
    bannedSessionIds: new Set(),
    timeoutUntilBySessionId: new Map(),
    typingBySessionId: new Map(),
    recentMessageTimestampsBySessionId: new Map(),
    recentMessageBodiesBySessionId: new Map(),
    recentLinkTimestampsBySessionId: new Map(),
    lastActiveAt: Date.now(),
  };
}

function cleanupRoomState(room) {
  const now = Date.now();

  for (const [sessionId, timeoutUntil] of room.timeoutUntilBySessionId) {
    if (timeoutUntil <= now) {
      room.timeoutUntilBySessionId.delete(sessionId);
    }
  }

  for (const [sessionId, timestamps] of room.recentMessageTimestampsBySessionId) {
    const nextTimestamps = timestamps.filter((timestamp) => now - timestamp <= RATE_LIMIT_WINDOW_MS);
    if (nextTimestamps.length > 0) {
      room.recentMessageTimestampsBySessionId.set(sessionId, nextTimestamps);
    } else {
      room.recentMessageTimestampsBySessionId.delete(sessionId);
    }
  }

  for (const [sessionId, records] of room.recentMessageBodiesBySessionId) {
    const nextRecords = records.filter((record) => now - record.timestamp <= REPEATED_MESSAGE_WINDOW_MS);
    if (nextRecords.length > 0) {
      room.recentMessageBodiesBySessionId.set(sessionId, nextRecords);
    } else {
      room.recentMessageBodiesBySessionId.delete(sessionId);
    }
  }

  for (const [sessionId, timestamps] of room.recentLinkTimestampsBySessionId) {
    const nextTimestamps = timestamps.filter((timestamp) => now - timestamp <= LINK_THROTTLE_WINDOW_MS);
    if (nextTimestamps.length > 0) {
      room.recentLinkTimestampsBySessionId.set(sessionId, nextTimestamps);
    } else {
      room.recentLinkTimestampsBySessionId.delete(sessionId);
    }
  }
}

function getRoomState(roomId) {
  let room = rooms.get(roomId);

  if (!room) {
    if (rooms.size >= MAX_ROOMS) {
      cleanupRooms(true);
    }

    room = createRoomState();
    rooms.set(roomId, room);
  }

  cleanupRoomState(room);
  room.lastActiveAt = Date.now();
  return room;
}

function cleanupRooms(forceOldestRemoval = false) {
  const now = Date.now();

  for (const [roomId, room] of rooms) {
    cleanupRoomState(room);
    const hasParticipants = room.participants.size > 0;
    const isIdle = now - room.lastActiveAt > ROOM_IDLE_TTL_MS;

    if (!hasParticipants && (isIdle || forceOldestRemoval)) {
      rooms.delete(roomId);
      if (forceOldestRemoval) {
        return;
      }
    }
  }
}

function getParticipantCount(roomId) {
  const room = rooms.get(roomId);
  if (!room) {
    return 0;
  }

  const sessionIds = new Set(room.watcherSessionIdsBySocketId.values());
  for (const participant of room.participants.values()) {
    sessionIds.add(participant.sessionId);
  }
  return sessionIds.size;
}

function getTypingNames(roomId) {
  const room = rooms.get(roomId);
  if (!room) {
    return [];
  }

  cleanupRoomState(room);
  return [...room.typingBySessionId.values()].slice(0, 3);
}

function emitPresence(roomId) {
  io.to(roomId).emit("room-stats", {
    participantCount: getParticipantCount(roomId),
    typingNames: getTypingNames(roomId),
  });
}

function emitParticipantList(roomId) {
  const room = rooms.get(roomId);
  if (!room) {
    return;
  }

  const now = Date.now();
  const participants = [...room.participants.values()].map((participant) => {
    const timeoutUntil = room.timeoutUntilBySessionId.get(participant.sessionId) || 0;
    return {
      sessionId: participant.sessionId,
      username: participant.username,
      profileColor: participant.profileColor,
      isMuted: room.mutedSessionIds.has(participant.sessionId),
      isAdmin: participant.isAdmin,
      isTimedOut: timeoutUntil > now,
      timeoutRemainingMs: Math.max(0, timeoutUntil - now),
    };
  });

  io.to(roomId).emit("participants-update", participants);
}

function emitPinnedMessage(roomId) {
  const room = rooms.get(roomId);
  io.to(roomId).emit("pinned-message", room ? room.pinnedMessage : null);
}

function emitReports(roomId) {
  const room = rooms.get(roomId);
  if (!room) {
    return;
  }

  io.to(roomId).emit("reports-update", room.reports);
}

function emitSystemMessage(roomId, text) {
  io.to(roomId).emit("system-message", {
    id: crypto.randomUUID(),
    text,
    timestamp: new Date().toISOString(),
  });
}

function stopTyping(socket) {
  const roomId = socket.data.roomId;
  const sessionId = socket.data.sessionId;
  if (!roomId || !sessionId) {
    return;
  }

  const room = rooms.get(roomId);
  if (!room) {
    return;
  }

  if (room.typingBySessionId.delete(sessionId)) {
    emitPresence(roomId);
  }
}

function leaveCurrentRoom(socket, shouldNotify = true) {
  const currentRoomId = socket.data.roomId;
  const currentSessionId = socket.data.sessionId;
  const currentUsername = socket.data.username;

  if (!currentRoomId || !currentSessionId) {
    return;
  }

  const room = rooms.get(currentRoomId);
  if (room) {
    room.participants.delete(socket.id);
    room.typingBySessionId.delete(currentSessionId);
    room.lastActiveAt = Date.now();

    if (shouldNotify && currentUsername) {
      emitSystemMessage(currentRoomId, `${currentUsername} left the chat`);
    }

    emitPresence(currentRoomId);
    emitParticipantList(currentRoomId);

    if (room.participants.size === 0 && room.history.length === 0) {
      rooms.delete(currentRoomId);
    }
  }

  socket.leave(currentRoomId);
  delete socket.data.roomId;
  delete socket.data.username;
  delete socket.data.isAdmin;
}

function leaveCurrentWatch(socket) {
  const watchRoomId = socket.data.watchRoomId;
  if (!watchRoomId) {
    return;
  }

  const room = rooms.get(watchRoomId);
  if (room) {
    room.watcherSessionIdsBySocketId.delete(socket.id);
    room.lastActiveAt = Date.now();
    emitPresence(watchRoomId);
    if (room.participants.size === 0 && room.history.length === 0 && room.watcherSessionIdsBySocketId.size === 0) {
      rooms.delete(watchRoomId);
    }
  }

  delete socket.data.watchRoomId;
}

function getTimeoutRemaining(room, sessionId) {
  const timeoutUntil = room.timeoutUntilBySessionId.get(sessionId) || 0;
  return Math.max(0, timeoutUntil - Date.now());
}

function serializeRoom(roomId, room) {
  const watcherCount = getParticipantCount(roomId);
  const chatCount = room.participants.size;
  return {
    roomId,
    streamUrl: `/stream/${roomId}`,
    watcherCount,
    chatCount,
    messageCount: room.history.length,
    reportsCount: room.reports.length,
    hasPinnedMessage: Boolean(room.pinnedMessage),
    lastActiveAt: room.lastActiveAt,
    endedAt: room.endedAt || 0,
  };
}

function serializeRoomDetail(roomId, room) {
  const participants = [...room.participants.values()].map((participant) => ({
    sessionId: participant.sessionId,
    username: participant.username,
    profileColor: participant.profileColor,
    isAdmin: participant.isAdmin,
  }));

  return {
    ...serializeRoom(roomId, room),
    settings: room.settings,
    participants,
  };
}

function removeSessionFromRoom(roomId, sessionId, reason) {
  const room = rooms.get(roomId);
  if (!room) {
    return;
  }

  room.typingBySessionId.delete(sessionId);
  room.timeoutUntilBySessionId.delete(sessionId);

  for (const participant of room.participants.values()) {
    if (participant.sessionId === sessionId) {
      const targetSocket = io.sockets.sockets.get(participant.socketId);
      if (targetSocket) {
        if (reason) {
          targetSocket.emit("system-error", reason);
        }
        leaveCurrentRoom(targetSocket, false);
      }
    }
  }

  for (const [socketId, watcherSessionId] of room.watcherSessionIdsBySocketId) {
    if (watcherSessionId === sessionId) {
      room.watcherSessionIdsBySocketId.delete(socketId);
    }
  }

  emitPresence(roomId);
  emitParticipantList(roomId);
}

function endRoom(roomId) {
  const room = rooms.get(roomId);
  if (!room) {
    return;
  }

  room.endedAt = Date.now();
  room.lastActiveAt = Date.now();
  io.to(roomId).emit("room-ended", {
    text: "This stream chat has been ended by an admin.",
    endedAt: room.endedAt,
  });

  for (const participant of room.participants.values()) {
    const targetSocket = io.sockets.sockets.get(participant.socketId);
    if (targetSocket) {
      leaveCurrentRoom(targetSocket, false);
    }
  }
  room.watcherSessionIdsBySocketId.clear();
}

function containsBlockedWord(text) {
  const normalized = String(text).toLowerCase();
  return BLOCKED_WORDS.find((blockedWord) => normalized.includes(blockedWord)) || "";
}

function toBase64Url(input) {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function fromBase64Url(input) {
  const normalized = String(input)
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  const padding = normalized.length % 4 === 0 ? "" : "=".repeat(4 - (normalized.length % 4));
  return Buffer.from(`${normalized}${padding}`, "base64").toString("utf8");
}

function signValue(secret, value) {
  return crypto
    .createHmac("sha256", secret)
    .update(value)
    .digest("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function parseCookies(cookieHeader) {
  return String(cookieHeader || "")
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .reduce((acc, part) => {
      const separatorIndex = part.indexOf("=");
      if (separatorIndex === -1) {
        return acc;
      }

      const key = part.slice(0, separatorIndex);
      const value = part.slice(separatorIndex + 1);
      acc[key] = decodeURIComponent(value);
      return acc;
    }, {});
}

function getCookieOptions(maxAgeSeconds) {
  const parts = [
    "HttpOnly",
    "Path=/",
    "SameSite=Lax",
    `Max-Age=${maxAgeSeconds}`,
  ];

  if (IS_PRODUCTION) {
    parts.push("Secure");
  }

  return parts.join("; ");
}

function createAdminSessionToken() {
  const payload = JSON.stringify({
    role: "admin",
    exp: Date.now() + 1000 * 60 * 60 * 12,
  });
  const encodedPayload = toBase64Url(payload);
  const signature = signValue(ADMIN_DASHBOARD_SECRET, encodedPayload);
  return `${encodedPayload}.${signature}`;
}

function verifyAdminSessionToken(token) {
  if (!token) {
    return false;
  }

  const [encodedPayload, signature] = String(token).split(".");
  if (!encodedPayload || !signature) {
    return false;
  }

  const expectedSignature = signValue(ADMIN_DASHBOARD_SECRET, encodedPayload);
  const actual = Buffer.from(signature);
  const expected = Buffer.from(expectedSignature);
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) {
    return false;
  }

  try {
    const payload = JSON.parse(fromBase64Url(encodedPayload));
    return payload.role === "admin" && Number(payload.exp) > Date.now();
  } catch {
    return false;
  }
}

function requireAdmin(req, res, next) {
  const cookies = parseCookies(req.headers.cookie);
  if (!verifyAdminSessionToken(cookies.streamside_admin_session)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  next();
}

function getRoomSummaries() {
  const summaries = [];

  for (const [roomId, room] of rooms) {
    const summary = serializeRoom(roomId, room);
    if (summary.watcherCount === 0 && summary.chatCount === 0) {
      continue;
    }

    summaries.push(summary);
  }

  return summaries.sort((a, b) => b.lastActiveAt - a.lastActiveAt);
}

function recordLoginAttempt(ipAddress, wasSuccessful) {
  const now = Date.now();
  const key = String(ipAddress || "unknown");
  const existing = (loginAttemptsByIp.get(key) || []).filter((timestamp) => now - timestamp < 15 * 60 * 1000);

  if (!wasSuccessful) {
    existing.push(now);
  }

  if (existing.length > 0) {
    loginAttemptsByIp.set(key, existing);
  } else {
    loginAttemptsByIp.delete(key);
  }
}

function isLoginRateLimited(ipAddress) {
  const now = Date.now();
  const key = String(ipAddress || "unknown");
  const existing = (loginAttemptsByIp.get(key) || []).filter((timestamp) => now - timestamp < 15 * 60 * 1000);
  if (existing.length > 0) {
    loginAttemptsByIp.set(key, existing);
  } else {
    loginAttemptsByIp.delete(key);
  }

  return existing.length >= 10;
}

setInterval(() => {
  cleanupRooms(false);
}, CLEANUP_INTERVAL_MS).unref();

app.use(express.static(publicDir));

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    env: NODE_ENV,
    uptimeSeconds: Math.round(process.uptime()),
  });
});

app.get("/", (_req, res) => {
  res.sendFile(indexPath);
});

app.get("/stream/:videoId", (_req, res) => {
  res.sendFile(indexPath);
});

app.get("/admin/login", (_req, res) => {
  res.sendFile(adminLoginPath);
});

app.get("/admin", (req, res) => {
  const cookies = parseCookies(req.headers.cookie);
  if (!verifyAdminSessionToken(cookies.streamside_admin_session)) {
    res.redirect("/admin/login");
    return;
  }

  res.sendFile(adminDashboardPath);
});

app.post("/admin/login", (req, res) => {
  const ipAddress = req.ip || req.socket.remoteAddress || "unknown";
  if (isLoginRateLimited(ipAddress)) {
    res.status(429).json({ error: "Too many login attempts. Please try again later." });
    return;
  }

  const password = String(req.body?.password || "");
  if (password !== ADMIN_DASHBOARD_PASSWORD) {
    recordLoginAttempt(ipAddress, false);
    res.status(401).json({ error: "Invalid password" });
    return;
  }

  recordLoginAttempt(ipAddress, true);
  const sessionToken = createAdminSessionToken();
  res.setHeader(
    "Set-Cookie",
    `streamside_admin_session=${encodeURIComponent(sessionToken)}; ${getCookieOptions(43200)}`
  );
  res.json({ ok: true });
});

app.post("/admin/logout", (_req, res) => {
  res.setHeader(
    "Set-Cookie",
    `streamside_admin_session=; ${getCookieOptions(0)}`
  );
  res.json({ ok: true });
});

app.get("/api/admin/rooms", requireAdmin, (_req, res) => {
  res.json({ rooms: getRoomSummaries() });
});

app.get("/api/admin/rooms/:roomId", requireAdmin, (req, res) => {
  const room = rooms.get(String(req.params.roomId || "").trim());
  if (!room) {
    res.status(404).json({ error: "Room not found" });
    return;
  }

  res.json({ room: serializeRoomDetail(req.params.roomId, room) });
});

app.post("/api/admin/rooms/:roomId/settings", requireAdmin, (req, res) => {
  const roomId = String(req.params.roomId || "").trim();
  const room = rooms.get(roomId);
  if (!room) {
    res.status(404).json({ error: "Room not found" });
    return;
  }

  room.settings = {
    rateLimitWindowMs: Math.max(1000, Number(req.body?.rateLimitWindowMs) || room.settings.rateLimitWindowMs),
    rateLimitMaxMessages: Math.max(1, Number(req.body?.rateLimitMaxMessages) || room.settings.rateLimitMaxMessages),
    messageCooldownMs: Math.max(0, Number(req.body?.messageCooldownMs) || room.settings.messageCooldownMs),
    repeatedMessageWindowMs: Math.max(1000, Number(req.body?.repeatedMessageWindowMs) || room.settings.repeatedMessageWindowMs),
    repeatedMessageLimit: Math.max(1, Number(req.body?.repeatedMessageLimit) || room.settings.repeatedMessageLimit),
    linkThrottleWindowMs: Math.max(1000, Number(req.body?.linkThrottleWindowMs) || room.settings.linkThrottleWindowMs),
    linkThrottleMaxLinks: Math.max(1, Number(req.body?.linkThrottleMaxLinks) || room.settings.linkThrottleMaxLinks),
  };
  room.lastActiveAt = Date.now();

  io.to(roomId).emit("room-settings", room.settings);
  res.json({ room: serializeRoomDetail(roomId, room) });
});

app.post("/api/admin/rooms/:roomId/end", requireAdmin, (req, res) => {
  const roomId = String(req.params.roomId || "").trim();
  const room = rooms.get(roomId);
  if (!room) {
    res.status(404).json({ error: "Room not found" });
    return;
  }

  endRoom(roomId);
  res.json({ ok: true });
});

app.post("/api/admin/rooms/:roomId/kick", requireAdmin, (req, res) => {
  const roomId = String(req.params.roomId || "").trim();
  const sessionId = String(req.body?.sessionId || "").trim();
  const room = rooms.get(roomId);
  if (!room || !sessionId) {
    res.status(404).json({ error: "Room or participant not found" });
    return;
  }

  removeSessionFromRoom(roomId, sessionId, "You were removed from this stream by an admin.");
  res.json({ room: serializeRoomDetail(roomId, room) });
});

io.on("connection", (socket) => {
  socket.on("watch-room", ({ roomId, sessionId }) => {
    const safeRoomId = String(roomId || "").trim();
    const safeSessionId = String(sessionId || "").trim().slice(0, 64);

    if (!safeRoomId || !safeSessionId) {
      return;
    }

    leaveCurrentWatch(socket);

    const room = getRoomState(safeRoomId);
    if (room.endedAt) {
      socket.emit("room-ended", {
        text: "This stream chat has already ended.",
        endedAt: room.endedAt,
      });
      return;
    }
    room.watcherSessionIdsBySocketId.set(socket.id, safeSessionId);
    socket.data.watchRoomId = safeRoomId;
    emitPresence(safeRoomId);
  });

  socket.on("join-room", ({ roomId, username, sessionId, moderatorToken, profileColor }) => {
    const safeRoomId = String(roomId || "").trim();
    const safeUsername = String(username || "Guest").trim().slice(0, 30) || "Guest";
    const safeSessionId = String(sessionId || "").trim().slice(0, 64);
    const safeModeratorToken = String(moderatorToken || "").trim();

    if (!safeRoomId || !safeSessionId) {
      socket.emit("system-error", "A valid room ID and session are required.");
      return;
    }

    leaveCurrentRoom(socket, false);

    const room = getRoomState(safeRoomId);
    if (room.endedAt) {
      socket.emit("join-denied", "This stream chat has ended.");
      socket.emit("room-ended", {
        text: "This stream chat has ended.",
        endedAt: room.endedAt,
      });
      return;
    }
    if (room.bannedSessionIds.has(safeSessionId)) {
      socket.emit("join-denied", "You have been banned from this stream chat.");
      return;
    }

    const isAdmin = verifyModeratorToken(safeModeratorToken, safeRoomId, ADMIN_SIGNING_SECRET);

    const safeProfileColor = String(profileColor || "").trim().slice(0, 32);

    socket.data.roomId = safeRoomId;
    socket.data.username = safeUsername;
    socket.data.sessionId = safeSessionId;
    socket.data.isAdmin = isAdmin;
    socket.data.profileColor = safeProfileColor;

    socket.join(safeRoomId);
    room.participants.set(socket.id, {
      socketId: socket.id,
      sessionId: safeSessionId,
      username: safeUsername,
      profileColor: safeProfileColor,
      isAdmin,
    });

    socket.emit("chat-history", room.history);
    socket.emit("pinned-message", room.pinnedMessage);
    socket.emit("room-settings", room.settings);
    socket.emit("admin-state", {
      isAdmin,
      moderatorLinksConfigured: Boolean(ADMIN_SIGNING_SECRET),
    });
    if (isAdmin) {
      socket.emit("reports-update", room.reports);
    }

    emitPresence(safeRoomId);
    emitParticipantList(safeRoomId);
    emitSystemMessage(safeRoomId, `${safeUsername} joined the chat`);
  });

  socket.on("chat-message", (text) => {
    const roomId = socket.data.roomId;
    const username = socket.data.username;
    const sessionId = socket.data.sessionId;

    if (!roomId || !username || !sessionId) {
      socket.emit("system-error", "Join a room before sending messages.");
      return;
    }

    const room = rooms.get(roomId);
    if (!room) {
      socket.emit("system-error", "That room is no longer active.");
      return;
    }

    if (room.endedAt) {
      socket.emit("system-error", "This stream chat has ended.");
      return;
    }

    if (room.bannedSessionIds.has(sessionId)) {
      socket.emit("join-denied", "You have been banned from this stream chat.");
      leaveCurrentRoom(socket, false);
      return;
    }

    const timeoutRemainingMs = getTimeoutRemaining(room, sessionId);
    if (timeoutRemainingMs > 0) {
      socket.emit("system-error", `You are timed out for another ${Math.ceil(timeoutRemainingMs / 1000)} seconds.`);
      return;
    }

    if (room.mutedSessionIds.has(sessionId)) {
      socket.emit("system-error", "You are muted in this stream chat.");
      return;
    }

    const safeText = String(text || "").trim().slice(0, 500);
    if (!safeText) {
      return;
    }

    const blockedWord = containsBlockedWord(safeText);
    if (blockedWord) {
      socket.emit("system-error", "That message contains a blocked word and was not sent.");
      return;
    }

    const now = Date.now();
    const settings = room.settings || createRoomSettings();
    const recentTimestamps = (room.recentMessageTimestampsBySessionId.get(sessionId) || [])
      .filter((timestamp) => now - timestamp <= settings.rateLimitWindowMs);
    const lastMessageAt = recentTimestamps[recentTimestamps.length - 1] || 0;
    if (lastMessageAt && now - lastMessageAt < settings.messageCooldownMs) {
      socket.emit("system-error", "You are sending messages too quickly. Please wait a moment.");
      return;
    }

    if (recentTimestamps.length >= settings.rateLimitMaxMessages) {
      socket.emit("system-error", "You are sending messages too quickly. Please slow down.");
      return;
    }

    recentTimestamps.push(now);
    room.recentMessageTimestampsBySessionId.set(sessionId, recentTimestamps);

    const normalizedText = safeText.toLowerCase().replace(/\s+/g, " ").trim();
    const repeatedRecords = (room.recentMessageBodiesBySessionId.get(sessionId) || [])
      .filter((record) => now - record.timestamp <= settings.repeatedMessageWindowMs);
    const repeatedCount = repeatedRecords.filter((record) => record.body === normalizedText).length;
    if (repeatedCount >= settings.repeatedMessageLimit) {
      socket.emit("system-error", "Repeated messages are being blocked. Please vary your message.");
      return;
    }
    repeatedRecords.push({ body: normalizedText, timestamp: now });
    room.recentMessageBodiesBySessionId.set(sessionId, repeatedRecords);

    const linkMatches = safeText.match(/https?:\/\/|www\./gi) || [];
    if (linkMatches.length > 0) {
      const linkTimestamps = (room.recentLinkTimestampsBySessionId.get(sessionId) || [])
        .filter((timestamp) => now - timestamp <= settings.linkThrottleWindowMs);
      if (linkTimestamps.length + linkMatches.length > settings.linkThrottleMaxLinks) {
        socket.emit("system-error", "Too many links sent recently. Please slow down on link sharing.");
        return;
      }
      for (let i = 0; i < linkMatches.length; i += 1) {
        linkTimestamps.push(now);
      }
      room.recentLinkTimestampsBySessionId.set(sessionId, linkTimestamps);
    }

    const message = {
      id: crypto.randomUUID(),
      sessionId,
      username,
      profileColor: socket.data.profileColor,
      text: safeText,
      timestamp: new Date().toISOString(),
    };

    room.history.push(message);
    if (room.history.length > MAX_MESSAGES) {
      room.history.shift();
    }

    room.typingBySessionId.delete(sessionId);
    room.lastActiveAt = now;

    io.to(roomId).emit("chat-message", message);
    emitPresence(roomId);
  });

  socket.on("typing-state", ({ isTyping }) => {
    const roomId = socket.data.roomId;
    const sessionId = socket.data.sessionId;
    const username = socket.data.username;
    if (!roomId || !sessionId || !username) {
      return;
    }

    const room = rooms.get(roomId);
    if (!room) {
      return;
    }

    if (isTyping) {
      room.typingBySessionId.set(sessionId, username);
    } else {
      room.typingBySessionId.delete(sessionId);
    }

    emitPresence(roomId);
  });

  socket.on("moderation-action", ({ action, targetSessionId, messageId, durationMs, text }) => {
    const roomId = socket.data.roomId;
    if (!roomId || !socket.data.isAdmin) {
      socket.emit("system-error", "Moderator access is required for moderation.");
      return;
    }

    const room = rooms.get(roomId);
    if (!room) {
      socket.emit("system-error", "That room is no longer active.");
      return;
    }

    const safeAction = String(action || "").trim();
    const safeTargetSessionId = String(targetSessionId || "").trim();
    const safeMessageId = String(messageId || "").trim();
    const safeText = String(text || "").trim().slice(0, 280);

    if (safeAction === "delete-message" && safeMessageId) {
      const nextHistory = room.history.filter((message) => message.id !== safeMessageId);
      if (nextHistory.length !== room.history.length) {
        room.history = nextHistory;
        room.reports = room.reports.filter((report) => report.messageId !== safeMessageId);
        room.lastActiveAt = Date.now();
        io.to(roomId).emit("message-deleted", { messageId: safeMessageId });
        emitReports(roomId);
      }
      return;
    }

    if (safeAction === "clear-chat") {
      room.history = [];
      room.pinnedMessage = null;
      room.reports = [];
      room.lastActiveAt = Date.now();
      io.to(roomId).emit("history-replaced", room.history);
      emitPinnedMessage(roomId);
      emitReports(roomId);
      emitSystemMessage(roomId, "The chat was cleared by a moderator.");
      return;
    }

    if (safeAction === "pin-message" && safeText) {
      room.pinnedMessage = {
        id: crypto.randomUUID(),
        text: safeText,
        createdBy: socket.data.username,
        timestamp: new Date().toISOString(),
      };
      room.lastActiveAt = Date.now();
      emitPinnedMessage(roomId);
      emitSystemMessage(roomId, "A pinned announcement was updated by a moderator.");
      return;
    }

    if (safeAction === "clear-pinned-message") {
      room.pinnedMessage = null;
      room.lastActiveAt = Date.now();
      emitPinnedMessage(roomId);
      emitSystemMessage(roomId, "The pinned announcement was removed by a moderator.");
      return;
    }

    if (safeAction === "dismiss-report") {
      room.reports = room.reports.filter((report) => report.id !== safeMessageId);
      emitReports(roomId);
      return;
    }

    if (!safeTargetSessionId) {
      socket.emit("system-error", "A valid participant is required.");
      return;
    }

    if (safeAction === "mute-user") {
      room.mutedSessionIds.add(safeTargetSessionId);
      emitParticipantList(roomId);
      emitSystemMessage(roomId, "A participant was muted by a moderator.");
      return;
    }

    if (safeAction === "unmute-user") {
      room.mutedSessionIds.delete(safeTargetSessionId);
      emitParticipantList(roomId);
      emitSystemMessage(roomId, "A participant was unmuted by a moderator.");
      return;
    }

    if (safeAction === "timeout-user") {
      room.timeoutUntilBySessionId.set(
        safeTargetSessionId,
        Date.now() + Math.max(1000, Number(durationMs) || DEFAULT_TIMEOUT_MS)
      );
      room.typingBySessionId.delete(safeTargetSessionId);
      emitPresence(roomId);
      emitParticipantList(roomId);
      emitSystemMessage(roomId, "A participant was timed out by a moderator.");
      return;
    }

    if (safeAction === "clear-timeout-user") {
      room.timeoutUntilBySessionId.delete(safeTargetSessionId);
      emitParticipantList(roomId);
      emitSystemMessage(roomId, "A participant timeout was cleared by a moderator.");
      return;
    }

    if (safeAction === "ban-user") {
      room.bannedSessionIds.add(safeTargetSessionId);
      room.mutedSessionIds.add(safeTargetSessionId);
      room.timeoutUntilBySessionId.delete(safeTargetSessionId);
      room.typingBySessionId.delete(safeTargetSessionId);
      room.history = room.history.filter((message) => message.sessionId !== safeTargetSessionId);
      io.to(roomId).emit("history-replaced", room.history);

      for (const participant of room.participants.values()) {
        if (participant.sessionId === safeTargetSessionId) {
          const targetSocket = io.sockets.sockets.get(participant.socketId);
          if (targetSocket) {
            targetSocket.emit("join-denied", "You have been banned from this stream chat.");
            leaveCurrentRoom(targetSocket, false);
          }
        }
      }

      emitPresence(roomId);
      emitParticipantList(roomId);
      emitSystemMessage(roomId, "A participant was banned by a moderator.");
      return;
    }

    socket.emit("system-error", "Unknown moderation action.");
  });

  socket.on("report-message", ({ messageId, reason }) => {
    const roomId = socket.data.roomId;
    const sessionId = socket.data.sessionId;
    const username = socket.data.username;
    if (!roomId || !sessionId || !username) {
      return;
    }

    const room = rooms.get(roomId);
    if (!room || !messageId) {
      return;
    }

    const message = room.history.find((entry) => entry.id === messageId);
    if (!message || message.sessionId === sessionId) {
      return;
    }

    const alreadyReported = room.reports.some(
      (report) => report.messageId === messageId && report.reportedBySessionId === sessionId
    );
    if (alreadyReported) {
      socket.emit("system-error", "You already reported that message.");
      return;
    }

    room.reports.unshift({
      id: crypto.randomUUID(),
      messageId,
      messageText: message.text,
      messageUsername: message.username,
      reportedBySessionId: sessionId,
      reportedByUsername: username,
      reason: String(reason || "Abusive or inappropriate").trim().slice(0, 120) || "Abusive or inappropriate",
      timestamp: new Date().toISOString(),
    });
    room.reports = room.reports.slice(0, 100);
    emitReports(roomId);
    socket.emit("system-message", {
      id: crypto.randomUUID(),
      text: "Your report was sent to moderators.",
      timestamp: new Date().toISOString(),
    });
  });

  socket.on("disconnect", () => {
    stopTyping(socket);
    leaveCurrentRoom(socket, true);
    leaveCurrentWatch(socket);
  });
});

assertProductionEnv();
const deploymentWarnings = getDeploymentWarnings();

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running at http://0.0.0.0:${PORT}`);
  console.log(
    `Environment: ${NODE_ENV}`
  );
  console.log(
    `Moderator links are ${ADMIN_SIGNING_SECRET ? "configured." : "disabled. Set ADMIN_SIGNING_SECRET before production."}`
  );
  if (deploymentWarnings.length > 0) {
    for (const warning of deploymentWarnings) {
      console.warn(`Warning: ${warning}`);
    }
  }
});
