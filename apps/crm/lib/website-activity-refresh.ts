// Pause hidden tabs and refresh immediately when staff return to the report.
export function observeActivityRefresh(
  refresh: () => void,
  page: Pick<
    Document,
    "hidden" | "addEventListener" | "removeEventListener"
  > = document,
  browser: Pick<Window, "addEventListener" | "removeEventListener"> = window,
) {
  const update = () => {
    if (!page.hidden) refresh();
  };
  const timer = setInterval(update, 15_000);
  page.addEventListener("visibilitychange", update);
  browser.addEventListener("focus", update);
  browser.addEventListener("online", update);
  return () => {
    clearInterval(timer);
    page.removeEventListener("visibilitychange", update);
    browser.removeEventListener("focus", update);
    browser.removeEventListener("online", update);
  };
}
