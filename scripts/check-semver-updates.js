/**
 * Scans every template's meta.yaml for pinned Docker image tags and checks
 * Docker Hub for newer semantic-version tags (ignores the "latest" tag).
 * Outputs a JSON summary and (optionally) posts a Discord embed.
 *
 * Usage:
 *   node scripts/check-semver-updates.js                  # print summary JSON
 *   node scripts/check-semver-updates.js --discord <url>   # also post to Discord
 */

const fs = require("fs");
const path = require("path");
const glob = require("glob");
const YAML = require("yaml");

const TEMPLATES_DIR = path.join(__dirname, "..", "templates");
const CONCURRENCY = 3;

function parseImage(defaultImage) {
  const idx = defaultImage.lastIndexOf(":");
  // guard against a bare digest / no tag
  if (idx === -1) return null;
  const image = defaultImage.slice(0, idx);
  const tag = defaultImage.slice(idx + 1);
  if (!tag || tag.includes("/")) return null;
  return { image, tag };
}

function classifyImage(image) {
  const parts = image.split("/");
  // If the first segment looks like a host (has a dot, colon, or is a known
  // non-docker-hub registry name), we don't support it here.
  if (parts.length >= 2 && (parts[0].includes(".") || parts[0].includes(":") || parts[0] === "localhost")) {
    return { supported: false, reason: `unsupported registry (${parts[0]})` };
  }
  let namespace, repository;
  if (parts.length === 1) {
    namespace = "library";
    repository = parts[0];
  } else {
    [namespace, repository] = parts;
  }
  return { supported: true, namespace, repository };
}

const SEMVER_RE = /^v?(\d+)\.(\d+)\.(\d+)(.*)$/;

function parseSemverTag(tag) {
  const m = tag.match(SEMVER_RE);
  if (!m) return null;
  return {
    major: parseInt(m[1], 10),
    minor: parseInt(m[2], 10),
    patch: parseInt(m[3], 10),
    suffix: m[4] || "",
  };
}

function compareSemver(a, b) {
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  return a.patch - b.patch;
}

