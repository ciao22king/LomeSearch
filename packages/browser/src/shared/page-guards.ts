import type { WebRtcPolicy } from './types.js';

/**
 * Page-level WebRTC guard.
 *
 * Chromium's `force-webrtc-ip-handling-policy` switch is not honoured by every
 * build (Electron 33 still gathers a srflx candidate with the public IP), so the
 * constructor is patched as well. With `disable`, ICE is restricted to relay and
 * no server is offered, so no candidate leaves the machine. With
 * `public-interface`, STUN is removed and only mDNS host candidates remain,
 * which never contain a local IP address.
 */
export function buildWebRtcScript(policy: WebRtcPolicy): string {
  if (policy === 'default') return '';
  const relay = policy === 'disable' ? "\n      config.iceTransportPolicy = 'relay';" : '';
  return `(() => {
  try {
    const Original = window.RTCPeerConnection;
    if (typeof Original !== 'function') return;
    const Patched = function (configuration, ...rest) {
      const config = Object.assign({}, configuration || {});
      config.iceServers = [];${relay}
      return new Original(config, ...rest);
    };
    Patched.prototype = Original.prototype;
    Object.setPrototypeOf(Patched, Original);
    window.RTCPeerConnection = Patched;
    if (window.webkitRTCPeerConnection) window.webkitRTCPeerConnection = Patched;
  } catch (error) {}
})();`;
}
