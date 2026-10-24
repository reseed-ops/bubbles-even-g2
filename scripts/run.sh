#!/bin/sh
# Runs a toolchain command (vite, tsc, evenhub, ...) from wherever the
# node_modules actually live. Android shared storage cannot hold them, so
# when this folder has none, the command runs in the Linux-side build
# directory (created on first use by dev-env.sh), which links back to these
# sources. From the build directory itself it just runs the command.
#
#   sh scripts/run.sh 'tsc --noEmit && vite build'
set -e
if [ -d "$PWD/node_modules/.bin" ] && [ -x "$PWD/node_modules/.bin/vite" ]; then
  DIR=$PWD
else
  DIR=${BUBBLES_BUILD_DIR:-$HOME/build/frozen-bubble}
  if [ ! -x "$DIR/node_modules/.bin/vite" ]; then
    echo "Toolchain not installed yet; setting up $DIR ..." >&2
    sh "$(dirname "$0")/dev-env.sh"
  fi
  echo "(running in $DIR)" >&2
fi
cd "$DIR"
export PATH="$DIR/node_modules/.bin:$PATH"
exec sh -c "$*"
