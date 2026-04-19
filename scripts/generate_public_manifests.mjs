#!/usr/bin/env node

import { createHash, createHmac } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const siteRoot = path.resolve(__dirname, '..');
const dataDir = path.resolve(siteRoot, 'data');
const galleryManifestPath = path.resolve(dataDir, 'gallery-manifest.json');
const ninjaManifestPath = path.resolve(dataDir, 'ninja-manifest.json');
const reactionSummariesPath = path.resolve(dataDir, 'media-reaction-summaries.json');
const geocodeCachePath = path.resolve(__dirname, 'location-cache.json');
const localAppConfigPath = path.resolve(siteRoot, '../pedal/lib/amplifyconfiguration.dart');

const CLOUD_FRONT_BASE_URL = 'https://d3g9kruk81dvbk.cloudfront.net';
const AWS_REGION = process.env.PEDAL_AWS_REGION || 'eu-central-1';
const GALLERY_LIMIT = 600;
const NINJA_LIMIT = 50;
const FEATURED_MONTH_PREFIX = 'pedal_of_the_month/';
const FEATURED_WEEK_PREFIX = 'pedal_of_the_month/pedal_of_the_day/';
const GEOCODE_DELAY_MS = 1100;
const MANIFEST_VERSION = 1;
const REACTION_FETCH_CONCURRENCY = 12;
const APP_USER_AGENT =
    process.env.PEDAL_MANIFEST_USER_AGENT ||
    'dalisipedal-manifest-generator/1.0 (+https://www.dalisipedal.com)';

let nextGeocodeAt = 0;

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function hashHex(value) {
    return createHash('sha256').update(value).digest('hex');
}

function hmac(key, value, encoding) {
    return createHmac('sha256', key).update(value).digest(encoding);
}

function formatAmzDate(date) {
    return date.toISOString().replace(/[:-]|\.\d{3}/g, '');
}

function formatDateStamp(date) {
    return formatAmzDate(date).slice(0, 8);
}

