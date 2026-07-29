import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import YAML from "yaml";

const root = process.cwd();

const dependencyFloors = [
  { name: "protobufjs", minimum: "7.5.5", manifestSections: ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"], lockfileMatcher: /^protobufjs@(.*)$/ },
  { name: "vitest", minimum: "4.1.0", manifestSections: ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"], lockfileMatcher: /^vitest@(.*)$/ },
  { name: "@vitest/coverage-v8", minimum: "4.1.0", manifestSections: ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"], lockfileMatcher: /^@vitest\/coverage-v8@(.*)$/ },
];

const manifestRoots = ["packages", "plugins"];
const ignoredPathParts = new Set(["node_modules", "dist", "build", "coverage", ".turbo"]);

function compareVersions(a, b) {
  const pa = a.split(".").map((part) => Number.parseInt(part, 10));
  const pb = b.split(".").map((part) => Number.parseInt(part, 10));
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const ai = Number.isFinite(pa[i]) ? pa[i] : 0;
    const bi = Number.isFinite(pb[i]) ? pb[i] : 0;
    if (ai !== bi) return ai - bi;
  }
  return 0;
}

function minVersionFromRange(range) {
  const version = String(range).match(/\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?/u)?.[0];
  return version?.split(/[+-]/u)[0] ?? null;
}

function assertRangeMeetsFloor({ location, name, range, minimum }) {
  const minVersion = minVersionFromRange(range);
  assert.ok(minVersion, `${location}: ${name} range ${range} must include an explicit semver version`);
  assert.ok(compareVersions(minVersion, minimum) >= 0, `${location}: ${name} range ${range} is below required floor ${minimum}`);
}

async function collectPackageManifests(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const manifests = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (ignoredPathParts.has(entry.name)) continue;
    if (entry.isDirectory()) {
      manifests.push(...(await collectPackageManifests(fullPath)));
    } else if (entry.name === "package.json") {
      manifests.push(fullPath);
    }
  }
  return manifests;
}

async function sourceManifestPaths() {
  const manifests = [path.join(root, "package.json")];
  for (const manifestRoot of manifestRoots) {
    manifests.push(...(await collectPackageManifests(path.join(root, manifestRoot))));
  }
  return manifests.sort();
}

test("source manifests keep vulnerable dependency floors out", async () => {
  for (const manifestPath of await sourceManifestPaths()) {
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    const relativePath = path.relative(root, manifestPath);
    for (const floor of dependencyFloors) {
      for (const section of floor.manifestSections) {
        const range = manifest[section]?.[floor.name];
        if (range) assertRangeMeetsFloor({ location: `${relativePath} ${section}`, name: floor.name, range, minimum: floor.minimum });
      }
    }
  }
});

test("pnpm overrides pin transitive protobufjs to a safe floor", async () => {
  const manifest = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
  assertRangeMeetsFloor({ location: "package.json pnpm.overrides", name: "protobufjs", range: manifest.pnpm?.overrides?.protobufjs, minimum: "7.5.5" });
});

test("lockfile resolutions satisfy dependency security floors", async () => {
  const lockfile = YAML.parse(await readFile(path.join(root, "pnpm-lock.yaml"), "utf8"));
  const packageKeys = Object.keys(lockfile.packages ?? {});
  for (const floor of dependencyFloors) {
    const matches = packageKeys
      .map((key) => key.replace(/^\//u, ""))
      .map((key) => key.match(floor.lockfileMatcher)?.[1])
      .filter(Boolean)
      .map((suffix) => suffix.split("(")[0]);
    assert.ok(matches.length > 0, `pnpm-lock.yaml must include at least one ${floor.name} resolution`);
    for (const version of matches) {
      assert.ok(compareVersions(version, floor.minimum) >= 0, `pnpm-lock.yaml resolves ${floor.name}@${version}, below required floor ${floor.minimum}`);
    }
  }
});
