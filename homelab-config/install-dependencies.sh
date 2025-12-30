#!/bin/bash
set -e

# Install SOPS and AGE
echo "Installing SOPS and AGE..."
echo ""

# Check if Go is installed
if ! command -v go &> /dev/null; then
    echo "Error: Go is not installed. Please install Go first."
    echo "See: https://golang.org/doc/install"
    exit 1
fi

echo "Installing SOPS..."
go install github.com/getsops/sops/v3/cmd/sops@latest

echo "Installing AGE..."
go install filippo.io/age/cmd/age@latest
go install filippo.io/age/cmd/age-keygen@latest

echo ""
echo "✓ Installation complete!"
echo ""
echo "Make sure \$HOME/go/bin is in your PATH:"
echo "  export PATH=\"\$PATH:\$HOME/go/bin\""
echo ""
echo "Then run: ./setup-encryption.sh"
