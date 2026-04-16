const PedalWebsiteAuth = (() => {
    const COGNITO_APP_CLIENT_ID = '5e4pfquq9hquccj5uoqv25969v';
    const STORAGE_PREFIX = `CognitoIdentityServiceProvider.${COGNITO_APP_CLIENT_ID}.`;
    const TOKEN_SUFFIX = '.idToken';
    const ACCESS_SUFFIX = '.accessToken';

    function listStorageKeys(storage) {
        const keys = [];

        try {
            for (let index = 0; index < storage.length; index += 1) {
                const key = storage.key(index);
                if (key) {
                    keys.push(key);
                }
            }
        } catch (_) {
            return [];
        }

        return keys;
    }

    function decodeJwt(token) {
        if (!token || typeof token !== 'string') {
            return null;
        }

        const parts = token.split('.');
        if (parts.length < 2) {
            return null;
        }

        try {
            const normalized = parts[1].replace(/-/g, '+').replace(/_/g, '/');
            const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
            return JSON.parse(atob(padded));
        } catch (_) {
            return null;
        }
    }

    function hasValidJwt(token) {
        const payload = decodeJwt(token);
        if (!payload || typeof payload.exp !== 'number') {
            return false;
        }

        return payload.exp * 1000 > Date.now();
    }

    function getCandidateUsers(storage) {
        const candidates = new Set();
        const lastAuthUser = storage.getItem(`${STORAGE_PREFIX}LastAuthUser`);

        if (lastAuthUser) {
            candidates.add(lastAuthUser);
        }

        listStorageKeys(storage).forEach(key => {
            if (!key.startsWith(STORAGE_PREFIX) || !key.endsWith(TOKEN_SUFFIX)) {
                return;
            }

            const username = key.slice(
                STORAGE_PREFIX.length,
                key.length - TOKEN_SUFFIX.length
            );

            if (username) {
                candidates.add(username);
            }
        });

        return [...candidates];
    }

    function findSession(storage) {
        const candidates = getCandidateUsers(storage);

        for (const username of candidates) {
            const idToken = storage.getItem(`${STORAGE_PREFIX}${username}${TOKEN_SUFFIX}`);
            const accessToken = storage.getItem(`${STORAGE_PREFIX}${username}${ACCESS_SUFFIX}`);

            if (hasValidJwt(idToken) || hasValidJwt(accessToken)) {
                return {
                    username,
                    source: storage === window.sessionStorage ? 'sessionStorage' : 'localStorage',
                };
            }
        }

        return null;
    }

    function getCurrentRegisteredUser() {
        try {
            return findSession(window.localStorage) || findSession(window.sessionStorage);
        } catch (_) {
            return null;
        }
    }

    function hasRegisteredUserSession() {
        return Boolean(getCurrentRegisteredUser());
    }

    return Object.freeze({
        getCurrentRegisteredUser,
        hasRegisteredUserSession,
    });
})();

window.PedalWebsiteAuth = PedalWebsiteAuth;
