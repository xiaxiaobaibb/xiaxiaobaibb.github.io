(function() {
'use strict';

let pluginEnabled = true;
const playlistCache = new Map();

function showToast(message) {
    const existingToast = document.getElementById('adfilter-toast');
    if (existingToast) existingToast.remove();
    
    const isDark = document.documentElement.classList.contains('dark');
    const bgColor = isDark ? '#1f2937' : '#f3f4f6';
    const textColor = isDark ? '#f3f4f6' : '#1f2937';
    const borderColor = isDark ? '#374151' : '#d1d5db';
    
    const toast = document.createElement('div');
    toast.id = 'adfilter-toast';
    toast.textContent = message;
    toast.style.cssText = `position:fixed;bottom:20px;right:20px;background:${bgColor};color:${textColor};padding:12px 20px;border:1px solid ${borderColor};font-size:14px;font-weight:300;font-family:"Inter",-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;z-index:999999;opacity:0;transform:translateY(20px);transition:opacity 0.3s,transform 0.3s;pointer-events:none;`;
    document.body.appendChild(toast);
    requestAnimationFrame(() => { toast.style.opacity = '1'; toast.style.transform = 'translateY(0)'; });
    setTimeout(() => { toast.style.opacity = '0'; toast.style.transform = 'translateY(20px)'; setTimeout(() => toast.remove(), 300); }, 3000);
}

function formatDuration(seconds) {
    seconds = Math.round(seconds);
    if (seconds < 60) return seconds + ' 秒';
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    if (remainingSeconds === 0) return minutes + ' 分钟';
    return minutes + ' 分 ' + remainingSeconds + ' 秒';
}

function levenshteinDistance(s, t) {
    if (s.length === 0) return t.length;
    if (t.length === 0) return s.length;
    const matrix = Array(t.length + 1).fill(null).map(() => Array(s.length + 1).fill(null));
    for (let i = 0; i <= s.length; i++) matrix[0][i] = i;
    for (let j = 0; j <= t.length; j++) matrix[j][0] = j;
    for (let j = 1; j <= t.length; j++) {
        for (let i = 1; i <= s.length; i++) {
            const cost = s[i - 1] === t[j - 1] ? 0 : 1;
            matrix[j][i] = Math.min(matrix[j][i - 1] + 1, matrix[j - 1][i] + 1, matrix[j - 1][i - 1] + cost);
        }
    }
    return matrix[t.length][s.length];
}

function extractNumber(filename) {
    const match = filename.match(/(\d+)/g);
    return match ? match.reduce((a, b) => a.length >= b.length ? a : b) : null;
}

function parseM3u8(content, baseUrl) {
    const lines = content.split('\n');
    const segments = [];
    let currentSegment = null;
    let segmentIndex = 0;
    let hasDiscontinuity = false;
    let inAdBreak = false;
    let hasAdDateRange = false;
    const baseHostname = new URL(baseUrl).hostname;
    
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line.startsWith('#EXT-X-CUE-OUT') || line.includes('SCTE35-OUT')) { inAdBreak = true; continue; }
        if (line.startsWith('#EXT-X-CUE-IN') || line.includes('SCTE35-IN')) { inAdBreak = false; continue; }
        if (line.startsWith('#EXT-X-DATERANGE')) {
            const lineLower = line.toLowerCase();
            if (lineLower.includes('class="ad"') || lineLower.includes("class='ad'") || lineLower.includes('scte35') || lineLower.includes('advertisement')) hasAdDateRange = true;
            continue;
        }
        if (line.startsWith('#EXT-X-DISCONTINUITY')) { hasDiscontinuity = true; hasAdDateRange = false; continue; }
        if (line.startsWith('#EXTINF:')) {
            const match = line.match(/#EXTINF:\s*([\d.]+)/);
            currentSegment = { index: segmentIndex++, duration: match ? parseFloat(match[1]) : 0, discontinuity: hasDiscontinuity, lineIndex: i, inAdBreak, hasAdDateRange };
            hasDiscontinuity = false;
            continue;
        }
        if (currentSegment && line && !line.startsWith('#')) {
            currentSegment.uri = line;
            currentSegment.filename = line.split('/').pop().split('?')[0];
            try {
                const fullUrl = new URL(line, baseUrl);
                currentSegment.fullUrl = fullUrl.href;
                currentSegment.hostname = fullUrl.hostname;
                currentSegment.differentDomain = fullUrl.hostname !== baseHostname;
            } catch (e) {
                currentSegment.fullUrl = line;
                currentSegment.hostname = '';
                currentSegment.differentDomain = false;
            }
            segments.push(currentSegment);
            currentSegment = null;
        }
    }
    return { segments, baseHostname };
}

function groupByDiscontinuity(segments) {
    const groups = [];
    let currentGroup = [];
    for (const seg of segments) {
        if (seg.discontinuity && currentGroup.length > 0) { groups.push(currentGroup); currentGroup = []; }
        currentGroup.push(seg);
    }
    if (currentGroup.length > 0) groups.push(currentGroup);
    return groups;
}

function detectBasePattern(filenames) {
    if (filenames.length < 2) return null;
    const prefixes = filenames.map(f => f.replace(/\d+\.ts.*$/, ''));
    const prefixCount = {};
    for (const p of prefixes) prefixCount[p] = (prefixCount[p] || 0) + 1;
    let maxCount = 0, basePrefix = '';
    for (const [prefix, count] of Object.entries(prefixCount)) {
        if (count > maxCount) { maxCount = count; basePrefix = prefix; }
    }
    return basePrefix;
}

function analyzeGroups(groups) {
    if (groups.length <= 1) return groups.map(g => ({ group: g, score: 0, type: 'normal' }));
    const results = [];
    const allFilenames = groups.flat().map(s => s.filename);
    const basePattern = detectBasePattern(allFilenames);
    
    for (let i = 0; i < groups.length; i++) {
        const group = groups[i];
        let score = 0;
        const reasons = [];
        
        const hasScte35 = group.some(s => s.inAdBreak);
        const hasDateRange = group.some(s => s.hasAdDateRange);
        if (hasScte35) { score += 70; reasons.push('SCTE-35'); }
        if (hasDateRange) { score += 65; reasons.push('DATERANGE'); }
        
        const differentDomainCount = group.filter(s => s.differentDomain).length;
        if (differentDomainCount > 0 && differentDomainCount === group.length) { score += 45; reasons.push('different domain'); }
        
        const durations = group.map(s => s.duration);
        const totalDuration = durations.reduce((a, b) => a + b, 0);
        const uniqueDurations = new Set(durations.map(d => d.toFixed(1)));
        
        if (totalDuration < 60 && totalDuration > 0) {
            if (uniqueDurations.size <= 2 && group.length > 1) { score += 40; reasons.push('uniform short'); }
            else if (totalDuration < 35) { score += 25; reasons.push('very short'); }
            if ((totalDuration >= 13 && totalDuration <= 17) || (totalDuration >= 28 && totalDuration <= 32) || (totalDuration >= 24 && totalDuration <= 28) || (totalDuration >= 58 && totalDuration <= 62)) { score += 20; reasons.push('typical ad duration'); }
        }
        
        const shortSegments = durations.filter(d => d >= 2 && d <= 4.5);
        if (shortSegments.length >= 4 && shortSegments.length === group.length) { score += 35; reasons.push('consecutive short'); }
        
        const fixedDurationCount = durations.filter(d => Math.abs(d - 4.0) < 0.01 || Math.abs(d - 2.0) < 0.01 || Math.abs(d - 6.0) < 0.01).length;
        if (fixedDurationCount >= group.length * 0.8 && group.length >= 3) { score += 40; reasons.push('fixed duration'); }
        
        const precisionDurations = durations.map(d => d.toFixed(5));
        const durationCounts = {};
        for (const pd of precisionDurations) durationCounts[pd] = (durationCounts[pd] || 0) + 1;
        const maxSameDurationCount = Math.max(...Object.values(durationCounts));
        const sameDurationRatio = maxSameDurationCount / group.length;
        if (sameDurationRatio >= 0.9 && group.length >= 5) { score += 60; reasons.push('high precision equal'); }
        else if (sameDurationRatio >= 0.8 && group.length >= 4) { score += 35; reasons.push('equal duration'); }
        
        if (i > 0 && i < groups.length - 1) {
            const prevGroup = groups[i - 1];
            const nextGroup = groups[i + 1];
            const prevLast = prevGroup[prevGroup.length - 1]?.filename;
            const currFirst = group[0]?.filename;
            const currLast = group[group.length - 1]?.filename;
            const nextFirst = nextGroup[0]?.filename;
            
            if (prevLast && currFirst && currLast && nextFirst) {
                const prevNum = extractNumber(prevLast);
                const currFirstNum = extractNumber(currFirst);
                const currLastNum = extractNumber(currLast);
                const nextNum = extractNumber(nextFirst);
                
                if (prevNum && currFirstNum && currLastNum && nextNum) {
                    const prevN = parseInt(prevNum), currFirstN = parseInt(currFirstNum), currLastN = parseInt(currLastNum), nextN = parseInt(nextNum);
                    if (Math.abs(nextN - prevN) < 10 && (Math.abs(currFirstN - prevN) > 100 || Math.abs(currLastN - nextN) > 100)) { score += 50; reasons.push('sequence jump'); }
                }
                
                const distPrev = levenshteinDistance(prevLast, currFirst);
                const distNext = levenshteinDistance(currLast, nextFirst);
                const distPrevNext = levenshteinDistance(prevLast, nextFirst);
                if (distPrevNext < 5 && (distPrev > 10 || distNext > 10)) { score += 45; reasons.push('filename jump'); }
                else if (distPrevNext < 8 && (distPrev > 15 || distNext > 15)) { score += 35; reasons.push('filename pattern'); }
            }
        }
        
        if (basePattern) {
            const groupPrefixes = group.map(s => s.filename.replace(/\d+\.ts.*$/, ''));
            const differentPrefixCount = groupPrefixes.filter(p => p !== basePattern).length;
            if (differentPrefixCount === group.length && group.length > 0) { score += 35; reasons.push('prefix anomaly'); }
        }
        
        const firstUrl = group[0]?.fullUrl || '';
        if (firstUrl) {
            const urlLower = firstUrl.toLowerCase();
            if (urlLower.includes('/ad/') || urlLower.includes('/ads/') || urlLower.includes('/advert/') || urlLower.includes('/preroll/') || urlLower.includes('/midroll/') || urlLower.includes('/promo/') || urlLower.includes('/commercial/') || urlLower.includes('/sponsor/')) { score += 60; reasons.push('ad path'); }
        }
        
        if (i === 0 || i === groups.length - 1) score -= 20;
        
        let type = 'normal';
        if (score >= 50) type = 'strong_ad';
        else if (score >= 25) type = 'suspect';
        
        results.push({ group, score, type, reasons, index: i });
    }
    return results;
}

function rebuildPlaylist(content, analysisResults) {
    const lines = content.split('\n');
    const adSegmentIndices = new Set();
    for (const result of analysisResults) {
        if (result.type === 'strong_ad') {
            for (const seg of result.group) adSegmentIndices.add(seg.index);
        }
    }
    
    const newLines = [];
    let currentSegmentIndex = 0;
    let skipNextUrl = false;
    let pendingDiscontinuity = false;
    let lastAddedWasSegment = false;
    
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        const originalLine = lines[i];
        
        if (line.startsWith('#EXT-X-DISCONTINUITY')) {
            if (lastAddedWasSegment) pendingDiscontinuity = true;
            continue;
        }
        
        if (line.startsWith('#EXTINF:')) {
            if (adSegmentIndices.has(currentSegmentIndex)) { skipNextUrl = true; currentSegmentIndex++; continue; }
            if (pendingDiscontinuity) { newLines.push('#EXT-X-DISCONTINUITY'); pendingDiscontinuity = false; }
            newLines.push(originalLine);
            currentSegmentIndex++;
            lastAddedWasSegment = false;
            continue;
        }
        
        if (line && !line.startsWith('#')) {
            if (skipNextUrl) { skipNextUrl = false; continue; }
            newLines.push(originalLine);
            lastAddedWasSegment = true;
            continue;
        }
        
        newLines.push(originalLine);
    }
    
    let result = newLines.join('\n');
    result = result.replace(/(#EXT-X-DISCONTINUITY\n){2,}/g, '#EXT-X-DISCONTINUITY\n');
    result = result.replace(/^(#EXTM3U\n(?:#[^\n]*\n)*)#EXT-X-DISCONTINUITY\n/, '$1');
    result = result.replace(/#EXT-X-DISCONTINUITY\n(#EXT-X-ENDLIST)/, '$1');
    result = result.replace(/\n{3,}/g, '\n\n');
    return result;
}

function processPlaylistCore(url, content) {
    if (content.includes('#EXT-X-STREAM-INF')) return null;
    const { segments } = parseM3u8(content, url);
    if (segments.length === 0) return null;
    const groups = groupByDiscontinuity(segments);
    if (groups.length <= 1) return null;
    
    const analysisResults = analyzeGroups(groups);
    const adGroups = analysisResults.filter(r => r.type === 'strong_ad');
    const adDuration = adGroups.reduce((sum, r) => sum + r.group.reduce((s, seg) => s + seg.duration, 0), 0);
    
    if (adGroups.length === 0) return content;
    
    const originalDuration = segments.reduce((sum, s) => sum + s.duration, 0);
    if (adDuration > originalDuration * 0.5) return content;
    
    showToast('已过滤 ' + formatDuration(adDuration) + ' 广告');
    return rebuildPlaylist(content, analysisResults);
}

function processPlaylist(url, content) {
    if (!pluginEnabled) return content;
    if (playlistCache.has(url)) return playlistCache.get(url);
    const result = processPlaylistCore(url, content) || content;
    playlistCache.set(url, result);
    return result;
}

const originalFetch = window.fetch;
window.fetch = async function(...args) {
    const url = typeof args[0] === 'string' ? args[0] : args[0]?.url;
    const isM3u8 = url && (url.includes('.m3u8') || url.includes('/hls/'));
    const response = await originalFetch.apply(this, args);
    if (isM3u8) {
        try {
            const clonedResponse = response.clone();
            const text = await clonedResponse.text();
            if (text.includes('#EXTINF:')) {
                const filteredText = processPlaylist(url, text);
                return new Response(filteredText, { status: response.status, statusText: response.statusText, headers: response.headers });
            }
        } catch (e) {}
    }
    return response;
};

const origResponseText = Response.prototype.text;
Response.prototype.text = async function() {
    const text = await origResponseText.call(this);
    const url = this.url || '';
    if (url.includes('.m3u8') || url.includes('/hls/')) {
        if (text.includes('#EXTINF:')) return processPlaylist(url, text);
    }
    return text;
};

const xhrProto = XMLHttpRequest.prototype;
const origOpen = xhrProto.open;
const xhrDataMap = new WeakMap();

xhrProto.open = function(method, url, ...rest) {
    const isM3u8 = url && (String(url).includes('.m3u8') || String(url).includes('/hls/'));
    xhrDataMap.set(this, { url: String(url), isM3u8, processed: null });
    return origOpen.call(this, method, url, ...rest);
};

const responseTextDesc = Object.getOwnPropertyDescriptor(xhrProto, 'responseText') || Object.getOwnPropertyDescriptor(XMLHttpRequest.prototype, 'responseText');
if (responseTextDesc && responseTextDesc.get) {
    const origGetter = responseTextDesc.get;
    Object.defineProperty(xhrProto, 'responseText', {
        get: function() {
            const data = xhrDataMap.get(this);
            if (data?.processed !== null) return data.processed;
            const text = origGetter.call(this);
            if (data?.isM3u8 && text && text.includes('#EXTINF:')) {
                data.processed = processPlaylist(data.url, text);
                return data.processed;
            }
            return text;
        },
        configurable: true
    });
}

const responseDesc = Object.getOwnPropertyDescriptor(xhrProto, 'response') || Object.getOwnPropertyDescriptor(XMLHttpRequest.prototype, 'response');
if (responseDesc && responseDesc.get) {
    const origResponseGetter = responseDesc.get;
    Object.defineProperty(xhrProto, 'response', {
        get: function() {
            const data = xhrDataMap.get(this);
            if (data?.processed !== null && (this.responseType === '' || this.responseType === 'text')) return data.processed;
            const resp = origResponseGetter.call(this);
            if (data?.isM3u8 && typeof resp === 'string' && resp.includes('#EXTINF:')) {
                data.processed = processPlaylist(data.url, resp);
                return data.processed;
            }
            return resp;
        },
        configurable: true
    });
}

Object.defineProperty(window, 'Hls', {
    get() { return this.__AdFilter_Hls; },
    set(value) {
        if (!value) { this.__AdFilter_Hls = value; return; }
        const OriginalHls = value;
        const ProxiedHls = function(config = {}) {
            const UserLoader = config.loader || OriginalHls.DefaultConfig?.loader;
            if (UserLoader) {
                config.loader = class AdFilterLoader extends UserLoader {
                    load(context, loaderConfig, callbacks) {
                        const originalOnSuccess = callbacks.onSuccess;
                        callbacks.onSuccess = (response, stats, ctx) => {
                            const url = response.url || context.url;
                            const data = response.data;
                            if (data && typeof data === 'string' && data.includes('#EXTINF:')) {
                                response.data = processPlaylist(url, data);
                            }
                            originalOnSuccess(response, stats, ctx);
                        };
                        super.load(context, loaderConfig, callbacks);
                    }
                };
            }
            return new OriginalHls(config);
        };
        Object.keys(OriginalHls).forEach(key => { ProxiedHls[key] = OriginalHls[key]; });
        Object.getOwnPropertyNames(OriginalHls).forEach(key => { if (!(key in ProxiedHls)) { try { ProxiedHls[key] = OriginalHls[key]; } catch (e) {} } });
        ProxiedHls.prototype = OriginalHls.prototype;
        this.__AdFilter_Hls = ProxiedHls;
    },
    configurable: true
});

function isM3u8Url(url) {
    if (!url) return false;
    const urlLower = url.toLowerCase();
    return urlLower.includes('.m3u8') || urlLower.includes('/hls/');
}

async function handleVideoM3u8(video, m3u8Url) {
    if (video.__adfilter_lastUrl === m3u8Url) return;
    video.__adfilter_lastUrl = m3u8Url;
    
    try {
        const response = await originalFetch(m3u8Url);
        let text = await response.text();
        
        if (text.includes('#EXT-X-STREAM-INF')) {
            const lines = text.split('\n');
            for (let i = 0; i < lines.length; i++) {
                const line = lines[i].trim();
                if (line && !line.startsWith('#')) {
                    const variantUrl = new URL(line, m3u8Url).href;
                    const variantResp = await originalFetch(variantUrl);
                    text = await variantResp.text();
                    break;
                }
            }
        }
        
        if (text.includes('#EXTINF:')) {
            const filteredText = processPlaylist(m3u8Url, text);
            const baseUrl = m3u8Url.substring(0, m3u8Url.lastIndexOf('/') + 1);
            const absoluteText = filteredText.replace(/^([^#\n][^\n]*\.ts[^\n]*)$/gm, (match) => {
                if (match.startsWith('http')) return match;
                return new URL(match.trim(), baseUrl).href;
            });
            
            const blob = new Blob([absoluteText], { type: 'application/vnd.apple.mpegurl' });
            const blobUrl = URL.createObjectURL(blob);
            
            video.__adfilter_lastUrl = blobUrl;
            originalSrcDescriptor.set.call(video, blobUrl);
            return;
        }
    } catch (e) {}
    
    originalSrcDescriptor.set.call(video, m3u8Url);
}

const videoProto = HTMLVideoElement.prototype;
const originalSrcDescriptor = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'src') ||
                               Object.getOwnPropertyDescriptor(videoProto, 'src');

if (originalSrcDescriptor) {
    Object.defineProperty(videoProto, 'src', {
        get: originalSrcDescriptor.get,
        set: function(value) {
            if (this.__adfilter_lastUrl === value) return originalSrcDescriptor.set.call(this, value);
            if (isM3u8Url(value)) { handleVideoM3u8(this, value); return; }
            return originalSrcDescriptor.set.call(this, value);
        },
        configurable: true
    });
}

const origSetAttribute = Element.prototype.setAttribute;
Element.prototype.setAttribute = function(name, value) {
    if (this.tagName === 'VIDEO' && name === 'src' && isM3u8Url(value) && this.__adfilter_lastUrl !== value) {
        handleVideoM3u8(this, value);
        return;
    }
    return origSetAttribute.call(this, name, value);
};

function setupVideoObserver() {
    const checkVideo = (video) => {
        if (video.__adfilter_observed) return;
        video.__adfilter_observed = true;
        const src = video.src || video.getAttribute('src');
        if (isM3u8Url(src) && video.__adfilter_lastUrl !== src) handleVideoM3u8(video, src);
    };
    
    document.querySelectorAll('video').forEach(checkVideo);
    
    const observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
            for (const node of mutation.addedNodes) {
                if (node.nodeType === Node.ELEMENT_NODE) {
                    if (node.tagName === 'VIDEO') checkVideo(node);
                    node.querySelectorAll?.('video').forEach(checkVideo);
                }
            }
        }
    });
    
    observer.observe(document.documentElement, { childList: true, subtree: true });
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setupVideoObserver);
} else {
    setupVideoObserver();
}

})();