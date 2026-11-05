import { api } from './api';

/**
 * Shrinks a phone photo (often 3–8 MB) to a JPEG no wider/taller than `max` px,
 * then uploads it through the importer to the shop. Returns the public image link.
 */
export async function compressImage(file: File, max = 1200, quality = 0.82): Promise<{ mime: string; data: string }> {
  if (!file.type.startsWith('image/')) throw new Error(`${file.name} is not a photo`);
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error(`Could not read ${file.name}`));
      i.src = url;
    });
    const scale = Math.min(1, max / Math.max(img.width, img.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL('image/jpeg', quality);
    return { mime: 'image/jpeg', data: dataUrl.split(',')[1] };
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function uploadPhoto(file: File): Promise<string> {
  const body = await compressImage(file);
  const r = await api<{ url: string }>('/uploads/image', { body });
  return r.url;
}
