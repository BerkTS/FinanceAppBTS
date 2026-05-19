import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, "../../data");
const PICKS_FILE = path.join(DATA_DIR, "seeking-alpha-picks.json");

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function readFile() {
  try {
    if (!fs.existsSync(PICKS_FILE)) return null;
    return JSON.parse(fs.readFileSync(PICKS_FILE, "utf8"));
  } catch {
    return null;
  }
}

export function getLatestPicks() {
  const data = readFile();
  return data?.latest || null;
}

export function getSeekingAlphaRunState() {
  const data = readFile();
  return (
    data?.runState || {
      running: false,
      lastStartedAt: null,
      lastFinishedAt: null,
      lastTrigger: null,
      lastError: null,
    }
  );
}

export function setSeekingAlphaRunState(patch) {
  ensureDir();
  const data = readFile() || {};
  data.runState = { ...getSeekingAlphaRunState(), ...patch };
  fs.writeFileSync(PICKS_FILE, JSON.stringify(data, null, 2));
}

export function saveSeekingAlphaPicks(result) {
  ensureDir();
  const data = readFile() || {};
  data.latest = result;
  data.history = [
    { savedAt: result.generatedAt, trigger: result.trigger, pickCount: result.picks?.length || 0 },
    ...(data.history || []),
  ].slice(0, 30);
  fs.writeFileSync(PICKS_FILE, JSON.stringify(data, null, 2));
}
