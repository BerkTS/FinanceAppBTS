import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  buildExportFilename,
  getHistoryDateKeyET,
  getSnapshotForDate,
  listSnapshotDates,
  mergeHistoryImport,
  parseHistoryImportText,
  serializeHistoryExport,
} from "./historyStore.js";

function Heading({ children, variant }) {
  const styles = {
    claude: "border-violet-500/70 text-violet-100",
    news: "border-teal-500/70 text-teal-100",
    discovery: "border-slate-500/70 text-slate-100",
    chatgpt: "border-sky-500/70 text-sky-100",
    tradeView: "border-emerald-500/70 text-emerald-100",
    muted: "border-surface-border text-slate-200",
  };
  return (
    <h3
      className={`mb-2 border-b pb-1.5 text-lg font-bold tracking-tight ${styles[variant] || styles.muted}`}
    >
      {children}
    </h3>
  );
}

function SubCard({ title, children }) {
  return (
    <div className="rounded-xl border border-surface-border bg-surface/40 p-4">
      <h4 className="text-sm font-semibold text-slate-200">{title}</h4>
      <div className="mt-2">{children}</div>
    </div>
  );
}

function RenderStructuredBulk({ data }) {
  const d = data?.payload;
  if (data?.loading) return <p className="text-xs text-muted">Was loading…</p>;
  if (data?.err) return <p className="text-xs text-amber-200/90">{data.err}</p>;
  if (!d) return <p className="text-xs text-muted">No data</p>;
  if (d.needsSchwab) return <p className="text-xs text-muted">Schwab not connected that day.</p>;
  const views = d.views || [];
  if (views.length === 0) return <p className="text-xs text-muted">No views captured.</p>;
  return (
    <div className="space-y-3">
      {d.disclaimer && (
        <p className="rounded border border-amber-500/25 bg-amber-500/5 px-2 py-1.5 text-[11px] text-amber-100/90">
          {d.disclaimer}
        </p>
      )}
      {views.map((row) => (
        <div key={row.symbol} className="rounded-lg border border-surface-border bg-black/20 p-3 text-sm">
          <p className="font-mono font-semibold text-emerald-200">{row.symbol}</p>
          {row.ruleTargets && (
            <p className="mt-1 font-mono text-xs text-slate-400">
              Entry {row.ruleTargets.entryLow}–{row.ruleTargets.entryHigh} · Stop {row.ruleTargets.stop} · T1{" "}
              {row.ruleTargets.target1} · T2 {row.ruleTargets.target2}
            </p>
          )}
          {row.claude?.thesis && (
            <p className="mt-2 text-xs text-violet-200/90">
              <span className="font-semibold text-violet-300">Claude:</span> {row.claude.thesis}
            </p>
          )}
          {row.openai?.thesis && (
            <p className="mt-2 text-xs text-sky-200/90">
              <span className="font-semibold text-sky-300">ChatGPT:</span> {row.openai.thesis}
            </p>
          )}
        </div>
      ))}
    </div>
  );
}

function RenderTradeSuggest({ data }) {
  const d = data?.payload;
  if (data?.loading) return <p className="text-xs text-muted">Was loading…</p>;
  if (data?.err) return <p className="text-xs text-amber-200/90">{data.err}</p>;
  if (!d?.suggestions?.length) return <p className="text-xs text-muted">No suggestions captured.</p>;
  return (
    <ul className="space-y-3 text-sm">
      {d.suggestions.map((s) => (
        <li key={s.symbol} className="rounded-lg border border-surface-border bg-black/15 p-3">
          <span className="font-mono text-blue-200">{s.symbol}</span>
          {s.ruleTargets && (
            <p className="mt-1 font-mono text-xs text-slate-400">
              ${s.quote?.last} · Entry {s.ruleTargets.entryLow}–{s.ruleTargets.entryHigh} · Stop{" "}
              {s.ruleTargets.stop}
            </p>
          )}
          {s.claude?.thesis && <p className="mt-2 text-xs text-slate-300">Claude: {s.claude.thesis}</p>}
          {s.chatgpt?.thesis && <p className="mt-2 text-xs text-slate-300">ChatGPT: {s.chatgpt.thesis}</p>}
        </li>
      ))}
    </ul>
  );
}

