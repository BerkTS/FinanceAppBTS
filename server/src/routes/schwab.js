import { Router } from "express";
import {
  buildSchwabAuthorizeUrl,
  exchangeSchwabCode,
} from "../services/schwab.js";

export const schwabRouter = Router();

/** Demo only: store tokens in memory. Use Redis + encrypted refresh in production. */
const tokenCache = new Map();

export function getSchwabTokenForSession(sessionId) {
  return tokenCache.get(sessionId || "default");
}

schwabRouter.get("/login", (req, res) => {
  const clientId = process.env.SCHWAB_CLIENT_ID;
  const redirectUri =
    process.env.SCHWAB_REDIRECT_URI || "http://localhost:8787/api/auth/schwab/callback";
  if (!clientId) {
    return res.status(400).json({
      error: "Set SCHWAB_CLIENT_ID and SCHWAB_CLIENT_SECRET",
      doc: "https://developer.schwab.com",
    });
  }
  const state = req.query.state || "dev";
  const url = buildSchwabAuthorizeUrl({ clientId, redirectUri, state });
  res.json({ authorizeUrl: url, state });
});

schwabRouter.get("/callback", async (req, res) => {
  const code = req.query.code;
  const sessionId = (req.query.state || "default").toString();
  if (!code) {
    return res.status(400).send("Missing code");
  }
  const clientId = process.env.SCHWAB_CLIENT_ID;
  const clientSecret = process.env.SCHWAB_CLIENT_SECRET;
  const redirectUri =
    process.env.SCHWAB_REDIRECT_URI || "http://localhost:8787/api/auth/schwab/callback";
  try {
    const tokens = await exchangeSchwabCode({
      clientId,
      clientSecret,
      code,
      redirectUri,
    });
    tokenCache.set(sessionId, {
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expires_at: Date.now() + (tokens.expires_in || 1800) * 1000,
    });
    res.type("html").send(`<!DOCTYPE html><html><body>
      <p>Schwab connected. You can close this window.</p>
      <p>Session: <code>${sessionId}</code></p>
      <script>if(window.opener) window.opener.postMessage({type:'schwab_ok'},'*')</script>
    </body></html>`);
  } catch (e) {
    res.status(500).send(String(e.message || e));
  }
});

schwabRouter.get("/session", (req, res) => {
  const sessionId = (req.query.sessionId || "default").toString();
  const t = tokenCache.get(sessionId);
  res.json({ connected: Boolean(t?.access_token), expires_at: t?.expires_at });
});
