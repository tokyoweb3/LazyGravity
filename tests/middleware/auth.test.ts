import { withAuth } from '../../src/middleware/auth';

describe('Auth Middleware', () => {
    it('calls next if userId is in allowedUserIds', () => {
        const nextMock = jest.fn();
        const allowedUserIds = ['123', '456'];

        withAuth('123', allowedUserIds, nextMock);

        expect(nextMock).toHaveBeenCalledTimes(1);
    });

    it('does not call next and returns immediately if userId is not in allowedUserIds', () => {
        const nextMock = jest.fn();
        const allowedUserIds = ['123', '456'];

        withAuth('789', allowedUserIds, nextMock);

        expect(nextMock).not.toHaveBeenCalled();
    });
});
