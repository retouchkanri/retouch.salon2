/**
 * Per-browser display preferences for the admin sidebar, kept in cookies so
 * the server renders the right width / folded groups on the first paint.
 * (Plain module on purpose: the layout (server) and AdminNav (client) both
 * read these names.)
 */
export const NAV_RAIL_COOKIE = "admin_nav_rail";
export const NAV_CLOSED_COOKIE = "admin_nav_closed";
/** Group ids are joined with "." — commas aren't valid in cookie values. */
export const NAV_CLOSED_SEPARATOR = ".";

export type NavPrefs = {
  /** Sidebar collapsed to the icon-only rail (desktop only). */
  rail: boolean;
  /** Ids of groups the user has folded. */
  closed: string[];
};

type CookieReader = { get(name: string): { value: string } | undefined };

export function readNavPrefs(jar: CookieReader): NavPrefs {
  return {
    rail: jar.get(NAV_RAIL_COOKIE)?.value === "1",
    closed: (jar.get(NAV_CLOSED_COOKIE)?.value ?? "")
      .split(NAV_CLOSED_SEPARATOR)
      .filter(Boolean),
  };
}
