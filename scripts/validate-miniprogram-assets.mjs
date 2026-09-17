import fs from "node:fs";
import path from "node:path";

const root = path.resolve("miniprogram");
const assetsRoot = path.join(root, "assets");
const illustrationsRoot = path.join(assetsRoot, "illustrations");
const PNG_LIMIT = 300 * 1024;
const AVATAR_LIMIT = 80 * 1024;
const ILLUSTRATIONS_LIMIT = 1024 * 1024;
const PACKAGE_LIMIT = 2 * 1024 * 1024;

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

function bytes(files) {
  return files.reduce((sum, file) => sum + fs.statSync(file).size, 0);
}

function human(value) {
  return `${(value / 1024).toFixed(1)}KB`;
}

function validate({ quiet = false } = {}) {
  const errors = [];
  const files = walk(root);
  const sourceFiles = files.filter((file) => /\.(wxml|wxss|js|json)$/.test(file));
  const referenced = new Set();
  for (const file of sourceFiles) {
    const source = fs.readFileSync(file, "utf8");
    for (const match of source.matchAll(/\/assets\/[A-Za-z0-9_./-]+\.(?:png|webp|jpe?g|svg)/g)) {
      referenced.add(match[0]);
    }
  }
  for (const ref of referenced) {
    if (!fs.existsSync(path.join(root, ref.slice(1)))) errors.push(`素材引用不存在: ${ref}`);
  }

  const pngs = files.filter((file) => file.endsWith(".png"));
  for (const file of pngs) {
    const size = fs.statSync(file).size;
    if (size > PNG_LIMIT) errors.push(`PNG 超过 300KB: ${path.relative(root, file)} (${human(size)})`);
    if (/avatar/i.test(path.basename(file)) && size > AVATAR_LIMIT) {
      errors.push(`头像超过 80KB: ${path.relative(root, file)} (${human(size)})`);
    }
  }
  const stableAvatar = path.join(illustrationsRoot, "child-stable.png");
  if (fs.existsSync(stableAvatar) && fs.statSync(stableAvatar).size > AVATAR_LIMIT) {
    errors.push(`学生头像素材超过 80KB: assets/illustrations/child-stable.png (${human(fs.statSync(stableAvatar).size)})`);
  }

  const illustrationFiles = walk(illustrationsRoot);
  const illustrationBytes = bytes(illustrationFiles);
  const packageBytes = bytes(files);
  if (illustrationBytes > ILLUSTRATIONS_LIMIT) errors.push(`插画目录超过 1MB: ${human(illustrationBytes)}`);
  if (packageBytes > PACKAGE_LIMIT) errors.push(`小程序完整目录超过 2MB: ${human(packageBytes)}`);

  if (!quiet) {
    console.log(`素材引用 ${referenced.size} 个，插画 ${illustrationFiles.length} 个 / ${human(illustrationBytes)}，完整目录 ${human(packageBytes)}`);
    for (const file of illustrationFiles.sort()) {
      console.log(`  ${human(fs.statSync(file).size).padStart(9)}  ${path.relative(root, file)}`);
    }
  }
  return { errors, illustrationBytes, packageBytes };
}

if (process.argv.includes("--self-test")) {
  const probe = path.join(illustrationsRoot, "__oversize-probe.png");
  fs.writeFileSync(probe, Buffer.alloc(PNG_LIMIT + 1));
  try {
    const failed = validate({ quiet: true });
    if (!failed.errors.some((item) => item.includes("__oversize-probe.png"))) {
      throw new Error("反向验证失败：超限 PNG 没有被拦截");
    }
    console.log("反向验证通过：临时超限 PNG 已被检查器拦截");
  } finally {
    fs.unlinkSync(probe);
  }
}

const result = validate();
if (result.errors.length) {
  for (const error of result.errors) console.error(`  ✗ ${error}`);
  process.exit(1);
}
console.log("小程序素材与包体检查通过");
