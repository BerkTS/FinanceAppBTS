import {
  browseSeekingAlpha,
  followSeekingAlphaUrls,
  closeSeekingAlphaBrowser,
} from "./seeking-alpha-browser.js";
import {
  claudePlanSeekingAlphaFollowUps,
  claudePickTopStocks,
  normalizePicks,
} from "./seeking-alpha-claude.js";
import {
  getSeekingAlphaRunState,
  setSeekingAlphaRunState,
  saveSeekingAlphaPicks,
} from "./seeking-alpha-picks-store.js";
import { getSchwabTokenForSession } from "../routes/schwab.js";
import { generateTradeAiViewSymbol } from "./trade-ai-view.js";

let runLock = false;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export function isSeekingAlphaAnalysisRunning() {
  return runLock || getSeekingAlphaRunState().running;
}

/**
 * @param {{ trigger?: 'manual'|'scheduled', sessionId?: string }} [options]
 */
export async function runSeekingAlphaAnalysis(options = {}, env = process.env) {
  if (env.SEEKING_ALPHA_BROWSER_DISABLED === "1") {
    throw new Error("Seeking Alpha browser analysis is disabled (SEEKING_ALPHA_BROWSER_DISABLED=1).");
  }
  if (runLock) {
    throw new Error("Seeking Alpha analysis is already running.");
  }

  const trigger = options.trigger || "manual";
  const schwabSessionId =
    (options.sessionId || env.SCHWAB_SESSION_ID || "default").toString() || "default";
  runLock = true;
  setSeekingAlphaRunState({
    running: true,
    lastStartedAt: new Date().toISOString(),
    lastTrigger: trigger,
    lastError: null,
  });

  let context = null;
  try {
    const session = await browseSeekingAlpha(env);
    context = session.context;
    const { page, maxFollow, waitMs } = session;
    let pages = [...session.pages];

    if (session.loginRequired) {
      const hint =
        "Seeking Alpha appears logged out or paywalled. Log in once with SEEKING_ALPHA_HEADLESS=0, complete Premium login in the opened browser, then retry.";
      const partial = {
        ok: false,
        loginRequired: true,
        hint,
        trigger,
        generatedAt: new Date().toISOString(),
        pagesVisited: pages.map((p) => p.url),
        picks: [],
        marketContext: hint,
        disclaimer:
          "Educational research only — not investment advice. Browser session must be authenticated.",
      };
      saveSeekingAlphaPicks(partial);
      setSeekingAlphaRunState({
        running: false,
        lastFinishedAt: partial.generatedAt,
        lastError: null,
      });
      return partial;
    }

    const plan = await claudePlanSeekingAlphaFollowUps({ pages }, env);
    const followUrls = (plan.linksToFollow || [])
      .map((x) => x.url)
      .filter(Boolean);
    if (followUrls.length > 0) {
      const extra = await followSeekingAlphaUrls(page, followUrls, waitMs, maxFollow);
      pages = pages.concat(extra);
    }

    const picksRaw = await claudePickTopStocks(
      { pages, planNotes: plan.notes || "" },
      env
    );
    const normalized = normalizePicks(picksRaw);

    const picksWithSchwab = Array.isArray(normalized.picks) ? [...normalized.picks] : [];
    for (let i = 0; i < picksWithSchwab.length; i++) {
      const pick = picksWithSchwab[i];
      const symbol = String(pick.symbol || "").toUpperCase();
      if (!symbol) continue;
      if (i > 0) await sleep(Math.max(120, Number(env.TRADE_SUGGEST_HISTORY_GAP_MS) || 220));
      try {
        const tv = await generateTradeAiViewSymbol({
          symbol,
          sessionId: schwabSessionId,
          limit: 60,
          newsApiFinanceQuery: env.NEWSAPI_FINANCE_QUERY,
          newsApiGeoQuery: env.NEWSAPI_GEO_QUERY,
          getSchwabTokenForSession,
          env,
          skipOpenai: true,
        });
        pick.schwabTradeView = {
          ok: tv.ok,
          needsSchwab: tv.needsSchwab,
          error: tv.error || null,
          ruleTargets: tv.ruleTargets || null,
          score: tv.score ?? null,
          quote: tv.quote || null,
          claude: tv.claude || null,
          claudeError: tv.claudeError || null,
          disclaimer: tv.disclaimer,
          generatedAt: tv.generatedAt,
        };
      } catch (e) {
        pick.schwabTradeView = {
          ok: false,
          error: String(e.message || e),
          ruleTargets: null,
          score: null,
          quote: null,
          claude: null,
        };
      }
    }

    const result = {
      ok: true,
      loginRequired: false,
      trigger,
      generatedAt: new Date().toISOString(),
      pagesVisited: pages.map((p) => ({ url: p.url, title: p.title })),
      planNotes: plan.notes || "",
      symbolsSpotted: plan.symbolsSpotted || [],
      ...normalized,
      picks: picksWithSchwab,
    };
    saveSeekingAlphaPicks(result);
    setSeekingAlphaRunState({
      running: false,
      lastFinishedAt: result.generatedAt,
      lastError: null,
    });
    return result;
  } catch (e) {
    const msg = String(e.message || e);
    setSeekingAlphaRunState({
      running: false,
      lastFinishedAt: new Date().toISOString(),
      lastError: msg,
    });
    throw e;
  } finally {
    await closeSeekingAlphaBrowser(context);
    runLock = false;
    if (getSeekingAlphaRunState().running) {
      setSeekingAlphaRunState({ running: false });
    }
  }
}

/**
 * Fire-and-forget background run (scheduler / API).
 * @param {'manual'|'scheduled'} [trigger]
 * @param {NodeJS.ProcessEnv} [env]
 * @param {string} [sessionId] Schwab session (default "default"); pass client session for quotes/levels.
 */
export function enqueueSeekingAlphaAnalysis(trigger = "manual", env = process.env, sessionId) {
  if (isSeekingAlphaAnalysisRunning()) {
    return { started: false, reason: "already_running" };
  }
  runSeekingAlphaAnalysis({ trigger, sessionId }, env).catch((e) => {
    console.error("[seeking-alpha] Analysis failed:", e.message);
  });
  return { started: true };
}
