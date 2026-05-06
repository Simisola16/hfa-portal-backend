import cloudinary from './lib/cloudinary.js';

async function test() {
  const url = 'https://res.cloudinary.com/dyl5n7nsm/image/upload/v1777896249/hfa-portal/1777896249213_Receipt-2652-9732.pdf';
  const urlObj = new URL(url);
  const pathParts = urlObj.pathname.split('/');
  const uploadIndex = pathParts.indexOf('upload');
  const publicIdWithExt = pathParts.slice(uploadIndex + 2).join('/');
  const publicId = publicIdWithExt.replace(/\.[^/.]+$/, ""); // strip extension
  
  try {
    console.log('Changing type to authenticated for:', publicId);
    await cloudinary.uploader.rename(publicId, publicId, {
      resource_type: 'image',
      to_type: 'authenticated',
      overwrite: true
    });
    
    // Generate private download URL
    const downloadUrl = cloudinary.utils.private_download_url(publicId, 'pdf', {
      resource_type: 'image',
      type: 'authenticated'
    });
    console.log('Authenticated Download URL:\n', downloadUrl);
    
    const res = await fetch(downloadUrl);
    console.log('Fetch Status:', res.status, res.statusText);
    if (!res.ok) {
      const text = await res.text();
      console.log('Error Body:', text);
    } else {
      console.log('Success! We bypassed the CDN block.');
    }
  } catch (err) {
    console.log('Error:', err);
  }
}
test();
