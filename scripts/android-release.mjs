// Build, sign and (optionally) publish a SHELLY Android release.
//
//   node scripts/android-release.mjs --notes "What changed" [--upload] [--copy-to "G:\My Drive\shelly apps"]
//
// What it does:
//   1. reads versionCode / versionName from android/app/build.gradle.kts (bump versionCode every release!)
//   2. builds a signed release APK with Android Studio's bundled Java (passwords are asked for here, hidden,
//      or read from android/keystore.properties, or from the SHELLY_* environment variables; never stored)
//   3. prints the signing certificate's SHA-256 (what you register with Google) and the APK's SHA-256
//   4. writes android/release/latest.json and a copy of the APK
//   5. with --upload: puts the APK and latest.json into the Worker's KV so the website and the app's
//      self-updater can serve them. Upload is the only step that touches your live site.
//
// Nothing here is run for you: it needs your keystore passwords.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { Writable } from "node:stream";

const root = resolve(import.meta.dirname, "..");
const android = join(root, "android");
const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (n, d = "") => {
  const i = args.indexOf(n);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};

const fail = (m) => {
  console.error(`\nERROR: ${m}\n`);
  process.exit(1);
};

// ── version ──
const gradle = readFileSync(join(android, "app", "build.gradle.kts"), "utf8");
const versionCode = Number(/versionCode\s*=\s*(\d+)/.exec(gradle)?.[1]);
const versionName = /versionName\s*=\s*"([^"]+)"/.exec(gradle)?.[1];
const minSdk = Number(/minSdk\s*=\s*(\d+)/.exec(gradle)?.[1] ?? 26);
if (!versionCode || !versionName) fail("Could not read versionCode / versionName from android/app/build.gradle.kts");
console.log(`SHELLY ${versionName} (versionCode ${versionCode})`);

// ── toolchain ──
const jbr = process.env.JAVA_HOME || "C:\\Program Files\\Android\\Android Studio\\jbr";
const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT || join(process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local"), "Android", "Sdk");
if (!existsSync(join(jbr, "bin"))) fail(`Java not found at ${jbr}. Set JAVA_HOME to Android Studio's "jbr" folder.`);

// ── signing details ──
function readProps(file) {
  const out = {};
  if (!existsSync(file)) return out;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Za-z]+)\s*=\s*(.*)$/.exec(line);
    if (m && !line.trim().startsWith("#")) out[m[1]] = m[2].replace(/\\\\/g, "\\");
  }
  return out;
}
const props = readProps(join(android, "keystore.properties"));
const keystore = process.env.SHELLY_KEYSTORE || props.storeFile || join(homedir(), ".shelly-keys", "shelly-release.jks");
if (!existsSync(keystore)) fail(`Keystore not found: ${keystore}\nCreate it first (see docs/ANDROID.md) or set SHELLY_KEYSTORE.`);

function ask(question) {
  return new Promise((res) => {
    let muted = false;
    const out = new Writable({
      write(chunk, enc, cb) {
        if (!muted) process.stdout.write(chunk, enc);
        cb();
      },
    });
    const rl = createInterface({ input: process.stdin, output: out, terminal: true });
    rl.question(question, (a) => {
      rl.close();
      process.stdout.write("\n");
      res(a);
    });
    muted = true;
  });
}

const alias = process.env.SHELLY_KEY_ALIAS || props.keyAlias || "shelly";
let storePassword = process.env.SHELLY_STORE_PASSWORD || props.storePassword;
let keyPassword = process.env.SHELLY_KEY_PASSWORD || props.keyPassword;
if (!storePassword) {
  if (!process.stdin.isTTY) fail("No keystore password. Run this in your own terminal so it can ask, or set SHELLY_STORE_PASSWORD.");
  storePassword = await ask("Keystore password (typing is hidden): ");
}
keyPassword ||= storePassword; // keytool uses the same password for both unless you chose otherwise
if (!storePassword) fail("Empty password.");

const env = {
  ...process.env,
  JAVA_HOME: jbr,
  SHELLY_KEYSTORE: keystore,
  SHELLY_STORE_PASSWORD: storePassword,
  SHELLY_KEY_PASSWORD: keyPassword,
  SHELLY_KEY_ALIAS: alias,
};

// ── build ──
const apkOut = join(android, "app", "build", "outputs", "apk", "release", "app-release.apk");
if (!flag("--skip-build")) {
  console.log("\nBuilding the signed release APK…");
  const gw = process.platform === "win32" ? "gradlew.bat" : "./gradlew";
  const r = spawnSync(gw, ["clean", "test", "assembleRelease"], { cwd: android, env, stdio: "inherit", shell: process.platform === "win32" });
  if (r.status !== 0) fail("The Gradle build failed (see above). A wrong keystore password is the usual cause.");
}
if (!existsSync(apkOut)) fail(`Signed APK not found at ${apkOut}. If the build ran, the signing details were not picked up.`);