function RenderBriefing({ data }) {
  const d = data?.payload;
  if (data?.loading) return <p className="text-xs text-muted">Was loading…</p>;
  if (data?.err) return <p className="text-xs text-amber-200/90">{data.err}</p>;
  if (!d) return <p className="text-xs text-muted">No briefing</p>;
  if (d.skipped && d.reason === "no_api_key")
    return <p className="text-xs text-muted">Skipped (no API key).</p>;
  return (
    <div className="space-y-2 text-xs">
      {(d.themes || []).map((t) => (
        <p key={t.title} className="text-slate-300">
          <span className="font-medium text-slate-200">{t.title}</span>
          {t.summary ? ` — ${t.summary}` : ""}
        </p>
      ))}
      {(d.candidates || []).slice(0, 6).map((c) => (
        <p key={c.symbol} className="font-mono text-slate-400">
          {c.symbol}: {(c.thesis || "").slice(0, 160)}
          {(c.thesis || "").length > 160 ? "…" : ""}
        </p>
      ))}
    </div>
  );
}

function RenderNewsBlock({ payload }) {
  if (!payload) return <p className="text-xs text-muted">No news payload</p>;
  const blocks = [
    ["Seeking Alpha", payload.seekingAlpha],
    ["CNBC", payload.cnbcMarketsNews],
    ["Real-time finance", payload.realtimeFinanceNews],
    ["Reuters", payload.reutersBusinessNews],
    ["Real-time News Data", payload.realTimeNewsData],
  ];
  return (
    <div className="space-y-4">
      {blocks.map(([label, items]) => (
        <div key={label}>
          <p className="text-xs font-semibold uppercase text-muted">{label}</p>
          <ul className="mt-1 max-h-40 space-y-1 overflow-y-auto text-xs">
            {(items || []).slice(0, 12).map((n) => (
              <li key={n.id || n.title} className="text-slate-400">
                {(n.title || "").slice(0, 120)}
              </li>
            ))}
            {(!items || items.length === 0) && <li className="text-slate-600">—</li>}
          </ul>
        </div>
      ))}
    </div>
  );
}

