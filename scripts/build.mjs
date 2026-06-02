import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import profiles from '../config/profiles.json' with { type: 'json' };
import icons from '../config/icons.json' with { type: 'json' };
import lobeToc from '../node_modules/@lobehub/icons/es/toc.json' with { type: 'json' };

const rootDir = process.cwd();
const assetsDir = path.join(rootDir, 'assets');
const sourceDir = path.join(assetsDir, 'source');
const generatedDir = path.join(assetsDir, 'generated');
const distDir = path.join(rootDir, 'dist');
const iconSize = 128;
const artworkSize = 84;
const simpleModule = await import('simple-icons');
const simpleIcons = Object.values(simpleModule).filter(
  (value) => value && typeof value === 'object' && 'slug' in value,
);
const simpleIconsBySlug = new Map(simpleIcons.map((icon) => [icon.slug, icon]));

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '');
}

function lobeIconCdn(id, { format = 'svg', isDarkMode = false, type = 'color', cdn = 'github' } = {}) {
  const github = (kind) =>
    `https://raw.githubusercontent.com/lobehub/lobe-icons/refs/heads/master/packages/static-${kind}`;
  const aliyun = (kind) => `https://registry.npmmirror.com/@lobehub/icons-static-${kind}/latest/files`;
  const unpkg = (kind) => `https://unpkg.com/@lobehub/icons-static-${kind}@latest`;
  const baseUrl = cdn === 'aliyun' ? aliyun(format) : cdn === 'unpkg' ? unpkg(format) : github(format);

  if (format === 'avatar') {
    return `${baseUrl}/avatars/${id.toLowerCase()}.webp`;
  }

  const suffix = type === 'mono' ? '' : `-${type}`;

  if (format === 'svg') {
    return `${baseUrl}/icons/${id.toLowerCase()}${suffix}.svg`;
  }

  return `${baseUrl}/${isDarkMode ? 'dark' : 'light'}/${id.toLowerCase()}${suffix}.${format}`;
}

function contrastRatio(hexA, hexB) {
  const luminance = (hex) => {
    const rgb = hex
      .replace('#', '')
      .match(/.{1,2}/g)
      .map((chunk) => Number.parseInt(chunk, 16) / 255)
      .map((channel) => {
        if (channel <= 0.03928) return channel / 12.92;
        return ((channel + 0.055) / 1.055) ** 2.4;
      });
    return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
  };

  const a = luminance(hexA);
  const b = luminance(hexB);
  const [light, dark] = a > b ? [a, b] : [b, a];
  return (light + 0.05) / (dark + 0.05);
}

function hexToRgba(hex, alpha = 1) {
  const clean = hex.replace('#', '');
  return {
    r: Number.parseInt(clean.slice(0, 2), 16),
    g: Number.parseInt(clean.slice(2, 4), 16),
    b: Number.parseInt(clean.slice(4, 6), 16),
    alpha,
  };
}

function xmlEscape(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

async function resetDir(dir) {
  await fs.rm(dir, { recursive: true, force: true });
  await fs.mkdir(dir, { recursive: true });
}

async function fetchText(url) {
  let lastError;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: {
          'user-agent': 'themesafe-icons-builder/0.1',
        },
      });
      if (!response.ok) {
        throw new Error(`Failed to fetch ${url}: ${response.status}`);
      }
      return await response.text();
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

function extractInlineSvg(documentText, marker) {
  if (!documentText.includes('<svg')) return null;
  if (!marker) return null;

  const markerIndex = documentText.indexOf(marker);
  if (markerIndex === -1) return null;

  const start = documentText.lastIndexOf('<svg', markerIndex);
  const end = documentText.indexOf('</svg>', markerIndex);
  if (start === -1 || end === -1) return null;

  return documentText.slice(start, end + 6);
}

function findSimpleIcon(config) {
  const direct = (config.simpleIconCandidates || []).find((candidate) => simpleIconsBySlug.has(candidate));
  if (direct) return simpleIconsBySlug.get(direct);

  const wanted = new Set([config.slug, config.label, ...(config.aliases || []), ...(config.searchTerms || [])].map(normalizeText));
  return simpleIcons.find((icon) => {
    const values = [icon.slug, icon.title, icon.source].map(normalizeText);
    return values.some((value) => wanted.has(value));
  });
}

function findLobeEntry(config) {
  const direct = (config.lobeCandidates || []).find((candidate) => lobeToc.some((entry) => entry.id === candidate));
  if (direct) return lobeToc.find((entry) => entry.id === direct);

  const wanted = new Set([config.slug, config.label, ...(config.aliases || []), ...(config.searchTerms || [])].map(normalizeText));
  return lobeToc.find((entry) =>
    [entry.id, entry.title, entry.fullTitle, entry.desc]
      .filter(Boolean)
      .map(normalizeText)
      .some((value) => wanted.has(value)),
  );
}

