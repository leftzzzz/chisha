import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const EXCLUDED_DIRECTORY_NAMES = new Set([
  ".git",
  ".next",
  ".open-next",
  ".codex",
  ".loopx",
  "coverage",
  "node_modules",
]);

const REQUIRED_ENTRYPOINTS = [
  "AGENTS.md",
  "docs/README.md",
  "docs/specs/AGENTS.md",
  "docs/requirements/AGENTS.md",
  "docs/technical/AGENTS.md",
];

const DOCS_ROOT_ALLOWLIST = new Set([
  "DEPLOYMENT.md",
  "README.md",
  "TESTING.md",
  "USER-GUIDE.md",
]);

const AUTHORITATIVE_DIRECTORIES = [
  "docs/specs",
  "docs/requirements",
  "docs/technical",
];

function toPosix(value) {
  return value.split(path.sep).join("/");
}

function isWithin(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== "..");
}

export function collectMarkdownFiles(rootDirectory, options = {}) {
  const excludedPaths = (options.excludedPaths ?? []).map((entry) => path.resolve(entry));
  const files = [];

  function visit(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolutePath = path.join(directory, entry.name);

      if (entry.isDirectory()) {
        if (
          EXCLUDED_DIRECTORY_NAMES.has(entry.name) ||
          excludedPaths.some((excludedPath) => isWithin(excludedPath, absolutePath))
        ) {
          continue;
        }

        visit(absolutePath);
        continue;
      }

      if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
        files.push(absolutePath);
      }
    }
  }

  visit(path.resolve(rootDirectory));
  return files.sort();
}

function stripCode(text) {
  let fenceCharacter = null;

  return text
    .split(/\r?\n/)
    .map((line) => {
      const fence = line.match(/^\s{0,3}(`{3,}|~{3,})/);
      if (fence) {
        const character = fence[1][0];
        if (fenceCharacter === null) {
          fenceCharacter = character;
        } else if (fenceCharacter === character) {
          fenceCharacter = null;
        }
        return "";
      }

      if (fenceCharacter !== null) {
        return "";
      }

      return line.replace(/`[^`\n]*`/g, "");
    })
    .join("\n");
}

function parseDestination(rawDestination) {
  const value = rawDestination.trim();
  if (value.startsWith("<")) {
    const end = value.indexOf(">");
    return end === -1 ? value.slice(1) : value.slice(1, end);
  }

  let destination = "";
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (/\s/.test(character)) {
      break;
    }
    if (character === "\\" && index + 1 < value.length) {
      destination += value[index + 1];
      index += 1;
      continue;
    }
    destination += character;
  }
  return destination;
}

function isLocalDestination(destination) {
  return (
    destination !== "" &&
    !destination.startsWith("#") &&
    !destination.startsWith("//") &&
    !/^[a-z][a-z0-9+.-]*:/i.test(destination)
  );
}

function extractLocalLinkReferences(text) {
  const references = [];
  const lines = stripCode(text).split("\n");
  const inlineLink = /!?\[[^\]\n]*\]\(([^)\n]+)\)/g;
  const referenceDefinition = /^\s{0,3}\[[^\]\n]+\]:\s*(.+)$/;

  lines.forEach((line, index) => {
    inlineLink.lastIndex = 0;
    for (let match = inlineLink.exec(line); match !== null; match = inlineLink.exec(line)) {
      const destination = parseDestination(match[1]);
      if (isLocalDestination(destination)) {
        references.push({ destination, line: index + 1 });
      }
    }

    const definition = line.match(referenceDefinition);
    if (definition) {
      const destination = parseDestination(definition[1]);
      if (isLocalDestination(destination)) {
        references.push({ destination, line: index + 1 });
      }
    }
  });

  return references;
}

export function extractLocalLinks(text) {
  return extractLocalLinkReferences(text).map(({ destination }) => destination);
}

export function resolveLocalLinkTarget(repositoryRoot, sourceFile, destination) {
  const fragmentIndex = destination.indexOf("#");
  const queryIndex = destination.indexOf("?");
  const cutPoints = [fragmentIndex, queryIndex].filter((index) => index >= 0);
  const pathEnd = cutPoints.length === 0 ? destination.length : Math.min(...cutPoints);
  const encodedPath = destination.slice(0, pathEnd);

  let decodedPath;
  try {
    decodedPath = decodeURIComponent(encodedPath);
  } catch {
    decodedPath = encodedPath;
  }

  if (decodedPath === "") {
    return path.resolve(sourceFile);
  }

  return decodedPath.startsWith("/")
    ? path.resolve(repositoryRoot, decodedPath.slice(1))
    : path.resolve(path.dirname(sourceFile), decodedPath);
}