function RenderDiscoveryTable({ payload }) {
  const ranked = payload?.payload?.ranked;
  if (!ranked?.length) return <p className="text-xs text-muted">No ranked rows</p>;
  return (
    <table className="w-full text-left text-xs">
      <thead className="text-muted">
        <tr>
          <th className="py-1">Symbol</th>
          <th className="py-1">Score</th>
        </tr>
      </thead>
      <tbody>
        {ranked.map((row) => (
          <tr key={row.symbol} className="border-t border-surface-border">
            <td className="py-1 font-mono">{row.symbol}</td>
            <td className="py-1">{Number(row.score).toFixed(2)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function RenderMentionChart({ chart }) {
  if (!chart?.length) return <p className="text-xs text-muted">No chart rows</p>;
  return (
    <div className="h-48 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={chart}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1e2636" />
          <XAxis dataKey="symbol" stroke="#8b9cb5" tick={{ fontSize: 10 }} />
          <YAxis stroke="#8b9cb5" tick={{ fontSize: 10 }} />
          <Tooltip
            contentStyle={{
              background: "#121722",
              border: "1px solid #1e2636",
              borderRadius: 8,
            }}
          />
          <Bar dataKey="mentions" fill="#3b82f6" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function RenderLeaf({ section }) {
  const { id, title, data } = section;
  if (id === "dataFeeds") {
    return (
      <div className="text-sm">
        {data?.err && <p className="text-xs text-rose-200/90">{data.err}</p>}
        <p className="text-xs text-muted">
          {data?.loading ? "Loading at capture time." : "Feeds strip captured."}
        </p>
        {data?.feedSummary && (
          <p className="mt-2 text-xs text-slate-400">
            GDELT {data.feedSummary.gdeltFallback ? "(+ mock)" : "live"}
            {data.feedSummary.newsapi ? " · NewsAPI" : ""}
            {data.feedSummary.alphavantage ? " · Alpha Vantage" : ""}
            {data.outletFeedLabels ? ` · ${data.outletFeedLabels}` : ""}
            {data.feedSummary.errorCount > 0
              ? ` · ${data.feedSummary.errorCount} source warning(s)`
              : ""}
          </p>
        )}
      </div>
    );
  }
  if (id === "structuredAiTradeView") {
    return <RenderStructuredBulk data={data} />;
  }
  if (id.endsWith("LiveTradeSuggestions")) {
    return (
      <SubCard title={title}>
        <RenderTradeSuggest data={data} />
      </SubCard>
    );
  }
  if (id.endsWith("ResearchBriefing")) {
    return (
      <SubCard title={title}>
        <RenderBriefing data={data} />
      </SubCard>
    );
  }
  if (id === "news") {
    return (
      <SubCard title={title}>
        <RenderNewsBlock payload={data?.payload} />
      </SubCard>
    );
  }
  if (id === "discoveryRanked") {
    return (
      <SubCard title={title}>
        <RenderDiscoveryTable data={data} />
      </SubCard>
    );
  }
  if (id === "newsMentionIntensity") {
    return (
      <SubCard title={title}>
        <RenderMentionChart chart={data?.chart} />
      </SubCard>
    );
  }
  if (id === "sidebarSelectedSymbol") {
    const a = data?.analysis;
    return (
      <SubCard title={title}>
        <p className="font-mono text-base text-slate-200">{data?.symbol || "—"}</p>
        {a?.analysis && (
          <dl className="mt-2 space-y-1 text-xs text-slate-400">
            <div className="flex justify-between gap-2">
              <dt>Price</dt>
              <dd className="font-mono">{a.analysis.price}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt>RSI</dt>
              <dd className="font-mono">{a.analysis.rsi ?? "—"}</dd>
            </div>
          </dl>
        )}
      </SubCard>
    );
  }
  if (id === "sidebarAiInsight") {
    return (
      <SubCard title={title}>
        <p className="text-xs font-semibold text-violet-300">Claude</p>
        <p className="mt-1 whitespace-pre-wrap text-xs text-slate-300">
          {data?.insight?.text || "—"}
        </p>
        <p className="mt-3 text-xs font-semibold text-sky-300">ChatGPT</p>
        <p className="mt-1 whitespace-pre-wrap text-xs text-slate-300">
          {data?.insightChatgpt?.text || "—"}
        </p>
      </SubCard>
    );
  }
  if (id === "sidebarAiTradeView") {
    const p = data?.payload;
    if (data?.loading) return <SubCard title={title}><p className="text-xs text-muted">Loading…</p></SubCard>;
    if (!p) return <SubCard title={title}><p className="text-xs text-muted">No data</p></SubCard>;
    return (
      <SubCard title={title}>
        {p.ruleTargets && (
          <p className="font-mono text-xs text-slate-400">
            Entry {p.ruleTargets.entryLow}–{p.ruleTargets.entryHigh} · Stop {p.ruleTargets.stop}
          </p>
        )}
        {p.claude?.thesis && <p className="mt-2 text-xs">{p.claude.thesis}</p>}
        {p.openai?.thesis && <p className="mt-2 text-xs">{p.openai.thesis}</p>}
      </SubCard>
    );
  }
  if (id === "sidebarRelatedHeadlines") {
    return (
      <SubCard title={title}>
        <ul className="max-h-40 space-y-2 overflow-y-auto text-xs">
          {(data?.items || []).map((n) => (
            <li key={n.id || n.title}>
              <span className="text-blue-200">{n.title}</span>
              <span className="text-slate-600"> · {n.source}</span>
            </li>
          ))}
        </ul>
      </SubCard>
    );
  }
  return (
    <SubCard title={title}>
      <p className="text-xs text-muted">Unknown block</p>
    </SubCard>
  );
}

function SectionBlock({ section }) {
  const variant =
    section.id === "claude"
      ? "claude"
      : section.id === "chatgpt"
        ? "chatgpt"
        : section.id === "news"
          ? "news"
          : section.id === "discovery"
            ? "discovery"
            : section.id === "structuredAiTradeView"
              ? "tradeView"
              : "muted";

  return (
    <div className="rounded-2xl border border-surface-border bg-surface-card/60 p-4 shadow-lg">
      <Heading variant={variant}>{section.title}</Heading>
      {section.children ? (
        <div className="space-y-3">
          {section.children.map((ch) => (
            <div key={ch.id}>
              <RenderLeaf section={ch} />
            </div>
          ))}
        </div>
      ) : (
        <RenderLeaf section={section} />
      )}
    </div>
  );
}

function triggerDownload(filename, text) {
  const blob = new Blob([text], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function HistoryModal({ open, onClose }) {
  const today = getHistoryDateKeyET();
  const [viewDate, setViewDate] = useState(today);
  const [dates, setDates] = useState([]);
  const [banner, setBanner] = useState(null);
  const importInputRef = useRef(null);

  const refreshDates = useCallback(() => {
    setDates(listSnapshotDates());
  }, []);

  useEffect(() => {
    if (!open) return;
    refreshDates();
    setBanner(null);
    setViewDate((d) => {
      const list = listSnapshotDates();
      if (list.includes(d)) return d;
      return list[0] || today;
    });
  }, [open, today, refreshDates]);

  const handleExport = useCallback(async () => {
    setBanner(null);
    const json = serializeHistoryExport();
    const filename = buildExportFilename();

    if (typeof window.showSaveFilePicker === "function") {
      try {
        const handle = await window.showSaveFilePicker({
          suggestedName: filename,
          types: [
            {
              description: "JSON",
              accept: { "application/json": [".json"] },
            },
          ],
        });
        const writable = await handle.createWritable();
        await writable.write(json);
        await writable.close();
        setBanner({
          type: "ok",
          text: `Saved as “${handle.name}”. Tip: keep exports in Documents/FinanceSignalBoard/exports/ (create the folder if you like) so they stay separate from random downloads.`,
        });
        return;
      } catch (e) {
        if (e?.name === "AbortError") return;
      }
    }

    triggerDownload(filename, json);
    setBanner({
      type: "ok",
      text: `Downloaded “${filename}”. Tip: move it to Documents/FinanceSignalBoard/exports/ so it is easy to find among other files in Downloads.`,
    });
  }, []);

  const handleImportFile = useCallback(
    async (e) => {
      const file = e.target.files?.[0];
      e.target.value = "";
      if (!file) return;
      setBanner(null);
      try {
        const text = await file.text();
        const parsed = parseHistoryImportText(text);
        const { merged, skipped } = mergeHistoryImport(parsed);
        refreshDates();
        setBanner({
          type: "ok",
          text: `Imported ${merged} day(s).${skipped ? ` Skipped ${skipped} invalid row(s).` : ""} Pick a date above to review.`,
        });
      } catch (err) {
        setBanner({
          type: "err",
          text: String(err?.message || err),
        });
      }
    },
    [refreshDates]
  );

  const snapshot = useMemo(() => (open ? getSnapshotForDate(viewDate) : null), [open, viewDate]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 p-4 pt-10 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="history-modal-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="relative w-full max-w-3xl rounded-2xl border border-surface-border bg-[#0c1018] p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 rounded-lg border border-surface-border px-2 py-1 text-sm text-muted hover:text-white"
        >
          Close
        </button>
        <h2 id="history-modal-title" className="text-xl font-semibold text-slate-50">
          History
        </h2>
        <p className="mt-1 text-xs text-muted">
          Each row uses the <strong className="font-medium text-slate-300">US Eastern calendar date</strong>{" "}
          (NYSE day). A full snapshot is also written at{" "}
          <strong className="font-medium text-slate-300">6:00&nbsp;PM Eastern</strong> every day including
          weekends (cash close + 2h) when this tab is open, plus periodic saves while you browse.
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleExport}
            className="rounded-lg border border-emerald-500/40 bg-emerald-950/40 px-3 py-1.5 text-sm font-medium text-emerald-100 hover:border-emerald-400/60"
          >
            Export JSON
          </button>
          <button
            type="button"
            onClick={() => importInputRef.current?.click()}
            className="rounded-lg border border-sky-500/40 bg-sky-950/30 px-3 py-1.5 text-sm font-medium text-sky-100 hover:border-sky-400/60"
          >
            Import JSON
          </button>
          <input
            ref={importInputRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={handleImportFile}
          />
          <span className="text-[11px] leading-snug text-slate-500">
            Export uses “Save as…” in Chrome/Edge; other browsers download a uniquely named file.
          </span>
        </div>
        {banner && (
          <p
            className={`mt-3 rounded-lg border px-3 py-2 text-xs ${
              banner.type === "err"
                ? "border-rose-500/40 bg-rose-500/10 text-rose-100"
                : "border-emerald-500/30 bg-emerald-500/10 text-emerald-50/95"
            }`}
          >
            {banner.text}
          </p>
        )}
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-slate-300">
            Date
            <input
              type="date"
              value={viewDate}
              max={today}
              onChange={(e) => setViewDate(e.target.value)}
              className="rounded-lg border border-surface-border bg-surface px-2 py-1.5 text-sm text-slate-200"
            />
          </label>
          <button
            type="button"
            onClick={() => setViewDate(today)}
            className="rounded-lg border border-surface-border px-3 py-1.5 text-sm text-slate-200 hover:border-accent/40"
          >
            Today
          </button>
          {dates.length > 0 && (
            <span className="text-xs text-muted">{dates.length} day(s) stored</span>
          )}
        </div>

        <div className="mt-6 max-h-[calc(100vh-12rem)] space-y-6 overflow-y-auto pr-1">
          {!snapshot && (
            <p className="text-sm text-muted">No snapshot for this date yet. Use the board and check back.</p>
          )}
          {snapshot?.sections?.map((sec) => (
            <SectionBlock key={sec.id} section={sec} />
          ))}
        </div>

        {snapshot?.savedAt && (
          <p className="mt-4 text-xs text-slate-500">Last saved this day: {new Date(snapshot.savedAt).toLocaleString()}</p>
        )}
      </div>
    </div>
  );
}
