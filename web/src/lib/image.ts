import { api } from './api';

/**
 * Shrinks a phone photo (often 3–8 MB) to a JPEG no wider/taller than `max` px,
 * then uploads it through the importer to the shop. Returns the public image link.
 */
export async function compressImage(file: File, max = 1200, quality = 0.82): Promise<{ mime: string; data: string }> {
  if (!file.type.startsWith('image/')) throw new Error(`${file.name} is not a photo`);
  // Read as a data: URL (blob: URLs are blocked by the page's security policy)
  const url = await new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error(`Could not read ${file.name}`));
    r.readAsDataURL(file);
  });
  {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error(`${file.name}: this photo format is not supported by your browser — try a JPG or PNG`));
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
  }
}

export async function uploadPhoto(file: File): Promise<string> {
  const body = await compressImage(file);
  const r = await api<{ url: string }>('/uploads/image', { body });
  return r.url;
}
