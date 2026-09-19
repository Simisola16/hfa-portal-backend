import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { PDFDocument } from 'pdf-lib';
import zlib from 'zlib';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function multiplyMatrix(m1, m2) {
  return [
    m1[0] * m2[0] + m1[1] * m2[2],
    m1[0] * m2[1] + m1[1] * m2[3],
    m1[2] * m2[0] + m1[3] * m2[2],
    m1[2] * m2[1] + m1[3] * m2[3],
    m1[4] * m2[0] + m1[5] * m2[2] + m2[4],
    m1[4] * m2[1] + m1[5] * m2[3] + m2[5]
  ];
}

function applyMatrix(m, x, y) {
  return {
    x: m[0] * x + m[2] * y + m[4],
    y: m[1] * x + m[3] * y + m[5]
  };
}

async function inspect(fileName) {
  const fullPath = path.join(__dirname, '../assets/certificates', fileName);
  if (!fs.existsSync(fullPath)) return;
  const buf = fs.readFileSync(fullPath);
  const doc = await PDFDocument.load(buf, { ignoreEncryption: true });
  const page = doc.getPage(0);
  
  console.log(`\n======================================================`);
  console.log(`FILE: ${fileName}`);
  console.log(`======================================================`);

  const contents = page.node.Contents();
  const streams = contents.array ? contents.array : [contents];
  
  for (const s of streams) {
    let raw;
    try {
      raw = s.asUint8Array();
    } catch {
      continue;
    }
    
    let str = '';
    try {
      str = zlib.inflateSync(Buffer.from(raw)).toString('latin1');
    } catch {
      str = Buffer.from(raw).toString('latin1');
    }
    
    const tokens = str.trim().split(/\s+/);
    let matrixStack = [[1, 0, 0, 1, 0, 0]];
    let curMatrix = [1, 0, 0, 1, 0, 0];
    
    let numBuf = [];
    for (let i = 0; i < tokens.length; i++) {
      const tok = tokens[i];
      if (!isNaN(parseFloat(tok))) {
        numBuf.push(parseFloat(tok));
      } else {
        if (tok === 'q') {
          matrixStack.push([...curMatrix]);
        } else if (tok === 'Q') {
          if (matrixStack.length > 1) {
            curMatrix = matrixStack.pop();
          }
        } else if (tok === 'cm') {
          if (numBuf.length >= 6) {
            const cm = numBuf.slice(-6);
            curMatrix = multiplyMatrix(curMatrix, cm);
          }
        } else if (tok === 'm') {
          if (numBuf.length >= 2) {
            const pt = applyMatrix(curMatrix, numBuf[numBuf.length - 2], numBuf[numBuf.length - 1]);
            // check if next is l
            if (i + 3 < tokens.length && tokens[i + 3] === 'l') {
              const x2 = parseFloat(tokens[i + 1]);
              const y2 = parseFloat(tokens[i + 2]);
              const pt2 = applyMatrix(curMatrix, x2, y2);
              if (Math.abs(pt.y - pt2.y) < 2 && pt.y >= 300 && pt.y <= 550) {
                console.log(`Horizontal Line: y=${pt.y.toFixed(2)}, x1=${pt.x.toFixed(2)}, x2=${pt2.x.toFixed(2)}, len=${Math.abs(pt2.x - pt.x).toFixed(2)}`);
              }
            }
          }
        }
        numBuf = [];
      }
    }
  }
}

async function main() {
  await inspect('Template GSO Scheme (meat) Cert-unlocked (1) 1.pdf');
  await inspect('Template HFA Scheme (meat) Cert 11 Oct 22-unlocked.pdf');
}

main().catch(console.error);