async function resolveFromLobe(config) {
  const entry = findLobeEntry(config);
  if (!entry) return null;

  const typeCandidates =
    config.strategy === 'canonical'
      ? ['color', 'brand-color', 'brand', 'mono']
      : ['mono', 'brand', 'color', 'brand-color'];

  for (const type of typeCandidates) {
    try {
      const svg = await fetchText(lobeIconCdn(entry.id, { format: 'svg', type }));
      return {
        sourceType: 'lobehub',
        sourceRef: entry.id,
        sourceUrl: lobeIconCdn(entry.id, { format: 'svg', type }),
        brandHex: entry.color || null,
        variant: type,
        svg,
      };
    } catch {
      continue;
    }
  }

  return null;
}

async function resolveFromSimpleIcons(config) {
  const entry = findSimpleIcon(config);
  if (!entry) return null;
  return {
    sourceType: 'simple-icons',
    sourceRef: entry.slug,
    sourceUrl: entry.source || null,
    brandHex: entry.hex ? `#${entry.hex}` : null,
    variant: 'mono',
    svg: entry.svg,
  };
}

async function resolveFromOfficialUrls(config) {
  for (const url of config.officialUrlCandidates || []) {
    try {
      const text = await fetchText(url);
      const svg = text.trimStart().startsWith('<svg') || text.includes('<?xml')
        ? text
        : extractInlineSvg(text, config.officialInlineSvgPattern);
      if (!svg) {
        continue;
      }
      return {
        sourceType: 'official-url',
        sourceRef: url,
        sourceUrl: url,
        brandHex: null,
        variant: 'unknown',
        svg,
      };
    } catch {
      continue;
    }
  }

  return null;
}

async function resolveSource(config) {
  const localSvgPath = path.join(sourceDir, `${config.slug}.svg`);
  try {
    const svg = await fs.readFile(localSvgPath, 'utf8');
    const metadataPath = path.join(sourceDir, `${config.slug}.json`);
    let metadata = {};
    try {
      metadata = JSON.parse(await fs.readFile(metadataPath, 'utf8'));
    } catch {
      metadata = {};
    }
    return {
      sourceType: metadata.sourceType || 'local-cache',
      sourceRef: metadata.sourceRef || localSvgPath,
      sourceUrl: metadata.sourceUrl || null,
      brandHex: metadata.brandHex || null,
      variant: metadata.variant || 'cached',
      svg,
    };
  } catch {
    // Fall through to remote resolution.
  }

  return (
    (await resolveFromLobe(config)) ||
    (await resolveFromSimpleIcons(config)) ||
    (await resolveFromOfficialUrls(config))
  );
}

function svgToCurrentColor(svg, profile) {
  const sanitizedSvg = svg
    .replace(/\s(fill|stroke)="(?!none)[^"]*"/gi, '')
    .replace(/style="([^"]*)"/gi, (_full, value) => {
      const kept = value
        .split(';')
        .map((part) => part.trim())
        .filter(Boolean)
        .filter((part) => !part.startsWith('fill:') && !part.startsWith('stroke:') && !part.startsWith('color:'));
      return kept.length ? `style="${kept.join(';')}"` : '';
    });

  const rootWithTheme = sanitizedSvg.replace(/<svg\b([^>]*)>/i, (_full, attrs) => {
    const sanitizedAttrs = attrs
      .replace(/\sstyle="[^"]*"/i, '')
      .replace(/\s(fill|stroke)="[^"]*"/gi, '');
    return `<svg${sanitizedAttrs} style="background:0 0;background-color:transparent;color-scheme:light dark">`;
  });

  return rootWithTheme
    .replace(/<svg\b([^>]*)>/i, `<svg$1><g style="fill:light-dark(${profile.lightFg},${profile.darkFg});stroke:light-dark(${profile.lightFg},${profile.darkFg})">`)
    .replace(/<\/svg>/i, '</g></svg>');
}

async function writeSourceArtifacts(slug, resolved) {
  const svgPath = path.join(sourceDir, `${slug}.svg`);
  const metadataPath = path.join(sourceDir, `${slug}.json`);
  await fs.writeFile(svgPath, resolved.svg, 'utf8');
  await fs.writeFile(
    metadataPath,
    JSON.stringify(
      {
        sourceType: resolved.sourceType,
        sourceRef: resolved.sourceRef,
        sourceUrl: resolved.sourceUrl,
        variant: resolved.variant,
        brandHex: resolved.brandHex,
      },
      null,
      2,
    ),
    'utf8',
  );
}

