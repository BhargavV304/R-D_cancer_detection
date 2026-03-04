require('dotenv').config();
const fs = require('fs');
const path = require('path');
const cloudinary = require('cloudinary').v2;

// Configure Cloudinary using environment variables
// Make sure to set CLOUDINARY_URL in your .env file
// Format: cloudinary://<api_key>:<api_secret>@<cloud_name>
// Alternatively, you can configure it explicitly like this:
/*
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});
*/

const folderPath = '/Users/akshaykathiriya/Desktop/kg/cancer_detection_/test';
const outputJsonPath = path.join(__dirname, 'test_png.json');

async function uploadFolder() {
  try {
    const files = fs.readdirSync(folderPath);
    const uploadedUrls = [];

    console.log(`Found ${files.length} files in the folder. Starting upload...`);

    for (const file of files) {
      // Skip hidden files like .DS_Store
      if (file.startsWith('.')) continue;

      const filePath = path.join(folderPath, file);
      const stat = fs.statSync(filePath);

      if (stat.isFile()) {
        console.log(`Uploading ${file}...`);

        try {
          const result = await cloudinary.uploader.upload(filePath, {
            folder: 'cancer_detection_glioma', // Folder in your Cloudinary account
            use_filename: true,
            unique_filename: false,
          });

          uploadedUrls.push({
            filename: file,
            url: result.secure_url
          });

          console.log(`✅ Uploaded ${file} -> ${result.secure_url}`);
        } catch (uploadErr) {
          console.error(`❌ Failed to upload ${file}:`, uploadErr.message);
        }
      }
    }

    // Save the URLs to a JSON file for the next step
    fs.writeFileSync(outputJsonPath, JSON.stringify(uploadedUrls, null, 2));
    console.log(`\n🎉 Upload complete! Saved ${uploadedUrls.length} URLs to ${outputJsonPath}`);

  } catch (err) {
    console.error('Error processing folder:', err);
  }
}

uploadFolder();
