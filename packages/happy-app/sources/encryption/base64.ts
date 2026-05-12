export function decodeBase64(base64: string, encoding: 'base64' | 'base64url' = 'base64'): Uint8Array {
    let normalizedBase64 = base64;
    
    if (encoding === 'base64url') {
        normalizedBase64 = base64
            .replace(/-/g, '+')
            .replace(/_/g, '/');
        
        const padding = normalizedBase64.length % 4;
        if (padding) {
            normalizedBase64 += '='.repeat(4 - padding);
        }
    }
    
    const binaryString = atob(normalizedBase64);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    
    for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }
    
    return bytes;
}

export function encodeBase64(buffer: Uint8Array, encoding: 'base64' | 'base64url' = 'base64'): string {
    // Build the binary string in 8KB chunks. The naive single-shot
    // `String.fromCharCode.apply(null, Array.from(buffer))` spreads every
    // byte as a separate function argument; on payloads >100KB or so JS
    // engines blow their call stack with "Maximum call stack size exceeded"
    // (observed in the file viewer trying to decrypt a 604KB sql dump —
    // the ciphertext was fine, this conversion step was the culprit).
    // 8192 stays well inside V8 / JSC argument limits but keeps the call
    // count low.
    const CHUNK = 8192;
    let binaryString = '';
    for (let i = 0; i < buffer.length; i += CHUNK) {
        const slice = buffer.subarray(i, Math.min(i + CHUNK, buffer.length));
        binaryString += String.fromCharCode.apply(null, slice as unknown as number[]);
    }
    const base64 = btoa(binaryString);

    if (encoding === 'base64url') {
        return base64
            .replace(/\+/g, '-')
            .replace(/\//g, '_')
            .replace(/=/g, '');
    }

    return base64;
}