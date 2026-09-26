(() => {
  try {
    const preferences = JSON.parse(localStorage.getItem("synthora-ui-preferences-v1") || "{}");
    const locale = ["fa", "en", "ru", "zh"].includes(preferences.locale) ? preferences.locale : "fa";
    const theme = ["system", "light", "dark"].includes(preferences.theme) ? preferences.theme : "system";
    const direction = locale === "fa" ? "rtl" : "ltr";
    const resolvedTheme =
      theme === "system" ? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light") : theme;
    document.documentElement.lang = locale === "zh" ? "zh-CN" : locale;
    document.documentElement.dir = direction;
    document.documentElement.dataset.locale = locale;
    document.documentElement.dataset.theme = resolvedTheme;
  } catch {
    document.documentElement.dataset.theme = "light";
  }
})();
