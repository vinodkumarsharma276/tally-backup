'use strict';

const fs = require('fs/promises');
const path = require('path');
const sharp = require('sharp');
const { statusIconBuffer } = require('../desktop/trayIcon');

const root = path.resolve(__dirname, '..');
const source = path.join(root, '.github/assets/branding/ChatGPT Image Sep 12, 2026, 07_30_17 PM.jpg');
const output = path.join(root, 'assets/branding');

async function extract(region, monochrome = false) {
  const { data, info } = await sharp(source).extract(region).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let offset = 0; offset < data.length; offset += 4) {
    const intensity = Math.max(data[offset], data[offset + 1], data[offset + 2]);
    const alpha = monochrome ? Math.max(0, Math.min(1, (intensity - 65) / 160)) : Math.max(0, Math.min(1, (intensity - 32) / 48));
    data[offset + 3] = Math.round(alpha * 255);
    if (monochrome) data[offset] = data[offset + 1] = data[offset + 2] = 255;
  }
  return sharp(data, { raw: info }).png().toBuffer();
}

async function square(buffer, size) {
  return sharp(buffer).resize(size, size, { fit: 'contain', background: '#00000000' }).png().toBuffer();
}

async function darken(buffer) {
  const { data, info } = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let offset = 0; offset < data.length; offset += 4) {
    data[offset] = 11;
    data[offset + 1] = 19;
    data[offset + 2] = 21;
  }
  return sharp(data, { raw: info }).png().toBuffer();
}

function ico(entries) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(entries.length, 4);
  const directory = Buffer.alloc(entries.length * 16);
  let offset = header.length + directory.length;
  entries.forEach(({ size, png }, index) => {
    const start = index * 16;
    directory[start] = directory[start + 1] = size === 256 ? 0 : size;
    directory.writeUInt16LE(1, start + 4);
    directory.writeUInt16LE(32, start + 6);
    directory.writeUInt32LE(png.length, start + 8);
    directory.writeUInt32LE(offset, start + 12);
    offset += png.length;
  });
  return Buffer.concat([header, directory, ...entries.map(({ png }) => png)]);
}

async function main() {
  await fs.mkdir(output, { recursive: true });
  await fs.mkdir(path.join(root, 'build'), { recursive: true });
  const metadata = await sharp(source).metadata();
  if (metadata.width !== 1536 || metadata.height !== 1024) throw new Error('Brand sheet dimensions changed; update the crop regions first.');

  const mark = await extract({ left: 228, top: 82, width: 326, height: 426 });
  const mono = await extract({ left: 866, top: 775, width: 83, height: 101 }, true);
  const logo = await extract({ left: 845, top: 357, width: 360, height: 116 });
  const primary = await extract({ left: 84, top: 82, width: 640, height: 574 });
  await fs.writeFile(path.join(output, 'mark.png'), await square(mark, 512));
  await fs.writeFile(path.join(output, 'mark-white.png'), await square(mono, 128));
  const darkMono = await darken(mono);
  await fs.writeFile(path.join(output, 'mark-dark.png'), await square(darkMono, 128));
  await fs.writeFile(path.join(output, 'logo-dark.png'), logo);
  const { data, info } = await sharp(logo).raw().toBuffer({ resolveWithObject: true });
  for (let offset = 0; offset < data.length; offset += 4) {
    const spread = Math.max(data[offset], data[offset + 1], data[offset + 2]) - Math.min(data[offset], data[offset + 1], data[offset + 2]);
    if (spread < 45) {
      data[offset] = 11;
      data[offset + 1] = 19;
      data[offset + 2] = 21;
    }
  }
  await sharp(data, { raw: info }).png().toFile(path.join(output, 'logo-light.png'));
  await fs.writeFile(path.join(output, 'primary.png'), primary);

  const icon = await sharp({ create: { width: 512, height: 512, channels: 4, background: '#0b1315' } })
    .composite([{ input: await square(mark, 448), left: 32, top: 32 }]).png().toBuffer();
  await fs.writeFile(path.join(root, 'build/icon.png'), icon);
  const entries = await Promise.all([16, 24, 32, 48, 64, 128, 256].map(async (size) => ({ size, png: await square(icon, size) })));
  await fs.writeFile(path.join(root, 'build/icon.ico'), ico(entries));
  const chunks = await Promise.all([['ic07', 128], ['ic08', 256], ['ic09', 512], ['ic10', 1024]].map(async ([type, size]) => {
    const png = await square(icon, size);
    const header = Buffer.alloc(8);
    header.write(type);
    header.writeUInt32BE(png.length + 8, 4);
    return Buffer.concat([header, png]);
  }));
  const header = Buffer.alloc(8);
  header.write('icns');
  header.writeUInt32BE(8 + chunks.reduce((sum, chunk) => sum + chunk.length, 0), 4);
  await fs.writeFile(path.join(root, 'build/icon.icns'), Buffer.concat([header, ...chunks]));
  for (const size of [32, 180, 192, 512]) {
    await fs.writeFile(path.join(output, `icon-${size}.png`), await square(icon, size));
  }
  for (const state of ['idle', 'running', 'success', 'failed', 'paused']) {
    for (const theme of ['dark', 'light']) {
      const foreground = theme === 'dark' ? mono : darkMono;
      const overlays = state === 'idle' ? [] : [{ input: await sharp(statusIconBuffer(state, 32)).resize(16, 16).png().toBuffer(), left: 16, top: 16 }];
      await sharp(await square(foreground, 32)).composite(overlays).toFile(path.join(output, `tray-${theme}-${state}.png`));
    }
  }
  console.log('Generated shared logos, themed tray images, PNG, ICO and ICNS application icons.');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });