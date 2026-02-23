import { isImageAttachment, mimeTypeToExtension, sanitizeFileName } from '../../src/utils/imageHandler';

describe('imageHandler', () => {
    describe('isImageAttachment', () => {
        it('contentTypeがimage/*ならtrueを返す', () => {
            expect(isImageAttachment('image/png', 'any.bin')).toBe(true);
        });

        it('拡張子が画像ならtrueを返す', () => {
            expect(isImageAttachment(null, 'photo.jpeg')).toBe(true);
        });

        it('画像でない場合はfalseを返す', () => {
            expect(isImageAttachment('application/pdf', 'doc.pdf')).toBe(false);
        });
    });

    describe('mimeTypeToExtension', () => {
        it('代表的なmimeTypeを拡張子に変換する', () => {
            expect(mimeTypeToExtension('image/png')).toBe('png');
            expect(mimeTypeToExtension('image/jpeg')).toBe('jpg');
            expect(mimeTypeToExtension('image/webp')).toBe('webp');
        });
    });

    describe('sanitizeFileName', () => {
        it('無効文字をハイフンに置換する', () => {
            expect(sanitizeFileName('bad name/with*chars?.png')).toBe('bad-name-with-chars-.png');
        });
    });
});
