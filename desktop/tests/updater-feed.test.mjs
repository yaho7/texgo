import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile,writeFile,mkdtemp,mkdir,rm,access,readdir} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {verifyTauriDigest,verifyTauriFile} from '../scripts/updater-signature.mjs';
import {generateUpdaterFeed} from '../scripts/generate-updater-feed.mjs';
import {collectInstallers} from '../scripts/collect-installers.mjs';
const version='0.4.0',ref='refs/tags/v0.4.0';
const payload=await readFile(new URL('./fixtures/updater-payload.txt',import.meta.url));
const signature=(await readFile(new URL('./fixtures/updater-payload.txt.sig',import.meta.url),'utf8')).trim();
const config=JSON.parse(await readFile(new URL('../src-tauri/tauri.conf.json',import.meta.url),'utf8'));
const pubkey=config.plugins.updater.pubkey;
test('verifies real Tauri CLI signature and rejects changed bytes, version and trusted comment',async()=>{
 const digest=createHash('blake2b512').update(payload).digest();
 verifyTauriDigest(digest,signature,pubkey,version);
 assert.throws(()=>verifyTauriDigest(createHash('blake2b512').update('changed').digest(),signature,pubkey,version),/verification failed/);
 assert.throws(()=>verifyTauriDigest(digest,signature,pubkey,'0.5.0'),/version mismatch/);
 const forged=Buffer.from(Buffer.from(signature,'base64').toString().replace('version:0.4.0','version:0.5.0')).toString('base64');
 assert.throws(()=>verifyTauriDigest(digest,forged,pubkey,'0.5.0'),/verification failed/);
 await verifyTauriFile(new URL('./fixtures/updater-payload.txt',import.meta.url),signature,pubkey,version);
});
async function fixture(run){
 const root=await mkdtemp(path.join(os.tmpdir(),'texgo-signed-update-'));
 try{
  await mkdir(path.join(root,'src-tauri')); await mkdir(path.join(root,'release'));
  await writeFile(path.join(root,'package.json'),JSON.stringify({version}));
  await writeFile(path.join(root,'package-lock.json'),JSON.stringify({version,packages:{'':{version}}}));
  await writeFile(path.join(root,'src-tauri/Cargo.toml'),`[package]\nname = "texgo-desktop"\nversion = "${version}"\n`);
  await writeFile(path.join(root,'src-tauri/Cargo.lock'),`[[package]]\nname = "texgo-desktop"\nversion = "${version}"\n`);
  await writeFile(path.join(root,'src-tauri/tauri.conf.json'),JSON.stringify({...config,version}));
  await run(root,path.join(root,'release'));
 }finally{await rm(root,{recursive:true,force:true});}
}
const platforms=[['windows','x64','windows-x86_64','.exe'],['linux','x64','linux-x86_64','.AppImage'],['macos','arm64','darwin-aarch64','.app.tar.gz'],['macos','x64','darwin-x86_64','.app.tar.gz']];
async function artifacts(directory){
 for(const [platform,arch,key,extension] of platforms){
  const name=`texgo_${version}_${platform}${platform==='macos'?`_${arch}`:''}${extension}`;
  await writeFile(path.join(directory,name),payload);await writeFile(path.join(directory,name+'.sig'),signature);
  await writeFile(path.join(directory,`updater_${platform}_${arch}.json`),JSON.stringify({version,platform:key,url:`https://github.com/yaho7/texgo/releases/download/v${version}/${name}`,signature}));
 }
}
test('assembles all four cryptographically verified targets and removes internal part files',async()=>fixture(async(desktop,directory)=>{
 await artifacts(directory);
 const feed=await generateUpdaterFeed({directory,desktop,ref,now:new Date('2026-10-28T00:00:00Z')});
 assert.equal(feed.version,version);assert.equal(Object.keys(feed.platforms).length,4);
 assert.equal((await readdir(directory)).some(file=>file.startsWith('updater_')),false);
 assert.deepEqual(JSON.parse(await readFile(path.join(directory,'latest.json'),'utf8')),feed);
}));
test('refuses branch feeds and tampered artifacts before writing a feed',async()=>fixture(async(desktop,directory)=>{
 await artifacts(directory);
 await assert.rejects(generateUpdaterFeed({directory,desktop,ref:'refs/heads/main'}),/exact release tag/);
 await writeFile(path.join(directory,`texgo_${version}_windows.exe`),'tampered');
 await assert.rejects(generateUpdaterFeed({directory,desktop,ref}),/verification failed/);
 await assert.rejects(access(path.join(directory,'latest.json')),/ENOENT/);
}));
test('release collection requires a matching signature before copying any installer',async()=>fixture(async(desktop,destination)=>{
 const folder=path.join(desktop,'src-tauri/target/x86_64-pc-windows-msvc/release/bundle/nsis');await mkdir(folder,{recursive:true});
 await writeFile(path.join(folder,'setup.exe'),payload);
 const options={desktop,destination,ref,target:'x86_64-pc-windows-msvc',platform:'windows',arch:'x64'};
 await assert.rejects(collectInstallers(options),/ENOENT/);
 assert.deepEqual(await readdir(destination),[]);
 await writeFile(path.join(folder,'setup.exe.sig'),signature);
 assert.deepEqual(await collectInstallers(options),[`texgo_${version}_windows.exe`,`texgo_${version}_windows.exe.sig`]);
 assert.equal((await readFile(path.join(destination,`texgo_${version}_windows.exe`))).equals(payload),true);
}));
