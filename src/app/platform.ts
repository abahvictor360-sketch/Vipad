/** Platform helpers — works in browsers, Electron, and Capacitor (Android/iOS). */
interface CapacitorGlobal { isNativePlatform?: () => boolean; getPlatform?: () => string }

export const capacitor = (): CapacitorGlobal | undefined => (window as unknown as { Capacitor?: CapacitorGlobal }).Capacitor;
export const isNative = () => !!capacitor()?.isNativePlatform?.();
export const isElectron = () => /Electron/i.test(navigator.userAgent);

function toBase64(bytes: Uint8Array): string {
  let s = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) s += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(s);
}

/** Save/share a generated file in the best way for the current platform. */
export async function saveFile(data: Blob, filename: string): Promise<'downloaded' | 'shared' | 'saved'> {
  if (isNative()) {
    const { Filesystem, Directory } = await import('@capacitor/filesystem');
    const { Share } = await import('@capacitor/share');
    const bytes = new Uint8Array(await data.arrayBuffer());
    const res = await Filesystem.writeFile({ path: filename, data: toBase64(bytes), directory: Directory.Documents, recursive: true });
    try {
      await Share.share({ title: filename, url: res.uri, dialogTitle: 'Save or share your audio' });
      return 'shared';
    } catch {
      return 'saved';
    }
  }
  const url = URL.createObjectURL(data);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
  return 'downloaded';
}
