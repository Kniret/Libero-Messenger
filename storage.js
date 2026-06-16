import { supabase } from './supabase.js';

export const uploadMedia = async (encryptedBlob, path) => {
    const { data, error } = await supabase.storage
        .from('chat-files')
        .upload(path, encryptedBlob, { contentType: 'application/octet-stream' });

    if (error) throw error;
    return data.path;
};

export const downloadMedia = async (path) => {
    const { data, error } = await supabase.storage
        .from('chat-files')
        .download(path);

    if (error) throw error;
    return await data.arrayBuffer();
};