// ── verify the signature and show the certificate fingerprint ──
const buildToolsDir = join(sdk, "build-tools");
const tools = existsSync(buildToolsDir) ? (await import("node:fs")).readdirSync(buildToolsDir).sort().reverse() : [];
const apksigner = tools.map((v) => join(buildToolsDir, v, process.platform === "win32" ? "apksigner.bat" : "apksigner")).find(existsSync);
let certSha256 = "";
if (apksigner) {
  const v = spawnSync(apksigner, ["verify", "--print-certs", apkOut], { env, encoding: "utf8", shell: process.platform === "win32" });
  if (v.status !== 0) fail(`apksigner says the APK is not validly signed:\n${v.stdout}${v.stderr}`);
  certSha256 = /certificate SHA-256 digest:\s*([0-9a-f]+)/i.exec(v.stdout)?.[1] ?? "";
} else {
  console.warn("apksigner not found; skipped signature verification.");
}

const bytes = readFileSync(apkOut);
const sha256 = createHash("sha256").update(bytes).digest("hex");
if (bytes.length > 24 * 1024 * 1024) fail(`APK is ${(bytes.length / 1048576).toFixed(1)} MB; Workers KV values are limited to 25 MiB.`);

const latest = {
  versionCode,
  versionName,
  sha256,
  size: bytes.length,
  minSdk,
  notes: opt("--notes", ""),
  published: new Date().toISOString(),
};
const outDir = join(android, "release");
mkdirSync(outDir, { recursive: true });
const apkCopy = join(outDir, `SHELLY-${versionName}.apk`);
copyFileSync(apkOut, apkCopy);
writeFileSync(join(outDir, "latest.json"), JSON.stringify(latest, null, 2));
const copyTo = opt("--copy-to");
if (copyTo) {
  mkdirSync(copyTo, { recursive: true });
  copyFileSync(apkOut, join(copyTo, `SHELLY-${versionName}.apk`));
}

console.log("\nDone.");
console.log(`  APK:            ${apkCopy} (${(bytes.length / 1048576).toFixed(2)} MB)`);
console.log(`  APK SHA-256:    ${sha256}`);
if (certSha256) console.log(`  Signing cert SHA-256 (register this with Google): ${certSha256}`);
if (copyTo) console.log(`  Copied to:      ${join(copyTo, `SHELLY-${versionName}.apk`)}`);

// ── publish ──
if (!flag("--upload")) {
  console.log("\nNot uploaded. Add --upload to publish this build to the website and the app's self-updater.");
  process.exit(0);
}
console.log("\nUploading to Cloudflare KV…");
const npx = process.platform === "win32" ? "npx.cmd" : "npx";
const wr = (a) => spawnSync(npx, ["wrangler", ...a], { cwd: root, encoding: "utf8", shell: process.platform === "win32" });

let nsId = process.env.SHELLY_KV_NAMESPACE_ID;
if (!nsId) {
  const list = wr(["kv", "namespace", "list"]);
  try {
    nsId = JSON.parse(list.stdout).find((n) => n.title === "shelly-state")?.id;
  } catch {
    /* fall through */
  }
}
if (!nsId) fail('Could not find the "shelly-state" KV namespace. Run `npx wrangler login`, or set SHELLY_KV_NAMESPACE_ID.');

// refuse to go backwards: the app only installs a higher versionCode
try {
  const cur = await fetch("https://shelly.scienceandfire66.workers.dev/api/android/latest.json").then((r) => (r.ok ? r.json() : null));
  if (cur && cur.versionCode >= versionCode) fail(`The live release is already versionCode ${cur.versionCode}. Bump versionCode in android/app/build.gradle.kts.`);
} catch {
  /* offline check is best effort */
}

const put = (key, file) => wr(["kv", "key", "put", key, "--path", file, "--namespace-id", nsId, "--remote"]);
const a = put(`android:apk:${versionCode}`, apkCopy);
if (a.status !== 0) fail(`Uploading the APK failed:\n${a.stdout}${a.stderr}`);
const l = put("android:latest", join(outDir, "latest.json"));
if (l.status !== 0) fail(`Uploading latest.json failed:\n${l.stdout}${l.stderr}`);
console.log(`Published SHELLY ${versionName}. Download page: https://shelly.scienceandfire66.workers.dev/get-android/`);
