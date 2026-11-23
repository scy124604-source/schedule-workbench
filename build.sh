#!/bin/bash
# 打包「日程工作台」为可双击运行的 macOS .app
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
APP_NAME="日程工作台"
EXEC_NAME="ScheduleWorkbench"
BUNDLE_ID="local.schedule.workbench"
VERSION="1.0.0"

SRC_APP="$ROOT/node_modules/electron/dist/Electron.app"
BUILD_DIR="$ROOT/build"
OUT_APP="$BUILD_DIR/$APP_NAME.app"

if [ ! -d "$SRC_APP" ]; then
  echo "❌ 找不到 Electron 运行时：$SRC_APP"
  exit 1
fi

echo "› 清理旧的构建产物"
rm -rf "$BUILD_DIR"
mkdir -p "$BUILD_DIR"

echo "› 复制 Electron 运行时"
cp -R "$SRC_APP" "$OUT_APP"

echo "› 移除默认应用"
rm -rf "$OUT_APP/Contents/Resources/default_app.asar"

echo "› 写入应用代码"
APP_DIR="$OUT_APP/Contents/Resources/app"
mkdir -p "$APP_DIR"
cp "$ROOT/main.js" "$ROOT/preload.js" "$APP_DIR/"
mkdir -p "$APP_DIR/renderer"
cp "$ROOT/renderer/index.html" "$ROOT/renderer/styles.css" "$ROOT/renderer/renderer.js" "$APP_DIR/renderer/"
cp "$ROOT/renderer/widget.html" "$ROOT/renderer/widget.css" "$ROOT/renderer/widget.js" "$APP_DIR/renderer/"

echo "› 写入学习笔记 MCP 服务"
mkdir -p "$APP_DIR/mcp"
cp "$ROOT/mcp/study-mcp.js" "$ROOT/mcp/study-mcp" "$APP_DIR/mcp/"
chmod +x "$APP_DIR/mcp/study-mcp"

cat > "$APP_DIR/package.json" <<'PKG'
{
  "name": "schedule-workbench",
  "productName": "日程工作台",
  "version": "1.0.0",
  "main": "main.js"
}
PKG

echo "› 重命名可执行文件"
mv "$OUT_APP/Contents/MacOS/Electron" "$OUT_APP/Contents/MacOS/$EXEC_NAME"

echo "› 安装图标"
cp "$ROOT/assets/icon.icns" "$OUT_APP/Contents/Resources/icon.icns"
rm -f "$OUT_APP/Contents/Resources/electron.icns"

echo "› 修改 Info.plist"
PLIST="$OUT_APP/Contents/Info.plist"
PB=/usr/libexec/PlistBuddy
set_key() {
  if $PB -c "Print :$1" "$PLIST" >/dev/null 2>&1; then
    $PB -c "Set :$1 $2" "$PLIST"
  else
    $PB -c "Add :$1 string $2" "$PLIST"
  fi
}
set_key CFBundleName "$APP_NAME"
set_key CFBundleDisplayName "$APP_NAME"
set_key CFBundleExecutable "$EXEC_NAME"
set_key CFBundleIdentifier "$BUNDLE_ID"
set_key CFBundleIconFile "icon.icns"
set_key CFBundleShortVersionString "$VERSION"
set_key CFBundleVersion "$VERSION"
$PB -c "Delete :LSApplicationCategoryType" "$PLIST" >/dev/null 2>&1 || true

echo "› 清除扩展属性"
xattr -cr "$OUT_APP" 2>/dev/null || true

echo "› 重新签名（ad-hoc）"
codesign --force --deep --sign - "$OUT_APP" 2>&1 | sed 's/^/   /' || true

echo "› 验证签名"
if codesign --verify --deep --strict "$OUT_APP" 2>/dev/null; then
  echo "   ✅ 签名校验通过"
else
  echo "   ⚠️  签名校验未通过（本地使用通常仍可运行）"
fi

echo "› 校验 Info.plist"
plutil -lint "$PLIST"

SIZE=$(du -sh "$OUT_APP" | cut -f1)
echo ""
echo "✅ 打包完成：$OUT_APP  ($SIZE)"
