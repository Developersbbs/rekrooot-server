import fs from "fs";
import mammoth from "mammoth";
import WordExtractor from "word-extractor";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const pdfParse = require("pdf-parse");

export const extractTextFromFile = async (filePath, originalFilename, fileSize) => {
    let text = "";
    const filename = originalFilename.toLowerCase();

    if (filename.endsWith(".pdf")) {
        try {
            if (fileSize > 10 * 1024 * 1024) {
                throw new Error("PDF file too large (max 10MB)");
            }

            console.log("Reading PDF file...");
            const dataBuffer = fs.readFileSync(filePath);

            console.log("Parsing PDF text using pdf-parse...");
            const pdfData = await pdfParse(dataBuffer);
            text = pdfData.text;
            console.log("PDF parsed successfully, text length:", text.length);
        } catch (pdfError) {
            console.error("PDF parsing failed:", pdfError);
            text = "";
        }
    }

    else if (filename.endsWith(".docx") || filename.endsWith(".doc")) {
        const isDocx = filename.endsWith(".docx");

        try {
            if (isDocx) {
                // Handle .docx files with mammoth
                console.log("Processing DOCX document...");
                const result = await mammoth.extractRawText({ path: filePath });
                text = result.value || "";
                console.log("DOCX parsed successfully, text length:", text.length);
            } else {
                // Handle .doc files with word-extractor
                console.log("Processing DOC document...");
                const extractor = new WordExtractor();
                const extracted = await extractor.extract(filePath);
                text = extracted.getBody() || "";
                console.log("DOC parsed successfully, text length:", text.length);
            }
        } catch (docError) {
            console.error("Word parsing failed:", docError);
            text = "";
        }
    } else {
        throw new Error("Unsupported file format");
    }

    console.log("Final extracted text length:", text.length);

    const debugLines = text.split('\n').slice(0, 10);
    console.log("First 10 lines:", debugLines);

    return text;
};