async function fetchWithTimeout(url, opts = {}, timeoutMs = 10000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...opts, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchAllTags(namespace, repository, maxPages = 3) {
  const tags = [];
  let url = `https://hub.docker.com/v2/namespaces/${namespace}/repositories/${repository}/tags?page_size=100`;
  let page = 0;
  let retries = 0;
  while (url && page < maxPages) {
    const res = await fetchWithTimeout(url, { headers: { Accept: "application/json" } });
    if (res.status === 429) {
      retries++;
      if (retries > 6) throw new Error("rate limited (429) after retries");
      await new Promise((r) => setTimeout(r, 1500 * retries));
      continue;
    }
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    const data = await res.json();
    for (const t of data.results || []) tags.push(t.name);
    url = data.next;
    page++;
    retries = 0;
  }
  return tags;
}

async function pool(items, worker, concurrency) {
  const results = new Array(items.length);
  let i = 0;
  async function next() {
    while (i < items.length) {
      const idx = i++;
      results[idx] = await worker(items[idx], idx);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, next));
  return results;
}

async function checkTemplate(templateName) {
  const filePath = path.join(TEMPLATES_DIR, templateName, "meta.yaml");
  const fileContent = fs.readFileSync(filePath, "utf-8");
  const meta = YAML.parse(fileContent);

  const properties = meta?.schema?.properties || {};
  const imageKeys = Object.keys(properties).filter((k) => k.endsWith("Image"));

  const templateResult = {
    template: templateName,
    images: [],
  };

  for (const key of imageKeys) {
    const defaultImage = properties[key]?.default;
    if (!defaultImage || typeof defaultImage !== "string") continue;

    const parsed = parseImage(defaultImage);
    if (!parsed) {
      templateResult.images.push({ key, defaultImage, status: "no-tag" });
      continue;
    }
    const { image, tag } = parsed;

    if (tag === "latest") {
      templateResult.images.push({ key, image, tag, status: "unpinned" });
      continue;
    }

    const currentSemver = parseSemverTag(tag);
    if (!currentSemver) {
      templateResult.images.push({ key, image, tag, status: "non-semver" });
      continue;
    }

    const registry = classifyImage(image);
    if (!registry.supported) {
      templateResult.images.push({ key, image, tag, status: "unsupported-registry", reason: registry.reason });
      continue;
    }

    try {
      const allTags = await fetchAllTags(registry.namespace, registry.repository);
      const candidates = allTags
        .map((t) => ({ tag: t, sv: parseSemverTag(t) }))
        .filter((c) => c.sv && c.sv.suffix === currentSemver.suffix);

      if (!candidates.length) {
        templateResult.images.push({ key, image, tag, status: "no-matching-tags" });
        continue;
      }

      let best = candidates[0];
      for (const c of candidates) {
        if (compareSemver(c.sv, best.sv) > 0) best = c;
      }

      const isOutdated = compareSemver(best.sv, currentSemver) > 0;
      templateResult.images.push({
        key,
        image,
        tag,
        latestTag: best.tag,
        status: isOutdated ? "outdated" : "up-to-date",
      });
    } catch (err) {
      templateResult.images.push({ key, image, tag, status: "error", error: String(err.message || err) });
    }
  }

  return templateResult;
}

async function run() {
  let templateNames = glob
    .sync("*/meta.yaml", { cwd: TEMPLATES_DIR })
    .map((p) => p.split("/")[0])
    .sort();

  const limitIdx = process.argv.indexOf("--limit");
  if (limitIdx !== -1) {
    templateNames = templateNames.slice(0, parseInt(process.argv[limitIdx + 1], 10));
  }

  let done = 0;
  const results = await pool(
    templateNames,
    async (name, idx) => {
      const r = await checkTemplate(name);
      done++;
      if (done % 25 === 0 || done === templateNames.length) {
        console.error(`progress: ${done}/${templateNames.length}`);
      }
      return r;
    },
    CONCURRENCY
  );

  const summary = {
    totalTemplatesChecked: results.length,
    templatesOutdated: [],
    templatesUpToDate: 0,
    templatesUnpinned: 0,
    templatesNonSemver: 0,
    templatesUnsupportedRegistry: 0,
    templatesErrored: [],
  };

  for (const r of results) {
    let hasOutdated = false;
    let hasError = false;
    for (const img of r.images) {
      if (img.status === "outdated") hasOutdated = true;
      if (img.status === "error") hasError = true;
    }
    if (hasOutdated) {
      summary.templatesOutdated.push({
        template: r.template,
        images: r.images.filter((i) => i.status === "outdated"),
      });
    } else if (hasError) {
      summary.templatesErrored.push(r.template);
    } else {
      const statuses = r.images.map((i) => i.status);
      if (statuses.includes("up-to-date")) summary.templatesUpToDate++;
      else if (statuses.includes("unpinned")) summary.templatesUnpinned++;
      else if (statuses.includes("non-semver")) summary.templatesNonSemver++;
      else if (statuses.includes("unsupported-registry")) summary.templatesUnsupportedRegistry++;
    }
  }

  console.log(JSON.stringify(summary, null, 2));

  const discordUrl = process.argv.includes("--discord")
    ? process.argv[process.argv.indexOf("--discord") + 1]
    : null;

  if (discordUrl) {
    await postToDiscord(discordUrl, summary);
  }
}

async function postToDiscord(webhookUrl, summary) {
  const outdatedCount = summary.templatesOutdated.length;
  const color = outdatedCount > 0 ? 0xffa500 : 0x57f287; // orange if updates pending, green if all good

  const embed = {
    title: "📦 Template Image Update Check",
    color,
    fields: [
      { name: "Templates Checked", value: String(summary.totalTemplatesChecked), inline: true },
      { name: "Need Update", value: String(outdatedCount), inline: true },
      { name: "Up To Date", value: String(summary.templatesUpToDate), inline: true },
      { name: "Unpinned (:latest)", value: String(summary.templatesUnpinned), inline: true },
      { name: "Non-semver tag", value: String(summary.templatesNonSemver), inline: true },
      { name: "Unsupported registry", value: String(summary.templatesUnsupportedRegistry), inline: true },
    ],
    timestamp: new Date().toISOString(),
  };

  const payload = { embeds: [embed] };

  if (!outdatedCount) {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      throw new Error(`Discord webhook failed: HTTP ${res.status} ${await res.text()}`);
    }
    return;
  }

  embed.fields.push({
    name: "Full List",
    value: "See attached file: outdated-templates.txt",
  });

  const fileLines = summary.templatesOutdated.map((t) => {
    const img = t.images[0];
    return `${t.template}: ${img.tag} -> ${img.latestTag}`;
  });
  const fileContent = fileLines.join("\n");

  const form = new FormData();
  form.append("payload_json", JSON.stringify(payload));
  form.append("files[0]", new Blob([fileContent], { type: "text/plain" }), "outdated-templates.txt");

  const res = await fetch(webhookUrl, { method: "POST", body: form });

  if (!res.ok) {
    throw new Error(`Discord webhook failed: HTTP ${res.status} ${await res.text()}`);
  }
}

module.exports = { postToDiscord };

if (require.main === module) {
  run().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
