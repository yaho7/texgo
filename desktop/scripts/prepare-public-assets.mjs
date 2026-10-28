import { readdir, readFile, lstat, unlink } from 'node:fs/promises';
import path from 'node:path';

/** Signatures have already been verified and embedded by generateUpdaterFeed. */
export async function preparePublicAssets({directory, version}) {
  const base = `texgo_${version}_`;
  const names = ['windows.exe', 'linux.deb', 'linux.AppImage', 'macos_arm64.dmg', 'macos_x64.dmg', 'macos_arm64.app.tar.gz', 'macos_x64.app.tar.gz'].map(name => base + name);
  names.push('latest.json');
  const signatures = ['windows.exe', 'linux.AppImage', 'macos_arm64.app.tar.gz', 'macos_x64.app.tar.gz'].map(name => base + name + '.sig');
  const expected = [...names, ...signatures].sort();
  const actual = (await readdir(directory)).sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error('Release must contain exactly five installers, two macOS update archives, a feed and four internal signatures');
  const feed = JSON.parse(await readFile(path.join(directory, 'latest.json'), 'utf8'));
  if (feed.version !== version || Object.keys(feed.platforms ?? {}).length !== 4) throw new Error('Release feed version or platform count mismatch');
  for (const name of expected) {
    const file = await lstat(path.join(directory, name));
    if (!file.isFile() || !file.size) throw new Error(`Invalid release asset: ${name}`);
  }
  for (const name of signatures) await unlink(path.join(directory, name));
  return names.sort();
}
