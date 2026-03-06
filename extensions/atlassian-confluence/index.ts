import { Type } from "@sinclair/typebox";
import type { AnyAgentTool, OpenClawPluginApi } from "openclaw/plugin-sdk/core";

const ENV_SITE = process.env.ATLASSIAN_SITE_URL || process.env.ATLASSIAN_SITE;
const ENV_EMAIL = process.env.ATLASSIAN_EMAIL;
const ENV_TOKEN = process.env.ATLASSIAN_API_TOKEN;

const ConfluenceSearchSchema = Type.Object({
  // Either provide a simple keyword query, or a full CQL string
  query: Type.Optional(Type.String({ description: "Simple keyword(s) to search" })),
  cql: Type.Optional(Type.String({ description: "Advanced CQL query; overrides 'query' if set" })),
  space_key: Type.Optional(Type.String({ description: "Restrict search to this space key" })),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100, description: "Max results (default 20)" })),
  include_body: Type.Optional(
    Type.Boolean({ description: "If true, fetch page HTML body for matched results (may be slower)" }),
  ),
  // Auth — can also come from env vars
  site_url: Type.Optional(Type.String({ description: "Atlassian site URL, e.g. https://yourco.atlassian.net" })),
  email: Type.Optional(Type.String({ description: "Atlassian account email (for API token auth)" })),
  api_token: Type.Optional(Type.String({ description: "Atlassian API token" })),
});

function json(content: unknown, details?: unknown) {
  return {
    content: [{ type: "text" as const, text: typeof content === "string" ? content : JSON.stringify(content, null, 2) }],
    details: details ?? content,
  };
}

function b64(input: string): string {
  return Buffer.from(input, "utf8").toString("base64");
}

function joinUrl(base: string, path: string): string {
  const u = new URL(base.endsWith("/") ? base : base + "/");
  const p = path.startsWith("/") ? path.slice(1) : path;
  return new URL(p, u).toString();
}

async function confluenceSearch(params: {
  site: string;
  email: string;
  token: string;
  cql: string;
  limit?: number;
}): Promise<any> {
  const base = params.site.replace(/\/$/, "");
  const url = new URL(`${base}/wiki/rest/api/search`);
  url.searchParams.set("cql", params.cql);
  url.searchParams.set("limit", String(params.limit ?? 20));
  // Request excerpts in results
  url.searchParams.set("expand", "content.space,content.history");

  const res = await fetch(url, {
    headers: {
      Authorization: `Basic ${b64(`${params.email}:${params.token}`)}`,
      Accept: "application/json",
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Confluence search failed: ${res.status} ${res.statusText} — ${body}`);
  }
  return res.json();
}

async function fetchPageBody(params: { site: string; email: string; token: string; pageId: string }) {
  const base = params.site.replace(/\/$/, "");
  const url = new URL(`${base}/wiki/rest/api/content/${encodeURIComponent(params.pageId)}`);
  url.searchParams.set("expand", "body.storage,version,space");
  const res = await fetch(url, {
    headers: {
      Authorization: `Basic ${b64(`${params.email}:${params.token}`)}`,
      Accept: "application/json",
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Fetch page failed: ${res.status} ${res.statusText} — ${body}`);
  }
  return res.json();
}

export default function register(api: OpenClawPluginApi) {
  api.registerTool({
    name: "confluence_search",
    label: "Confluence Search",
    description:
      "Search Confluence pages using CQL or keywords. Returns titles, excerpts, and URLs. Optionally include page HTML bodies.",
    parameters: ConfluenceSearchSchema,
    async execute(_toolCallId, raw) {
      try {
        const p = raw as unknown as {
          query?: string;
          cql?: string;
          space_key?: string;
          limit?: number;
          include_body?: boolean;
          site_url?: string;
          email?: string;
          api_token?: string;
        };

        const site = (p.site_url || ENV_SITE)?.trim();
        const email = (p.email || ENV_EMAIL)?.trim();
        const token = (p.api_token || ENV_TOKEN)?.trim();
        if (!site || !email || !token) {
          return json({
            error:
              "Missing Confluence credentials. Provide site_url/email/api_token in tool params or set ATLASSIAN_SITE_URL, ATLASSIAN_EMAIL, ATLASSIAN_API_TOKEN.",
          });
        }

        let cql = (p.cql || "").trim();
        if (!cql) {
          const q = (p.query || "").trim();
          if (!q) {
            return json({ error: "Provide either 'query' or 'cql'" });
          }
          const escaped = q.replace(/"/g, '\\"');
          cql = `text ~ "${escaped}"`;
          if (p.space_key?.trim()) {
            cql = `space = ${p.space_key.trim()} AND (${cql})`;
          }
        }

        const data = await confluenceSearch({ site, email, token, cql, limit: p.limit });
        const results = Array.isArray((data as any).results) ? (data as any).results : [];

        const mapped = results.map((r: any) => {
          const content = r.content || {};
          const spaceKey = content.space?.key || r.space?.key;
          const title = r.title || content.title;
          const excerpt = r.excerpt || r.excerptText || "";
          // r.url is a relative path like /wiki/spaces/KEY/pages/ID/Title
          const relUrl = r.url || (content._links && content._links.webui) || "";
          const url = relUrl ? joinUrl(site, relUrl) : undefined;
          return {
            id: content.id || r.id,
            type: content.type || r.type,
            status: content.status || r.status,
            spaceKey,
            title,
            url,
            excerpt,
          };
        });

        if (p.include_body) {
          const top = mapped.slice(0, Math.min(mapped.length, 10));
          const bodies = await Promise.all(
            top.map(async (m) => {
              if (!m.id) return null;
              try {
                const full = await fetchPageBody({ site, email, token, pageId: String(m.id) });
                const bodyHtml = full?.body?.storage?.value;
                return { id: m.id, bodyHtml };
              } catch {
                return { id: m.id, bodyHtml: undefined };
              }
            }),
          );
          const bodyMap = new Map(bodies.filter(Boolean).map((b: any) => [String(b.id), b.bodyHtml]));
          for (const m of mapped) {
            const html = bodyMap.get(String(m.id));
            if (html) (m as any).body_html = html;
          }
        }

        const summaryLines = mapped.slice(0, 5).map((m, i) => `${i + 1}. ${m.title ?? "(untitled)"}${m.url ? ` — ${m.url}` : ""}`);
        const summary = summaryLines.length > 0 ? `Top results for CQL: ${cql}\n` + summaryLines.join("\n") : `No results for CQL: ${cql}`;

        return json(summary, {
          cql,
          count: mapped.length,
          results: mapped,
        });
      } catch (err) {
        return json({ error: err instanceof Error ? err.message : String(err) });
      }
    },
  } as AnyAgentTool);
}
