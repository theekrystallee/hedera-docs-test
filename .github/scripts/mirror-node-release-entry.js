#!/usr/bin/env node
// Generates and prepends a mirror node release notes MDX entry.
// Usage:
// node mirror-node-release-entry.js --version X.Y.Z --release-json release.json --target path/to/mirror-node.mdx

'use strict';

const fs = require('fs');

const REPO_URL = 'https://github.com/hiero-ledger/hiero-mirror-node';

const KNOWN_CATEGORIES = [
  'Breaking Changes',
  'Enhancements',
  'Bug Fixes',
  'Dependency Upgrades',
  'Deployments',
  'Contributors',
];

const CATEGORY_ORDER = [
  'Breaking Changes',
  'Enhancements',
  'Bug Fixes',
  'Dependency Upgrades',
  'Deployments',
  'Contributors',
];

const ANCHOR_REGEX = /^##\s+Latest Releases\s*\r?\n/m;

function parseArgs(argv) {
  const parsed = {};

  for (let i = 2; i < argv.length; i += 2) {
    const key = argv[i];
    const value = argv[i + 1];

    if (!key || !key.startsWith('--')) {
      throw new Error(`Invalid argument "${key || ''}". Expected --key value.`);
    }

    if (!value || value.startsWith('--')) {
      throw new Error(`Missing value for argument "${key}".`);
    }

    parsed[key.slice(2)] = value;
  }

  return parsed;
}

function normalizeVersion(input) {
  const raw = String(input || '').trim();
  const version = raw.replace(/^v/i, '');

  if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error(`Invalid version "${raw}". Expected X.Y.Z or vX.Y.Z.`);
  }

  return version;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function escapeMdxAttribute(value) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function readFile(path) {
  try {
    return fs.readFileSync(path, 'utf8');
  } catch (error) {
    throw new Error(`Could not read "${path}": ${error.message}`);
  }
}

function writeFile(path, content) {
  try {
    fs.writeFileSync(path, content, 'utf8');
  } catch (error) {
    throw new Error(`Could not write "${path}": ${error.message}`);
  }
}

function parseReleaseBody(body) {
  const blocks = new Map();
  let currentCategory = null;

  for (const line of body.split(/\r?\n/)) {
    const headerMatch = line.match(/^##\s+(.+?)\s*$/);

    if (headerMatch) {
      currentCategory = headerMatch[1].trim();

      if (!blocks.has(currentCategory)) {
        blocks.set(currentCategory, []);
      }

      continue;
    }

    if (currentCategory && /^[-*]\s+/.test(line)) {
      const bullet = line.replace(/^[-*]\s+/, '').trimEnd();

      if (bullet.trim()) {
        // Keep the original release body link format, usually [#NNN](url).
        blocks.get(currentCategory).push(`  * ${bullet}`);
      }
    }
  }

  return blocks;
}

function buildCategoryOrder(blocks) {
  const categoriesWithContent = [...blocks.keys()].filter(
    category => blocks.get(category).length > 0
  );

  const unknownCategories = categoriesWithContent.filter(
    category => !KNOWN_CATEGORIES.includes(category)
  );

  const orderedCategories = [
    ...CATEGORY_ORDER.filter(
      category => blocks.has(category) && blocks.get(category).length > 0
    ),
    ...unknownCategories.sort(),
  ];

  return { orderedCategories, unknownCategories };
}

function main() {
  const args = parseArgs(process.argv);

  const version = normalizeVersion(args.version);
  const releaseJsonPath = args['release-json'];
  const target = args.target;

  if (!releaseJsonPath || !target) {
    throw new Error(
      'Usage: node mirror-node-release-entry.js --version X.Y.Z --release-json release.json --target path/to/mirror-node.mdx'
    );
  }

  const releaseJson = readFile(releaseJsonPath);
  const existingContent = readFile(target);

  let release;

  try {
    release = JSON.parse(releaseJson);
  } catch (error) {
    throw new Error(`Could not parse release JSON from "${releaseJsonPath}": ${error.message}`);
  }

  const expectedTag = `v${version}`;
  const tagName = typeof release.tagName === 'string' ? release.tagName : expectedTag;

  if (tagName !== expectedTag) {
    throw new Error(`Release tag mismatch. Expected "${expectedTag}", got "${tagName}".`);
  }

  const body = typeof release.body === 'string' ? release.body : '';
  const tagUrl =
    typeof release.url === 'string' && release.url.length > 0
      ? release.url
      : `${REPO_URL}/releases/tag/${expectedTag}`;

  const duplicateHeadingRegex = new RegExp(`^## \\[v${escapeRegExp(version)}\\]`, 'm');

  if (duplicateHeadingRegex.test(existingContent)) {
    console.log(`v${version} entry already exists in ${target}. Skipping.`);
    return;
  }

  const blocks = parseReleaseBody(body);
  const { orderedCategories, unknownCategories } = buildCategoryOrder(blocks);

  const totalBullets = orderedCategories.reduce(
    (sum, category) => sum + blocks.get(category).length,
    0
  );

  if (totalBullets === 0) {
    throw new Error(
      `No bullets parsed from release body for v${version}.\n` +
        `The upstream release body format may have changed. Review manually:\n${body.slice(0, 500)}`
    );
  }

  const accordions = orderedCategories
    .map(category => {
      const title = escapeMdxAttribute(category);
      return `<Accordion title="${title}">\n\n${blocks.get(category).join('\n')}\n\n</Accordion>`;
    })
    .join('\n\n');

  const warnings = [];

  if (unknownCategories.length > 0) {
    warnings.push(
      `<!-- warning: unexpected categories from release body were included below: ${unknownCategories.join(
        ', '
      )}. Review manually. -->`
    );
  }

  const patch = Number(version.match(/^\d+\.\d+\.(\d+)/)[1]);
  const isPatch = patch > 0;

  const summaryNote = isPatch
    ? '<!-- summary: patch release -->'
    : '<!-- summary: TODO - add a one-sentence editorial summary above this comment -->';

  const entry = [
    `## [v${version}](${tagUrl})`,
    '',
    summaryNote,
    ...warnings,
    '',
    accordions,
    '',
    '',
  ].join('\n');

  const anchorMatch = existingContent.match(ANCHOR_REGEX);

  if (!anchorMatch || anchorMatch.index === undefined) {
    throw new Error(`Could not find "## Latest Releases" anchor in ${target}.`);
  }

  const insertPosition = anchorMatch.index + anchorMatch[0].length;
  const updated =
    existingContent.slice(0, insertPosition) +
    '\n' +
    entry +
    existingContent.slice(insertPosition);

  writeFile(target, updated);

  console.log(
    `Prepended v${version} entry to ${target} (${totalBullets} bullets across ${orderedCategories.length} categories).`
  );
}

try {
  main();
} catch (error) {
  console.error(`ERROR: ${error.message}`);
  process.exit(1);
}
