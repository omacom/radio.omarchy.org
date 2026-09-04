import test from "node:test";
import assert from "node:assert/strict";
import { jsonRequest, model } from "../server/providers.mjs";
test("official same-origin redirects work without allowing source-selected origins", async (t) => {
  const urls = [];
  t.mock.method(globalThis, "fetch", async (url) => {
    urls.push(url);
    return urls.length === 1
      ? new Response(null, {
          status: 301,
          headers: {
            location: "https://api.github.com/repositories/123/releases",
          },
        })
      : Response.json([{ name: "release" }]);
  });
  assert.deepEqual(
    await jsonRequest("https://api.github.com/repos/basecamp/omarchy/releases"),
    [{ name: "release" }],
  );
  assert.equal(urls.length, 2);
});
test("redirects cannot forward credentials to another origin", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls++;
    return new Response(null, {
      status: 302,
      headers: { location: "https://untrusted.example/collect" },
    });
  });
  await assert.rejects(
    jsonRequest("https://api.github.com/source", {
      headers: { authorization: "Bearer test" },
    }),
    /redirect rejected/,
  );
  assert.equal(calls, 1);
});
test("refused and incomplete model responses cannot reach the presenter", async (t) => {
  const oldKey = process.env.OPENAI_API_KEY,
    oldModel = process.env.OPENAI_MODEL;
  process.env.OPENAI_API_KEY = "test";
  process.env.OPENAI_MODEL = "test";
  t.after(() => {
    for (const [key, value] of [
      ["OPENAI_API_KEY", oldKey],
      ["OPENAI_MODEL", oldModel],
    ])
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
  });
  let result = { status: "incomplete", output: [] };
  t.mock.method(globalThis, "fetch", async () => Response.json(result));
  await assert.rejects(model("test", "policy", {}, {}), /incomplete/);
  result = {
    status: "completed",
    output: [{ content: [{ type: "refusal" }] }],
  };
  await assert.rejects(model("test", "policy", {}, {}), /refused/);
});
