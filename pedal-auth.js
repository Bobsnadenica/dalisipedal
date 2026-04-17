(function initPedalAuth(global) {
    const CONFIG = Object.freeze({
        region: 'eu-central-1',
        userPoolId: 'eu-central-1_1lijXwya4',
        appClientId: '5r8co33o9jeuoieb39boqd1mvt',
    });
    const DEBUG_PREFIX = '[PEDAL auth]';

    const listeners = new Set();
    let userPool = null;
    let challengeUser = null;

    const defaultState = Object.freeze({
        isReady: false,
        isLoading: false,
        isLoggedIn: false,
        requiresNewPassword: false,
        displayName: '',
        loginId: '',
        email: '',
        userId: '',
        sub: '',
        cognitoUsername: '',
        groups: [],
        isAdmin: false,
        idToken: '',
        accessToken: '',
        statusMessage: '',
        errorMessage: '',
    });

    let state = { ...defaultState };

    function logDebug(message, details = {}) {
        console.info(`${DEBUG_PREFIX} ${message}`, details);
    }

    function logError(message, details = {}) {
        console.error(`${DEBUG_PREFIX} ${message}`, details);
    }

    function cloneState() {
        return {
            ...state,
            groups: [...state.groups],
        };
    }

    function emit() {
        const snapshot = cloneState();
        listeners.forEach(listener => {
            try {
                listener(snapshot);
            } catch (error) {
                logError('Auth listener failed.', { error });
            }
        });
    }

    function setState(patch) {
        state = {
            ...state,
            ...patch,
        };
        emit();
    }

    function resetState(extra = {}) {
        challengeUser = null;
        state = {
            ...defaultState,
            isReady: true,
            ...extra,
        };
        emit();
    }

    function decodeBase64Url(value) {
        const normalized = String(value || '')
            .replace(/-/g, '+')
            .replace(/_/g, '/');
        const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), '=');
        const binary = global.atob(padded);
        const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));

        if (typeof global.TextDecoder === 'function') {
            return new global.TextDecoder().decode(bytes);
        }

        return binary;
    }

    function decodeJwtPayload(token) {
        const parts = String(token || '').split('.');
        if (parts.length < 2) {
            return {};
        }

        try {
            return JSON.parse(decodeBase64Url(parts[1]));
        } catch (error) {
            logError('Failed to decode JWT payload.', { error });
            return {};
        }
    }

    function normalizeGroups(value) {
        if (Array.isArray(value)) {
            return value.filter(Boolean);
        }

        if (typeof value === 'string' && value.trim()) {
            return value.split(',').map(item => item.trim()).filter(Boolean);
        }

        return [];
    }

    function isAdminGroup(groups) {
        return groups.includes('Admins') || groups.includes('admin');
    }

    function normalizeError(error) {
        const code = String(error?.code || error?.name || '').trim();
        const message = String(error?.message || '').trim();

        if (code === 'NotAuthorizedException') {
            return 'Грешен имейл, телефон или парола.';
        }

        if (code === 'UserNotFoundException') {
            return 'Потребителят не е намерен.';
        }

        if (code === 'UserNotConfirmedException' || message.includes('not confirmed')) {
            return 'Профилът не е потвърден. Потвърдете го през приложението.';
        }

        if (code === 'PasswordResetRequiredException') {
            return 'Паролата трябва да бъде сменена преди да влезете.';
        }

        if (code === 'InvalidPasswordException') {
            return 'Новата парола не отговаря на изискванията.';
        }

        if (code === 'TooManyRequestsException' || code === 'LimitExceededException') {
            return 'Твърде много опити. Опитайте пак след малко.';
        }

        if (message) {
            return message;
        }

        return 'Не успяхме да ви впишем.';
    }

    function getSdk() {
        const sdk = global.AmazonCognitoIdentity;
        if (!sdk?.CognitoUserPool || !sdk?.CognitoUser || !sdk?.AuthenticationDetails) {
            throw new Error('Cognito SDK is not available.');
        }
        return sdk;
    }

    function getUserPool() {
        if (!userPool) {
            const sdk = getSdk();
            userPool = new sdk.CognitoUserPool({
                UserPoolId: CONFIG.userPoolId,
                ClientId: CONFIG.appClientId,
            });
        }

        return userPool;
    }

    function buildStateFromSession(user, session) {
        const idToken = session?.getIdToken?.().getJwtToken?.() || '';
        const accessToken = session?.getAccessToken?.().getJwtToken?.() || '';
        const idPayload = decodeJwtPayload(idToken);
        const accessPayload = decodeJwtPayload(accessToken);
        const groups = normalizeGroups(
            idPayload['cognito:groups'] || accessPayload['cognito:groups']
        );
        const email = String(idPayload.email || '').trim();
        const cognitoUsername = String(
            idPayload['cognito:username']
            || accessPayload.username
            || user?.getUsername?.()
            || ''
        ).trim();
        const displayName = email || cognitoUsername;
        const loginId = email || cognitoUsername;
        const sub = String(idPayload.sub || accessPayload.sub || '').trim();
        const userId = cognitoUsername || sub;

        return {
            ...defaultState,
            isReady: true,
            isLoggedIn: true,
            displayName,
            loginId,
            email,
            userId,
            sub,
            cognitoUsername,
            groups,
            isAdmin: isAdminGroup(groups),
            idToken,
            accessToken,
        };
    }

    function loadCurrentSession(currentUser) {
        return new Promise((resolve, reject) => {
            currentUser.getSession((error, session) => {
                if (error) {
                    reject(error);
                    return;
                }

                if (!session || !session.isValid()) {
                    reject(new Error('Session is invalid.'));
                    return;
                }

                resolve(buildStateFromSession(currentUser, session));
            });
        });
    }

    async function init() {
        try {
            getUserPool();
        } catch (error) {
            logError('Cognito SDK initialization failed.', { error });
            resetState({
                errorMessage: 'Входът временно не е наличен.',
            });
            return cloneState();
        }

        const currentUser = getUserPool().getCurrentUser();
        if (!currentUser) {
            resetState();
            return cloneState();
        }

        setState({
            isReady: false,
            isLoading: true,
            errorMessage: '',
            statusMessage: '',
        });

        try {
            state = await loadCurrentSession(currentUser);
        } catch (error) {
            try {
                currentUser.signOut();
            } catch (_) {
                // Ignore sign-out cleanup failures.
            }

            resetState();
            return cloneState();
        }

        emit();
        return cloneState();
    }

    function signIn(username, password) {
        const loginId = String(username || '').trim();
        const secret = String(password || '');

        if (!loginId) {
            return Promise.reject(new Error('Въведете имейл или телефон.'));
        }

        if (!secret) {
            return Promise.reject(new Error('Въведете парола.'));
        }

        let sdk;
        try {
            sdk = getSdk();
        } catch (error) {
            const message = 'Входът временно не е наличен.';
            setState({
                isReady: true,
                isLoading: false,
                errorMessage: message,
            });
            return Promise.reject(new Error(message));
        }

        const cognitoUser = new sdk.CognitoUser({
            Username: loginId,
            Pool: getUserPool(),
        });
        const authDetails = new sdk.AuthenticationDetails({
            Username: loginId,
            Password: secret,
        });

        setState({
            isReady: true,
            isLoading: true,
            errorMessage: '',
            statusMessage: '',
            requiresNewPassword: false,
        });

        return new Promise((resolve, reject) => {
            cognitoUser.authenticateUser(authDetails, {
                onSuccess(session) {
                    challengeUser = null;
                    state = buildStateFromSession(cognitoUser, session);
                    emit();
                    resolve(cloneState());
                },
                onFailure(error) {
                    const message = normalizeError(error);
                    setState({
                        isReady: true,
                        isLoading: false,
                        errorMessage: message,
                    });
                    reject(new Error(message));
                },
                newPasswordRequired() {
                    challengeUser = cognitoUser;
                    setState({
                        isReady: true,
                        isLoading: false,
                        isLoggedIn: false,
                        requiresNewPassword: true,
                        loginId,
                        errorMessage: '',
                        statusMessage: 'Сигурността изисква смяна на паролата.',
                    });
                    resolve(cloneState());
                },
            });
        });
    }

    function completeNewPassword(newPassword) {
        const secret = String(newPassword || '');

        if (!challengeUser) {
            return Promise.reject(new Error('Няма активен login challenge.'));
        }

        if (secret.length < 6) {
            return Promise.reject(new Error('Паролата трябва да е поне 6 символа.'));
        }

        setState({
            isReady: true,
            isLoading: true,
            errorMessage: '',
            statusMessage: '',
        });

        return new Promise((resolve, reject) => {
            challengeUser.completeNewPasswordChallenge(secret, {}, {
                onSuccess(session) {
                    state = buildStateFromSession(challengeUser, session);
                    challengeUser = null;
                    emit();
                    resolve(cloneState());
                },
                onFailure(error) {
                    const message = normalizeError(error);
                    setState({
                        isReady: true,
                        isLoading: false,
                        errorMessage: message,
                    });
                    reject(new Error(message));
                },
            });
        });
    }

    async function signOut() {
        try {
            getUserPool().getCurrentUser()?.signOut();
        } catch (error) {
            logError('Sign-out failed.', { error });
        }

        resetState();
        return cloneState();
    }

    function subscribe(listener) {
        if (typeof listener !== 'function') {
            return () => {};
        }

        listeners.add(listener);
        listener(cloneState());

        return () => {
            listeners.delete(listener);
        };
    }

    function getAuthorizationToken() {
        return state.idToken || '';
    }

    logDebug('Website auth module loaded.', {
        region: CONFIG.region,
        userPoolId: CONFIG.userPoolId,
        appClientId: CONFIG.appClientId,
    });

    global.PedalAuth = {
        init,
        signIn,
        completeNewPassword,
        signOut,
        subscribe,
        getAuthState: cloneState,
        getAuthorizationToken,
    };
})(window);
