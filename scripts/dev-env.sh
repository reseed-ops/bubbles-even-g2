#!/bin/sh
# Android shared storage (/sdcard) cannot hold symlinks or run native binaries,
# so npm and Vite cannot work directly in this folder. This creates a build
# directory on the Linux filesystem whose entries link back to the sources
# here, and installs the toolchain there. Edit files in this folder; run
# npm scripts from the build directory.
set -e
SRC=$(cd "$(dirname "$0")/.." && pwd)
DEST=${BUBBLES_BUILD_DIR:-$HOME/build/frozen-bubble}
mkdir -p "$DEST"
for f in "$SRC"/* "$SRC"/.gitignore; do
  name=$(basename "$f")
  case "$name" in node_modules|dist|*.ehpk|package-lock.json) continue ;; esac
  ln -sfn "$f" "$DEST/$name"
done
cd "$DEST"
npm install --no-fund --no-audit
echo
echo "Build directory ready: $DEST"
echo "  cd $DEST && npm run dev"
