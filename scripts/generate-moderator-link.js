const { createModeratorToken } = require("../lib/moderator-links");

const roomId = process.argv[2];
const baseUrl = process.argv[3] || "http://localhost:3000";
const hours = Number(process.argv[4] || 24);
const secret = process.env.ADMIN_SIGNING_SECRET;

if (!roomId) {
  console.error("Usage: npm run generate:mod-link -- <videoId> [baseUrl] [hours]");
  process.exit(1);
}

if (!secret) {
  console.error("Set ADMIN_SIGNING_SECRET before generating moderator links.");
  process.exit(1);
}

const expiresAt = Date.now() + hours * 60 * 60 * 1000;
const token = createModeratorToken({ roomId, expiresAt }, secret);
const url = `${baseUrl.replace(/\/$/, "")}/stream/${encodeURIComponent(roomId)}?mod=${encodeURIComponent(token)}`;

console.log(url);
