export function alumniConfig(site) {
  const config = site?.isbf_alumni;
  return config?.enabled === true && Array.isArray(config.countries)
    ? config
    : null;
}

export function alumniRegions(config, country) {
  return (
    config?.countries?.find((item) => item.code === country)?.regions || []
  );
}

export function alumniCities(config, country, region) {
  return (
    alumniRegions(config, country).find((item) => item.code === region)
      ?.cities || []
  );
}

export function alumniLocation(user) {
  return [user.country_name, user.region_name, user.city_name]
    .filter(Boolean)
    .join(" · ");
}
