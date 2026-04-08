# StreamSide Chat

Custom live chat for embedded YouTube stream pages, with moderation, admin dashboard, and room controls.

## Local Run

1. Install dependencies:
```powershell
npm install
```

2. Create a local `.env` file from `.env.example`:
```powershell
Copy-Item .env.example .env
```

3. Edit `.env` with your local values.

4. Start the app:
```powershell
npm start
```

5. Open:
- `http://localhost:3000/`
- `http://localhost:3000/admin/login`

## Required Environment Variables

For production, set all of these in your hosting platform's environment-variable settings:

- `NODE_ENV=production`
- `PORT=3000`
- `ADMIN_DASHBOARD_PASSWORD`
- `ADMIN_DASHBOARD_SECRET`
- `ADMIN_SIGNING_SECRET`

Optional:

- `BLOCKED_WORDS`

## Local `.env` Example

The server now auto-loads `.env` for local development.

```env
NODE_ENV=development
PORT=3000
ADMIN_DASHBOARD_PASSWORD=replace-with-a-strong-password
ADMIN_DASHBOARD_SECRET=replace-with-a-long-random-secret
ADMIN_SIGNING_SECRET=replace-with-a-long-random-secret
BLOCKED_WORDS=word1,word2
```

## PowerShell Environment Variable Example

```powershell
setx NODE_ENV "production"
setx PORT "3000"
setx ADMIN_DASHBOARD_PASSWORD "replace-with-a-strong-password"
setx ADMIN_DASHBOARD_SECRET "replace-with-a-long-random-secret"
setx ADMIN_SIGNING_SECRET "replace-with-a-long-random-secret"
setx BLOCKED_WORDS "word1,word2"
```

Restart the terminal after using `setx`, then restart the app.

## Deployment Checklist

1. Use a single stable server instance first.
2. Put the app behind HTTPS.
3. Set `NODE_ENV=production` in the deployment environment.
4. Set strong values for dashboard and moderator secrets.
5. Verify `/health` returns `200`.
6. Verify admin login works at `/admin/login`.
7. Generate signed moderator links with:

```powershell
npm run generate:mod-link -- <videoId> https://your-domain.com 24
```

## Recommended Hosting Shape

- One Node.js server
- Reverse proxy or platform HTTPS in front
- Persistent process manager or managed host

Examples:

- Render web service
- Railway
- Fly.io
- VPS with Nginx + PM2

## Production Notes

- The app refuses to start in production if secure admin env vars are missing.
- Local `.env` loading is for development convenience only.
- Admin cookies are marked `Secure` in production.
- Admin login attempts are rate-limited.
- Chat history remains in memory only and is lost on restart.
