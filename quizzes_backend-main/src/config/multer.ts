import multer from "multer";
import path from "path";
import { randomUUID } from "crypto";
import { v2 as cloudinary } from "cloudinary";
import { CloudinaryStorage } from "multer-storage-cloudinary";
import {ENV} from "./env"

// Initialise Cloudinary
const CLOUDINARY_CONFIG = {
  cloud_name: ENV.CLOUDINARY.CLOUD_NAME,
  api_key: ENV.CLOUDINARY.API_KEY,
  api_secret: ENV.CLOUDINARY.API_SECRET,
  secure: ENV.NODE_ENV !== "development"
}

cloudinary.config(CLOUDINARY_CONFIG);

const cloudinaryStorage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: async (req, file) => {
    const ext = path.extname(file.originalname);
    const publicId = `${randomUUID()}`;
    const folder = (req.body?.folder || req.query?.folder || "materials") as string;
    
    return {
      folder: folder,
      public_id: publicId,
      resource_type: "auto",
      format: ext.substring(1) || undefined, // undefined lets Cloudinary guess or keep original
    };
  },
});


const allowedMimeTypes = [
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "text/plain",
  "application/rtf",
  "application/json",
];

// File validation
const fileFilter = (
  req: any,
  file: Express.Multer.File,
  cb: multer.FileFilterCallback,
) => {
  if (allowedMimeTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(
      new Error(
        "Invalid file type. Only PDF, Word, PowerPoint and Images allowed.",
      ),
    );
  }
};

// Generic system upload using Cloudinary streaming storage
export const systemUpload = multer({
  storage: cloudinaryStorage,
  limits: {
    fileSize: 50 * 1024 * 1024, // 50 MB limit
  },
  fileFilter,
});
