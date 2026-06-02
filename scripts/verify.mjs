import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import icons from '../config/icons.json' with { type: 'json' };
import profiles from '../config/profiles.json' with { type: 'json' };
import manifest from '../dist/reports/manifest.json' with { type: 'json' };

const rootDir = process.cwd();
const failures = [];

function fail(message) {
  failures.push(message);
}

const manifestMap = new Map(manifest.map((entry) => [entry.slug, entry]));

for (const icon of icons) {
  const entry = manifestMap.get(icon.slug);
  if (!entry) {
    fail(`Missing manifest entry for ${icon.slug}`);
    continue;
  }

  if (entry.status !== 'generated') {
    fail(`Unexpected status for ${icon.slug}: ${entry.status}`);
  }

  for (const profile of profiles) {
    const rel = entry.outputs?.[profile.id];
    if (!rel) {
      fail(`Missing ${profile.id} PNG output for ${icon.slug}`);
      continue;
    }

    const pngPath = path.join(rootDir, rel);
    try {
      const metadata = await sharp(pngPath).metadata();
      if (metadata.width !== 128 || metadata.height !== 128) {
        fail(`Unexpected PNG size for ${icon.slug} (${profile.id}): ${metadata.width}x${metadata.height}`);
      }
    } catch (error) {
      fail(`Unreadable PNG for ${icon.slug} (${profile.id}): ${error.message}`);
    }
  }

  if (icon.strategy === 'auto-svg') {
    for (const profile of profiles) {
      const rel = entry.outputs?.autoSvg?.[profile.id];
      if (!rel) {
        fail(`Missing auto SVG for ${icon.slug} (${profile.id})`);
        continue;
      }

      const svgPath = path.join(rootDir, rel);
      try {
        const svg = await fs.readFile(svgPath, 'utf8');
        if (!svg.includes('light-dark(')) {
          fail(`Auto SVG for ${icon.slug} (${profile.id}) does not contain light-dark()`);
        }
      } catch (error) {
        fail(`Unreadable auto SVG for ${icon.slug} (${profile.id}): ${error.message}`);
      }
    }
  } else if (entry.outputs?.autoSvg) {
    fail(`Unexpected auto SVG output for non-auto strategy icon ${icon.slug}`);
  }
}

if (manifest.length !== icons.length) {
  fail(`Manifest count ${manifest.length} does not match config count ${icons.length}`);
}

if (failures.length) {
  console.error(failures.join('\n'));
  process.exitCode = 1;
} else {
  console.log(`Verified ${icons.length} icons across ${profiles.length} profiles.`);
}
