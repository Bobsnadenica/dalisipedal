(function initPedalReactions(global) {
    const CONFIG = Object.freeze({
        graphqlEndpoint: 'https://5otrnlraozcdni6ekx27cy5exe.appsync-api.eu-central-1.amazonaws.com/graphql',
        snapshotUrl: 'data/media-reaction-summaries.json',
        cacheTtlMs: 2 * 60 * 1000,
        snapshotStorageKey: 'pedal_reaction_snapshot_v1',
        snapshotStorageTtlMs: 26 * 60 * 60 * 1000,
    });
    const DEBUG_PREFIX = '[PEDAL reactions]';

    const GET_MEDIA_REACTION_SUMMARY_QUERY = `
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

    const SET_MEDIA_REACTION_MUTATION = `
        mutation SetMediaReaction($mediaKey: String!, $value: MediaReactionValue!) {
            setMediaReaction(mediaKey: $mediaKey, value: $value) {
                mediaKey
                likes
                dislikes
                viewerReaction
                updatedAt
            }
        }
    `;

    const CLEAR_MEDIA_REACTION_MUTATION = `
        mutation ClearMediaReaction($mediaKey: String!) {
            clearMediaReaction(mediaKey: $mediaKey) {
                mediaKey
                likes
                dislikes
                viewerReaction
                updatedAt
            }
        }
    `;

    const reactionSummaryCache = new Map();
    const snapshotState = {
        map: new Map(),
        generatedAt: '',
        loadedAt: 0,
        promise: null,
    };

    function logDebug(message, details = {}) {
        console.info(`${DEBUG_PREFIX} ${message}`, details);
    }

    function logError(message, details = {}) {
        console.error(`${DEBUG_PREFIX} ${message}`, details);
    }

    function normalizeMediaKey(value) {
        if (global.PedalComments?.normalizeMediaKey) {
            return global.PedalComments.normalizeMediaKey(value);
        }

        const trimmed = String(value || '').trim();
        if (!trimmed) {
            return '';
        }

        if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
            const parsed = new URL(trimmed);
            const path = parsed.pathname.startsWith('/')
                ? parsed.pathname.slice(1)
                : parsed.pathname;
            return decodeURIComponent(path);
        }

        const pathOnly = trimmed.startsWith('/') ? trimmed.slice(1) : trimmed;
        return decodeURIComponent(pathOnly);
    }

    function parseCount(value) {
        const parsed = Number.parseInt(value, 10);
        return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
    }

    function createEmptySummary(mediaKey = '') {
        const normalizedMediaKey = normalizeMediaKey(mediaKey);
        return {
            mediaKey: normalizedMediaKey,
            likes: 0,
            dislikes: 0,
            viewerReaction: null,
            updatedAt: '',
        };
    }

    function normalizeViewerReaction(value) {
        return value === 'LIKE' || value === 'DISLIKE' ? value : null;
    }

    function normalizeSummary(payload, fallbackMediaKey = '') {
        if (!payload || typeof payload !== 'object') {
            return createEmptySummary(fallbackMediaKey);
        }

        return {
            mediaKey: normalizeMediaKey(payload.mediaKey || fallbackMediaKey),
            likes: parseCount(payload.likes),
            dislikes: parseCount(payload.dislikes),
            viewerReaction: normalizeViewerReaction(payload.viewerReaction),
            updatedAt: String(payload.updatedAt || ''),
        };
    }

    function getAuthState() {
        return global.PedalAuth?.getAuthState?.() || null;
    }

    function getAuthorizationToken() {
        return global.PedalAuth?.getAuthorizationToken?.() || '';
    }

    function readSnapshotCache() {
        try {
            const raw = global.localStorage?.getItem(CONFIG.snapshotStorageKey);
            if (!raw) {
                return null;
            }

            const parsed = JSON.parse(raw);
            const ageMs = Date.now() - Number(parsed.cachedAt || 0);
            if (!parsed || typeof parsed !== 'object' || ageMs >= CONFIG.snapshotStorageTtlMs) {
                return null;
            }

            return parsed;
        } catch (_) {
            return null;
        }
    }

    function writeSnapshotCache(payload) {
        try {
            global.localStorage?.setItem(
                CONFIG.snapshotStorageKey,
                JSON.stringify({
                    generatedAt: payload.generatedAt || '',
                    items: Array.isArray(payload.items) ? payload.items : [],
                    cachedAt: Date.now(),
                })
            );
        } catch (_) {
            // Ignore cache write failures.
        }
    }

    function applySnapshotPayload(payload) {
        const items = Array.isArray(payload?.items) ? payload.items : [];
        const map = new Map();

        items.forEach(item => {
            const summary = normalizeSummary(item, item?.mediaKey || '');
            if (!summary.mediaKey) {
                return;
            }

            map.set(summary.mediaKey, {
                ...summary,
                viewerReaction: null,
            });
        });

        snapshotState.map = map;
        snapshotState.generatedAt = String(payload?.generatedAt || '');
        snapshotState.loadedAt = Date.now();
    }

    async function loadReactionSnapshot(options = {}) {
        const forceRefresh = Boolean(options.forceRefresh);
        const hasFreshInMemorySnapshot =
            !forceRefresh
            && snapshotState.map.size
            && (Date.now() - snapshotState.loadedAt) < CONFIG.snapshotStorageTtlMs;

        if (hasFreshInMemorySnapshot) {
            return snapshotState.map;
        }

        if (!forceRefresh) {
            const cached = readSnapshotCache();
            if (cached) {
                applySnapshotPayload(cached);
                return snapshotState.map;
            }
        }

        if (!forceRefresh && snapshotState.promise) {
            await snapshotState.promise;
            return snapshotState.map;
        }

        snapshotState.promise = (async () => {
            logDebug('Loading public reaction snapshot.', {
                snapshotUrl: CONFIG.snapshotUrl,
            });

            const response = await fetch(CONFIG.snapshotUrl, {
                cache: 'no-store',
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            const payload = await response.json();
            applySnapshotPayload(payload);
            writeSnapshotCache(payload);
        })();

        try {
            await snapshotState.promise;
        } finally {
            snapshotState.promise = null;
        }

        return snapshotState.map;
    }

    async function graphQlRequest(document, variables, context = {}) {
        const headers = {
            'content-type': 'application/json',
        };

        if (context.authMode === 'userPool') {
            if (!context.authorizationToken) {
                throw new Error('Липсва активна потребителска сесия.');
            }
            headers.Authorization = context.authorizationToken;
        } else {
            throw new Error('Public reaction GraphQL reads are disabled in the browser.');
        }

        const requestDetails = {
            endpoint: CONFIG.graphqlEndpoint,
            authMode: context.authMode || 'userPool',
            hasAuthorizationHeader: Boolean(headers.Authorization),
            mediaKey: context.mediaKey || null,
        };

        logDebug('Sending GraphQL request.', requestDetails);

        let response;
        try {
            response = await fetch(CONFIG.graphqlEndpoint, {
                method: 'POST',
                mode: 'cors',
                credentials: 'omit',
                cache: 'no-store',
                headers,
                body: JSON.stringify({
                    query: document,
                    variables,
                }),
            });
        } catch (error) {
            logError('Network request failed before GraphQL response.', {
                ...requestDetails,
                error,
            });
            throw error;
        }

        let payload = null;
        try {
            payload = await response.json();
        } catch (error) {
            logError('Failed to parse GraphQL response body.', {
                ...requestDetails,
                httpStatus: response.status,
                error,
            });
            throw error;
        }

        if (!response.ok || (Array.isArray(payload.errors) && payload.errors.length)) {
            logError('GraphQL request failed.', {
                ...requestDetails,
                httpStatus: response.status,
                graphQlErrors: payload.errors || null,
            });

            const error = new Error(
                payload.errors?.map(item => item?.message).filter(Boolean).join(' | ')
                || `HTTP ${response.status}`
            );
            error.graphQlErrors = payload.errors || null;
            error.httpStatus = response.status;
            throw error;
        }

        return payload.data || {};
    }

    function getCachedReactionSummary(mediaKey) {
        const normalizedMediaKey = normalizeMediaKey(mediaKey);
        if (!normalizedMediaKey) {
            return null;
        }

        const cached = reactionSummaryCache.get(normalizedMediaKey);
        if (!cached) {
            return null;
        }

        if ((Date.now() - cached.cachedAt) >= CONFIG.cacheTtlMs) {
            reactionSummaryCache.delete(normalizedMediaKey);
            return null;
        }

        return cached.summary;
    }

    function storeReactionSummary(summary) {
        const normalizedSummary = normalizeSummary(summary, summary?.mediaKey || '');
        reactionSummaryCache.set(normalizedSummary.mediaKey, {
            summary: normalizedSummary,
            cachedAt: Date.now(),
        });
        return normalizedSummary;
    }

    function clearReactionCache(mediaKey) {
        if (!mediaKey) {
            reactionSummaryCache.clear();
            return;
        }

        reactionSummaryCache.delete(normalizeMediaKey(mediaKey));
    }

    async function getSnapshotSummary(mediaKey, options = {}) {
        const normalizedMediaKey = normalizeMediaKey(mediaKey);
        if (!normalizedMediaKey) {
            return createEmptySummary('');
        }

        try {
            const snapshotMap = await loadReactionSnapshot({
                forceRefresh: Boolean(options.forceRefresh),
            });

            return normalizeSummary(
                snapshotMap.get(normalizedMediaKey) || createEmptySummary(normalizedMediaKey),
                normalizedMediaKey
            );
        } catch (error) {
            logError('Failed to load reaction snapshot.', {
                mediaKey: normalizedMediaKey,
                error,
            });
            return createEmptySummary(normalizedMediaKey);
        }
    }

    async function getReactionSummary(mediaKey, options = {}) {
        const normalizedMediaKey = normalizeMediaKey(mediaKey);
        if (!normalizedMediaKey) {
            return createEmptySummary('');
        }

        const forceRefresh = Boolean(options.forceRefresh);
        const cached = getCachedReactionSummary(normalizedMediaKey);
        if (!forceRefresh && cached) {
            return cached;
        }

        const authState = getAuthState();
        const authorizationToken = getAuthorizationToken();
        const canUseLiveUserPool = Boolean(authState?.isLoggedIn && authorizationToken);

        if (!canUseLiveUserPool) {
            const snapshotSummary = await getSnapshotSummary(normalizedMediaKey, {
                forceRefresh,
            });
            return storeReactionSummary(snapshotSummary);
        }

        try {
            const data = await graphQlRequest(GET_MEDIA_REACTION_SUMMARY_QUERY, {
                mediaKey: normalizedMediaKey,
            }, {
                authMode: 'userPool',
                authorizationToken,
                mediaKey: normalizedMediaKey,
            });

            return storeReactionSummary(
                normalizeSummary(data.getMediaReactionSummary, normalizedMediaKey)
            );
        } catch (error) {
            logDebug('Live user reaction read failed; falling back to static snapshot counts.', {
                mediaKey: normalizedMediaKey,
                error: error?.message || String(error),
            });

            const snapshotSummary = await getSnapshotSummary(normalizedMediaKey, {
                forceRefresh,
            });

            return storeReactionSummary({
                ...snapshotSummary,
                viewerReaction: null,
            });
        }
    }

    async function setReaction(mediaKey, value) {
        const normalizedMediaKey = normalizeMediaKey(mediaKey);
        if (!normalizedMediaKey) {
            throw new Error('Липсва валиден media key.');
        }

        const wireValue = value === 'DISLIKE' ? 'DISLIKE' : 'LIKE';
        const authorizationToken = getAuthorizationToken();
        if (!authorizationToken) {
            throw new Error('Трябва да сте влезли в профила си.');
        }

        const data = await graphQlRequest(SET_MEDIA_REACTION_MUTATION, {
            mediaKey: normalizedMediaKey,
            value: wireValue,
        }, {
            authMode: 'userPool',
            authorizationToken,
            mediaKey: normalizedMediaKey,
        });

        return storeReactionSummary(
            normalizeSummary(data.setMediaReaction, normalizedMediaKey)
        );
    }

    async function clearReaction(mediaKey) {
        const normalizedMediaKey = normalizeMediaKey(mediaKey);
        if (!normalizedMediaKey) {
            throw new Error('Липсва валиден media key.');
        }

        const authorizationToken = getAuthorizationToken();
        if (!authorizationToken) {
            throw new Error('Трябва да сте влезли в профила си.');
        }

        const data = await graphQlRequest(CLEAR_MEDIA_REACTION_MUTATION, {
            mediaKey: normalizedMediaKey,
        }, {
            authMode: 'userPool',
            authorizationToken,
            mediaKey: normalizedMediaKey,
        });

        return storeReactionSummary(
            normalizeSummary(data.clearMediaReaction, normalizedMediaKey)
        );
    }

    global.PedalReactions = {
        normalizeMediaKey,
        createEmptySummary,
        getReactionSummary,
        setReaction,
        clearReaction,
        clearReactionCache,
        getCachedReactionSummary,
        loadReactionSnapshot,
    };
})(window);
