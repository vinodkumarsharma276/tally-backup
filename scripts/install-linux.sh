#!/bin/bash
# Tally Backup Pro - Linux Installer
# ==================================

set -e

echo "Installing Tally Backup Pro..."
echo "=============================="

# Check if running as root for system-wide installation
if [[ $EUID -eq 0 ]]; then
    echo "Installing system-wide (all users)..."
    INSTALL_DIR="/usr/local/bin"
    DATA_DIR="/etc/tally-backup-pro"
    SYSTEMD_SERVICE=true
else
    echo "Installing for current user..."
    INSTALL_DIR="$HOME/.local/bin"
    DATA_DIR="$HOME/.config/tally-backup-pro"
    SYSTEMD_SERVICE=false
    mkdir -p "$INSTALL_DIR"
fi

# Create directories
echo "Creating directories..."
mkdir -p "$DATA_DIR"/{config,data,logs,temp}

# Copy executable
echo "Installing executable..."
cp tally-backup "$INSTALL_DIR/"
chmod +x "$INSTALL_DIR/tally-backup"

# Copy configuration templates
echo "Installing configuration templates..."
cp -r config/* "$DATA_DIR/config/"

# Add to PATH if not already there
if [[ ":$PATH:" != *":$INSTALL_DIR:"* ]]; then
    echo "Adding to PATH..."
    if [[ $EUID -eq 0 ]]; then
        # System-wide PATH
        echo "export PATH=\"$INSTALL_DIR:\$PATH\"" > /etc/profile.d/tally-backup-pro.sh
        chmod +x /etc/profile.d/tally-backup-pro.sh
    else
        # User PATH
        if ! grep -q "$INSTALL_DIR" ~/.bashrc; then
            echo "export PATH=\"$INSTALL_DIR:\$PATH\"" >> ~/.bashrc
        fi
        if [[ -f ~/.zshrc ]] && ! grep -q "$INSTALL_DIR" ~/.zshrc; then
            echo "export PATH=\"$INSTALL_DIR:\$PATH\"" >> ~/.zshrc
        fi
    fi
fi

# Create desktop entry (if desktop environment available)
if command -v xdg-desktop-menu >/dev/null 2>&1; then
    echo "Creating desktop entry..."
    
    DESKTOP_FILE="$HOME/.local/share/applications/tally-backup-pro.desktop"
    if [[ $EUID -eq 0 ]]; then
        DESKTOP_FILE="/usr/share/applications/tally-backup-pro.desktop"
    fi
    
    mkdir -p "$(dirname "$DESKTOP_FILE")"
    cat > "$DESKTOP_FILE" << EOF
[Desktop Entry]
Name=Tally Backup Pro
Comment=Professional backup solution for Tally software data
Exec=$INSTALL_DIR/tally-backup status
Icon=drive-harddisk
Terminal=true
Type=Application
Categories=Utility;System;
StartupNotify=true
EOF
    
    # Update desktop database
    if command -v update-desktop-database >/dev/null 2>&1; then
        if [[ $EUID -eq 0 ]]; then
            update-desktop-database /usr/share/applications/
        else
            update-desktop-database ~/.local/share/applications/
        fi
    fi
fi

# Create wrapper script for easy access
echo "Creating wrapper scripts..."
WRAPPER_SCRIPT="$DATA_DIR/tally-backup-wrapper.sh"
cat > "$WRAPPER_SCRIPT" << EOF
#!/bin/bash
# Tally Backup Pro Wrapper Script
cd "$DATA_DIR"
"$INSTALL_DIR/tally-backup" "\$@"
EOF
chmod +x "$WRAPPER_SCRIPT"

# Create uninstaller
echo "Creating uninstaller..."
UNINSTALL_SCRIPT="$DATA_DIR/uninstall.sh"
cat > "$UNINSTALL_SCRIPT" << EOF
#!/bin/bash
# Tally Backup Pro Uninstaller

echo "Uninstalling Tally Backup Pro..."

# Remove executable
rm -f "$INSTALL_DIR/tally-backup"

# Remove desktop entry
rm -f "$HOME/.local/share/applications/tally-backup-pro.desktop"
if [[ $EUID -eq 0 ]]; then
    rm -f "/usr/share/applications/tally-backup-pro.desktop"
fi

# Remove from PATH
if [[ $EUID -eq 0 ]]; then
    rm -f "/etc/profile.d/tally-backup-pro.sh"
else
    sed -i '\\|$INSTALL_DIR|d' ~/.bashrc 2>/dev/null || true
    sed -i '\\|$INSTALL_DIR|d' ~/.zshrc 2>/dev/null || true
fi

# Ask about data removal
echo
read -p "Remove all data and configuration files? (y/N): " -n 1 -r
echo
if [[ \$REPLY =~ ^[Yy]\$ ]]; then
    rm -rf "$DATA_DIR"
    echo "All data removed."
else
    echo "Configuration and data preserved in: $DATA_DIR"
fi

echo "Tally Backup Pro has been uninstalled."
EOF
chmod +x "$UNINSTALL_SCRIPT"

echo
echo "========================================"
echo "Installation completed successfully!"
echo "========================================"
echo
echo "Tally Backup Pro has been installed to:"
echo "  $INSTALL_DIR/tally-backup"
echo
echo "Data will be stored in:"
echo "  $DATA_DIR"
echo
echo "Next steps:"
if [[ $EUID -eq 0 ]]; then
    echo "  1. Restart your terminal or log out/in"
else
    echo "  1. Restart your terminal or run: source ~/.bashrc"
fi
echo "  2. Run: tally-backup setup-wizard"
echo "  3. Follow the setup instructions"
echo
echo "Alternative commands:"
echo "  • Setup: $WRAPPER_SCRIPT setup-wizard"
echo "  • Status: $WRAPPER_SCRIPT status"
echo "  • Backup: $WRAPPER_SCRIPT backup"
echo
echo "To uninstall: $UNINSTALL_SCRIPT"
echo
