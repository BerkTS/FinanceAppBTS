import { buildOrderedSnapshot, mergeTodaySnapshot, msUntilNext630PMET } from "./historyStore.js";

/**
 * Fires at 6:00 PM America/New_York every calendar day (Mon–Sun): NYSE cash close + 2h,
 * so after-hours and weekend headlines can be captured in that day's history row.
 */
export function subscribeHistory630ETFinalize(getPayload) {
  let timerId = null;

  const runAndReschedule = () => {
    const payload = typeof getPayload === "function" ? getPayload() : null;
    if (payload) {
      const snap = buildOrderedSnapshot(payload);
      mergeTodaySnapshot(snap);
    }
    clearTimeout(timerId);
    const ms = msUntilNext630PMET();
    timerId = setTimeout(runAndReschedule, Math.max(ms, 5_000));
  };

  const ms0 = msUntilNext630PMET();
  timerId = setTimeout(runAndReschedule, Math.max(ms0, 5_000));

  const onVisibility = () => {
    if (document.visibilityState === "visible") {
      clearTimeout(timerId);
      const ms = msUntilNext630PMET();
      timerId = setTimeout(runAndReschedule, Math.max(ms, 5_000));
    }
  };
  document.addEventListener("visibilitychange", onVisibility);

  return () => {
    clearTimeout(timerId);
    document.removeEventListener("visibilitychange", onVisibility);
  };
}
