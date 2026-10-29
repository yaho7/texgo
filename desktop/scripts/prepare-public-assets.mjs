import { readdir, lstat } from 'node:fs/promises';
import path from 'node:path';

/** Releases contain only the five platform installers. */
export async function preparePublicAssets({directory, version}) {
  const names = ['windows.exe', 'linux.deb', 'linux.AppImage', 'macos_arm64.dmg', 'macos_x64.dmg'].map(name => `texgo_${version}_${name}`).sort();
  const actual = (await readdir(directory)).sort();
  if (JSON.stringify(actual) !== JSON.stringify(names)) throw new Error('Release must contain exactly five installers');
  for (const name of names) {
    const file = await lstat(path.join(directory, name));
    if (!file.isFile() || !file.size) throw new Error(`Invalid release asset: ${name}`);
  }
  return names;
}
