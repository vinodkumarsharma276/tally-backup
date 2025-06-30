# Tally Backup Pro - Professional Distribution Guide

This document provides comprehensive instructions for distributing and deploying Tally Backup Pro across Windows and Linux systems with scheduled automatic backups.

## 📦 Distribution Packages Available

After running `npm run build-release`, you'll get these distribution packages:

### 1. **Windows Package** (`tally-backup-pro-1.0.0-windows.zip`)
- **Contents**: Standalone executable + installer + configuration templates
- **Target**: Windows 10/11 systems
- **Size**: ~23 MB
- **Features**: No Node.js required, Windows service support, desktop shortcuts

### 2. **Linux Package** (`tally-backup-pro-1.0.0-linux.tar.gz`)
- **Contents**: Standalone executable + installer + configuration templates  
- **Target**: Linux distributions (Ubuntu, CentOS, RHEL, etc.)
- **Size**: ~27 MB
- **Features**: No Node.js required, systemd service support, desktop entries

### 3. **Source Package** (`tally-backup-pro-1.0.0-source.zip`)
- **Contents**: Full source code + scripts + documentation
- **Target**: Developers and systems with Node.js
- **Size**: ~50 KB
- **Features**: Full customization, requires Node.js 14+

### 4. **Docker Package** (`tally-backup-pro-1.0.0-docker.zip`)
- **Contents**: Dockerfile + docker-compose + source files
- **Target**: Containerized deployments
- **Size**: ~20 KB
- **Features**: Isolated environment, easy scaling, container orchestration

---

## 🚀 Quick Deployment Guide

### For End Users (Recommended)

#### Windows Users:
1. **Download**: `tally-backup-pro-1.0.0-windows.zip`
2. **Extract** to any folder
3. **Right-click** on `install.bat` → **"Run as administrator"**
4. **Open Command Prompt** and run: `tally-backup setup-wizard`
5. **Follow the interactive setup**

#### Linux Users:
1. **Download**: `tally-backup-pro-1.0.0-linux.tar.gz`
2. **Extract**: `tar -xzf tally-backup-pro-1.0.0-linux.tar.gz`
3. **Install**: `chmod +x install.sh && ./install.sh`
4. **Setup**: `tally-backup setup-wizard`
5. **For service**: `sudo tally-backup install-service`

---

## 🏢 Enterprise Deployment

### Option 1: NPM Registry (Internal/Public)

```bash
# Publish to internal registry
npm publish --registry=https://your-internal-registry.com

# Install on target systems
npm install -g tally-backup-pro --registry=https://your-internal-registry.com
```

### Option 2: File Distribution

1. **Build packages**: `npm run build-release`
2. **Distribute via**:
   - Network shares
   - USB drives
   - Software deployment tools (SCCM, Ansible, etc.)
   - Internal download portals

### Option 3: Container Deployment

```bash
# Build Docker image
docker build -t your-company/tally-backup-pro .

# Deploy with docker-compose
docker-compose up -d

# Or with Kubernetes
kubectl apply -f k8s-deployment.yaml
```

---

## 🚀 Installation Methods

### Method 1: NPM Package

#### Global Installation
```bash
# Install globally
npm install -g tally-backup-pro

# Initialize in a directory
mkdir my-tally-backup
cd my-tally-backup
tally-backup init

# Setup authentication
tally-backup setup-auth

# Install as service
tally-backup install-service
```

#### Local Installation
```bash
# Create project directory
mkdir tally-backup-setup
cd tally-backup-setup

# Install locally
npm init -y
npm install tally-backup-pro

# Use npx commands
npx tally-backup init
npx tally-backup setup-auth
npx tally-backup install-service
```

### Method 2: Standalone Executables

#### Building Executables
```bash
# Install build dependencies
npm install -g pkg

# Build for all platforms
npm run build

# Output files:
# dist/tally-backup-win.exe    (Windows)
# dist/tally-backup-linux      (Linux)
# dist/tally-backup-macos      (macOS)
```

#### Using Executables
```bash
# Windows
./tally-backup-win.exe init
./tally-backup-win.exe setup-auth
./tally-backup-win.exe install-service

# Linux
./tally-backup-linux init
./tally-backup-linux setup-auth
sudo ./tally-backup-linux install-service
```

### Method 3: Docker Container

#### Using Docker Compose (Recommended)
```bash
# Clone or download the project
git clone https://github.com/your-username/tally-backup-pro.git
cd tally-backup-pro

# Edit docker-compose.yml to set your Tally data path
# - /path/to/your/tally/data:/mnt/tally:ro

# Start the container
docker-compose up -d

# Setup authentication (one-time)
docker exec -it tally-backup-pro tally-backup setup-auth

# Check status
docker logs tally-backup-pro
```

