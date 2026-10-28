import { copyFile, mkdir, readdir, lstat, readFile, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { verifyTauriFile } from "./updater-signature.mjs";
import { checkVersions } from "./release-policy.mjs";

const targets = {
  "windows-x64": { target: "x86_64-pc-windows-msvc", formats: [["nsis", ".exe"]] },
  "linux-x64": { target: "x86_64-unknown-linux-gnu", formats: [["deb", ".deb"], ["appimage", ".AppImage"]] },
  "macos-arm64": { target: "aarch64-apple-darwin", formats: [["dmg", ".dmg"]] },
  "macos-x64": { target: "x86_64-apple-darwin", formats: [["dmg", ".dmg"]] },
};
export async function collectInstallers({ target, platform, arch, desktop = fileURLToPath(new URL("../", import.meta.url)), destination = path.resolve(desktop, "../desktop-installers"), ref = process.env.GITHUB_REF ?? "" }) {
  const spec = targets[`${platform}-${arch}`];
  if (!spec || target !== spec.target) throw new Error("Expected a matching installer target, platform and architecture");
  const { version, publish } = await checkVersions(desktop, ref);
  const prepared = [];
  for (const [folder, extension] of spec.formats) {
    const source = path.join(desktop, "src-tauri/target", target, "release/bundle", folder);
    const files = (await readdir(source)).filter(file => file.endsWith(extension));
    if (files.length !== 1) throw new Error(`Expected exactly one ${platform} ${extension} installer, found ${files.length}`);
    const input = path.join(source, files[0]); const metadata = await lstat(input);
    if (!metadata.isFile() || !metadata.size) throw new Error(`Invalid or empty installer: ${files[0]}`);
    // Windows/Linux currently have one architecture. macOS needs the suffix to
    // distinguish the two supported builds without retaining Tauri's filename.
    const name = `texgo_${version}_${platform}${platform === "macos" ? `_${arch}` : ""}${extension}`;
    prepared.push({ input, name });
  }
  let updatePart = null;
  if (publish) {
    const updaterExtension = platform === "macos" ? ".app.tar.gz" : platform === "windows" ? ".exe" : ".AppImage";
    let input, name;
    if (platform === "macos") {
      const folder = path.join(desktop, "src-tauri/target", target, "release/bundle/macos");
      const files = (await readdir(folder)).filter(file => file.endsWith(updaterExtension));
      if (files.length !== 1) throw new Error("Expected exactly one macOS updater archive");
      input = path.join(folder, files[0]); name = `texgo_${version}_macos_${arch}.app.tar.gz`;
      const metadata = await lstat(input);
      if (!metadata.isFile() || !metadata.size) throw new Error("Invalid updater archive");
      prepared.push({input, name});
    } else {
      ({input, name} = prepared.find(file => file.name.endsWith(updaterExtension)));
    }
    const signatureFile = input + ".sig";
    const metadata = await lstat(signatureFile);
    if (!metadata.isFile() || !metadata.size || metadata.size > 16384) throw new Error("Invalid updater signature file");
    const signature = (await readFile(signatureFile, "utf8")).trim();
    const config = JSON.parse(await readFile(path.join(desktop, "src-tauri/tauri.conf.json"), "utf8"));
    await verifyTauriFile(input, signature, config.plugins.updater.pubkey, version);
    prepared.push({input: signatureFile, name: name + ".sig"});
    const platformKey = platform === "macos" ? `darwin-${arch === "arm64" ? "aarch64" : "x86_64"}` : `${platform}-x86_64`;
    updatePart = {version, platform: platformKey, url: `https://github.com/yaho7/texgo/releases/download/v${version}/${name}`, signature};
  }
  await mkdir(destination, { recursive: true });
  for (const { input, name } of prepared) await copyFile(input, path.join(destination, name), constants.COPYFILE_EXCL);
  if (updatePart) await writeFile(path.join(destination, `updater_${platform}_${arch}.json`), JSON.stringify(updatePart), {flag:"wx"});
  return prepared.map(({ name }) => name);
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const [target, platform, arch] = process.argv.slice(2);
  const files = await collectInstallers({ target, platform, arch });
  for (const file of files) console.log(file);
}
