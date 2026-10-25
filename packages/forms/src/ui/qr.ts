import qrcode from 'qrcode-generator';
import { toast } from '@oel/emboss';
import { tr } from '@oel/i18n';
import { saveFile } from '@oel/platform';

/** Square QR matrix for a URL (error correction M). */
function matrix(text: string): boolean[][] {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  return Array.from({ length: n }, (_, r) => Array.from({ length: n }, (_, c) => qr.isDark(r, c)));
}

/** SVG markup (4-module quiet zone), black on white so it scans everywhere. */
export function qrSvg(text: string, size = 512): string {
  const m = matrix(text);
  const n = m.length + 8;
  let d = '';
  m.forEach((row, r) => row.forEach((dark, c) => dark && (d += `M${c + 4} ${r + 4}h1v1h-1z`)));
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${n} ${n}" shape-rendering="crispEdges"><rect width="${n}" height="${n}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
}

export async function qrPng(text: string, size = 1024): Promise<Blob> {
  const img = new Image();
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(qrSvg(text, size))}`;
  await img.decode();
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  canvas.getContext('2d')!.drawImage(img, 0, 0, size, size);
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG'))), 'image/png'));
}

/** Save a copy (a download on the web, a save dialog in the app). */
export function download(name: string, data: Blob | string, type = 'text/plain') {
  saveFile(data, name, type).catch((e: Error) => toast({ title: tr('Enregistrement impossible', 'Could not save'), description: e.message, tone: 'danger' }));
}