function awsEncode(value) {
    return encodeURIComponent(String(value)).replace(/[!'()*]/g, char =>
        `%${char.charCodeAt(0).toString(16).toUpperCase()}`
    );
}

function encodeCloudFrontKey(key) {
    return key
        .split('/')
        .map(segment => encodeURIComponent(segment))
        .join('/');
}

function decodeXml(value) {
    return value
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'");
}

function parseXmlTag(xml, tagName) {
    const match = xml.match(new RegExp(`<${tagName}>([\\s\\S]*?)</${tagName}>`));
    return match ? decodeXml(match[1]) : '';
}

function parseS3ListXml(xml) {
    const contents = [];
    const contentsRegex = /<Contents>([\s\S]*?)<\/Contents>/g;

    for (const match of xml.matchAll(contentsRegex)) {
        const block = match[1];
        const rawKey = parseXmlTag(block, 'Key');
        const key = rawKey ? decodeURIComponent(rawKey) : '';

        if (!key) {
            continue;
        }

        contents.push({
            Key: key,
            LastModified: parseXmlTag(block, 'LastModified'),
            Size: Number(parseXmlTag(block, 'Size') || 0),
        });
    }

    return {
        isTruncated: parseXmlTag(xml, 'IsTruncated') === 'true',
        nextContinuationToken: parseXmlTag(xml, 'NextContinuationToken'),
        contents,
    };
}

function collapseWhitespace(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
}

function isCoordinateLocation(value) {
    return /^\s*-?\d+(?:\.\d+)?\s*,\s*-?\d+(?:\.\d+)?\s*$/.test(value);
}

function formatLocationFromResponse(payload) {
    const address = payload.address || {};
    const street = [address.road || address.pedestrian || address.footway || address.path || address.residential || address.cycleway, address.house_number]
        .filter(Boolean)
        .join(' ')
        .trim();
    const area = address.neighbourhood || address.suburb || address.city_district || address.quarter || address.borough;
    const city = address.city || address.town || address.village || address.hamlet || address.municipality;

    const parts = [street, area, city].filter(Boolean);
    const uniqueParts = [...new Set(parts)];

    if (uniqueParts.length) {
        return uniqueParts.join(', ');
    }

    const displayParts = collapseWhitespace(payload.display_name)
        .split(',')
        .map(part => collapseWhitespace(part))
        .filter(Boolean);

    return displayParts.slice(0, 3).join(', ');
}

async function loadJsonFile(filePath, fallback) {
    try {
        const raw = await readFile(filePath, 'utf8');
        return JSON.parse(raw);
    } catch (_) {
        return fallback;
    }
}

async function saveJsonFile(filePath, value) {
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function loadConfig() {
    const envConfig = {
        PEDAL_APPSYNC_ENDPOINT: process.env.PEDAL_APPSYNC_ENDPOINT,
        PEDAL_APPSYNC_API_KEY: process.env.PEDAL_APPSYNC_API_KEY,
        PEDAL_COGNITO_IDENTITY_POOL_ID: process.env.PEDAL_COGNITO_IDENTITY_POOL_ID,
        PEDAL_S3_BUCKET: process.env.PEDAL_S3_BUCKET,
    };
    const envEntries = Object.entries(envConfig);
    const missingEnvKeys = envEntries
        .filter(([, value]) => !value)
        .map(([key]) => key);

    if (missingEnvKeys.length === 0) {
        return {
            appsyncEndpoint: envConfig.PEDAL_APPSYNC_ENDPOINT,
            appsyncApiKey: envConfig.PEDAL_APPSYNC_API_KEY,
            identityPoolId: envConfig.PEDAL_COGNITO_IDENTITY_POOL_ID,
            bucketName: envConfig.PEDAL_S3_BUCKET,
        };
    }

    const hasPartialEnvConfig = missingEnvKeys.length !== envEntries.length;
    if (hasPartialEnvConfig) {
        throw new Error(
            `Missing manifest config: ${missingEnvKeys.join(', ')}. ` +
            'In GitHub Actions, add these as repository secrets in the website repo before running the workflow.'
        );
    }

    let source;
    try {
        source = await readFile(localAppConfigPath, 'utf8');
    } catch (error) {
        throw new Error(
            'Missing manifest config. ' +
            'This website repo does not contain Amplify config by itself, so CI must provide these repository secrets: ' +
            `${envEntries.map(([key]) => key).join(', ')}. ` +
            `Local fallback also failed because ${localAppConfigPath} was not found.`
        );
    }

    const match = source.match(/const amplifyconfig = '''([\s\S]*?)''';/);

    if (!match) {
        throw new Error(
            `Не успях да прочета amplifyconfiguration.dart от ${localAppConfigPath}.`
        );
    }

    const config = JSON.parse(match[1]);

    return {
        appsyncEndpoint: config.api.plugins.awsAPIPlugin.pedal.endpoint,
        appsyncApiKey: config.api.plugins.awsAPIPlugin.pedal.apiKey,
        identityPoolId:
            config.auth.plugins.awsCognitoAuthPlugin.CredentialsProvider.CognitoIdentity.Default.PoolId,
        bucketName: config.storage.plugins.awsS3StoragePlugin.bucket,
    };
}

async function fetchGraphQlPage({ endpoint, apiKey, nextToken }) {
    const query = `
        query ListPhotoMetadata($limit: Int!, $nextToken: String) {
            listPhotoMetadata(limit: $limit, nextToken: $nextToken) {
                items {
                    region
                    plate
                    file
                    location
                    latitude
                    longitude
                    timestamp
                }
                nextToken
            }
        }
    `;

    const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            'x-api-key': apiKey,
        },
        body: JSON.stringify({
            query,
            variables: {
                limit: 1000,
                nextToken,
            },
        }),
    });

    if (!response.ok) {
        throw new Error(`AppSync error: HTTP ${response.status}`);
    }

    const payload = await response.json();
    if (payload.errors?.length) {
        throw new Error(payload.errors[0].message || 'AppSync GraphQL error');
    }

    return payload.data.listPhotoMetadata;
}

