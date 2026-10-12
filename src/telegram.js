export const MAX_TELEGRAM_PHOTOS = 10;
export const MAX_TELEGRAM_PHOTO_SIZE_BYTES = 10 * 1024 * 1024;

const TELEGRAM_REQUEST_TIMEOUT_MS = 45_000;

const getTelegramUrl = (botToken, method) =>
    `https://api.telegram.org/bot${botToken}/${method}`;

const requireTelegramConfig = (botToken, chatId) => {
    if (!botToken || !chatId) {
        throw new Error('Telegram notifications are not configured. The claim was not recorded.');
    }
};

const readJsonSafely = async (response) => {
    try {
        return await response.json();
    } catch {
        return null;
    }
};

const telegramFetch = async (url, options, fetchImpl) => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TELEGRAM_REQUEST_TIMEOUT_MS);

    try {
        return await fetchImpl(url, { ...options, signal: controller.signal });
    } catch (error) {
        if (error?.name === 'AbortError') {
            throw new Error('Telegram did not respond in time. The claim was not recorded.');
        }
        throw new Error('Telegram could not be reached. The claim was not recorded.');
    } finally {
        clearTimeout(timeoutId);
    }
};

const requireTelegramSuccess = async (response) => {
    const result = await readJsonSafely(response);

    if (!response.ok || result?.ok !== true) {
        const reason = result?.description || `HTTP ${response.status}`;
        throw new Error(`Telegram rejected the notification: ${reason}. The claim was not recorded.`);
    }

    return result;
};

export const sendTelegramText = async ({
    botToken,
    chatId,
    text,
    fetchImpl = fetch,
}) => {
    requireTelegramConfig(botToken, chatId);

    const response = await telegramFetch(
        getTelegramUrl(botToken, 'sendMessage'),
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: chatId, text }),
        },
        fetchImpl,
    );

    return requireTelegramSuccess(response);
};

export const sendTelegramPhotos = async ({
    botToken,
    chatId,
    files,
    caption,
    fetchImpl = fetch,
}) => {
    requireTelegramConfig(botToken, chatId);

    if (!Array.isArray(files) || files.length === 0) {
        throw new Error('At least one claim document is required for a cash claim.');
    }

    if (files.length > MAX_TELEGRAM_PHOTOS) {
        throw new Error(`Telegram accepts at most ${MAX_TELEGRAM_PHOTOS} claim images at once.`);
    }

    for (const file of files) {
        if (!file?.type?.startsWith('image/')) {
            throw new Error(`"${file?.name || 'Selected file'}" is not a supported image.`);
        }
        if (file.size > MAX_TELEGRAM_PHOTO_SIZE_BYTES) {
            throw new Error(`"${file.name}" is larger than Telegram's 10 MB photo limit.`);
        }
    }

    if (files.length === 1) {
        const formData = new FormData();
        formData.append('chat_id', chatId);
        formData.append('photo', files[0], files[0].name);
        if (caption) formData.append('caption', caption);

        const response = await telegramFetch(
            getTelegramUrl(botToken, 'sendPhoto'),
            { method: 'POST', body: formData },
            fetchImpl,
        );

        return requireTelegramSuccess(response);
    }

    const formData = new FormData();
    formData.append('chat_id', chatId);
    const media = files.map((file, index) => {
        const key = `file${index}`;
        formData.append(key, file, file.name);
        return {
            type: 'photo',
            media: `attach://${key}`,
            ...(index === 0 && caption ? { caption } : {}),
        };
    });
    formData.append('media', JSON.stringify(media));

    const response = await telegramFetch(
        getTelegramUrl(botToken, 'sendMediaGroup'),
        { method: 'POST', body: formData },
        fetchImpl,
    );

    return requireTelegramSuccess(response);
};
