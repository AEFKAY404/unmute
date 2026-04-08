const crypto = require("crypto");

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

function signPayload(secret, payload) {
  return crypto
    .createHmac("sha256", secret)
    .update(payload)
    .digest("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function createModeratorToken({ roomId, expiresAt }, secret) {
  if (!secret) {
    throw new Error("ADMIN_SIGNING_SECRET is required to create moderator links.");
  }

  const payload = JSON.stringify({ roomId, exp: expiresAt });
  const encodedPayload = toBase64Url(payload);
  const signature = signPayload(secret, encodedPayload);
  return `${encodedPayload}.${signature}`;
}

function verifyModeratorToken(token, roomId, secret) {
  if (!token || !secret) {
    return false;
  }

  const [encodedPayload, signature] = String(token).split(".");
  if (!encodedPayload || !signature) {
    return false;
  }

  const expectedSignature = signPayload(secret, encodedPayload);
  const actual = Buffer.from(signature);
  const expected = Buffer.from(expectedSignature);

  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) {
    return false;
  }

  try {
    const payload = JSON.parse(fromBase64Url(encodedPayload));
    const expiresAt = Number(payload.exp);
    return payload.roomId === roomId && Number.isFinite(expiresAt) && Date.now() < expiresAt;
  } catch {
    return false;
  }
}

module.exports = {
  createModeratorToken,
  verifyModeratorToken,
};
