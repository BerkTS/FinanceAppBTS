import fs from "fs";
import http from "http";
import path from "path";
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { newsRouter } from "./routes/news.js";
import { schwabRouter } from "./routes/schwab.js";
import { discoverRouter } from "./routes/discover.js";
import { stocksRouter } from "./routes/stocks.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
/** npm -w server runs with cwd=server/, so default dotenv misses repo-root .env */
const envRoot = path.resolve(__dirname, "../../.env");
const envServer = path.resolve(__dirname, "../.env");
dotenv.config({ path: envRoot });
dotenv.config({ path: envServer });

const clientDist = path.resolve(__dirname, "../../client/dist");

const app = express();
const PORT = Number(process.env.PORT) || 8787;

app.use(cors({ origin: true }));
app.use(express.json());

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    service: "finance-app-api",
    env: {
      rapidapiKeyLoaded: Boolean(process.env.RAPIDAPI_KEY),
      newsApiKeyLoaded: Boolean(process.env.NEWS_API_KEY),
      anthropicKeyLoaded: Boolean(process.env.ANTHROPIC_API_KEY),
      openaiKeyLoaded: Boolean(process.env.OPENAI_API_KEY),
    },
  });
});

app.use("/api/news", newsRouter);
app.use("/api/auth/schwab", schwabRouter);
app.use("/api/discover", discoverRouter);
app.use("/api/stocks", stocksRouter);

const hasBuiltClient =
  fs.existsSync(path.join(clientDist, "index.html")) &&
  fs.existsSync(path.join(clientDist, "assets"));

if (hasBuiltClient) {
  app.use(express.static(clientDist));
  app.use((req, res, next) => {
    if (req.method !== "GET" && req.method !== "HEAD") return next();
    if (req.path.startsWith("/api")) return next();
    res.sendFile(path.join(clientDist, "index.html"), (err) => {
      if (err) next(err);
    });
  });
}

const server = http.createServer(app);

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(
      `\nPort ${PORT} is already in use. Another process is bound to that port, so this server did not start.\n` +
        `Free it (macOS/Linux):  lsof -ti :${PORT} | xargs kill -9\n` +
        `Or use a different port:  PORT=8788 npm run dev -w server\n`
    );
  } else {
    console.error(err);
  }
  process.exit(1);
});

server.listen(PORT, () => {
  const where = hasBuiltClient
    ? `http://127.0.0.1:${PORT} (API + built UI — or use Vite on 5173 during dev)`
    : `http://127.0.0.1:${PORT} (API only — open Vite at http://localhost:5173, or run npm run build then npm start)`;
  console.log(`API listening on ${where}`);
});