export function validateMarkdownLinks(repositoryRoot, markdownFiles) {
  const root = path.resolve(repositoryRoot);
  const errors = [];

  for (const file of markdownFiles) {
    const relativeFile = toPosix(path.relative(root, file));
    const text = readFileSync(file, "utf8");

    for (const { destination, line } of extractLocalLinkReferences(text)) {
      const target = resolveLocalLinkTarget(root, file, destination);
      if (!isWithin(root, target)) {
        errors.push(`${relativeFile}:${line}: link leaves repository: ${destination}`);
      } else if (!existsSync(target)) {
        errors.push(`${relativeFile}:${line}: missing link target: ${destination}`);
      }
    }
  }

  return errors;
}

export function hasArchiveMarker(text) {
  return text
    .split(/\r?\n/)
    .slice(0, 12)
    .some((line) => line.includes("状态：历史归档"));
}

function validateRequiredEntrypoints(repositoryRoot) {
  return REQUIRED_ENTRYPOINTS.filter(
    (entrypoint) => !existsSync(path.join(repositoryRoot, entrypoint)),
  ).map((entrypoint) => `missing required documentation entrypoint: ${entrypoint}`);
}

function validateDocsRoot(repositoryRoot) {
  const docsRoot = path.join(repositoryRoot, "docs");
  return readdirSync(docsRoot, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isFile() &&
        entry.name.toLowerCase().endsWith(".md") &&
        !DOCS_ROOT_ALLOWLIST.has(entry.name),
    )
    .map((entry) => `unexpected Markdown file in docs/: docs/${entry.name}`);
}

function validateIndexes(repositoryRoot) {
  const errors = [];

  for (const relativeDirectory of AUTHORITATIVE_DIRECTORIES) {
    const directory = path.join(repositoryRoot, relativeDirectory);
    const indexFile = path.join(directory, "AGENTS.md");
    if (!existsSync(indexFile)) {
      continue;
    }

    const indexedTargets = new Set(
      extractLocalLinks(readFileSync(indexFile, "utf8")).map((destination) =>
        resolveLocalLinkTarget(repositoryRoot, indexFile, destination),
      ),
    );

    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (
        entry.isFile() &&
        entry.name !== "AGENTS.md" &&
        entry.name.toLowerCase().endsWith(".md")
      ) {
        const documentPath = path.join(directory, entry.name);
        if (!indexedTargets.has(documentPath)) {
          errors.push(`${relativeDirectory}/AGENTS.md does not index ${entry.name}`);
        }
      }
    }
  }

  return errors;
}

function validateArchive(repositoryRoot) {
  const archiveRoot = path.join(repositoryRoot, "docs", "archive");
  if (!existsSync(archiveRoot)) {
    return ["missing documentation archive: docs/archive"];
  }

  return collectMarkdownFiles(archiveRoot)
    .filter((file) => path.basename(file) !== "README.md")
    .filter((file) => !hasArchiveMarker(readFileSync(file, "utf8")))
    .map(
      (file) =>
        `${toPosix(path.relative(repositoryRoot, file))}: missing archive status marker near file start`,
    );
}

function validatePrivateStateIgnores(repositoryRoot) {
  const candidates = [
    ".loopx/registry.json",
    ".codex/goals/example/ACTIVE_GOAL_STATE.md",
  ];
  const errors = [];

  for (const candidate of candidates) {
    const result = spawnSync("git", ["check-ignore", "--quiet", "--no-index", candidate], {
      cwd: repositoryRoot,
      encoding: "utf8",
    });
    if (result.status !== 0) {
      errors.push(`local control-plane path is not ignored: ${candidate}`);
    }
  }

  return errors;
}

export function validateRepository(repositoryRoot) {
  const root = path.resolve(repositoryRoot);
  const markdownFiles = collectMarkdownFiles(root, {
    excludedPaths: [path.join(root, "scripts", "fixtures")],
  });
  const errors = [
    ...validateRequiredEntrypoints(root),
    ...validateDocsRoot(root),
    ...validateIndexes(root),
    ...validateArchive(root),
    ...validatePrivateStateIgnores(root),
    ...validateMarkdownLinks(root, markdownFiles),
  ];

  return { errors, markdownFileCount: markdownFiles.length };
}

function main() {
  const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
  const repositoryRoot = path.resolve(scriptDirectory, "..");
  const result = validateRepository(repositoryRoot);

  if (result.errors.length > 0) {
    console.error(`Documentation check failed with ${result.errors.length} error(s):`);
    for (const error of result.errors) {
      console.error(`- ${error}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log(`Documentation check passed (${result.markdownFileCount} Markdown files).`);
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main();
}