async function fetchReactionSummary({ endpoint, apiKey, mediaKey }) {
    const query = `
        query GetMediaReactionSummary($mediaKey: String!) {
            getMediaReactionSummary(mediaKey: $mediaKey) {
                mediaKey
                likes
                dislikes
                viewerReaction
                updatedAt
            }
        }
    `;

    const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            'x-api-key': apiKey,
        },
        body: JSON.stringify({
            query,
            variables: {
                mediaKey,
            },
        }),
    });

    if (!response.ok) {
        throw new Error(`Reaction summary AppSync error: HTTP ${response.status}`);
    }

    const payload = await response.json();
    if (payload.errors?.length) {
        throw new Error(payload.errors[0].message || 'Reaction GraphQL error');
    }

    return payload.data.getMediaReactionSummary || null;
}

async function mapWithConcurrency(items, concurrency, mapper) {
    const results = new Array(items.length);
    let nextIndex = 0;

    const workers = Array.from(
        { length: Math.max(1, Math.min(concurrency, items.length || 1)) },
        async () => {
            while (nextIndex < items.length) {
                const currentIndex = nextIndex;
                nextIndex += 1;
                results[currentIndex] = await mapper(items[currentIndex], currentIndex);
            }
        }
    );

    await Promise.all(workers);
    return results;
}

async function fetchAllPhotoMetadata(config) {
    const items = [];
    let nextToken = null;

    do {
        const page = await fetchGraphQlPage({
            endpoint: config.appsyncEndpoint,
            apiKey: config.appsyncApiKey,
            nextToken,
        });

        items.push(...(page.items || []));
        nextToken = page.nextToken || null;
    } while (nextToken);

    return items;
}

