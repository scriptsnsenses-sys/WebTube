#!/usr/bin/env bash
# Publish the YoutubeExplode bridge as a self-contained linux-x64 binary.
set -euo pipefail

DOTNET_DIR="$PWD/.dotnet"
if ! command -v dotnet >/dev/null 2>&1; then
  if [ ! -x "$DOTNET_DIR/dotnet" ]; then
    echo "Installing .NET 10 SDK into $DOTNET_DIR"
    curl -fsSL https://dot.net/v1/dotnet-install.sh -o /tmp/dotnet-install.sh
    bash /tmp/dotnet-install.sh --channel 10.0 --install-dir "$DOTNET_DIR"
  fi
  export PATH="$DOTNET_DIR:$PATH"
fi

export DOTNET_CLI_TELEMETRY_OPTOUT=1
dotnet publish youtube-bridge/WebTube.YoutubeBridge \
  -c Release \
  -r linux-x64 \
  --self-contained true \
  -o bridge-out
