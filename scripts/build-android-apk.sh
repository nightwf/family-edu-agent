#!/usr/bin/env bash
# 构建禾芽家庭私教 安卓客户端（平板 / 手机共用）发布包。
# 需要：JDK 17、Android SDK（compileSdk 36、build-tools 35.0.0）。
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/android"

JAVA_HOME="${JAVA_HOME:-}"
if [ ! -x "${JAVA_HOME}/bin/javac" ]; then
  JAVA_HOME="$(/usr/libexec/java_home -v 17 2>/dev/null || true)"
fi
if [ ! -x "${JAVA_HOME}/bin/javac" ] && [ -x /opt/homebrew/opt/openjdk@17/bin/javac ]; then
  JAVA_HOME=/opt/homebrew/opt/openjdk@17
fi
export JAVA_HOME
if [ ! -x "$JAVA_HOME/bin/javac" ]; then
  echo "找不到 JDK 17，请先安装（brew install openjdk@17）" >&2
  exit 1
fi

if [ ! -f local.properties ]; then
  printf 'sdk.dir=%s\n' "${ANDROID_HOME:-$HOME/Library/Android/sdk}" > local.properties
fi

./gradlew --console=plain :app:assembleRelease

APK="app/build/outputs/apk/release/app-release.apk"
VERSION="$(grep -oE 'versionName = "[^"]+"' app/build.gradle.kts | head -1 | cut -d'"' -f2)"
DEST="$ROOT/dist/android/heya-family-edu-${VERSION}.apk"
mkdir -p "$(dirname "$DEST")"
cp "$APK" "$DEST"

SDK="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
APKSIGNER="$SDK/build-tools/35.0.0/apksigner"
if [ -x "$APKSIGNER" ]; then
  "$APKSIGNER" verify --print-certs "$DEST" | head -6
fi

echo
echo "APK: $DEST"
ls -lh "$DEST" | awk '{print "大小:", $5}'
