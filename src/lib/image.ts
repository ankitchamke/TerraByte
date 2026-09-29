// Downscale photos before storing — keeps uploads light on slow rural networks.
export function fileToSmallDataUrl(file: File, max = 800): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith("image/")) {
      resolve(""); // videos: keep a placeholder in demo mode
      return;
    }
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement("canvas");
      c.width = img.width * k;
      c.height = img.height * k;
      c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL("image/jpeg", 0.6));
    };
    img.onerror = reject;
    img.src = url;
  });
}
