#!/bin/bash
#
# Wide Thought Host (WTH) installer — build from source
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/Wan-1230/Wide-Thought-Host/main/scripts/install.sh | bash
#   git clone https://github.com/Wan-1230/Wide-Thought-Host.git && cd Wide-Thought-Host && bash scripts/install.sh

set -e

REPO="https://github.com/Wan-1230/Wide-Thought-Host.git"
INSTALL_DIR="${WTH_INSTALL_DIR:-$HOME/.wth}"
BIN_DIR="${WTH_BIN_DIR:-$HOME/.wth/bin}"

echo "Wide Thought Host (WTH) installer"
echo "=================================="

# Check Rust
if ! command -v cargo &>/dev/null; then
    echo "Rust is required. Install from https://rustup.rs"
    echo "  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh"
    exit 1
fi

# Check protoc
if ! command -v protoc &>/dev/null; then
    echo "protoc is required."
    echo "  macOS: brew install protobuf"
    echo "  Ubuntu: sudo apt-get install protobuf-compiler"
    echo "  Windows: winget install Google.Protobuf"
    exit 1
fi

# Clone if not already in repo
if [ ! -f "Cargo.toml" ] || ! grep -q "Wide Thought Host" Cargo.toml 2>/dev/null; then
    echo "Cloning WTH..."
    git clone "$REPO" "$INSTALL_DIR/src"
    cd "$INSTALL_DIR/src"
else
    echo "Building from current directory..."
fi

echo "Building wth (release)..."
cargo build -p wth-pager-bin --release

mkdir -p "$BIN_DIR"
cp target/release/wth "$BIN_DIR/wth"
chmod +x "$BIN_DIR/wth"

# Generate completions
mkdir -p "$HOME/.wth/completions/bash" "$HOME/.wth/completions/zsh"
"$BIN_DIR/wth" completions bash > "$HOME/.wth/completions/bash/wth.bash" 2>/dev/null || true
"$BIN_DIR/wth" completions zsh  > "$HOME/.wth/completions/zsh/_wth"     2>/dev/null || true
if mkdir -p "$HOME/.config/fish/completions" 2>/dev/null; then
    "$BIN_DIR/wth" completions fish > "$HOME/.config/fish/completions/wth.fish" 2>/dev/null || true
fi

# Add to PATH if needed
case "$(basename "${SHELL:-}")" in
    bash) RCFILE="$HOME/.bashrc" ;;
    zsh)  RCFILE="$HOME/.zshrc" ;;
    fish) RCFILE="$HOME/.config/fish/config.fish" ;;
    *)    RCFILE="" ;;
esac

if [ -n "$RCFILE" ] && ! grep -q ".wth/bin" "$RCFILE" 2>/dev/null; then
    printf '\n# Wide Thought Host\nexport PATH="$HOME/.wth/bin:$PATH"\n' >> "$RCFILE"
    echo "Added $BIN_DIR to PATH in $RCFILE"
fi

echo ""
echo "WTH installed to $BIN_DIR/wth"
echo "Run 'wth' to start!"
