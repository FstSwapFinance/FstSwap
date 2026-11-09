const THEME_KEY = "swap_theme";
let theme = "dark";
try { if (localStorage.getItem(THEME_KEY) === "light") theme = "light"; } catch {}
export const getTheme = () => theme;
export function setTheme(next) {
  theme = next === "light" ? "light" : "dark";
  document.documentElement.dataset.theme = theme;
  try { localStorage.setItem(THEME_KEY, theme); } catch {}
  window.dispatchEvent(new CustomEvent("fst-theme-change", { detail: theme }));
}
document.documentElement.dataset.theme = theme;

export const SOCIAL_LINKS = [
  { zh: "推特", en: "Twitter", url: "https://x.com/FstSwapFinance", icon: "x" },
  { zh: "电报", en: "Telegram", url: "https://t.me/FstSwapFinance", icon: "telegram" },
];
