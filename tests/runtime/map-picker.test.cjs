const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "../../dist/map-picker.js"), "utf8");
const window = {};
const document = { addEventListener() {} };
vm.runInNewContext(source, { window, document, URL, encodeURIComponent });

test("map choice builds three encoded search links from a known location", () => {
  const links = window.TravelMapPicker.linksFor({
    query: "ホテル日航プリンセス京都",
    queryZh: "京都日航公主酒店"
  });
  assert.equal(new URL(links.google).searchParams.get("query"), "ホテル日航プリンセス京都");
  assert.equal(new URL(links.amap).searchParams.get("keyword"), "京都日航公主酒店");
  assert.equal(new URL(links.baidu).searchParams.get("query"), "京都日航公主酒店");
  assert.equal(new URL(links.amap).searchParams.get("callnative"), "1");
});

test("an existing Amap place link is kept only for the Amap choice", () => {
  const links = window.TravelMapPicker.linksFor({
    query: "上海吴淞口国际邮轮码头",
    url: "https://www.amap.com/place/B00156EFOR"
  });
  assert.equal(links.amap, "https://www.amap.com/place/B00156EFOR");
  assert.match(links.google, /^https:\/\/www\.google\.com\/maps\/search\//);
  assert.match(links.baidu, /^https:\/\/api\.map\.baidu\.com\/place\/search/);
});

test("untrusted direct links are ignored and empty locations have no links", () => {
  const links = window.TravelMapPicker.linksFor({ query: "京都", url: "https://amap.com.evil.example/path" });
  assert.match(links.amap, /^https:\/\/uri\.amap\.com\/search/);
  assert.equal(window.TravelMapPicker.linksFor({ query: "  " }), null);
});
