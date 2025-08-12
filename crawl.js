class WebDataCrawler {
    constructor() {
        this.retryConfig = {
            maxRetries: 3,
            retryDelay: 2000,
            backoffMultiplier: 2
        };
        this.timeout = 45000; // Increase timeout for heavy sites
        
        // Site-specific configurations
        this.siteConfigs = {
            'facebook.com': {
                waitTime: 3000,
                selectors: {
                    content: '[data-pagelet="FeedUnit"], [role="article"], .userContentWrapper',
                    title: '[data-testid="post_message"], h1, .actorName',
                    remove: '.uiPopover, .ego_section, ._4-u2, ._1dwg, ._5pcr'
                }
            },
            'twitter.com': {
                waitTime: 2000,
                selectors: {
                    content: '[data-testid="tweet"], article[role="article"]',
                    title: '[data-testid="tweetText"] span, .tweet-text',
                    remove: '.r-1loqt21, .r-u8s1d, [data-testid="placementTracking"]'
                }
            },
            'x.com': {
                waitTime: 2000,
                selectors: {
                    content: '[data-testid="tweet"], article[role="article"]',
                    title: '[data-testid="tweetText"] span, .tweet-text',
                    remove: '.r-1loqt21, .r-u8s1d, [data-testid="placementTracking"]'
                }
            },
            'shopee.vn': {
                waitTime: 3000,
                selectors: {
                    content: '.item-description, .product-detail, .shopee-item-info',
                    title: '.item-name, .product-title, h1',
                    remove: '.shopee-mini-cart, .shopee-drawer, .fixed-plugin'
                }
            },
            'lazada.vn': {
                waitTime: 2500,
                selectors: {
                    content: '.product-detail, .detail-content, .pdp-product-detail',
                    title: '.product-title, h1',
                    remove: '.lzd-header, .lzd-footer, .float-module'
                }
            },
            'vnexpress.net': {
                waitTime: 1500,
                selectors: {
                    content: '.fck_detail, .Normal, article, .content_detail',
                    title: 'h1.title_news, h1, .title-detail',
                    remove: '.box_category, .width_common, .banner'
                }
            },
            'baomoi.com': {
                waitTime: 2000,
                selectors: {
                    content: '.article-content, .bm_F, .detail-content',
                    title: 'h1, .article-title',
                    remove: '.header, .footer, .ads, .related'
                }
            },
            'tinhte.vn': {
                waitTime: 2000,
                selectors: {
                    content: '.bbWrapper, .message-content, article',
                    title: 'h1, .p-title',
                    remove: '.message-signature, .bbCodeBlock-expandLink'
                }
            },
            'platform.openai.com': {
                waitTime: 2000,
                selectors: {
                    content: '.docs-content, main, article, .markdown-body',
                    title: 'h1, .docs-title, .page-title',
                    remove: '.sidebar, .navigation, .docs-nav'
                }
            },
            'github.com': {
                waitTime: 1500,
                selectors: {
                    content: '.markdown-body, .repository-content, .readme',
                    title: 'h1, .entry-title, .f4',
                    remove: '.Header, .footer, .js-sticky'
                }
            },
            'stackoverflow.com': {
                waitTime: 1000,
                selectors: {
                    content: '.s-prose, .post-text, .answer',
                    title: 'h1, .question-hyperlink',
                    remove: '.left-sidebar, .right-sidebar, .js-vote-count'
                }
            }
        };
    }

    async crawlPage(url, options = {}) {
        console.log(`🔍 Crawling: ${url}`);
        
        try {
            const domain = new URL(url).hostname.replace('www.', '');
            const siteConfig = this.siteConfigs[domain] || {};
            
            // Wait for dynamic content if needed
            if (siteConfig.waitTime) {
                console.log(`⏳ Waiting ${siteConfig.waitTime}ms for dynamic content...`);
                await this.sleep(siteConfig.waitTime);
            }
            
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), this.timeout);
            
            const response = await this.fetchWithRetry(url, {
                headers: this.getHeaders(domain),
                signal: controller.signal
            });
            
            clearTimeout(timeoutId);
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            
            const html = await response.text();
            
            // Try multiple parsing strategies
            const pageData = await this.parseWithStrategies(html, url, siteConfig);
            
            if (!pageData.text || pageData.text.trim().length < 50) {
                console.warn(`⚠️ Minimal content found on ${url}, trying alternative methods`);
                const alternativeData = this.parseWithAlternativeMethod(html, url);
                if (alternativeData.text.length > pageData.text.length) {
                    Object.assign(pageData, alternativeData);
                }
            }
            
            const chunks = this.splitIntoChunks(pageData.text, options.chunkSize || 1000);
            console.log(`📄 Extracted ${chunks.length} chunks from ${url}`);

            return chunks.map((chunk, index) => ({
                id: this.generateId(url, index),
                pageUrl: url,
                title: pageData.title,
                text: chunk.trim(),
                metadata: {
                    ...pageData.metadata,
                    wordCount: chunk.trim().split(/\s+/).length,
                    language: this.detectLanguage(chunk),
                    domain,
                    crawlMethod: pageData.method || 'standard'
                },
                timestamp: new Date().toISOString(),
                chunkIndex: index,
                totalChunks: chunks.length
            }));
            
        } catch (error) {
            console.error(`❌ Error crawling ${url}:`, error.message);
            
            // Try fallback method for problematic sites
            if (error.name === 'AbortError' || error.message.includes('timeout')) {
                console.log(`🔄 Trying fallback method for ${url}`);
                return this.crawlWithFallback(url, options);
            }
            
            throw new Error(`Failed to crawl ${url}: ${error.message}`);
        }
    }

    getHeaders(domain) {
        const baseHeaders = {
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9,vi;q=0.8',
            'Accept-Encoding': 'gzip, deflate, br',
            'Connection': 'keep-alive',
            'Upgrade-Insecure-Requests': '1',
            'Sec-Fetch-Dest': 'document',
            'Sec-Fetch-Mode': 'navigate',
            'Sec-Fetch-Site': 'none',
            'Cache-Control': 'max-age=0'
        };

        // Site-specific headers
        const siteHeaders = {
            'facebook.com': {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Sec-CH-UA': '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"'
            },
            'twitter.com': {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'X-Requested-With': 'XMLHttpRequest'
            },
            'x.com': {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'X-Requested-With': 'XMLHttpRequest'
            },
            'shopee.vn': {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Referer': 'https://shopee.vn/'
            },
            'lazada.vn': {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Referer': 'https://www.lazada.vn/'
            },
            'github.com': {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
            },
            'stackoverflow.com': {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            }
        };

        return {
            ...baseHeaders,
            ...siteHeaders[domain],
            'User-Agent': siteHeaders[domain]?.['User-Agent'] || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        };
    }

    async parseWithStrategies(html, url, siteConfig) {
        const strategies = [
            () => this.parseWithSiteConfig(html, url, siteConfig),
            () => this.parseWithSchemaOrg(html, url),
            () => this.parseWithSemantic(html, url),
            () => this.parseHTML(html, url) // fallback to original method
        ];

        for (const strategy of strategies) {
            try {
                const result = strategy();
                if (result.text && result.text.trim().length > 100) {
                    return { ...result, method: strategy.name || 'unknown' };
                }
            } catch (error) {
                console.warn(`Strategy failed: ${error.message}`);
                continue;
            }
        }

        return { title: '', text: '', metadata: {}, method: 'none' };
    }

    parseWithSiteConfig(html, url, siteConfig) {
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');

        // Remove site-specific unwanted elements
        if (siteConfig.selectors?.remove) {
            siteConfig.selectors.remove.split(', ').forEach(selector => {
                doc.querySelectorAll(selector).forEach(el => el.remove());
            });
        }

        // Try site-specific content selectors
        let text = '';
        if (siteConfig.selectors?.content) {
            const contentElements = doc.querySelectorAll(siteConfig.selectors.content);
            text = Array.from(contentElements)
                .map(el => el.innerText || el.textContent || '')
                .join('\n\n');
        }

        // Try site-specific title selectors
        let title = '';
        if (siteConfig.selectors?.title) {
            const titleElement = doc.querySelector(siteConfig.selectors.title);
            title = titleElement ? (titleElement.innerText || titleElement.textContent || '') : '';
        }

        if (!text) {
            return this.parseHTML(html, url);
        }

        return {
            title: title || this.extractTitle(doc),
            text: this.cleanText(text),
            metadata: this.extractMetadata(doc, url),
            method: 'site-config'
        };
    }

    parseWithSchemaOrg(html, url) {
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');

        // Look for JSON-LD structured data
        const jsonLdScripts = doc.querySelectorAll('script[type="application/ld+json"]');
        let schemaData = {};

        for (const script of jsonLdScripts) {
            try {
                const data = JSON.parse(script.textContent);
                if (data['@type'] === 'Article' || data['@type'] === 'NewsArticle') {
                    schemaData = data;
                    break;
                }
            } catch (error) {
                continue;
            }
        }

        if (schemaData.articleBody || schemaData.text) {
            return {
                title: schemaData.headline || schemaData.name || this.extractTitle(doc),
                text: this.cleanText(schemaData.articleBody || schemaData.text),
                metadata: {
                    ...this.extractMetadata(doc, url),
                    author: schemaData.author?.name || schemaData.author,
                    publishedTime: schemaData.datePublished,
                    modifiedTime: schemaData.dateModified
                },
                method: 'schema-org'
            };
        }

        throw new Error('No Schema.org data found');
    }

    parseWithSemantic(html, url) {
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');

        // Enhanced semantic selectors
        const semanticSelectors = [
            'main article',
            '[role="main"] article',
            'main .content',
            'article .content',
            '.post-content',
            '.entry-content', 
            '.article-content',
            '.story-body',
            '.content-body',
            '[itemprop="articleBody"]',
            '.markdown-body', // For documentation sites
            '.docs-content',
            '.wiki-content'
        ];

        for (const selector of semanticSelectors) {
            const element = doc.querySelector(selector);
            if (element) {
                const text = this.cleanText(element.innerText || element.textContent || '');
                if (text.length > 200) {
                    return {
                        title: this.extractTitle(doc),
                        text,
                        metadata: this.extractMetadata(doc, url),
                        method: 'semantic'
                    };
                }
            }
        }

        throw new Error('No semantic content found');
    }

    parseWithAlternativeMethod(html, url) {
        // Try to extract content from script tags (for SPAs)
        const scriptContent = this.extractFromScripts(html);
        if (scriptContent.length > 100) {
            return {
                title: 'Extracted from JavaScript',
                text: this.cleanText(scriptContent),
                metadata: { domain: new URL(url).hostname },
                method: 'script-extraction'
            };
        }

        // Try to get all visible text as last resort
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');
        
        // Remove all script and style tags
        doc.querySelectorAll('script, style, noscript').forEach(el => el.remove());
        
        const allText = doc.body ? (doc.body.innerText || doc.body.textContent || '') : '';
        
        return {
            title: this.extractTitle(doc),
            text: this.cleanText(allText),
            metadata: this.extractMetadata(doc, url),
            method: 'fallback'
        };
    }

    extractFromScripts(html) {
        // Extract text content from JavaScript variables
        const textPatterns = [
            /"text":\s*"([^"]+)"/g,
            /"content":\s*"([^"]+)"/g,
            /"body":\s*"([^"]+)"/g,
            /"description":\s*"([^"]+)"/g
        ];

        let extractedText = '';
        for (const pattern of textPatterns) {
            let match;
            while ((match = pattern.exec(html)) !== null) {
                extractedText += match[1] + ' ';
            }
        }

        return extractedText.replace(/\\n/g, '\n').replace(/\\"/g, '"');
    }

    async crawlWithFallback(url, options) {
        console.log(`🔄 Using fallback method for ${url}`);
        
        try {
            // Simple fetch without timeout for problematic sites
            const response = await fetch(url, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)'
                }
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            const html = await response.text();
            const pageData = this.parseWithAlternativeMethod(html, url);
            
            if (pageData.text.length < 50) {
                console.log(`⚠️ Minimal content extracted from ${url}`);
                return [];
            }

            const chunks = this.splitIntoChunks(pageData.text, options.chunkSize || 1000);
            console.log(`📄 Fallback extraction: ${chunks.length} chunks from ${url}`);

            return chunks.map((chunk, index) => ({
                id: this.generateId(url, index),
                pageUrl: url,
                title: pageData.title,
                text: chunk.trim(),
                metadata: {
                    ...pageData.metadata,
                    crawlMethod: 'fallback',
                    wordCount: chunk.trim().split(/\s+/).length
                },
                timestamp: new Date().toISOString(),
                chunkIndex: index,
                totalChunks: chunks.length
            }));

        } catch (error) {
            console.error(`❌ Fallback method failed for ${url}:`, error.message);
            return [];
        }
    }

    async fetchWithRetry(url, options, attempt = 1) {
        try {
            return await fetch(url, options);
        } catch (error) {
            if (attempt >= this.retryConfig.maxRetries) {
                throw error;
            }
            
            const delay = this.retryConfig.retryDelay * Math.pow(this.retryConfig.backoffMultiplier, attempt - 1);
            console.log(`🔄 Retry ${attempt}/${this.retryConfig.maxRetries} for ${url} in ${delay}ms`);
            
            await this.sleep(delay);
            return this.fetchWithRetry(url, options, attempt + 1);
        }
    }

    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    generateId(url, index) {
        const urlHash = this.simpleHash(url).toString(36);
        const timestamp = Date.now().toString(36);
        return `chunk_${urlHash}_${timestamp}_${index}`;
    }

    simpleHash(str) {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash;
        }
        return Math.abs(hash);
    }

    parseHTML(html, url) {
        try {
            const parser = new DOMParser();
            const doc = parser.parseFromString(html, 'text/html');
            
            const unwantedSelectors = [
                'script', 'style', 'nav', 'footer', 'header', 
                '.navigation', '.sidebar', '.menu', '.ads', '.advertisement',
                '#comments', '.comment', '.social-share', '.cookie-notice',
                '.popup', '.modal', '.overlay', '[role="banner"]', '[role="navigation"]',
                '.related-posts', '.recommended', '.trending'
            ];
            
            unwantedSelectors.forEach(selector => {
                doc.querySelectorAll(selector).forEach(el => el.remove());
            });

            const title = this.extractTitle(doc);
            const text = this.extractMainContent(doc);
            const metadata = this.extractMetadata(doc, url);

            return { title, text, metadata };
            
        } catch (error) {
            console.error('Error parsing HTML:', error);
            return { title: '', text: '', metadata: {} };
        }
    }

    extractTitle(doc) {
        const titleSources = [
            () => doc.querySelector('h1')?.textContent?.trim(),
            () => doc.querySelector('title')?.textContent?.trim(),
            () => doc.querySelector('meta[property="og:title"]')?.getAttribute('content')?.trim(),
            () => doc.querySelector('meta[name="title"]')?.getAttribute('content')?.trim(),
            () => doc.querySelector('[itemprop="headline"]')?.textContent?.trim()
        ];

        for (const getTitle of titleSources) {
            const title = getTitle();
            if (title && title.length > 0 && title.length < 200) {
                return title;
            }
        }
        return 'Untitled Page';
    }

    extractMainContent(doc) {
        const contentSelectors = [
            'main', 'article', '.content', '.main-content', 
            '.post-content', '.entry-content', '#content',
            '.article-body', '.story-body', '.post-body',
            '[role="main"]', '.page-content'
        ];

        for (const selector of contentSelectors) {
            const element = doc.querySelector(selector);
            if (element) {
                return this.cleanText(element.innerText || element.textContent || '');
            }
        }

        const bodyText = doc.body ? (doc.body.innerText || doc.body.textContent || '') : '';
        return this.cleanText(bodyText);
    }

    cleanText(text) {
        return text
            .replace(/\s+/g, ' ')
            .replace(/\n\s*\n/g, '\n')
            .replace(/[\u200B-\u200D\uFEFF]/g, '') // Remove zero-width characters
            .trim();
    }

    extractMetadata(doc, url) {
        const getMeta = (name) => {
            const selectors = [
                `meta[name="${name}"]`,
                `meta[property="${name}"]`,
                `meta[property="og:${name}"]`,
                `meta[name="twitter:${name}"]`,
                `meta[itemprop="${name}"]`
            ];

            for (const selector of selectors) {
                const element = doc.querySelector(selector);
                if (element) {
                    return element.getAttribute('content')?.trim() || '';
                }
            }
            return '';
        };

        return {
            description: getMeta('description'),
            keywords: getMeta('keywords'),
            author: getMeta('author'),
            publishedTime: getMeta('article:published_time') || getMeta('published_time') || getMeta('datePublished'),
            modifiedTime: getMeta('article:modified_time') || getMeta('modified_time') || getMeta('dateModified'),
            siteName: getMeta('site_name') || getMeta('og:site_name'),
            type: getMeta('type') || getMeta('og:type'),
            image: getMeta('image') || getMeta('og:image'),
            domain: new URL(url).hostname,
            canonical: doc.querySelector('link[rel="canonical"]')?.getAttribute('href') || url,
            language: doc.documentElement.getAttribute('lang') || 'unknown'
        };
    }

    detectLanguage(text) {
        const sample = text.substring(0, 100).toLowerCase();
        
        if (/[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/.test(sample)) {
            return 'vi';
        } else if (/[а-яё]/.test(sample)) {
            return 'ru';
        } else if (/[一-龯]/.test(sample)) {
            return 'zh';
        } else if (/[ひらがなカタカナ]/.test(sample)) {
            return 'ja';
        } else if (/[가-힣]/.test(sample)) {
            return 'ko';
        }
        
        return 'en';
    }

    splitIntoChunks(text, maxSize = 1000) {
        if (!text || text.length <= maxSize) {
            return text ? [text] : [];
        }

        const chunks = [];
        const paragraphs = text.split(/\n\s*\n/);
        let currentChunk = '';

        for (const paragraph of paragraphs) {
            if (paragraph.trim().length === 0) continue;

            if (paragraph.length > maxSize) {
                if (currentChunk.trim()) {
                    chunks.push(currentChunk.trim());
                    currentChunk = '';
                }
                
                const sentences = paragraph.match(/[^.!?]+[.!?]+/g) || [paragraph];
                for (const sentence of sentences) {
                    if ((currentChunk + sentence).length > maxSize && currentChunk.trim()) {
                        chunks.push(currentChunk.trim());
                        currentChunk = sentence.trim();
                    } else {
                        currentChunk += (currentChunk ? ' ' : '') + sentence.trim();
                    }
                }
            } else {
                if ((currentChunk + '\n\n' + paragraph).length > maxSize && currentChunk.trim()) {
                    chunks.push(currentChunk.trim());
                    currentChunk = paragraph;
                } else {
                    currentChunk += (currentChunk ? '\n\n' : '') + paragraph;
                }
            }
        }

        if (currentChunk.trim()) {
            chunks.push(currentChunk.trim());
        }

        return chunks.filter(chunk => chunk.length > 10); // Filter out very short chunks
    }

    isValidUrl(string) {
        try {
            new URL(string);
            return true;
        } catch (_) {
            return false;
        }
    }

    async crawlMultipleUrls(urls, options = {}) {
        const results = [];
        const maxConcurrent = options.maxConcurrent || 2;
        
        for (let i = 0; i < urls.length; i += maxConcurrent) {
            const batch = urls.slice(i, i + maxConcurrent);
            const batchPromises = batch.map(url => 
                this.crawlPage(url, options).catch(error => ({
                    url,
                    error: error.message,
                    success: false
                }))
            );
            
            const batchResults = await Promise.all(batchPromises);
            results.push(...batchResults);
            
            // Add delay between batches for respectful crawling
            if (i + maxConcurrent < urls.length) {
                await this.sleep(3000);
            }
        }
        
        return results;
    }

    // Add new sites configuration
    addSiteConfig(domain, config) {
        this.siteConfigs[domain] = config;
    }

    // Get current configuration for a domain
    getSiteConfig(domain) {
        return this.siteConfigs[domain] || null;
    }

    // List all configured sites
    getConfiguredSites() {
        return Object.keys(this.siteConfigs);
    }
}

// Usage example - CHỈ CRAWL, KHÔNG GỬI ĐI ĐÂU CẢ
(async () => {
    const crawler = new WebDataCrawler();

    try {
        const currentUrl = window.location.href;
        
        if (!crawler.isValidUrl(currentUrl)) {
            throw new Error('Invalid URL');
        }
        
        console.log('🌟 Starting web data crawl...');
        const crawlData = await crawler.crawlPage(currentUrl, { 
            chunkSize: 800
        });
        
        if (crawlData && crawlData.length > 0) {
            console.log(`🎯 Crawl successful! Extracted ${crawlData.length} chunks.`);
            console.log('📊 Crawled data:', crawlData);
            
            // Bạn có thể làm gì với data này:
            // - Lưu vào localStorage
            // - Gửi đến API khác
            // - Xử lý thêm
            // - Export ra file
            
        } else {
            console.log('ℹ️ No content was extracted from this page.');
        }
        
    } catch (error) {
        console.error('💥 Web crawl failed:', error.message);
    }
})();