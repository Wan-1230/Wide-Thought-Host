#!/bin/bash
#
# Wide Thought Host (WTH) enterprise installer — build from source
# Same as install.sh but with enterprise-oriented defaults.
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/Wan-1230/Wide-Thought-Host/main/scripts/install-enterprise.sh | bash

export WTH_INSTALL_DIR="${WTH_INSTALL_DIR:-/opt/wth}"
exec bash <(curl -fsSL https://raw.githubusercontent.com/Wan-1230/Wide-Thought-Host/main/scripts/install.sh)
