// js/crypto.js
export const CryptoManager = {
    // Генерация ключей для ECDH (обмен ключами)
    async generateECDHKeyPair() {
        return await window.crypto.subtle.generateKey(
            { name: "ECDH", namedCurve: "P-256" },
            true,
            ["deriveKey"]
        );
    },

    // Шифрование сообщения (AES-GCM)
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

    // Дешифровка
    async decryptMessage(encryptedData, iv, sharedSecret) {
        const decrypted = await window.crypto.subtle.decrypt(
            { name: "AES-GCM", iv: iv },
            sharedSecret,
            encryptedData
        );
        return new TextDecoder().decode(decrypted);
    },

    async getChatKey(uid1, uid2) {
        const str = [uid1, uid2].sort().join(':'); // Сортируем, чтобы строка была идентичной
        const hash = await window.crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
        return await window.crypto.subtle.importKey("raw", hash, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
    },

    // Шифрование файла
    async encryptFile(fileArrayBuffer, key) {
        const iv = window.crypto.getRandomValues(new Uint8Array(12));
        const encrypted = await window.crypto.subtle.encrypt(
            { name: "AES-GCM", iv: iv },
            key,
            fileArrayBuffer
        );
        return { encryptedBuffer: encrypted, iv: Array.from(iv) }; // Сохраняем IV как массив
    },

    // Дешифровка файла
    async decryptFile(encryptedBuffer, ivArray, key) {
        const iv = new Uint8Array(ivArray);
        return await window.crypto.subtle.decrypt(
            { name: "AES-GCM", iv: iv },
            key,
            encryptedBuffer
        );
    }
};
