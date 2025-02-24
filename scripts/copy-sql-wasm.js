const fs = require('fs');
const path = require('path');

const sourceWasmPath = path.join(__dirname, '../node_modules/sql.js/dist/sql-wasm.wasm');
const targetWasmPath = path.join(__dirname, '../dist/sql-wasm.wasm');

// Create dist directory if it doesn't exist
if (!fs.existsSync(path.dirname(targetWasmPath))) {
    fs.mkdirSync(path.dirname(targetWasmPath), { recursive: true });
}

// Copy the wasm file
fs.copyFileSync(sourceWasmPath, targetWasmPath); 