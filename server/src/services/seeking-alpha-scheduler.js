/**
 * Runs Seeking Alpha browser analysis at 8:30 AM US/Eastern on NYSE weekdays
 * (1 hour before the 9:30 AM ET cash open).
 */
import { enqueueSeekingAlphaAnalysis, isSeekingAlphaAnalysisRunning } from "./seeking-alpha-analyzer.js";

const EASTERN_TZ = "America/New_York";

function getEasternParts(ms = Date.now()) {
  const f = new Intl.DateTimeFormat("en-US", {
    timeZone: EASTERN_TZ,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
    weekday: "short",
    hour12: false,
  });
  const o = {};
  for (const x of f.formatToParts(new Date(ms))) {
    if (x.type !== "literal") o[x.type] = x.value;
  }
  return {
    year: Number(o.year),
    month: Number(o.month),
    day: Number(o.day),
    hour: Number(o.hour),
    minute: Number(o.minute),
    second: Number(o.second),
    weekday: o.weekday,
  };
}

function isNyseWeekday(p) {
  return ["Mon", "Tue", "Wed", "Thu", "Fri"].includes(p.weekday);
}

/** ms until next 8:30 AM ET on a weekday */
function msUntilNext830ET(fromMs = Date.now()) {
  const targetHour = 8;
  const targetMinute = 30;
  const max = 8 * 24 * 60 * 60 * 1000;
  for (let delta = 30_000; delta <= max; delta += 60_000) {
    const p = getEasternParts(fromMs + delta);
    if (!isNyseWeekday(p)) continue;
    if (p.hour === targetHour && p.minute === targetMinute) {
      const snap = fromMs + delta - (p.second || 0) * 1000;
      if (snap > fromMs) return snap - fromMs;
    }
  }
  return 24 * 60 * 60 * 1000;
}

let timer = null;
let lastScheduledKey = null;

function scheduleNext(env) {
  clearTimeout(timer);
  const ms = msUntilNext830ET();
  const nextAt = new Date(Date.now() + ms);
  const p = getEasternParts(nextAt.getTime());
  console.log(
    `[sa-scheduler] Next Seeking Alpha analysis ~${p.month}/${p.day} ${p.hour}:${String(p.minute).padStart(2, "0")} ET (in ${Math.round(ms / 60_000)} min)`
  );
  timer = setTimeout(() => {
    const now = getEasternParts();
    const key = `${now.year}-${now.month}-${now.day}`;
    if (isNyseWeekday(now) && lastScheduledKey !== key) {
      lastScheduledKey = key;
      if (!isSeekingAlphaAnalysisRunning()) {
        console.log("[sa-scheduler] Starting scheduled Seeking Alpha browser analysis (pre-open)");
        enqueueSeekingAlphaAnalysis("scheduled", env);
      }
    }
    scheduleNext(env);
  }, ms);
}

export function startSeekingAlphaScheduler(env = process.env) {
  if (env.SEEKING_ALPHA_SCHEDULER_DISABLED === "1") {
    console.log("[sa-scheduler] Disabled via SEEKING_ALPHA_SCHEDULER_DISABLED=1");
    return;
  }
  if (env.SEEKING_ALPHA_BROWSER_DISABLED === "1") {
    console.log("[sa-scheduler] Browser analysis disabled — scheduler not started");
    return;
  }
  console.log("[sa-scheduler] Pre-market run: 8:30 AM ET (Mon–Fri), ~1h before NYSE open");
  scheduleNext(env);
}
