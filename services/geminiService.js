import { GoogleGenAI, Type } from "@google/genai";

const getClient = () => {
    const apiKey = process.env.API_KEY;
    if (!apiKey) {
        console.warn("API_KEY not found in environment variables");
    }
    return new GoogleGenAI({ apiKey: apiKey || 'dummy-key' });
};

/**
 * Analyzes land data combining visual input and computed geospatial statistics.
 * This effectively simulates a "Grounding" process where the AI interprets the 
 * hard data calculated by our "GEE" engine.
 */
export const analyzeLandData = async (
    base64Image, 
    promptText,
    computedStats
) => {
    try {
        const ai = getClient();
        
        // Construct a prompt that includes the hard data
        const statsDescription = Object.entries(computedStats)
            .filter(([key]) => key !== 'RGB')
            .map(([key, stat]) => 
                `${key}: Mean ${stat.mean.toFixed(2)}, Max ${stat.max.toFixed(2)}, Min ${stat.min.toFixed(2)}`
            ).join('\n');

        const prompt = `
            Analyze this land parcel image and the following computed geospatial indices:
            
            ${statsDescription}
            
            Context: ${promptText}

            The NDVI (Normalized Difference Vegetation Index) indicates vegetation density.
            - > 0.5: Dense healthy vegetation
            - 0.2 - 0.5: Moderate vegetation / shrubs
            - < 0.2: Barren rock, sand, or snow
            
            Based on the visual features and these calculated metrics, provide a land intelligence report.
            
            Return JSON matching this schema:
            - suitabilityScore (0-100 number)
            - landUse (string)
            - cropRecommendations (array of strings)
            - risks (array of strings)
            - soilTypeEstimation (string)
            - summary (string, max 60 words, referencing the specific index values)
        `;

        const response = await ai.models.generateContent({
            model: 'gemini-3-flash-preview',
            contents: {
                parts: [
                    {
                        inlineData: {
                            mimeType: 'image/jpeg',
                            data: base64Image
                        }
                    },
                    { text: prompt }
                ]
            },
            config: {
                responseMimeType: "application/json",
                responseSchema: {
                    type: Type.OBJECT,
                    properties: {
                        suitabilityScore: { type: Type.NUMBER },
                        landUse: { type: Type.STRING },
                        cropRecommendations: { 
                            type: Type.ARRAY,
                            items: { type: Type.STRING }
                        },
                        risks: {
                            type: Type.ARRAY,
                            items: { type: Type.STRING }
                        },
                        soilTypeEstimation: { type: Type.STRING },
                        summary: { type: Type.STRING }
                    }
                }
            }
        });

        const text = response.text;
        if (!text) return null;
        
        const partialResult = JSON.parse(text);
        
        // Merge the AI insights with our hard computed stats
        return {
            ...partialResult,
            geoStats: computedStats
        };

    } catch (error) {
        console.error("Error analyzing land data:", error);
        return {
            suitabilityScore: 0,
            landUse: "Error",
            cropRecommendations: [],
            risks: ["Analysis Failed"],
            soilTypeEstimation: "Unknown",
            summary: "Failed to generate analysis.",
            geoStats: computedStats
        };
    }
};

export const getGeneralInsights = async (query) => {
    try {
        const ai = getClient();
        const response = await ai.models.generateContent({
            model: 'gemini-3-flash-preview',
            contents: query,
        });
        return response.text || "No insights available.";
    } catch (error) {
        console.error("Error getting insights:", error);
        return "Unable to retrieve insights at this time.";
    }
}