async function reverseGeocode({ latitude, longitude, cache }) {
    const lat = Number(latitude);
    const lon = Number(longitude);

    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
        return '';
    }

    const cacheKey = `${lat.toFixed(5)},${lon.toFixed(5)}`;
    if (cache[cacheKey]) {
        return cache[cacheKey];
    }

    const now = Date.now();
    if (now < nextGeocodeAt) {
        await sleep(nextGeocodeAt - now);
    }

    const url = new URL('https://nominatim.openstreetmap.org/reverse');
    url.searchParams.set('format', 'jsonv2');
    url.searchParams.set('lat', String(lat));
    url.searchParams.set('lon', String(lon));
    url.searchParams.set('zoom', '18');
    url.searchParams.set('addressdetails', '1');
    url.searchParams.set('accept-language', 'bg');

    nextGeocodeAt = Date.now() + GEOCODE_DELAY_MS;

    const response = await fetch(url, {
        headers: {
            'user-agent': APP_USER_AGENT,
            'accept-language': 'bg',
        },
    });

    if (!response.ok) {
        throw new Error(`Geocode error: HTTP ${response.status}`);
    }

    const payload = await response.json();
    const label = collapseWhitespace(formatLocationFromResponse(payload));
    const fallback = `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
    const resolved = label || fallback;

    cache[cacheKey] = resolved;
    return resolved;
}

function isSupportedGalleryFile(fileName) {
    return /\.(jpg|jpeg|png|webp|mp4|mov|m4v|webm)$/i.test(fileName);
}

function isSupportedNinjaFile(fileName) {
    return /\.(jpg|jpeg|png|webp)$/i.test(fileName);
}

function isSupportedFeaturedFile(fileName) {
    return /\.(jpg|jpeg|png|webp|mp4|mov|m4v|webm)$/i.test(fileName);
}

async function buildGalleryManifest(config, geocodeCache, featured = null) {
    const rawItems = await fetchAllPhotoMetadata(config);
    const unique = new Map();
    let processedCoords = 0;

    for (const item of rawItems) {
        if (!item?.region || !item.plate || !item.file || !isSupportedGalleryFile(item.file)) {
            continue;
        }

        const key = `approved/${item.region}/${item.plate}/${item.file}`;
        if (unique.has(key)) {
            continue;
        }

        const rawLocation = collapseWhitespace(item.location);
        let locationLabel = rawLocation;

        if (isCoordinateLocation(rawLocation)) {
            processedCoords += 1;
            try {
                locationLabel = await reverseGeocode({
                    latitude: item.latitude,
                    longitude: item.longitude,
                    cache: geocodeCache,
                });
            } catch (_) {
                locationLabel = rawLocation;
            }

            if (processedCoords % 25 === 0) {
                console.log(`Geocoded ${processedCoords} coordinate-only gallery items...`);
                await saveJsonFile(geocodeCachePath, geocodeCache);
            }
        }

        unique.set(key, {
            key,
            url: `${CLOUD_FRONT_BASE_URL}/${encodeCloudFrontKey(key)}`,
            timestamp: item.timestamp,
            location: rawLocation,
            locationLabel: collapseWhitespace(locationLabel),
            latitude: Number.isFinite(Number(item.latitude)) ? Number(item.latitude) : null,
            longitude: Number.isFinite(Number(item.longitude)) ? Number(item.longitude) : null,
            isVideo: /\.(mp4|mov|m4v|webm)$/i.test(item.file),
        });
    }

    const items = [...unique.values()]
        .sort((left, right) => new Date(right.timestamp) - new Date(left.timestamp))
        .slice(0, GALLERY_LIMIT);

    return {
        version: MANIFEST_VERSION,
        generatedAt: new Date().toISOString(),
        itemCount: items.length,
        featured: featured || {
            week: null,
            month: null,
        },
        items,
    };
}

async function getGuestCredentials(identityPoolId) {
    const serviceUrl = `https://cognito-identity.${AWS_REGION}.amazonaws.com/`;

    const getIdResponse = await fetch(serviceUrl, {
        method: 'POST',
        headers: {
            'content-type': 'application/x-amz-json-1.1',
            'x-amz-target': 'AWSCognitoIdentityService.GetId',
        },
        body: JSON.stringify({
            IdentityPoolId: identityPoolId,
        }),
    });

    if (!getIdResponse.ok) {
        throw new Error(`GetId failed: HTTP ${getIdResponse.status}`);
    }

    const { IdentityId } = await getIdResponse.json();
    if (!IdentityId) {
        throw new Error('GetId failed: no IdentityId returned.');
    }

    const credentialsResponse = await fetch(serviceUrl, {
        method: 'POST',
        headers: {
            'content-type': 'application/x-amz-json-1.1',
            'x-amz-target': 'AWSCognitoIdentityService.GetCredentialsForIdentity',
        },
        body: JSON.stringify({
            IdentityId,
        }),
    });

    if (!credentialsResponse.ok) {
        throw new Error(`GetCredentialsForIdentity failed: HTTP ${credentialsResponse.status}`);
    }

    const payload = await credentialsResponse.json();
    if (!payload.Credentials) {
        throw new Error('GetCredentialsForIdentity failed: no credentials returned.');
    }

    return payload.Credentials;
}

function getSigningKey(secretKey, dateStamp, region, service) {
    const kDate = hmac(`AWS4${secretKey}`, dateStamp);
    const kRegion = hmac(kDate, region);
    const kService = hmac(kRegion, service);
    return hmac(kService, 'aws4_request');
}

