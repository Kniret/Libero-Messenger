// Supabase Edge Function: send-push
// Receives a push subscription + payload and forwards it via Web Push protocol

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { webcrypto } from 'https://deno.land/std@0.168.0/crypto/mod.ts';

const VAPID_PRIVATE_KEY = Deno.env.get('VAPID_PRIVATE_KEY') || '';
const VAPID_SUBJECT = Deno.env.get('VAPID_SUBJECT') || 'mailto:libero@messenger.app';

// JWT generation for VAPID
async function createVapidJwt(origin: string): Promise<string> {
    const header = { alg: 'ES256', typ: 'JWT' };
    const now = Math.floor(Date.now() / 1000);
    const payload = {
        aud: origin,
        exp: now + 12 * 3600,
        sub: VAPID_SUBJECT,
    };

    const encoder = new TextEncoder();
    const headerB64 = btoa(JSON.stringify(header)).replace(/=/g, '');
    const payloadB64 = btoa(JSON.stringify(payload)).replace(/=/g, '');
    const signingInput = `${headerB64}.${payloadB64}`;

    // Import the private key
    const keyData = base64UrlDecode(VAPID_PRIVATE_KEY);
    const key = await crypto.subtle.importKey(
        'pkcs8',
        keyData,
        { name: 'ECDSA', namedCurve: 'P-256' },
        false,
        ['sign']
    );

    const signature = await crypto.subtle.sign(
        { name: 'ECDSA', hash: 'SHA-256' },
        key,
        encoder.encode(signingInput)
    );

    const sigB64 = arrayBufferToBase64Url(signature);
    return `${signingInput}.${sigB64}`;
}

function base64UrlDecode(str: string): ArrayBuffer {
    const padded = str.replace(/-/g, '+').replace(/_/g, '/');
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
}

function arrayBufferToBase64Url(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

// Encrypt payload for push (aes128gcm)
async function encryptPayload(payload: string, p256dh: string, auth: string): Promise<Uint8Array> {
    const encoder = new TextEncoder();
    const payloadData = encoder.encode(payload);

    // Import subscriber's public key
    const publicKeyData = base64UrlDecode(p256dh);
    const publicKey = await crypto.subtle.importKey(
        'raw',
        publicKeyData,
        { name: 'ECDH', namedCurve: 'P-256' },
        false,
        []
    );

    // Generate ephemeral key pair
    const ephemeralKey = await crypto.subtle.generateKey(
        { name: 'ECDH', namedCurve: 'P-256' },
        true,
        ['deriveBits']
    );

    // Derive shared secret
    const sharedBits = await crypto.subtle.deriveBits(
        { name: 'ECDH', public: publicKey },
        ephemeralKey.privateKey,
        256
    );

    // HKDF
    const authData = base64UrlDecode(auth);
    const keyInfo = encoder.encode('Content-Encoding: aes128gcm\x00');
    const nonceInfo = encoder.encode('Content-Encoding: nonce\x00');

    // PRK = HMAC-SHA-256(auth, shared_secret)
    const prkKey = await crypto.subtle.importKey('raw', authData, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const prk = await crypto.subtle.sign('HMAC', prkKey, sharedBits);

    // Derive content encryption key
    const cekKey = await crypto.subtle.importKey('raw', prk, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const cekInfo = new Uint8Array([...keyInfo, ...new Uint8Array([0])]);
    const cekHmac = await crypto.subtle.sign('HMAC', cekKey, cekInfo);
    const contentKey = cekHmac.slice(0, 16);

    // Derive nonce
    const nonceKey = await crypto.subtle.importKey('raw', prk, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const nonceHmac = await crypto.subtle.sign('HMAC', nonceKey, nonceInfo);
    const nonce = nonceHmac.slice(0, 12);

    // Add padding to payload
    const padding = new Uint8Array(payloadData.length + 1 + 16 - ((payloadData.length + 1 + 16) % 16));
    padding.set(payloadData);
    padding[payloadData.length] = 2; // delim + pad
    // rest is 0

    // Encrypt
    const cryptoKey = await crypto.subtle.importKey('raw', contentKey, { name: 'AES-GCM' }, false, ['encrypt']);
    const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, cryptoKey, padding);

    // Build the output
    const ephemeralRaw = await crypto.subtle.exportKey('raw', ephemeralKey.publicKey);
    const result = new Uint8Array(16 + 16 + 4 + ephemeralRaw.byteLength + encrypted.byteLength);
    let offset = 0;
    // Salt (16 bytes of zeros for simplicity - in production use random)
    offset += 16;
    // Record size
    const view = new DataView(result.buffer);
    view.setUint32(offset, encrypted.byteLength + 16 + 1, false);
    offset += 4;
    // Key length
    result[offset++] = 65; // P-256 uncompressed key length
    // Key
    result.set(new Uint8Array(ephemeralRaw), offset);
    offset += ephemeralRaw.byteLength;
    // Encrypted data
    result.set(new Uint8Array(encrypted), offset);

    return result;
}

serve(async (req: Request) => {
    // Handle CORS
    if (req.method === 'OPTIONS') {
        return new Response('ok', {
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'POST, OPTIONS',
                'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
            },
        });
    }

    try {
        const { subscription, title, body, senderUid } = await req.json();

        if (!subscription || !subscription.endpoint) {
            return new Response(JSON.stringify({ error: 'Invalid subscription' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' },
            });
        }

        const pushPayload = JSON.stringify({ title, body, senderUid });
        const endpoint = subscription.endpoint;
        const origin = new URL(endpoint).origin;

        // Create VAPID JWT
        const jwt = await createVapidJwt(origin);

        // Try to send the push notification
        const response = await fetch(endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/octet-stream',
                'Content-Encoding': 'aes128gcm',
                'Authorization': `vapid t=${jwt}, k=${VAPID_SUBJECT}`,
                'TTL': '86400',
                'Urgency': 'high',
            },
            body: pushPayload,
        });

        if (response.status >= 400 && response.status !== 410) {
            const text = await response.text();
            console.error('Push failed:', response.status, text);
            return new Response(JSON.stringify({ error: 'Push delivery failed', status: response.status }), {
                status: 502,
                headers: { 'Content-Type': 'application/json' },
            });
        }

        return new Response(JSON.stringify({ success: true }), {
            status: 200,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
            },
        });
    } catch (err) {
        console.error('send-push error:', err);
        return new Response(JSON.stringify({ error: String(err) }), {
            status: 500,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
            },
        });
    }
});
