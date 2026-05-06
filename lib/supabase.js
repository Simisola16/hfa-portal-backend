import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Use service role key for backend — bypasses RLS so we can upload from the server
export const supabase = createClient(supabaseUrl, supabaseServiceKey);

/**
 * Upload a file buffer to Supabase Storage and return its public URL.
 *
 * @param {Buffer}  buffer       - The file data (from multer memoryStorage)
 * @param {string}  originalName - Original filename (used to derive the extension)
 * @param {string}  folder       - Storage folder/prefix, e.g. "applications" or "proposals"
 * @returns {Promise<string>}    - Public URL of the uploaded file
 */
export async function uploadToSupabase(buffer, originalName, folder = 'uploads') {
  const ext = originalName.split('.').pop().toLowerCase();
  const fileName = `${folder}/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;

  const { data, error } = await supabase.storage
    .from('hfa-documents')           // bucket name — create this in Supabase dashboard
    .upload(fileName, buffer, {
      contentType: ext === 'pdf' ? 'application/pdf' : 'application/octet-stream',
      upsert: false,
    });

  if (error) throw new Error(`Supabase upload failed: ${error.message}`);

  // Get a permanent public URL (bucket must have public access enabled)
  const { data: urlData } = supabase.storage
    .from('hfa-documents')
    .getPublicUrl(data.path);

  return urlData.publicUrl;
}

export default supabase;
