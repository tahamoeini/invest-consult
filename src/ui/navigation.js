// @ts-check

import { NAVIGATION_ITEMS } from "./components.js";

export function createNavigationController(shell, store) {
  const { root, sidebar, navigation, pageContainer } = shell;

  function apply(state) {
    if (!root) return;
    root.classList.toggle("is-sidebar-collapsed", state.sidebarCollapsed);
    root.classList.toggle("is-mobile-nav-open", state.mobileNavOpen);
    navigation.items.forEach((item) => {
      const active = item.dataset.navView === state.activeView;
      item.classList.toggle("is-active", active);
      item.setAttribute("aria-current", active ? "page" : "false");
    });
    pageContainer.views.forEach((view) => {
      view.classList.toggle("is-active", view.dataset.appView === state.activeView);
      view.setAttribute("aria-hidden", view.dataset.appView === state.activeView ? "false" : "true");
    });
    const activeItem = NAVIGATION_ITEMS.find((item) => item.id === state.activeView);
    if (navigation.title && activeItem) navigation.title.textContent = activeItem.label;
    if (sidebar.overlay) sidebar.overlay.setAttribute("aria-hidden", state.mobileNavOpen ? "false" : "true");
    if (sidebar.toggle) sidebar.toggle.setAttribute("aria-expanded", state.sidebarCollapsed ? "false" : "true");
    if (sidebar.mobileToggle)
      sidebar.mobileToggle.setAttribute("aria-expanded", state.mobileNavOpen ? "true" : "false");
  }

  function goTo(viewId) {
    if (!NAVIGATION_ITEMS.some((item) => item.id === viewId)) return;
    store.setState({ activeView: viewId, mobileNavOpen: false });
  }

  navigation.items.forEach((item) => item.addEventListener("click", () => goTo(item.dataset.navView)));
  sidebar.toggle?.addEventListener("click", () =>
    store.setState((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
  );
  sidebar.mobileToggle?.addEventListener("click", () =>
    store.setState((state) => ({ mobileNavOpen: !state.mobileNavOpen })),
  );
  sidebar.overlay?.addEventListener("click", () => store.setState({ mobileNavOpen: false }));

  store.subscribe(apply);
  return { goTo, apply };
}
