#!/bin/bash

echo "🎬 Jellyfin Custom Client - Setup"
echo "=================================="
echo ""

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "❌ Node.js not found!"
    echo "Please install Node.js 20+ first:"
    echo "  curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash"
    echo "  source ~/.bashrc"
    echo "  nvm install 20"
    exit 1
fi

# Check Node version
NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 20 ]; then
    echo "❌ Node.js version too old (need 20+, have $NODE_VERSION)"
    echo "Please update Node.js"
    exit 1
fi

echo "✅ Node.js $(node -v) detected"

# Check if VLC is installed
if ! command -v vlc &> /dev/null; then
    echo "⚠️  VLC not found!"
    read -p "Install VLC now? (y/n) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        sudo apt update
        sudo apt install -y vlc
    else
        echo "❌ VLC is required. Please install it manually:"
        echo "  sudo apt install vlc"
        exit 1
    fi
fi

echo "✅ VLC detected"
echo ""

# Install dependencies
echo "📦 Installing dependencies..."
npm install

if [ $? -eq 0 ]; then
    echo ""
    echo "✅ Setup complete!"
    echo ""
    echo "🚀 To start the app:"
    echo "  npm start"
    echo ""
    echo "📖 See README.md for more information"
    echo ""
else
    echo "❌ Installation failed"
    exit 1
fi
