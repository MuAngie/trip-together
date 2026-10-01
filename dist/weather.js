(() => {
  "use strict";

  const cityByDate = {
    "2026-10-04": "上海",
    "2026-10-07": "京都",
    "2026-10-08": "京都",
    "2026-10-09": "京都",
    "2026-10-10": "神户",
    "2026-10-11": "大阪",
    "2026-10-12": "大阪",
    "2026-10-13": "大阪"
  };
  const cities = {
    "上海": { placeId: "wusong-cruise-terminal", timezone: "Asia/Shanghai" },
    "京都": { placeId: "kyoto", timezone: "Asia/Tokyo" },
    "神户": { placeId: "kobe-sanda-outlets", timezone: "Asia/Tokyo" },
    "大阪": { placeId: "osaka", timezone: "Asia/Tokyo" }
  };
  let tripData = null;
  let lastRefresh = 0;

  function condition(code) {
    if (code === 0) return "☀️ 晴";
    if (code === 1 || code === 2) return "⛅ 多云";
    if (code === 3) return "☁️ 阴";
    if (code === 45 || code === 48) return "🌫️ 雾";
    if (code >= 51 && code <= 67 || code >= 80 && code <= 82) return "🌧️ 雨";
    if (code >= 71 && code <= 77 || code >= 85 && code <= 86) return "❄️ 雪";
    if (code >= 95 && code <= 99) return "⛈️ 雷雨";
    return "天气待更新";
  }

  function showNext(date) {
    const target = document.querySelector("#next-weather");
    if (!target) return;
    target.dataset.weatherDate = date;
    const source = document.querySelector(`.day-weather[data-weather-date="${date}"]`);
    target.textContent = source && !source.hidden ? source.textContent : "";
    target.title = source && !source.hidden ? source.title : "";
    target.hidden = !target.textContent;
  }

  function show(city, date, daily, failed) {
    const badge = document.querySelector(`.day-weather[data-weather-date="${date}"]`);
    if (!badge) return;
    const index = daily?.time?.indexOf(date) ?? -1;
    const code = daily?.weather_code?.[index];
    const low = daily?.temperature_2m_min?.[index];
    const high = daily?.temperature_2m_max?.[index];
    badge.textContent = failed ? `${city} · 天气暂不可用`
      : index < 0 ? `${city} · 暂无预报`
      : Number.isFinite(code) && Number.isFinite(low) && Number.isFinite(high)
        ? `${city} · ${condition(code)} · ${Math.round(low)}–${Math.round(high)}℃`
        : `${city} · 天气暂不可用`;
    badge.title = `${date} ${city}天气，数据来自 Open-Meteo`;
    badge.hidden = false;
    if (document.querySelector("#next-weather")?.dataset.weatherDate === date) showNext(date);
  }

  async function load(data) {
    tripData = data;
    lastRefresh = Date.now();
    await Promise.all(Object.entries(cities).map(async ([city, config]) => {
      const place = data.places.find((item) => item.id === config.placeId);
      let daily = null;
      let failed = false;
      try {
        const params = new URLSearchParams({
          latitude: String(place.geo.lat),
          longitude: String(place.geo.lng),
          daily: "weather_code,temperature_2m_max,temperature_2m_min",
          timezone: config.timezone,
          forecast_days: "16",
          past_days: "14"
        });
        const response = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`);
        if (!response.ok) throw new Error(`Weather HTTP ${response.status}`);
        daily = (await response.json()).daily;
      } catch (_) {
        failed = true;
      }
      Object.entries(cityByDate).forEach(([date, assignedCity]) => {
        if (assignedCity === city) show(city, date, daily, failed);
      });
    }));
  }

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && tripData && Date.now() - lastRefresh > 3 * 60 * 60 * 1000) load(tripData);
  });
  window.TravelWeather = { load, showNext };
})();
