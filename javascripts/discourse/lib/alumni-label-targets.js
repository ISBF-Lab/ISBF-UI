export function nativeAlumniTarget(anchor) {
  const root = anchor.closest(".user-profile-names, .names, .name-line");
  return root?.querySelector(".username") || null;
}

export function searchAlumniTargets(anchor, users, dropdown) {
  const root = anchor.closest(
    dropdown ? ".search-result-user" : ".search-advanced"
  );
  if (!root) {
    return [];
  }
  const links = root.querySelectorAll(
    dropdown ? "ul.list a.search-link" : ".user-items .fps-user-item"
  );
  const destinations = new Map();
  for (const link of links) {
    const key = dropdown
      ? link.getAttribute("href")
      : link.getAttribute("data-user-card");
    const target = link.querySelector(".user-titles > .username");
    if (key && target) {
      destinations.set(key.toLowerCase(), target);
    }
  }
  return users.flatMap((user) => {
    const key = dropdown ? user.path : user.username;
    const target =
      typeof key === "string" && destinations.get(key.toLowerCase());
    return target?.isConnected ? [{ user, target }] : [];
  });
}