async function renderCanonicalPng(svg) {
  return sharp(Buffer.from(svg))
    .resize(iconSize, iconSize, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
}

async function renderComposedPng(svg, fgHex, bgHex) {
  const rendered = await sharp(Buffer.from(svg))
    .resize(artworkSize, artworkSize, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const tinted = Buffer.alloc(rendered.info.width * rendered.info.height * 4);
  const fg = hexToRgba(fgHex, 1);

  for (let index = 0; index < rendered.data.length; index += 4) {
    tinted[index] = fg.r;
    tinted[index + 1] = fg.g;
    tinted[index + 2] = fg.b;
    tinted[index + 3] = rendered.data[index + 3];
  }

  const iconLayer = await sharp(tinted, {
    raw: {
      width: rendered.info.width,
      height: rendered.info.height,
      channels: 4,
    },
  })
    .png()
    .toBuffer();

  return sharp({
    create: {
      width: iconSize,
      height: iconSize,
      channels: 4,
      background: hexToRgba(bgHex, 1),
    },
  })
    .composite([{ input: iconLayer, gravity: 'center' }])
    .png()
    .toBuffer();
}

async function renderPreservedColorComposedPng(svg, bgHex) {
  const iconLayer = await sharp(Buffer.from(svg))
    .resize(artworkSize, artworkSize, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();

  return sharp({
    create: {
      width: iconSize,
      height: iconSize,
      channels: 4,
      background: hexToRgba(bgHex, 1),
    },
  })
    .composite([{ input: iconLayer, gravity: 'center' }])
    .png()
    .toBuffer();
}

function canonicalValidation(resolved, profilesToCheck, fallbackHex = null) {
  const contrastHex = resolved.brandHex || fallbackHex;
  if (!contrastHex) {
    return {
      passes: false,
      reason: 'No single source color available for canonical contrast validation.',
      ratios: {},
    };
  }

  const ratios = {};
  let passes = true;
  for (const profile of profilesToCheck) {
    const light = contrastRatio(contrastHex, profile.lightBg);
    const dark = contrastRatio(contrastHex, profile.darkBg);
    ratios[profile.id] = { light, dark };
    if (light < 3 || dark < 3) {
      passes = false;
    }
  }

  return {
    passes,
    reason: passes ? '' : 'Canonical source color does not meet the 3:1 threshold on both surfaces.',
    ratios,
  };
}

async function buildIcon(config) {
  const resolved = await resolveSource(config);
  if (!resolved) {
    return {
      slug: config.slug,
      label: config.label,
      status: 'missing',
      sourceType: null,
      sourceRef: null,
      strategy: config.strategy,
      outputs: {},
      needsManualReview: true,
      notes: 'No LobeHub, simple-icons, or configured official SVG source resolved.',
    };
  }

  await writeSourceArtifacts(config.slug, resolved);
  const outputs = {};
  const notes = [];
  let status = 'generated';
  let needsManualReview = false;

  for (const profile of profiles) {
    const profileDir = path.join(distDir, profile.id, 'emoji');
    await ensureDir(profileDir);

    const pngBuffer =
      config.strategy === 'canonical'
        ? await renderCanonicalPng(resolved.svg)
        : config.compositionMode === 'preserve-color'
          ? await renderPreservedColorComposedPng(resolved.svg, profile.darkBg)
          : await renderComposedPng(resolved.svg, profile.darkFg, profile.darkBg);

    const pngPath = path.join(profileDir, `${config.slug}.png`);
    await fs.writeFile(pngPath, pngBuffer);
    outputs[profile.id] = path.relative(rootDir, pngPath);
  }

  if (config.strategy === 'auto-svg') {
    outputs.autoSvg = {};
    for (const profile of profiles) {
      const autoDir = path.join(distDir, 'svg-auto', profile.id);
      await ensureDir(autoDir);
      const autoSvg = svgToCurrentColor(resolved.svg, profile);
      const autoPath = path.join(autoDir, `${config.slug}.svg`);
      await fs.writeFile(autoPath, autoSvg, 'utf8');
      await fs.writeFile(path.join(generatedDir, `${config.slug}-${profile.id}-auto.svg`), autoSvg, 'utf8');
      outputs.autoSvg[profile.id] = path.relative(rootDir, autoPath);
    }
  }

  if (config.strategy === 'canonical') {
    const validation = canonicalValidation(resolved, profiles, config.contrastColor || null);
    if (!validation.passes) {
      status = 'manual_review';
      needsManualReview = true;
      notes.push(validation.reason);
    }
  } else {
    for (const profile of profiles) {
      const ratio = contrastRatio(profile.darkFg, profile.darkBg);
      if (ratio < 3) {
        status = 'manual_review';
        needsManualReview = true;
        notes.push(`Profile ${profile.id} composed colors fall below 3:1.`);
      }
    }
  }

  if (config.notes) {
    notes.push(config.notes);
  }

  return {
    slug: config.slug,
    label: config.label,
    status,
    sourceType: resolved.sourceType,
    sourceRef: resolved.sourceRef,
    strategy: config.strategy,
    outputs,
    needsManualReview,
    notes: notes.join(' ').trim(),
  };
}

async function writeManifest(entries) {
  const reportDir = path.join(distDir, 'reports');
  await ensureDir(reportDir);
  await fs.writeFile(path.join(reportDir, 'manifest.json'), JSON.stringify(entries, null, 2), 'utf8');
}

async function main() {
  await ensureDir(sourceDir);
  await resetDir(generatedDir);
  await resetDir(distDir);

  const manifest = [];
  for (const icon of icons) {
    manifest.push(await buildIcon(icon));
  }

  await writeManifest(manifest);

  const summary = manifest.reduce(
    (accumulator, entry) => {
      accumulator[entry.status] = (accumulator[entry.status] || 0) + 1;
      return accumulator;
    },
    {},
  );

  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
