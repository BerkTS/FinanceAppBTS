import { Router } from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HISTORY_DIR = path.resolve(__dirname, "../../data/history");

export const historyRouter = Router();

historyRouter.get("/dates", (_req, res) => {
  try {
    if (!fs.existsSync(HISTORY_DIR)) return res.json({ dates: [] });
    const files = fs.readdirSync(HISTORY_DIR).filter((f) => f.endsWith(".json"));
    const dates = files
      .map((f) => f.replace(".json", ""))
      .sort()
      .reverse();
    res.json({ dates });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

historyRouter.get("/date/:dateKey", (req, res) => {
  try {
    const dateKey = req.params.dateKey.replace(/[^0-9-]/g, "");
    const filePath = path.join(HISTORY_DIR, `${dateKey}.json`);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: "not found" });
    const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

historyRouter.get("/export", (_req, res) => {
  try {
    if (!fs.existsSync(HISTORY_DIR)) return res.json({ snapshots: [] });
    const files = fs.readdirSync(HISTORY_DIR).filter((f) => f.endsWith(".json")).sort();
    const snapshots = files.map((f) => {
      try {
        return JSON.parse(fs.readFileSync(path.join(HISTORY_DIR, f), "utf-8"));
      } catch {
        return null;
      }
    }).filter(Boolean);
    res.json({ exported: new Date().toISOString(), snapshots });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
