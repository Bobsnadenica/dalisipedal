(function initPedalComments(global) {
    const CONFIG = Object.freeze({
        graphqlEndpoint: 'https://5otrnlraozcdni6ekx27cy5exe.appsync-api.eu-central-1.amazonaws.com/graphql',
        apiKey: 'da2-6lagph7zcvfuzicgqenbfvyyqi',
        cacheTtlMs: 60 * 1000,
        defaultLimit: 100,
    });

    const COMMENTS_BY_MEDIA_KEY_QUERY = `
        query CommentsByMediaKey(
            $mediaKey: String!
            $sortDirection: ModelSortDirection
            $filter: ModelMediaCommentFilterInput
            $limit: Int
            $nextToken: String
        ) {
            commentsByMediaKey(
                mediaKey: $mediaKey
                sortDirection: $sortDirection
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

    const commentsCache = new Map();

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

        return trimmed.startsWith('/') ? trimmed.slice(1) : trimmed;
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

    async function graphQlRequest(document, variables) {
        const response = await fetch(CONFIG.graphqlEndpoint, {
            method: 'POST',
            cache: 'no-store',
            headers: {
                'content-type': 'application/json',
                'x-api-key': CONFIG.apiKey,
            },
            body: JSON.stringify({
                query: document,
                variables,
            }),
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const payload = await response.json();
        if (Array.isArray(payload.errors) && payload.errors.length) {
            throw new Error(payload.errors[0]?.message || 'GraphQL request failed');
        }

        return payload.data || {};
    }

    async function listComments(mediaKey, options = {}) {
        const normalizedMediaKey = normalizeMediaKey(mediaKey);
        if (!normalizedMediaKey) {
            return [];
        }

        const forceRefresh = Boolean(options.forceRefresh);
        const limit = Number.isFinite(options.limit) ? options.limit : CONFIG.defaultLimit;

        const cached = commentsCache.get(normalizedMediaKey);
        if (
            !forceRefresh &&
            cached &&
            (Date.now() - cached.cachedAt) < CONFIG.cacheTtlMs
        ) {
            return cached.items;
        }

        const data = await graphQlRequest(COMMENTS_BY_MEDIA_KEY_QUERY, {
            mediaKey: normalizedMediaKey,
            sortDirection: 'ASC',
            limit,
            filter: {
                status: { eq: 'ACTIVE' },
            },
        });

        const items = Array.isArray(data.commentsByMediaKey?.items)
            ? data.commentsByMediaKey.items.filter(Boolean)
            : [];

        commentsCache.set(normalizedMediaKey, {
            items,
            cachedAt: Date.now(),
        });

        return items;
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
        clearCommentsCache,
        normalizeMediaKey,
        formatCommentDate,
    };
})(window);
