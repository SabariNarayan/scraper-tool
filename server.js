const express = require("express");
const puppeteer = require("puppeteer");

const app = express();
app.use(express.json());
app.use(express.static("public"));

async function scrapePage(url, linkFilter = "", imageFilter = "") {
    const browser = await puppeteer.launch({
        headless: "new",
        args: ["--no-sandbox"]
    });

    const page = await browser.newPage();

    await page.setUserAgent(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36"
    );

    await page.setViewport({ width: 1366, height: 768 });

    await page.goto(url, { waitUntil: "networkidle2" });

    // Wait for AEM dynamic content
    await new Promise(res => setTimeout(res, 3000));

    const data = await page.evaluate((linkFilter, imageFilter) => {

        function matchesFilter(value, filter) {
            return !filter || value.toLowerCase().includes(filter);
        }

        function getAllElements(root) {
            let elements = [];

            function traverse(node) {
                if (!node) return;

                if (node.nodeType === 1) {
                    elements.push(node);

                    if (node.shadowRoot) {
                        traverse(node.shadowRoot);
                    }
                }

                node.childNodes.forEach(child => traverse(child));
            }

            traverse(root);
            return elements;
        }

        const allElements = getAllElements(document);

        // LINKS
        const links = allElements
            .filter(el => el.tagName === "A" && el.href)
            .map(a => a.href)
            .filter(h => matchesFilter(h, linkFilter));

        // IMAGES
        const images = allElements
            .filter(el => el.tagName === "IMG" && el.src)
            .map(img => img.src)
            .filter(s => matchesFilter(s, imageFilter));

        // VIDEOS (ROBUST UMP HANDLING)
        const videos = [];

        allElements
            .filter(el => el.tagName === "UNIVERSAL-MEDIA-PLAYER")
            .forEach(p => {
                const options = p.getAttribute("options");
                if (!options) return;

                try {
                    const decoded = options.replace(/&quot;/g, '"');
                    const json = JSON.parse(decoded);

                    let videoName = null;
                    let sources = [];

                    if (json.unlocalizedTitle) {
                        videoName = json.unlocalizedTitle;
                    } else if (json.title) {
                        videoName = json.title;
                    }

                    if (json.sources && json.sources.length > 0) {
                        sources = json.sources.map(s => s.src);

                        if (!videoName) {
                            const src = json.sources[0].src;
                            videoName = src.split("/").pop().split("?")[0];
                        }
                    }

                    if (videoName || sources.length > 0) {
                        videos.push({
                            name: videoName || "UNKNOWN",
                            sources
                        });
                    }

                } catch (e) {}
            });

        return { links, images, videos };

    }, linkFilter.toLowerCase(), imageFilter.toLowerCase());

    await browser.close();
    return data;
}

// API
app.post("/scrape", async (req, res) => {
    const { urls, linkFilter, imageFilter } = req.body;

    try {
        let results = [];

        for (let url of urls) {
            console.log("Scraping:", url);
            const data = await scrapePage(url, linkFilter, imageFilter);
            results.push({ url, ...data });
        }

        res.json(results);

    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.listen(3000, () => {
    console.log("🚀 Server running at http://localhost:3000");
});