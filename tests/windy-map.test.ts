import { test } from "node:test";
import assert from "node:assert/strict";
import { GET } from "../src/app/windy-map/route";

test("missing Windy configuration returns a same-origin failure without caching", async () => {
  const previous = process.env.WINDY_MAP_API_KEY;
  try {
    delete process.env.WINDY_MAP_API_KEY;
    const response = await GET();
    assert.equal(response.status, 503);
    assert.equal(response.headers.get("Cache-Control"), "private, no-store");
    assert.equal(response.headers.get("X-Frame-Options"), "SAMEORIGIN");
    assert.match(await response.text(), /climato-windy-error/);
  } finally {
    if (previous === undefined) delete process.env.WINDY_MAP_API_KEY;
    else process.env.WINDY_MAP_API_KEY = previous;
  }
});

test("Windy browser configuration escapes script boundaries and never caches the license", async () => {
  const previous = process.env.WINDY_MAP_API_KEY;
  try {
    const key = "test-</script><script>unexpected()</script>";
    process.env.WINDY_MAP_API_KEY = key;
    const response = await GET();
    assert.equal(response.status, 200);
    const html = await response.text();
    assert.equal(response.headers.get("Cache-Control"), "private, no-store");
    assert.ok(!html.includes(key));
    assert.ok(html.includes("test-\\u003c/script>"));
    assert.equal((html.match(/<script>/g) ?? []).length, 1);
    assert.equal((html.match(/<\/script>/g) ?? []).length, 1);
  } finally {
    if (previous === undefined) delete process.env.WINDY_MAP_API_KEY;
    else process.env.WINDY_MAP_API_KEY = previous;
  }
});
