import { v2 as cloudinary } from 'cloudinary';
import { CloudinaryStorage } from 'multer-storage-cloudinary';
import dotenv from 'dotenv';

dotenv.config();

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

export const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: async (req, file) => {
    // Sanitize the original filename to prevent Cloudinary errors (like trailing whitespaces)
    const sanitizedName = file.originalname
      .split('.')[0]
      .trim()
      .replace(/[^a-zA-Z0-9_-]/g, '_'); // Replace spaces and special characters with underscores
      
    return {
      folder: 'hfa-portal',
      resource_type: 'auto', // Important for non-image files like PDFs
      public_id: `${Date.now()}_${sanitizedName}`,
    };
  },
});

export default cloudinary;
