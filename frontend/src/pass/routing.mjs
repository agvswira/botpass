function positiveId(value) {
  return typeof value === "string" && /^[1-9][0-9]*$/.test(value)
    ? BigInt(value)
    : null;
}

export function parseRoute(search) {
  const params = new URLSearchParams(search);
  if (params.has("event")) {
    const eventId = positiveId(params.get("event"));
    return eventId ? { name: "event", eventId } : { name: "home" };
  }
  for (const name of ["create", "manage", "passes", "verify", "guide"]) {
    if (params.has(name)) return { name };
  }
  return { name: "home" };
}

export function routeUrl(route) {
  if (route.name === "home") return "./";
  if (route.name === "event") return `./?event=${route.eventId}`;
  return `./?${route.name}`;
}
