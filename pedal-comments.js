(function initPedalComments(global) {
    const CONFIG = Object.freeze({
        graphqlEndpoint: 'https://5otrnlraozcdni6ekx27cy5exe.appsync-api.eu-central-1.amazonaws.com/graphql',
        apiKey: 'da2-6lagph7zcvfuzicgqenbfvyyqi',
        cacheTtlMs: 2 * 60 * 1000,
        persistentCacheTtlMs: 10 * 60 * 1000,
        persistentCachePrefix: 'pedal_comment_thread_v2:',
        defaultLimit: 50,
        commentCooldownMs: 30 * 1000,
        maxCommentLength: 500,
    });
    const DEBUG_PREFIX = '[PEDAL comments]';
    const COMMENT_COOLDOWN_STORAGE_KEY = 'pedal_comment_last_post_at_v1';

    const COMMENTS_BY_MEDIA_KEY_QUERY = `
        query CommentsByMediaKey($mediaKey: String!, $limit: Int, $nextToken: String) {
            commentsByMediaKey(
                mediaKey: $mediaKey
                sortDirection: ASC
                filter: { status: { eq: ACTIVE } }
                limit: $limit
                nextToken: $nextToken
            ) {
                items {
                    id
                    mediaKey
                    userId
                    usernameSnapshot
                    content
                    status
                    createdAt
                    updatedAt
                }
                nextToken
            }
        }
    `;

    const SYNC_MEDIA_COMMENTS_QUERY = `
        query SyncMediaComments($filter: ModelMediaCommentFilterInput, $limit: Int, $nextToken: String) {
            syncMediaComments(
                filter: $filter
                limit: $limit
                nextToken: $nextToken
            ) {
                items {
                    id
                    mediaKey
                    userId
                    usernameSnapshot
                    content
                    status
                    createdAt
                    updatedAt
                }
                nextToken
            }
        }
    `;

    const POST_MEDIA_COMMENT_MUTATION = `
        mutation PostMediaComment($mediaKey: String!, $content: String!) {
            postMediaComment(mediaKey: $mediaKey, content: $content) {
                id
                mediaKey
                userId
                usernameSnapshot
                content
                status
                createdAt
                updatedAt
            }
        }
    `;

    const REMOVE_MEDIA_COMMENT_MUTATION = `
        mutation RemoveMediaComment($id: ID!) {
            removeMediaComment(id: $id)
        }
    `;

    const commentsCache = new Map();

    function logDebug(message, details = {}) {
        console.info(`${DEBUG_PREFIX} ${message}`, details);
    }

    function logError(message, details = {}) {
        console.error(`${DEBUG_PREFIX} ${message}`, details);
    }

    function isUnauthorizedError(error) {
        const message = String(error?.message || '').toLowerCase();
        return message.includes('not authorized') || message.includes('unauthorized');
    }

    function sortCommentsAscending(items) {
        return [...items].sort((left, right) => {
            const leftTime = Date.parse(left?.createdAt || '') || 0;
            const rightTime = Date.parse(right?.createdAt || '') || 0;
            return leftTime - rightTime;
        });
    }

    function normalizeMediaKey(value) {
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

    function formatCommentDate(timestamp) {
        if (!timestamp) {
            return '';
        }

        const parsed = new Date(timestamp);
        if (Number.isNaN(parsed.getTime())) {
            return '';
        }

        return new Intl.DateTimeFormat('bg-BG', {
            day: '2-digit',
            month: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
        }).format(parsed);
    }

    function getAuthState() {
        return global.PedalAuth?.getAuthState?.() || null;
    }

    function getAuthorizationToken() {
        return global.PedalAuth?.getAuthorizationToken?.() || '';
    }

    function getCommentCooldownIdentity(authState = getAuthState()) {
        if (!authState?.isLoggedIn) {
            return '';
        }

        return [
            authState.userId,
            authState.sub,
            authState.email,
            authState.loginId,
            authState.cognitoUsername,
        ]
            .map(value => String(value || '').trim())
            .find(Boolean) || '';
    }

    function readCommentCooldownMap() {
        try {
            const raw = global.localStorage?.getItem(COMMENT_COOLDOWN_STORAGE_KEY);
            if (!raw) {
                return {};
            }

            const parsed = JSON.parse(raw);
            return parsed && typeof parsed === 'object' ? parsed : {};
        } catch (_) {
            return {};
        }
    }

    function writeCommentCooldownMap(entries) {
        try {
            global.localStorage?.setItem(
                COMMENT_COOLDOWN_STORAGE_KEY,
                JSON.stringify(entries)
            );
        } catch (_) {
            // Ignore storage write failures.
        }
    }

    function getRemainingPostCooldownMs(authState = getAuthState()) {
        const identity = getCommentCooldownIdentity(authState);
        if (!identity) {
            return 0;
        }

        const cooldownMap = readCommentCooldownMap();
        const lastPostAt = Number(cooldownMap[identity] || 0);
        if (!Number.isFinite(lastPostAt) || lastPostAt <= 0) {
            return 0;
        }

        return Math.max(0, (lastPostAt + CONFIG.commentCooldownMs) - Date.now());
    }

    function rememberSuccessfulPost(authState = getAuthState()) {
        const identity = getCommentCooldownIdentity(authState);
        if (!identity) {
            return;
        }

        const cooldownMap = readCommentCooldownMap();
        cooldownMap[identity] = Date.now();
        writeCommentCooldownMap(cooldownMap);
    }

    function canDeleteComment(comment) {
        const authState = getAuthState();
        if (!authState?.isLoggedIn) {
            return false;
        }

        if (authState.isAdmin) {
            return true;
        }

        const ownerId = String(comment?.userId || '').trim();
        if (!ownerId) {
            return false;
        }

        const candidates = [
            authState.userId,
            authState.sub,
            authState.email,
            authState.loginId,
            authState.cognitoUsername,
        ]
            .map(value => String(value || '').trim())
            .filter(Boolean);

        return candidates.includes(ownerId);
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
        } else if (CONFIG.apiKey) {
            headers['x-api-key'] = CONFIG.apiKey;
        }

        const requestDetails = {
            endpoint: CONFIG.graphqlEndpoint,
            authMode: context.authMode || 'apiKey',
            hasApiKeyHeader: Boolean(headers['x-api-key']),
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

    function getPersistentCacheKey(mediaKey) {
        const normalizedMediaKey = normalizeMediaKey(mediaKey);
        return normalizedMediaKey
            ? `${CONFIG.persistentCachePrefix}${normalizedMediaKey}`
            : '';
    }

    function readPersistentComments(mediaKey) {
        const storageKey = getPersistentCacheKey(mediaKey);
        if (!storageKey) {
            return null;
        }

        try {
            const raw = global.localStorage?.getItem(storageKey);
            if (!raw) {
                return null;
            }

            const payload = JSON.parse(raw);
            const items = Array.isArray(payload?.items) ? payload.items.filter(Boolean) : null;
            const cachedAt = Number(payload?.cachedAt || 0);
            if (!items || !Number.isFinite(cachedAt)) {
                return null;
            }

            if ((Date.now() - cachedAt) >= CONFIG.persistentCacheTtlMs) {
                global.localStorage?.removeItem(storageKey);
                return null;
            }

            return sortCommentsAscending(items);
        } catch (_) {
            return null;
        }
    }

    function writePersistentComments(mediaKey, items) {
        const storageKey = getPersistentCacheKey(mediaKey);
        if (!storageKey) {
            return;
        }

        try {
            global.localStorage?.setItem(storageKey, JSON.stringify({
                items: Array.isArray(items) ? items : [],
                cachedAt: Date.now(),
            }));
        } catch (_) {
            // Ignore storage write failures.
        }
    }

    async function listComments(mediaKey, options = {}) {
        const normalizedMediaKey = normalizeMediaKey(mediaKey);
        if (!normalizedMediaKey) {
            return [];
        }

        const forceRefresh = Boolean(options.forceRefresh);
        const requestedLimit = Number.isFinite(options.limit)
            ? Math.trunc(options.limit)
            : CONFIG.defaultLimit;
        const limit = Math.max(1, Math.min(requestedLimit, CONFIG.defaultLimit));

        const cached = commentsCache.get(normalizedMediaKey);
        if (
            !forceRefresh &&
            cached &&
            (Date.now() - cached.cachedAt) < CONFIG.cacheTtlMs
        ) {
            return cached.items;
        }

        if (!forceRefresh) {
            const persistentCachedItems = readPersistentComments(normalizedMediaKey);
            if (persistentCachedItems) {
                commentsCache.set(normalizedMediaKey, {
                    items: persistentCachedItems,
                    cachedAt: Date.now(),
                });
                return persistentCachedItems;
            }
        }

        logDebug('Loading comments thread.', {
            mediaKey: normalizedMediaKey,
            endpoint: CONFIG.graphqlEndpoint,
            hasApiKeyHeader: Boolean(CONFIG.apiKey),
        });

        let items = [];

        try {
            const data = await graphQlRequest(COMMENTS_BY_MEDIA_KEY_QUERY, {
                mediaKey: normalizedMediaKey,
                limit,
                nextToken: null,
            }, {
                mediaKey: normalizedMediaKey,
                authMode: 'apiKey',
            });

            items = Array.isArray(data.commentsByMediaKey?.items)
                ? data.commentsByMediaKey.items.filter(Boolean)
                : [];
        } catch (error) {
            if (!isUnauthorizedError(error)) {
                throw error;
            }

            logDebug('Primary commentsByMediaKey read is unauthorized; trying public syncMediaComments fallback.', {
                mediaKey: normalizedMediaKey,
                endpoint: CONFIG.graphqlEndpoint,
                hasApiKeyHeader: Boolean(CONFIG.apiKey),
            });

            const fallbackData = await graphQlRequest(SYNC_MEDIA_COMMENTS_QUERY, {
                filter: {
                    mediaKey: { eq: normalizedMediaKey },
                    status: { eq: 'ACTIVE' },
                },
                limit,
                nextToken: null,
            }, {
                mediaKey: normalizedMediaKey,
                authMode: 'apiKey',
            });

            items = Array.isArray(fallbackData.syncMediaComments?.items)
                ? fallbackData.syncMediaComments.items.filter(Boolean)
                : [];
        }

        items = sortCommentsAscending(items);

        commentsCache.set(normalizedMediaKey, {
            items,
            cachedAt: Date.now(),
        });
        writePersistentComments(normalizedMediaKey, items);

        return items;
    }

    async function postComment(mediaKey, content) {
        const normalizedMediaKey = normalizeMediaKey(mediaKey);
        const trimmedContent = String(content || '').trim();
        const authState = getAuthState();

        if (!normalizedMediaKey) {
            throw new Error('Липсва валиден media key за коментара.');
        }

        if (!trimmedContent) {
            throw new Error('Напишете коментар.');
        }

        if (trimmedContent.length > CONFIG.maxCommentLength) {
            throw new Error(`Коментарът не може да е над ${CONFIG.maxCommentLength} символа.`);
        }

        const authorizationToken = getAuthorizationToken();
        if (!authorizationToken) {
            throw new Error('Трябва да сте влезли в профила си.');
        }

        const remainingCooldownMs = getRemainingPostCooldownMs(authState);
        if (remainingCooldownMs > 0) {
            const seconds = Math.ceil(remainingCooldownMs / 1000);
            throw new Error(`Можете да публикувате по 1 коментар на ${Math.round(CONFIG.commentCooldownMs / 1000)} секунди. Изчакайте още ${seconds} сек.`);
        }

        const data = await graphQlRequest(POST_MEDIA_COMMENT_MUTATION, {
            mediaKey: normalizedMediaKey,
            content: trimmedContent,
        }, {
            authMode: 'userPool',
            authorizationToken,
            mediaKey: normalizedMediaKey,
        });

        rememberSuccessfulPost(authState);
        clearCommentsCache(normalizedMediaKey);
        return data.postMediaComment || null;
    }

    async function removeComment(id, mediaKey = '') {
        const commentId = String(id || '').trim();
        if (!commentId) {
            throw new Error('Липсва id на коментара.');
        }

        const authorizationToken = getAuthorizationToken();
        if (!authorizationToken) {
            throw new Error('Трябва да сте влезли в профила си.');
        }

        const normalizedMediaKey = normalizeMediaKey(mediaKey);

        const data = await graphQlRequest(REMOVE_MEDIA_COMMENT_MUTATION, {
            id: commentId,
        }, {
            authMode: 'userPool',
            authorizationToken,
            mediaKey: normalizedMediaKey,
        });

        if (normalizedMediaKey) {
            clearCommentsCache(normalizedMediaKey);
        }

        return Boolean(data.removeMediaComment);
    }

    function clearCommentsCache(mediaKey) {
        if (!mediaKey) {
            commentsCache.clear();
            try {
                const keysToDelete = [];
                for (let index = 0; index < (global.localStorage?.length || 0); index += 1) {
                    const key = global.localStorage.key(index);
                    if (key && key.startsWith(CONFIG.persistentCachePrefix)) {
                        keysToDelete.push(key);
                    }
                }
                keysToDelete.forEach(key => global.localStorage?.removeItem(key));
            } catch (_) {
                // Ignore storage cleanup failures.
            }
            return;
        }

        const normalizedMediaKey = normalizeMediaKey(mediaKey);
        commentsCache.delete(normalizedMediaKey);

        const storageKey = getPersistentCacheKey(normalizedMediaKey);
        if (storageKey) {
            try {
                global.localStorage?.removeItem(storageKey);
            } catch (_) {
                // Ignore storage cleanup failures.
            }
        }
    }

    function getCachedComments(mediaKey) {
        const normalizedMediaKey = normalizeMediaKey(mediaKey);
        if (!normalizedMediaKey) {
            return null;
        }

        const cached = commentsCache.get(normalizedMediaKey);
        if (!cached) {
            return null;
        }

        if ((Date.now() - cached.cachedAt) >= CONFIG.cacheTtlMs) {
            commentsCache.delete(normalizedMediaKey);
            return null;
        }

        return cached.items;
    }

    function getCachedCommentCount(mediaKey) {
        const cachedItems = getCachedComments(mediaKey);
        return Array.isArray(cachedItems) ? cachedItems.length : null;
    }

    global.PedalComments = {
        listComments,
        postComment,
        removeComment,
        clearCommentsCache,
        getCachedComments,
        getCachedCommentCount,
        getRemainingPostCooldownMs,
        normalizeMediaKey,
        formatCommentDate,
        canDeleteComment,
    };
})(window);
