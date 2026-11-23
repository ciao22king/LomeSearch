/**
 * Fingerprint noise, injected into every page at document start.
 *
 * The noise is deterministic for the session and the site, so a page that reads
 * the same canvas twice gets the same answer, but it differs between sites and
 * between browser runs. Every patch is defensive: a broken API must never break
 * the page.
 */
export function buildNoiseScript(seed: string, host: string): string {
  return `(() => {
  try {
    const seed = ${JSON.stringify(seed)} + '|' + ${JSON.stringify(host)};
    let h = 2166136261 >>> 0;
    for (let i = 0; i < seed.length; i++) { h ^= seed.charCodeAt(i); h = Math.imul(h, 16777619); }
    const rand = () => { h ^= h << 13; h ^= h >>> 17; h ^= h << 5; h >>>= 0; return h / 4294967296; };
    const jitter = (value, amplitude) => value + (rand() - 0.5) * amplitude;

    try {
      const original = CanvasRenderingContext2D.prototype.getImageData;
      CanvasRenderingContext2D.prototype.getImageData = function (x, y, w, h) {
        const data = original.call(this, x, y, w, h);
        for (let i = 0; i < data.data.length; i += 4 * 499) {
          data.data[i] = Math.max(0, Math.min(255, jitter(data.data[i], 2)));
        }
        return data;
      };
    } catch (error) {}

    try {
      const touched = new WeakSet();
      const jitterCanvas = (canvas) => {
        if (!canvas || touched.has(canvas)) return;
        touched.add(canvas);
        try {
          const ctx = canvas.getContext('2d');
          if (!ctx) return;
          const x = Math.floor(rand() * Math.max(1, canvas.width));
          const y = Math.floor(rand() * Math.max(1, canvas.height));
          ctx.save();
          ctx.globalAlpha = 0.01;
          ctx.fillStyle = rand() > 0.5 ? '#000' : '#fff';
          ctx.fillRect(x, y, 1, 1);
          ctx.restore();
        } catch (error) {}
      };
      const proto = window.HTMLCanvasElement && HTMLCanvasElement.prototype;
      if (proto && proto.toDataURL) {
        const original = proto.toDataURL;
        proto.toDataURL = function (...args) { jitterCanvas(this); return original.apply(this, args); };
      }
      if (proto && proto.toBlob) {
        const original = proto.toBlob;
        proto.toBlob = function (...args) { jitterCanvas(this); return original.apply(this, args); };
      }
    } catch (error) {}

    try {
      const patch = (proto) => {
        if (!proto || !proto.getParameter) return;
        const original = proto.getParameter;
        proto.getParameter = function (parameter) {
          if (parameter === 37445) return 'LomeSearch';
          if (parameter === 37446) return 'LomeSearch Graphics';
          return original.call(this, parameter);
        };
      };
      patch(window.WebGLRenderingContext && WebGLRenderingContext.prototype);
      patch(window.WebGL2RenderingContext && WebGL2RenderingContext.prototype);
    } catch (error) {}

    try {
      if (window.AudioBuffer) {
        const original = AudioBuffer.prototype.getChannelData;
        AudioBuffer.prototype.getChannelData = function (channel) {
          const data = original.call(this, channel);
          for (let i = 0; i < data.length; i += 1009) data[i] = jitter(data[i], 0.0000002);
          return data;
        };
        const copy = AudioBuffer.prototype.copyFromChannel;
        if (copy) {
          AudioBuffer.prototype.copyFromChannel = function (destination, channel, offset) {
            const result = copy.call(this, destination, channel, offset);
            for (let i = 0; i < destination.length; i += 1009) destination[i] = jitter(destination[i], 0.0000002);
            return result;
          };
        }
      }
    } catch (error) {}

    try {
      Object.defineProperty(Navigator.prototype, 'hardwareConcurrency', { get: () => 4 + (h % 5), configurable: true });
    } catch (error) {}
    try {
      Object.defineProperty(Navigator.prototype, 'deviceMemory', { get: () => [4, 8][h % 2], configurable: true });
    } catch (error) {}
    try {
      Object.defineProperty(Navigator.prototype, 'plugins', { get: () => [], configurable: true });
      Object.defineProperty(Navigator.prototype, 'mimeTypes', { get: () => [], configurable: true });
    } catch (error) {}
    try {
      Object.defineProperty(Screen.prototype, 'colorDepth', { get: () => 24, configurable: true });
      Object.defineProperty(Screen.prototype, 'pixelDepth', { get: () => 24, configurable: true });
    } catch (error) {}
    try {
      if (navigator.mediaDevices && navigator.mediaDevices.enumerateDevices) {
        const original = navigator.mediaDevices.enumerateDevices.bind(navigator.mediaDevices);
        navigator.mediaDevices.enumerateDevices = async () => {
          const devices = await original();
          return devices.map((device, index) => ({
            deviceId: 'lome-' + index + '-' + (h % 997),
            groupId: 'group-' + (h % 89),
            kind: device.kind,
            label: '',
          }));
        };
      }
    } catch (error) {}
  } catch (error) {}
})();`;
}