export function parseResumeText(text) {
    if (typeof text !== "string") {
        text = String(text || "");
    }

    const data = {
        name: "",
        email: "",
        phone: "",
        location: "",
        experience: "",
    };

    const emailRegex = /([a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9_-]+)/i;
    const emailMatch = text.match(emailRegex);
    if (emailMatch) data.email = emailMatch[0];
    const phoneRegex = /(?:\+?\d{1,3}[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)?\d{3,4}[-.\s]?\d{4}\b/g;
    const phoneMatches = text.match(phoneRegex);
    if (phoneMatches) {
        const validPhone = phoneMatches.find(match => {
            const digitsOnly = match.replace(/\D/g, '');
            return digitsOnly.length >= 10 && !match.match(/^20\d{2}[-\s]20\d{2}$/);
        });
        if (validPhone) data.phone = validPhone;
    }

    const expRegex = /(\d+(?:\.\d+)?)\s*(?:\+)?\s*(?:years?|yrs?)\s*(?:of\s*)?(?:experience|exp\b)/i;
    const expMatch = text.match(expRegex);
    if (expMatch) data.experience = expMatch[1];
    let lines = text
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l.length > 0);

    if (lines.length < 5) {
        const firstLine = lines[0] || "";
        lines = firstLine.split(/\s{2,}|\s*•\s*|\s*\|\s*/).filter(l => l.trim().length > 0);
        console.log("Split first line into:", lines.slice(0, 10));
    }

    console.log("Processing lines:", lines.slice(0, 10));

    // Name detection
    const commonHeaders = [
        "resume",
        "curriculum vitae",
        "cv",
        "contact",
        "profile",
        "summary",
        "about me",
    ];

    for (let i = 0; i < Math.min(15, lines.length); i++) {
        const line = lines[i];
        const lowerLine = line.toLowerCase();

        console.log(`Checking line ${i}: "${line}"`);

        if (commonHeaders.some((header) => lowerLine === header)) {
            console.log("  - Skipped: common header");
            continue;
        }
        if (line.includes("@") || /\d{5,}/.test(line)) {
            console.log("  - Skipped: contains email or numbers");
            continue;
        }

        if (/[\|\/\\]/.test(line)) {
            console.log("  - Skipped: special characters");
            continue;
        }
        if (line.toLowerCase().includes('developer') || line.toLowerCase().includes('engineer')) {
            console.log("  - Skipped: technical terms");
            continue;
        }
        if (line.toLowerCase().includes('summary') || line.toLowerCase().includes('skills')) {
            console.log("  - Skipped: summary/skills");
            continue;
        }

        const wordCount = line.split(/\s+/).length;
        console.log(`  - Word count: ${wordCount}, Line length: ${line.length}`);

        if (wordCount >= 1 && wordCount <= 4 && line.length > 3) {
            // Check if it looks like a name (letters only, possibly all caps, allow spaces)
            const words = line.split(/\s+/);
            const isNameLike = words.every(word => /^[A-Za-z\.]+$/.test(word) && word.length > 1);
            console.log(`  - Is name-like: ${isNameLike}`);
            console.log(`  - Words: [${words.map(w => `"${w}"`).join(', ')}]`);

            // Additional check: All words should start with capital letter (handles both normal and all-caps names)
            const hasCapitalizedWords = words.every(word => word[0] === word[0].toUpperCase());
            console.log(`  - Has capitalized words: ${hasCapitalizedWords}`);

            // Special check: Allow all-caps names (common in resumes)
            const isAllCaps = words.every(word => word === word.toUpperCase());
            console.log(`  - Is all caps: ${isAllCaps}`);

            // More lenient check: if it's the first line and looks like a name, accept it
            const isFirstLine = i === 0;
            const looksLikeName = isFirstLine && isAllCaps && words.every(word => word.length >= 1);

            if ((isNameLike && hasCapitalizedWords && (isAllCaps || words.every(word => word.length > 1))) || looksLikeName) {
                data.name = line;
                console.log("Found name:", line);
                break;
            } else {
                console.log("  - Name validation failed");
            }
        } else {
            console.log("  - Skipped: wrong word count or length");
        }
    }

    const commonCities = [
        "Chennai", "Coimbatore", "Bangalore", "Mumbai", "Delhi", "Hyderabad",
        "Kolkata", "Pune", "Ahmedabad", "Jaipur", "Lucknow", "Kanpur", "Nagpur",
        "Indore", "Thane", "Bhopal", "Visakhapatnam", "Pimpri-Chinchwad",
        "Patna", "Vadodara", "Ghaziabad", "Ludhiana", "Agra", "Nashik", "Roorkee"
    ];

    for (const line of lines.slice(0, 5)) {
        const cleanLine = line.trim();
        if (cleanLine.includes('@') || cleanLine.includes('linkedin') || cleanLine.includes('github') || cleanLine.includes('•')) {
            const foundCity = commonCities.find(city => cleanLine.toLowerCase().includes(city.toLowerCase()));
            if (foundCity) {
                data.location = foundCity;
                console.log("Found location (header):", foundCity);
                break;
            }
        }
    }

    if (!data.location) {
        const locationKeywords = /(?:location|address|residing in|based in|current city|city|native)[:\-\s]+/i;

        for (const line of lines.slice(0, 30)) {
            const keywordMatch = line.match(locationKeywords);
            if (keywordMatch) {
                const loc = line
                    .substring(keywordMatch.index + keywordMatch[0].length)
                    .trim();
                if (loc.length > 2 && loc.length < 60) {
                    data.location = loc;
                    console.log("Found location (keyword):", loc);
                    break;
                }
            }
        }
    }

    if (!data.location) {
        const locationRegex = /([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*),\s*([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*|[A-Z]{2})/;

        for (const line of lines.slice(0, 15)) {
            const match = line.match(locationRegex);
            if (match) {
                const commonSkills = [
                    "Java", "Python", "React", "Node", "Spring", "Docker", "Kubernetes", "SQL", "Git",
                ];
                const isSkillLine = commonSkills.some((skill) =>
                    line.toLowerCase().includes(skill.toLowerCase())
                );

                if (!isSkillLine) {
                    data.location = match[0];
                    console.log("Found location (pattern):", match[0]);
                    break;
                }
            }
        }
    }

    if (!data.location) {
        for (const line of lines.slice(5, 50)) { // Start from line 5 to avoid header
            const cleanLine = line.trim();
            if (commonCities.some(city => cleanLine.toLowerCase().includes(city.toLowerCase()))) {
                const foundCity = commonCities.find(city => cleanLine.toLowerCase().includes(city.toLowerCase()));
                if (foundCity && cleanLine.length < 100) {
                    data.location = foundCity;
                    console.log("Found location (city):", foundCity);
                    break;
                }
            }
        }
    }

    console.log("Final parsed data:", data);
    return data;
}
