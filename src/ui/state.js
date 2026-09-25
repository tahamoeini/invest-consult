// @ts-check

const UI_PREFERENCES_KEY = "invest-consult-ui-preferences-v1";

const DEFAULT_STATE = Object.freeze({
  activeView: "dashboard",
  sidebarCollapsed: false,
  mobileNavOpen: false,
  market: null,
  marketStatus: "loading",
  marketCacheDisabled: false,
  profile: null,
  monthlyInvestment: 0,
  plan: null,
  portfolio: null,
  history: [],
  error: null,
});

const VIEW_IDS = new Set(["dashboard", "plan", "portfolio", "simulation", "history", "assets", "settings"]);

function readPreferences() {
  try {
    const raw = JSON.parse(localStorage.getItem(UI_PREFERENCES_KEY) || "null");
    return raw && typeof raw === "object" ? raw : {};
  } catch {
    return {};
  }
}

function persistPreferences(state) {
  try {
    localStorage.setItem(
      UI_PREFERENCES_KEY,
      JSON.stringify({
        sidebarCollapsed: state.sidebarCollapsed,
        marketCacheDisabled: state.marketCacheDisabled,
      }),
    );
  } catch {
    // Local persistence is an enhancement; navigation remains usable if it fails.
  }
}

export function createAppStore(initial = {}) {
  const preferences = readPreferences();
  let state = {
    ...DEFAULT_STATE,
    ...initial,
    activeView: VIEW_IDS.has(initial.activeView) ? initial.activeView : DEFAULT_STATE.activeView,
    sidebarCollapsed:
      typeof preferences.sidebarCollapsed === "boolean"
        ? preferences.sidebarCollapsed
        : Boolean(initial.sidebarCollapsed),
    marketCacheDisabled:
      typeof preferences.marketCacheDisabled === "boolean"
        ? preferences.marketCacheDisabled
        : Boolean(initial.marketCacheDisabled),
  };
  const listeners = new Set();

  function notify() {
    listeners.forEach((listener) => listener(state));
  }

  return {
    getState() {
      return state;
    },
    setState(patch) {
      const next = typeof patch === "function" ? patch(state) : patch;
      state = { ...state, ...next };
      persistPreferences(state);
      notify();
      return state;
    },
    subscribe(listener) {
      listeners.add(listener);
      listener(state);
      return () => listeners.delete(listener);
    },
  };
}

export { VIEW_IDS };
