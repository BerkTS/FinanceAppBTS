import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { buildOrderedSnapshot, mergeTodaySnapshot } from "./historyStore.js";
import { subscribeHistory630ETFinalize } from "./historyET630Schedule.js";
import { HistoryModal } from "./HistoryModal.jsx";

const API = "/api";

async function fetchJson(path) {
  const res = await fetch(`${API}${path}`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

const PRICE_RANGES = ["1D", "5D", "1M", "3M", "6M", "1Y", "5Y"];

function fmtPrice(n) {
  if (n == null || !Number.isFinite(Number(n))) return "—";
  return Number(n).toFixed(2);
}

function fmtVol(v) {
  if (v == null || !Number.isFinite(v)) return "—";
  if (v >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(1)}k`;
  return String(Math.round(v));
}

function formatCandleCell(iso, range) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (range === "1D") {
    return d.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    ...(range === "5Y" ? { year: "numeric" } : {}),
  });
}

function PriceRangePicker({ value, onChange }) {
  return (
    <div className="flex flex-wrap gap-2" role="group" aria-label="Price history range">
      {PRICE_RANGES.map((r) => (
        <button
          key={r}
          type="button"
          onClick={() => onChange(r)}
          className={`rounded-md px-2.5 py-1 text-lg font-medium transition ${
            value === r
              ? "bg-emerald-500/25 text-emerald-100 border border-emerald-500/40"
              : "border border-surface-border text-muted hover:text-slate-200"
          }`}
        >
          {r}
        </button>
      ))}
    </div>
  );
}

function tickTimeLabel(t, range) {
  if (t == null || !Number.isFinite(Number(t))) return "";
  const iso = new Date(Number(t)).toISOString();
  if (range === "1D") {
    return new Date(Number(t)).toLocaleTimeString(undefined, {
      hour: "numeric",
      minute: "2-digit",
    });
  }
  return new Date(Number(t)).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    ...(range === "5Y" || range === "1Y" ? { year: "2-digit" } : {}),
  });
}

/** Line + filled area (Apple Stocks–style), same data as the OHLC table. */
function PriceHistoryChart({ rows, loading, error, needsSchwab, range, compact = false }) {
  const gradId = useRef(`ph-fill-${Math.random().toString(36).slice(2, 9)}`).current;
  const chartH = compact ? 168 : 220;

  const prepared = useMemo(() => {
    const list = Array.isArray(rows) ? rows.filter((r) => r && Number.isFinite(Number(r.close))) : [];
    return [...list].sort((a, b) => Number(a.time) - Number(b.time));
  }, [rows]);

  const stroke = useMemo(() => {
    if (prepared.length < 2) return "#34d399";
    const a = Number(prepared[0].close);
    const b = Number(prepared[prepared.length - 1].close);
    if (!Number.isFinite(a) || !Number.isFinite(b)) return "#34d399";
    return b >= a ? "#34d399" : "#fb7185";
  }, [prepared]);

  const textSize = compact ? "text-lg" : "text-xl";
  if (needsSchwab) {
    return <p className={`text-muted ${textSize}`}>Connect Schwab for price history.</p>;
  }
  if (error) {
    return <p className={`text-rose-200/85 ${textSize}`}>{error}</p>;
  }
  if (loading) {
    return <p className={`text-muted ${textSize}`}>Loading chart…</p>;
  }
  if (prepared.length < 2) {
    return <p className={`text-muted ${textSize}`}>Not enough bars to draw a chart.</p>;
  }

  const tMin = prepared[0].time;
  const tMax = prepared[prepared.length - 1].time;

  return (
    <div
      className={`w-full rounded-lg border border-surface-border bg-black/15 ${
        compact ? "px-1 pt-1" : "px-1 pt-2"
      }`}
      style={{ height: chartH }}
    >
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={prepared} margin={{ top: 8, right: 8, left: 4, bottom: 4 }}>
          <defs>
            <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={stroke} stopOpacity={0.45} />
              <stop offset="100%" stopColor={stroke} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="#1e293b" strokeDasharray="3 3" vertical />
          <XAxis
            type="number"
            dataKey="time"
            domain={[tMin, tMax]}
            scale="time"
            tickFormatter={(t) => tickTimeLabel(t, range)}
            tick={{ fill: "#64748b", fontSize: compact ? 11 : 12 }}
            axisLine={{ stroke: "#334155" }}
            tickLine={false}
            minTickGap={compact ? 24 : 36}
          />
          <YAxis
            orientation="right"
            domain={["auto", "auto"]}
            width={compact ? 40 : 48}
            tick={{ fill: "#64748b", fontSize: compact ? 11 : 12 }}
            axisLine={false}
            tickLine={false}
            tickFormatter={(v) => (Number.isFinite(v) ? Number(v).toFixed(0) : "")}
          />
          <Tooltip
            cursor={{ stroke: "#475569", strokeWidth: 1 }}
            contentStyle={{
              background: "#121722",
              border: "1px solid #1e2636",
              borderRadius: 8,
              fontSize: 15,
            }}
            labelFormatter={(t) => formatCandleCell(new Date(Number(t)).toISOString(), range)}
            formatter={(v) => [`$${fmtPrice(v)}`, "Close"]}
          />
          <Area
            type="monotone"
            dataKey="close"
            stroke={stroke}
            strokeWidth={compact ? 1.5 : 2}
            fill={`url(#${gradId})`}
            dot={false}
            activeDot={{ r: 4, strokeWidth: 0, fill: stroke }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

function PriceHistoryTable({ rows, loading, error, needsSchwab, range, compact = false }) {
  const textSize = compact ? "text-lg" : "text-xl";
  if (needsSchwab) {
    return (
      <p className={`text-muted ${textSize}`}>Connect Schwab for OHLC history.</p>
    );
  }
  if (error) {
    return <p className={`text-rose-200/85 ${textSize}`}>{error}</p>;
  }
  if (loading) {
    return <p className={`text-muted ${textSize}`}>Loading bars…</p>;
  }
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) {
    return <p className={`text-muted ${textSize}`}>No bars for this range.</p>;
  }
  const tail = compact ? list.slice(-16) : list.slice(-80);
  const ordered = [...tail].reverse();
  return (
    <div
      className={`overflow-x-auto rounded-lg border border-surface-border bg-black/15 ${
        compact ? "max-h-52 overflow-y-auto" : "max-h-72 overflow-y-auto"
      }`}
    >
      <table className={`w-full text-left font-mono text-slate-300 ${textSize}`}>
        <thead className="sticky top-0 bg-surface/95 text-xl uppercase tracking-wide text-muted">
          <tr>
            <th className="px-3 py-2.5 font-medium">Date</th>
            <th className="px-3 py-2.5 font-medium">O</th>
            <th className="px-3 py-2.5 font-medium">H</th>
            <th className="px-3 py-2.5 font-medium">L</th>
            <th className="px-3 py-2.5 font-medium">C</th>
            <th className="px-3 py-2.5 font-medium">Vol</th>
          </tr>
        </thead>
        <tbody>
          {ordered.map((row) => (
            <tr key={`${row.time}-${row.date}`} className="border-t border-surface-border/60">
              <td className="whitespace-nowrap px-3 py-2 text-slate-400">
                {formatCandleCell(row.date, range)}
              </td>
              <td className="px-3 py-2">{fmtPrice(row.open)}</td>
              <td className="px-3 py-2">{fmtPrice(row.high)}</td>
              <td className="px-3 py-2">{fmtPrice(row.low)}</td>
              <td className="px-3 py-2 text-slate-100">{fmtPrice(row.close)}</td>
              <td className="px-3 py-2 text-slate-500">{fmtVol(row.volume)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Badge({ children, tone = "neutral" }) {
  const tones = {
    neutral: "bg-surface-border text-muted",
    up: "bg-emerald-500/15 text-emerald-300 border border-emerald-500/30",
    down: "bg-rose-500/15 text-rose-300 border border-rose-500/30",
    info: "bg-accent/15 text-blue-200 border border-accent/35",
  };
  return (
    <span
      className={`inline-flex items-center rounded-full px-3 py-1 text-xl font-medium ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

/** Major column sections: Claude vs News vs Discovery */
function SectionHeading({ children, variant }) {
  const styles = {
    claude:
      "border-violet-500/90 text-violet-100 shadow-[inset_0_-1px_0_0_rgba(139,92,246,0.35)]",
    news: "border-teal-500/90 text-teal-100 shadow-[inset_0_-1px_0_0_rgba(45,212,191,0.35)]",
    discovery:
      "border-slate-500/80 text-slate-100 shadow-[inset_0_-1px_0_0_rgba(148,163,184,0.25)]",
    chatgpt:
      "border-sky-500/90 text-sky-100 shadow-[inset_0_-1px_0_0_rgba(56,189,248,0.35)]",
    tradeView:
      "border-emerald-500/90 text-emerald-100 shadow-[inset_0_-1px_0_0_rgba(52,211,153,0.35)]",
  };
  return (
    <h2
      className={`mb-6 border-b-2 pb-4 text-5xl font-bold tracking-tight ${styles[variant]}`}
    >
      {children}
    </h2>
  );
}

export default function App() {
  const [discover, setDiscover] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [selected, setSelected] = useState(null);
  const [analysis, setAnalysis] = useState(null);
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [briefing, setBriefing] = useState(null);
  const [briefingChatgpt, setBriefingChatgpt] = useState(null);
  const [briefingLoading, setBriefingLoading] = useState(false);
  const [briefingErr, setBriefingErr] = useState(null);
  const [tradeSuggest, setTradeSuggest] = useState(null);
  const [tradeSuggestLoading, setTradeSuggestLoading] = useState(false);
  const [tradeSuggestErr, setTradeSuggestErr] = useState(null);
  const [tradeAiBulk, setTradeAiBulk] = useState(null);
  const [tradeAiBulkLoading, setTradeAiBulkLoading] = useState(false);
  const [tradeAiBulkErr, setTradeAiBulkErr] = useState(null);
  const [tradeAiView, setTradeAiView] = useState(null);
  const [tradeAiViewLoading, setTradeAiViewLoading] = useState(false);
  const [sidebarPriceRange, setSidebarPriceRange] = useState("1M");
  const [sidebarPriceHistory, setSidebarPriceHistory] = useState({
    candles: [],
    loading: false,
    error: null,
    needsSchwab: false,
  });
  const [bulkPriceRange, setBulkPriceRange] = useState("1M");
  const [bulkPriceBySymbol, setBulkPriceBySymbol] = useState({});
  const [historyOpen, setHistoryOpen] = useState(false);
  const [schwabConnected, setSchwabConnected] = useState(false);
  const historyCaptureRef = useRef(null);
  const [sessionId] = useState(() => localStorage.getItem("schwabSession") || "default");

  const loadDiscover = useCallback(async () => {
    setLoading(true);
    setErr(null);
    setBriefing(null);
    setBriefingChatgpt(null);
    setBriefingErr(null);
    setTradeSuggest(null);
    setTradeSuggestErr(null);
    setTradeAiBulk(null);
    setTradeAiBulkErr(null);
    try {
      const data = await fetchJson(
        `/discover/top?sessionId=${encodeURIComponent(sessionId)}`
      );
      setDiscover(data);
      setSelected((prev) => prev || data.ranked?.[0]?.symbol || null);
    } catch (e) {
      setErr(String(e.message || e));
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  useEffect(() => {
    loadDiscover();
    fetch(`${API}/auth/schwab/session?sessionId=${encodeURIComponent(sessionId)}`)
      .then((r) => r.json())
      .then((s) => { if (s.connected) setSchwabConnected(true); })
      .catch(() => {});
  }, [loadDiscover, sessionId]);

  useEffect(() => {
    if (!discover) return undefined;
    let cancelled = false;
    (async () => {
      setBriefingLoading(true);
      setBriefingErr(null);
      try {
        const b = await fetchJson(
          `/discover/briefing?sessionId=${encodeURIComponent(sessionId)}&limit=60`
        );
        if (!cancelled) {
          if (b?.briefing != null) {
            setBriefing(b.briefing);
            setBriefingChatgpt(b.briefingChatgpt ?? null);
          } else {
            setBriefing(b);
            setBriefingChatgpt(null);
          }
        }
      } catch (e) {
        if (!cancelled) setBriefingErr(String(e.message || e));
      } finally {
        if (!cancelled) setBriefingLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [discover, sessionId]);

  useEffect(() => {
    if (!discover) return undefined;
    let cancelled = false;
    (async () => {
      setTradeSuggestLoading(true);
      setTradeSuggestErr(null);
      try {
        const t = await fetchJson(
          `/discover/trade-suggestions?sessionId=${encodeURIComponent(sessionId)}&limit=60`
        );
        if (!cancelled) setTradeSuggest(t);
      } catch (e) {
        if (!cancelled) setTradeSuggestErr(String(e.message || e));
      } finally {
        if (!cancelled) setTradeSuggestLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [discover, sessionId]);

  useEffect(() => {
    if (!discover) return undefined;
    let cancelled = false;
    (async () => {
      setTradeAiBulkLoading(true);
      setTradeAiBulkErr(null);
      try {
        const t = await fetchJson(
          `/discover/trade-ai-view?sessionId=${encodeURIComponent(sessionId)}&limit=60&topN=5`
        );
        if (!cancelled) setTradeAiBulk(t);
      } catch (e) {
        if (!cancelled) setTradeAiBulkErr(String(e.message || e));
      } finally {
        if (!cancelled) setTradeAiBulkLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [discover, sessionId]);

  useEffect(() => {
    if (!selected) return undefined;
    let cancelled = false;
    (async () => {
      setAnalysisLoading(true);
      try {
        const data = await fetchJson(
          `/stocks/${encodeURIComponent(selected)}/analysis?sessionId=${encodeURIComponent(sessionId)}&insight=1`
        );
        if (!cancelled) setAnalysis(data);
      } catch {
        if (!cancelled) setAnalysis(null);
      } finally {
        if (!cancelled) setAnalysisLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selected, sessionId]);

  useEffect(() => {
    if (!selected) return undefined;
    let cancelled = false;
    (async () => {
      setTradeAiViewLoading(true);
      try {
        const data = await fetchJson(
          `/stocks/trade-ai-view/${encodeURIComponent(selected)}?sessionId=${encodeURIComponent(sessionId)}&limit=60`
        );
        if (!cancelled) setTradeAiView(data);
      } catch {
        if (!cancelled) setTradeAiView(null);
      } finally {
        if (!cancelled) setTradeAiViewLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selected, sessionId]);

  useEffect(() => {
    if (!selected) {
      setSidebarPriceHistory({
        candles: [],
        loading: false,
        error: null,
        needsSchwab: false,
      });
      return undefined;
    }
    let cancelled = false;
    setSidebarPriceHistory((prev) => ({
      ...prev,
      loading: true,
      error: null,
    }));
    (async () => {
      try {
        const res = await fetch(
          `${API}/stocks/${encodeURIComponent(selected)}/price-history?sessionId=${encodeURIComponent(sessionId)}&range=${encodeURIComponent(sidebarPriceRange)}`
        );
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok) {
          setSidebarPriceHistory({
            candles: [],
            loading: false,
            error: data.error || `HTTP ${res.status}`,
            needsSchwab: false,
          });
          return;
        }
        setSidebarPriceHistory({
          candles: data.candles || [],
          loading: false,
          error: data.error || null,
          needsSchwab: !!data.needsSchwab,
        });
      } catch (e) {
        if (!cancelled) {
          setSidebarPriceHistory({
            candles: [],
            loading: false,
            error: String(e.message || e),
            needsSchwab: false,
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selected, sessionId, sidebarPriceRange]);

  useEffect(() => {
    const views = tradeAiBulk?.views;
    if (!Array.isArray(views) || views.length === 0) {
      setBulkPriceBySymbol({});
      return undefined;
    }
    const symbols = views.map((v) => String(v.symbol || "").toUpperCase()).filter(Boolean);
    let cancelled = false;

    setBulkPriceBySymbol(() => {
      const next = {};
      for (const s of symbols) {
        next[s] = { candles: [], loading: true, error: null, needsSchwab: false };
      }
      return next;
    });

    (async () => {
      await Promise.all(
        symbols.map(async (sym) => {
          try {
            const res = await fetch(
              `${API}/stocks/${encodeURIComponent(sym)}/price-history?sessionId=${encodeURIComponent(sessionId)}&range=${encodeURIComponent(bulkPriceRange)}`
            );
            const data = await res.json();
            if (cancelled) return;
            if (!res.ok) {
              setBulkPriceBySymbol((prev) => ({
                ...prev,
                [sym]: {
                  candles: [],
                  loading: false,
                  error: data.error || `HTTP ${res.status}`,
                  needsSchwab: false,
                },
              }));
              return;
            }
            setBulkPriceBySymbol((prev) => ({
              ...prev,
              [sym]: {
                candles: data.candles || [],
                loading: false,
                error: data.error || null,
                needsSchwab: !!data.needsSchwab,
              },
            }));
          } catch (e) {
            if (cancelled) return;
            setBulkPriceBySymbol((prev) => ({
              ...prev,
              [sym]: {
                candles: [],
                loading: false,
                error: String(e.message || e),
                needsSchwab: false,
              },
            }));
          }
        })
      );
    })();

    return () => {
      cancelled = true;
    };
  }, [tradeAiBulk, bulkPriceRange, sessionId]);

  const chartData = useMemo(() => {
    const tickers = discover?.newsTickers?.slice(0, 8) || [];
    return tickers.map((t) => ({
      symbol: t.symbol,
      mentions: t.mentions,
      sentiment: t.avgSentiment,
    }));
  }, [discover]);

  const outletFeedLabels = useMemo(() => {
    const o = discover?.news?.sources?.outlets;
    if (!o) return "";
    return Object.entries(o)
      .filter(([, v]) => v)
      .map(([k]) => {
        if (k === "yahoo_finance_rss") return "Yahoo RSS";
        if (k === "newsapi_domains") return "NewsAPI domains";
        if (k === "ap_media") return "AP";
        if (k === "rapidapi_realtime_finance") return "Rapid:Real-time finance news";
        if (k.startsWith("rapidapi_")) return `Rapid:${k.replace("rapidapi_", "")}`;
        return k;
      })
      .join(" · ");
  }, [discover?.news?.sources?.outlets]);

  useEffect(() => {
    if (!discover) {
      historyCaptureRef.current = null;
      return;
    }
    historyCaptureRef.current = {
      loading,
      err,
      discover,
      tradeSuggest,
      tradeSuggestErr,
      tradeSuggestLoading,
      tradeAiBulk,
      tradeAiBulkErr,
      tradeAiBulkLoading,
      briefing,
      briefingChatgpt,
      briefingErr,
      briefingLoading,
      selected,
      analysis,
      analysisLoading,
      tradeAiView,
      tradeAiViewLoading,
      chartData,
    };
  }, [
    discover,
    loading,
    err,
    tradeSuggest,
    tradeSuggestErr,
    tradeSuggestLoading,
    tradeAiBulk,
    tradeAiBulkErr,
    tradeAiBulkLoading,
    briefing,
    briefingChatgpt,
    briefingErr,
    briefingLoading,
    selected,
    analysis,
    analysisLoading,
    tradeAiView,
    tradeAiViewLoading,
    chartData,
  ]);

  useEffect(() => {
    const stop = subscribeHistory630ETFinalize(() => historyCaptureRef.current);
    return stop;
  }, []);

  useEffect(() => {
    if (!discover) return undefined;
    const t = setTimeout(() => {
      const snapshot = buildOrderedSnapshot({
        loading,
        err,
        discover,
        tradeSuggest,
        tradeSuggestErr,
        tradeSuggestLoading,
        tradeAiBulk,
        tradeAiBulkErr,
        tradeAiBulkLoading,
        briefing,
        briefingChatgpt,
        briefingErr,
        briefingLoading,
        selected,
        analysis,
        analysisLoading,
        tradeAiView,
        tradeAiViewLoading,
        chartData,
      });
      mergeTodaySnapshot(snapshot);
    }, 4000);
    return () => clearTimeout(t);
  }, [
    discover,
    loading,
    err,
    tradeSuggest,
    tradeSuggestErr,
    tradeSuggestLoading,
    tradeAiBulk,
    tradeAiBulkErr,
    tradeAiBulkLoading,
    briefing,
    briefingChatgpt,
    briefingErr,
    briefingLoading,
    selected,
    analysis,
    analysisLoading,
    tradeAiView,
    tradeAiViewLoading,
    chartData,
  ]);

  const openSchwabLogin = async () => {
    const res = await fetch(`${API}/auth/schwab/login?state=${encodeURIComponent(sessionId)}`);
    const data = await res.json();
    if (data.authorizeUrl) {
      const popup = window.open(data.authorizeUrl, "schwab_oauth", "width=600,height=720");
      if (!popup) return;
      const poll = setInterval(async () => {
        if (popup.closed) {
          clearInterval(poll);
          try {
            const check = await fetch(`${API}/auth/schwab/session?sessionId=${encodeURIComponent(sessionId)}`);
            const s = await check.json();
            if (s.connected) {
              setSchwabConnected(true);
              loadDiscover();
            }
          } catch {}
        }
      }, 800);
    }
  };

  return (
    <div className="min-h-screen font-sans">
      <header className="border-b border-surface-border bg-surface-card/60 backdrop-blur-md">
        <div className="mx-auto flex max-w-[1440px] flex-wrap items-center justify-between gap-4 px-6 py-5">
          <div>
            <p className="text-xl font-medium uppercase tracking-wide text-muted">
              Portfolio intelligence
            </p>
            <div className="mt-2 min-w-0">
              <h1 className="text-5xl font-extrabold leading-[1.05] tracking-tight md:text-6xl">
                <span className="bg-gradient-to-r from-emerald-200 via-slate-50 to-violet-300 bg-clip-text text-transparent">
                  Finance App BTS
                </span>
              </h1>
              <div
                className="mt-4 h-1 max-w-[11.5rem] rounded-full bg-gradient-to-r from-emerald-500 via-sky-400 to-violet-500 shadow-[0_0_20px_rgba(56,189,248,0.25)]"
                aria-hidden
              />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="info">GDELT + NewsAPI + Alpha Vantage</Badge>
            <button
              type="button"
              onClick={loadDiscover}
              className="rounded-lg border border-surface-border bg-surface-card px-3 py-2 text-xl font-medium text-slate-200 transition hover:border-accent/50 hover:text-white"
            >
              Refresh
            </button>
            <button
              type="button"
              onClick={() => setHistoryOpen(true)}
              className="rounded-lg border border-slate-500/50 bg-slate-800/80 px-3 py-2 text-xl font-medium text-slate-200 transition hover:border-slate-400 hover:text-white"
            >
              History
            </button>
            <button
              type="button"
              onClick={openSchwabLogin}
              disabled={schwabConnected}
              className={`rounded-lg px-3 py-2 text-xl font-semibold shadow-lg transition ${
                schwabConnected
                  ? "border border-emerald-500/50 bg-emerald-900/40 text-emerald-300 shadow-emerald-900/20 cursor-default"
                  : "bg-accent text-white shadow-blue-900/30 hover:bg-accent-dim"
              }`}
            >
              {schwabConnected ? "✓ Schwab Connected" : "Connect Schwab"}
            </button>
          </div>
        </div>
      </header>

      <HistoryModal open={historyOpen} onClose={() => setHistoryOpen(false)} />

      <main className="mx-auto grid max-w-[1440px] gap-8 px-6 py-10 lg:grid-cols-3">
        <section className="lg:col-span-2 space-y-12">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-surface-border bg-surface-card/50 px-5 py-4 shadow-sm ring-1 ring-white/[0.04]">
            <h2 className="text-xl font-semibold uppercase tracking-wide text-slate-400">
              Data feeds
            </h2>
            {loading && <span className="text-xl text-muted">Loading…</span>}
          </div>
          {err && (
            <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-xl text-rose-100">
              {err}
            </div>
          )}
          {discover?.news && (
            <div className="flex flex-wrap gap-2 text-xl text-muted leading-relaxed">
              <span>
                Feeds: GDELT {discover.news.sources?.fallback ? "(+ mock fallback)" : "live"}
                {discover.news.sources?.newsapi ? " · NewsAPI" : ""}
                {discover.news.sources?.alphavantage ? " · Alpha Vantage" : ""}
                {outletFeedLabels ? ` · ${outletFeedLabels}` : ""}
              </span>
              {discover.news.errors?.length > 0 && (
                <span className="text-amber-200/90">
                  {discover.news.errors.length} source warning(s) — check API keys / rate limits
                </span>
              )}
            </div>
          )}

          <div className="rounded-2xl border border-emerald-500/25 bg-emerald-950/15 p-7 shadow-xl shadow-black/25 ring-1 ring-white/[0.07]">
            <SectionHeading variant="tradeView">Structured AI trade view</SectionHeading>
            <p className="-mt-1 mb-5 text-xl leading-relaxed text-muted">
              Discovery top 5 · Schwab + rules + bias · Claude & ChatGPT — same ranked universe as
              live suggestions; models echo rule-based entry/stop/targets and add bias + context.{" "}
              {tradeAiBulkLoading && <span className="text-slate-400">Loading…</span>}
            </p>
            <div className="rounded-2xl border border-emerald-500/25 bg-surface-card/90 p-6 shadow-lg shadow-black/40 ring-1 ring-black/20">
            {tradeAiBulk?.disclaimer && (
              <p className="mt-2 rounded-lg border border-amber-500/25 bg-amber-500/5 px-3 py-2.5 text-xl leading-relaxed text-amber-100/90">
                {tradeAiBulk.disclaimer}
              </p>
            )}
            {tradeAiBulkErr && (
              <p className="mt-2 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2.5 text-xl text-rose-100">
                {tradeAiBulkErr}
              </p>
            )}
            {tradeAiBulk?.needsSchwab && !tradeAiBulkLoading && (
              <p className="mt-3 text-xl text-muted">Connect Schwab for structured levels.</p>
            )}
            {tradeAiBulk?.cacheHit && (
              <p className="mt-1 text-xl text-slate-500">Cached snapshot (short TTL).</p>
            )}
            {Array.isArray(tradeAiBulk?.views) && tradeAiBulk.views.length > 0 && (
              <div className="mt-5 space-y-8">
                <div className="flex flex-wrap items-center gap-3 border-b border-emerald-500/25 pb-4">
                  <span className="text-xl font-medium text-slate-300">OHLC range (all rows):</span>
                  <PriceRangePicker value={bulkPriceRange} onChange={setBulkPriceRange} />
                </div>
                {tradeAiBulk.views.map((row) => {
                  const symKey = String(row.symbol || "").toUpperCase();
                  const ph = bulkPriceBySymbol[symKey];
                  return (
                  <div
                    key={row.symbol}
                    className="rounded-xl border border-surface-border bg-slate-950/50 px-5 py-5 shadow-md ring-1 ring-white/[0.06]"
                  >
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <button
                        type="button"
                        onClick={() => setSelected(row.symbol)}
                        className="font-mono text-xl font-semibold text-emerald-200 hover:underline"
                      >
                        {row.symbol}
                      </button>
                      <span className="font-mono text-xl text-slate-100">
                        ${fmtPrice(row.quote?.last)}
                      </span>
                      {row.quote?.changePct != null && (
                        <span
                          className={`text-xl ${
                            row.quote.changePct >= 0 ? "text-emerald-300/90" : "text-rose-300/90"
                          }`}
                        >
                          ({row.quote.changePct >= 0 ? "+" : ""}
                          {row.quote.changePct}%)
                        </span>
                      )}
                      <span className="ml-auto text-lg text-muted">Score {row.score}</span>
                    </div>
                    {row.ruleTargets && (
                      <dl className="mt-4 grid gap-3 text-xl sm:grid-cols-2">
                        <div className="rounded-lg bg-black/20 px-2 py-2">
                          <dt className="text-muted">Entry zone</dt>
                          <dd className="font-mono text-slate-200">
                            ${row.ruleTargets.entryLow} – ${row.ruleTargets.entryHigh}
                          </dd>
                        </div>
                        <div className="rounded-lg bg-black/20 px-2 py-2">
                          <dt className="text-muted">Stop / T1 / T2</dt>
                          <dd className="font-mono text-slate-200">
                            ${row.ruleTargets.stop} · ${row.ruleTargets.target1} · $
                            {row.ruleTargets.target2}
                          </dd>
                        </div>
                      </dl>
                    )}
                    <div className="mt-4 space-y-4">
                      <div>
                        <p className="mb-2 text-xl font-semibold uppercase tracking-wide text-slate-400">
                          Close price ({bulkPriceRange})
                        </p>
                        <PriceHistoryChart
                          rows={ph?.candles}
                          loading={!ph || ph.loading}
                          error={ph?.error}
                          needsSchwab={!!ph?.needsSchwab}
                          range={bulkPriceRange}
                          compact
                        />
                      </div>
                      <div>
                        <p className="mb-2 text-xl font-semibold uppercase tracking-wide text-slate-400">
                          OHLC table
                        </p>
                        <PriceHistoryTable
                          rows={ph?.candles}
                          loading={!ph || ph.loading}
                          error={ph?.error}
                          needsSchwab={!!ph?.needsSchwab}
                          range={bulkPriceRange}
                          compact
                        />
                      </div>
                    </div>
                    {row.claude && (
                      <div className="mt-4 border-t border-surface-border pt-4 text-xl leading-relaxed">
                        <span className="text-xl font-semibold uppercase tracking-wide text-violet-300/90">Claude</span>
                        <div className="mt-1 flex flex-wrap items-center gap-2">
                          <Badge
                            tone={
                              row.claude.bias === "constructive"
                                ? "up"
                                : row.claude.bias === "cautious"
                                  ? "down"
                                  : "neutral"
                            }
                          >
                            {row.claude.bias}
                          </Badge>
                          {row.claude.alignment === "needs_review" && (
                            <Badge tone="info">Headlines vs setup</Badge>
                          )}
                        </div>
                        <p className="mt-2 text-xl leading-relaxed text-slate-300">{row.claude.thesis}</p>
                        {row.claude.risks && (
                          <p className="mt-2 text-xl text-rose-200/85">Risks: {row.claude.risks}</p>
                        )}
                      </div>
                    )}
                    {row.claudeError && (
                      <p className="mt-2 text-xl text-amber-200/85">Claude: {row.claudeError}</p>
                    )}
                    {row.openai && (
                      <div className="mt-4 border-t border-surface-border pt-4 text-xl leading-relaxed">
                        <span className="text-xl font-semibold uppercase tracking-wide text-sky-300/90">ChatGPT</span>
                        <div className="mt-1 flex flex-wrap items-center gap-2">
                          <Badge
                            tone={
                              row.openai.bias === "constructive"
                                ? "up"
                                : row.openai.bias === "cautious"
                                  ? "down"
                                  : "neutral"
                            }
                          >
                            {row.openai.bias}
                          </Badge>
                          {row.openai.alignment === "needs_review" && (
                            <Badge tone="info">Headlines vs setup</Badge>
                          )}
                        </div>
                        <p className="mt-2 text-xl leading-relaxed text-slate-300">{row.openai.thesis}</p>
                        {row.openai.risks && (
                          <p className="mt-2 text-xl text-rose-200/85">Risks: {row.openai.risks}</p>
                        )}
                      </div>
                    )}
                    {row.openaiError && (
                      <p className="mt-2 text-xl text-amber-200/85">OpenAI: {row.openaiError}</p>
                    )}
                  </div>
                  );
                })}
              </div>
            )}
            </div>
          </div>

          <div className="rounded-2xl border border-violet-500/25 bg-violet-950/20 p-7 shadow-xl shadow-black/25 ring-1 ring-white/[0.07]">
            <SectionHeading variant="claude">Claude</SectionHeading>
            <div className="space-y-6">
          <div className="rounded-2xl border border-amber-500/30 bg-surface-card/90 p-6 shadow-lg shadow-black/40 ring-1 ring-black/20">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="text-2xl font-semibold tracking-tight text-slate-50">
                Live trade suggestions
              </h3>
              <span className="text-xl text-muted">
                Schwab quotes + rule targets + Claude · orders not sent
              </span>
            </div>
            <p className="mt-2 text-xl leading-relaxed text-muted">
              Ranked from discovery + news; entry/stop/targets use ATR-style volatility from recent daily
              bars. {tradeSuggestLoading && <span className="text-slate-400">Loading…</span>}
            </p>
            {tradeSuggest?.disclaimer && (
              <p className="mt-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 text-xl leading-relaxed text-amber-100/95">
                {tradeSuggest.disclaimer}
              </p>
            )}
            {tradeSuggestErr && (
              <p className="mt-2 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2.5 text-xl text-rose-100">
                {tradeSuggestErr}
              </p>
            )}
            {tradeSuggest?.needsSchwab && !tradeSuggestLoading && (
              <p className="mt-3 text-xl text-muted">
                Connect Schwab above for live quotes and rule-based levels.
              </p>
            )}
            {tradeSuggest?.noQuotes && tradeSuggest?.hint && (
              <p className="mt-3 text-xl text-amber-100/90">{tradeSuggest.hint}</p>
            )}
            {tradeSuggest?.error && (
              <p className="mt-2 text-xl text-rose-200/90">{tradeSuggest.error}</p>
            )}
            {tradeSuggest?.cacheHit && (
              <p className="mt-1 text-xl text-slate-500">Cached snapshot (short TTL).</p>
            )}
            {Array.isArray(tradeSuggest?.suggestions) && tradeSuggest.suggestions.length > 0 && (
              <div className="mt-5 space-y-6">
                {tradeSuggest.suggestions.map((s) => (
                  <div
                    key={s.symbol}
                    className="rounded-xl border border-surface-border bg-slate-950/45 px-5 py-5 shadow-md ring-1 ring-white/[0.06]"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <button
                        type="button"
                        onClick={() => setSelected(s.symbol)}
                        className="font-mono text-xl font-semibold text-blue-200 hover:underline"
                      >
                        {s.symbol}
                      </button>
                      <span className="text-xl text-muted">
                        Score {s.score} · Last ${s.quote?.last}{" "}
                        {s.quote?.changePct != null && (
                          <span
                            className={
                              s.quote.changePct >= 0 ? "text-emerald-300/90" : "text-rose-300/90"
                            }
                          >
                            ({s.quote.changePct >= 0 ? "+" : ""}
                            {s.quote.changePct}%)
                          </span>
                        )}
                      </span>
                    </div>
                    {s.ruleTargets && (
                      <dl className="mt-4 grid gap-3 text-xl sm:grid-cols-2">
                        <div className="rounded-lg bg-black/20 px-2 py-2">
                          <dt className="text-muted">Entry zone</dt>
                          <dd className="font-mono text-slate-200">
                            ${s.ruleTargets.entryLow} – ${s.ruleTargets.entryHigh}
                            {s.ruleTargets.atrIsEstimate && (
                              <span className="text-slate-500"> (ATR est.)</span>
                            )}
                          </dd>
                        </div>
                        <div className="rounded-lg bg-black/20 px-2 py-2">
                          <dt className="text-muted">Stop</dt>
                          <dd className="font-mono text-rose-200/90">${s.ruleTargets.stop}</dd>
                        </div>
                        <div className="rounded-lg bg-black/20 px-2 py-2">
                          <dt className="text-muted">Target 1 / 2</dt>
                          <dd className="font-mono text-emerald-200/90">
                            ${s.ruleTargets.target1} / ${s.ruleTargets.target2}
                          </dd>
                        </div>
                        <div className="rounded-lg bg-black/20 px-2 py-2">
                          <dt className="text-muted">ATR (eff.)</dt>
                          <dd className="font-mono text-slate-300">${s.ruleTargets.atr}</dd>
                        </div>
                      </dl>
                    )}
                    {s.claude?.thesis && (
                      <div className="mt-3 text-xl leading-relaxed text-slate-300">
                        <span className="text-xl font-semibold uppercase tracking-wide text-muted">Claude</span>
                        <p className="mt-1">{s.claude.thesis}</p>
                        {s.claude.risks && (
                          <p className="mt-2 text-xl text-rose-200/85">Risks: {s.claude.risks}</p>
                        )}
                        {s.claude.alignment === "needs_review" && (
                          <div className="mt-2">
                            <Badge tone="info">Needs review vs headlines</Badge>
                          </div>
                        )}
                      </div>
                    )}
                    {s.claudeError && (
                      <p className="mt-2 text-xl text-amber-200/80">{s.claudeError}</p>
                    )}
                    {s.claudeNote && (
                      <p className="mt-2 text-xl text-muted">{s.claudeNote}</p>
                    )}
                    {Array.isArray(s.headlines) && s.headlines.length > 0 && (
                      <ul className="mt-3 space-y-1.5 border-t border-surface-border pt-3 text-xl text-muted leading-snug">
                        {s.headlines.map((h, i) => (
                          <li key={i}>
                            {h.url ? (
                              <a
                                href={h.url}
                                target="_blank"
                                rel="noreferrer"
                                className="text-blue-200 hover:underline"
                              >
                                {h.title}
                              </a>
                            ) : (
                              h.title
                            )}
                            <span className="text-slate-600"> · {h.source}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                ))}
              </div>
            )}
            {!tradeSuggestLoading &&
              tradeSuggest &&
              !tradeSuggest.needsSchwab &&
              !tradeSuggest.noQuotes &&
              !tradeSuggest.error &&
              (!tradeSuggest.suggestions || tradeSuggest.suggestions.length === 0) &&
              !tradeSuggestErr && (
                <p className="mt-3 text-xl text-muted">No suggestions after filtering quotes.</p>
              )}
          </div>


          <div className="rounded-2xl border border-surface-border bg-surface-card/90 p-6 shadow-lg shadow-black/40 ring-1 ring-black/20">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="text-2xl font-semibold tracking-tight text-slate-50">
                Research briefing
              </h3>
              <span className="text-xl text-muted">
                Themes + watchlist-style ideas (evidence-linked)
              </span>
            </div>
            <p className="mt-2 text-xl leading-relaxed text-muted">
              Merges your news feeds, dedupes headlines, then runs a two-step Claude pass. Symbols must
              appear in the merged corpus or discovery rank — not invented.{" "}
              {briefingLoading && <span className="text-slate-400">Generating…</span>}
            </p>
            {briefingErr && (
              <p className="mt-2 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2.5 text-xl text-rose-100">
                {briefingErr}
              </p>
            )}
            {briefing?.disclaimer && (
              <p className="mt-2 rounded-lg border border-amber-500/25 bg-amber-500/5 px-3 py-2.5 text-xl leading-relaxed text-amber-100/90">
                {briefing.disclaimer}
              </p>
            )}
            {briefing?.skipped && briefing?.reason === "no_api_key" && !briefingLoading && (
              <p className="mt-3 text-xl text-muted">
                Set <span className="font-mono text-slate-400">ANTHROPIC_API_KEY</span> in root{" "}
                <span className="font-mono text-slate-400">.env</span> and refresh.
              </p>
            )}
            {briefing?.skipped && briefing?.reason === "thin_corpus" && !briefingLoading && (
              <p className="mt-3 text-xl text-muted">
                Not enough headlines to brief yet. Check feeds and try Refresh.
              </p>
            )}
            {briefing?.error && !briefing?.skipped && (
              <p className="mt-2 text-xl text-amber-200/90">Claude step: {briefing.error}</p>
            )}
            {briefing?.cacheHit && (
              <p className="mt-1 text-xl text-slate-500">Cached briefing (same headline set).</p>
            )}
            {Array.isArray(briefing?.themes) && briefing.themes.length > 0 && (
              <ul className="mt-4 space-y-3 text-xl">
                {briefing.themes.map((t) => (
                  <li
                    key={t.id || t.title}
                    className="rounded-lg border border-surface-border bg-surface/40 px-3 py-2"
                  >
                    <span className="font-medium text-slate-200">{t.title}</span>
                    {t.summary && (
                      <p className="mt-1 text-xl leading-relaxed text-slate-400">{t.summary}</p>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {Array.isArray(briefing?.uncertainties) && briefing.uncertainties.length > 0 && (
              <div className="mt-4">
                <h4 className="text-xl font-semibold uppercase tracking-wide text-muted">
                  Uncertainties
                </h4>
                <ul className="mt-2 list-inside list-disc space-y-1.5 text-xl text-slate-400">
                  {briefing.uncertainties.map((u, i) => (
                    <li key={i}>{u}</li>
                  ))}
                </ul>
              </div>
            )}
            {Array.isArray(briefing?.candidates) && briefing.candidates.length > 0 && (
              <div className="mt-4 space-y-4">
                <h4 className="text-xl font-semibold uppercase tracking-wide text-muted">
                  Research ideas (evidenced)
                </h4>
                {briefing.candidates.map((c) => (
                  <div
                    key={c.symbol}
                    className="rounded-lg border border-surface-border bg-surface/30 px-3 py-3"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setSelected(c.symbol)}
                        className="font-mono text-xl font-semibold text-blue-200 hover:underline"
                      >
                        {c.symbol}
                      </button>
                      <Badge tone="neutral">corpus-validated</Badge>
                    </div>
                    {c.thesis && (
                      <p className="mt-2 text-xl leading-relaxed text-slate-300">{c.thesis}</p>
                    )}
                    {c.risks && (
                      <p className="mt-1 text-xl leading-relaxed text-rose-200/80">Risks: {c.risks}</p>
                    )}
                    {Array.isArray(c.verifyNext) && c.verifyNext.length > 0 && (
                      <p className="mt-2 text-lg text-slate-500">
                        Verify: {c.verifyNext.join(" · ")}
                      </p>
                    )}
                    {Array.isArray(c.evidence) && c.evidence.length > 0 && (
                      <ul className="mt-2 space-y-1 border-t border-surface-border pt-2 text-lg text-muted">
                        {c.evidence.map((ev) => (
                          <li key={`${c.symbol}-${ev.bid}`}>
                            {ev.url ? (
                              <a
                                href={ev.url}
                                target="_blank"
                                rel="noreferrer"
                                className="text-blue-200 hover:underline"
                              >
                                {ev.title}
                              </a>
                            ) : (
                              ev.title
                            )}
                            <span className="text-slate-600"> · {ev.source}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                ))}
              </div>
            )}
            {!briefingLoading &&
              briefing &&
              !briefing.skipped &&
              (!briefing.themes || briefing.themes.length === 0) &&
              (!briefing.candidates || briefing.candidates.length === 0) &&
              !briefingErr && (
                <p className="mt-3 text-xl text-muted">No themes or candidates returned.</p>
              )}
          </div>
            </div>
          </div>

          <div className="rounded-2xl border border-sky-500/25 bg-sky-950/20 p-7 shadow-xl shadow-black/25 ring-1 ring-white/[0.07]">
            <SectionHeading variant="chatgpt">ChatGPT</SectionHeading>
            <div className="space-y-6">
              <div className="rounded-2xl border border-sky-500/20 bg-surface-card/90 p-6 shadow-lg shadow-black/40 ring-1 ring-black/20">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h3 className="text-2xl font-semibold tracking-tight text-slate-50">
                    Live trade suggestions
                  </h3>
                  <span className="text-lg text-muted">
                    Same rule levels as above · ChatGPT (OpenAI) narration
                  </span>
                </div>
                <p className="mt-1 text-lg text-muted">
                  Uses the same Schwab batch as Claude; only the AI narrative differs.{" "}
                  {tradeSuggestLoading && <span className="text-slate-400">Loading…</span>}
                </p>
                {tradeSuggest?.disclaimer && (
                  <p className="mt-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-lg text-amber-100/95">
                    {tradeSuggest.disclaimer}
                  </p>
                )}
                {Array.isArray(tradeSuggest?.suggestions) && tradeSuggest.suggestions.length > 0 && (
                  <div className="mt-4 space-y-5">
                    {tradeSuggest.suggestions.map((s) => (
                      <div
                        key={`gpt-${s.symbol}`}
                        className="rounded-xl border border-surface-border bg-surface/40 px-4 py-4"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="font-mono text-xl font-semibold text-sky-200">
                            {s.symbol}
                          </span>
                        </div>
                        {s.chatgpt?.thesis && (
                          <div className="mt-3 text-xl leading-relaxed text-slate-300">
                            <span className="text-xl font-semibold uppercase text-sky-300/90">
                              ChatGPT
                            </span>
                            <p className="mt-1">{s.chatgpt.thesis}</p>
                            {s.chatgpt.risks && (
                              <p className="mt-2 text-xl text-rose-200/85">Risks: {s.chatgpt.risks}</p>
                            )}
                            {s.chatgpt.alignment === "needs_review" && (
                              <div className="mt-2">
                                <Badge tone="info">Needs review vs headlines</Badge>
                              </div>
                            )}
                          </div>
                        )}
                        {s.chatgptError && (
                          <p className="mt-2 text-xl text-amber-200/80">{s.chatgptError}</p>
                        )}
                        {s.chatgptNote && (
                          <p className="mt-2 text-xl text-muted">{s.chatgptNote}</p>
                        )}
                        {!s.chatgpt?.thesis && !s.chatgptError && !s.chatgptNote && !tradeSuggestLoading && (
                          <p className="mt-2 text-lg text-muted">No ChatGPT narrative for this row.</p>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="rounded-2xl border border-surface-border bg-surface-card/90 p-6 shadow-lg shadow-black/40 ring-1 ring-black/20">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h3 className="text-2xl font-semibold tracking-tight text-slate-50">
                    Research briefing
                  </h3>
                  <span className="text-lg text-muted">
                    Themes + watchlist-style ideas (evidence-linked)
                  </span>
                </div>
                <p className="mt-1 text-lg text-muted">
                  Merges your news feeds, dedupes headlines, then runs a two-step OpenAI pass. Symbols must
                  appear in the merged corpus or discovery rank — not invented.{" "}
                  {briefingLoading && <span className="text-slate-400">Generating…</span>}
                </p>
                {briefingChatgpt?.disclaimer && (
                  <p className="mt-2 rounded-lg border border-amber-500/25 bg-amber-500/5 px-3 py-2 text-lg text-amber-100/90">
                    {briefingChatgpt.disclaimer}
                  </p>
                )}
                {briefingChatgpt?.skipped && briefingChatgpt?.reason === "no_api_key" && !briefingLoading && (
                  <p className="mt-3 text-xl text-muted">
                    Set <span className="font-mono text-slate-400">OPENAI_API_KEY</span> in root{" "}
                    <span className="font-mono text-slate-400">.env</span> and refresh (see{" "}
                    <a
                      className="text-blue-300 underline"
                      href="https://platform.openai.com/api-keys"
                      target="_blank"
                      rel="noreferrer"
                    >
                      OpenAI API keys
                    </a>
                    ).
                  </p>
                )}
                {briefingChatgpt?.skipped && briefingChatgpt?.reason === "thin_corpus" && !briefingLoading && (
                  <p className="mt-3 text-xl text-muted">
                    Not enough headlines to brief yet. Check feeds and try Refresh.
                  </p>
                )}
                {briefingChatgpt?.error && !briefingChatgpt?.skipped && (
                  <p className="mt-2 text-lg text-amber-200/90">
                    OpenAI step: {briefingChatgpt.error}
                  </p>
                )}
                {briefingChatgpt?.cacheHit && (
                  <p className="mt-1 text-lg text-slate-500">Cached briefing (same headline set).</p>
                )}
                {Array.isArray(briefingChatgpt?.themes) && briefingChatgpt.themes.length > 0 && (
                  <ul className="mt-4 space-y-3 text-xl">
                    {briefingChatgpt.themes.map((t) => (
                      <li
                        key={`gpt-${t.id || t.title}`}
                        className="rounded-lg border border-surface-border bg-surface/40 px-3 py-2"
                      >
                        <span className="font-medium text-slate-200">{t.title}</span>
                        {t.summary && (
                          <p className="mt-1 text-xl leading-relaxed text-slate-400">{t.summary}</p>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
                {Array.isArray(briefingChatgpt?.uncertainties) &&
                  briefingChatgpt.uncertainties.length > 0 && (
                    <div className="mt-4">
                      <h4 className="text-xl font-semibold uppercase tracking-wide text-muted">
                        Uncertainties
                      </h4>
                      <ul className="mt-2 list-inside list-disc space-y-1 text-lg text-slate-400">
                        {briefingChatgpt.uncertainties.map((u, i) => (
                          <li key={i}>{u}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                {Array.isArray(briefingChatgpt?.candidates) && briefingChatgpt.candidates.length > 0 && (
                  <div className="mt-4 space-y-4">
                    <h4 className="text-xl font-semibold uppercase tracking-wide text-muted">
                      Research ideas (evidenced)
                    </h4>
                    {briefingChatgpt.candidates.map((c) => (
                      <div
                        key={`gpt-${c.symbol}`}
                        className="rounded-lg border border-surface-border bg-surface/30 px-3 py-3"
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            onClick={() => setSelected(c.symbol)}
                            className="font-mono text-xl font-semibold text-sky-200 hover:underline"
                          >
                            {c.symbol}
                          </button>
                          <Badge tone="neutral">corpus-validated</Badge>
                        </div>
                        {c.thesis && (
                          <p className="mt-2 text-xl leading-relaxed text-slate-300">{c.thesis}</p>
                        )}
                        {c.risks && (
                          <p className="mt-1 text-xl leading-relaxed text-rose-200/80">
                            Risks: {c.risks}
                          </p>
                        )}
                        {Array.isArray(c.evidence) && c.evidence.length > 0 && (
                          <ul className="mt-2 space-y-1 border-t border-surface-border pt-2 text-lg text-muted">
                            {c.evidence.map((ev) => (
                              <li key={`gpt-${c.symbol}-${ev.bid}`}>
                                {ev.url ? (
                                  <a
                                    href={ev.url}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="text-blue-200 hover:underline"
                                  >
                                    {ev.title}
                                  </a>
                                ) : (
                                  ev.title
                                )}
                                <span className="text-slate-600"> · {ev.source}</span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    ))}
                  </div>
                )}
                {!briefingLoading &&
                  briefingChatgpt &&
                  !briefingChatgpt.skipped &&
                  (!briefingChatgpt.themes || briefingChatgpt.themes.length === 0) &&
                  (!briefingChatgpt.candidates || briefingChatgpt.candidates.length === 0) &&
                  !briefingChatgpt?.error && (
                    <p className="mt-3 text-xl text-muted">No themes or candidates returned.</p>
                  )}
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-teal-500/25 bg-teal-950/15 p-7 shadow-xl shadow-black/25 ring-1 ring-white/[0.07]">
            <SectionHeading variant="news">News</SectionHeading>
            <div className="space-y-6">
          <div className="rounded-2xl border border-surface-border bg-surface-card/90 p-6 shadow-lg shadow-black/40 ring-1 ring-black/20">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="text-2xl font-semibold tracking-tight text-slate-50">
                Seeking Alpha
              </h3>
              <span className="text-lg text-muted">
                RapidAPI · consensus ratings (get-ratings)
              </span>
            </div>
            <p className="mt-1 text-lg text-muted">
              Quant, author, and sell-side scores from Seeking Alpha — same{" "}
              <span className="font-mono text-slate-400">RAPIDAPI_KEY</span> after you subscribe to
              the Seeking Alpha API on RapidAPI.
            </p>
            {discover?.news?.errors?.find((e) => e.source === "seeking_alpha") && (
              <p className="mt-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-lg text-amber-100">
                Seeking Alpha:{" "}
                {
                  discover.news.errors.find((e) => e.source === "seeking_alpha")
                    ?.error
                }
              </p>
            )}
            <ul className="mt-4 max-h-72 space-y-4 overflow-y-auto pr-1 text-xl">
              {(discover?.seekingAlpha || []).length === 0 && !loading && (
                <li className="rounded-lg border border-dashed border-surface-border bg-surface/40 px-3 py-4 text-xl text-muted">
                  No Seeking Alpha data yet. Use your RapidAPI application key in root{" "}
                  <span className="font-mono text-slate-400">.env</span> as{" "}
                  <span className="font-mono text-slate-400">RAPIDAPI_KEY</span>, subscribe to
                  Seeking Alpha on RapidAPI, restart the dev server, and click Refresh.
                </li>
              )}
              {(discover?.seekingAlpha || []).map((item) => (
                <li
                  key={item.id}
                  className="border-b border-surface-border pb-4 last:border-0"
                >
                  <a
                    href={item.url || "#"}
                    target="_blank"
                    rel="noreferrer"
                    className="font-medium text-blue-200 hover:underline"
                  >
                    {item.title}
                  </a>
                  <p className="mt-1 text-xl leading-relaxed text-slate-400">
                    {item.description}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {item.symbol && <Badge tone="neutral">{item.symbol}</Badge>}
                    {item.ratings?.quantRating != null && (
                      <span className="text-lg text-muted">
                        Quant {Number(item.ratings.quantRating).toFixed(2)}
                      </span>
                    )}
                    {item.ratings?.asDate && (
                      <time
                        className="text-lg text-slate-500"
                        dateTime={item.publishedAt}
                      >
                        {item.ratings.asDate}
                      </time>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </div>

          <div className="rounded-2xl border border-surface-border bg-surface-card/90 p-6 shadow-lg shadow-black/40 ring-1 ring-black/20">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="text-2xl font-semibold tracking-tight text-slate-50">
                Real-time finance data
              </h3>
              <span className="text-lg text-muted">
                {"RapidAPI · stock & currency headlines"}
              </span>
            </div>
            <p className="mt-1 text-lg text-muted">
              Latest items from your Real-Time Finance Data subscription (refreshes with{" "}
              <span className="font-mono text-slate-400">Refresh</span> above).
            </p>
            {discover?.news?.errors?.find(
              (e) => e.source === "rapidapi_realtime_finance"
            ) && (
              <p className="mt-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-lg text-amber-100">
                Real-Time Finance API:{" "}
                {
                  discover.news.errors.find(
                    (e) => e.source === "rapidapi_realtime_finance"
                  )?.error
                }
              </p>
            )}
            <ul className="mt-4 max-h-80 space-y-3 overflow-y-auto pr-1 text-xl">
              {(discover?.realtimeFinanceNews || []).length === 0 && !loading && (
                <li className="rounded-lg border border-dashed border-surface-border bg-surface/40 px-3 py-4 text-xl text-muted">
                  No real-time finance headlines yet. Add{" "}
                  <span className="font-mono text-slate-400">RAPIDAPI_KEY</span> to the{" "}
                  <span className="font-mono text-slate-400">.env</span> file at the{" "}
                  <strong className="font-medium text-slate-300">project root</strong> (next to the
                  root <span className="font-mono text-slate-400">package.json</span>), subscribe to
                  Real-Time Finance Data on RapidAPI, then{" "}
                  <strong className="font-medium text-slate-300">restart</strong>{" "}
                  <span className="font-mono text-slate-400">npm run dev</span> and click Refresh.
                  Check <span className="font-mono text-slate-400">/api/health</span> —{" "}
                  <span className="font-mono text-slate-400">rapidapiKeyLoaded</span> should be{" "}
                  <span className="font-mono text-slate-400">true</span>.
                </li>
              )}
              {(discover?.realtimeFinanceNews || []).map((n) => (
                <li
                  key={n.id}
                  className="border-b border-surface-border pb-3 last:border-0"
                >
                  <a
                    href={n.url || "#"}
                    target="_blank"
                    rel="noreferrer"
                    className="font-medium text-blue-200 hover:underline"
                  >
                    {n.title}
                  </a>
                  <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-lg text-muted">
                    <span>{n.source}</span>
                    {n.realtimeContext && (
                      <Badge tone="neutral">{n.realtimeContext}</Badge>
                    )}
                    {n.outlet === "realtime_finance_currency" && (
                      <span className="text-slate-500">FX</span>
                    )}
                    {n.publishedAt && (
                      <time className="text-slate-500" dateTime={n.publishedAt}>
                        {new Date(n.publishedAt).toLocaleString(undefined, {
                          month: "short",
                          day: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </time>
                    )}
                  </p>
                </li>
              ))}
            </ul>
          </div>

          <div className="rounded-2xl border border-surface-border bg-surface-card/90 p-6 shadow-lg shadow-black/40 ring-1 ring-black/20">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="text-2xl font-semibold tracking-tight text-slate-50">
                Yahoo Finance
              </h3>
              <span className="text-lg text-muted">
                RapidAPI · YH Finance · /v1/markets/news + ticker (see .env.example)
              </span>
            </div>
            <p className="mt-1 text-lg text-muted">
              Market headlines — use{" "}
              <span className="font-mono text-slate-400">YH_FINANCE_REQUEST_URL</span> (full URL from
              RapidAPI Code snippets) or defaults:{" "}
              <span className="font-mono text-slate-400">/v1/markets/news</span> with{" "}
              <span className="font-mono text-slate-400">YH_FINANCE_NEWS_TICKERS</span>. Same{" "}
              <span className="font-mono text-slate-400">RAPIDAPI_KEY</span> or{" "}
              <span className="font-mono text-slate-400">YH_FINANCE_RAPIDAPI_KEY</span>.
            </p>
            {discover?.news?.errors?.find((e) => e.source === "yahoo_finance_api") && (
              <p className="mt-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-lg text-amber-100">
                Yahoo Finance API:{" "}
                {
                  discover.news.errors.find((e) => e.source === "yahoo_finance_api")
                    ?.error
                }
              </p>
            )}
            <ul className="mt-4 max-h-80 space-y-3 overflow-y-auto pr-1 text-xl">
              {(discover?.yahooFinanceNews || []).length === 0 && !loading && (
                <li className="rounded-lg border border-dashed border-surface-border bg-surface/40 px-3 py-4 text-xl text-muted">
                  No Yahoo Finance headlines yet. Set <span className="font-mono text-slate-400">RAPIDAPI_KEY</span>{" "}
                  in root <span className="font-mono text-slate-400">.env</span>, subscribe to{" "}
                  <strong className="font-medium text-slate-300">YH Finance</strong> on RapidAPI,
                  restart <span className="font-mono text-slate-400">npm run dev</span>, then Refresh.
                </li>
              )}
              {(discover?.yahooFinanceNews || []).map((n) => (
                <li
                  key={n.id}
                  className="border-b border-surface-border pb-3 last:border-0"
                >
                  <a
                    href={n.url || "#"}
                    target="_blank"
                    rel="noreferrer"
                    className="font-medium text-blue-200 hover:underline"
                  >
                    {n.title}
                  </a>
                  {n.description && (
                    <p className="mt-1 text-xl leading-relaxed text-slate-500">
                      {(n.description || "").slice(0, 280)}
                      {(n.description || "").length > 280 ? "…" : ""}
                    </p>
                  )}
                  <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-lg text-muted">
                    <span>{n.source}</span>
                    {n.publishedAt && (
                      <time className="text-slate-500" dateTime={n.publishedAt}>
                        {new Date(n.publishedAt).toLocaleString(undefined, {
                          month: "short",
                          day: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </time>
                    )}
                  </p>
                </li>
              ))}
            </ul>
          </div>

          <div className="rounded-2xl border border-surface-border bg-surface-card/90 p-6 shadow-lg shadow-black/40 ring-1 ring-black/20">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="text-2xl font-semibold tracking-tight text-slate-50">
                CNBC
              </h3>
              <span className="text-lg text-muted">
                RapidAPI · cnbc-markets-and-news-data.p.rapidapi.com
              </span>
            </div>
            <p className="mt-1 text-lg text-muted">
              Headlines from the CNBC Markets &amp; News Data API — same root{" "}
              <span className="font-mono text-slate-400">RAPIDAPI_KEY</span> after you subscribe on
              RapidAPI.
            </p>
            {discover?.news?.errors?.find(
              (e) => e.source === "cnbc_markets_news_api"
            ) && (
              <p className="mt-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-lg text-amber-100">
                CNBC API:{" "}
                {
                  discover.news.errors.find(
                    (e) => e.source === "cnbc_markets_news_api"
                  )?.error
                }
              </p>
            )}
            <ul className="mt-4 max-h-80 space-y-3 overflow-y-auto pr-1 text-xl">
              {(discover?.cnbcMarketsNews || []).length === 0 && !loading && (
                <li className="rounded-lg border border-dashed border-surface-border bg-surface/40 px-3 py-4 text-xl text-muted">
                  No CNBC headlines yet. Set root <span className="font-mono text-slate-400">.env</span>{" "}
                  <span className="font-mono text-slate-400">RAPIDAPI_KEY</span>, subscribe to{" "}
                  <strong className="font-medium text-slate-300">CNBC Markets and News Data</strong>{" "}
                  on RapidAPI, restart <span className="font-mono text-slate-400">npm run dev</span>,
                  then Refresh.
                </li>
              )}
              {(discover?.cnbcMarketsNews || []).map((n) => (
                <li
                  key={n.id}
                  className="border-b border-surface-border pb-3 last:border-0"
                >
                  <a
                    href={n.url || "#"}
                    target="_blank"
                    rel="noreferrer"
                    className="font-medium text-blue-200 hover:underline"
                  >
                    {n.title}
                  </a>
                  <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-lg text-muted">
                    <span>{n.source}</span>
                    {n.cnbcCategory && (
                      <Badge tone="neutral">{n.cnbcCategory}</Badge>
                    )}
                    {n.timeLabel && (
                      <span className="text-slate-500">{n.timeLabel}</span>
                    )}
                  </p>
                </li>
              ))}
            </ul>
          </div>

          <div className="rounded-2xl border border-surface-border bg-surface-card/90 p-6 shadow-lg shadow-black/40 ring-1 ring-black/20">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="text-2xl font-semibold tracking-tight text-slate-50">
                Reuters
              </h3>
              <span className="text-lg text-muted">
                RapidAPI · reuters-business-and-financial-news.p.rapidapi.com
              </span>
            </div>
            <p className="mt-1 text-lg text-muted">
              Business and financial articles (date range) — same root{" "}
              <span className="font-mono text-slate-400">RAPIDAPI_KEY</span> after you subscribe to
              Reuters Business and Financial News on RapidAPI.
            </p>
            {discover?.news?.errors?.find(
              (e) => e.source === "reuters_business_news_api"
            ) && (
              <p className="mt-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-lg text-amber-100">
                Reuters API:{" "}
                {
                  discover.news.errors.find(
                    (e) => e.source === "reuters_business_news_api"
                  )?.error
                }
              </p>
            )}
            <ul className="mt-4 max-h-80 space-y-3 overflow-y-auto pr-1 text-xl">
              {(discover?.reutersBusinessNews || []).length === 0 && !loading && (
                <li className="rounded-lg border border-dashed border-surface-border bg-surface/40 px-3 py-4 text-xl text-muted">
                  No Reuters articles yet. Set root <span className="font-mono text-slate-400">.env</span>{" "}
                  <span className="font-mono text-slate-400">RAPIDAPI_KEY</span>, subscribe to{" "}
                  <strong className="font-medium text-slate-300">
                    Reuters Business and Financial News
                  </strong>
                  , restart <span className="font-mono text-slate-400">npm run dev</span>, then
                  Refresh.
                </li>
              )}
              {(discover?.reutersBusinessNews || []).map((n) => (
                <li
                  key={n.id}
                  className="border-b border-surface-border pb-3 last:border-0"
                >
                  <a
                    href={n.url || "#"}
                    target="_blank"
                    rel="noreferrer"
                    className="font-medium text-blue-200 hover:underline"
                  >
                    {n.title}
                  </a>
                  {n.description && (
                    <p className="mt-1 text-xl leading-relaxed text-slate-500">
                      {n.description}
                    </p>
                  )}
                  <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-lg text-muted">
                    <span>{n.source}</span>
                    {n.categoryName && <Badge tone="neutral">{n.categoryName}</Badge>}
                    {n.publishedAt && (
                      <time className="text-slate-500" dateTime={n.publishedAt}>
                        {new Date(n.publishedAt).toLocaleString(undefined, {
                          month: "short",
                          day: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </time>
                    )}
                  </p>
                </li>
              ))}
            </ul>
          </div>

          <div className="rounded-2xl border border-surface-border bg-surface-card/90 p-6 shadow-lg shadow-black/40 ring-1 ring-black/20">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="text-2xl font-semibold tracking-tight text-slate-50">
                Real-time News Data
              </h3>
              <span className="text-lg text-muted">
                RapidAPI · real-time-news-data.p.rapidapi.com
              </span>
            </div>
            <p className="mt-1 text-lg text-muted">
              Top business headlines via your RapidAPI app key (
              <span className="font-mono text-slate-400">RAPIDAPI_KEY</span> in root{" "}
              <span className="font-mono text-slate-400">.env</span>). Subscribe to{" "}
              <strong className="font-medium text-slate-300">Real-Time News Data</strong> on
              RapidAPI.
            </p>
            {discover?.news?.errors?.find(
              (e) => e.source === "realtime_news_data_api"
            ) && (
              <p className="mt-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-lg text-amber-100">
                Real-Time News Data API:{" "}
                {
                  discover.news.errors.find(
                    (e) => e.source === "realtime_news_data_api"
                  )?.error
                }
              </p>
            )}
            <ul className="mt-4 max-h-80 space-y-3 overflow-y-auto pr-1 text-xl">
              {(discover?.realTimeNewsData || []).length === 0 && !loading && (
                <li className="rounded-lg border border-dashed border-surface-border bg-surface/40 px-3 py-4 text-xl text-muted">
                  No headlines yet. Set root <span className="font-mono text-slate-400">.env</span>{" "}
                  <span className="font-mono text-slate-400">RAPIDAPI_KEY</span>, subscribe to the
                  Real-Time News Data API on RapidAPI, restart{" "}
                  <span className="font-mono text-slate-400">npm run dev</span>, then Refresh.
                </li>
              )}
              {(discover?.realTimeNewsData || []).map((n) => (
                <li
                  key={n.id}
                  className="border-b border-surface-border pb-3 last:border-0"
                >
                  <a
                    href={n.url || "#"}
                    target="_blank"
                    rel="noreferrer"
                    className="font-medium text-blue-200 hover:underline"
                  >
                    {n.title}
                  </a>
                  {n.description && (
                    <p className="mt-1 text-xl leading-relaxed text-slate-500">
                      {n.description}
                    </p>
                  )}
                  <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-lg text-muted">
                    <span>{n.source}</span>
                    {n.publishedAt && (
                      <time className="text-slate-500" dateTime={n.publishedAt}>
                        {new Date(n.publishedAt).toLocaleString(undefined, {
                          month: "short",
                          day: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </time>
                    )}
                  </p>
                </li>
              ))}
            </ul>
          </div>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-500/35 bg-slate-950/35 p-7 shadow-xl shadow-black/25 ring-1 ring-white/[0.07]">
            <SectionHeading variant="discovery">Discovery</SectionHeading>
            <div className="space-y-6">
          <div className="overflow-hidden rounded-2xl border border-surface-border bg-surface-card/90 shadow-xl shadow-black/40 ring-1 ring-black/20">
            <table className="w-full text-left text-xl">
              <thead className="bg-surface/80 text-xl uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-4 py-3 font-medium">Symbol</th>
                  <th className="px-4 py-3 font-medium">Score</th>
                  <th className="px-4 py-3 font-medium">Signals</th>
                </tr>
              </thead>
              <tbody>
                {(discover?.ranked || []).slice(0, 12).map((row) => (
                  <tr
                    key={row.symbol}
                    className={`cursor-pointer border-t border-surface-border transition hover:bg-white/5 ${
                      selected === row.symbol ? "bg-accent/10" : ""
                    }`}
                    onClick={() => setSelected(row.symbol)}
                  >
                    <td className="px-4 py-3 font-mono text-xl font-medium">{row.symbol}</td>
                    <td className="px-4 py-3 text-xl text-muted">{row.score.toFixed(2)}</td>
                    <td className="px-4 py-3 text-lg text-slate-400">
                      {(row.reasons || []).slice(0, 4).join(" · ")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="rounded-2xl border border-surface-border bg-surface-card/90 p-6 shadow-xl shadow-black/40 ring-1 ring-black/20">
            <h3 className="mb-4 text-2xl font-semibold tracking-tight text-slate-200">
              News mention intensity
            </h3>
            <div className="h-56 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e2636" />
                  <XAxis dataKey="symbol" stroke="#8b9cb5" tick={{ fontSize: 12 }} />
                  <YAxis stroke="#8b9cb5" tick={{ fontSize: 12 }} />
                  <Tooltip
                    contentStyle={{
                      background: "#121722",
                      border: "1px solid #1e2636",
                      borderRadius: 8,
                    }}
                  />
                  <Bar dataKey="mentions" fill="#3b82f6" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
            </div>
          </div>
        </section>

        <aside className="space-y-6">
          <div className="rounded-2xl border border-surface-border bg-surface-card/80 p-6 shadow-xl shadow-black/40 ring-1 ring-white/[0.06]">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <h2 className="text-2xl font-semibold">{selected || "—"}</h2>
                {(tradeAiView?.quote?.last != null || analysis?.analysis?.price != null) && (
                  <span className="font-mono text-slate-100">
                    ${fmtPrice(tradeAiView?.quote?.last ?? analysis?.analysis?.price)}
                  </span>
                )}
              </div>
              {analysis?.analysis?.changePct != null && (
                <Badge tone={analysis.analysis.changePct >= 0 ? "up" : "down"}>
                  {analysis.analysis.changePct >= 0 ? "+" : ""}
                  {analysis.analysis.changePct}%
                </Badge>
              )}
            </div>
            {analysisLoading && (
              <p className="mt-3 text-xl text-muted">Pulling analysis…</p>
            )}
            {analysis?.analysis && (
              <dl className="mt-4 space-y-3 text-xl">
                <div className="flex justify-between gap-4">
                  <dt className="text-muted">Price</dt>
                  <dd className="font-mono">{analysis.analysis.price}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-muted">RSI</dt>
                  <dd className="font-mono">
                    {analysis.analysis.rsi ?? "—"}
                  </dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-muted">MACD</dt>
                  <dd className="font-mono text-xl">
                    {analysis.analysis.macd
                      ? JSON.stringify(analysis.analysis.macd)
                      : "—"}
                  </dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-muted">News sentiment</dt>
                  <dd className="font-mono">{analysis.analysis.news_sentiment}</dd>
                </div>
              </dl>
            )}
          </div>

          <div className="rounded-2xl border border-surface-border bg-surface-card/80 p-6 shadow-xl shadow-black/40 ring-1 ring-white/[0.06]">
            <h3 className="text-2xl font-semibold text-slate-200">AI insight</h3>
            <div className="mt-4 space-y-5">
              <div>
                <p className="text-xl font-semibold uppercase tracking-wide text-violet-300/90">
                  Claude
                </p>
                <div className="mt-2 whitespace-pre-wrap text-xl leading-relaxed text-slate-200">
                  {analysis?.insight?.text || "Select a symbol or wait for analysis."}
                </div>
                {analysis?.insight?.provider && (
                  <p className="mt-2 text-xl text-muted">
                    Provider: {analysis.insight.provider}
                  </p>
                )}
              </div>
              <div className="border-t border-surface-border pt-5">
                <p className="text-xl font-semibold uppercase tracking-wide text-sky-300/90">
                  ChatGPT
                </p>
                <div className="mt-2 whitespace-pre-wrap text-xl leading-relaxed text-slate-200">
                  {analysisLoading && !analysis?.insightChatgpt?.text
                    ? "…"
                    : analysis?.insightChatgpt?.text ||
                      "OpenAI insight appears when OPENAI_API_KEY is set and insight is requested."}
                </div>
                {analysis?.insightChatgpt?.provider && (
                  <p className="mt-2 text-xl text-muted">
                    Provider: {analysis.insightChatgpt.provider}
                  </p>
                )}
                {analysis?.insightChatgpt?.error && (
                  <p className="mt-2 text-xl text-amber-200/85">{analysis.insightChatgpt.error}</p>
                )}
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-surface-border bg-surface-card/80 p-6 shadow-xl shadow-black/40 ring-1 ring-white/[0.06]">
            <h3 className="text-2xl font-semibold text-slate-200">AI trade view (selected ticker)</h3>
            <p className="mt-2 text-xl leading-relaxed text-muted">
              Schwab quote + ATR rule levels + latest headlines; Claude and ChatGPT add bias and copy.{" "}
              {tradeAiViewLoading && <span className="text-slate-400">Loading…</span>}
            </p>
            {tradeAiView?.disclaimer && (
              <p className="mt-2 rounded-lg border border-amber-500/25 bg-amber-500/5 px-3 py-2 text-xl leading-relaxed text-amber-100/90">
                {tradeAiView.disclaimer}
              </p>
            )}
            {tradeAiView?.needsSchwab && !tradeAiViewLoading && (
              <p className="mt-2 text-xl text-muted">Connect Schwab in the header for live levels.</p>
            )}
            {tradeAiView?.error && (
              <p className="mt-2 text-xl text-rose-200/90">{tradeAiView.error}</p>
            )}
            {tradeAiView?.ruleTargets && (
              <dl className="mt-4 space-y-2.5 text-xl">
                <div className="flex justify-between gap-2">
                  <dt className="text-muted">Entry</dt>
                  <dd className="font-mono text-slate-200">
                    ${tradeAiView.ruleTargets.entryLow} – ${tradeAiView.ruleTargets.entryHigh}
                  </dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-muted">Stop</dt>
                  <dd className="font-mono text-rose-200/90">${tradeAiView.ruleTargets.stop}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-muted">Targets</dt>
                  <dd className="font-mono text-emerald-200/85">
                    ${tradeAiView.ruleTargets.target1} / ${tradeAiView.ruleTargets.target2}
                  </dd>
                </div>
              </dl>
            )}
            <div className="mt-4 border-t border-surface-border pt-4">
              <p className="text-xl font-semibold text-slate-300">Schwab price history</p>
              <div className="mt-2">
                <PriceRangePicker value={sidebarPriceRange} onChange={setSidebarPriceRange} />
              </div>
              <div className="mt-4 space-y-4">
                <div>
                  <p className="mb-2 text-xl font-semibold uppercase tracking-wide text-slate-400">
                    Close price ({sidebarPriceRange})
                  </p>
                  <PriceHistoryChart
                    rows={sidebarPriceHistory.candles}
                    loading={sidebarPriceHistory.loading}
                    error={sidebarPriceHistory.error}
                    needsSchwab={sidebarPriceHistory.needsSchwab}
                    range={sidebarPriceRange}
                  />
                </div>
                <div>
                  <p className="mb-2 text-xl font-semibold uppercase tracking-wide text-slate-400">
                    OHLC table
                  </p>
                  <PriceHistoryTable
                    rows={sidebarPriceHistory.candles}
                    loading={sidebarPriceHistory.loading}
                    error={sidebarPriceHistory.error}
                    needsSchwab={sidebarPriceHistory.needsSchwab}
                    range={sidebarPriceRange}
                  />
                </div>
              </div>
            </div>
            {tradeAiView?.claude && (
              <div className="mt-4 border-t border-surface-border pt-4">
                <p className="text-xl font-semibold uppercase tracking-wide text-violet-300/90">Claude</p>
                <div className="mt-1">
                  <Badge
                    tone={
                      tradeAiView.claude.bias === "constructive"
                        ? "up"
                        : tradeAiView.claude.bias === "cautious"
                          ? "down"
                          : "neutral"
                    }
                  >
                    {tradeAiView.claude.bias}
                  </Badge>
                </div>
                <p className="mt-2 text-xl leading-relaxed text-slate-200">{tradeAiView.claude.thesis}</p>
                {tradeAiView.claude.risks && (
                  <p className="mt-1 text-xl text-rose-200/80">Risks: {tradeAiView.claude.risks}</p>
                )}
              </div>
            )}
            {tradeAiView?.claudeError && (
              <p className="mt-2 text-xl text-amber-200/85">{tradeAiView.claudeError}</p>
            )}
            {tradeAiView?.openai && (
              <div className="mt-4 border-t border-surface-border pt-4">
                <p className="text-xl font-semibold uppercase tracking-wide text-sky-300/90">ChatGPT</p>
                <div className="mt-1">
                  <Badge
                    tone={
                      tradeAiView.openai.bias === "constructive"
                        ? "up"
                        : tradeAiView.openai.bias === "cautious"
                          ? "down"
                          : "neutral"
                    }
                  >
                    {tradeAiView.openai.bias}
                  </Badge>
                </div>
                <p className="mt-2 text-xl leading-relaxed text-slate-200">{tradeAiView.openai.thesis}</p>
                {tradeAiView.openai.risks && (
                  <p className="mt-1 text-xl text-rose-200/80">Risks: {tradeAiView.openai.risks}</p>
                )}
              </div>
            )}
            {tradeAiView?.openaiError && (
              <p className="mt-2 text-xl text-amber-200/85">{tradeAiView.openaiError}</p>
            )}
          </div>

          <div className="rounded-2xl border border-surface-border bg-surface-card/80 p-6 shadow-xl shadow-black/40 ring-1 ring-white/[0.06]">
            <h3 className="text-2xl font-semibold text-slate-200">Related headlines</h3>
            <ul className="mt-4 space-y-3 text-xl">
              {(analysis?.relatedNews || []).map((n) => (
                <li key={n.id} className="border-b border-surface-border pb-3 last:border-0">
                  <a
                    href={n.url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xl font-medium text-blue-200 hover:underline"
                  >
                    {n.title}
                  </a>
                  <p className="mt-1 text-xl text-muted">
                    {n.source}
                    {Array.isArray(n.categories) && n.categories.length > 0 && (
                      <span className="text-slate-500">
                        {" "}
                        · {n.categories.join(", ")}
                      </span>
                    )}
                  </p>
                </li>
              ))}
            </ul>
          </div>
        </aside>
      </main>
    </div>
  );
}
