require('dotenv').config();
const fs = require('fs');
const path = require('path');
const OpenAI = require('openai');

// Initialize OpenAI client pointing to the Grok API
const client = new OpenAI({
    apiKey: process.env.GROK_API_KEY,
    baseURL: "https://api.x.ai/v1", // x.ai API base URL
});

const urlsFilePath = path.join(__dirname, 'MSB-01956_png.json');
const stateFilePath = path.join(__dirname, 'MSB-01956_png_processing_state.json');
const finalResultsPath = path.join(__dirname, 'MSB-01956_png_grok_results.json');

const BATCH_SIZE = 100;
const MODEL_NAME = "grok-4-1-fast-reasoning";

function loadState(totalImages) {
    if (fs.existsSync(stateFilePath)) {
        const stateData = fs.readFileSync(stateFilePath, 'utf8');
        try {
            return JSON.parse(stateData);
        } catch (e) {
            console.error("Failed to parse existing state file. Starting fresh.");
        }
    }
    return {
        total_images: totalImages,
        processed_images_count: 0,
        current_batch_index: 0,
        batch_size: BATCH_SIZE,
        running_summary: "",
        status: "in_progress",
        total_tokens_used: 0
    };
}

function saveState(state) {
    fs.writeFileSync(stateFilePath, JSON.stringify(state, null, 2));
}

function getPromptText(runningSummary) {
    const baseDetailedPrompt = `Evaluate the images for the following cancer-related visual indicators:
- Irregular or poorly defined masses/lesions
- Abnormal tissue density or texture
- Microcalcifications or suspicious calcification patterns
- Asymmetry or architectural distortion
- Spiculated margins or irregular borders
- Abnormal vascularization patterns
- Lymph node enlargement or abnormalities
- Necrotic regions or heterogeneous areas
- Invasion of surrounding tissue
- Pleural effusion or other secondary signs

Based on your analysis, provide:
1. Whether cancer is suggested (Yes or No)
2. The suspected cancer type (if applicable), chosen from the following:
   - Breast Cancer
   - Lung Cancer
   - Brain Tumor (Glioma / Meningioma / Pituitary)
   - Colorectal Cancer
   - Liver Cancer (Hepatocellular Carcinoma)
   - Cervical Cancer
   - Skin Cancer (Melanoma / Basal Cell / Squamous Cell)
   - Prostate Cancer
   - Bone Cancer / Metastasis
   - Lymphoma
   - Pancreatic Cancer
   - Thyroid Cancer
   - Kidney (Renal Cell) Cancer
   - Unknown / Cannot Determine
3. The imaging modality detected (e.g., MRI, CT, X-Ray, Ultrasound, Dermoscopy, Histopathology)
4. Affected anatomical region
5. Overall confidence level (0–100%)
6. Short reasoning (maximum 5 lines) summarizing findings across all images

:warning: Do not assume information not visible in the images.
:warning: This is for research/assistive purposes only and does not replace professional medical diagnosis.

Please return your analysis strictly as a JSON object with exactly these keys:
{
  "imaging_modality": "string (e.g., 'MRI', 'CT Scan', 'X-Ray', 'Ultrasound', 'Dermoscopy', 'Histopathology', 'Unknown')",
  "affected_region": "string (e.g., 'Brain - Frontal Lobe', 'Left Breast', 'Right Lung - Upper Lobe', 'Unknown')",
  "abnormal_visual_patterns_summary": "string (describe key visual anomalies observed)",
  "suggests_cancer": "Yes or No",
  "suspected_cancer_type": "string (e.g., 'Breast Cancer', 'Lung Cancer', 'Brain Tumor - Glioma', 'Not Applicable', 'Unknown / Cannot Determine')",
  "cancer_stage_indicator": "string (e.g., 'Early Stage Indicators', 'Advanced Stage Indicators', 'Indeterminate', 'Not Applicable')",
  "confidence_level": "string (e.g., '85%')",
  "reasoning": "string (max 5 lines summarizing visual findings and basis for conclusion)",
  "recommendation": "string (e.g., 'Biopsy recommended', 'Follow-up imaging advised', 'Consult oncologist', 'No immediate action required')"
}`;

    if (!runningSummary) {
        // First batch prompt
        return `Analyze this batch of medical images carefully. Based on the visual evidence across all the provided images, do any of these images suggest cancer? Provide one combined result for the entire batch.\n\n${baseDetailedPrompt}`;
    } else {
        // Subsequent batches prompt
        return `You are continuing an ongoing analysis of a large dataset of medical images. 
Here is your summary and analysis of the previous medical images analyzed so far:
---
${runningSummary}
---

Now, carefully analyze this NEW batch of medical images. Each image is preceded by its filename.
Update your previous overall summary by incorporating any new findings from this new set. Provide one cohesive, updated result that reflects ALL images seen so far.

${baseDetailedPrompt}`;
    }
}

