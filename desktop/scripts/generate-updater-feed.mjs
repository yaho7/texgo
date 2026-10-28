import { readFile, writeFile, unlink, lstat } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { checkVersions } from './release-policy.mjs';
import { verifyTauriFile } from './updater-signature.mjs';
const platforms = [
  ['windows','x64','windows-x86_64','.exe'],
  ['linux','x64','linux-x86_64','.AppImage'],
  ['macos','arm64','darwin-aarch64','.app.tar.gz'],
  ['macos','x64','darwin-x86_64','.app.tar.gz'],
];
export async function generateUpdaterFeed({directory, desktop, ref=process.env.GITHUB_REF ?? '', now=new Date()}) {
  const policy = await checkVersions(desktop,ref);
  if (!policy.publish) throw new Error('Updater feeds require the exact release tag');
  const config = JSON.parse(await readFile(path.join(desktop,'src-tauri/tauri.conf.json'),'utf8'));
  const parts = [], entries = {};
  for (const [platform,arch,key,extension] of platforms) {
    const partFile = path.join(directory,`updater_${platform}_${arch}.json`);
    const part = JSON.parse(await readFile(partFile,'utf8'));
    const name = `texgo_${policy.version}_${platform}${platform==='macos'?`_${arch}`:''}${extension}`;
    const url = `https://github.com/yaho7/texgo/releases/download/${policy.tag}/${name}`;
    if (part.version !== policy.version || part.platform !== key || part.url !== url) throw new Error(`Updater metadata mismatch: ${key}`);
    const file = path.join(directory,name); const metadata = await lstat(file);
    if (!metadata.isFile() || !metadata.size) throw new Error(`Invalid updater artifact: ${key}`);
    const signature = (await readFile(file+'.sig','utf8')).trim();
    if (part.signature !== signature) throw new Error(`Updater signature mismatch: ${key}`);
    await verifyTauriFile(file,signature,config.plugins.updater.pubkey,policy.version);
    entries[key] = {url,signature}; parts.push(partFile);
  }
  const feed = {version:policy.version,pub_date:now.toISOString(),platforms:entries};
  await writeFile(path.join(directory,'latest.json'),JSON.stringify(feed,null,2)+'\n',{flag:'wx'});
  for (const file of parts) await unlink(file);
  return feed;
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url) {
  await generateUpdaterFeed({directory:path.resolve(process.argv[2] ?? '../release'), desktop:path.resolve(import.meta.dirname,'..')});
}
