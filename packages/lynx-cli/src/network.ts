/**
 * Network utilities for the Lynx CLI.
 * Detects LAN IP addresses for dev server display.
 */

import { networkInterfaces } from 'node:os';

/**
 * Get the primary LAN IPv4 address.
 * Prefers real interfaces (Wi-Fi, Ethernet) over virtual ones.
 */
export function getLanIP(): string | null {
    const ips = getAllLanIPs();
    return ips.length > 0 ? ips[0].address : null;
}

/**
 * Get all non-internal IPv4 addresses, sorted so that real interfaces
 * (Wi-Fi, Ethernet) come before virtual ones (Hyper-V, WSL, Docker, etc.).
 */
export function getAllLanIPs(): { name: string; address: string }[] {
    const interfaces = networkInterfaces();
    const result: { name: string; address: string }[] = [];

    for (const name of Object.keys(interfaces)) {
        const addrs = interfaces[name];
        if (!addrs) continue;

        for (const addr of addrs) {
            if (addr.family === 'IPv4' && !addr.internal) {
                result.push({ name, address: addr.address });
            }
        }
    }

    // Sort real interfaces first so the primary IP is reachable by devices
    const virtualPatterns = /vEthernet|VMware|VirtualBox|vbox|Docker|WSL|Hyper-V|br-|virbr/i;
    result.sort((a, b) => {
        const aVirtual = virtualPatterns.test(a.name);
        const bVirtual = virtualPatterns.test(b.name);
        if (aVirtual !== bVirtual) return aVirtual ? 1 : -1;
        return 0;
    });

    return result;
}