#### Using Docker Run
```bash
# Build the image
docker build -t tally-backup-pro .

# Create data volumes
docker volume create tally-backup-config
docker volume create tally-backup-data

# Run the container
docker run -d \
  --name tally-backup-pro \
  --restart unless-stopped \
  -v tally-backup-config:/app/config \
  -v tally-backup-data:/app/data \
  -v /path/to/your/tally/data:/mnt/tally:ro \
  -e TZ=Asia/Kolkata \
  tally-backup-pro
```

### Method 4: Manual Installation

#### Download and Setup
```bash
# Download the source code
wget https://github.com/your-username/tally-backup-pro/archive/main.zip
unzip main.zip
cd tally-backup-pro-main

# Install dependencies
npm install --production

# Initialize
node bin/tally-backup.js init

# Setup authentication
node setup-auth-enhanced.js

# Install service
node scripts/install-service.js
```

---

## 🔧 Platform-Specific Setup

### Windows Setup

#### Option A: NPM + Windows Service
```cmd
# Install globally
npm install -g tally-backup-pro

# Initialize
mkdir C:\TallyBackup
cd C:\TallyBackup
tally-backup init

# Setup (requires admin privileges for service)
tally-backup setup-auth
tally-backup install-service
```

#### Option B: Task Scheduler (No Admin Required)
```cmd
# After setup, create scheduled task
schtasks /create /tn "Tally Backup Pro" /tr "tally-backup start" /sc daily /st 20:00 /f

# Verify task
schtasks /query /tn "Tally Backup Pro"
```

#### Option C: Standalone Executable
```cmd
# Download tally-backup-win.exe
# Place in desired directory
tally-backup-win.exe init
tally-backup-win.exe setup-auth
tally-backup-win.exe install-service
```

### Linux Setup

#### Option A: NPM + Systemd Service
```bash
# Install globally
sudo npm install -g tally-backup-pro

# Initialize
mkdir ~/tally-backup
cd ~/tally-backup
tally-backup init

# Setup
tally-backup setup-auth
sudo tally-backup install-service
```

#### Option B: Cron Job (No Root Required)
```bash
# After setup, add to crontab
crontab -e

# Add this line:
0 20 * * * cd /path/to/tally-backup && tally-backup start >> ~/tally-backup.log 2>&1
```

#### Option C: Docker
```bash
# Clone repository
git clone https://github.com/your-username/tally-backup-pro.git
cd tally-backup-pro

# Edit docker-compose.yml for your paths
# Start container
docker-compose up -d

# Setup authentication
docker exec -it tally-backup-pro tally-backup setup-auth
```

---

## 📋 Service Management

### Windows
```cmd
# Service Management
net start "Tally Backup Pro"
net stop "Tally Backup Pro"
sc query "Tally Backup Pro"

# Task Scheduler Management
schtasks /run /tn "Tally Backup Pro"
schtasks /query /tn "Tally Backup Pro"
schtasks /delete /tn "Tally Backup Pro" /f
```

### Linux
```bash
# Systemd Service Management
sudo systemctl start tally-backup-pro
sudo systemctl stop tally-backup-pro
sudo systemctl status tally-backup-pro
sudo systemctl enable tally-backup-pro
sudo journalctl -u tally-backup-pro -f

# Cron Management
crontab -l                    # List jobs
crontab -e                    # Edit jobs
tail -f ~/tally-backup.log    # View logs
```

### Docker
```bash
# Container Management
docker start tally-backup-pro
docker stop tally-backup-pro
docker restart tally-backup-pro
docker logs -f tally-backup-pro

# Update container
docker-compose pull
docker-compose up -d
```

---

## 🎯 Quick Start Guide

### For End Users (NPM)
1. **Install**: `npm install -g tally-backup-pro`
2. **Setup**: `tally-backup init`
3. **Authenticate**: `tally-backup setup-auth`
4. **Test**: `tally-backup backup`
5. **Schedule**: `tally-backup install-service`

### For Enterprise (Docker)
1. **Deploy**: `docker-compose up -d`
2. **Configure**: Edit config files in mounted volume
3. **Authenticate**: `docker exec -it tally-backup-pro tally-backup setup-auth`
4. **Monitor**: `docker logs -f tally-backup-pro`

### For Developers (Manual)
1. **Clone**: `git clone https://github.com/your-username/tally-backup-pro.git`
2. **Install**: `npm install`
3. **Setup**: `node bin/tally-backup.js init`
4. **Develop**: Modify code as needed
5. **Build**: `npm run build`

---

## 🔒 Security Considerations

- **Credentials**: Store Google Drive credentials securely
- **File Permissions**: Ensure proper file access permissions
- **Network**: Consider firewall rules for cloud access
- **Logging**: Monitor logs for security events
- **Updates**: Keep software updated for security patches

---

## 📞 Support

- **Documentation**: [GitHub Wiki](https://github.com/your-username/tally-backup-pro/wiki)
- **Issues**: [GitHub Issues](https://github.com/your-username/tally-backup-pro/issues)
- **Discussions**: [GitHub Discussions](https://github.com/your-username/tally-backup-pro/discussions)
- **Email**: support@tally-backup-pro.com