async function listS3Objects({ bucketName, credentials, prefix, continuationToken }) {
    const host = `${bucketName}.s3.${AWS_REGION}.amazonaws.com`;
    const now = new Date();
    const amzDate = formatAmzDate(now);
    const dateStamp = formatDateStamp(now);
    const payloadHash = hashHex('');
    const method = 'GET';
    const canonicalUri = '/';

    const queryEntries = [
        ['encoding-type', 'url'],
        ['list-type', '2'],
        ['max-keys', '1000'],
        ['prefix', prefix],
    ];

    if (continuationToken) {
        queryEntries.push(['continuation-token', continuationToken]);
    }

    const canonicalQueryString = queryEntries
        .sort((left, right) => left[0].localeCompare(right[0]) || left[1].localeCompare(right[1]))
        .map(([key, value]) => `${awsEncode(key)}=${awsEncode(value)}`)
        .join('&');

    const canonicalHeaders =
        `host:${host}\n` +
        `x-amz-content-sha256:${payloadHash}\n` +
        `x-amz-date:${amzDate}\n` +
        `x-amz-security-token:${credentials.SessionToken}\n`;
    const signedHeaders = 'host;x-amz-content-sha256;x-amz-date;x-amz-security-token';

    const canonicalRequest = [
        method,
        canonicalUri,
        canonicalQueryString,
        canonicalHeaders,
        signedHeaders,
        payloadHash,
    ].join('\n');

    const credentialScope = `${dateStamp}/${AWS_REGION}/s3/aws4_request`;
    const stringToSign = [
        'AWS4-HMAC-SHA256',
        amzDate,
        credentialScope,
        hashHex(canonicalRequest),
    ].join('\n');

    const signingKey = getSigningKey(
        credentials.SecretKey,
        dateStamp,
        AWS_REGION,
        's3'
    );

    const signature = hmac(signingKey, stringToSign, 'hex');
    const authorization =
        `AWS4-HMAC-SHA256 Credential=${credentials.AccessKeyId}/${credentialScope}, ` +
        `SignedHeaders=${signedHeaders}, Signature=${signature}`;

    const response = await fetch(`https://${host}/?${canonicalQueryString}`, {
        method,
        headers: {
            authorization,
            'x-amz-content-sha256': payloadHash,
            'x-amz-date': amzDate,
            'x-amz-security-token': credentials.SessionToken,
        },
    });

    if (!response.ok) {
        throw new Error(`S3 list failed: HTTP ${response.status}`);
    }

    return parseS3ListXml(await response.text());
}

async function listAllS3Objects({ bucketName, credentials, prefix }) {
    const objects = [];
    let continuationToken = '';
    let hasMore = true;

    while (hasMore) {
        const page = await listS3Objects({
            bucketName,
            credentials,
            prefix,
            continuationToken,
        });

        objects.push(...page.contents);
        hasMore = page.isTruncated && Boolean(page.nextContinuationToken);
        continuationToken = page.nextContinuationToken;
    }

    return objects;
}

function buildFeaturedPedalEntry(objects, { prefix, excludeSubPaths = false }) {
    const items = objects
        .filter(item => item.Key && item.Size > 0 && isSupportedFeaturedFile(item.Key))
        .filter(item => {
            if (!excludeSubPaths) {
                return true;
            }

            const relativePath = item.Key.slice(prefix.length);
            return !relativePath.includes('/');
        })
        .sort((left, right) => new Date(right.LastModified) - new Date(left.LastModified));

    if (!items.length) {
        return null;
    }

    const latest = items[0];
    return {
        key: latest.Key,
        url: `${CLOUD_FRONT_BASE_URL}/${encodeCloudFrontKey(latest.Key)}`,
        lastModified: latest.LastModified,
        isVideo: /\.(mp4|mov|m4v|webm)$/i.test(latest.Key),
    };
}

async function buildGalleryFeatured(config, credentials) {
    const [monthObjects, weekObjects] = await Promise.all([
        listAllS3Objects({
            bucketName: config.bucketName,
            credentials,
            prefix: FEATURED_MONTH_PREFIX,
        }),
        listAllS3Objects({
            bucketName: config.bucketName,
            credentials,
            prefix: FEATURED_WEEK_PREFIX,
        }),
    ]);

    return {
        week: buildFeaturedPedalEntry(weekObjects, {
            prefix: FEATURED_WEEK_PREFIX,
        }),
        month: buildFeaturedPedalEntry(monthObjects, {
            prefix: FEATURED_MONTH_PREFIX,
            excludeSubPaths: true,
        }),
    };
}

