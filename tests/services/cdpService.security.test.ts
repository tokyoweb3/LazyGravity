import fs from 'fs';
import path from 'path';

describe('CdpService security hardening', () => {
    it('child_process.exec を使用しないこと', () => {
        const sourcePath = path.resolve(__dirname, '../../src/services/cdpService.ts');
        const source = fs.readFileSync(sourcePath, 'utf-8');

        expect(source).not.toContain('exec(');
    });
});
