// js/crypto.js
// Client-side AES-256-GCM encryption for Zero-Knowledge privacy
// All files are encrypted BEFORE upload — server only stores encrypted bytes

export const CryptoManager = {
    // Generate ECDH key pair (for future key exchange)
    async generateECDHKeyPair() {
        return await window.crypto.subtle.generateKey(
            { name: "ECDH", namedCurve: "P-256" },
            true,
            ["deriveKey"]
        );
    },

    // Derive an AES-256-GCM key from a password + salt (PBKDF2)
    async deriveKeyFromPassword(password, salt) {
        const encoder = new TextEncoder();
        const keyMaterial = await window.crypto.subtle.importKey(
            'raw',
            encoder.encode(password),
            'PBKDF2',
            false,
            ['deriveKey']
        );
        return await window.crypto.subtle.deriveKey(
            { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
            keyMaterial,
            { name: 'AES-GCM', length: 256 },
            true,
            ['encrypt', 'decrypt']
        );
    },

    // Generate a random AES-256-GCM key (for per-file encryption)
    async generateAESKey() {
        return await window.crypto.subtle.generateKey(
            { name: 'AES-GCM', length: 256 },
            true,
            ['encrypt', 'decrypt']
        );
    },

    // Export a CryptoKey to base64 string for storage/transmission
    async exportKey(key) {
        const raw = await window.crypto.subtle.exportKey('raw', key);
        return this.arrayBufferToBase64(raw);
    },

    // Import a base64 string back to CryptoKey
    async importKey(base64) {
        const raw = this.base64ToArrayBuffer(base64);
        return await window.crypto.subtle.importKey(
            'raw',
            raw,
            { name: 'AES-GCM', length: 256 },
            true,
            ['encrypt', 'decrypt']
        );
    },

    // Encrypt a file (ArrayBuffer) with AES-256-GCM
    // Returns: { encrypted: ArrayBuffer, iv: Uint8Array }
    async encryptFile(arrayBuffer, key) {
        const iv = window.crypto.getRandomValues(new Uint8Array(12));
        const encrypted = await window.crypto.subtle.encrypt(
            { name: 'AES-GCM', iv },
            key,
            arrayBuffer
        );
        return { encrypted, iv };
    },

    // Decrypt a file with AES-256-GCM
    // Returns: ArrayBuffer
    async decryptFile(encryptedBuffer, iv, key) {
        return await window.crypto.subtle.decrypt(
            { name: 'AES-GCM', iv },
            key,
            encryptedBuffer
        );
    },

    // Encrypt message text (AES-GCM)
    async encryptMessage(text, sharedSecret) {
        const encoder = new TextEncoder();
        const iv = window.crypto.getRandomValues(new Uint8Array(12));
        const encrypted = await window.crypto.subtle.encrypt(
            { name: "AES-GCM", iv: iv },
            sharedSecret,
            encoder.encode(text)
        );
        return { encrypted, iv };
    },

    // Decrypt message text
    async decryptMessage(encryptedData, iv, sharedSecret) {
        const decrypted = await window.crypto.subtle.decrypt(
            { name: "AES-GCM", iv: iv },
            sharedSecret,
            encryptedData
        );
        return new TextDecoder().decode(decrypted);
    },

    // Pack encrypted file + iv + key into a single ArrayBuffer for upload
    // Format: [4 bytes ivLength] [iv] [encryptedData]
    async encryptAndPack(fileArrayBuffer, key) {
        const { encrypted, iv } = await this.encryptFile(fileArrayBuffer, key);
        const ivLen = new Uint32Array([iv.byteLength]);
        const packed = new Uint8Array(4 + iv.byteLength + encrypted.byteLength);
        packed.set(new Uint8Array(ivLen.buffer), 0);
        packed.set(new Uint8Array(iv), 4);
        packed.set(new Uint8Array(encrypted), 4 + iv.byteLength);
        return packed.buffer;
    },

    // Unpack and decrypt: reverse of encryptAndPack
    async unpackAndDecrypt(packedBuffer, key) {
        const data = new Uint8Array(packedBuffer);
        const ivLen = new Uint32Array(data.slice(0, 4).buffer)[0];
        const iv = data.slice(4, 4 + ivLen);
        const encrypted = data.slice(4 + ivLen);
        return await this.decryptFile(encrypted.buffer, iv, key);
    },

    // Helper: ArrayBuffer → Base64
    arrayBufferToBase64(buffer) {
        const bytes = new Uint8Array(buffer);
        let binary = '';
        for (let i = 0; i < bytes.byteLength; i++) {
            binary += String.fromCharCode(bytes[i]);
        }
        return btoa(binary);
    },

    // Helper: Base64 → ArrayBuffer
    base64ToArrayBuffer(base64) {
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
        }
        return bytes.buffer;
    },

    // Get or create the user's encryption key stored in localStorage
    // This key is used for encrypting the user's own files (avatars etc.)
    getUserEncryptionKey(uid) {
        const storageKey = `libero_ek_${uid}`;
        let keyB64 = localStorage.getItem(storageKey);
        return keyB64;
    },

    // Save the user's encryption key to localStorage
    saveUserEncryptionKey(uid, keyB64) {
        const storageKey = `libero_ek_${uid}`;
        localStorage.setItem(storageKey, keyB64);
    },

    // Get or create chat encryption key for a pair of users
    getChatKey(uid1, uid2) {
        // Deterministic key ID — same regardless of who is uid1/uid2
        const keyId = [uid1, uid2].sort().join('_');
        const storageKey = `libero_ck_${keyId}`;
        return localStorage.getItem(storageKey);
    },

    saveChatKey(uid1, uid2, keyB64) {
        const keyId = [uid1, uid2].sort().join('_');
        const storageKey = `libero_ck_${keyId}`;
        localStorage.setItem(storageKey, keyB64);
    }
};