async function buildNinjaManifest(config, credentials) {
    const objects = await listAllS3Objects({
        bucketName: config.bucketName,
        credentials,
        prefix: 'approved/ninja/',
    });

    const items = objects
        .filter(item => item.Key && item.Size > 0 && isSupportedNinjaFile(item.Key))
        .sort((left, right) => new Date(right.LastModified) - new Date(left.LastModified))
        .slice(0, NINJA_LIMIT)
        .map(item => ({
            key: item.Key,
            url: `${CLOUD_FRONT_BASE_URL}/${encodeCloudFrontKey(item.Key)}`,
            lastModified: item.LastModified,
        }));

    return {
        version: MANIFEST_VERSION,
        generatedAt: new Date().toISOString(),
        itemCount: items.length,
        items,
    };
}

function collectReactionSnapshotKeys(galleryManifest, ninjaManifest) {
    const keys = new Set();

    galleryManifest.items.forEach(item => {
        if (item?.key) {
            keys.add(item.key);
        }
    });

    if (galleryManifest.featured?.week?.key) {
        keys.add(galleryManifest.featured.week.key);
    }

    if (galleryManifest.featured?.month?.key) {
        keys.add(galleryManifest.featured.month.key);
    }

    ninjaManifest.items.forEach(item => {
        if (item?.key) {
            keys.add(item.key);
        }
    });

    return [...keys];
}

async function buildReactionSummariesSnapshot(config, galleryManifest, ninjaManifest) {
    const keys = collectReactionSnapshotKeys(galleryManifest, ninjaManifest);

    const items = await mapWithConcurrency(
        keys,
        REACTION_FETCH_CONCURRENCY,
        async (mediaKey, index) => {
            if (index > 0 && index % 100 === 0) {
                console.log(`Fetched ${index} reaction summaries...`);
            }

            const payload = await fetchReactionSummary({
                endpoint: config.appsyncEndpoint,
                apiKey: config.appsyncApiKey,
                mediaKey,
            });

            return {
                mediaKey,
                likes: Number(payload?.likes || 0),
                dislikes: Number(payload?.dislikes || 0),
                updatedAt: payload?.updatedAt || null,
            };
        }
    );

    return {
        version: MANIFEST_VERSION,
        generatedAt: new Date().toISOString(),
        itemCount: items.length,
        items,
    };
}

async function main() {
    const config = await loadConfig();
    const geocodeCache = await loadJsonFile(geocodeCachePath, {});
    const guestCredentials = await getGuestCredentials(config.identityPoolId);

    console.log('Building featured PEDAL picks...');
    const galleryFeatured = await buildGalleryFeatured(config, guestCredentials);

    console.log('Building gallery manifest...');
    const galleryManifest = await buildGalleryManifest(
        config,
        geocodeCache,
        galleryFeatured
    );
    await saveJsonFile(galleryManifestPath, galleryManifest);
    await saveJsonFile(geocodeCachePath, geocodeCache);

    console.log('Building ninja manifest...');
    const ninjaManifest = await buildNinjaManifest(config, guestCredentials);
    await saveJsonFile(ninjaManifestPath, ninjaManifest);
    await saveJsonFile(geocodeCachePath, geocodeCache);

    console.log('Building reaction summaries snapshot...');
    const reactionSummaries = await buildReactionSummariesSnapshot(
        config,
        galleryManifest,
        ninjaManifest
    );
    await saveJsonFile(reactionSummariesPath, reactionSummaries);

    console.log(
        JSON.stringify(
            {
                galleryItems: galleryManifest.itemCount,
                ninjaItems: ninjaManifest.itemCount,
                reactionSummaries: reactionSummaries.itemCount,
                featuredWeek: galleryManifest.featured?.week?.key ?? null,
                featuredMonth: galleryManifest.featured?.month?.key ?? null,
                generatedAt: galleryManifest.generatedAt,
            },
            null,
            2
        )
    );
}

main().catch(error => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
});
