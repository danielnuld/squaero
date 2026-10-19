/**
 * The app opens with no tab, on the welcome screen (issue #694). A test that
 * needs a query editor opens one the way a user does: the tab bar's
 * «Nueva consulta» (+), the same action as Ctrl+T.
 */
export const openQueryTab = (host: HTMLElement) =>
  (host.querySelector('.tabbar button[aria-label="Nueva consulta"]') as HTMLButtonElement).click();
