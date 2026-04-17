(function initPedalComments(global) {
    const CONFIG = Object.freeze({
        graphqlEndpoint: 'https://5otrnlraozcdni6ekx27cy5exe.appsync-api.eu-central-1.amazonaws.com/graphql',
        apiKey: 'da2-6lagph7zcvfuzicgqenbfvyyqi',
        cacheTtlMs: 2 * 60 * 1000,
        defaultLimit: 50,
        maxCommentLength: 500,
    });
    const DEBUG_PREFIX = '[PEDAL comments]';

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

        return items;
    }

    async function postComment(mediaKey, content) {
        const normalizedMediaKey = normalizeMediaKey(mediaKey);
        const trimmedContent = String(content || '').trim();

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

        const data = await graphQlRequest(POST_MEDIA_COMMENT_MUTATION, {
            mediaKey: normalizedMediaKey,
            content: trimmedContent,
        }, {
            authMode: 'userPool',
            authorizationToken,
            mediaKey: normalizedMediaKey,
        });

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
            return;
        }

        commentsCache.delete(normalizeMediaKey(mediaKey));
    }

    global.PedalComments = {
        listComments,
        postComment,
        removeComment,
        clearCommentsCache,
        normalizeMediaKey,
        formatCommentDate,
        canDeleteComment,
    };
})(window);
