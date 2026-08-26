/**
 * Owner tab for back-navigation context.
 *
 * `calendar` and `alerts` are no longer tab-bar slots, but they are still
 * route groups a screen can belong to, so they stay in this union: it decides
 * where "back" lands, not what the tab bar shows.
 */
type MobileOwnerTab =
  | "chat"
  | "today"
  | "tasks"
  | "calendar"
  | "alerts"
  | "more";

type RouteParamValue = string | string[] | undefined;

const NAV_PARENT_PARAM = "navParent";
const NAV_FALLBACK_PARAM = "navFallback";
const NAV_TAB_PARAM = "navTab";
const NAV_LABEL_PARAM = "navLabel";

const TAB_ROOT_HREFS: Record<MobileOwnerTab, string> = {
  chat: "/(app)/(chat)",
  today: "/(app)/(today)",
  tasks: "/(app)/(tasks)",
  calendar: "/(app)/(calendar)",
  alerts: "/(app)/(notifications)",
  more: "/(app)/(more)",
};

const TAB_LABELS: Record<MobileOwnerTab, string> = {
  chat: "Chat",
  today: "Today",
  tasks: "My Work",
  calendar: "Schedule",
  alerts: "Alerts",
  more: "More",
};

export interface MobileNavigationContext {
  parentHref?: string;
  fallbackHref?: string;
  ownerTab?: MobileOwnerTab;
  backLabel?: string;
}

interface MobileNavigationContextInput extends MobileNavigationContext {
  navParent?: RouteParamValue;
  navFallback?: RouteParamValue;
  navTab?: RouteParamValue;
  navLabel?: RouteParamValue;
}

function getRouteParamValue(value: RouteParamValue): string | undefined {
  if (Array.isArray(value)) {
    return typeof value[0] === "string" && value[0] ? value[0] : undefined;
  }

  return typeof value === "string" && value ? value : undefined;
}

function appendSearchParam(url: string, key: string, value: string | undefined): string {
  if (!value) {
    return url;
  }

  const [pathname, rawQuery = ""] = url.split("?", 2);
  const params = new URLSearchParams(rawQuery);
  params.set(key, value);
  const query = params.toString();

  return query ? `${pathname}?${query}` : pathname;
}

export function getTabRootHref(tab: MobileOwnerTab): string {
  return TAB_ROOT_HREFS[tab];
}

export function getTabLabel(tab: MobileOwnerTab): string {
  return TAB_LABELS[tab];
}

export function inferOwnerTabFromHref(href: string): MobileOwnerTab | undefined {
  if (href.startsWith("/(app)/(chat)")) {
    return "chat";
  }

  if (href.startsWith("/(shared)/resource/chat")) {
    return "chat";
  }

  if (href.startsWith("/(app)/(today)")) {
    return "today";
  }

  if (href.startsWith("/(app)/(tasks)")) {
    return "tasks";
  }

  if (href.startsWith("/(shared)/resource/tasks")) {
    return "tasks";
  }

  if (href.startsWith("/(app)/(calendar)")) {
    return "calendar";
  }

  if (href.startsWith("/(shared)/resource/calendar")) {
    return "calendar";
  }

  if (href.startsWith("/(app)/(notifications)")) {
    return "alerts";
  }

  if (href.startsWith("/(app)/(more)")) {
    return "more";
  }

  return undefined;
}

export function toSharedResourceHref(href: string): string {
  const [pathname, rawQuery = ""] = href.split("?", 2);
  const query = rawQuery ? `?${rawQuery}` : "";

  if (pathname.startsWith("/(shared)/resource/")) {
    return href;
  }

  if (pathname.startsWith("/(app)/(chat)/thread/")) {
    return pathname.replace("/(app)/(chat)/thread/", "/(shared)/resource/chat/thread/") + query;
  }

  if (pathname.startsWith("/(app)/(chat)/")) {
    return pathname.replace("/(app)/(chat)/", "/(shared)/resource/chat/") + query;
  }

  if (pathname.startsWith("/(app)/(tasks)/")) {
    return pathname.replace("/(app)/(tasks)/", "/(shared)/resource/tasks/") + query;
  }

  if (pathname.startsWith("/(app)/(calendar)/")) {
    return pathname.replace("/(app)/(calendar)/", "/(shared)/resource/calendar/") + query;
  }

  return href;
}

export function withNavigationContext(
  href: string,
  context: MobileNavigationContext = {},
): string {
  const ownerTab = context.ownerTab ?? inferOwnerTabFromHref(href);
  const fallbackHref = context.fallbackHref ?? (ownerTab ? getTabRootHref(ownerTab) : undefined);
  const backLabel = context.backLabel ?? (ownerTab ? getTabLabel(ownerTab) : undefined);

  let nextHref = href;
  nextHref = appendSearchParam(nextHref, NAV_PARENT_PARAM, context.parentHref);
  nextHref = appendSearchParam(nextHref, NAV_FALLBACK_PARAM, fallbackHref);
  nextHref = appendSearchParam(nextHref, NAV_TAB_PARAM, ownerTab);
  nextHref = appendSearchParam(nextHref, NAV_LABEL_PARAM, backLabel);

  return nextHref;
}

export function parseNavigationContext(
  input: MobileNavigationContextInput,
): MobileNavigationContext {
  const ownerTab = getRouteParamValue(input.navTab) ?? input.ownerTab;

  return {
    parentHref: getRouteParamValue(input.navParent) ?? input.parentHref,
    fallbackHref: getRouteParamValue(input.navFallback) ?? input.fallbackHref,
    ownerTab:
      ownerTab === "chat" ||
      ownerTab === "today" ||
      ownerTab === "tasks" ||
      ownerTab === "calendar" ||
      ownerTab === "alerts" ||
      ownerTab === "more"
        ? ownerTab
        : undefined,
    backLabel: getRouteParamValue(input.navLabel) ?? input.backLabel,
  };
}

export function resolveNavigationBackHref(
  context: MobileNavigationContext,
  defaultHref: string,
): string {
  if (context.parentHref) {
    return context.parentHref;
  }

  if (context.fallbackHref) {
    return context.fallbackHref;
  }

  if (context.ownerTab) {
    return getTabRootHref(context.ownerTab);
  }

  return defaultHref;
}