/**
 * Creates a simple tray icon PNG using pure JavaScript (no dependencies).
 * Generates a 16x16 BMP-style PNG with a green "R" icon.
 */

const fs = require('fs');
const path = require('path');

// Minimal 16x16 PNG with green background and white "R"
// This is a pre-built base64 encoded PNG for the tray icon
// (16x16 green rounded square with white R)
const iconBase64 = 'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAA3ElEQVQ4T2NkoBAwUqifgWoGMDIw/P+PwfCfgYHx/38GBkaG/wyM/4GYgeE/AwPjfwaG/0wMDEz/GRj+MzEwMP1nYPjPxMDA9J+R4T8zI8N/ZkYGRmZGBkZmRoZ/zIwM/5gZGf4zMzH8Z2Fk+M/CxPCflZHhPysjw39WRob/bIwM/9kYGf6zMzH852Bi+M/JyPCfk5HhPxcjw39uRob/PIwM/3kZGf7zMTL852dk+C/AyPBfkJHhvxAjw39hRob/IowM/0UZGP6LMTL8F2dk+C/ByPBfkgEAPDAZEQn8S34AAAAASUVORK5CYII=';

const assetsDir = path.join(__dirname, '..', 'assets');
if (!fs.existsSync(assetsDir)) {
  fs.mkdirSync(assetsDir, { recursive: true });
}

const iconBuffer = Buffer.from(iconBase64, 'base64');
fs.writeFileSync(path.join(assetsDir, 'tray-icon.png'), iconBuffer);
fs.writeFileSync(path.join(assetsDir, 'icon.png'), iconBuffer);

console.log('Icons created successfully!');
