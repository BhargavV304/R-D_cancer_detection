require('dotenv').config();
const fs = require('fs');
const path = require('path');
const OpenAI = require('openai');

// Initialize OpenAI client pointing to the Grok API
const client = new OpenAI({
    apiKey: process.env.GROK_API_KEY,
    baseURL: "https://api.x.ai/v1", // x.ai API base URL
});

// Since you will pass an array of JSON URLs, we read from uploaded_urls.json.
// Change this filename if your actual JSON file has a different name.
const urlsFilePath = path.join(__dirname, 'test_png.json');
const finalResultsPath = path.join(__dirname, 'grok_ct_report_result.txt');
const usageLogPath = path.join(__dirname, 'grok_token_usage_log.json');

const MODEL_NAME = "grok-4-1-fast-reasoning"; // or whichever model you prefer

const promptText = `
Please analyze the provided CT scan images of the Petrous Temporal Bones. 
Based on your observation of all the provided images, generate a detailed medical report strictly following the format provided below. Do not include introductory text, just the report itself.

Reference Format:
'CT REPORT - PETROUS TEMPORAL BONES
TECHNIQUE:High resolution Coronal and Axial scans of temporal bones were studied without intravenous contrast.MPR images were obtained.
OBSERVATION:
RIGHT EAR:
External auditory canal appears normal.
No fluid or abnormal soft tissue is seen in the middle ear or mastoid air cells.
Scutum is normal. Middle ear ossicles are normally seen. Facial canal and roof of middle ear cavity appear normal.
The cochlea, cochlear aqueduct, vestibule, vestibular aqueduct and the semicircular canals are normal.
Internal auditory meati appear normal.
Jugular foramen and carotid canal are normal.
LEFT EAR:
External auditory canal appears normal.
No fluid or abnormal soft tissue is seen in the middle ear or mastoid air cells.
Scutum is normal. Middle ear ossicles are normally seen. Facial canal and roof of middle ear cavity appear normal.
The cochlea, cochlear aqueduct, vestibule, vestibular aqueduct and the semicircular canals are normal.
Internal auditory meatiappear normal.
Jugular foramen and carotid canal are normal.
IMPRESSION:
No significant abnormality is seen in both middle ear cavities and mastoid air cells.'

Modify the OBSERVATION and IMPRESSION sections as appropriate based on whatever abnormalities or specific details you detect in the actual images.
Return ONLY the formatted report.
`;

async function generateCTReport() {
    if (!fs.existsSync(urlsFilePath)) {
        console.error(`File not found: ${urlsFilePath}. Please provide the JSON array of Cloudinary URLs.`);
        return;
    }

    const fileData = fs.readFileSync(urlsFilePath, 'utf8');
    const uploadedImages = JSON.parse(fileData);

    // You mentioned you will be sending 66 images. If your JSON file contains more,
    // this will take just the first 66. Adjust or remove .slice() if you provide an exact array.
    const imagesToProcess = uploadedImages.slice(0, 66);

    console.log(`Loaded ${imagesToProcess.length} image URLs to send to Grok.`);

    try {
        const contentArray = [{ type: "text", text: promptText }];

        // Attach each image URL configuration
        for (const item of imagesToProcess) {
            contentArray.push({ type: "text", text: `Image filename: ${item.filename}` });
            contentArray.push({
                type: "image_url",
                image_url: {
                    url: item.url,
                    detail: "high"
                }
            });
        }

        console.log(`Sending API request to ${MODEL_NAME} with ${imagesToProcess.length} images...`);
        const response = await client.chat.completions.create({
            model: MODEL_NAME,
            messages: [
                {
                    role: "user",
                    content: contentArray
                }
            ],
            // Giving it enough tokens for the lengthy report
            max_tokens: 2000
        });

        const responseText = response.choices[0].message.content;
        const usage = response.usage;

        console.log(`\n--- Generated Report ---\n`);
        console.log(responseText);
        console.log(`\n--------------------------\n`);

        // Track token usage to an appending log for the record
        if (usage) {
            console.log(`Token Usage Metrics:`);
            console.log(`- Prompt Tokens: ${usage.prompt_tokens}`);
            console.log(`- Completion Tokens: ${usage.completion_tokens}`);
            console.log(`- Total Tokens: ${usage.total_tokens}`);

            const usageLog = {
                timestamp: new Date().toISOString(),
                model: MODEL_NAME,
                images_count: imagesToProcess.length,
                usage: usage
            };

            let existingLogs = [];
            if (fs.existsSync(usageLogPath)) {
                existingLogs = JSON.parse(fs.readFileSync(usageLogPath, 'utf8'));
            }
            existingLogs.push(usageLog);
            fs.writeFileSync(usageLogPath, JSON.stringify(existingLogs, null, 2));
            console.log(`\n✅ Token usage recorded in ${usageLogPath}`);
        }

        // Save final output report
        fs.writeFileSync(finalResultsPath, responseText);
        console.log(`✅ Final report saved to ${finalResultsPath}`);

    } catch (error) {
        console.error(`\n❌ Error processing images:`, error.message);
        if (error.response) {
            console.error(error.response.data);
        }
    }
}

generateCTReport();
