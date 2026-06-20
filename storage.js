// js/storage.js
// Encrypted file storage via Supabase — Zero-Knowledge architecture
// All files are AES-256-GCM encrypted on the client BEFORE upload.
// Supabase only stores opaque encrypted bytes.

import { supabase } from './supabase.js';
import { CryptoManager } from './crypto.js';

const BUCKET_CHAT = 'chat-files';
const BUCKET_AVATARS = 'avatars';

/**
 * Ensure the user has an encryption key. Create one if missing.
 * Returns: { key: CryptoKey, keyB64: string }
 */
async function ensureUserKey(uid) {
    let keyB64 = CryptoManager.getUserEncryptionKey(uid);
    if (!keyB64) {
        const key = await CryptoManager.generateAESKey();
        keyB64 = await CryptoManager.exportKey(key);
        CryptoManager.saveUserEncryptionKey(uid, keyB64);
        return { key, keyB64 };
    }
    const key = await CryptoManager.importKey(keyB64);
    return { key, keyB64 };
}

/**
 * Ensure a chat has a shared encryption key. Create one if missing.
 * Returns: { key: CryptoKey, keyB64: string }
 */
async function ensureChatKey(uid1, uid2) {
    let keyB64 = CryptoManager.getChatKey(uid1, uid2);
    if (!keyB64) {
        const key = await CryptoManager.generateAESKey();
        keyB64 = await CryptoManager.exportKey(key);
        CryptoManager.saveChatKey(uid1, uid2, keyB64);
        return { key, keyB64 };
    }
    const key = await CryptoManager.importKey(keyB64);
    return { key, keyB64 };
}

/**
 * Encrypt + upload a chat image to Supabase.
 * @param {File|Blob} file - The original image file
 * @param {string} myUid - Sender's UID
 * @param {string} friendUid - Receiver's UID
 * @returns {Promise<{path: string, encKeyB64: string}>} Storage path + key to embed in the message
 */
export async function uploadEncryptedChatImage(file, myUid, friendUid) {
    const { key, keyB64 } = await ensureChatKey(myUid, friendUid);

    const arrayBuffer = await file.arrayBuffer();
    const packedBuffer = await CryptoManager.encryptAndPack(arrayBuffer, key);

    const ext = (file.name || 'file.bin').split('.').pop().replace(/[^a-zA-Z0-9]/g, '') || 'bin';
    const path = `chat/${myUid}_${friendUid}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}.enc`;

    const { error } = await supabase.storage
        .from(BUCKET_CHAT)
        .upload(path, packedBuffer, {
            contentType: 'application/octet-stream',
            upsert: false
        });

    if (error) throw error;

    return { path, encKeyB64: keyB64 };
}

/**
 * Download + decrypt a chat image from Supabase.
 * @param {string} storagePath - The path stored in the message
 * @param {string} encKeyB64 - The encryption key (base64) stored in the message
 * @returns {Promise<Blob>} Decrypted image as Blob
 */
export async function downloadAndDecryptChatImage(storagePath, encKeyB64) {
    const { data, error } = await supabase.storage
        .from(BUCKET_CHAT)
        .download(storagePath);

    if (error) throw error;
    if (!data) throw new Error('No data returned from storage');

    const packedBuffer = await data.arrayBuffer();
    const key = await CryptoManager.importKey(encKeyB64);
    const decryptedBuffer = await CryptoManager.unpackAndDecrypt(packedBuffer, key);

    return new Blob([decryptedBuffer], { type: 'image/jpeg' });
}

/**
 * Encrypt + upload an avatar image to Supabase.
 * @param {File|Blob} file - The avatar image file
 * @param {string} uid - User's UID
 * @returns {Promise<{path: string, encKeyB64: string}>}
 */
export async function uploadEncryptedAvatar(file, uid) {
    const { key, keyB64 } = await ensureUserKey(uid);

    const arrayBuffer = await file.arrayBuffer();
    const packedBuffer = await CryptoManager.encryptAndPack(arrayBuffer, key);

    const ext = (file.name || 'file.bin').split('.').pop().replace(/[^a-zA-Z0-9]/g, '') || 'bin';
    const path = `avatars/${uid}/${Date.now()}.${ext}.enc`;

    const { error } = await supabase.storage
        .from(BUCKET_AVATARS)
        .upload(path, packedBuffer, {
            contentType: 'application/octet-stream',
            upsert: false
        });

    if (error) throw error;

    return { path, encKeyB64: keyB64 };
}

/**
 * Download + decrypt an avatar from Supabase.
 * @param {string} storagePath - The path stored in the user's profile
 * @param {string} encKeyB64 - The encryption key (base64) for this user's files
 * @returns {Promise<Blob>}
 */
export async function downloadAndDecryptAvatar(storagePath, encKeyB64) {
    const { data, error } = await supabase.storage
        .from(BUCKET_AVATARS)
        .download(storagePath);

    if (error) throw error;
    if (!data) throw new Error('No avatar data returned');

    const packedBuffer = await data.arrayBuffer();
    const key = await CryptoManager.importKey(encKeyB64);
    const decryptedBuffer = await CryptoManager.unpackAndDecrypt(packedBuffer, key);

    return new Blob([decryptedBuffer], { type: 'image/jpeg' });
}

/**
 * Get the user's avatar encryption key (base64) by UID.
 * For other users, this key is stored in their profile doc under `encKeyB64`.
 */
export function getAvatarKeyB64(encKeyB64) {
    return encKeyB64 || null;
}
