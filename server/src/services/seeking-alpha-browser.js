import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_PROFILE = path.resolve(__dirname, "../../data/sa-browser-profile");

function defaultStartUrls(env) {
  const raw =
    env.SEEKING_ALPHA_START_URLS ||
    "https://seekingalpha.com/,https://seekingalpha.com/market-news,https://seekingalpha.com/stock-ideas";
  return raw
    .split(",")
    .map((u) => u.trim())
    .filter((u) => u.startsWith("https://seekingalpha.com"));
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function loadPlaywright() {
  try {
    return await import("playwright");
  } catch {
    throw new Error(
      "Playwright is not installed. From repo root run: npm install -w server && npx playwright install chromium"
    );
  }
}

async function capturePage(page, url, waitMs) {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 90_000 });
  await sleep(waitMs);
  const title = await page.title();
  const text = await page.evaluate(() => {
    const root =
      document.querySelector("main") ||
      document.querySelector("#content") ||
      document.body;
    return (root?.innerText || "").replace(/\s+/g, " ").trim().slice(0, 18_000);
  });
  const screenshotBase64 = (
    await page.screenshot({ type: "png", fullPage: false })
  ).toString("base64");
  const loginLikely =
    /sign in|log in|subscribe to read|create free account/i.test(text.slice(0, 2500)) &&
    text.length < 4000;
  return { url: page.url(), title, text, screenshotBase64, loginLikely };
}

function resolveSaUrl(href) {
  if (!href) return null;
  try {
    const u = new URL(href, "https://seekingalpha.com");
    if (!u.hostname.endsWith("seekingalpha.com")) return null;
    if (u.protocol !== "https:") return null;
    return u.href.split("#")[0];
  } catch {
    return null;
  }
}

/**
 * @returns {Promise<{ pages: object[], loginRequired: boolean, profileDir: string }>}
 */
export async function browseSeekingAlpha(env = process.env) {
  const { chromium } = await loadPlaywright();
  const profileDir = env.SEEKING_ALPHA_BROWSER_PROFILE || DEFAULT_PROFILE;
  fs.mkdirSync(profileDir, { recursive: true });

  const headless = env.SEEKING_ALPHA_HEADLESS !== "0";
  const waitMs = Math.max(1500, Number(env.SEEKING_ALPHA_PAGE_WAIT_MS) || 4500);
  const maxFollow = Math.min(5, Number(env.SEEKING_ALPHA_MAX_FOLLOW_PAGES) || 3);
  const startUrls = defaultStartUrls(env);
  if (startUrls.length === 0) {
    throw new Error("No valid SEEKING_ALPHA_START_URLS (must be https://seekingalpha.com/...)");
  }

  const context = await chromium.launchPersistentContext(profileDir, {
    headless,
    viewport: { width: 1440, height: 900 },
    locale: "en-US",
    timezoneId: "America/New_York",
  });

  const pages = [];
  let loginRequired = false;

  try {
    const page = context.pages()[0] || (await context.newPage());
    for (const url of startUrls) {
      try {
        const snap = await capturePage(page, url, waitMs);
        pages.push(snap);
        if (snap.loginLikely) loginRequired = true;
      } catch (e) {
        pages.push({
          url,
          title: "Error",
          text: `Failed to load: ${e.message}`,
          screenshotBase64: null,
          loginLikely: false,
        });
      }
    }
    return { pages, loginRequired, profileDir, context, page, maxFollow, waitMs };
  } catch (e) {
    await context.close().catch(() => {});
    throw e;
  }
}

/**
 * @param {import('playwright').Page} page
 * @param {string[]} urls
 */
export async function followSeekingAlphaUrls(page, urls, waitMs, maxFollow) {
  const out = [];
  const seen = new Set();
  for (const raw of urls.slice(0, maxFollow)) {
    const url = resolveSaUrl(raw);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    try {
      out.push(await capturePage(page, url, waitMs));
    } catch (e) {
      out.push({
        url,
        title: "Error",
        text: `Failed to load: ${e.message}`,
        screenshotBase64: null,
        loginLikely: false,
      });
    }
  }
  return out;
}

export async function closeSeekingAlphaBrowser(context) {
  if (context) await context.close().catch(() => {});
}
