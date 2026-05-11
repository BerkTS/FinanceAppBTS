import crypto from "crypto";

export function headlineHash(title, source) {
  const normalized = `${(title || "").trim().toLowerCase()}|${(source || "").trim().toLowerCase()}`;
  return crypto.createHash("sha256").update(normalized).digest("hex").slice(0, 16);
}
