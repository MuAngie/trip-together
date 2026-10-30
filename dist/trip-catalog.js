(() => {
  "use strict";

  async function load() {
    const response = await fetch("/trips.json", { cache: "no-store" });
    if (!response.ok) throw new Error("旅行集合暂时无法读取");
    const trips = await response.json();
    if (!Array.isArray(trips)) throw new Error("旅行集合格式不正确");
    const ids = new Set();
    for (const trip of trips) {
      if (!/^[a-z0-9][a-z0-9-]*$/.test(trip.id) || ids.has(trip.id)) throw new Error("旅行编号必须唯一");
      if (trip.data && !/^\/(?!\/)[a-zA-Z0-9/_-]+\.json$/.test(trip.data)) throw new Error("行程必须使用站内数据文件");
      if (!/^\/(?!\/)[a-zA-Z0-9/_-]+\.html(?:\?[a-zA-Z0-9=&%_-]+)?(?:#[a-zA-Z0-9_-]+)?$/.test(trip.href || "")) throw new Error("旅行入口必须使用站内页面");
      ids.add(trip.id);
    }
    return trips.sort((a, b) => b.startDate.localeCompare(a.startDate));
  }

  async function selected(href) {
    const id = new URL(href).searchParams.get("trip") || "shanghai-japan-2026";
    const trip = (await load()).find((entry) => entry.id === id && entry.data);
    if (!trip) throw new Error("这次旅行不在集合中，请返回旅行集合选择");
    return trip;
  }

  function decorate(data, trip) {
    const back = document.querySelector("#collection-back");
    const photos = document.querySelector("#trip-photos-link");
    if (back) back.href = `/index.html#trip-${trip.id}`;
    if (photos) photos.href = `/index.html#photos-${trip.id}`;
    document.title = `${trip.title} · 我们的旅行`;
    // The same trip ID keeps the existing ledger and browser records attached.
    if (data.metadata.tripId !== trip.id) throw new Error("旅行编号与数据不一致");
  }

  window.TravelCatalog = Object.freeze({ load, selected, decorate });
})();
