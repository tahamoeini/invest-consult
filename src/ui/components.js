// @ts-check

export const NAVIGATION_ITEMS = Object.freeze([
  { id: "dashboard", icon: "⌂", label: "داشبورد", description: "خلاصه وضعیت و اقدام بعدی" },
  { id: "plan", icon: "↗", label: "برنامه سرمایه‌گذاری", description: "ساخت برنامه ماهانه" },
  { id: "portfolio", icon: "◫", label: "پرتفوی من", description: "دارایی‌ها و دفتر تراکنش" },
  { id: "simulation", icon: "◌", label: "شبیه‌سازی و بک‌تست", description: "سناریو و بررسی گذشته" },
  { id: "history", icon: "◷", label: "تحلیل تاریخی", description: "سابقه برنامه‌های تو" },
  { id: "assets", icon: "◇", label: "دارایی‌ها و بازار", description: "قیمت‌های چندمنبعی" },
  { id: "settings", icon: "⚙", label: "تنظیمات", description: "داده محلی و ظاهر برنامه" },
]);

export function AppShell(root = document) {
  return {
    root: root.querySelector("#app-shell"),
    sidebar: Sidebar(root),
    navigation: Navigation(root),
    pageContainer: PageContainer(root),
  };
}

export function Sidebar(root = document) {
  return {
    element: root.querySelector("#app-sidebar"),
    overlay: root.querySelector("#sidebar-overlay"),
    toggle: root.querySelector("#sidebar-toggle"),
    mobileToggle: root.querySelector("#mobile-menu-toggle"),
  };
}

export function Navigation(root = document) {
  return {
    element: root.querySelector("#app-navigation"),
    items: [...root.querySelectorAll("[data-nav-view]")],
    title: root.querySelector("#current-view-title"),
  };
}

export function PageContainer(root = document) {
  return {
    element: root.querySelector("#app-content"),
    views: [...root.querySelectorAll("[data-app-view]")],
  };
}

export const DashboardPage = (root = document) => root.querySelector('[data-app-view="dashboard"]');
export const PlanPage = (root = document) => root.querySelector('[data-app-view="plan"]');
export const PortfolioPage = (root = document) => root.querySelector('[data-app-view="portfolio"]');
export const SimulationPage = (root = document) => root.querySelector('[data-app-view="simulation"]');
export const HistoryPage = (root = document) => root.querySelector('[data-app-view="history"]');
export const AssetsPage = (root = document) => root.querySelector('[data-app-view="assets"]');
export const SettingsPage = (root = document) => root.querySelector('[data-app-view="settings"]');
