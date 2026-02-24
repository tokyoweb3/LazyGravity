import { isImageAttachment, mimeTypeToExtension, sanitizeFileName } from '../../src/utils/imageHandler';

describe('imageHandler', () => {
    describe('isImageAttachment', () => {
        it('returns true when contentType is image/*', () => {
            expect(isImageAttachment('image/png', 'any.bin')).toBe(true);
        });

        it('returns true when the file extension is an image format', () => {
            expect(isImageAttachment(null, 'photo.jpeg')).toBe(true);
        });

        it('returns false for non-image files', () => {
            expect(isImageAttachment('application/pdf', 'doc.pdf')).toBe(false);
        });
    });

    describe('mimeTypeToExtension', () => {
        it('converts common mimeTypes to file extensions', () => {
            expect(mimeTypeToExtension('image/png')).toBe('png');
            expect(mimeTypeToExtension('image/jpeg')).toBe('jpg');
            expect(mimeTypeToExtension('image/webp')).toBe('webp');
        });
    });

    describe('sanitizeFileName', () => {
        it('replaces invalid characters with hyphens', () => {
            expect(sanitizeFileName('bad name/with*chars?.png')).toBe('bad-name-with-chars-.png');
        });
    });
});
