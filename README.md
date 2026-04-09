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

## Render Setup

This repo now includes [render.yaml](/c:/Users/akash/Desktop/workspace/render.yaml) for a single-instance Render web service.

### Recommended Shape

- One Render `web service`
- One instance only
- No horizontal scaling yet

This matters because room state and chat history are currently kept in memory. If you run multiple instances, users can get split across separate live chat states.

### Deploy Steps

1. Push the repo to GitHub.
2. In Render, create a new service from this repo.
3. Render can detect [render.yaml](/c:/Users/akash/Desktop/workspace/render.yaml) automatically, or you can create the web service manually with:
   - Build command: `npm install`
   - Start command: `npm start`
   - Health check path: `/health`
4. Set or confirm these environment variables:
   - `NODE_ENV=production`
   - `ADMIN_DASHBOARD_PASSWORD`
   - `ADMIN_DASHBOARD_SECRET`
   - `ADMIN_SIGNING_SECRET`
5. Optional:
   - `BLOCKED_WORDS`
   - `ALLOWED_CLIENT_ORIGINS`
6. Deploy the service.
7. After deploy, verify:
   - `https://your-service.onrender.com/health`
   - `https://your-service.onrender.com/admin/login`

### Extension Setup After Deploy

Once Render gives you your public URL, open the Chrome extension popup and set:

- `Backend URL=https://your-service.onrender.com`

Then every extension user who points to that same Render URL will join the same chat backend and the same room for the same YouTube stream.

### Official Render Notes

Render web services support Node apps and WebSocket connections:

- https://render.com/docs/web-services
- https://render.com/docs/websocket

## Production Notes

- The app refuses to start in production if secure admin env vars are missing.
- Local `.env` loading is for development convenience only.
- Admin cookies are marked `Secure` in production.
- Admin login attempts are rate-limited.
- Chat history remains in memory only and is lost on restart.
