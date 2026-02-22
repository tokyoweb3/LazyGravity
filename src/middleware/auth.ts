export const withAuth = (userId: string, allowedUserIds: string[], next: () => void): void => {
    if (allowedUserIds.includes(userId)) {
        next();
    }
    return;
};
