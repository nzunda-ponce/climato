const models = [
  "ecmwf_ifs025",
  "gfs_seamless",
  "dwd_icon_global_eps",
  "gem_global",
];
Promise.all(
  models.map(async (model) => {
    const u = new URL("https://ensemble-api.open-meteo.com/v1/ensemble");
    Object.entries({
      latitude: "-34",
      longitude: "-63",
      models: model,
      forecast_days: "2",
      hourly: "wind_speed_10m,wind_gusts_10m,precipitation",
      timezone: "America/Argentina/Buenos_Aires",
    }).forEach(([k, v]) => u.searchParams.set(k, v));
    try {
      const r = await fetch(u);
      const d = await r.json();
      console.log(
        JSON.stringify({
          model,
          status: r.status,
          error: d.reason,
          keys: Object.keys(d.hourly ?? {}).slice(0, 5),
          wind: Object.keys(d.hourly ?? {}).filter((k) =>
            k.startsWith("wind_speed"),
          ).length,
          gust: Object.entries(d.hourly ?? {}).filter(
            ([k, v]) => k.startsWith("wind_gust") && v.some((x) => x !== null),
          ).length,
          units: d.hourly_units?.precipitation,
        }),
      );
    } catch (e) {
      console.log(model, e.message);
    }
  }),
);
