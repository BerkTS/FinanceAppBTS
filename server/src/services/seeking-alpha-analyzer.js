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

let runLock = false;

export function isSeekingAlphaAnalysisRunning() {
  return runLock || getSeekingAlphaRunState().running;
}

/**
 * @param {{ trigger?: 'manual'|'scheduled' }} [options]
 */
export async function runSeekingAlphaAnalysis(options = {}, env = process.env) {
  if (env.SEEKING_ALPHA_BROWSER_DISABLED === "1") {
    throw new Error("Seeking Alpha browser analysis is disabled (SEEKING_ALPHA_BROWSER_DISABLED=1).");
  }
  if (runLock) {
    throw new Error("Seeking Alpha analysis is already running.");
  }

  const trigger = options.trigger || "manual";
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

    const result = {
      ok: true,
      loginRequired: false,
      trigger,
      generatedAt: new Date().toISOString(),
      pagesVisited: pages.map((p) => ({ url: p.url, title: p.title })),
      planNotes: plan.notes || "",
      symbolsSpotted: plan.symbolsSpotted || [],
      ...normalized,
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
 */
export function enqueueSeekingAlphaAnalysis(trigger = "manual", env = process.env) {
  if (isSeekingAlphaAnalysisRunning()) {
    return { started: false, reason: "already_running" };
  }
  runSeekingAlphaAnalysis({ trigger }, env).catch((e) => {
    console.error("[seeking-alpha] Analysis failed:", e.message);
  });
  return { started: true };
}
