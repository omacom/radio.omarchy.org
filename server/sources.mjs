import { createHash } from "node:crypto";
import { readJSON } from "./storage.mjs";
import { jsonRequest } from "./providers.mjs";
const clean = (value) =>
  String(value ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 6000);
export function normalizeStory(row, now = Date.now()) {
  if (
    !row ||
    !["release", "maintainer", "community", "social"].includes(row.kind) ||
    !row.author ||
    !row.title ||
    !row.text
  )
    return null;
  let url;
  try {
    url = new URL(row.url);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password) return null;
  url.hash = "";
  for (const key of [...url.searchParams.keys()])
    if (/^(utm_|ref$)/.test(key)) url.searchParams.delete(key);
  const published = Date.parse(row.publishedAt);
  if (
    !Number.isFinite(published) ||
    published > now + 60000 ||
    now - published > 7 * 86400000
  )
    return null;
  const story = {
    kind: row.kind,
    title: clean(row.title),
    text: clean(row.text),
    author: clean(row.author).slice(0, 150),
    url: url.href,
    publishedAt: new Date(published).toISOString(),
    retrievedAt: new Date(now).toISOString(),
  };
  story.id = createHash("sha256").update(story.url).digest("hex");
  story.contentHash = createHash("sha256")
    .update(story.text.toLowerCase())
    .digest("hex");
  return story;
}
export function sourceTools(root) {
  const headers = {
    accept: "application/vnd.github+json",
    "user-agent": "omarchy-radio",
  };
  if (process.env.GITHUB_TOKEN)
    headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const github = (path) =>
    jsonRequest(`https://api.github.com/repos/basecamp/omarchy/${path}`, {
      headers,
    });
  return {
    releases: async () =>
      (await github("releases?per_page=15"))
        .filter((r) => !r.draft && !r.prerelease)
        .map((r) => ({
          kind: "release",
          title: r.name || r.tag_name,
          text: r.body,
          url: r.html_url,
          author: "Omarchy release notes",
          publishedAt: r.published_at,
        })),
    maintainers: async () => {
      const accounts = (process.env.GITHUB_MAINTAINERS ?? "dhh")
        .split(",")
        .map((a) => a.trim().toLowerCase());
      return (await github("commits?per_page=40"))
        .filter((r) => accounts.includes(r.author?.login?.toLowerCase()))
        .map((r) => ({
          kind: "maintainer",
          title: r.commit.message.split("\n")[0],
          text: r.commit.message,
          url: r.html_url,
          author: r.author.login,
          publishedAt: r.commit.author.date,
        }));
    },
    community: async () => {
      const [issues, curated] = await Promise.all([
        github("issues?state=all&sort=updated&per_page=30"),
        readJSON(`${root}/station/community.json`, []),
      ]);
      return [
        ...issues
          .filter((r) => !r.pull_request)
          .map((r) => ({
            kind: "community",
            title: r.title,
            text: r.body,
            url: r.html_url,
            author: r.user.login,
            publishedAt: r.created_at,
          })),
        ...curated.map((r) => ({ ...r, kind: "community" })),
      ];
    },
    social: async () => {
      if (!process.env.X_BEARER_TOKEN) return [];
      const accounts = (process.env.X_ACCOUNTS ?? "dhh")
        .split(",")
        .map((a) => a.trim())
        .filter((a) => /^[a-zA-Z0-9_]{1,15}$/.test(a));
      if (!accounts.length) return [];
      const params = new URLSearchParams({
        query: `(${accounts.map((a) => `from:${a}`).join(" OR ")}) (omarchy OR hyprland OR quattro) -is:retweet`,
        max_results: "20",
        "tweet.fields": "created_at,author_id",
        expansions: "author_id",
        "user.fields": "username",
      });
      const body = await jsonRequest(
        `https://api.x.com/2/tweets/search/recent?${params}`,
        { headers: { authorization: `Bearer ${process.env.X_BEARER_TOKEN}` } },
      );
      return (body.data ?? []).flatMap((r) => {
        const author = body.includes?.users?.find(
          (u) => u.id === r.author_id,
        )?.username;
        return author &&
          accounts.some((a) => a.toLowerCase() === author.toLowerCase())
          ? [
              {
                kind: "social",
                title: `@${author} on Omarchy`,
                text: r.text,
                url: `https://x.com/${author}/status/${r.id}`,
                author: `@${author}`,
                publishedAt: r.created_at,
              },
            ]
          : [];
      });
    },
  };
}