async function testGrokWithImages() {
    if (!fs.existsSync(urlsFilePath)) {
        console.error(`File not found: ${urlsFilePath}. Please run upload_to_cloudinary.js first.`);
        return;
    }

    const fileData = fs.readFileSync(urlsFilePath, 'utf8');
    const uploadedImages = JSON.parse(fileData);

    // Initialize or load state
    const state = loadState(uploadedImages.length);

    console.log(`Loaded ${uploadedImages.length} image URLs.`);
    console.log(`Current State: Processed ${state.processed_images_count}/${state.total_images} images.`);

    if (state.processed_images_count >= state.total_images) {
        console.log(`\n🎉 All images have already been processed!`);
        console.log(`Final Report:\n${state.running_summary}`);
        return;
    }

    while (state.processed_images_count < state.total_images) {
        const batchStartIndex = state.processed_images_count;
        const batchEndIndex = Math.min(batchStartIndex + state.batch_size, state.total_images);
        const batch = uploadedImages.slice(batchStartIndex, batchEndIndex);

        console.log(`\n=========================================================`);
        console.log(`Processing Batch ${state.current_batch_index + 1} (Images ${batchStartIndex + 1} to ${batchEndIndex})`);
        console.log(`Remaining: ${state.total_images - batchEndIndex} images`);
        console.log(`Tokens used so far: ${state.total_tokens_used || 0}`);
        console.log(`=========================================================`);

        try {
            const promptText = getPromptText(state.running_summary);
            const contentArray = [{ type: "text", text: promptText }];

            for (const item of batch) {
                contentArray.push({ type: "text", text: `Image filename: ${item.filename}` });
                contentArray.push({
                    type: "image_url",
                    image_url: {
                        url: item.url,
                        detail: "high"
                    }
                });
            }

            console.log(`Sending API request to ${MODEL_NAME}...`);
            const response = await client.chat.completions.create({
                model: MODEL_NAME,
                messages: [
                    {
                        role: "user",
                        content: contentArray
                    }
                ],
                max_tokens: 1500
            });

            let responseText = response.choices[0].message.content;
            let parsedResponse;
            try {
                // Try to extract JSON if it's wrapped in a code block
                const jsonMatch = responseText.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
                if (jsonMatch) {
                    responseText = jsonMatch[1];
                }
                parsedResponse = JSON.parse(responseText);
            } catch (e) {
                console.warn("Failed to parse JSON, falling back to raw text.");
                parsedResponse = {
                    raw_text: responseText,
                    error: "Could not parse JSON response"
                };
            }

            const usage = response.usage;
            console.log(usage, ': usage');
            if (usage && usage.total_tokens) {
                state.total_tokens_used = (state.total_tokens_used || 0) + usage.total_tokens;
                console.log(`\nTokens used for this batch: ${usage.total_tokens}`);
                console.log(`Total tokens used so far: ${state.total_tokens_used}`);
            }

            console.log(`\n--- Updated Summary After Batch ${state.current_batch_index + 1} ---`);
            console.log(JSON.stringify(parsedResponse, null, 2));
            console.log("-----------------------------------------\n");

            // Update state
            state.running_summary = JSON.stringify(parsedResponse, null, 2);
            state.processed_images_count = batchEndIndex;
            state.current_batch_index += 1;

            if (state.processed_images_count >= state.total_images) {
                state.status = "completed";
            }

            // Save state immediately after successful batch
            saveState(state);

            if (state.status === "completed") {
                // Save final output
                fs.writeFileSync(finalResultsPath, state.running_summary);
                console.log(`\n✅ Processing complete! Final results saved to ${finalResultsPath}`);
            } else {
                // Rate limiting pause before next batch
                console.log("Waiting 5 seconds before next batch...");
                await new Promise(resolve => setTimeout(resolve, 5000));
            }

        } catch (error) {
            console.error(`\n❌ Error processing batch ${state.current_batch_index + 1}:`, error.message);

            // If it's a downloading error or an invalid argument error (often caused by bad image structure/size)
            if ((error.message.includes("downloading image") || error.message.includes("Invalid arguments")) && state.batch_size > 1) {
                console.log(`⚠️ A payload error occurred in this batch. Halving the batch size to isolate the broken image...`);
                // Let the loop run again but with a smaller batch size for this failing chunk
                state.batch_size = Math.floor(state.batch_size / 2);
            } else if (state.batch_size === 1) {
                console.log(`🚨 Broken image isolated at index ${state.processed_images_count}. Skipping this image entirely.`);
                state.processed_images_count += 1;
                state.batch_size = BATCH_SIZE; // Reset back to default size for the next batch
            } else {
                console.log("Saving state to allow resuming from this point later.");
                saveState(state);
                return; // Exit script on fatal error
            }
            saveState(state);
        }
    }
}

testGrokWithImages();
