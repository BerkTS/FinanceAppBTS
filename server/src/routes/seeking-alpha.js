import { Router } from "express";
import {
  enqueueSeekingAlphaAnalysis,
  isSeekingAlphaAnalysisRunning,
  runSeekingAlphaAnalysis,
} from "../services/seeking-alpha-analyzer.js";
import {
  getLatestPicks,
  getSeekingAlphaRunState,
} from "../services/seeking-alpha-picks-store.js";

export const seekingAlphaRouter = Router();

seekingAlphaRouter.get("/status", (_req, res) => {
  res.json({
    running: isSeekingAlphaAnalysisRunning(),
    runState: getSeekingAlphaRunState(),
    latest: getLatestPicks(),
    configured: {
      anthropic: Boolean(process.env.ANTHROPIC_API_KEY),
      browserDisabled: process.env.SEEKING_ALPHA_BROWSER_DISABLED === "1",
      schedulerDisabled: process.env.SEEKING_ALPHA_SCHEDULER_DISABLED === "1",
    },
  });
});

seekingAlphaRouter.get("/picks", (_req, res) => {
  const latest = getLatestPicks();
  if (!latest) {
    return res.json({ ok: true, picks: null, message: "No analysis saved yet." });
  }
  res.json({ ok: true, ...latest });
});

/** Manual trigger — runs in background unless ?sync=1 */
seekingAlphaRouter.post("/analyze", async (req, res) => {
  try {
    if (process.env.SEEKING_ALPHA_BROWSER_DISABLED === "1") {
      return res.status(503).json({
        ok: false,
        error: "Seeking Alpha browser analysis is disabled on the server.",
      });
    }
    if (!process.env.ANTHROPIC_API_KEY) {
      return res.status(503).json({
        ok: false,
        error: "Set ANTHROPIC_API_KEY in root .env for Claude analysis.",
      });
    }
    if (isSeekingAlphaAnalysisRunning()) {
      return res.status(409).json({ ok: false, error: "Analysis already running." });
    }

    const sessionId = (req.body?.sessionId || req.query.sessionId || "default").toString();

    const sync = req.query.sync === "1" || req.body?.sync === true;
    if (sync) {
      const result = await runSeekingAlphaAnalysis({ trigger: "manual", sessionId }, process.env);
      return res.json({ ok: true, started: false, result });
    }

    const enq = enqueueSeekingAlphaAnalysis("manual", process.env, sessionId);
    res.json({
      ok: true,
      started: enq.started,
      message:
        "Seeking Alpha browser analysis started. Poll GET /api/seeking-alpha/status until running is false.",
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});
