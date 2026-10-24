export function distributionBin(count) {
  if (!Number.isSafeInteger(count) || count < 0) {
    return null;
  }
  return count === 0
    ? 0
    : count <= 5
      ? 1
      : count <= 10
        ? 2
        : count <= 20
          ? 3
          : 4;
}

export function distributionCounts(distribution, country, region) {
  if (
    !distribution ||
    (distribution.country || "") !== (country || "") ||
    (distribution.region || "") !== (region || "")
  ) {
    return null;
  }
  const index = (items) => {
    if (!Array.isArray(items)) {
      return null;
    }
    const counts = new Map();
    for (const item of items) {
      if (
        !item ||
        typeof item.code !== "string" ||
        !item.code.trim() ||
        item.code !== item.code.trim() ||
        distributionBin(item.count) === null ||
        counts.has(item.code)
      ) {
        return null;
      }
      counts.set(item.code, item.count);
    }
    return counts;
  };
  const countries = index(distribution.countries);
  const regions = index(distribution.regions);
  const cities = index(distribution.cities);
  return countries && regions && cities ? { countries, regions, cities } : null;
}

export function cityRadius(count) {
  return distributionBin(count) === null || count === 0
    ? 0
    : Math.min(18, 5 + Math.sqrt(count) * 2);
}

export function distributionCities(config, country, region, counts) {
  if (country !== "CN" || !region || !counts) {
    return [];
  }
  const cities =
    config.countries
      .find((item) => item.code === country)
      ?.regions?.find((item) => item.code === region)?.cities || [];
  return cities.filter(
    (city) =>
      counts.cities.get(city.code) > 0 &&
      Number.isFinite(city.lat) &&
      Math.abs(city.lat) <= 90 &&
      Number.isFinite(city.lng) &&
      Math.abs(city.lng) <= 180
  );
}
